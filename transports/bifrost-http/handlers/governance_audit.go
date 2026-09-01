package handlers

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	GovernancePermissionVirtualKeysWrite = "governance.virtual_keys.write"
	GovernancePermissionVirtualKeyRead   = "governance.virtual_keys.read"
	GovernancePermissionVirtualKeyReveal = "governance.virtual_keys.reveal"
	GovernancePermissionVirtualKeyCreate = "governance.virtual_keys.create"
	GovernancePermissionVirtualKeyUpdate = "governance.virtual_keys.update"
	GovernancePermissionVirtualKeyRotate = "governance.virtual_keys.rotate"
	GovernancePermissionVirtualKeyDelete = "governance.virtual_keys.delete"
	GovernancePermissionAuditRead        = "governance.audit.read"
	GovernancePermissionAuditExport      = "governance.audit.export"
	GovernancePermissionAuditVerify      = "governance.audit.verify"

	governanceAuditSchemaVersion   = 1
	governanceAuditHeadID          = 1
	governanceAuditAlgorithm       = "Ed25519"
	governanceAuditMaxJSONBytes    = 256 * 1024
	governanceAuditMaxOnlineEvents = 10_000
)

var (
	errGovernanceForbidden        = errors.New("governance action is not authorized")
	errGovernanceAuditOnlineLimit = errors.New("governance audit chain exceeds the online verification limit")
)

// governanceDatabaseContext keeps fasthttp's server-scoped RequestCtx cancellation
// out of database/sql. Request identity is copied into audit fields separately.
func governanceDatabaseContext() context.Context {
	return context.Background()
}

// AdminPrincipal is constructed only from trusted authentication middleware
// context. Request headers and JSON fields are intentionally ignored.
type AdminPrincipal struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	AuthMethod    string `json:"auth_method"`
	RoleID        string `json:"role_id,omitempty"`
	Authenticated bool   `json:"authenticated"`
	LocalAdmin    bool   `json:"local_admin"`
}

// GovernanceAuthorizer owns action/resource authorization for management
// operations. Enterprise editions can replace the default context-backed
// implementation without replacing the HTTP handlers.
type GovernanceAuthorizer interface {
	Authorize(ctx context.Context, principal AdminPrincipal, action, resource string) error
}

type contextGovernanceAuthorizer struct{}

func (contextGovernanceAuthorizer) Authorize(ctx context.Context, principal AdminPrincipal, action, _ string) error {
	if !principal.Authenticated {
		return errGovernanceForbidden
	}
	if principal.LocalAdmin {
		return nil
	}
	required := action
	switch action {
	case "virtual_key.create":
		required = GovernancePermissionVirtualKeyCreate
	case "virtual_key.read":
		required = GovernancePermissionVirtualKeyRead
	case "virtual_key.reveal":
		required = GovernancePermissionVirtualKeyReveal
	case "virtual_key.update":
		required = GovernancePermissionVirtualKeyUpdate
	case "virtual_key.budget_override.update", "virtual_key.budget_override.delete":
		required = GovernancePermissionVirtualKeyUpdate
	case "virtual_key.rotate":
		required = GovernancePermissionVirtualKeyRotate
	case "virtual_key.delete":
		required = GovernancePermissionVirtualKeyDelete
	case "audit.read", "audit.public_key":
		required = GovernancePermissionAuditRead
	case "audit.export":
		required = GovernancePermissionAuditExport
	case "audit.verify":
		required = GovernancePermissionAuditVerify
	}
	permissions, _ := ctx.Value(schemas.BifrostContextKeyAdminPermissions).([]string)
	for _, permission := range permissions {
		if permission == required || permission == action || permission == "governance.*" ||
			(strings.HasPrefix(action, "virtual_key.") && action != "virtual_key.read" && action != "virtual_key.reveal" && permission == GovernancePermissionVirtualKeysWrite) {
			return nil
		}
	}
	return errGovernanceForbidden
}

type governanceAuditReceipt struct {
	EventID   string `json:"event_id"`
	Sequence  uint64 `json:"sequence"`
	EventHash string `json:"event_hash"`
	Signature string `json:"signature"`
	KeyID     string `json:"key_id"`
}

type governanceAuditInput struct {
	Principal  AdminPrincipal
	Action     string
	Resource   string
	ResourceID string
	Outcome    string
	RequestID  string
	TraceID    string
	Before     any
	After      any
	Metadata   any
}

type governanceAuditService struct {
	store configstore.ConfigStore
}

type virtualKeyAuditSummary struct {
	ID              string                           `json:"id"`
	Name            string                           `json:"name"`
	Description     string                           `json:"description,omitempty"`
	TeamID          *string                          `json:"team_id,omitempty"`
	CustomerID      *string                          `json:"customer_id,omitempty"`
	IsActive        bool                             `json:"is_active"`
	CalendarAligned bool                             `json:"calendar_aligned"`
	ExpiresAt       *time.Time                       `json:"expires_at,omitempty"`
	ProviderConfigs []virtualKeyProviderAuditSummary `json:"provider_configs"`
	MCPConfigs      []virtualKeyMCPAuditSummary      `json:"mcp_configs"`
	ModelConfigs    []virtualKeyModelAuditSummary    `json:"model_configs"`
}

type virtualKeyProviderAuditSummary struct {
	ID                uint     `json:"id"`
	Provider          string   `json:"provider"`
	Weight            *float64 `json:"weight,omitempty"`
	AllowedModels     []string `json:"allowed_models"`
	BlacklistedModels []string `json:"blacklisted_models"`
	AllowAllKeys      bool     `json:"allow_all_keys"`
	KeyIDs            []string `json:"key_ids"`
}

type virtualKeyMCPAuditSummary struct {
	MCPClientID    uint     `json:"mcp_client_id"`
	ToolsToExecute []string `json:"tools_to_execute"`
}

type virtualKeyBudgetAuditSummary struct {
	ID                      string                               `json:"id"`
	MaxLimit                float64                              `json:"max_limit"`
	ResetDuration           string                               `json:"reset_duration"`
	ResetConfig             *configstoreTables.BudgetResetConfig `json:"reset_config,omitempty"`
	OverrideAmount          float64                              `json:"override_amount,omitempty"`
	OverrideMode            configstoreTables.BudgetOverrideMode `json:"override_mode,omitempty"`
	OverrideCyclesRemaining int                                  `json:"override_cycles_remaining,omitempty"`
}

type virtualKeyRateLimitAuditSummary struct {
	ID                   string  `json:"id"`
	TokenMaxLimit        *int64  `json:"token_max_limit,omitempty"`
	TokenResetDuration   *string `json:"token_reset_duration,omitempty"`
	RequestMaxLimit      *int64  `json:"request_max_limit,omitempty"`
	RequestResetDuration *string `json:"request_reset_duration,omitempty"`
}

type virtualKeyModelAuditSummary struct {
	ID              string                           `json:"id"`
	Provider        *string                          `json:"provider,omitempty"`
	ModelName       string                           `json:"model_name"`
	CalendarAligned bool                             `json:"calendar_aligned"`
	Budgets         []virtualKeyBudgetAuditSummary   `json:"budgets"`
	RateLimit       *virtualKeyRateLimitAuditSummary `json:"rate_limit,omitempty"`
}

func sortedAuditStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	result := append([]string(nil), values...)
	sort.Strings(result)
	return result
}

func summarizeAuditBudgets(budgets []configstoreTables.TableBudget) []virtualKeyBudgetAuditSummary {
	result := make([]virtualKeyBudgetAuditSummary, 0, len(budgets))
	for i := range budgets {
		budget := &budgets[i]
		result = append(result, virtualKeyBudgetAuditSummary{
			ID: budget.ID, MaxLimit: budget.MaxLimit, ResetDuration: budget.ResetDuration,
			ResetConfig: budget.ResetConfig, OverrideAmount: budget.OverrideAmount,
			OverrideMode: budget.OverrideMode, OverrideCyclesRemaining: budget.OverrideCyclesRemaining,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].ResetDuration == result[j].ResetDuration {
			return result[i].ID < result[j].ID
		}
		return result[i].ResetDuration < result[j].ResetDuration
	})
	return result
}

func summarizeAuditRateLimit(rateLimit *configstoreTables.TableRateLimit) *virtualKeyRateLimitAuditSummary {
	if rateLimit == nil {
		return nil
	}
	return &virtualKeyRateLimitAuditSummary{
		ID: rateLimit.ID, TokenMaxLimit: rateLimit.TokenMaxLimit, TokenResetDuration: rateLimit.TokenResetDuration,
		RequestMaxLimit: rateLimit.RequestMaxLimit, RequestResetDuration: rateLimit.RequestResetDuration,
	}
}

func loadVirtualKeyAuditSummary(ctx context.Context, tx *gorm.DB, vkID string) (virtualKeyAuditSummary, error) {
	var vk configstoreTables.TableVirtualKey
	if err := tx.WithContext(ctx).
		Select("id", "name", "description", "team_id", "customer_id", "is_active", "calendar_aligned", "expires_at").
		First(&vk, "id = ?", vkID).Error; err != nil {
		return virtualKeyAuditSummary{}, err
	}

	var providerConfigs []configstoreTables.TableVirtualKeyProviderConfig
	if err := tx.WithContext(ctx).
		Preload("Keys", func(db *gorm.DB) *gorm.DB { return db.Select("id", "key_id") }).
		Where("virtual_key_id = ?", vkID).
		Order("provider ASC, id ASC").
		Find(&providerConfigs).Error; err != nil {
		return virtualKeyAuditSummary{}, err
	}
	providerSummaries := make([]virtualKeyProviderAuditSummary, 0, len(providerConfigs))
	for i := range providerConfigs {
		providerConfig := &providerConfigs[i]
		keyIDs := make([]string, 0, len(providerConfig.Keys))
		for j := range providerConfig.Keys {
			keyIDs = append(keyIDs, providerConfig.Keys[j].KeyID)
		}
		providerSummaries = append(providerSummaries, virtualKeyProviderAuditSummary{
			ID: providerConfig.ID, Provider: providerConfig.Provider, Weight: providerConfig.Weight,
			AllowedModels:     sortedAuditStrings(providerConfig.AllowedModels),
			BlacklistedModels: sortedAuditStrings(providerConfig.BlacklistedModels),
			AllowAllKeys:      providerConfig.AllowAllKeys, KeyIDs: sortedAuditStrings(keyIDs),
		})
	}

	var mcpConfigs []configstoreTables.TableVirtualKeyMCPConfig
	if err := tx.WithContext(ctx).Where("virtual_key_id = ?", vkID).Order("mcp_client_id ASC").Find(&mcpConfigs).Error; err != nil {
		return virtualKeyAuditSummary{}, err
	}
	mcpSummaries := make([]virtualKeyMCPAuditSummary, 0, len(mcpConfigs))
	for i := range mcpConfigs {
		mcpSummaries = append(mcpSummaries, virtualKeyMCPAuditSummary{
			MCPClientID:    mcpConfigs[i].MCPClientID,
			ToolsToExecute: sortedAuditStrings(mcpConfigs[i].ToolsToExecute),
		})
	}

	var modelConfigs []configstoreTables.TableModelConfig
	if err := tx.WithContext(ctx).
		Preload("Budgets").Preload("RateLimit").
		Where("scope = ? AND scope_id = ?", configstoreTables.ModelConfigScopeVirtualKey, vkID).
		Find(&modelConfigs).Error; err != nil {
		return virtualKeyAuditSummary{}, err
	}
	modelSummaries := make([]virtualKeyModelAuditSummary, 0, len(modelConfigs))
	for i := range modelConfigs {
		modelConfig := &modelConfigs[i]
		modelSummaries = append(modelSummaries, virtualKeyModelAuditSummary{
			ID: modelConfig.ID, Provider: modelConfig.Provider, ModelName: modelConfig.ModelName,
			CalendarAligned: modelConfig.CalendarAligned, Budgets: summarizeAuditBudgets(modelConfig.Budgets),
			RateLimit: summarizeAuditRateLimit(modelConfig.RateLimit),
		})
	}
	sort.Slice(modelSummaries, func(i, j int) bool {
		leftProvider, rightProvider := "", ""
		if modelSummaries[i].Provider != nil {
			leftProvider = *modelSummaries[i].Provider
		}
		if modelSummaries[j].Provider != nil {
			rightProvider = *modelSummaries[j].Provider
		}
		if leftProvider == rightProvider {
			if modelSummaries[i].ModelName == modelSummaries[j].ModelName {
				return modelSummaries[i].ID < modelSummaries[j].ID
			}
			return modelSummaries[i].ModelName < modelSummaries[j].ModelName
		}
		return leftProvider < rightProvider
	})

	return virtualKeyAuditSummary{
		ID: vk.ID, Name: vk.Name, Description: vk.Description, TeamID: vk.TeamID, CustomerID: vk.CustomerID,
		IsActive: vk.IsActiveValue(), CalendarAligned: vk.CalendarAligned, ExpiresAt: vk.ExpiresAt,
		ProviderConfigs: providerSummaries, MCPConfigs: mcpSummaries, ModelConfigs: modelSummaries,
	}, nil
}

func adminPrincipalFromRequest(ctx *fasthttp.RequestCtx) AdminPrincipal {
	if bypassed, _ := ctx.UserValue(schemas.BifrostContextKeyAuthBypassed).(bool); bypassed {
		return AdminPrincipal{ID: "anonymous", Name: "Anonymous", AuthMethod: "bypassed"}
	}
	if localAdmin, _ := ctx.UserValue(schemas.IsLocalAdminContextKey).(bool); localAdmin {
		actorID, _ := ctx.UserValue(schemas.BifrostContextKeyUserID).(string)
		actorName, _ := ctx.UserValue(schemas.BifrostContextKeyUserName).(string)
		if strings.TrimSpace(actorID) == "" {
			actorID = "local-admin"
		}
		if strings.TrimSpace(actorName) == "" {
			actorName = "Local administrator"
		}
		return AdminPrincipal{
			ID:            actorID,
			Name:          actorName,
			AuthMethod:    "local-session",
			RoleID:        "local-admin",
			Authenticated: true,
			LocalAdmin:    true,
		}
	}
	if userID, _ := ctx.UserValue(schemas.BifrostContextKeyUserID).(string); strings.TrimSpace(userID) != "" {
		name, _ := ctx.UserValue(schemas.BifrostContextKeyUserName).(string)
		if name == "" {
			name = userID
		}
		return AdminPrincipal{
			ID:            userID,
			Name:          name,
			AuthMethod:    "enterprise",
			RoleID:        governanceRoleID(ctx.UserValue(schemas.BifrostContextKeyUserRoleID)),
			Authenticated: true,
		}
	}
	return AdminPrincipal{ID: "anonymous", Name: "Anonymous", AuthMethod: "none"}
}

func governanceRoleID(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case uint:
		return strconv.FormatUint(uint64(typed), 10)
	case uint64:
		return strconv.FormatUint(typed, 10)
	case int:
		return strconv.Itoa(typed)
	default:
		return ""
	}
}

func governanceRequestID(ctx *fasthttp.RequestCtx) string {
	if requestID := strings.TrimSpace(string(ctx.Request.Header.Peek("x-request-id"))); requestID != "" {
		return requestID
	}
	if requestID, _ := ctx.UserValue(schemas.BifrostContextKeyRequestID).(string); requestID != "" {
		return requestID
	}
	return ""
}

func governanceTraceID(ctx *fasthttp.RequestCtx) string {
	if traceID, _ := ctx.UserValue(schemas.BifrostContextKeyExportTraceID).(string); traceID != "" {
		return traceID
	}
	return strings.TrimSpace(string(ctx.Response.Header.Peek("x-bifrost-trace-id")))
}

func canonicalAuditJSON(value any) (string, error) {
	if value == nil {
		return "{}", nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	if len(encoded) > governanceAuditMaxJSONBytes {
		return "", fmt.Errorf("governance audit summary exceeds %d bytes", governanceAuditMaxJSONBytes)
	}
	return string(encoded), nil
}

func governanceAuditSigningKey() (ed25519.PrivateKey, ed25519.PublicKey, string, error) {
	masterKey := encrypt.Key()
	if len(masterKey) == 0 {
		return nil, nil, "", fmt.Errorf("governance audit signing requires the storage encryption key")
	}
	mac := hmac.New(sha256.New, masterKey)
	_, _ = mac.Write([]byte("elygate/governance-audit/ed25519/v1"))
	seed := mac.Sum(nil)
	privateKey := ed25519.NewKeyFromSeed(seed[:ed25519.SeedSize])
	publicKey := privateKey.Public().(ed25519.PublicKey)
	keyHash := sha256.Sum256(publicKey)
	return privateKey, publicKey, hex.EncodeToString(keyHash[:8]), nil
}

func registerGovernanceAuditPublicKey(tx *gorm.DB, keyID string, publicKey ed25519.PublicKey) error {
	encoded := base64.StdEncoding.EncodeToString(publicKey)
	row := configstoreTables.TableGovernanceAuditPublicKey{
		KeyID: keyID, Algorithm: governanceAuditAlgorithm, PublicKey: encoded, CreatedAt: time.Now().UTC(),
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
		return err
	}
	var stored configstoreTables.TableGovernanceAuditPublicKey
	if err := tx.First(&stored, "key_id = ?", keyID).Error; err != nil {
		return err
	}
	if stored.Algorithm != governanceAuditAlgorithm || stored.PublicKey != encoded {
		return fmt.Errorf("governance audit public key registry conflict for key %s", keyID)
	}
	return nil
}

func bootstrapGovernanceAuditPublicKey(ctx context.Context, store configstore.ConfigStore) error {
	if store == nil || !encrypt.IsEnabled() {
		return nil
	}
	_, publicKey, keyID, err := governanceAuditSigningKey()
	if err != nil {
		return err
	}
	return store.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		return registerGovernanceAuditPublicKey(tx.WithContext(ctx), keyID, publicKey)
	})
}

func decodeGovernanceAuditPublicKeys(rows []configstoreTables.TableGovernanceAuditPublicKey) (map[string]ed25519.PublicKey, error) {
	keys := make(map[string]ed25519.PublicKey, len(rows)+1)
	for i := range rows {
		row := &rows[i]
		if row.Algorithm != governanceAuditAlgorithm {
			return nil, fmt.Errorf("unsupported governance audit key algorithm %q", row.Algorithm)
		}
		decoded, err := base64.StdEncoding.DecodeString(row.PublicKey)
		if err != nil || len(decoded) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("invalid governance audit public key %s", row.KeyID)
		}
		publicKey := ed25519.PublicKey(append([]byte(nil), decoded...))
		keyHash := sha256.Sum256(publicKey)
		if hex.EncodeToString(keyHash[:8]) != row.KeyID {
			return nil, fmt.Errorf("governance audit public key id mismatch for key %s", row.KeyID)
		}
		keys[row.KeyID] = publicKey
	}
	return keys, nil
}

func (h *GovernanceHandler) loadGovernanceAuditPublicKeys(ctx context.Context) ([]configstoreTables.TableGovernanceAuditPublicKey, map[string]ed25519.PublicKey, error) {
	var rows []configstoreTables.TableGovernanceAuditPublicKey
	if err := h.configStore.DB().WithContext(ctx).Order("created_at ASC, key_id ASC").Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	keys, err := decodeGovernanceAuditPublicKeys(rows)
	if err != nil {
		return nil, nil, err
	}
	_, currentPublicKey, currentKeyID, err := governanceAuditSigningKey()
	if err != nil {
		return nil, nil, err
	}
	if registered, ok := keys[currentKeyID]; ok {
		if !bytes.Equal(registered, currentPublicKey) {
			return nil, nil, fmt.Errorf("governance audit current public key conflicts with registry")
		}
	} else {
		rows = append(rows, configstoreTables.TableGovernanceAuditPublicKey{
			KeyID: currentKeyID, Algorithm: governanceAuditAlgorithm,
			PublicKey: base64.StdEncoding.EncodeToString(currentPublicKey),
		})
	}
	keys[currentKeyID] = currentPublicKey
	return rows, keys, nil
}

type governanceAuditCanonicalEvent struct {
	Sequence            uint64 `json:"sequence"`
	ID                  string `json:"id"`
	SchemaVersion       uint   `json:"schema_version"`
	OccurredAtUnixMicro int64  `json:"occurred_at_unix_micro"`
	ActorID             string `json:"actor_id"`
	ActorName           string `json:"actor_name"`
	AuthMethod          string `json:"auth_method"`
	RoleID              string `json:"role_id,omitempty"`
	LocalAdmin          bool   `json:"local_admin"`
	Action              string `json:"action"`
	Resource            string `json:"resource"`
	ResourceID          string `json:"resource_id"`
	Outcome             string `json:"outcome"`
	RequestID           string `json:"request_id,omitempty"`
	TraceID             string `json:"trace_id,omitempty"`
	BeforeJSON          string `json:"before_json"`
	AfterJSON           string `json:"after_json"`
	MetadataJSON        string `json:"metadata_json"`
	PreviousHash        string `json:"previous_hash"`
	KeyID               string `json:"key_id"`
}

func canonicalGovernanceAuditEvent(event *configstoreTables.TableGovernanceAuditEvent) ([]byte, error) {
	return json.Marshal(governanceAuditCanonicalEvent{
		Sequence: event.Sequence, ID: event.ID, SchemaVersion: event.SchemaVersion,
		OccurredAtUnixMicro: event.OccurredAt.UTC().UnixMicro(), ActorID: event.ActorID, ActorName: event.ActorName,
		AuthMethod: event.AuthMethod, RoleID: event.RoleID, LocalAdmin: event.LocalAdmin,
		Action: event.Action, Resource: event.Resource, ResourceID: event.ResourceID,
		Outcome: event.Outcome, RequestID: event.RequestID, TraceID: event.TraceID, BeforeJSON: event.BeforeJSON,
		AfterJSON: event.AfterJSON, MetadataJSON: event.MetadataJSON,
		PreviousHash: event.PreviousHash, KeyID: event.KeyID,
	})
}

func (s *governanceAuditService) append(ctx context.Context, tx *gorm.DB, input governanceAuditInput) (*governanceAuditReceipt, error) {
	if s == nil || s.store == nil {
		return nil, fmt.Errorf("governance audit store is unavailable")
	}
	privateKey, publicKey, keyID, err := governanceAuditSigningKey()
	if err != nil {
		return nil, err
	}
	beforeJSON, err := canonicalAuditJSON(input.Before)
	if err != nil {
		return nil, err
	}
	afterJSON, err := canonicalAuditJSON(input.After)
	if err != nil {
		return nil, err
	}
	metadataJSON, err := canonicalAuditJSON(input.Metadata)
	if err != nil {
		return nil, err
	}
	if tx == nil {
		return nil, fmt.Errorf("governance audit append requires an existing transaction")
	}
	tx = tx.WithContext(ctx)
	if err := registerGovernanceAuditPublicKey(tx, keyID, publicKey); err != nil {
		return nil, err
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&configstoreTables.TableGovernanceAuditHead{
		ID: governanceAuditHeadID,
	}).Error; err != nil {
		return nil, err
	}
	var head configstoreTables.TableGovernanceAuditHead
	if err := dbForUpdate(tx).First(&head, "id = ?", governanceAuditHeadID).Error; err != nil {
		return nil, err
	}
	event := &configstoreTables.TableGovernanceAuditEvent{
		Sequence: head.LastSequence + 1, ID: uuid.NewString(), SchemaVersion: governanceAuditSchemaVersion,
		OccurredAt: time.Now().UTC().Truncate(time.Microsecond), ActorID: input.Principal.ID, ActorName: input.Principal.Name,
		AuthMethod: input.Principal.AuthMethod, RoleID: input.Principal.RoleID, LocalAdmin: input.Principal.LocalAdmin,
		Action: input.Action, Resource: input.Resource, ResourceID: input.ResourceID,
		Outcome: input.Outcome, RequestID: input.RequestID, TraceID: input.TraceID, BeforeJSON: beforeJSON,
		AfterJSON: afterJSON, MetadataJSON: metadataJSON, PreviousHash: head.LastHash, KeyID: keyID,
	}
	canonical, err := canonicalGovernanceAuditEvent(event)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(canonical)
	event.EventHash = hex.EncodeToString(digest[:])
	event.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, digest[:]))
	if err := tx.Create(event).Error; err != nil {
		return nil, err
	}
	updated := tx.Model(&configstoreTables.TableGovernanceAuditHead{}).
		Where("id = ? AND last_sequence = ? AND last_hash = ?", governanceAuditHeadID, head.LastSequence, head.LastHash).
		Updates(map[string]any{"last_sequence": event.Sequence, "last_hash": event.EventHash, "updated_at": event.OccurredAt})
	if updated.Error != nil {
		return nil, updated.Error
	}
	if updated.RowsAffected != 1 {
		return nil, fmt.Errorf("governance audit chain head changed concurrently")
	}
	return &governanceAuditReceipt{
		EventID: event.ID, Sequence: event.Sequence, EventHash: event.EventHash,
		Signature: event.Signature, KeyID: event.KeyID,
	}, nil
}

func (h *GovernanceHandler) appendGovernanceAudit(ctx *fasthttp.RequestCtx, tx *gorm.DB, input governanceAuditInput) (*governanceAuditReceipt, error) {
	if h.audit == nil {
		return nil, nil
	}
	input.Principal = adminPrincipalFromRequest(ctx)
	input.RequestID = governanceRequestID(ctx)
	input.TraceID = governanceTraceID(ctx)
	return h.audit.append(governanceDatabaseContext(), tx, input)
}

func (h *GovernanceHandler) persistGovernanceAuthorizationDenial(ctx *fasthttp.RequestCtx, principal AdminPrincipal, action, resource, resourceID string) error {
	if !principal.Authenticated || h.audit == nil {
		return nil
	}
	dbCtx := governanceDatabaseContext()
	return h.configStore.ExecuteTransaction(dbCtx, func(tx *gorm.DB) error {
		_, err := h.audit.append(dbCtx, tx, governanceAuditInput{
			Principal: principal, Action: action, Resource: resource, ResourceID: resourceID,
			Outcome: "denied", RequestID: governanceRequestID(ctx), TraceID: governanceTraceID(ctx),
			Metadata: map[string]string{"reason": "admin_auth_or_permission_required"},
		})
		return err
	})
}

func (h *GovernanceHandler) persistGovernanceVirtualKeyReveals(ctx *fasthttp.RequestCtx, virtualKeyIDs []string, source string) error {
	if h.audit == nil || len(virtualKeyIDs) == 0 {
		return nil
	}
	principal := adminPrincipalFromRequest(ctx)
	dbCtx := governanceDatabaseContext()
	return h.configStore.ExecuteTransaction(dbCtx, func(tx *gorm.DB) error {
		for _, virtualKeyID := range virtualKeyIDs {
			if _, err := h.audit.append(dbCtx, tx, governanceAuditInput{
				Principal: principal, Action: "virtual_key.reveal", Resource: "virtual_key", ResourceID: virtualKeyID,
				Outcome: "success", RequestID: governanceRequestID(ctx), TraceID: governanceTraceID(ctx),
				Metadata: map[string]string{"source": source},
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

func (h *GovernanceHandler) requireGovernancePermission(action, resource string, resourceID func(*fasthttp.RequestCtx) string, next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		principal := adminPrincipalFromRequest(ctx)
		authorizer := h.authorizer
		if authorizer == nil {
			authorizer = contextGovernanceAuthorizer{}
		}
		id := ""
		if resourceID != nil {
			id = resourceID(ctx)
		}
		authorizationResource := resource
		if id != "" {
			authorizationResource += "/" + id
		}
		if err := authorizer.Authorize(ctx, principal, action, authorizationResource); err == nil {
			next(ctx)
			return
		}
		if principal.Authenticated {
			if auditErr := h.persistGovernanceAuthorizationDenial(ctx, principal, action, resource, id); auditErr != nil {
				logger.Error("failed to persist denied governance audit event: %v", auditErr)
				SendError(ctx, fasthttp.StatusInternalServerError, "Authorization denied and audit logging failed")
				return
			}
		}
		SendError(ctx, fasthttp.StatusForbidden, "admin_auth_required")
	}
}

func governanceResourceID(ctx *fasthttp.RequestCtx) string {
	if value, _ := ctx.UserValue("vk_id").(string); value != "" {
		return value
	}
	return "collection"
}

func governanceBudgetResourceID(ctx *fasthttp.RequestCtx) string {
	vkID, _ := ctx.UserValue("vk_id").(string)
	budgetID, _ := ctx.UserValue("budget_id").(string)
	if vkID == "" {
		return "collection"
	}
	if budgetID == "" {
		return vkID
	}
	return vkID + "/budgets/" + budgetID
}

func auditEventID(ctx *fasthttp.RequestCtx) string {
	value, _ := ctx.UserValue("audit_id").(string)
	return value
}

func (h *GovernanceHandler) getGovernanceAuditLogs(ctx *fasthttp.RequestCtx) {
	limit, offset := ClampPaginationParams(parseIntQuery(ctx, "limit"), parseIntQuery(ctx, "offset"))
	db := h.configStore.DB().WithContext(governanceDatabaseContext()).Model(&configstoreTables.TableGovernanceAuditEvent{})
	for column, queryName := range map[string]string{
		"actor_id": "actor_id", "action": "action", "resource": "resource", "resource_id": "resource_id", "outcome": "outcome",
	} {
		if value := strings.TrimSpace(string(ctx.QueryArgs().Peek(queryName))); value != "" {
			db = db.Where(column+" = ?", value)
		}
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to query governance audit logs")
		return
	}
	var events []configstoreTables.TableGovernanceAuditEvent
	if err := db.Order("sequence DESC").Limit(limit).Offset(offset).Find(&events).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to query governance audit logs")
		return
	}
	SendJSON(ctx, map[string]any{"audit_logs": events, "count": len(events), "total_count": total, "limit": limit, "offset": offset})
}

func parseIntQuery(ctx *fasthttp.RequestCtx, name string) int {
	value, _ := strconv.Atoi(string(ctx.QueryArgs().Peek(name)))
	return value
}

type governanceAuditVerifyResult struct {
	Valid                  bool   `json:"valid"`
	CheckedThroughSequence uint64 `json:"checked_through_sequence"`
	HeadSequence           uint64 `json:"head_sequence"`
	HeadHash               string `json:"head_hash"`
	FailureSequence        uint64 `json:"failure_sequence,omitempty"`
	Reason                 string `json:"reason,omitempty"`
}

func verifyGovernanceAuditEventsWithKeys(events []configstoreTables.TableGovernanceAuditEvent, head configstoreTables.TableGovernanceAuditHead, publicKeys map[string]ed25519.PublicKey) governanceAuditVerifyResult {
	result := governanceAuditVerifyResult{Valid: true, HeadSequence: head.LastSequence, HeadHash: head.LastHash}
	previousHash := ""
	for i := range events {
		event := &events[i]
		expectedSequence := uint64(i + 1)
		if event.Sequence != expectedSequence {
			result.Valid, result.FailureSequence, result.Reason = false, expectedSequence, "audit sequence is not continuous"
			return result
		}
		if event.PreviousHash != previousHash {
			result.Valid, result.FailureSequence, result.Reason = false, event.Sequence, "previous hash mismatch"
			return result
		}
		publicKey, ok := publicKeys[event.KeyID]
		if !ok {
			result.Valid, result.FailureSequence, result.Reason = false, event.Sequence, "unknown audit signing key"
			return result
		}
		canonical, marshalErr := canonicalGovernanceAuditEvent(event)
		if marshalErr != nil {
			result.Valid, result.FailureSequence, result.Reason = false, event.Sequence, marshalErr.Error()
			return result
		}
		digest := sha256.Sum256(canonical)
		if event.EventHash != hex.EncodeToString(digest[:]) {
			result.Valid, result.FailureSequence, result.Reason = false, event.Sequence, "event hash mismatch"
			return result
		}
		signature, decodeErr := base64.StdEncoding.DecodeString(event.Signature)
		if decodeErr != nil || !ed25519.Verify(publicKey, digest[:], signature) {
			result.Valid, result.FailureSequence, result.Reason = false, event.Sequence, "event signature mismatch"
			return result
		}
		previousHash = event.EventHash
		result.CheckedThroughSequence = event.Sequence
	}
	if uint64(len(events)) != head.LastSequence || previousHash != head.LastHash {
		result.Valid, result.FailureSequence, result.Reason = false, uint64(len(events))+1, "audit head does not match stored events"
	}
	return result
}

func verifyGovernanceAuditEvents(events []configstoreTables.TableGovernanceAuditEvent, head configstoreTables.TableGovernanceAuditHead) governanceAuditVerifyResult {
	_, publicKey, keyID, err := governanceAuditSigningKey()
	if err != nil {
		return governanceAuditVerifyResult{Valid: false, HeadSequence: head.LastSequence, HeadHash: head.LastHash, Reason: err.Error()}
	}
	return verifyGovernanceAuditEventsWithKeys(events, head, map[string]ed25519.PublicKey{keyID: publicKey})
}

func (h *GovernanceHandler) loadGovernanceAuditChain(ctx context.Context) ([]configstoreTables.TableGovernanceAuditEvent, configstoreTables.TableGovernanceAuditHead, error) {
	var head configstoreTables.TableGovernanceAuditHead
	err := h.configStore.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		// Snapshot the authoritative tail under the same lock used by append, then
		// release it before scanning events so verification/export never blocks
		// governance writes for the duration of an O(N) read.
		if err := dbForUpdate(tx.WithContext(ctx)).First(&head, "id = ?", governanceAuditHeadID).Error; err != nil {
			return err
		}
		if head.LastSequence > governanceAuditMaxOnlineEvents {
			return errGovernanceAuditOnlineLimit
		}
		return nil
	})
	if err != nil {
		return nil, head, err
	}
	var events []configstoreTables.TableGovernanceAuditEvent
	err = h.configStore.DB().WithContext(ctx).
		Where("sequence <= ?", head.LastSequence).
		Order("sequence ASC").
		Limit(governanceAuditMaxOnlineEvents).
		Find(&events).Error
	return events, head, err
}

func (h *GovernanceHandler) verifyGovernanceAuditLog(ctx *fasthttp.RequestCtx) {
	dbCtx := governanceDatabaseContext()
	_, publicKeys, err := h.loadGovernanceAuditPublicKeys(dbCtx)
	if err != nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, err.Error())
		return
	}
	id := auditEventID(ctx)
	var target configstoreTables.TableGovernanceAuditEvent
	if err := h.configStore.DB().WithContext(dbCtx).First(&target, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Governance audit event not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to load governance audit event")
		return
	}
	if target.Sequence > governanceAuditMaxOnlineEvents {
		SendError(ctx, fasthttp.StatusRequestEntityTooLarge, errGovernanceAuditOnlineLimit.Error())
		return
	}
	var events []configstoreTables.TableGovernanceAuditEvent
	if err := h.configStore.DB().WithContext(dbCtx).Where("sequence <= ?", target.Sequence).Order("sequence ASC").Find(&events).Error; err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to load governance audit chain")
		return
	}
	head := configstoreTables.TableGovernanceAuditHead{LastSequence: target.Sequence, LastHash: target.EventHash}
	result := verifyGovernanceAuditEventsWithKeys(events, head, publicKeys)
	status := fasthttp.StatusOK
	if !result.Valid {
		status = fasthttp.StatusConflict
	}
	SendJSONWithStatus(ctx, result, status)
}

func (h *GovernanceHandler) verifyGovernanceAuditChain(ctx *fasthttp.RequestCtx) {
	dbCtx := governanceDatabaseContext()
	_, publicKeys, err := h.loadGovernanceAuditPublicKeys(dbCtx)
	if err != nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, err.Error())
		return
	}
	events, head, err := h.loadGovernanceAuditChain(dbCtx)
	if err != nil {
		if errors.Is(err, errGovernanceAuditOnlineLimit) {
			SendError(ctx, fasthttp.StatusRequestEntityTooLarge, err.Error())
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to load governance audit chain")
		return
	}
	result := verifyGovernanceAuditEventsWithKeys(events, head, publicKeys)
	status := fasthttp.StatusOK
	if !result.Valid {
		status = fasthttp.StatusConflict
	}
	SendJSONWithStatus(ctx, result, status)
}

func (h *GovernanceHandler) getGovernanceAuditPublicKey(ctx *fasthttp.RequestCtx) {
	rows, _, err := h.loadGovernanceAuditPublicKeys(governanceDatabaseContext())
	if err != nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, err.Error())
		return
	}
	_, publicKey, keyID, err := governanceAuditSigningKey()
	if err != nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, err.Error())
		return
	}
	SendJSON(ctx, map[string]any{
		"algorithm": governanceAuditAlgorithm, "key_id": keyID,
		"public_key": base64.StdEncoding.EncodeToString(publicKey),
		"keys":       rows,
	})
}

type governanceAuditExportManifest struct {
	SchemaVersion uint      `json:"schema_version"`
	FirstSequence uint64    `json:"first_sequence"`
	LastSequence  uint64    `json:"last_sequence"`
	Count         int       `json:"count"`
	HeadHash      string    `json:"head_hash"`
	ExportedAt    time.Time `json:"exported_at"`
	KeyID         string    `json:"key_id"`
}

func (h *GovernanceHandler) exportGovernanceAuditLogs(ctx *fasthttp.RequestCtx) {
	dbCtx := governanceDatabaseContext()
	keyRows, publicKeys, err := h.loadGovernanceAuditPublicKeys(dbCtx)
	if err != nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, err.Error())
		return
	}
	events, head, err := h.loadGovernanceAuditChain(dbCtx)
	if err != nil {
		if errors.Is(err, errGovernanceAuditOnlineLimit) {
			SendError(ctx, fasthttp.StatusRequestEntityTooLarge, err.Error())
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to export governance audit logs")
		return
	}
	verification := verifyGovernanceAuditEventsWithKeys(events, head, publicKeys)
	if !verification.Valid {
		SendJSONWithStatus(ctx, map[string]any{"verification": verification}, fasthttp.StatusConflict)
		return
	}
	privateKey, _, keyID, err := governanceAuditSigningKey()
	if err != nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, err.Error())
		return
	}
	manifest := governanceAuditExportManifest{
		SchemaVersion: governanceAuditSchemaVersion, Count: len(events), HeadHash: head.LastHash,
		ExportedAt: time.Now().UTC(), KeyID: keyID,
	}
	if len(events) > 0 {
		manifest.FirstSequence = events[0].Sequence
		manifest.LastSequence = events[len(events)-1].Sequence
	}
	canonicalManifest, _ := json.Marshal(manifest)
	manifestDigest := sha256.Sum256(canonicalManifest)
	response := map[string]any{
		"manifest": manifest, "manifest_hash": hex.EncodeToString(manifestDigest[:]),
		"manifest_signature": base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, manifestDigest[:])),
		"public_keys":        keyRows,
		"events":             events,
	}
	ctx.Response.Header.Set("Content-Disposition", `attachment; filename="governance-audit-export.json"`)
	SendJSON(ctx, response)
}
