package configstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	encryptionStatusPlainText = "plain_text"
	encryptionStatusEncrypted = "encrypted"
	// encryptionBatchSize bounds the candidate scan. Candidates are still
	// claimed one row per transaction; this only controls read-ahead.
	encryptionBatchSize = 100
	// encryptionVaultConcurrency overlaps vault round trips without allowing a
	// booting node to consume the whole database pool.
	encryptionVaultConcurrency = 8
)

// encryptConcurrency preserves the startup backfill's historical contract:
// OSS deployments stay serial, while vault-backed deployments may overlap
// independent row claims. SQLite callers are capped separately below because
// its single-writer locking cannot benefit from parallel updates.
func encryptConcurrency() int {
	if schemas.VaultStoreWriteEnabled() {
		return encryptionVaultConcurrency
	}
	return 1
}

// lockRow takes a row lock so a row claimed by one node is not re-encrypted by
// another. SQLite is single-writer and has no row locks, so the clause is
// omitted there.
func lockRow(tx *gorm.DB) *gorm.DB {
	if tx.Dialector.Name() == "sqlite" {
		return tx
	}
	return tx.Clauses(clause.Locking{Strength: "UPDATE"})
}

// encryptClaimedRows keeps the upstream model-hook migration path available
// for tables that do not need the legacy raw-column compatibility path below.
func encryptClaimedRows[T any, ID any](
	ctx context.Context,
	s *RDBConfigStore,
	ids []ID,
	where string,
	statusOf func(*T) string,
) (int, error) {
	var encrypted atomic.Int64
	errs := make([]error, len(ids))
	sem := make(chan struct{}, encryptConcurrency())
	var wg sync.WaitGroup
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				errs[i] = ctx.Err()
				return
			}
			defer func() { <-sem }()
			errs[i] = s.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				var row []T
				if err := lockRow(tx).Where(where, encryptionStatusPlainText, ids[i]).
					Limit(1).Find(&row).Error; err != nil {
					return err
				}
				if len(row) == 0 {
					return nil
				}
				if err := tx.Save(&row[0]).Error; err != nil {
					return err
				}
				if statusOf(&row[0]) == encryptionStatusEncrypted {
					encrypted.Add(1)
				}
				return nil
			})
		}(i)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return int(encrypted.Load()), err
		}
	}
	return int(encrypted.Load()), nil
}

func legacyEncryptionConcurrency(db *gorm.DB) int {
	if db == nil || db.Dialector.Name() == "sqlite" {
		return 1
	}
	return encryptConcurrency()
}

// runLegacyEncryptionCandidates executes independent row claims with bounded
// concurrency. Each callback owns exactly one transaction and therefore one
// row lock at a time; a failed candidate does not roll back already committed
// rows from the same scan batch.
func runLegacyEncryptionCandidates(
	ctx context.Context,
	db *gorm.DB,
	ids []any,
	fn func(any) (bool, error),
) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	concurrency := legacyEncryptionConcurrency(db)
	if concurrency <= 1 {
		var encrypted int
		for _, id := range ids {
			migrated, err := fn(id)
			if err != nil {
				return encrypted, err
			}
			if migrated {
				encrypted++
			}
		}
		return encrypted, nil
	}
	sem := make(chan struct{}, concurrency)
	errs := make([]error, len(ids))
	var encrypted atomic.Int64
	var wg sync.WaitGroup
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				errs[i] = ctx.Err()
				return
			}
			defer func() { <-sem }()
			migrated, err := fn(ids[i])
			if err != nil {
				errs[i] = err
				return
			}
			if migrated {
				encrypted.Add(1)
			}
		}(i)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return int(encrypted.Load()), err
		}
	}
	return int(encrypted.Load()), nil
}

// legacyRawColumn describes one encryption-owned column in a legacy row. Raw
// rows are used for the startup migration because loading a row through its
// model runs AfterFind first; a row with an empty status marker can therefore
// expose ciphertext as opaque data and a subsequent BeforeSave would encrypt
// it a second time.
type legacyRawColumn struct {
	name           string
	preserveRef    bool
	vaultSecret    bool
	vaultJSON      bool
	skipEncryption bool
}

// encryptLegacyRawRows migrates rows without invoking model hooks. Every row
// selected by the status predicate is marked encrypted, while each sensitive
// column is first probed with Decrypt so already-encrypted legacy values are
// retained byte-for-byte. SecretVar columns explicitly opt into the same vault
// store contract as their model hooks. hashColumn/tokenColumn are used by
// session-like tables whose lookup hash must always be derived from plaintext.
func (s *RDBConfigStore) encryptLegacyRawRows(
	ctx context.Context,
	table string,
	where string,
	columns []legacyRawColumn,
	hashColumn string,
	tokenColumn string,
) (int, error) {
	return s.encryptLegacyRawRowsWithStatus(ctx, table, where, columns, hashColumn, tokenColumn,
		"(encryption_status = ? OR encryption_status IS NULL OR encryption_status = '')")
}

func (s *RDBConfigStore) encryptLegacyRawRowsStrictPlaintext(
	ctx context.Context,
	table string,
	where string,
	columns []legacyRawColumn,
	hashColumn string,
	tokenColumn string,
) (int, error) {
	return s.encryptLegacyRawRowsWithStatus(ctx, table, where, columns, hashColumn, tokenColumn,
		"encryption_status = ?")
}

func (s *RDBConfigStore) encryptLegacyRawRowsWithStatus(
	ctx context.Context,
	table string,
	where string,
	columns []legacyRawColumn,
	hashColumn string,
	tokenColumn string,
	statusWhere string,
) (int, error) {
	var count int
	for {
		// Read only stable identities. The actual row is fetched again inside its
		// own transaction below so a concurrent startup worker cannot overwrite a
		// row after another worker has already advanced its status marker.
		var rows []map[string]any
		query := s.DB().WithContext(ctx).Table(table).Select("id").Where(statusWhere, encryptionStatusPlainText)
		if strings.TrimSpace(where) != "" {
			query = query.Where(where)
		}
		if err := query.Order("id").Limit(encryptionBatchSize).Find(&rows).Error; err != nil {
			return count, err
		}
		if len(rows) == 0 {
			break
		}

		ids := make([]any, len(rows))
		for i, candidate := range rows {
			id, ok := legacyRawValue(candidate, "id")
			if !ok || id == nil {
				return count, fmt.Errorf("%s legacy row has no id", table)
			}
			ids[i] = id
		}
		migrated, err := runLegacyEncryptionCandidates(ctx, s.DB(), ids, func(id any) (bool, error) {
			return s.encryptLegacyRawRow(ctx, table, where, columns, hashColumn, tokenColumn, id, statusWhere)
		})
		count += migrated
		if err != nil {
			return count, err
		}
	}
	return count, nil
}

// encryptLegacyRawRow re-reads and migrates one candidate under a single-row
// transaction. Vault round trips therefore never hold locks for an entire
// batch, and the status predicate is rechecked after the candidate list was
// read so concurrent startup workers converge without stale writes.
func (s *RDBConfigStore) encryptLegacyRawRow(
	ctx context.Context,
	table string,
	where string,
	columns []legacyRawColumn,
	hashColumn string,
	tokenColumn string,
	id any,
	statusWhere string,
) (bool, error) {
	var migrated bool
	err := s.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []map[string]any
		query := dbForUpdate(tx.WithContext(ctx)).Table(table).Where(statusWhere, encryptionStatusPlainText).Where("id = ?", id)
		if strings.TrimSpace(where) != "" {
			query = query.Where(where)
		}
		if err := query.Limit(1).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}

		updates, err := legacyRawUpdates(ctx, table, rows[0], columns, hashColumn, tokenColumn)
		if err != nil {
			return err
		}
		result := tx.WithContext(ctx).Table(table).Where("id = ?", id).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		migrated = result.RowsAffected > 0
		return nil
	})
	return migrated, err
}

func legacyRawUpdates(
	ctx context.Context,
	table string,
	row map[string]any,
	columns []legacyRawColumn,
	hashColumn string,
	tokenColumn string,
) (map[string]any, error) {
	id, ok := legacyRawValue(row, "id")
	if !ok || id == nil {
		return nil, fmt.Errorf("%s legacy row has no id", table)
	}
	vaultKey := id
	if table == "config_keys" {
		if keyID, ok := legacyRawValue(row, "key_id"); ok && keyID != nil {
			vaultKey = keyID
		}
	} else if table == "config_mcp_clients" {
		if clientID, ok := legacyRawValue(row, "client_id"); ok && clientID != nil {
			vaultKey = clientID
		}
	}
	vaultKeyString, _ := legacyRawString(vaultKey)
	vaultBase := schemas.VaultBasePath(table, vaultKeyString)
	updates := map[string]any{"encryption_status": encryptionStatusEncrypted}
	for _, column := range columns {
		raw, ok := legacyRawValue(row, column.name)
		if !ok || raw == nil {
			continue
		}
		value, ok := legacyRawString(raw)
		if !ok {
			continue
		}
		if column.vaultJSON && schemas.VaultStoreWriteEnabled() && !isLegacyCiphertext(value) && !schemas.IsSecretRef(value) {
			migrated, err := migrateLegacyVaultJSON(ctx, vaultBase, column.name, value)
			if err != nil {
				return nil, fmt.Errorf("migrate %s.%s: %w", table, column.name, err)
			}
			if migrated != value {
				value = migrated
			}
		}
		if column.vaultSecret && schemas.VaultStoreWriteEnabled() && !isLegacyCiphertext(value) && !schemas.IsSecretRef(value) {
			secret := schemas.SecretVar{Val: value}
			if err := schemas.StoreVaultSecretVar(ctx, vaultBase+"/"+column.name, &secret); err != nil {
				return nil, fmt.Errorf("store %s.%s in vault: %w", table, column.name, err)
			}
			if secret.IsFromSecret() {
				updates[column.name] = secret.GetRawRef()
				continue
			}
		}
		if column.skipEncryption {
			continue
		}
		migrated, err := migrateLegacyCiphertextStringWithRef(value, column.preserveRef)
		if err != nil {
			return nil, fmt.Errorf("migrate %s.%s: %w", table, column.name, err)
		}
		if migrated != value {
			updates[column.name] = migrated
		}
	}

	if hashColumn != "" && tokenColumn != "" {
		raw, ok := legacyRawValue(row, tokenColumn)
		if ok && raw != nil {
			storedToken, ok := legacyRawString(raw)
			if ok && storedToken != "" {
				plaintext := storedToken
				if decrypted, err := encrypt.Decrypt(storedToken); err == nil {
					plaintext = decrypted
				}
				updates[hashColumn] = encrypt.HashSHA256(plaintext)
			}
		}
	}
	return updates, nil
}

func legacyRawValue(row map[string]any, name string) (any, bool) {
	if value, ok := row[name]; ok {
		return value, true
	}
	for key, value := range row {
		if strings.EqualFold(key, name) {
			return value, true
		}
	}
	return nil, false
}

func legacyRawString(value any) (string, bool) {
	switch typed := value.(type) {
	case string:
		return typed, true
	case []byte:
		return string(typed), true
	default:
		return fmt.Sprint(typed), true
	}
}

func isLegacyCiphertext(value string) bool {
	if value == "" {
		return false
	}
	_, err := encrypt.Decrypt(value)
	return err == nil
}

// migrateLegacyVaultJSON mirrors the MCP client's global vault callback for
// its direct headers map. The callback stores each plaintext header under its
// own path, serializes the resulting refs, and the model then encrypts the
// complete JSON blob.
func migrateLegacyVaultJSON(ctx context.Context, base, column, value string) (string, error) {
	if column != "headers_json" {
		return value, nil
	}
	var headers map[string]string
	if err := json.Unmarshal([]byte(value), &headers); err != nil {
		return value, nil
	}
	for key, raw := range headers {
		if raw == "" || schemas.IsSecretRef(raw) || isLegacyCiphertext(raw) {
			continue
		}
		secret := schemas.SecretVar{Val: raw}
		if err := schemas.StoreVaultSecretVar(ctx, base+"/headers/"+url.PathEscape(key), &secret); err != nil {
			return "", err
		}
		if secret.IsFromSecret() {
			headers[key] = secret.GetRawRef()
		}
	}
	data, err := json.Marshal(headers)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// EncryptPlaintextRows encrypts all rows with encryption_status='plain_text'
// across all sensitive tables. Called during startup when encryption is enabled.
// Legacy rows are migrated through raw-column probes so model hooks cannot
// double-encrypt ciphertext whose status marker is missing.
func (s *RDBConfigStore) EncryptPlaintextRows(ctx context.Context) error {
	if !encrypt.IsEnabled() {
		return nil
	}

	var totalEncrypted int

	// config_keys
	count, err := s.encryptPlaintextKeys(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt config_keys: %w", err)
	}
	totalEncrypted += count

	// governance_virtual_keys
	count, err = s.encryptPlaintextVirtualKeys(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt virtual_keys: %w", err)
	}
	totalEncrypted += count

	// sessions
	count, err = s.encryptPlaintextSessions(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt sessions: %w", err)
	}
	totalEncrypted += count

	// temp_tokens
	count, err = s.encryptPlaintextTempTokens(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt temp_tokens: %w", err)
	}
	totalEncrypted += count

	// mcp_oauth_tokens
	count, err = s.encryptPlaintextOAuthTokens(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt mcp_oauth_tokens: %w", err)
	}
	totalEncrypted += count

	// Legacy OAuth token safety-net tables. These tables are intentionally kept
	// for rollback compatibility even though current reads/writes use the
	// merged mcp_oauth_tokens table. Encrypt any rows that still carry the old
	// plaintext marker without dropping or reshaping the legacy tables.
	count, err = s.encryptPlaintextLegacyOAuthTokens(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt legacy oauth tokens: %w", err)
	}
	totalEncrypted += count

	// oauth_configs
	count, err = s.encryptPlaintextOAuthConfigs(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt oauth_configs: %w", err)
	}
	totalEncrypted += count

	// config_mcp_clients
	count, err = s.encryptPlaintextMCPClients(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt mcp_clients: %w", err)
	}
	totalEncrypted += count

	// config_providers (proxy config)
	count, err = s.encryptPlaintextProviderProxies(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt provider proxy configs: %w", err)
	}
	totalEncrypted += count

	// config_vector_store
	count, err = s.encryptPlaintextVectorStoreConfigs(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt vector_store configs: %w", err)
	}
	totalEncrypted += count

	// config_plugins
	count, err = s.encryptPlaintextPlugins(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt plugin configs: %w", err)
	}
	totalEncrypted += count

	// config_webhook_endpoints
	count, err = s.encryptPlaintextWebhookEndpoints(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt webhook endpoints: %w", err)
	}
	totalEncrypted += count

	// mcp_oauth_flows (PKCE code verifiers)
	count, err = s.encryptPlaintextMCPOauthFlows(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt MCP OAuth flows: %w", err)
	}
	totalEncrypted += count

	// mcp_per_user_header_credentials
	count, err = s.encryptPlaintextMCPPerUserHeaderCredentials(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt MCP per-user header credentials: %w", err)
	}
	totalEncrypted += count

	// governance_config (OAuth2 signing key JSON blob)
	count, err = s.encryptPlaintextOAuth2SigningKey(ctx)
	if err != nil {
		return fmt.Errorf("failed to encrypt OAuth2 signing key: %w", err)
	}
	totalEncrypted += count

	if totalEncrypted > 0 && s.logger != nil {
		s.logger.Info(fmt.Sprintf("encrypted %d plaintext rows across all tables", totalEncrypted))
	}

	return nil
}

// encryptPlaintextKeys migrates config_keys through raw rows so a legacy
// ciphertext value with an empty status marker is not encrypted again.
func (s *RDBConfigStore) encryptPlaintextKeys(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "config_keys", "", []legacyRawColumn{
		{name: "value", preserveRef: true, vaultSecret: true},
		{name: "azure_endpoint", preserveRef: true, vaultSecret: true},
		{name: "azure_client_id", preserveRef: true, vaultSecret: true},
		{name: "azure_client_secret", preserveRef: true, vaultSecret: true},
		{name: "azure_tenant_id", preserveRef: true, vaultSecret: true},
		{name: "vertex_project_id", preserveRef: true, vaultSecret: true},
		{name: "vertex_project_number", preserveRef: true, vaultSecret: true},
		{name: "vertex_region", preserveRef: true, vaultSecret: true},
		{name: "vertex_auth_credentials", preserveRef: true, vaultSecret: true},
		{name: "bedrock_access_key", preserveRef: true, vaultSecret: true},
		{name: "bedrock_secret_key", preserveRef: true, vaultSecret: true},
		{name: "bedrock_session_token", preserveRef: true, vaultSecret: true},
		{name: "bedrock_region", preserveRef: true, vaultSecret: true},
		{name: "bedrock_arn", preserveRef: true, vaultSecret: true},
		{name: "bedrock_role_arn", preserveRef: true, vaultSecret: true},
		{name: "bedrock_external_id", preserveRef: true, vaultSecret: true},
		{name: "bedrock_role_session_name", preserveRef: true, vaultSecret: true},
		{name: "bedrock_batch_role_arn", preserveRef: true, vaultSecret: true},
		{name: "bedrock_project_id", preserveRef: true, vaultSecret: true},
		{name: "bedrock_batch_s3_config_json"},
		{name: "bedrock_endpoints_json"},
		{name: "bedrock_mantle_access_key", preserveRef: true, vaultSecret: true},
		{name: "bedrock_mantle_secret_key", preserveRef: true, vaultSecret: true},
		{name: "bedrock_mantle_session_token", preserveRef: true, vaultSecret: true},
		{name: "bedrock_mantle_region", preserveRef: true, vaultSecret: true},
		{name: "bedrock_mantle_role_arn", preserveRef: true, vaultSecret: true},
		{name: "bedrock_mantle_external_id", preserveRef: true, vaultSecret: true},
		{name: "bedrock_mantle_role_session_name", preserveRef: true, vaultSecret: true},
		{name: "bedrock_mantle_project_id", preserveRef: true, vaultSecret: true},
		{name: "bedrock_mantle_endpoints_json"},
		{name: "aliases_json"},
		{name: "vllm_url", preserveRef: true, vaultSecret: true},
		{name: "ollama_url", preserveRef: true, vaultSecret: true},
		{name: "sgl_url", preserveRef: true, vaultSecret: true},
	}, "", "")
}

// encryptPlaintextVirtualKeys finds all governance_virtual_keys rows with plaintext encryption
// status and migrates their encryption-owned columns in batches.
func (s *RDBConfigStore) encryptPlaintextVirtualKeys(ctx context.Context) (int, error) {
	var count int
	for {
		var ids []string
		if err := s.DB().WithContext(ctx).
			Table("governance_virtual_keys").
			Where("(encryption_status = ? OR encryption_status IS NULL OR encryption_status = '') AND value != ''", encryptionStatusPlainText).
			Order("id").
			Limit(encryptionBatchSize).
			Pluck("id", &ids).Error; err != nil {
			return count, err
		}
		if len(ids) == 0 {
			break
		}
		candidateIDs := make([]any, len(ids))
		for i := range ids {
			candidateIDs[i] = ids[i]
		}
		migrated, err := runLegacyEncryptionCandidates(ctx, s.DB(), candidateIDs, func(id any) (bool, error) {
			idString, ok := legacyRawString(id)
			if !ok || idString == "" {
				return false, fmt.Errorf("governance_virtual_keys legacy row has no id")
			}
			return s.encryptLegacyVirtualKeyRow(ctx, idString)
		})
		count += migrated
		if err != nil {
			return count, err
		}
	}
	return count, nil
}

// encryptLegacyVirtualKeyRow mirrors encryptLegacyRawRow while preserving the
// value_hash contract: hashes are derived from resolved plaintext when it is
// available, and an unresolved env/vault reference keeps its existing hash.
func (s *RDBConfigStore) encryptLegacyVirtualKeyRow(ctx context.Context, id string) (bool, error) {
	var migrated bool
	err := s.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []legacyVirtualKeyEncryptionRow
		query := dbForUpdate(tx.WithContext(ctx)).Table("governance_virtual_keys").
			Where("(encryption_status = ? OR encryption_status IS NULL OR encryption_status = '') AND value != ''", encryptionStatusPlainText).
			Where("id = ?", id).
			Limit(1)
		if err := query.Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}

		storedValue, resolved, err := migrateLegacyVirtualKeyValue(rows[0].Value)
		if err != nil {
			return fmt.Errorf("migrate virtual key %s value: %w", id, err)
		}
		if schemas.VaultStoreWriteEnabled() && !isLegacyCiphertext(rows[0].Value) && !schemas.IsSecretRef(rows[0].Value) {
			secret := schemas.SecretVar{Val: rows[0].Value}
			if err := schemas.StoreVaultSecretVar(ctx, schemas.VaultBasePath("governance_virtual_keys", id)+"/value", &secret); err != nil {
				return fmt.Errorf("store virtual key %s in vault: %w", id, err)
			}
			if secret.IsFromSecret() {
				storedValue = secret.GetRawRef()
				resolved = rows[0].Value
			}
		}
		valueHash := rows[0].ValueHash
		if resolved != "" {
			valueHash = encrypt.HashSHA256(resolved)
		}

		// Rewrite only encryption-owned columns. Legacy rows may predate current
		// ownership invariants, which must not block at-rest encryption.
		result := tx.WithContext(ctx).Table("governance_virtual_keys").Where("id = ?", id).Updates(map[string]any{
			"value":             storedValue,
			"value_hash":        valueHash,
			"encryption_status": encryptionStatusEncrypted,
		})
		if result.Error != nil {
			return result.Error
		}
		migrated = result.RowsAffected > 0
		return nil
	})
	return migrated, err
}

// encryptPlaintextSessions migrates sessions through raw rows and recomputes
// token_hash from the decrypted plaintext, even when the status marker was
// missing on a row that already contained ciphertext.
func (s *RDBConfigStore) encryptPlaintextSessions(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "sessions", "token != ''", []legacyRawColumn{
		{name: "token"},
	}, "token_hash", "token")
}

// encryptPlaintextTempTokens mirrors session migration: preserve legacy
// ciphertext and always repair the lookup hash from plaintext.
func (s *RDBConfigStore) encryptPlaintextTempTokens(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "temp_tokens", "token != ''", []legacyRawColumn{
		{name: "token"},
	}, "token_hash", "token")
}

// encryptPlaintextOAuthTokens migrates mcp_oauth_tokens through raw rows so
// access and refresh tokens are probed before being encrypted.
func (s *RDBConfigStore) encryptPlaintextOAuthTokens(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "mcp_oauth_tokens", "", []legacyRawColumn{
		{name: "access_token"},
		{name: "refresh_token"},
	}, "", "")
}

// encryptPlaintextLegacyOAuthTokens covers the deprecated rollback safety-net
// tables. A deployment can legitimately have none of these tables (fresh
// installs) or an older partial shape missing one of the sensitive columns;
// inspect the live schema first and skip incompatible tables rather than
// making startup fail on a compatibility-only artifact. Rows whose marker is
// NULL/empty are intentionally left untouched: without the explicit
// 'plain_text' sentinel, a pre-encryption binary could treat newly-written
// ciphertext as plaintext, which would break the documented rollback path.
func (s *RDBConfigStore) encryptPlaintextLegacyOAuthTokens(ctx context.Context) (int, error) {
	targets := []struct {
		table   string
		columns []legacyRawColumn
	}{
		{
			table: "oauth_tokens",
			columns: []legacyRawColumn{
				{name: "access_token"},
				{name: "refresh_token"},
			},
		},
		{
			table: "oauth_user_tokens",
			columns: []legacyRawColumn{
				{name: "access_token"},
				{name: "refresh_token"},
			},
		},
		{
			table:   "oauth_user_sessions",
			columns: []legacyRawColumn{{name: "code_verifier"}},
		},
	}

	var total int
	for _, target := range targets {
		count, err := s.encryptLegacyCompatibleRawRows(ctx, target.table, target.columns)
		if err != nil {
			return total, fmt.Errorf("%s: %w", target.table, err)
		}
		total += count
	}
	return total, nil
}

func (s *RDBConfigStore) encryptLegacyCompatibleRawRows(ctx context.Context, table string, columns []legacyRawColumn) (int, error) {
	db := s.DB()
	if db == nil {
		return 0, nil
	}
	migrator := db.Migrator()
	if !migrator.HasTable(table) || !migrator.HasColumn(table, "id") || !migrator.HasColumn(table, "encryption_status") {
		return 0, nil
	}

	available := make([]legacyRawColumn, 0, len(columns))
	for _, column := range columns {
		if migrator.HasColumn(table, column.name) {
			available = append(available, column)
		}
	}
	if len(available) == 0 {
		return 0, nil
	}
	return s.encryptLegacyRawRowsStrictPlaintext(ctx, table, "", available, "", "")
}

// encryptPlaintextOAuthConfigs finds all oauth_configs rows with plaintext encryption status
// and re-saves them in batches. The TableOauthConfig.BeforeSave hook handles encryption.
// client_secret is the only sensitive column left on this table — state/
// code_verifier/code_challenge/expires_at moved to mcp_oauth_flows (see that
// migration) and code_verifier was the only one of those that was ever
// encrypted, so the WHERE clause below no longer needs an OR branch for it.
func (s *RDBConfigStore) encryptPlaintextOAuthConfigs(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "oauth_configs", "((client_secret IS NOT NULL AND client_secret != '') OR (client_id IS NOT NULL AND client_id != ''))", []legacyRawColumn{
		{name: "client_id", preserveRef: true, vaultSecret: true, skipEncryption: true},
		{name: "client_secret", preserveRef: true, vaultSecret: true},
	}, "", "")
}

// encryptPlaintextMCPClients finds all config_mcp_clients rows with plaintext encryption
// status and re-saves them in batches. The TableMCPClient.BeforeSave hook handles encryption.
func (s *RDBConfigStore) encryptPlaintextMCPClients(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "config_mcp_clients", "", []legacyRawColumn{
		{name: "connection_string", preserveRef: true, vaultSecret: true},
		{name: "headers_json", vaultJSON: true},
		{name: "pending_oauth_config_json"},
		{name: "token_exchange_json"},
	}, "", "")
}

// encryptPlaintextProviderProxies finds all config_providers rows that have a non-empty
// proxy config with plaintext encryption status and re-saves them in batches. The
// TableProvider.BeforeSave hook handles encryption.
func (s *RDBConfigStore) encryptPlaintextProviderProxies(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "config_providers", "proxy_config_json != '' AND proxy_config_json IS NOT NULL", []legacyRawColumn{
		{name: "proxy_config_json"},
	}, "", "")
}

// encryptPlaintextVectorStoreConfigs finds all config_vector_store rows that have a non-empty
// config with plaintext encryption status and re-saves them in batches. The
// TableVectorStoreConfig.BeforeSave hook handles encryption.
func (s *RDBConfigStore) encryptPlaintextVectorStoreConfigs(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "config_vector_store", "config IS NOT NULL AND config != ''", []legacyRawColumn{
		{name: "config"},
	}, "", "")
}

// encryptPlaintextPlugins finds all config_plugins rows that have a non-empty config with
// plaintext encryption status and re-saves them in batches. The TablePlugin.BeforeSave hook
// handles encryption.
func (s *RDBConfigStore) encryptPlaintextPlugins(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "config_plugins", "config_json != '' AND config_json != '{}'", []legacyRawColumn{
		{name: "config_json"},
	}, "", "")
}

// encryptPlaintextWebhookEndpoints migrates webhook endpoint secrets and
// headers through the same raw-column probe used by the other secret-bearing
// tables. When enterprise Vault hooks are enabled, the SecretVar fields are
// moved to owned vault refs before the headers JSON blob is encrypted.
func (s *RDBConfigStore) encryptPlaintextWebhookEndpoints(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "config_webhook_endpoints", "", []legacyRawColumn{
		{name: "secret", preserveRef: true, vaultSecret: true},
		{name: "headers_json", vaultJSON: true},
	}, "", "")
}

// encryptPlaintextMCPOauthFlows migrates PKCE code verifiers in the active
// OAuth flow table. Raw migration keeps legacy ciphertext idempotent and uses
// the same row-level claim path as the other startup tables.
func (s *RDBConfigStore) encryptPlaintextMCPOauthFlows(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "mcp_oauth_flows", "", []legacyRawColumn{
		{name: "code_verifier"},
	}, "", "")
}

// encryptPlaintextMCPPerUserHeaderCredentials migrates user-supplied MCP
// header values through the row-level raw migration path.
func (s *RDBConfigStore) encryptPlaintextMCPPerUserHeaderCredentials(ctx context.Context) (int, error) {
	return s.encryptLegacyRawRows(ctx, "mcp_per_user_header_credentials", "", []legacyRawColumn{
		{name: "headers_json"},
	}, "", "")
}

// These raw rows intentionally avoid the table models' AfterFind hooks. A
// legacy row may already contain ciphertext while its status marker is empty;
// loading it through the model would either fail JSON decoding (webhook/header
// JSON) or leave an opaque ciphertext that BeforeSave would encrypt again.
type legacyVirtualKeyEncryptionRow struct {
	ID              string  `gorm:"column:id"`
	Value           string  `gorm:"column:value"`
	ValueHash       string  `gorm:"column:value_hash"`
	EncryptionState *string `gorm:"column:encryption_status"`
}

type legacyMCPOauthFlowEncryptionRow struct {
	ID              string  `gorm:"column:id"`
	CodeVerifier    string  `gorm:"column:code_verifier"`
	EncryptionState *string `gorm:"column:encryption_status"`
}

type legacyMCPHeaderCredentialEncryptionRow struct {
	ID              string  `gorm:"column:id"`
	HeadersJSON     string  `gorm:"column:headers_json"`
	EncryptionState *string `gorm:"column:encryption_status"`
}

// migrateLegacyCiphertextString preserves a value when it is already a valid
// ciphertext and encrypts it otherwise. Empty values remain empty. A failed
// decrypt is treated as plaintext because rows selected by the startup pass
// are explicitly marked plaintext or have no marker.
func migrateLegacyCiphertextString(value string) (string, error) {
	return migrateLegacyCiphertextStringWithRef(value, false)
}

func migrateLegacyCiphertextStringWithRef(value string, preserveRef bool) (string, error) {
	if value == "" {
		return value, nil
	}
	if preserveRef && schemas.IsSecretRef(value) {
		return value, nil
	}
	if _, err := encrypt.Decrypt(value); err == nil {
		return value, nil
	}
	return encrypt.Encrypt(value)
}

func migrateLegacyCiphertext(value *string) (*string, error) {
	if value == nil || *value == "" || schemas.IsSecretRef(*value) {
		return value, nil
	}
	migrated, err := migrateLegacyCiphertextString(*value)
	if err != nil {
		return nil, err
	}
	return &migrated, nil
}

// migrateLegacyVirtualKeyValue returns both the value to persist and the
// plaintext used for the lookup hash. Empty legacy status markers can belong
// to rows that were encrypted before the marker was introduced, so probe for
// valid ciphertext before treating the raw column as plaintext.
func migrateLegacyVirtualKeyValue(value string) (storedValue string, plaintext string, err error) {
	if schemas.IsSecretRef(value) {
		secret := schemas.NewSecretVar(value)
		plaintext = secret.GetValue()
		if plaintext == "" {
			// Keep unresolved env/vault references intact. A startup encryption
			// pass must not fail merely because the runtime secret source is not
			// available; the existing value_hash remains the only safe lookup
			// metadata until the reference can be resolved.
			return value, "", nil
		}
		return value, plaintext, nil
	}

	if plaintext, err = encrypt.Decrypt(value); err == nil {
		return value, plaintext, nil
	}

	storedValue, err = encrypt.Encrypt(value)
	if err != nil {
		return "", "", err
	}
	return storedValue, value, nil
}

// encryptPlaintextOAuth2SigningKey migrates the private half of the OAuth2
// signing key when it is stored as a plaintext JSON blob in governance_config.
// Unlike the row-backed secret tables, this value has no GORM hook; the
// OAuth2SigningKey type owns its explicit Encrypt/Decrypt lifecycle instead.
// The row is locked and updated with its original JSON value so two startup
// workers cannot overwrite a concurrent key rotation with stale data.
func (s *RDBConfigStore) encryptPlaintextOAuth2SigningKey(ctx context.Context) (int, error) {
	var migrated bool
	err := s.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var config tables.TableGovernanceConfig
		err := dbForUpdate(tx.WithContext(ctx)).
			Where("key = ?", tables.GovernanceConfigKeyOAuth2SigningKey).
			First(&config).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}

		var key tables.OAuth2SigningKey
		if err := json.Unmarshal([]byte(config.Value), &key); err != nil {
			return fmt.Errorf("unmarshal stored key: %w", err)
		}
		if key.EncryptionStatus == encryptionStatusEncrypted || key.PrivateKeyPEM == "" {
			return nil
		}

		// A legacy row can retain the explicit plain_text marker even after a
		// previous process encrypted the value. Probe first so migration is
		// idempotent and never double-encrypts a valid ciphertext.
		if _, decryptErr := encrypt.Decrypt(key.PrivateKeyPEM); decryptErr == nil {
			key.EncryptionStatus = encryptionStatusEncrypted
		} else if err := key.Encrypt(); err != nil {
			return err
		}
		data, err := json.Marshal(&key)
		if err != nil {
			return fmt.Errorf("marshal migrated key: %w", err)
		}
		result := tx.WithContext(ctx).
			Model(&tables.TableGovernanceConfig{}).
			Where("key = ? AND value = ?", config.Key, config.Value).
			Update("value", string(data))
		if result.Error != nil {
			return result.Error
		}
		migrated = result.RowsAffected > 0
		return nil
	})
	if err != nil {
		return 0, err
	}
	if migrated {
		return 1, nil
	}
	return 0, nil
}
