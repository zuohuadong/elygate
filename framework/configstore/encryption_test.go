package configstore

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const testEncryptionKey = "test-encryption-key-for-testing-32bytes"

func init() {
	encrypt.Init(testEncryptionKey, bifrost.NewDefaultLogger(schemas.LogLevelInfo))
}

// setupEncryptionTestStore creates an in-memory SQLite database with all tables
// migrated and returns an RDBConfigStore for testing the startup encryption pass.
func setupEncryptionTestStore(t *testing.T) (*RDBConfigStore, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)

	err = db.AutoMigrate(
		&tables.TableKey{},
		&tables.TableProvider{},
		&tables.TableMCPClient{},
		&tables.TablePlugin{},
		&tables.TableVirtualKey{},
		&tables.SessionsTable{},
		&tables.TableOauthConfig{},
		&tables.TableMCPOauthToken{},
		&tables.TableVectorStoreConfig{},
		&tables.TableBudget{},
		&tables.TableRateLimit{},
		&tables.TableVirtualKeyProviderConfig{},
		&tables.TableVirtualKeyProviderConfigKey{},
		&tables.TableCustomer{},
		&tables.TableTeam{},
		&tables.TableClientConfig{},
		&tables.TableVirtualKeyMCPConfig{},
		&tables.TableModel{},
		&tables.TempToken{},
		&tables.TableWebhookEndpoint{},
		&tables.TableMCPOauthFlow{},
		&tables.TableMCPPerUserHeaderCredential{},
		&tables.TableGovernanceConfig{},
	)
	require.NoError(t, err)

	store := &RDBConfigStore{logger: bifrost.NewDefaultLogger(schemas.LogLevelInfo)}
	store.db.Store(db)
	store.migrateOnFreshFn = func(ctx context.Context, fn func(context.Context, *gorm.DB) error) error {
		return fn(ctx, store.DB())
	}
	store.refreshPoolFn = func(ctx context.Context) error { return nil }
	return store, db
}

// insertPlaintextRow inserts a row directly into the DB via raw SQL, bypassing GORM hooks,
// so the row has encryption_status='plain_text' and plaintext sensitive data.
func insertPlaintextRow(t *testing.T, db *gorm.DB, sql string, args ...any) {
	t.Helper()
	require.NoError(t, db.Exec(sql, args...).Error)
}

// ============================================================================
// EncryptPlaintextRows — full startup pass
// ============================================================================

func TestEncryptPlaintextRows_EncryptsAllTables(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	future := time.Now().Add(time.Hour).UTC().Format("2006-01-02 15:04:05")

	// Insert plaintext rows across all tables (bypassing hooks)
	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"test-key", 1, "openai", "key-1", "sk-plaintext-key", now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO governance_virtual_keys (id, name, value, is_active, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'plain_text', ?, ?)`,
		"vk-1", "test-vk", "vk-plaintext-value", true, now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO sessions (token, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, 'plain_text', ?, ?, ?)`,
		"session-plaintext-token", future, now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO mcp_oauth_tokens (id, auth_mode, access_token, refresh_token, token_type, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, 'shared', ?, ?, 'Bearer', 'plain_text', ?, ?, ?)`,
		"tok-1", "plaintext-access-token", "plaintext-refresh-token", future, now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO oauth_configs (id, client_secret, redirect_uri, status, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, 'pending', 'plain_text', ?, ?)`,
		"cfg-1", "plaintext-client-secret", "https://example.com/cb", now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO config_mcp_clients (client_id, name, connection_type, connection_string, headers_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, 'sse', ?, ?, 'plain_text', ?, ?)`,
		"mcp-1", "test-mcp", "https://mcp.example.com", `{"Authorization":"Bearer token"}`, now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO config_providers (name, proxy_config_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, 'plain_text', ?, ?)`,
		"openai", `{"url":"https://proxy.example.com"}`, now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO config_vector_store (enabled, type, config, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, 'plain_text', ?, ?)`,
		true, "redis", `{"host":"redis.example.com","password":"secret"}`, now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO config_plugins (name, enabled, config_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, 'plain_text', ?, ?)`,
		"test-plugin", true, `{"api_key":"plugin-secret"}`, now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO config_webhook_endpoints (id, name, url, secret, events_json, headers_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"webhook-1", "test-webhook", "https://receiver.example.com/hook", "webhook-plaintext-secret",
		`["async_job.completed"]`, `{"Authorization":"Bearer webhook-token"}`, now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO mcp_oauth_flows (id, mcp_client_id, oauth_config_id, state, redirect_uri, code_verifier, flow_mode, status, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plain_text', ?, ?, ?)`,
		"flow-1", "mcp-1", "oauth-1", "state-1", "https://receiver.example.com/callback", "pkce-plaintext-verifier", "user", "pending", future, now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO mcp_per_user_header_credentials (id, mcp_client_id, auth_mode, status, headers_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"cred-1", "mcp-1", "user", "active", `{"Authorization":"Bearer user-token"}`, now, now)

	// Run the startup encryption pass
	err := store.EncryptPlaintextRows(ctx)
	require.NoError(t, err)

	// Verify all rows are now encrypted in raw DB
	var keyRow map[string]any
	db.Table("config_keys").Where("name = ?", "test-key").Take(&keyRow)
	assert.Equal(t, "encrypted", keyRow["encryption_status"])
	assert.NotEqual(t, "sk-plaintext-key", keyRow["value"])

	var vkRow map[string]any
	db.Table("governance_virtual_keys").Where("id = ?", "vk-1").Take(&vkRow)
	assert.Equal(t, "encrypted", vkRow["encryption_status"])
	assert.NotEqual(t, "vk-plaintext-value", vkRow["value"])

	var sessionRow map[string]any
	db.Table("sessions").Take(&sessionRow)
	assert.Equal(t, "encrypted", sessionRow["encryption_status"])
	assert.NotEqual(t, "session-plaintext-token", sessionRow["token"])

	var tokRow map[string]any
	db.Table("mcp_oauth_tokens").Where("id = ?", "tok-1").Take(&tokRow)
	assert.Equal(t, "encrypted", tokRow["encryption_status"])
	assert.NotEqual(t, "plaintext-access-token", tokRow["access_token"])

	var cfgRow map[string]any
	db.Table("oauth_configs").Where("id = ?", "cfg-1").Take(&cfgRow)
	assert.Equal(t, "encrypted", cfgRow["encryption_status"])
	assert.NotEqual(t, "plaintext-client-secret", cfgRow["client_secret"])

	var mcpRow map[string]any
	db.Table("config_mcp_clients").Where("client_id = ?", "mcp-1").Take(&mcpRow)
	assert.Equal(t, "encrypted", mcpRow["encryption_status"])

	var providerRow map[string]any
	db.Table("config_providers").Where("name = ?", "openai").Take(&providerRow)
	assert.Equal(t, "encrypted", providerRow["encryption_status"])

	var vsRow map[string]any
	db.Table("config_vector_store").Take(&vsRow)
	assert.Equal(t, "encrypted", vsRow["encryption_status"])

	var pluginRow map[string]any
	db.Table("config_plugins").Where("name = ?", "test-plugin").Take(&pluginRow)
	assert.Equal(t, "encrypted", pluginRow["encryption_status"])

	var webhookRow map[string]any
	db.Table("config_webhook_endpoints").Where("id = ?", "webhook-1").Take(&webhookRow)
	assert.Equal(t, "encrypted", webhookRow["encryption_status"])
	assert.NotEqual(t, "webhook-plaintext-secret", webhookRow["secret"])
	assert.NotEqual(t, `{"Authorization":"Bearer webhook-token"}`, webhookRow["headers_json"])

	var webhook tables.TableWebhookEndpoint
	require.NoError(t, db.Where("id = ?", "webhook-1").First(&webhook).Error)
	require.NotNil(t, webhook.Secret)
	assert.Equal(t, "webhook-plaintext-secret", webhook.Secret.GetValue())
	authorizationHeader := webhook.Headers["Authorization"]
	assert.Equal(t, "Bearer webhook-token", authorizationHeader.GetValue())

	var flowRow map[string]any
	db.Table("mcp_oauth_flows").Where("id = ?", "flow-1").Take(&flowRow)
	assert.Equal(t, "encrypted", flowRow["encryption_status"])
	assert.NotEqual(t, "pkce-plaintext-verifier", flowRow["code_verifier"])
	var flow tables.TableMCPOauthFlow
	require.NoError(t, db.Where("id = ?", "flow-1").First(&flow).Error)
	assert.Equal(t, "pkce-plaintext-verifier", flow.CodeVerifier)

	var credentialRow map[string]any
	db.Table("mcp_per_user_header_credentials").Where("id = ?", "cred-1").Take(&credentialRow)
	assert.Equal(t, "encrypted", credentialRow["encryption_status"])
	assert.NotEqual(t, `{"Authorization":"Bearer user-token"}`, credentialRow["headers_json"])
	var credential tables.TableMCPPerUserHeaderCredential
	require.NoError(t, db.Where("id = ?", "cred-1").First(&credential).Error)
	headers, err := credential.GetHeaders()
	require.NoError(t, err)
	assert.Equal(t, "Bearer user-token", headers["Authorization"])
}

func TestEncryptPlaintextRows_WebhookLegacyCiphertextWithoutStatus(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	secretCiphertext, err := encrypt.Encrypt("legacy-webhook-secret")
	require.NoError(t, err)
	headersCiphertext, err := encrypt.Encrypt(`{"Authorization":"Bearer legacy-webhook-token"}`)
	require.NoError(t, err)

	insertPlaintextRow(t, db,
		`INSERT INTO config_webhook_endpoints (id, name, url, secret, events_json, headers_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
		"webhook-legacy-cipher", "legacy-webhook", "https://receiver.example.com/hook", secretCiphertext,
		`["async_job.completed"]`, headersCiphertext, now, now)

	require.NoError(t, store.EncryptPlaintextRows(ctx))

	var raw map[string]any
	require.NoError(t, db.Table("config_webhook_endpoints").Where("id = ?", "webhook-legacy-cipher").Take(&raw).Error)
	assert.Equal(t, secretCiphertext, raw["secret"], "legacy webhook secret must not be double-encrypted")
	assert.Equal(t, headersCiphertext, raw["headers_json"], "legacy webhook headers must not be double-encrypted")
	assert.Equal(t, encryptionStatusEncrypted, raw["encryption_status"])

	var endpoint tables.TableWebhookEndpoint
	require.NoError(t, db.First(&endpoint, "id = ?", "webhook-legacy-cipher").Error)
	require.NotNil(t, endpoint.Secret)
	assert.Equal(t, "legacy-webhook-secret", endpoint.Secret.GetValue())
	authorizationHeader := endpoint.Headers["Authorization"]
	assert.Equal(t, "Bearer legacy-webhook-token", authorizationHeader.GetValue())
}

func TestEncryptPlaintextRows_MCPOAuthFlowLegacyCiphertextWithoutStatus(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	future := time.Now().Add(time.Hour).UTC().Format("2006-01-02 15:04:05")
	ciphertext, err := encrypt.Encrypt("legacy-pkce-verifier")
	require.NoError(t, err)

	insertPlaintextRow(t, db,
		`INSERT INTO mcp_oauth_flows (id, mcp_client_id, oauth_config_id, state, redirect_uri, code_verifier, flow_mode, status, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
		"flow-legacy-cipher", "mcp-legacy", "oauth-legacy", "state-legacy", "https://receiver.example.com/callback", ciphertext, "user", "pending", future, now, now)

	require.NoError(t, store.EncryptPlaintextRows(ctx))

	var raw map[string]any
	require.NoError(t, db.Table("mcp_oauth_flows").Where("id = ?", "flow-legacy-cipher").Take(&raw).Error)
	assert.Equal(t, ciphertext, raw["code_verifier"], "legacy PKCE verifier must not be double-encrypted")
	assert.Equal(t, encryptionStatusEncrypted, raw["encryption_status"])

	var flow tables.TableMCPOauthFlow
	require.NoError(t, db.First(&flow, "id = ?", "flow-legacy-cipher").Error)
	assert.Equal(t, "legacy-pkce-verifier", flow.CodeVerifier)
}

func TestEncryptPlaintextRows_MCPHeaderCredentialLegacyCiphertextWithoutStatus(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	ciphertext, err := encrypt.Encrypt(`{"Authorization":"Bearer legacy-user-token"}`)
	require.NoError(t, err)

	insertPlaintextRow(t, db,
		`INSERT INTO mcp_per_user_header_credentials (id, mcp_client_id, auth_mode, status, headers_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
		"credential-legacy-cipher", "mcp-legacy", "user", "active", ciphertext, now, now)

	require.NoError(t, store.EncryptPlaintextRows(ctx))

	var raw map[string]any
	require.NoError(t, db.Table("mcp_per_user_header_credentials").Where("id = ?", "credential-legacy-cipher").Take(&raw).Error)
	assert.Equal(t, ciphertext, raw["headers_json"], "legacy MCP headers must not be double-encrypted")
	assert.Equal(t, encryptionStatusEncrypted, raw["encryption_status"])

	var credential tables.TableMCPPerUserHeaderCredential
	require.NoError(t, db.First(&credential, "id = ?", "credential-legacy-cipher").Error)
	headers, err := credential.GetHeaders()
	require.NoError(t, err)
	assert.Equal(t, "Bearer legacy-user-token", headers["Authorization"])
}

func TestEncryptPlaintextRows_EncryptsOAuth2SigningKey(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()

	plaintext := "-----BEGIN PRIVATE KEY-----\nlegacy-signing-key\n-----END PRIVATE KEY-----"
	data, err := json.Marshal(tables.OAuth2SigningKey{
		KID:              "legacy-kid",
		PrivateKeyPEM:    plaintext,
		PublicKeyPEM:     "public-key",
		EncryptionStatus: tables.EncryptionStatusPlainText,
	})
	require.NoError(t, err)
	insertPlaintextRow(t, db,
		`INSERT INTO governance_config (key, value) VALUES (?, ?)`,
		tables.GovernanceConfigKeyOAuth2SigningKey, string(data))

	require.NoError(t, store.EncryptPlaintextRows(ctx))

	var row tables.TableGovernanceConfig
	require.NoError(t, db.First(&row, "key = ?", tables.GovernanceConfigKeyOAuth2SigningKey).Error)
	assert.NotContains(t, row.Value, plaintext)

	var persisted tables.OAuth2SigningKey
	require.NoError(t, json.Unmarshal([]byte(row.Value), &persisted))
	assert.Equal(t, tables.EncryptionStatusEncrypted, persisted.EncryptionStatus)

	loaded, err := store.GetOAuth2SigningKey(ctx)
	require.NoError(t, err)
	assert.Equal(t, plaintext, loaded.PrivateKeyPEM)

	// The second startup pass must be idempotent and must not re-encrypt the
	// already-encrypted JSON blob.
	before := row.Value
	require.NoError(t, store.EncryptPlaintextRows(ctx))
	var after tables.TableGovernanceConfig
	require.NoError(t, db.First(&after, "key = ?", tables.GovernanceConfigKeyOAuth2SigningKey).Error)
	assert.Equal(t, before, after.Value)
}

func TestEncryptPlaintextRows_MarksLegacyEncryptedOAuth2SigningKeyWithoutDoubleEncrypting(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()

	plaintext := "-----BEGIN PRIVATE KEY-----\nlegacy-encrypted-signing-key\n-----END PRIVATE KEY-----"
	ciphertext, err := encrypt.Encrypt(plaintext)
	require.NoError(t, err)
	data, err := json.Marshal(tables.OAuth2SigningKey{
		KID:           "legacy-cipher-kid",
		PrivateKeyPEM: ciphertext,
		PublicKeyPEM:  "public-key",
		// Empty status models rows written before the explicit marker existed.
	})
	require.NoError(t, err)
	insertPlaintextRow(t, db,
		`INSERT INTO governance_config (key, value) VALUES (?, ?)`,
		tables.GovernanceConfigKeyOAuth2SigningKey, string(data))

	require.NoError(t, store.EncryptPlaintextRows(ctx))

	var row tables.TableGovernanceConfig
	require.NoError(t, db.First(&row, "key = ?", tables.GovernanceConfigKeyOAuth2SigningKey).Error)
	var persisted tables.OAuth2SigningKey
	require.NoError(t, json.Unmarshal([]byte(row.Value), &persisted))
	assert.Equal(t, ciphertext, persisted.PrivateKeyPEM, "legacy ciphertext must not be encrypted again")
	assert.Equal(t, tables.EncryptionStatusEncrypted, persisted.EncryptionStatus)

	loaded, err := store.GetOAuth2SigningKey(ctx)
	require.NoError(t, err)
	assert.Equal(t, plaintext, loaded.PrivateKeyPEM)
}

func TestEncryptPlaintextRows_PreservesCiphertextWithExplicitPlaintextMarker(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()

	plaintext := "-----BEGIN PRIVATE KEY-----\nexplicit-plaintext-marker\n-----END PRIVATE KEY-----"
	ciphertext, err := encrypt.Encrypt(plaintext)
	require.NoError(t, err)
	data, err := json.Marshal(tables.OAuth2SigningKey{
		KID:              "explicit-plaintext-marker-kid",
		PrivateKeyPEM:    ciphertext,
		PublicKeyPEM:     "public-key",
		EncryptionStatus: tables.EncryptionStatusPlainText,
	})
	require.NoError(t, err)
	insertPlaintextRow(t, db,
		`INSERT INTO governance_config (key, value) VALUES (?, ?)`,
		tables.GovernanceConfigKeyOAuth2SigningKey, string(data))

	require.NoError(t, store.EncryptPlaintextRows(ctx))

	var row tables.TableGovernanceConfig
	require.NoError(t, db.First(&row, "key = ?", tables.GovernanceConfigKeyOAuth2SigningKey).Error)
	var persisted tables.OAuth2SigningKey
	require.NoError(t, json.Unmarshal([]byte(row.Value), &persisted))
	assert.Equal(t, ciphertext, persisted.PrivateKeyPEM, "valid ciphertext must not be double-encrypted")
	assert.Equal(t, tables.EncryptionStatusEncrypted, persisted.EncryptionStatus)

	loaded, err := store.GetOAuth2SigningKey(ctx)
	require.NoError(t, err)
	assert.Equal(t, plaintext, loaded.PrivateKeyPEM)
}

func TestEncryptPlaintextRows_SkipsAlreadyEncrypted(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()

	// Create a key through the normal GORM path (which encrypts via hooks)
	key := &tables.TableKey{
		Name:       "already-encrypted",
		ProviderID: 1,
		Provider:   "openai",
		KeyID:      "enc-key-1",
		Value:      *schemas.NewSecretVar("sk-secret"),
	}
	require.NoError(t, db.Create(key).Error)

	// Grab the encrypted value from DB
	var rawBefore map[string]any
	db.Table("config_keys").Where("id = ?", key.ID).Take(&rawBefore)
	encryptedBefore := rawBefore["value"]

	// Run the startup pass
	err := store.EncryptPlaintextRows(ctx)
	require.NoError(t, err)

	// The encrypted value should not have changed (not double-encrypted)
	var rawAfter map[string]any
	db.Table("config_keys").Where("id = ?", key.ID).Take(&rawAfter)
	assert.Equal(t, encryptedBefore, rawAfter["value"])
}

func TestEncryptPlaintextRows_Idempotent(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"idempotent-key", 1, "openai", "idem-1", "sk-plaintext", now, now)

	// Run twice
	err := store.EncryptPlaintextRows(ctx)
	require.NoError(t, err)

	err = store.EncryptPlaintextRows(ctx)
	require.NoError(t, err)

	// Should still be readable via GORM hooks
	var found tables.TableKey
	require.NoError(t, db.Where("name = ?", "idempotent-key").First(&found).Error)
	assert.Equal(t, "sk-plaintext", found.Value.GetValue())
}

func TestEncryptPlaintextRows_HandlesNullEncryptionStatus(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// Insert with NULL encryption_status (legacy row)
	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
		"null-status-key", 1, "openai", "null-1", "sk-null-status", now, now)

	// Insert with empty encryption_status
	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
		"empty-status-key", 1, "openai", "empty-1", "sk-empty-status", now, now)

	err := store.EncryptPlaintextRows(ctx)
	require.NoError(t, err)

	// Both should be encrypted now
	var row1 map[string]any
	db.Table("config_keys").Where("name = ?", "null-status-key").Take(&row1)
	assert.Equal(t, "encrypted", row1["encryption_status"])

	var row2 map[string]any
	db.Table("config_keys").Where("name = ?", "empty-status-key").Take(&row2)
	assert.Equal(t, "encrypted", row2["encryption_status"])
}

// Legacy databases can contain ciphertext written before encryption_status was
// introduced (or after a partial migration left it empty). The startup pass
// must probe raw values before writing so it neither double-encrypts them nor
// loses lookup hashes for session-like credentials.
func TestEncryptPlaintextRows_PreservesLegacyCiphertextWithoutStatus(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	future := time.Now().Add(time.Hour).UTC().Format("2006-01-02 15:04:05")
	encrypted := func(plaintext string) string {
		value, err := encrypt.Encrypt(plaintext)
		require.NoError(t, err)
		return value
	}

	keyCiphertext := encrypted("legacy-key-secret")
	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
		"legacy-cipher-key", 1, "openai", "legacy-cipher-key-id", keyCiphertext, now, now)

	sessionCiphertext := encrypted("legacy-session-token")
	insertPlaintextRow(t, db,
		`INSERT INTO sessions (token, token_hash, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, ?, NULL, ?, ?, ?)`,
		sessionCiphertext, "stale-session-hash", future, now, now)

	tempTokenCiphertext := encrypted("legacy-temp-token")
	insertPlaintextRow(t, db,
		`INSERT INTO temp_tokens (id, token, token_hash, scope, resource_id, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)`,
		"legacy-cipher-temp", tempTokenCiphertext, "stale-temp-hash", "mcp_auth", "resource-1", future, now, now)

	accessCiphertext := encrypted("legacy-access-token")
	refreshCiphertext := encrypted("legacy-refresh-token")
	insertPlaintextRow(t, db,
		`INSERT INTO mcp_oauth_tokens (id, auth_mode, access_token, refresh_token, token_type, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, 'shared', ?, ?, 'Bearer', NULL, ?, ?, ?)`,
		"legacy-cipher-oauth-token", accessCiphertext, refreshCiphertext, future, now, now)

	clientSecretCiphertext := encrypted("legacy-client-secret")
	insertPlaintextRow(t, db,
		`INSERT INTO oauth_configs (id, client_secret, redirect_uri, status, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, 'pending', '', ?, ?)`,
		"legacy-cipher-oauth-config", clientSecretCiphertext, "https://example.com/callback", now, now)

	connectionCiphertext := encrypted("https://legacy-mcp.example.com/sse")
	headerCiphertext := encrypted(`{"Authorization":"Bearer legacy-mcp-token"}`)
	pendingOAuthCiphertext := encrypted(`{"client_secret":"legacy-pending-secret"}`)
	tokenExchangeCiphertext := encrypted(`{"client_secret":"legacy-exchange-secret"}`)
	insertPlaintextRow(t, db,
		`INSERT INTO config_mcp_clients (client_id, name, connection_type, connection_string, headers_json, pending_oauth_config_json, token_exchange_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, 'sse', ?, ?, ?, ?, NULL, ?, ?)`,
		"legacy-cipher-mcp", "legacy-cipher-mcp", connectionCiphertext, headerCiphertext, pendingOAuthCiphertext, tokenExchangeCiphertext, now, now)

	providerCiphertext := encrypted(`{"url":"https://legacy-proxy.example.com","password":"legacy-proxy-secret"}`)
	insertPlaintextRow(t, db,
		`INSERT INTO config_providers (name, proxy_config_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, NULL, ?, ?)`,
		"legacy-cipher-provider", providerCiphertext, now, now)

	vectorCiphertext := encrypted(`{"host":"legacy-vector.example.com","password":"legacy-vector-secret"}`)
	insertPlaintextRow(t, db,
		`INSERT INTO config_vector_store (enabled, type, config, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, '', ?, ?)`,
		true, "redis", vectorCiphertext, now, now)

	pluginCiphertext := encrypted(`{"api_key":"legacy-plugin-secret"}`)
	insertPlaintextRow(t, db,
		`INSERT INTO config_plugins (name, enabled, version, config_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, 1, ?, NULL, ?, ?)`,
		"legacy-cipher-plugin", true, pluginCiphertext, now, now)

	require.NoError(t, store.EncryptPlaintextRows(ctx))

	assertRaw := func(table, key, column, expected string) {
		t.Helper()
		var row map[string]any
		require.NoError(t, db.Table(table).Where(key).Take(&row).Error)
		assert.Equal(t, expected, row[column], "%s.%s must not be double-encrypted", table, column)
		assert.Equal(t, encryptionStatusEncrypted, row["encryption_status"], "%s status", table)
	}
	assertRaw("config_keys", "name = 'legacy-cipher-key'", "value", keyCiphertext)
	assertRaw("sessions", "token_hash = '"+encrypt.HashSHA256("legacy-session-token")+"'", "token", sessionCiphertext)
	assertRaw("temp_tokens", "id = 'legacy-cipher-temp'", "token", tempTokenCiphertext)
	assertRaw("mcp_oauth_tokens", "id = 'legacy-cipher-oauth-token'", "access_token", accessCiphertext)
	assertRaw("oauth_configs", "id = 'legacy-cipher-oauth-config'", "client_secret", clientSecretCiphertext)
	assertRaw("config_mcp_clients", "client_id = 'legacy-cipher-mcp'", "connection_string", connectionCiphertext)
	assertRaw("config_providers", "name = 'legacy-cipher-provider'", "proxy_config_json", providerCiphertext)
	assertRaw("config_vector_store", "type = 'redis'", "config", vectorCiphertext)
	assertRaw("config_plugins", "name = 'legacy-cipher-plugin'", "config_json", pluginCiphertext)

	var sessionRow struct {
		Token     string
		TokenHash string
	}
	require.NoError(t, db.Table("sessions").Where("id = 1").Take(&sessionRow).Error)
	assert.Equal(t, encrypt.HashSHA256("legacy-session-token"), sessionRow.TokenHash)

	var session tables.SessionsTable
	require.NoError(t, db.First(&session, "id = 1").Error)
	assert.Equal(t, "legacy-session-token", session.Token)
	var temp tables.TempToken
	require.NoError(t, db.First(&temp, "id = ?", "legacy-cipher-temp").Error)
	assert.Equal(t, "legacy-temp-token", temp.Token)
	assert.Equal(t, encrypt.HashSHA256("legacy-temp-token"), temp.TokenHash)
	var key tables.TableKey
	require.NoError(t, db.First(&key, "name = ?", "legacy-cipher-key").Error)
	assert.Equal(t, "legacy-key-secret", key.Value.GetValue())
	var oauthToken tables.TableMCPOauthToken
	require.NoError(t, db.First(&oauthToken, "id = ?", "legacy-cipher-oauth-token").Error)
	assert.Equal(t, "legacy-access-token", oauthToken.AccessToken)
	assert.Equal(t, "legacy-refresh-token", oauthToken.RefreshToken)
	var oauthConfig tables.TableOauthConfig
	require.NoError(t, db.First(&oauthConfig, "id = ?", "legacy-cipher-oauth-config").Error)
	assert.Equal(t, "legacy-client-secret", oauthConfig.ClientSecret.GetValue())
	var mcpClient tables.TableMCPClient
	require.NoError(t, db.First(&mcpClient, "client_id = ?", "legacy-cipher-mcp").Error)
	assert.Equal(t, "https://legacy-mcp.example.com/sse", mcpClient.ConnectionString.GetValue())
	authorizationHeader := mcpClient.Headers["Authorization"]
	assert.Equal(t, "Bearer legacy-mcp-token", authorizationHeader.GetValue())
	var provider tables.TableProvider
	require.NoError(t, db.First(&provider, "name = ?", "legacy-cipher-provider").Error)
	require.NotNil(t, provider.ProxyConfig)
	assert.Equal(t, "legacy-proxy-secret", provider.ProxyConfig.Password.GetValue())
	var vector tables.TableVectorStoreConfig
	require.NoError(t, db.First(&vector, "type = ?", "redis").Error)
	require.NotNil(t, vector.Config)
	assert.Contains(t, *vector.Config, "legacy-vector-secret")
	var plugin tables.TablePlugin
	require.NoError(t, db.First(&plugin, "name = ?", "legacy-cipher-plugin").Error)
	assert.Contains(t, plugin.ConfigJSON, "legacy-plugin-secret")
}

func TestEncryptPlaintextRows_EncryptsWhitespaceSensitiveValues(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	const plaintext = "   "
	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"whitespace-key", 1, "openai", "whitespace-key-id", plaintext, now, now)

	count, err := store.encryptPlaintextKeys(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	var stored string
	require.NoError(t, db.Table("config_keys").Select("value").Where("key_id = ?", "whitespace-key-id").Scan(&stored).Error)
	assert.NotEqual(t, plaintext, stored, "whitespace must not be treated as an empty value")
	decrypted, err := encrypt.Decrypt(stored)
	require.NoError(t, err)
	assert.Equal(t, plaintext, decrypted)
}

func TestEncryptPlaintextRows_PreservesUnresolvedVirtualKeyReferenceHash(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	const valueRef = "env.ELYGATE_MISSING_VIRTUAL_KEY"
	const valueHash = "legacy-unresolved-value-hash"
	insertPlaintextRow(t, db,
		`INSERT INTO governance_virtual_keys (id, name, value, value_hash, is_active, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
		"unresolved-ref-vk", "unresolved-ref-vk", valueRef, valueHash, true, now, now)

	require.NoError(t, store.EncryptPlaintextRows(context.Background()))
	var raw struct {
		Value            string
		ValueHash        string
		EncryptionStatus string
	}
	require.NoError(t, db.Table("governance_virtual_keys").Where("id = ?", "unresolved-ref-vk").Take(&raw).Error)
	assert.Equal(t, valueRef, raw.Value)
	assert.Equal(t, valueHash, raw.ValueHash)
	assert.Equal(t, encryptionStatusEncrypted, raw.EncryptionStatus)
}

func TestEncryptPlaintextRows_PreservesVaultStoreContract(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	stored, _ := stubVaultHooks(t)
	encrypt.Init(testEncryptionKey, bifrost.NewDefaultLogger(schemas.LogLevelInfo))
	t.Cleanup(func() { encrypt.Init(testEncryptionKey, bifrost.NewDefaultLogger(schemas.LogLevelInfo)) })
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"vault-contract-key", 1, "openai", "vault-contract-key-id", "vault-key-secret", now, now)
	insertPlaintextRow(t, db,
		`INSERT INTO governance_virtual_keys (id, name, value, is_active, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'plain_text', ?, ?)`,
		"vault-contract-vk", "vault-contract-vk", "vault-vk-secret", true, now, now)
	insertPlaintextRow(t, db,
		`INSERT INTO oauth_configs (id, client_secret, redirect_uri, status, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, 'pending', 'plain_text', ?, ?)`,
		"vault-contract-oauth", "vault-oauth-secret", "https://example.com/callback", now, now)
	insertPlaintextRow(t, db,
		`INSERT INTO config_mcp_clients (client_id, name, connection_type, connection_string, headers_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, 'sse', ?, ?, 'plain_text', ?, ?)`,
		"vault-contract-mcp", "vault-contract-mcp", "https://mcp.example.com/sse", `{"Authorization":"Bearer mcp-secret"}`, now, now)

	require.NoError(t, store.EncryptPlaintextRows(context.Background()))

	keyPath := "bifrost/config_keys/vault-contract-key-id/value"
	vkPath := "bifrost/governance_virtual_keys/vault-contract-vk/value"
	oauthPath := "bifrost/oauth_configs/vault-contract-oauth/client_secret"
	mcpConnectionPath := "bifrost/config_mcp_clients/vault-contract-mcp/connection_string"
	mcpHeaderPath := "bifrost/config_mcp_clients/vault-contract-mcp/headers/Authorization"
	assert.Equal(t, "vault-key-secret", stored[keyPath])
	assert.Equal(t, "vault-vk-secret", stored[vkPath])
	assert.Equal(t, "vault-oauth-secret", stored[oauthPath])
	assert.Equal(t, "https://mcp.example.com/sse", stored[mcpConnectionPath])
	assert.Equal(t, "Bearer mcp-secret", stored[mcpHeaderPath])

	var rawKey struct {
		Value            string
		EncryptionStatus string
	}
	require.NoError(t, db.Table("config_keys").Where("key_id = ?", "vault-contract-key-id").Take(&rawKey).Error)
	assert.Equal(t, "vault."+keyPath, rawKey.Value)
	assert.Equal(t, encryptionStatusEncrypted, rawKey.EncryptionStatus)

	var rawVK struct {
		Value            string
		ValueHash        string
		EncryptionStatus string
	}
	require.NoError(t, db.Table("governance_virtual_keys").Where("id = ?", "vault-contract-vk").Take(&rawVK).Error)
	assert.Equal(t, "vault."+vkPath, rawVK.Value)
	assert.Equal(t, encrypt.HashSHA256("vault-vk-secret"), rawVK.ValueHash)
	assert.Equal(t, encryptionStatusEncrypted, rawVK.EncryptionStatus)

	var rawOAuth struct {
		ClientSecret     string
		EncryptionStatus string
	}
	require.NoError(t, db.Table("oauth_configs").Where("id = ?", "vault-contract-oauth").Take(&rawOAuth).Error)
	assert.Equal(t, "vault."+oauthPath, rawOAuth.ClientSecret)
	assert.Equal(t, encryptionStatusEncrypted, rawOAuth.EncryptionStatus)

	var rawMCP struct {
		ConnectionString string
		HeadersJSON      string
		EncryptionStatus string
	}
	require.NoError(t, db.Table("config_mcp_clients").Where("client_id = ?", "vault-contract-mcp").Take(&rawMCP).Error)
	assert.Equal(t, "vault."+mcpConnectionPath, rawMCP.ConnectionString)
	decryptedHeaders, err := encrypt.Decrypt(rawMCP.HeadersJSON)
	require.NoError(t, err)
	var headers map[string]string
	require.NoError(t, json.Unmarshal([]byte(decryptedHeaders), &headers))
	assert.Equal(t, "vault."+mcpHeaderPath, headers["Authorization"])
	assert.Equal(t, encryptionStatusEncrypted, rawMCP.EncryptionStatus)
}

func TestEncryptPlaintextRows_EncryptsLegacyOAuthSafetyNetTables(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	require.NoError(t, db.AutoMigrate(
		&tables.TableOauthToken{},
		&tables.TableOauthUserToken{},
		&tables.TableOauthUserSession{},
	))

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	future := time.Now().Add(time.Hour).UTC().Format("2006-01-02 15:04:05")
	insertPlaintextRow(t, db,
		`INSERT INTO oauth_tokens (id, access_token, refresh_token, token_type, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'plain_text', ?, ?)`,
		"legacy-shared-token", "legacy-shared-access", "legacy-shared-refresh", "Bearer", now, now)
	insertPlaintextRow(t, db,
		`INSERT INTO oauth_user_tokens (id, mcp_client_id, auth_mode, status, oauth_config_id, access_token, refresh_token, token_type, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"legacy-user-token", "legacy-mcp", "user", "active", "legacy-oauth", "legacy-user-access", "legacy-user-refresh", "Bearer", now, now)
	insertPlaintextRow(t, db,
		`INSERT INTO oauth_tokens (id, access_token, refresh_token, token_type, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, NULL, ?, ?)`,
		"legacy-shared-missing-marker", "legacy-missing-access", "legacy-missing-refresh", "Bearer", now, now)
	insertPlaintextRow(t, db,
		`INSERT INTO oauth_user_sessions (id, mcp_client_id, oauth_config_id, state, redirect_uri, code_verifier, flow_mode, status, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plain_text', ?, ?, ?)`,
		"legacy-user-flow", "legacy-mcp", "legacy-oauth", "legacy-state", "https://example.com/callback", "legacy-code-verifier", "user", "pending", future, now, now)

	count, err := store.encryptPlaintextLegacyOAuthTokens(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 3, count)

	assertLegacyEncrypted := func(table, id string, columns ...string) {
		t.Helper()
		var row map[string]any
		require.NoError(t, db.Table(table).Where("id = ?", id).Take(&row).Error)
		assert.Equal(t, encryptionStatusEncrypted, row["encryption_status"])
		for _, column := range columns {
			assert.NotEqual(t, "", row[column])
		}
	}
	assertLegacyEncrypted("oauth_tokens", "legacy-shared-token", "access_token", "refresh_token")
	assertLegacyEncrypted("oauth_user_tokens", "legacy-user-token", "access_token", "refresh_token")
	assertLegacyEncrypted("oauth_user_sessions", "legacy-user-flow", "code_verifier")
	var skipped map[string]any
	require.NoError(t, db.Table("oauth_tokens").Where("id = ?", "legacy-shared-missing-marker").Take(&skipped).Error)
	assert.Nil(t, skipped["encryption_status"])
	assert.Equal(t, "legacy-missing-access", skipped["access_token"])
	assert.Equal(t, "legacy-missing-refresh", skipped["refresh_token"])

	var shared tables.TableOauthToken
	require.NoError(t, db.First(&shared, "id = ?", "legacy-shared-token").Error)
	assert.Equal(t, "legacy-shared-access", shared.AccessToken)
	assert.Equal(t, "legacy-shared-refresh", shared.RefreshToken)
	var userToken tables.TableOauthUserToken
	require.NoError(t, db.First(&userToken, "id = ?", "legacy-user-token").Error)
	assert.Equal(t, "legacy-user-access", userToken.AccessToken)
	assert.Equal(t, "legacy-user-refresh", userToken.RefreshToken)
	var flow tables.TableOauthUserSession
	require.NoError(t, db.First(&flow, "id = ?", "legacy-user-flow").Error)
	assert.Equal(t, "legacy-code-verifier", flow.CodeVerifier)
}

func TestEncryptPlaintextRows_SkipsIncompleteLegacyOAuthSafetyNetTables(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	// A pre-encryption rollback schema may have the legacy table but no status
	// marker; encrypting it would make an older binary read ciphertext as
	// plaintext. Another partial schema may have only the marker and no secret
	// columns. Both shapes must be ignored safely.
	insertPlaintextRow(t, db,
		`CREATE TABLE oauth_tokens (id TEXT PRIMARY KEY, access_token TEXT, refresh_token TEXT)`)
	insertPlaintextRow(t, db,
		`INSERT INTO oauth_tokens (id, access_token, refresh_token) VALUES (?, ?, ?)`,
		"legacy-no-status", "legacy-access", "legacy-refresh")
	insertPlaintextRow(t, db,
		`CREATE TABLE oauth_user_tokens (id TEXT PRIMARY KEY, encryption_status TEXT)`)

	_, err := store.encryptPlaintextLegacyOAuthTokens(context.Background())
	require.NoError(t, err)
	var row map[string]any
	require.NoError(t, db.Table("oauth_tokens").Where("id = ?", "legacy-no-status").Take(&row).Error)
	assert.Equal(t, "legacy-access", row["access_token"])
	assert.Equal(t, "legacy-refresh", row["refresh_token"])
}

func TestEncryptPlaintextKeys_CommitsRowsIndividuallyWhenVaultFails(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	prevStore, prevRemove := schemas.VaultStoreHook, schemas.VaultRemoveHook
	var calls int
	schemas.VaultStoreHook = func(_ context.Context, path string, value *string) error {
		calls++
		if calls == 2 {
			return fmt.Errorf("vault unavailable")
		}
		*value = "vault." + path
		return nil
	}
	schemas.VaultRemoveHook = func(_ context.Context, _ string) error { return nil }
	t.Cleanup(func() {
		schemas.VaultStoreHook = prevStore
		schemas.VaultRemoveHook = prevRemove
	})

	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"vault-row-1", 1, "openai", "vault-row-1-id", "first-secret", now, now)
	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"vault-row-2", 1, "openai", "vault-row-2-id", "second-secret", now, now)

	count, err := store.encryptPlaintextKeys(context.Background())
	require.Error(t, err)
	assert.Equal(t, 1, count, "a failed row must not roll back a previously committed row")

	var first, second struct {
		Value            string
		EncryptionStatus string
	}
	require.NoError(t, db.Table("config_keys").Where("key_id = ?", "vault-row-1-id").Take(&first).Error)
	require.NoError(t, db.Table("config_keys").Where("key_id = ?", "vault-row-2-id").Take(&second).Error)
	assert.NotEqual(t, first.EncryptionStatus, second.EncryptionStatus,
		"exactly one row should commit before the failing Vault call")
	if first.EncryptionStatus == encryptionStatusEncrypted {
		assert.Equal(t, "vault.bifrost/config_keys/vault-row-1-id/value", first.Value)
		assert.Equal(t, encryptionStatusPlainText, second.EncryptionStatus)
		assert.Equal(t, "second-secret", second.Value)
	} else {
		assert.Equal(t, encryptionStatusPlainText, first.EncryptionStatus)
		assert.Equal(t, "first-secret", first.Value)
		assert.Equal(t, encryptionStatusEncrypted, second.EncryptionStatus)
		assert.Equal(t, "vault.bifrost/config_keys/vault-row-2-id/value", second.Value)
	}
}

// ============================================================================
// Individual batch functions
// ============================================================================

func TestEncryptPlaintextSessions(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	future := time.Now().Add(time.Hour).UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO sessions (token, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, 'plain_text', ?, ?, ?)`,
		"session-token-1", future, now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO sessions (token, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, 'plain_text', ?, ?, ?)`,
		"session-token-2", future, now, now)

	count, err := store.encryptPlaintextSessions(ctx)
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	// Both should be decryptable via GORM
	var sessions []tables.SessionsTable
	require.NoError(t, db.Find(&sessions).Error)
	assert.Len(t, sessions, 2)

	tokens := map[string]bool{}
	for _, s := range sessions {
		tokens[s.Token] = true
	}
	assert.True(t, tokens["session-token-1"])
	assert.True(t, tokens["session-token-2"])
}

func TestEncryptPlaintextOAuthTokens(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	future := time.Now().Add(time.Hour).UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO mcp_oauth_tokens (id, auth_mode, access_token, refresh_token, token_type, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, 'shared', ?, ?, 'Bearer', 'plain_text', ?, ?, ?)`,
		"tok-batch-1", "access-1", "refresh-1", future, now, now)

	count, err := store.encryptPlaintextOAuthTokens(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	var found tables.TableMCPOauthToken
	require.NoError(t, db.First(&found, "id = ?", "tok-batch-1").Error)
	assert.Equal(t, "access-1", found.AccessToken)
	assert.Equal(t, "refresh-1", found.RefreshToken)
}

func TestEncryptPlaintextPlugins(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO config_plugins (name, enabled, config_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, 'plain_text', ?, ?)`,
		"batch-plugin", true, `{"secret":"value"}`, now, now)

	count, err := store.encryptPlaintextPlugins(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	var raw map[string]any
	db.Table("config_plugins").Where("name = ?", "batch-plugin").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.NotContains(t, raw["config_json"], "secret")
}

func TestEncryptPlaintextPlugins_SkipsEmptyConfig(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// Insert plugin with empty config — should NOT be picked up by the query
	insertPlaintextRow(t, db,
		`INSERT INTO config_plugins (name, enabled, config_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, '{}', 'plain_text', ?, ?)`,
		"empty-config-plugin", true, now, now)

	count, err := store.encryptPlaintextPlugins(ctx)
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

func TestEncryptPlaintextProviderProxies_SkipsNoProxy(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// Provider without proxy config — should NOT be picked up
	insertPlaintextRow(t, db,
		`INSERT INTO config_providers (name, proxy_config_json, encryption_status, created_at, updated_at)
		 VALUES (?, '', 'plain_text', ?, ?)`,
		"no-proxy-provider", now, now)

	count, err := store.encryptPlaintextProviderProxies(ctx)
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

// ============================================================================
// Direct tests for each startup batch function with data verification
// ============================================================================

func TestEncryptPlaintextKeys_EncryptsAndDecryptsCorrectly(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"batch-key-1", 1, "openai", "bk-1", "sk-batch-secret-1", now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"batch-key-2", 1, "anthropic", "bk-2", "sk-batch-secret-2", now, now)

	count, err := store.encryptPlaintextKeys(ctx)
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	// Raw DB should have encrypted values
	var raw1 map[string]any
	db.Table("config_keys").Where("name = ?", "batch-key-1").Take(&raw1)
	assert.Equal(t, "encrypted", raw1["encryption_status"])
	assert.NotEqual(t, "sk-batch-secret-1", raw1["value"])

	// GORM hooks should decrypt on read
	var found1 tables.TableKey
	require.NoError(t, db.Where("name = ?", "batch-key-1").First(&found1).Error)
	assert.Equal(t, "sk-batch-secret-1", found1.Value.GetValue())

	var found2 tables.TableKey
	require.NoError(t, db.Where("name = ?", "batch-key-2").First(&found2).Error)
	assert.Equal(t, "sk-batch-secret-2", found2.Value.GetValue())
}

func TestEncryptPlaintextVirtualKeys_EncryptsAndDecryptsCorrectly(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO governance_virtual_keys (id, name, value, is_active, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'plain_text', ?, ?)`,
		"vk-batch-1", "batch-vk", "vk-batch-secret", true, now, now)

	count, err := store.encryptPlaintextVirtualKeys(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Raw DB should have encrypted value
	var raw map[string]any
	db.Table("governance_virtual_keys").Where("id = ?", "vk-batch-1").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.NotEqual(t, "vk-batch-secret", raw["value"])

	// GORM hooks should decrypt on read
	var found tables.TableVirtualKey
	require.NoError(t, db.Where("id = ?", "vk-batch-1").First(&found).Error)
	assert.Equal(t, "vk-batch-secret", found.Value.GetValue())
}

func TestVirtualKeyPreviousValue_EncryptsAndDecryptsCorrectly(t *testing.T) {
	_, db := setupEncryptionTestStore(t)
	now := time.Now().UTC()
	exp := now.Add(10 * time.Minute)

	vk := &tables.TableVirtualKey{
		ID:                     "vk-prev-enc",
		Name:                   "prev-enc-vk",
		Value:                  *schemas.NewSecretVar("vk-current-secret"),
		IsActive:               schemas.Ptr(true),
		PreviousValue:          *schemas.NewSecretVar("vk-previous-secret"),
		PreviousValueExpiresAt: &exp,
		RotatedAt:              &now,
	}
	require.NoError(t, db.Create(vk).Error)

	// Raw DB must hold the previous value encrypted, with its hash computed.
	var raw map[string]any
	db.Table("governance_virtual_keys").Where("id = ?", "vk-prev-enc").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.NotEqual(t, "vk-previous-secret", raw["previous_value"])
	assert.NotEmpty(t, raw["previous_value_hash"])

	// GORM hooks should decrypt both values on read.
	var found tables.TableVirtualKey
	require.NoError(t, db.Where("id = ?", "vk-prev-enc").First(&found).Error)
	assert.Equal(t, "vk-current-secret", found.Value.GetValue())
	assert.Equal(t, "vk-previous-secret", found.PreviousValue.GetValue())
	assert.True(t, found.HasActivePreviousValue(now))
}

func TestEncryptPlaintextOAuthConfigs_EncryptsAndDecryptsCorrectly(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO oauth_configs (id, client_secret, redirect_uri, status, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, 'pending', 'plain_text', ?, ?)`,
		"cfg-batch-1", "batch-client-secret", "https://example.com/cb", now, now)

	count, err := store.encryptPlaintextOAuthConfigs(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Raw DB should have encrypted values
	var raw map[string]any
	db.Table("oauth_configs").Where("id = ?", "cfg-batch-1").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.NotEqual(t, "batch-client-secret", raw["client_secret"])

	// GORM hooks should decrypt on read
	var found tables.TableOauthConfig
	require.NoError(t, db.Where("id = ?", "cfg-batch-1").First(&found).Error)
	assert.Equal(t, "batch-client-secret", found.ClientSecret.GetValue())
}

func TestEncryptPlaintextMCPClients_EncryptsAndDecryptsCorrectly(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO config_mcp_clients (client_id, name, connection_type, connection_string, headers_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, 'sse', ?, ?, 'plain_text', ?, ?)`,
		"mcp-batch-1", "batch-mcp", "https://mcp.example.com", `{"X-Api-Key":"secret-key"}`, now, now)

	count, err := store.encryptPlaintextMCPClients(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Raw DB should have encrypted values
	var raw map[string]any
	db.Table("config_mcp_clients").Where("client_id = ?", "mcp-batch-1").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.NotContains(t, raw["headers_json"], "secret-key")

	// GORM hooks should decrypt on read
	var found tables.TableMCPClient
	require.NoError(t, db.Where("client_id = ?", "mcp-batch-1").First(&found).Error)
	assert.Equal(t, "https://mcp.example.com", found.ConnectionString.GetValue())
	assert.Equal(t, "secret-key", found.Headers["X-Api-Key"].Val)
}

func TestEncryptPlaintextProviderProxies_EncryptsAndDecryptsCorrectly(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO config_providers (name, proxy_config_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, 'plain_text', ?, ?)`,
		"proxy-provider", `{"url":"https://proxy.example.com","username":"admin","password":"secret-proxy-pass"}`, now, now)

	count, err := store.encryptPlaintextProviderProxies(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Raw DB should have encrypted proxy config
	var raw map[string]any
	db.Table("config_providers").Where("name = ?", "proxy-provider").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.NotContains(t, raw["proxy_config_json"], "secret-proxy-pass")

	// GORM hooks should decrypt and deserialize on read
	var found tables.TableProvider
	require.NoError(t, db.Where("name = ?", "proxy-provider").First(&found).Error)
	require.NotNil(t, found.ProxyConfig)
	require.NotNil(t, found.ProxyConfig.URL)
	assert.Equal(t, "https://proxy.example.com", found.ProxyConfig.URL.Val)
	require.NotNil(t, found.ProxyConfig.Password)
	assert.Equal(t, "secret-proxy-pass", found.ProxyConfig.Password.Val)
}

func TestEncryptPlaintextVectorStoreConfigs_EncryptsAndDecryptsCorrectly(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	configJSON := `{"host":"redis.example.com","password":"redis-secret"}`
	insertPlaintextRow(t, db,
		`INSERT INTO config_vector_store (enabled, type, config, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, 'plain_text', ?, ?)`,
		true, "redis", configJSON, now, now)

	count, err := store.encryptPlaintextVectorStoreConfigs(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Raw DB should have encrypted config
	var raw map[string]any
	db.Table("config_vector_store").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.NotContains(t, raw["config"], "redis-secret")

	// GORM hooks should decrypt on read
	var found tables.TableVectorStoreConfig
	require.NoError(t, db.First(&found).Error)
	require.NotNil(t, found.Config)
	assert.Contains(t, *found.Config, "redis-secret")
}

func TestEncryptPlaintextVectorStoreConfigs_SkipsEmptyConfig(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO config_vector_store (enabled, type, config, encryption_status, created_at, updated_at)
		 VALUES (?, ?, '', 'plain_text', ?, ?)`,
		false, "none", now, now)

	count, err := store.encryptPlaintextVectorStoreConfigs(ctx)
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}

func TestEncryptPlaintextMCPClients_SkipsEmptyFields(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// MCP client with no connection string and empty headers — nothing to encrypt
	insertPlaintextRow(t, db,
		`INSERT INTO config_mcp_clients (client_id, name, connection_type, headers_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, 'stdio', '{}', 'plain_text', ?, ?)`,
		"mcp-empty", "empty-mcp", now, now)

	count, err := store.encryptPlaintextMCPClients(ctx)
	require.NoError(t, err)
	// Row is still processed (encryption_status changes) even if no fields are encrypted
	assert.Equal(t, 1, count)
}

// ============================================================================
// Batch pagination — verify >100 rows are handled correctly
// ============================================================================

func TestEncryptPlaintextKeys_MultipleBatches(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// Insert 5 plaintext keys to verify the batch loop processes all rows
	for i := range 5 {
		insertPlaintextRow(t, db,
			`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
			fmt.Sprintf("paginated-key-%d", i), 1, "openai", fmt.Sprintf("pk-%d", i), fmt.Sprintf("sk-secret-%d", i), now, now)
	}

	count, err := store.encryptPlaintextKeys(ctx)
	require.NoError(t, err)
	assert.Equal(t, 5, count)

	// Verify all are encrypted in raw DB
	var encryptedCount int64
	db.Table("config_keys").Where("encryption_status = ?", "encrypted").Count(&encryptedCount)
	assert.Equal(t, int64(5), encryptedCount)

	// Verify no plaintext rows remain
	var plaintextCount int64
	db.Table("config_keys").Where("encryption_status = ? OR encryption_status IS NULL OR encryption_status = ''", "plain_text").Count(&plaintextCount)
	assert.Equal(t, int64(0), plaintextCount)

	// Verify each row is still readable via GORM hooks
	for i := range 5 {
		var found tables.TableKey
		require.NoError(t, db.Where("name = ?", fmt.Sprintf("paginated-key-%d", i)).First(&found).Error)
		assert.Equal(t, fmt.Sprintf("sk-secret-%d", i), found.Value.GetValue())
	}
}

func TestEncryptPlaintextSessions_MultipleBatches(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	future := time.Now().Add(time.Hour).UTC().Format("2006-01-02 15:04:05")

	// Insert 5 plaintext sessions
	for i := range 5 {
		insertPlaintextRow(t, db,
			`INSERT INTO sessions (token, encryption_status, expires_at, created_at, updated_at)
			 VALUES (?, 'plain_text', ?, ?, ?)`,
			fmt.Sprintf("session-token-%d", i), future, now, now)
	}

	count, err := store.encryptPlaintextSessions(ctx)
	require.NoError(t, err)
	assert.Equal(t, 5, count)

	// Verify all are encrypted
	var encryptedCount int64
	db.Table("sessions").Where("encryption_status = ?", "encrypted").Count(&encryptedCount)
	assert.Equal(t, int64(5), encryptedCount)
}

// ============================================================================
// Provider-specific encrypted fields on TableKey (Azure, Vertex, Bedrock)
// ============================================================================

func TestEncryptPlaintextKeys_AzureFields_EncryptsAndDecryptsCorrectly(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, azure_endpoint, azure_client_id, azure_client_secret, azure_tenant_id, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"azure-key", 1, "azure", "az-1", "sk-azure-key-value",
		"https://myresource.openai.azure.com", "my-azure-client-id", "azure-super-secret-client",
		"my-azure-tenant-id", now, now)

	count, err := store.encryptPlaintextKeys(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Raw DB should have encrypted values for all sensitive fields
	var raw map[string]any
	db.Table("config_keys").Where("name = ?", "azure-key").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.NotEqual(t, "sk-azure-key-value", raw["value"])
	assert.NotEqual(t, "https://myresource.openai.azure.com", raw["azure_endpoint"])
	assert.NotEqual(t, "my-azure-client-id", raw["azure_client_id"])
	assert.NotEqual(t, "azure-super-secret-client", raw["azure_client_secret"])
	assert.NotEqual(t, "my-azure-tenant-id", raw["azure_tenant_id"])

	// GORM hooks should decrypt and reconstruct AzureKeyConfig
	var found tables.TableKey
	require.NoError(t, db.Where("name = ?", "azure-key").First(&found).Error)
	assert.Equal(t, "sk-azure-key-value", found.Value.GetValue())
	require.NotNil(t, found.AzureKeyConfig)
	assert.Equal(t, "https://myresource.openai.azure.com", found.AzureKeyConfig.Endpoint.GetValue())
	require.NotNil(t, found.AzureKeyConfig.ClientID)
	assert.Equal(t, "my-azure-client-id", found.AzureKeyConfig.ClientID.GetValue())
	assert.NotNil(t, found.AzureKeyConfig.ClientSecret)
	assert.Equal(t, "azure-super-secret-client", found.AzureKeyConfig.ClientSecret.GetValue())
	require.NotNil(t, found.AzureKeyConfig.TenantID)
	assert.Equal(t, "my-azure-tenant-id", found.AzureKeyConfig.TenantID.GetValue())
}

func TestEncryptPlaintextKeys_VertexFields_EncryptsAndDecryptsCorrectly(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, vertex_project_id, vertex_project_number, vertex_region, vertex_auth_credentials, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"vertex-key", 1, "vertex", "vx-1", "sk-vertex-key-value",
		"my-gcp-project", "123456789", "us-central1",
		`{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----secret"}`, now, now)

	count, err := store.encryptPlaintextKeys(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Raw DB should have encrypted values
	var raw map[string]any
	db.Table("config_keys").Where("name = ?", "vertex-key").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.NotEqual(t, "sk-vertex-key-value", raw["value"])
	assert.NotEqual(t, "my-gcp-project", raw["vertex_project_id"])
	assert.NotEqual(t, "123456789", raw["vertex_project_number"])
	assert.NotEqual(t, "us-central1", raw["vertex_region"])
	assert.NotContains(t, fmt.Sprintf("%v", raw["vertex_auth_credentials"]), "private_key")

	// GORM hooks should decrypt and reconstruct VertexKeyConfig
	var found tables.TableKey
	require.NoError(t, db.Where("name = ?", "vertex-key").First(&found).Error)
	assert.Equal(t, "sk-vertex-key-value", found.Value.GetValue())
	require.NotNil(t, found.VertexKeyConfig)
	assert.Equal(t, "my-gcp-project", found.VertexKeyConfig.ProjectID.GetValue())
	assert.Equal(t, "123456789", found.VertexKeyConfig.ProjectNumber.GetValue())
	assert.Equal(t, "us-central1", found.VertexKeyConfig.Region.GetValue())
	assert.Contains(t, found.VertexKeyConfig.AuthCredentials.GetValue(), "private_key")
}

func TestEncryptPlaintextKeys_BedrockFields_EncryptsAndDecryptsCorrectly(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, bedrock_access_key, bedrock_secret_key, bedrock_session_token, bedrock_region, bedrock_arn, aliases_json, bedrock_batch_s3_config_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"bedrock-key", 1, "bedrock", "br-1", "sk-bedrock-key-value",
		"AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "FwoGZXIvYXdzEBYaDH7sampleSessionToken",
		"us-west-2", "arn:aws:iam::123456789:role/bedrock",
		`{"claude-3":"profile-claude"}`, `{"buckets":[{"bucket_name":"my-bucket","prefix":"jobs/","is_default":true}]}`,
		now, now)

	count, err := store.encryptPlaintextKeys(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Raw DB should have encrypted values for all Bedrock fields
	var raw map[string]any
	db.Table("config_keys").Where("name = ?", "bedrock-key").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.NotEqual(t, "sk-bedrock-key-value", raw["value"])
	assert.NotEqual(t, "AKIAIOSFODNN7EXAMPLE", raw["bedrock_access_key"])
	assert.NotEqual(t, "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", raw["bedrock_secret_key"])
	assert.NotEqual(t, "FwoGZXIvYXdzEBYaDH7sampleSessionToken", raw["bedrock_session_token"])
	assert.NotEqual(t, "us-west-2", raw["bedrock_region"])
	assert.NotEqual(t, "arn:aws:iam::123456789:role/bedrock", raw["bedrock_arn"])
	rawAliasesVal := raw["aliases_json"]
	var rawAliasesStr string
	switch v := rawAliasesVal.(type) {
	case string:
		rawAliasesStr = v
	case []byte:
		rawAliasesStr = string(v)
	}
	assert.NotContains(t, rawAliasesStr, "profile-claude")
	if rawBatch, ok := raw["bedrock_batch_s3_config_json"].(string); ok {
		assert.NotContains(t, rawBatch, "my-bucket")
	}

	// GORM hooks should decrypt and reconstruct BedrockKeyConfig
	var found tables.TableKey
	require.NoError(t, db.Where("name = ?", "bedrock-key").First(&found).Error)
	assert.Equal(t, "sk-bedrock-key-value", found.Value.GetValue())
	require.NotNil(t, found.BedrockKeyConfig)
	assert.Equal(t, "AKIAIOSFODNN7EXAMPLE", found.BedrockKeyConfig.AccessKey.GetValue())
	assert.Equal(t, "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", found.BedrockKeyConfig.SecretKey.GetValue())
	require.NotNil(t, found.BedrockKeyConfig.SessionToken)
	assert.Equal(t, "FwoGZXIvYXdzEBYaDH7sampleSessionToken", found.BedrockKeyConfig.SessionToken.GetValue())
	require.NotNil(t, found.BedrockKeyConfig.Region)
	assert.Equal(t, "us-west-2", found.BedrockKeyConfig.Region.GetValue())
	require.NotNil(t, found.BedrockKeyConfig.ARN)
	assert.Equal(t, "arn:aws:iam::123456789:role/bedrock", found.BedrockKeyConfig.ARN.GetValue())
	assert.Equal(t, "profile-claude", found.Aliases["claude-3"].ModelID)
	require.NotNil(t, found.BedrockKeyConfig.BatchS3Config)
	require.Len(t, found.BedrockKeyConfig.BatchS3Config.Buckets, 1)
	assert.Equal(t, "my-bucket", found.BedrockKeyConfig.BatchS3Config.Buckets[0].BucketName)
}

func TestEncryptPlaintextKeys_AllProviderFields_ViaStartupPass(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// Insert keys for all three providers with sensitive fields
	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, azure_endpoint, azure_client_secret, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"startup-azure", 1, "azure", "sa-1", "sk-az", "https://az.openai.azure.com", "az-secret", now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, vertex_auth_credentials, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"startup-vertex", 1, "vertex", "sv-1", "sk-vx", "vertex-creds-json", now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, bedrock_access_key, bedrock_secret_key, bedrock_session_token, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"startup-bedrock", 1, "bedrock", "sb-1", "sk-br", "AKIA-BR", "secret-br", "session-br", now, now)

	// Run the full startup encryption pass
	err := store.EncryptPlaintextRows(ctx)
	require.NoError(t, err)

	// Verify all three rows are encrypted in raw DB
	for _, name := range []string{"startup-azure", "startup-vertex", "startup-bedrock"} {
		var raw map[string]any
		db.Table("config_keys").Where("name = ?", name).Take(&raw)
		assert.Equal(t, "encrypted", raw["encryption_status"], "expected encrypted status for %s", name)
	}

	// Verify Azure fields survived round-trip
	var azKey tables.TableKey
	require.NoError(t, db.Where("name = ?", "startup-azure").First(&azKey).Error)
	assert.Equal(t, "sk-az", azKey.Value.GetValue())
	require.NotNil(t, azKey.AzureKeyConfig)
	assert.Equal(t, "https://az.openai.azure.com", azKey.AzureKeyConfig.Endpoint.GetValue())
	assert.NotNil(t, azKey.AzureKeyConfig.ClientSecret)
	assert.Equal(t, "az-secret", azKey.AzureKeyConfig.ClientSecret.GetValue())

	// Verify Vertex fields survived round-trip
	var vxKey tables.TableKey
	require.NoError(t, db.Where("name = ?", "startup-vertex").First(&vxKey).Error)
	assert.Equal(t, "sk-vx", vxKey.Value.GetValue())
	require.NotNil(t, vxKey.VertexKeyConfig)
	assert.Equal(t, "vertex-creds-json", vxKey.VertexKeyConfig.AuthCredentials.GetValue())

	// Verify Bedrock fields survived round-trip
	var brKey tables.TableKey
	require.NoError(t, db.Where("name = ?", "startup-bedrock").First(&brKey).Error)
	assert.Equal(t, "sk-br", brKey.Value.GetValue())
	require.NotNil(t, brKey.BedrockKeyConfig)
	assert.Equal(t, "AKIA-BR", brKey.BedrockKeyConfig.AccessKey.GetValue())
	assert.Equal(t, "secret-br", brKey.BedrockKeyConfig.SecretKey.GetValue())
	require.NotNil(t, brKey.BedrockKeyConfig.SessionToken)
	assert.Equal(t, "session-br", brKey.BedrockKeyConfig.SessionToken.GetValue())
}

// ============================================================================
// BeforeSave must not mutate shared provider config structs (regression test)
// ============================================================================

func TestBeforeSave_DoesNotMutateSharedProviderConfigs(t *testing.T) {
	_, db := setupEncryptionTestStore(t)

	// Simulate the startup flow: create a key with AzureKeyConfig set via a shared pointer,
	// save it to DB, and verify the original config structs are not mutated by BeforeSave
	// (encryption uses value-copies so shared pointers are never corrupted).
	azureCfg := &schemas.AzureKeyConfig{
		Endpoint: *schemas.NewSecretVar("https://myresource.openai.azure.com"),
		ClientID: schemas.NewSecretVar("my-azure-client-id"),
		TenantID: schemas.NewSecretVar("my-azure-tenant-id"),
	}
	azureCfg.ClientSecret = schemas.NewSecretVar("azure-client-secret")

	vertexCfg := &schemas.VertexKeyConfig{
		ProjectID:         *schemas.NewSecretVar("my-project"),
		ProjectNumber:     *schemas.NewSecretVar("123456789"),
		Region:            *schemas.NewSecretVar("us-central1"),
		AuthCredentials:   *schemas.NewSecretVar("vertex-creds"),
		ForceSingleRegion: true,
	}

	bedrockCfg := &schemas.BedrockKeyConfig{
		AccessKey:    *schemas.NewSecretVar("AKIAEXAMPLE"),
		SecretKey:    *schemas.NewSecretVar("secret-key"),
		SessionToken: schemas.NewSecretVar("session-tok"),
		Region:       schemas.NewSecretVar("us-east-1"),
		ARN:          schemas.NewSecretVar("arn:aws:iam::123456789:role/test"),
	}

	// Save a key using the shared config pointers (mimics UpdateProvidersConfig)
	key := &tables.TableKey{
		Name:             "shared-ptr-test",
		ProviderID:       1,
		Provider:         "azure",
		KeyID:            "sp-1",
		Value:            *schemas.NewSecretVar("sk-test-value"),
		AzureKeyConfig:   azureCfg,
		VertexKeyConfig:  vertexCfg,
		BedrockKeyConfig: bedrockCfg,
	}
	require.NoError(t, db.Create(key).Error)

	// The original config structs must NOT have been mutated by BeforeSave.
	// All fields are now encrypted; the value-copy pattern in BeforeSave ensures
	// the caller's shared config struct is never corrupted by in-place encryption.

	// Azure: encrypted fields
	assert.Equal(t, "https://myresource.openai.azure.com", azureCfg.Endpoint.GetValue(),
		"BeforeSave must not mutate shared AzureKeyConfig.Endpoint")
	assert.Equal(t, "azure-client-secret", azureCfg.ClientSecret.GetValue(),
		"BeforeSave must not mutate shared AzureKeyConfig.ClientSecret")
	assert.Equal(t, "my-azure-client-id", azureCfg.ClientID.GetValue(),
		"BeforeSave must not mutate shared AzureKeyConfig.ClientID")
	assert.Equal(t, "my-azure-tenant-id", azureCfg.TenantID.GetValue(),
		"BeforeSave must not mutate shared AzureKeyConfig.TenantID")

	// Vertex: encrypted fields
	assert.Equal(t, "vertex-creds", vertexCfg.AuthCredentials.GetValue(),
		"BeforeSave must not mutate shared VertexKeyConfig.AuthCredentials")
	assert.Equal(t, "my-project", vertexCfg.ProjectID.GetValue(),
		"BeforeSave must not mutate shared VertexKeyConfig.ProjectID")
	assert.Equal(t, "123456789", vertexCfg.ProjectNumber.GetValue(),
		"BeforeSave must not mutate shared VertexKeyConfig.ProjectNumber")
	assert.Equal(t, "us-central1", vertexCfg.Region.GetValue(),
		"BeforeSave must not mutate shared VertexKeyConfig.Region")
	assert.True(t, vertexCfg.ForceSingleRegion,
		"BeforeSave must not mutate shared VertexKeyConfig.ForceSingleRegion")

	// Bedrock: encrypted fields
	assert.Equal(t, "AKIAEXAMPLE", bedrockCfg.AccessKey.GetValue(),
		"BeforeSave must not mutate shared BedrockKeyConfig.AccessKey")
	assert.Equal(t, "secret-key", bedrockCfg.SecretKey.GetValue(),
		"BeforeSave must not mutate shared BedrockKeyConfig.SecretKey")
	assert.Equal(t, "session-tok", bedrockCfg.SessionToken.GetValue(),
		"BeforeSave must not mutate shared BedrockKeyConfig.SessionToken")
	assert.Equal(t, "us-east-1", bedrockCfg.Region.GetValue(),
		"BeforeSave must not mutate shared BedrockKeyConfig.Region")
	assert.Equal(t, "arn:aws:iam::123456789:role/test", bedrockCfg.ARN.GetValue(),
		"BeforeSave must not mutate shared BedrockKeyConfig.ARN")

	// Verify the DB round-trip still works (encrypted + decryptable)
	var found tables.TableKey
	require.NoError(t, db.Where("name = ?", "shared-ptr-test").First(&found).Error)
	assert.Equal(t, "sk-test-value", found.Value.GetValue())
	require.NotNil(t, found.AzureKeyConfig)
	assert.Equal(t, "https://myresource.openai.azure.com", found.AzureKeyConfig.Endpoint.GetValue())
	assert.Equal(t, "azure-client-secret", found.AzureKeyConfig.ClientSecret.GetValue())
	assert.Equal(t, "my-azure-client-id", found.AzureKeyConfig.ClientID.GetValue())
	assert.Equal(t, "my-azure-tenant-id", found.AzureKeyConfig.TenantID.GetValue())
	require.NotNil(t, found.VertexKeyConfig)
	assert.Equal(t, "vertex-creds", found.VertexKeyConfig.AuthCredentials.GetValue())
	assert.Equal(t, "my-project", found.VertexKeyConfig.ProjectID.GetValue())
	assert.Equal(t, "123456789", found.VertexKeyConfig.ProjectNumber.GetValue())
	assert.Equal(t, "us-central1", found.VertexKeyConfig.Region.GetValue())
	assert.True(t, found.VertexKeyConfig.ForceSingleRegion,
		"ForceSingleRegion must survive the save/reload round-trip")
	require.NotNil(t, found.BedrockKeyConfig)
	assert.Equal(t, "AKIAEXAMPLE", found.BedrockKeyConfig.AccessKey.GetValue())
	assert.Equal(t, "secret-key", found.BedrockKeyConfig.SecretKey.GetValue())
	assert.Equal(t, "session-tok", found.BedrockKeyConfig.SessionToken.GetValue())
	assert.Equal(t, "us-east-1", found.BedrockKeyConfig.Region.GetValue())
	assert.Equal(t, "arn:aws:iam::123456789:role/test", found.BedrockKeyConfig.ARN.GetValue())
}

// ============================================================================
// SecretVar-backed fields must not be encrypted (encryption is a no-op for FromEnv)
// ============================================================================

func TestBeforeSave_SecretVarBackedFields_NotEncrypted(t *testing.T) {
	_, db := setupEncryptionTestStore(t)

	// Set environment variables that the SecretVars will resolve to
	t.Setenv("TEST_AZURE_KEY", "sk-azure-from-env")
	t.Setenv("TEST_AZURE_ENDPOINT", "https://env-resource.openai.azure.com")
	t.Setenv("TEST_AZURE_SECRET", "env-azure-client-secret")
	t.Setenv("TEST_AZURE_CLIENT_ID", "env-azure-client-id")
	t.Setenv("TEST_AZURE_TENANT_ID", "env-azure-tenant-id")
	t.Setenv("TEST_VERTEX_PROJECT", "env-vertex-project")
	t.Setenv("TEST_VERTEX_REGION", "env-us-central1")
	t.Setenv("TEST_VERTEX_CREDS", "env-vertex-creds-json")
	t.Setenv("TEST_BEDROCK_ACCESS", "env-AKIA-ACCESS")
	t.Setenv("TEST_BEDROCK_SECRET", "env-bedrock-secret")
	t.Setenv("TEST_BEDROCK_SESSION", "env-bedrock-session")
	t.Setenv("TEST_BEDROCK_REGION", "env-us-east-1")
	t.Setenv("TEST_BEDROCK_ARN", "arn:aws:iam::env:role/test")

	// Create SecretVars backed by environment variables
	azureCfg := &schemas.AzureKeyConfig{
		Endpoint:     *schemas.NewSecretVar("env.TEST_AZURE_ENDPOINT"),
		ClientID:     schemas.NewSecretVar("env.TEST_AZURE_CLIENT_ID"),
		ClientSecret: schemas.NewSecretVar("env.TEST_AZURE_SECRET"),
		TenantID:     schemas.NewSecretVar("env.TEST_AZURE_TENANT_ID"),
	}
	vertexCfg := &schemas.VertexKeyConfig{
		ProjectID:       *schemas.NewSecretVar("env.TEST_VERTEX_PROJECT"),
		Region:          *schemas.NewSecretVar("env.TEST_VERTEX_REGION"),
		AuthCredentials: *schemas.NewSecretVar("env.TEST_VERTEX_CREDS"),
	}
	bedrockCfg := &schemas.BedrockKeyConfig{
		AccessKey:    *schemas.NewSecretVar("env.TEST_BEDROCK_ACCESS"),
		SecretKey:    *schemas.NewSecretVar("env.TEST_BEDROCK_SECRET"),
		SessionToken: schemas.NewSecretVar("env.TEST_BEDROCK_SESSION"),
		Region:       schemas.NewSecretVar("env.TEST_BEDROCK_REGION"),
		ARN:          schemas.NewSecretVar("env.TEST_BEDROCK_ARN"),
	}

	// Verify the SecretVars resolved correctly and are marked as FromEnv
	require.True(t, azureCfg.Endpoint.IsFromSecret())
	require.Equal(t, "https://env-resource.openai.azure.com", azureCfg.Endpoint.GetValue())
	require.True(t, azureCfg.ClientSecret.IsFromSecret())
	require.True(t, vertexCfg.AuthCredentials.IsFromSecret())
	require.True(t, bedrockCfg.AccessKey.IsFromSecret())

	key := &tables.TableKey{
		Name:             "env-backed-key",
		ProviderID:       1,
		Provider:         "azure",
		KeyID:            "env-1",
		Value:            *schemas.NewSecretVar("env.TEST_AZURE_KEY"),
		AzureKeyConfig:   azureCfg,
		VertexKeyConfig:  vertexCfg,
		BedrockKeyConfig: bedrockCfg,
	}
	require.NoError(t, db.Create(key).Error)

	// Raw DB should store the env var references, NOT encrypted ciphertext.
	// SecretVar.Value() returns the env var name (e.g. "env.TEST_AZURE_KEY") when FromEnv=true.
	var raw map[string]any
	db.Table("config_keys").Where("name = ?", "env-backed-key").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	// Value column should contain the env reference string, not encrypted data
	assert.Equal(t, "env.TEST_AZURE_KEY", raw["value"])
	assert.Equal(t, "env.TEST_AZURE_ENDPOINT", raw["azure_endpoint"])
	assert.Equal(t, "env.TEST_AZURE_SECRET", raw["azure_client_secret"])

	// The shared config structs must NOT be mutated
	assert.Equal(t, "https://env-resource.openai.azure.com", azureCfg.Endpoint.GetValue())
	assert.True(t, azureCfg.Endpoint.IsFromSecret())
	assert.Equal(t, "env-azure-client-secret", azureCfg.ClientSecret.GetValue())
	assert.True(t, azureCfg.ClientSecret.IsFromSecret())
	assert.Equal(t, "env-vertex-creds-json", vertexCfg.AuthCredentials.GetValue())
	assert.True(t, vertexCfg.AuthCredentials.IsFromSecret())
	assert.Equal(t, "env-AKIA-ACCESS", bedrockCfg.AccessKey.GetValue())
	assert.True(t, bedrockCfg.AccessKey.IsFromSecret())
	assert.Equal(t, "env-bedrock-secret", bedrockCfg.SecretKey.GetValue())
	assert.True(t, bedrockCfg.SecretKey.IsFromSecret())
	assert.Equal(t, "env-bedrock-session", bedrockCfg.SessionToken.GetValue())
	assert.True(t, bedrockCfg.SessionToken.IsFromSecret())

	// GORM round-trip: AfterFind should reconstruct env-backed SecretVars correctly
	var found tables.TableKey
	require.NoError(t, db.Where("name = ?", "env-backed-key").First(&found).Error)
	assert.Equal(t, "sk-azure-from-env", found.Value.GetValue())
	assert.True(t, found.Value.IsFromSecret())

	require.NotNil(t, found.AzureKeyConfig)
	assert.Equal(t, "https://env-resource.openai.azure.com", found.AzureKeyConfig.Endpoint.GetValue())
	assert.True(t, found.AzureKeyConfig.Endpoint.IsFromSecret())
	assert.Equal(t, "env-azure-client-secret", found.AzureKeyConfig.ClientSecret.GetValue())
	assert.True(t, found.AzureKeyConfig.ClientSecret.IsFromSecret())
	assert.Equal(t, "env-azure-client-id", found.AzureKeyConfig.ClientID.GetValue())
	assert.True(t, found.AzureKeyConfig.ClientID.IsFromSecret())
	assert.Equal(t, "env-azure-tenant-id", found.AzureKeyConfig.TenantID.GetValue())
	assert.True(t, found.AzureKeyConfig.TenantID.IsFromSecret())

	require.NotNil(t, found.VertexKeyConfig)
	assert.Equal(t, "env-vertex-project", found.VertexKeyConfig.ProjectID.GetValue())
	assert.True(t, found.VertexKeyConfig.ProjectID.IsFromSecret())
	assert.Equal(t, "env-us-central1", found.VertexKeyConfig.Region.GetValue())
	assert.True(t, found.VertexKeyConfig.Region.IsFromSecret())
	assert.Equal(t, "env-vertex-creds-json", found.VertexKeyConfig.AuthCredentials.GetValue())
	assert.True(t, found.VertexKeyConfig.AuthCredentials.IsFromSecret())

	require.NotNil(t, found.BedrockKeyConfig)
	assert.Equal(t, "env-AKIA-ACCESS", found.BedrockKeyConfig.AccessKey.GetValue())
	assert.True(t, found.BedrockKeyConfig.AccessKey.IsFromSecret())
	assert.Equal(t, "env-bedrock-secret", found.BedrockKeyConfig.SecretKey.GetValue())
	assert.True(t, found.BedrockKeyConfig.SecretKey.IsFromSecret())
	assert.Equal(t, "env-bedrock-session", found.BedrockKeyConfig.SessionToken.GetValue())
	assert.True(t, found.BedrockKeyConfig.SessionToken.IsFromSecret())
	assert.Equal(t, "env-us-east-1", found.BedrockKeyConfig.Region.GetValue())
	assert.True(t, found.BedrockKeyConfig.Region.IsFromSecret())
	assert.Equal(t, "arn:aws:iam::env:role/test", found.BedrockKeyConfig.ARN.GetValue())
	assert.True(t, found.BedrockKeyConfig.ARN.IsFromSecret())
}

func TestEncryptPlaintextKeys_SecretVarBackedFields_SurviveStartupPass(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	t.Setenv("TEST_SP_KEY", "sk-startup-env-key")
	t.Setenv("TEST_SP_ENDPOINT", "https://startup.openai.azure.com")
	t.Setenv("TEST_SP_CREDS", "startup-vertex-creds")
	t.Setenv("TEST_SP_ACCESS", "AKIA-STARTUP")

	// Insert plaintext rows with env var references via raw SQL (mimics legacy data)
	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, azure_endpoint, vertex_auth_credentials, bedrock_access_key, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"env-startup-key", 1, "azure", "esp-1",
		"env.TEST_SP_KEY", "env.TEST_SP_ENDPOINT", "env.TEST_SP_CREDS", "env.TEST_SP_ACCESS",
		now, now)

	// Run the startup encryption pass
	count, err := store.encryptPlaintextKeys(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	// Raw DB should still have env var references (not encrypted ciphertext)
	var raw map[string]any
	db.Table("config_keys").Where("name = ?", "env-startup-key").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.Equal(t, "env.TEST_SP_KEY", raw["value"])
	assert.Equal(t, "env.TEST_SP_ENDPOINT", raw["azure_endpoint"])
	assert.Equal(t, "env.TEST_SP_CREDS", raw["vertex_auth_credentials"])
	assert.Equal(t, "env.TEST_SP_ACCESS", raw["bedrock_access_key"])

	// GORM should resolve env vars on read
	var found tables.TableKey
	require.NoError(t, db.Where("name = ?", "env-startup-key").First(&found).Error)
	assert.Equal(t, "sk-startup-env-key", found.Value.GetValue())
	assert.True(t, found.Value.IsFromSecret())
	require.NotNil(t, found.AzureKeyConfig)
	assert.Equal(t, "https://startup.openai.azure.com", found.AzureKeyConfig.Endpoint.GetValue())
	assert.True(t, found.AzureKeyConfig.Endpoint.IsFromSecret())
	require.NotNil(t, found.VertexKeyConfig)
	assert.Equal(t, "startup-vertex-creds", found.VertexKeyConfig.AuthCredentials.GetValue())
	assert.True(t, found.VertexKeyConfig.AuthCredentials.IsFromSecret())
	require.NotNil(t, found.BedrockKeyConfig)
	assert.Equal(t, "AKIA-STARTUP", found.BedrockKeyConfig.AccessKey.GetValue())
	assert.True(t, found.BedrockKeyConfig.AccessKey.IsFromSecret())
}

// ============================================================================
// Encryption disabled — startup pass is a no-op
// ============================================================================

func TestEncryptPlaintextRows_EncryptionDisabled_Noop(t *testing.T) {
	// Disable encryption for this test
	encrypt.Init("", bifrost.NewDefaultLogger(schemas.LogLevelInfo))
	t.Cleanup(func() {
		encrypt.Init(testEncryptionKey, bifrost.NewDefaultLogger(schemas.LogLevelInfo))
	})

	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	future := time.Now().Add(time.Hour).UTC().Format("2006-01-02 15:04:05")

	// Insert plaintext rows across multiple tables
	insertPlaintextRow(t, db,
		`INSERT INTO config_keys (name, provider_id, provider, key_id, value, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"disabled-key", 1, "openai", "dk-1", "sk-should-stay-plain", now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO sessions (token, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, 'plain_text', ?, ?, ?)`,
		"session-should-stay-plain", future, now, now)

	insertPlaintextRow(t, db,
		`INSERT INTO governance_virtual_keys (id, name, value, is_active, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'plain_text', ?, ?)`,
		"vk-dis-1", "dis-vk", "vk-should-stay-plain", true, now, now)

	// Run the startup pass — should return immediately (nil) without modifying rows
	err := store.EncryptPlaintextRows(ctx)
	require.NoError(t, err)

	// Verify all rows remain as plaintext in the raw DB
	var keyRow map[string]any
	db.Table("config_keys").Where("name = ?", "disabled-key").Take(&keyRow)
	assert.Equal(t, "plain_text", keyRow["encryption_status"])
	assert.Equal(t, "sk-should-stay-plain", keyRow["value"])

	var sessionRow map[string]any
	db.Table("sessions").Take(&sessionRow)
	assert.Equal(t, "plain_text", sessionRow["encryption_status"])
	assert.Equal(t, "session-should-stay-plain", sessionRow["token"])

	var vkRow map[string]any
	db.Table("governance_virtual_keys").Where("id = ?", "vk-dis-1").Take(&vkRow)
	assert.Equal(t, "plain_text", vkRow["encryption_status"])
	assert.Equal(t, "vk-should-stay-plain", vkRow["value"])
}

func TestEncryptPlaintextRows_EncryptionDisabled_GORMHooksStorePlaintext(t *testing.T) {
	// Disable encryption for this test
	encrypt.Init("", bifrost.NewDefaultLogger(schemas.LogLevelInfo))
	t.Cleanup(func() {
		encrypt.Init(testEncryptionKey, bifrost.NewDefaultLogger(schemas.LogLevelInfo))
	})

	_, db := setupEncryptionTestStore(t)

	// Create rows via GORM (hooks fire, but encryption is disabled)
	key := &tables.TableKey{
		Name:       "hook-no-encrypt",
		ProviderID: 1,
		Provider:   "openai",
		KeyID:      "hne-1",
		Value:      *schemas.NewSecretVar("sk-stays-plain-via-hook"),
	}
	require.NoError(t, db.Create(key).Error)

	// Raw DB should have plaintext
	var raw map[string]any
	db.Table("config_keys").Where("id = ?", key.ID).Take(&raw)
	assert.Equal(t, "plain_text", raw["encryption_status"])
	assert.Equal(t, "sk-stays-plain-via-hook", raw["value"])

	// GORM read should work fine (AfterFind skips decryption for non-encrypted rows)
	var found tables.TableKey
	require.NoError(t, db.First(&found, key.ID).Error)
	assert.Equal(t, "sk-stays-plain-via-hook", found.Value.GetValue())
}

// ============================================================================
// Empty database — startup pass is a graceful no-op
// ============================================================================

func TestEncryptPlaintextRows_EmptyDatabase(t *testing.T) {
	store, _ := setupEncryptionTestStore(t)
	ctx := context.Background()

	err := store.EncryptPlaintextRows(ctx)
	require.NoError(t, err)
}

// ============================================================================
// OAuthConfigs skip when client_secret is empty
// ============================================================================

func TestEncryptPlaintextOAuthConfigs_SkipsEmptySecret(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO oauth_configs (id, client_secret, redirect_uri, status, encryption_status, created_at, updated_at)
		 VALUES (?, '', ?, 'pending', 'plain_text', ?, ?)`,
		"cfg-empty-secrets", "https://example.com/cb", now, now)

	count, err := store.encryptPlaintextOAuthConfigs(ctx)
	require.NoError(t, err)
	assert.Equal(t, 0, count)

	var raw map[string]any
	db.Table("oauth_configs").Where("id = ?", "cfg-empty-secrets").Take(&raw)
	assert.Equal(t, "plain_text", raw["encryption_status"])
}

// ============================================================================
// Hash computation during startup pass (sessions + virtual keys)
// ============================================================================

func TestEncryptPlaintextSessions_HashComputedDuringStartup(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	future := time.Now().Add(time.Hour).UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO sessions (token, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, 'plain_text', ?, ?, ?)`,
		"hash-startup-token", future, now, now)

	count, err := store.encryptPlaintextSessions(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	var raw map[string]any
	db.Table("sessions").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.Equal(t, encrypt.HashSHA256("hash-startup-token"), raw["token_hash"])
}

func TestEncryptPlaintextVirtualKeys_HashComputedDuringStartup(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO governance_virtual_keys (id, name, value, is_active, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'plain_text', ?, ?)`,
		"vk-hash-startup", "hash-vk", "vk-hash-startup-value", true, now, now)

	count, err := store.encryptPlaintextVirtualKeys(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	var raw map[string]any
	db.Table("governance_virtual_keys").Where("id = ?", "vk-hash-startup").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.Equal(t, encrypt.HashSHA256("vk-hash-startup-value"), raw["value_hash"])
}

func TestEncryptPlaintextVirtualKeys_PreservesLegacyCiphertextWithoutStatus(t *testing.T) {
	tests := []struct {
		name   string
		status any
	}{
		{name: "null status", status: nil},
		{name: "empty status", status: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store, db := setupEncryptionTestStore(t)
			now := time.Now().UTC().Format("2006-01-02 15:04:05")
			plaintext := "vk-legacy-" + tt.name
			ciphertext, err := encrypt.Encrypt(plaintext)
			require.NoError(t, err)

			insertPlaintextRow(t, db,
				`INSERT INTO governance_virtual_keys (id, name, value, is_active, encryption_status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				"vk-legacy-ciphertext", "legacy-ciphertext", ciphertext, true, tt.status, now, now)

			count, err := store.encryptPlaintextVirtualKeys(context.Background())
			require.NoError(t, err)
			assert.Equal(t, 1, count)

			var raw struct {
				Value            string
				ValueHash        string
				EncryptionStatus string
			}
			require.NoError(t, db.Table("governance_virtual_keys").Where("id = ?", "vk-legacy-ciphertext").Take(&raw).Error)
			assert.Equal(t, ciphertext, raw.Value)
			assert.Equal(t, encrypt.HashSHA256(plaintext), raw.ValueHash)
			assert.Equal(t, encryptionStatusEncrypted, raw.EncryptionStatus)

			var found tables.TableVirtualKey
			require.NoError(t, db.Where("id = ?", "vk-legacy-ciphertext").First(&found).Error)
			assert.Equal(t, plaintext, found.Value.GetValue())
		})
	}
}

func TestEncryptPlaintextVirtualKeys_PreservesSecretReference(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	t.Setenv("TEST_LEGACY_VIRTUAL_KEY", "vk-resolved-secret")

	insertPlaintextRow(t, db,
		`INSERT INTO governance_virtual_keys (id, name, value, is_active, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, NULL, ?, ?)`,
		"vk-legacy-ref", "legacy-ref", "env.TEST_LEGACY_VIRTUAL_KEY", true, now, now)

	count, err := store.encryptPlaintextVirtualKeys(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	var raw struct {
		Value            string
		ValueHash        string
		EncryptionStatus string
	}
	require.NoError(t, db.Table("governance_virtual_keys").Where("id = ?", "vk-legacy-ref").Take(&raw).Error)
	assert.Equal(t, "env.TEST_LEGACY_VIRTUAL_KEY", raw.Value)
	assert.Equal(t, encrypt.HashSHA256("vk-resolved-secret"), raw.ValueHash)
	assert.Equal(t, encryptionStatusEncrypted, raw.EncryptionStatus)
}

// ============================================================================
// MCP client env var connection string survives startup pass
// ============================================================================

func TestEncryptPlaintextMCPClients_SecretVarConnectionStringSurvivesStartup(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	t.Setenv("TEST_MCP_URL", "https://mcp-env.example.com/sse")

	insertPlaintextRow(t, db,
		`INSERT INTO config_mcp_clients (client_id, name, connection_type, connection_string, headers_json, encryption_status, created_at, updated_at)
		 VALUES (?, ?, 'sse', ?, '{}', 'plain_text', ?, ?)`,
		"mcp-env-startup", "env-startup-mcp", "env.TEST_MCP_URL", now, now)

	count, err := store.encryptPlaintextMCPClients(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	var raw map[string]any
	db.Table("config_mcp_clients").Where("client_id = ?", "mcp-env-startup").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])
	assert.Equal(t, "env.TEST_MCP_URL", raw["connection_string"])

	var found tables.TableMCPClient
	require.NoError(t, db.Where("client_id = ?", "mcp-env-startup").First(&found).Error)
	assert.Equal(t, "https://mcp-env.example.com/sse", found.ConnectionString.GetValue())
	assert.True(t, found.ConnectionString.IsFromSecret())
}

// ============================================================================
// Already-encrypted rows skipped for non-key tables
// ============================================================================

func TestEncryptPlaintextRows_SkipsAlreadyEncryptedSessions(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()

	session := &tables.SessionsTable{
		Token:     "already-encrypted-session",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	require.NoError(t, db.Create(session).Error)

	var rawBefore map[string]any
	db.Table("sessions").Where("id = ?", session.ID).Take(&rawBefore)
	encryptedBefore := rawBefore["token"]

	err := store.EncryptPlaintextRows(ctx)
	require.NoError(t, err)

	var rawAfter map[string]any
	db.Table("sessions").Where("id = ?", session.ID).Take(&rawAfter)
	assert.Equal(t, encryptedBefore, rawAfter["token"])
}

func TestEncryptPlaintextRows_SkipsAlreadyEncryptedVirtualKeys(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()

	vk := &tables.TableVirtualKey{
		ID:       "vk-already-enc",
		Name:     "already-encrypted-vk",
		Value:    *schemas.NewSecretVar("vk-secret-already"),
		IsActive: bifrost.Ptr(true),
	}
	require.NoError(t, db.Create(vk).Error)

	var rawBefore map[string]any
	db.Table("governance_virtual_keys").Where("id = ?", "vk-already-enc").Take(&rawBefore)
	encryptedBefore := rawBefore["value"]

	err := store.EncryptPlaintextRows(ctx)
	require.NoError(t, err)

	var rawAfter map[string]any
	db.Table("governance_virtual_keys").Where("id = ?", "vk-already-enc").Take(&rawAfter)
	assert.Equal(t, encryptedBefore, rawAfter["value"])
}

func TestEncryptPlaintextVirtualKeys_AllowsLegacyDualOwnershipRows(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// Legacy databases may contain rows that predate the mutual-exclusion
	// invariant. Startup encryption must preserve ownership and only rewrite
	// the sensitive value plus its lookup metadata.
	insertPlaintextRow(t, db,
		`INSERT INTO governance_virtual_keys (id, name, value, is_active, team_id, customer_id, encryption_status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, 'plain_text', ?, ?)`,
		"vk-legacy-dual", "legacy-dual", "vk-legacy-secret", true, "team-legacy", "customer-legacy", now, now)

	count, err := store.encryptPlaintextVirtualKeys(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	var raw struct {
		Value            string
		TeamID           string
		CustomerID       string
		EncryptionStatus string
	}
	require.NoError(t, db.Table("governance_virtual_keys").Where("id = ?", "vk-legacy-dual").Take(&raw).Error)
	assert.Equal(t, "encrypted", raw.EncryptionStatus)
	assert.NotEqual(t, "vk-legacy-secret", raw.Value)
	assert.Equal(t, "team-legacy", raw.TeamID)
	assert.Equal(t, "customer-legacy", raw.CustomerID)

	var found tables.TableVirtualKey
	require.NoError(t, db.Where("id = ?", "vk-legacy-dual").First(&found).Error)
	assert.Equal(t, "vk-legacy-secret", found.Value.GetValue())
}

// ============================================================================
// OAuthTokens with empty refresh token during startup pass
// ============================================================================

func TestEncryptPlaintextOAuthTokens_EmptyRefreshToken(t *testing.T) {
	store, db := setupEncryptionTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	future := time.Now().Add(time.Hour).UTC().Format("2006-01-02 15:04:05")

	insertPlaintextRow(t, db,
		`INSERT INTO mcp_oauth_tokens (id, auth_mode, access_token, refresh_token, token_type, encryption_status, expires_at, created_at, updated_at)
		 VALUES (?, 'shared', ?, '', 'Bearer', 'plain_text', ?, ?, ?)`,
		"tok-no-refresh", "access-only-startup", future, now, now)

	count, err := store.encryptPlaintextOAuthTokens(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, count)

	var raw map[string]any
	db.Table("mcp_oauth_tokens").Where("id = ?", "tok-no-refresh").Take(&raw)
	assert.Equal(t, "encrypted", raw["encryption_status"])

	var found tables.TableMCPOauthToken
	require.NoError(t, db.First(&found, "id = ?", "tok-no-refresh").Error)
	assert.Equal(t, "access-only-startup", found.AccessToken)
	assert.Equal(t, "", found.RefreshToken)
}
