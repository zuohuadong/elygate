package handlers

import (
	"bufio"
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
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/bytedance/sonic"
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
	// governanceAuditMaxExportEvents bounds an export, not an interactive verify.
	// The chain is the compliance record, so "too big to verify in a request" must
	// not also mean "too big to export": the export is how an operator takes a
	// chain that outgrew the online limit somewhere it can be verified offline.
	governanceAuditMaxExportEvents = 250_000
	// governanceAuditExportBatchSize is the per-query page size for an export, so a
	// large chain is read in bounded chunks instead of one unbounded SELECT.
	governanceAuditExportBatchSize = 2_000
	// governanceAuditMaxExportBytes bounds the export file an operator can pull in
	// one request. The export is written to a temp file (so a mid-walk failure can
	// never hand back a truncated "complete" download) and that file must not be
	// allowed to fill the volume.
	governanceAuditMaxExportBytes = 512 << 20
)

var (
	errGovernanceForbidden        = errors.New("governance action is not authorized")
	errGovernanceAuditOnlineLimit = errors.New("governance audit chain exceeds the online verification limit")
	errGovernanceAuditExportLimit = errors.New("governance audit chain exceeds the export limit")
	errGovernanceAuditExportSize  = errors.New("governance audit export exceeds the size limit")
	// errGovernanceAuditChainChanged means the rows stopped forming one continuous
	// chain under the walk: retention deleted events, or an event was removed. The
	// export refuses rather than shipping a file the manifest cannot describe.
	errGovernanceAuditChainChanged = errors.New("governance audit chain changed while exporting")
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

// GovernanceAuditInput is the exported shape used by callers outside this
// package (employee administration, control-plane tooling) to append an entry
// to the signed governance audit chain.
type GovernanceAuditInput struct {
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

// AppendGovernanceAudit appends one signed event inside the caller's
// transaction, so the mutation and its audit entry commit together.
func AppendGovernanceAudit(ctx context.Context, store configstore.ConfigStore, tx *gorm.DB, input GovernanceAuditInput) error {
	if store == nil {
		return fmt.Errorf("governance audit requires config storage")
	}
	service := &governanceAuditService{store: store}
	_, err := service.append(ctx, tx, governanceAuditInput{
		Principal: input.Principal, Action: input.Action, Resource: input.Resource,
		ResourceID: input.ResourceID, Outcome: input.Outcome, RequestID: input.RequestID,
		TraceID: input.TraceID, Before: input.Before, After: input.After, Metadata: input.Metadata,
	})
	return err
}

// AdminPrincipalFromRequest exposes the authenticated admin identity attached
// to an admin request so other packages can audit with the same principal.
func AdminPrincipalFromRequest(ctx *fasthttp.RequestCtx) AdminPrincipal {
	return adminPrincipalFromRequest(ctx)
}

// GovernanceRequestIDFromRequest returns the request id used in audit entries.
func GovernanceRequestIDFromRequest(ctx *fasthttp.RequestCtx) string {
	return governanceRequestID(ctx)
}

// GovernanceTraceIDFromRequest returns the trace id used in audit entries.
func GovernanceTraceIDFromRequest(ctx *fasthttp.RequestCtx) string {
	return governanceTraceID(ctx)
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

// governanceAuditChainVerifier walks a chain page by page, so a chain too large to
// hold in memory can still be verified. It is the only implementation of the chain
// rules: verifyGovernanceAuditEventsWithKeys drives it over an in-memory slice, and
// the streaming export drives it over pages.
type governanceAuditChainVerifier struct {
	publicKeys   map[string]ed25519.PublicKey
	previousHash string
	eventsCount  int
	checked      uint64
	failure      uint64
	reason       string
	failed       bool
}

func newGovernanceAuditChainVerifier(publicKeys map[string]ed25519.PublicKey) *governanceAuditChainVerifier {
	return &governanceAuditChainVerifier{publicKeys: publicKeys}
}

// add verifies the next page. Once a check has failed the remaining pages are
// ignored: the caller only needs the first failure.
func (v *governanceAuditChainVerifier) add(events []configstoreTables.TableGovernanceAuditEvent) {
	if v.failed {
		return
	}
	for i := range events {
		event := &events[i]
		expectedSequence := uint64(v.eventsCount + 1)
		if event.Sequence != expectedSequence {
			v.fail(expectedSequence, "audit sequence is not continuous")
			return
		}
		if event.PreviousHash != v.previousHash {
			v.fail(event.Sequence, "previous hash mismatch")
			return
		}
		publicKey, ok := v.publicKeys[event.KeyID]
		if !ok {
			v.fail(event.Sequence, "unknown audit signing key")
			return
		}
		canonical, marshalErr := canonicalGovernanceAuditEvent(event)
		if marshalErr != nil {
			v.fail(event.Sequence, marshalErr.Error())
			return
		}
		digest := sha256.Sum256(canonical)
		if event.EventHash != hex.EncodeToString(digest[:]) {
			v.fail(event.Sequence, "event hash mismatch")
			return
		}
		signature, decodeErr := base64.StdEncoding.DecodeString(event.Signature)
		if decodeErr != nil || !ed25519.Verify(publicKey, digest[:], signature) {
			v.fail(event.Sequence, "event signature mismatch")
			return
		}
		v.previousHash = event.EventHash
		v.eventsCount++
		v.checked = event.Sequence
	}
}

// Failed reports whether a check has already refused the chain, so a caller that
// writes while it verifies can stop before appending another event.
func (v *governanceAuditChainVerifier) Failed() bool { return v.failed }

func (v *governanceAuditChainVerifier) Reason() string { return v.reason }

func (v *governanceAuditChainVerifier) FailureSequence() uint64 { return v.failure }

func (v *governanceAuditChainVerifier) fail(sequence uint64, reason string) {
	v.failed, v.failure, v.reason = true, sequence, reason
}

// finish compares what was verified against the head the walk started from.
func (v *governanceAuditChainVerifier) finish(head configstoreTables.TableGovernanceAuditHead) governanceAuditVerifyResult {
	result := governanceAuditVerifyResult{
		Valid:                  !v.failed,
		CheckedThroughSequence: v.checked,
		HeadSequence:           head.LastSequence,
		HeadHash:               head.LastHash,
	}
	if v.failed {
		result.FailureSequence, result.Reason = v.failure, v.reason
		return result
	}
	if uint64(v.eventsCount) != head.LastSequence || v.previousHash != head.LastHash {
		result.Valid, result.FailureSequence, result.Reason = false, uint64(v.eventsCount)+1, "audit head does not match stored events"
	}
	return result
}

func verifyGovernanceAuditEventsWithKeys(events []configstoreTables.TableGovernanceAuditEvent, head configstoreTables.TableGovernanceAuditHead, publicKeys map[string]ed25519.PublicKey) governanceAuditVerifyResult {
	verifier := newGovernanceAuditChainVerifier(publicKeys)
	verifier.add(events)
	return verifier.finish(head)
}

func verifyGovernanceAuditEvents(events []configstoreTables.TableGovernanceAuditEvent, head configstoreTables.TableGovernanceAuditHead) governanceAuditVerifyResult {
	_, publicKey, keyID, err := governanceAuditSigningKey()
	if err != nil {
		return governanceAuditVerifyResult{Valid: false, HeadSequence: head.LastSequence, HeadHash: head.LastHash, Reason: err.Error()}
	}
	return verifyGovernanceAuditEventsWithKeys(events, head, map[string]ed25519.PublicKey{keyID: publicKey})
}

// auditOnlineEventLimit is the interactive-verify cap: verifying replays the whole
// chain inside one request.
func (h *GovernanceHandler) auditOnlineEventLimit() int {
	if h.auditOnlineLimit > 0 {
		return h.auditOnlineLimit
	}
	return governanceAuditMaxOnlineEvents
}

// auditExportEventLimit is the export cap. It is deliberately far above the online
// one, because an export is the only remaining way to verify a chain that outgrew
// interactive verification.
func (h *GovernanceHandler) auditExportEventLimit() int {
	if h.auditExportLimit > 0 {
		return h.auditExportLimit
	}
	return governanceAuditMaxExportEvents
}

// auditExportMaxBytes is the export size ceiling.
func (h *GovernanceHandler) auditExportMaxBytes() int {
	if h.auditExportMaxBytesLimit > 0 {
		return h.auditExportMaxBytesLimit
	}
	return governanceAuditMaxExportBytes
}

// loadGovernanceAuditHead snapshots the chain tail under the same lock the append
// path uses, and refuses a chain longer than maxEvents. The refusal wraps the
// sentinel naming the policy the caller hit and carries the numbers plus the next
// step, since "413" alone leaves an operator with a compliance record they cannot
// read. `export` selects which policy a refusal names: it is explicit rather than
// inferred from maxEvents, because the two caps can coincide.
func (h *GovernanceHandler) loadGovernanceAuditHead(ctx context.Context, maxEvents int, export bool) (configstoreTables.TableGovernanceAuditHead, error) {
	var head configstoreTables.TableGovernanceAuditHead
	err := h.configStore.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		// Release the lock before scanning events so verification/export never
		// blocks governance writes for the duration of an O(N) read.
		if err := dbForUpdate(tx.WithContext(ctx)).First(&head, "id = ?", governanceAuditHeadID).Error; err != nil {
			return err
		}
		if head.LastSequence > uint64(maxEvents) {
			return &governanceAuditChainTooLargeError{
				sequence: head.LastSequence,
				limit:    maxEvents,
				export:   export,
			}
		}
		return nil
	})
	return head, err
}

// auditExportPageSize is the number of events read and streamed per page.
func (h *GovernanceHandler) auditExportPageSize() int {
	if h.auditExportBatchSize > 0 {
		return h.auditExportBatchSize
	}
	return governanceAuditExportBatchSize
}

// eachGovernanceAuditPage reads the snapshot frozen by head in bounded pages. Rows
// at or below head.LastSequence are immutable, and pages advance by sequence rather
// than by OFFSET: an OFFSET walk skips an unread event when an earlier one is
// deleted underneath it, which would silently export a chain with a hole.
func (h *GovernanceHandler) eachGovernanceAuditPage(ctx context.Context, head configstoreTables.TableGovernanceAuditHead, maxEvents int, fn func([]configstoreTables.TableGovernanceAuditEvent) error) error {
	pageSize := h.auditExportPageSize()
	var lastSequence uint64
	firstPage := true
	seen := 0
	for seen < maxEvents {
		remaining := maxEvents - seen
		if remaining < pageSize {
			pageSize = remaining
		}
		var page []configstoreTables.TableGovernanceAuditEvent
		query := h.configStore.DB().WithContext(ctx).
			Where("sequence <= ?", head.LastSequence).
			Order("sequence ASC").
			Limit(pageSize)
		// The first page has no lower bound: a row at sequence 0 is not a valid chain
		// entry, and the verifier has to see it to refuse the chain. Excluding it here
		// would hide the anomaly and let verification pass on a chain that is not the
		// one stored.
		if !firstPage {
			query = query.Where("sequence > ?", lastSequence)
		}
		firstPage = false
		if err := query.Find(&page).Error; err != nil {
			return err
		}
		if len(page) == 0 {
			return nil
		}
		if err := fn(page); err != nil {
			return err
		}
		seen += len(page)
		lastSequence = page[len(page)-1].Sequence
		if len(page) < pageSize {
			return nil
		}
	}
	return nil
}

// loadGovernanceAuditChain reads the whole chain for an interactive verify, which
// holds it only up to the online cap.
func (h *GovernanceHandler) loadGovernanceAuditChain(ctx context.Context, maxEvents int, export bool) ([]configstoreTables.TableGovernanceAuditEvent, configstoreTables.TableGovernanceAuditHead, error) {
	head, err := h.loadGovernanceAuditHead(ctx, maxEvents, export)
	if err != nil {
		return nil, head, err
	}
	events := make([]configstoreTables.TableGovernanceAuditEvent, 0, head.LastSequence)
	err = h.eachGovernanceAuditPage(ctx, head, maxEvents, func(page []configstoreTables.TableGovernanceAuditEvent) error {
		events = append(events, page...)
		return nil
	})
	return events, head, err
}

// governanceAuditChainTooLargeError is the refusal a caller gets when the chain is
// longer than the policy they hit. It unwraps to the sentinel for that policy so
// handlers keep mapping it to 413, and its message tells the operator the size, the
// cap and what to do next.
type governanceAuditChainTooLargeError struct {
	sequence uint64
	limit    int
	export   bool
}

func (e *governanceAuditChainTooLargeError) Error() string {
	if e.export {
		return fmt.Sprintf("%s: the chain has %d events, above the %d-event export limit",
			errGovernanceAuditExportLimit.Error(), e.sequence, e.limit)
	}
	return fmt.Sprintf("%s: the chain has %d events, above the %d-event online verification limit; export the chain (GET /api/governance/audit-logs/export) and verify the exported file offline",
		errGovernanceAuditOnlineLimit.Error(), e.sequence, e.limit)
}

func (e *governanceAuditChainTooLargeError) Unwrap() error {
	if e.export {
		return errGovernanceAuditExportLimit
	}
	return errGovernanceAuditOnlineLimit
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
	if onlineLimit := h.auditOnlineEventLimit(); target.Sequence > uint64(onlineLimit) {
		SendError(ctx, fasthttp.StatusRequestEntityTooLarge, (&governanceAuditChainTooLargeError{
			sequence: target.Sequence, limit: onlineLimit,
		}).Error())
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
	events, head, err := h.loadGovernanceAuditChain(dbCtx, h.auditOnlineEventLimit(), false)
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

// governanceAuditExportFile is the finished export handed to fasthttp. Its Close
// removes the temp file after the handle is closed: on Windows an open file cannot
// be deleted, so removing it while it is still open would silently fail and leave the
// export behind on every download. fasthttp closes the body stream once the response
// is written or discarded, which is when the removal is safe on every platform.
type governanceAuditExportFile struct {
	file   *os.File
	path   string
	closed bool
}

func (f *governanceAuditExportFile) Read(p []byte) (int, error) { return f.file.Read(p) }

// Close is idempotent: fasthttp may close a body stream it has already discarded.
func (f *governanceAuditExportFile) Close() error {
	if f.closed {
		return nil
	}
	f.closed = true
	closeErr := f.file.Close()
	if removeErr := os.Remove(f.path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) && closeErr == nil {
		closeErr = removeErr
	}
	return closeErr
}

func (h *GovernanceHandler) exportGovernanceAuditLogs(ctx *fasthttp.RequestCtx) {
	dbCtx := governanceDatabaseContext()
	keyRows, publicKeys, err := h.loadGovernanceAuditPublicKeys(dbCtx)
	if err != nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, err.Error())
		return
	}
	exportLimit := h.auditExportEventLimit()
	head, err := h.loadGovernanceAuditHead(dbCtx, exportLimit, true)
	if err != nil {
		if errors.Is(err, errGovernanceAuditExportLimit) || errors.Is(err, errGovernanceAuditOnlineLimit) {
			SendError(ctx, fasthttp.StatusRequestEntityTooLarge, err.Error())
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to export governance audit logs")
		return
	}
	privateKey, _, keyID, err := governanceAuditSigningKey()
	if err != nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, err.Error())
		return
	}
	manifest := governanceAuditExportManifest{
		SchemaVersion: governanceAuditSchemaVersion, Count: int(head.LastSequence), HeadHash: head.LastHash,
		ExportedAt: time.Now().UTC(), KeyID: keyID,
	}
	if head.LastSequence > 0 {
		manifest.FirstSequence = 1
		manifest.LastSequence = head.LastSequence
	}
	canonicalManifest, _ := json.Marshal(manifest)
	manifestDigest := sha256.Sum256(canonicalManifest)
	header, err := sonic.ConfigStd.Marshal(map[string]any{
		"manifest": manifest, "manifest_hash": hex.EncodeToString(manifestDigest[:]),
		"manifest_signature": base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, manifestDigest[:])),
		"public_keys":        keyRows,
	})
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to encode governance audit export")
		return
	}

	// The export is serialized to a temp file while it is verified, then sent. A
	// response streamed straight from the database would start after verification
	// succeeded and still fail mid-way: fasthttp ends the chunked body normally, so
	// the operator would get a 200 and a truncated file that looks like a complete
	// export. Writing first also keeps memory at O(page).
	tmp, err := os.CreateTemp("", "governance-audit-export-*.json")
	if err != nil {
		logger.Error("governance audit export: failed to create temp file: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to export governance audit logs")
		return
	}
	tmpPath := tmp.Name()
	// Until the file is handed to fasthttp, this defer is the only cleanup. After the
	// handoff the stream owns removal (see governanceAuditExportFile), because the
	// deferred remove would run while the handle is still open.
	handedOff := false
	defer func() {
		if !handedOff {
			os.Remove(tmpPath)
		}
	}()
	// One accounting point for the size ceiling: every byte that reaches the file is
	// counted here, header and closing punctuation included, so a cap can never be
	// exceeded by the bytes written around the events.
	maxBytes := h.auditExportMaxBytes()
	written := 0
	writeChunk := func(w *bufio.Writer, data []byte) error {
		if written+len(data) > maxBytes {
			return errGovernanceAuditExportSize
		}
		n, err := w.Write(data)
		written += n
		return err
	}
	writer := bufio.NewWriterSize(tmp, 64<<10)
	if err := writeChunk(writer, append(header[:len(header)-1], `,"events":[`...)); err != nil {
		tmp.Close()
		if errors.Is(err, errGovernanceAuditExportSize) {
			SendError(ctx, fasthttp.StatusRequestEntityTooLarge, fmt.Sprintf("%s: the export would exceed %d bytes", errGovernanceAuditExportSize.Error(), maxBytes))
			return
		}
		logger.Error("governance audit export: failed to write header: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to export governance audit logs")
		return
	}

	verifier := newGovernanceAuditChainVerifier(publicKeys)
	first := true
	walkErr := h.eachGovernanceAuditPage(dbCtx, head, exportLimit, func(page []configstoreTables.TableGovernanceAuditEvent) error {
		verifier.add(page)
		if verifier.Failed() {
			// The chain stopped forming one continuous history under us (retention
			// or a deletion). Stop before writing a page the manifest cannot cover.
			return errGovernanceAuditChainChanged
		}
		for i := range page {
			encoded, err := sonic.ConfigStd.Marshal(&page[i])
			if err != nil {
				return err
			}
			if !first {
				if err := writeChunk(writer, []byte{','}); err != nil {
					return err
				}
			}
			first = false
			if err := writeChunk(writer, encoded); err != nil {
				return err
			}
		}
		return nil
	})
	if walkErr == nil {
		walkErr = writeChunk(writer, []byte("]}\n"))
	}
	if walkErr == nil {
		walkErr = writer.Flush()
	}
	if closeErr := tmp.Close(); walkErr == nil {
		walkErr = closeErr
	}
	if walkErr != nil {
		switch {
		case errors.Is(walkErr, errGovernanceAuditExportSize):
			SendError(ctx, fasthttp.StatusRequestEntityTooLarge, fmt.Sprintf("%s: the export would exceed %d bytes", errGovernanceAuditExportSize.Error(), maxBytes))
		case errors.Is(walkErr, errGovernanceAuditChainChanged):
			SendError(ctx, fasthttp.StatusConflict, fmt.Sprintf("%s: %s at sequence %d; retry once the chain is stable",
				errGovernanceAuditChainChanged.Error(), verifier.Reason(), verifier.FailureSequence()))
		default:
			logger.Error("governance audit export: failed to build export: %v", walkErr)
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to export governance audit logs")
		}
		return
	}
	verification := verifier.finish(head)
	if !verification.Valid {
		// A complete, unbroken walk already closed the file; this only catches a
		// mismatch between what was written and the head the walk started from.
		SendJSONWithStatus(ctx, map[string]any{"verification": verification}, fasthttp.StatusConflict)
		return
	}
	// Hand the finished file to fasthttp as a fixed-length body stream rather than
	// through ctx.SendFile: SendFile lets fasthttp keep a compressed sibling of the
	// response next to it when the client sends Accept-Encoding, and that sibling is
	// keyed by this export's unique temp name, so repeated exports would leak one
	// never-collected file each. A body stream is never compressed, its declared
	// length means a short read aborts the transfer instead of ending it normally,
	// and fasthttp closes the reader once the response is written.
	exportFile, err := os.Open(tmpPath)
	if err != nil {
		logger.Error("governance audit export: failed to reopen export: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to export governance audit logs")
		return
	}
	ctx.Response.Header.Set("Content-Disposition", `attachment; filename="governance-audit-export.json"`)
	ctx.SetContentType("application/json")
	ctx.Response.SetBodyStream(&governanceAuditExportFile{file: exportFile, path: tmpPath}, written)
	handedOff = true
}
