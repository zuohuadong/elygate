package handlers

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

type auditTestGovernanceManager struct {
	GovernanceManager
	store               configstore.ConfigStore
	reloadCalls         int
	failReloadCall      int
	removeVirtualKeyErr error
}

type governanceAuthorizerFunc func(context.Context, AdminPrincipal, string, string) error

func (f governanceAuthorizerFunc) Authorize(ctx context.Context, principal AdminPrincipal, action, resource string) error {
	return f(ctx, principal, action, resource)
}

func (m *auditTestGovernanceManager) ReloadVirtualKey(ctx context.Context, id string) (*configstoreTables.TableVirtualKey, error) {
	m.reloadCalls++
	if m.failReloadCall > 0 && m.reloadCalls == m.failReloadCall {
		return nil, context.Canceled
	}
	return m.store.GetVirtualKey(ctx, id)
}

func (m *auditTestGovernanceManager) RemoveVirtualKey(context.Context, string) error {
	return m.removeVirtualKeyErr
}

const governanceAuditTestEncryptionKey = "elygate-governance-audit-test-key-32-bytes"

func setupGovernanceAuditHandler(t *testing.T) (*GovernanceHandler, configstore.ConfigStore, *router.Router) {
	t.Helper()
	logger := &mockLogger{}
	SetLogger(logger)
	encrypt.Init(governanceAuditTestEncryptionKey, logger)
	t.Cleanup(func() { encrypt.Init("", logger) })

	store, err := configstore.NewConfigStore(context.Background(), &configstore.Config{
		Enabled: true,
		Type:    configstore.ConfigStoreTypeSQLite,
		Config:  &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "governance-audit.db")},
	}, logger)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close(context.Background())) })

	manager := &auditTestGovernanceManager{store: store}
	handler, err := NewGovernanceHandler(manager, store, nil, nil)
	require.NoError(t, err)
	r := router.New()
	handler.RegisterRoutes(r)
	return handler, store, r
}

func performGovernanceAuditRequest(r *router.Router, method, uri, body string, localAdmin bool) *fasthttp.RequestCtx {
	ctx := &fasthttp.RequestCtx{}
	ctx.Init(&fasthttp.Request{}, nil, nil)
	ctx.Request.Header.SetMethod(method)
	ctx.Request.SetRequestURI(uri)
	if body != "" {
		ctx.Request.SetBodyString(body)
	}
	if localAdmin {
		ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
	}
	r.Handler(ctx)
	return ctx
}

func performGovernanceEnterpriseRequest(r *router.Router, method, uri, body string, permissions ...string) *fasthttp.RequestCtx {
	ctx := &fasthttp.RequestCtx{}
	ctx.Init(&fasthttp.Request{}, nil, nil)
	ctx.Request.Header.SetMethod(method)
	ctx.Request.SetRequestURI(uri)
	if body != "" {
		ctx.Request.SetBodyString(body)
	}
	ctx.SetUserValue(schemas.BifrostContextKeyUserID, "employee-1")
	ctx.SetUserValue(schemas.BifrostContextKeyUserName, "Employee")
	ctx.SetUserValue(schemas.BifrostContextKeyAdminPermissions, permissions)
	r.Handler(ctx)
	return ctx
}

func createGovernanceAuditTestVirtualKey(t *testing.T, store configstore.ConfigStore, id, value string) {
	t.Helper()
	active := true
	require.NoError(t, store.CreateVirtualKey(context.Background(), &configstoreTables.TableVirtualKey{
		ID: id, Name: "Production " + id, Value: *schemas.NewSecretVar(value), IsActive: &active,
	}))
}

func TestGovernanceVirtualKeyWriteRejectsAuthBypass(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	createGovernanceAuditTestVirtualKey(t, store, "vk-bypass", "sk-bf-do-not-log")

	requests := []struct {
		name   string
		method string
		uri    string
		body   string
	}{
		{name: "create", method: fasthttp.MethodPost, uri: "/api/governance/virtual-keys", body: `{"name":"bypassed create"}`},
		{name: "update", method: fasthttp.MethodPut, uri: "/api/governance/virtual-keys/vk-bypass", body: `{"name":"bypassed update"}`},
		{name: "rotate", method: fasthttp.MethodPost, uri: "/api/governance/virtual-keys/vk-bypass/rotate"},
		{name: "delete", method: fasthttp.MethodDelete, uri: "/api/governance/virtual-keys/vk-bypass"},
	}
	for _, request := range requests {
		t.Run(request.name, func(t *testing.T) {
			ctx := &fasthttp.RequestCtx{}
			ctx.Init(&fasthttp.Request{}, nil, nil)
			ctx.Request.Header.SetMethod(request.method)
			ctx.Request.SetRequestURI(request.uri)
			ctx.Request.SetBodyString(request.body)
			ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
			ctx.SetUserValue(schemas.BifrostContextKeyAuthBypassed, true)
			r.Handler(ctx)
			require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode(), string(ctx.Response.Body()))
		})
	}

	stored, err := store.GetVirtualKey(context.Background(), "vk-bypass")
	require.NoError(t, err)
	require.Equal(t, "Production vk-bypass", stored.Name)
	require.Equal(t, "sk-bf-do-not-log", stored.Value.GetValue())
	var keyCount int64
	require.NoError(t, store.DB().Model(&configstoreTables.TableVirtualKey{}).Count(&keyCount).Error)
	require.Equal(t, int64(1), keyCount)
	var eventCount int64
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditEvent{}).Count(&eventCount).Error)
	require.Zero(t, eventCount)
}

func TestGovernanceVirtualKeyWriteIgnoresClientClaimedAdminHeaders(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	createGovernanceAuditTestVirtualKey(t, store, "vk-client-claims", "sk-bf-client-claims")

	ctx := &fasthttp.RequestCtx{}
	ctx.Init(&fasthttp.Request{}, nil, nil)
	ctx.Request.Header.SetMethod(fasthttp.MethodPost)
	ctx.Request.Header.Set("x-bifrost-user-id", "claimed-admin")
	ctx.Request.Header.Set("x-admin-permissions", GovernancePermissionVirtualKeyRotate)
	ctx.Request.SetRequestURI("/api/governance/virtual-keys/vk-client-claims/rotate")
	r.Handler(ctx)

	require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	stored, err := store.GetVirtualKey(context.Background(), "vk-client-claims")
	require.NoError(t, err)
	require.Equal(t, "sk-bf-client-claims", stored.Value.GetValue())
}

func TestAuthenticatedLocalAdminPrincipalUsesConfiguredUsername(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Init(&fasthttp.Request{}, nil, nil)
	setAuthenticatedLocalAdmin(ctx, "admin@example.com")

	principal := adminPrincipalFromRequest(ctx)
	require.True(t, principal.Authenticated)
	require.True(t, principal.LocalAdmin)
	require.Equal(t, "local-admin:admin@example.com", principal.ID)
	require.Equal(t, "admin@example.com", principal.Name)
	require.Equal(t, "local-session", principal.AuthMethod)
	require.Equal(t, "local-admin", principal.RoleID)
}

func TestGovernanceVirtualKeyRotateRequiresActionPermission(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	createGovernanceAuditTestVirtualKey(t, store, "vk-permission", "sk-bf-permission-secret")

	ctx := &fasthttp.RequestCtx{}
	ctx.Init(&fasthttp.Request{}, nil, nil)
	ctx.Request.Header.SetMethod(fasthttp.MethodPost)
	ctx.Request.SetRequestURI("/api/governance/virtual-keys/vk-permission/rotate")
	ctx.SetUserValue(schemas.BifrostContextKeyUserID, "employee-1")
	ctx.SetUserValue(schemas.BifrostContextKeyUserName, "Auditor")
	ctx.SetUserValue(schemas.BifrostContextKeyAdminPermissions, []string{GovernancePermissionAuditRead})

	r.Handler(ctx)

	require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	stored, err := store.GetVirtualKey(context.Background(), "vk-permission")
	require.NoError(t, err)
	require.Equal(t, "sk-bf-permission-secret", stored.Value.GetValue())

	var events []configstoreTables.TableGovernanceAuditEvent
	require.NoError(t, store.DB().Order("sequence ASC").Find(&events).Error)
	require.Len(t, events, 1)
	require.Equal(t, "denied", events[0].Outcome)
	require.Equal(t, "employee-1", events[0].ActorID)
	require.Equal(t, "virtual_key.rotate", events[0].Action)
}

func TestGovernanceVirtualKeyReadsRequirePermissionAndRedactValue(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	const secret = "sk-bf-read-secret"
	createGovernanceAuditTestVirtualKey(t, store, "vk-read", secret)

	denied := performGovernanceEnterpriseRequest(r, fasthttp.MethodGet, "/api/governance/virtual-keys", "")
	require.Equal(t, fasthttp.StatusForbidden, denied.Response.StatusCode(), string(denied.Response.Body()))

	listCtx := performGovernanceEnterpriseRequest(r, fasthttp.MethodGet, "/api/governance/virtual-keys", "", GovernancePermissionVirtualKeyRead)
	require.Equal(t, fasthttp.StatusOK, listCtx.Response.StatusCode(), string(listCtx.Response.Body()))
	var list struct {
		VirtualKeys []map[string]any `json:"virtual_keys"`
	}
	require.NoError(t, json.Unmarshal(listCtx.Response.Body(), &list))
	require.Len(t, list.VirtualKeys, 1)
	require.Equal(t, "[REDACTED]", list.VirtualKeys[0]["value"])
	require.Equal(t, true, list.VirtualKeys[0]["value_redacted"])
	require.NotEqual(t, secret, list.VirtualKeys[0]["value"])

	detailCtx := performGovernanceEnterpriseRequest(r, fasthttp.MethodGet, "/api/governance/virtual-keys/vk-read", "", GovernancePermissionVirtualKeyRead)
	require.Equal(t, fasthttp.StatusOK, detailCtx.Response.StatusCode(), string(detailCtx.Response.Body()))
	var detail struct {
		VirtualKey map[string]any `json:"virtual_key"`
	}
	require.NoError(t, json.Unmarshal(detailCtx.Response.Body(), &detail))
	require.Equal(t, "[REDACTED]", detail.VirtualKey["value"])
	require.Equal(t, true, detail.VirtualKey["value_redacted"])

	revealedCtx := performGovernanceEnterpriseRequest(r, fasthttp.MethodGet, "/api/governance/virtual-keys/vk-read", "", GovernancePermissionVirtualKeyRead, GovernancePermissionVirtualKeyReveal)
	require.Equal(t, fasthttp.StatusOK, revealedCtx.Response.StatusCode(), string(revealedCtx.Response.Body()))
	require.NoError(t, json.Unmarshal(revealedCtx.Response.Body(), &detail))
	require.Equal(t, secret, detail.VirtualKey["value"])
	require.Equal(t, false, detail.VirtualKey["value_redacted"])
}

func TestGovernanceVirtualKeyRevealIsAuditedAndFailsClosed(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	const secret = "sk-bf-reveal-audit-secret"
	createGovernanceAuditTestVirtualKey(t, store, "vk-reveal-audit", secret)

	revealedCtx := performGovernanceEnterpriseRequest(r, fasthttp.MethodGet,
		"/api/governance/virtual-keys/vk-reveal-audit", "",
		GovernancePermissionVirtualKeyRead, GovernancePermissionVirtualKeyReveal)
	require.Equal(t, fasthttp.StatusOK, revealedCtx.Response.StatusCode(), string(revealedCtx.Response.Body()))
	require.Contains(t, string(revealedCtx.Response.Body()), secret)

	var events []configstoreTables.TableGovernanceAuditEvent
	require.NoError(t, store.DB().Order("sequence ASC").Find(&events).Error)
	require.Len(t, events, 1)
	require.Equal(t, "virtual_key.reveal", events[0].Action)
	require.Equal(t, "vk-reveal-audit", events[0].ResourceID)
	require.Contains(t, events[0].MetadataJSON, `"source":"detail"`)
	require.NotContains(t, events[0].BeforeJSON, secret)
	require.NotContains(t, events[0].AfterJSON, secret)
	require.NotContains(t, events[0].MetadataJSON, secret)

	encrypt.Init("", &mockLogger{})
	failedCtx := &fasthttp.RequestCtx{}
	failedCtx.Init(&fasthttp.Request{}, nil, nil)
	failedCtx.SetUserValue(schemas.BifrostContextKeyUserID, "employee-1")
	failedCtx.SetUserValue(schemas.BifrostContextKeyAdminPermissions, []string{
		GovernancePermissionVirtualKeyRead, GovernancePermissionVirtualKeyReveal,
	})
	payloads, auditErr := (&GovernanceHandler{
		configStore: store, authorizer: contextGovernanceAuthorizer{}, audit: &governanceAuditService{store: store},
	}).governanceVirtualKeyReadPayloads(failedCtx, []*configstoreTables.TableVirtualKey{{
		ID: "vk-reveal-audit", Value: *schemas.NewSecretVar(secret),
	}}, "detail")
	encrypt.Init(governanceAuditTestEncryptionKey, &mockLogger{})
	require.Error(t, auditErr)
	require.Nil(t, payloads)
}

func TestGovernanceVirtualKeyUpdateWithoutRevealPermissionRedactsValue(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	const secret = "sk-bf-update-secret"
	createGovernanceAuditTestVirtualKey(t, store, "vk-update-redacted", secret)

	ctx := performGovernanceEnterpriseRequest(r, fasthttp.MethodPut, "/api/governance/virtual-keys/vk-update-redacted",
		`{"name":"Updated without reveal"}`, GovernancePermissionVirtualKeyUpdate)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	var response struct {
		VirtualKey map[string]any `json:"virtual_key"`
	}
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
	require.Equal(t, governanceVirtualKeyRedactedValue, response.VirtualKey["value"])
	require.Equal(t, true, response.VirtualKey["value_redacted"])
	require.NotContains(t, string(ctx.Response.Body()), secret)
}

func TestGovernanceVirtualKeyMutationsWithoutRevealPermissionRedactValues(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)

	createCtx := performGovernanceEnterpriseRequest(r, fasthttp.MethodPost, "/api/governance/virtual-keys",
		`{"name":"Created without reveal"}`, GovernancePermissionVirtualKeyCreate)
	require.Equal(t, fasthttp.StatusOK, createCtx.Response.StatusCode(), string(createCtx.Response.Body()))
	var createResponse struct {
		VirtualKey map[string]any `json:"virtual_key"`
	}
	require.NoError(t, json.Unmarshal(createCtx.Response.Body(), &createResponse))
	require.Equal(t, governanceVirtualKeyRedactedValue, createResponse.VirtualKey["value"])
	require.Equal(t, true, createResponse.VirtualKey["value_redacted"])

	createGovernanceAuditTestVirtualKey(t, store, "vk-rotate-redacted", "sk-bf-rotate-old")
	rotateCtx := performGovernanceEnterpriseRequest(r, fasthttp.MethodPost,
		"/api/governance/virtual-keys/vk-rotate-redacted/rotate", "", GovernancePermissionVirtualKeyRotate)
	require.Equal(t, fasthttp.StatusOK, rotateCtx.Response.StatusCode(), string(rotateCtx.Response.Body()))
	var rotateResponse struct {
		VirtualKey map[string]any `json:"virtual_key"`
	}
	require.NoError(t, json.Unmarshal(rotateCtx.Response.Body(), &rotateResponse))
	require.Equal(t, governanceVirtualKeyRedactedValue, rotateResponse.VirtualKey["value"])
	require.Equal(t, true, rotateResponse.VirtualKey["value_redacted"])
	rotated, err := store.GetVirtualKey(context.Background(), "vk-rotate-redacted")
	require.NoError(t, err)
	require.NotContains(t, string(rotateCtx.Response.Body()), rotated.Value.GetValue())

	createGovernanceAuditTestVirtualKey(t, store, "vk-bulk-redacted-a", "sk-bf-bulk-old-a")
	createGovernanceAuditTestVirtualKey(t, store, "vk-bulk-redacted-b", "sk-bf-bulk-old-b")
	bulkCtx := performGovernanceEnterpriseRequest(r, fasthttp.MethodPost, "/api/governance/virtual-keys/rotate",
		`{"ids":["vk-bulk-redacted-a","vk-bulk-redacted-b"]}`, GovernancePermissionVirtualKeyRotate)
	require.Equal(t, fasthttp.StatusOK, bulkCtx.Response.StatusCode(), string(bulkCtx.Response.Body()))
	var bulkResponse struct {
		VirtualKeys []map[string]any `json:"virtual_keys"`
	}
	require.NoError(t, json.Unmarshal(bulkCtx.Response.Body(), &bulkResponse))
	require.Len(t, bulkResponse.VirtualKeys, 2)
	for _, virtualKey := range bulkResponse.VirtualKeys {
		require.Equal(t, governanceVirtualKeyRedactedValue, virtualKey["value"])
		require.Equal(t, true, virtualKey["value_redacted"])
		stored, loadErr := store.GetVirtualKey(context.Background(), virtualKey["id"].(string))
		require.NoError(t, loadErr)
		require.NotContains(t, string(bulkCtx.Response.Body()), stored.Value.GetValue())
	}
}

func TestGovernanceVirtualKeyRotateAppendsVerifiableRedactedAudit(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	const secret = "sk-bf-secret-that-must-not-enter-audit"
	createGovernanceAuditTestVirtualKey(t, store, "vk-audit", secret)

	ctx := &fasthttp.RequestCtx{}
	ctx.Init(&fasthttp.Request{}, nil, nil)
	ctx.Request.Header.SetMethod(fasthttp.MethodPost)
	ctx.Request.Header.Set("x-request-id", "req-audit-1")
	ctx.Request.SetRequestURI("/api/governance/virtual-keys/vk-audit/rotate")
	ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)

	r.Handler(ctx)

	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	stored, err := store.GetVirtualKey(context.Background(), "vk-audit")
	require.NoError(t, err)
	require.NotEqual(t, secret, stored.Value.GetValue())

	var events []configstoreTables.TableGovernanceAuditEvent
	require.NoError(t, store.DB().Order("sequence ASC").Find(&events).Error)
	require.Len(t, events, 1)
	event := events[0]
	require.Equal(t, uint64(1), event.Sequence)
	require.Equal(t, "local-admin", event.ActorID)
	require.Equal(t, "virtual_key.rotate", event.Action)
	require.Equal(t, "req-audit-1", event.RequestID)
	require.NotContains(t, event.BeforeJSON, secret)
	require.NotContains(t, event.AfterJSON, secret)
	require.NotContains(t, event.MetadataJSON, secret)
	require.NotContains(t, event.BeforeJSON, "value")
	require.NotContains(t, event.AfterJSON, "value")
	require.Contains(t, event.MetadataJSON, `"credential_changed":true`)

	var head configstoreTables.TableGovernanceAuditHead
	require.NoError(t, store.DB().First(&head, "id = ?", governanceAuditHeadID).Error)
	verification := verifyGovernanceAuditEvents(events, head)
	require.True(t, verification.Valid, verification.Reason)
	require.Equal(t, event.EventHash, head.LastHash)
	require.Zero(t, event.OccurredAt.Nanosecond()%int(time.Microsecond))
	canonicalBeforeRoundTrip, err := canonicalGovernanceAuditEvent(&event)
	require.NoError(t, err)
	event.OccurredAt = time.UnixMicro(event.OccurredAt.UnixMicro()).UTC()
	canonicalAfterRoundTrip, err := canonicalGovernanceAuditEvent(&event)
	require.NoError(t, err)
	require.Equal(t, canonicalBeforeRoundTrip, canonicalAfterRoundTrip)

	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditEvent{}).
		Where("sequence = ?", event.Sequence).
		UpdateColumn("after_json", `{"name":"tampered"}`).Error)
	require.NoError(t, store.DB().Order("sequence ASC").Find(&events).Error)
	verification = verifyGovernanceAuditEvents(events, head)
	require.False(t, verification.Valid)
	require.Equal(t, uint64(1), verification.FailureSequence)
	require.True(t, strings.Contains(verification.Reason, "hash") || strings.Contains(verification.Reason, "signature"))
}

func TestGovernanceVirtualKeyAuditSummaryCapturesPolicyWithoutSecrets(t *testing.T) {
	_, store, _ := setupGovernanceAuditHandler(t)
	createGovernanceAuditTestVirtualKey(t, store, "vk-policy", "sk-bf-vk-policy-secret")
	db := store.DB()

	provider := configstoreTables.TableProvider{Name: "openai"}
	require.NoError(t, db.Create(&provider).Error)
	keyA := configstoreTables.TableKey{
		Name: "policy-key-a", ProviderID: provider.ID, Provider: provider.Name,
		KeyID: "key-a", Value: *schemas.NewSecretVar("provider-secret-a"),
	}
	keyB := configstoreTables.TableKey{
		Name: "policy-key-b", ProviderID: provider.ID, Provider: provider.Name,
		KeyID: "key-b", Value: *schemas.NewSecretVar("provider-secret-b"),
	}
	require.NoError(t, db.Create(&keyA).Error)
	require.NoError(t, db.Create(&keyB).Error)
	providerConfig := configstoreTables.TableVirtualKeyProviderConfig{
		VirtualKeyID: "vk-policy", Provider: provider.Name,
		AllowedModels:     schemas.WhiteList{"z-model", "a-model"},
		BlacklistedModels: schemas.BlackList{"legacy-model"},
	}
	require.NoError(t, db.Create(&providerConfig).Error)
	require.NoError(t, db.Create([]configstoreTables.TableVirtualKeyProviderConfigKey{
		{TableVirtualKeyProviderConfigID: providerConfig.ID, TableKeyID: keyB.ID},
		{TableVirtualKeyProviderConfigID: providerConfig.ID, TableKeyID: keyA.ID},
	}).Error)

	mcpClient := configstoreTables.TableMCPClient{ClientID: "mcp-policy", Name: "MCP policy", ConnectionType: "http"}
	require.NoError(t, db.Session(&gorm.Session{SkipHooks: true}).Create(&mcpClient).Error)
	require.NoError(t, db.Create(&configstoreTables.TableVirtualKeyMCPConfig{
		VirtualKeyID: "vk-policy", MCPClientID: mcpClient.ID,
		ToolsToExecute: schemas.WhiteList{"tool-z", "tool-a"},
	}).Error)

	tokenLimit := int64(1_000)
	requestLimit := int64(25)
	oneMinute := "1m"
	oneHour := "1h"
	rateLimit := configstoreTables.TableRateLimit{
		ID: "rl-policy", TokenMaxLimit: &tokenLimit, TokenResetDuration: &oneMinute,
		RequestMaxLimit: &requestLimit, RequestResetDuration: &oneHour,
	}
	require.NoError(t, db.Create(&rateLimit).Error)
	providerName := provider.Name
	scopeID := "vk-policy"
	modelConfig := configstoreTables.TableModelConfig{
		ID: "mc-policy", Scope: configstoreTables.ModelConfigScopeVirtualKey, ScopeID: &scopeID,
		Provider: &providerName, ModelName: "a-model", RateLimitID: &rateLimit.ID,
	}
	require.NoError(t, db.Create(&modelConfig).Error)
	require.NoError(t, db.Create(&configstoreTables.TableBudget{
		ID: "budget-policy", MaxLimit: 42, ResetDuration: "1M", ModelConfigID: &modelConfig.ID,
	}).Error)

	before, err := loadVirtualKeyAuditSummary(context.Background(), db, "vk-policy")
	require.NoError(t, err)
	beforeJSON, err := canonicalAuditJSON(before)
	require.NoError(t, err)
	require.Contains(t, beforeJSON, `"allowed_models":["a-model","z-model"]`)
	require.Contains(t, beforeJSON, `"key_ids":["key-a","key-b"]`)
	require.Contains(t, beforeJSON, `"tools_to_execute":["tool-a","tool-z"]`)
	require.Contains(t, beforeJSON, `"max_limit":42`)
	require.Contains(t, beforeJSON, `"token_max_limit":1000`)
	for _, secret := range []string{"sk-bf-vk-policy-secret", "provider-secret-a", "provider-secret-b"} {
		require.NotContains(t, beforeJSON, secret)
	}

	require.NoError(t, db.Model(&configstoreTables.TableVirtualKeyProviderConfig{}).
		Where("id = ?", providerConfig.ID).UpdateColumn("allowed_models", `["b-model"]`).Error)
	require.NoError(t, db.Model(&configstoreTables.TableVirtualKeyMCPConfig{}).
		Where("virtual_key_id = ?", "vk-policy").UpdateColumn("tools_to_execute", `["tool-b"]`).Error)
	require.NoError(t, db.Model(&configstoreTables.TableBudget{}).
		Where("id = ?", "budget-policy").UpdateColumn("max_limit", 84).Error)
	require.NoError(t, db.Model(&configstoreTables.TableRateLimit{}).
		Where("id = ?", "rl-policy").UpdateColumn("token_max_limit", 2_000).Error)

	after, err := loadVirtualKeyAuditSummary(context.Background(), db, "vk-policy")
	require.NoError(t, err)
	afterJSON, err := canonicalAuditJSON(after)
	require.NoError(t, err)
	require.NotEqual(t, beforeJSON, afterJSON)
	require.Contains(t, afterJSON, `"allowed_models":["b-model"]`)
	require.Contains(t, afterJSON, `"tools_to_execute":["tool-b"]`)
	require.Contains(t, afterJSON, `"max_limit":84`)
	require.Contains(t, afterJSON, `"token_max_limit":2000`)
}

func TestGovernanceVirtualKeyCRUDAppendsContinuousRedactedAudit(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)

	createCtx := performGovernanceAuditRequest(r, fasthttp.MethodPost, "/api/governance/virtual-keys", `{"name":"Enterprise key"}`, true)
	require.Equal(t, fasthttp.StatusOK, createCtx.Response.StatusCode(), string(createCtx.Response.Body()))
	var createResponse struct {
		VirtualKey struct {
			ID    string `json:"id"`
			Value string `json:"value"`
		} `json:"virtual_key"`
		AuditReceipt governanceAuditReceipt `json:"audit_receipt"`
	}
	require.NoError(t, json.Unmarshal(createCtx.Response.Body(), &createResponse))
	require.NotEmpty(t, createResponse.VirtualKey.ID)
	require.NotEmpty(t, createResponse.VirtualKey.Value)
	require.Equal(t, uint64(1), createResponse.AuditReceipt.Sequence)

	updateCtx := performGovernanceAuditRequest(r, fasthttp.MethodPut,
		"/api/governance/virtual-keys/"+createResponse.VirtualKey.ID, `{"name":"Enterprise key updated"}`, true)
	require.Equal(t, fasthttp.StatusOK, updateCtx.Response.StatusCode(), string(updateCtx.Response.Body()))

	deleteCtx := performGovernanceAuditRequest(r, fasthttp.MethodDelete,
		"/api/governance/virtual-keys/"+createResponse.VirtualKey.ID, "", true)
	require.Equal(t, fasthttp.StatusOK, deleteCtx.Response.StatusCode(), string(deleteCtx.Response.Body()))

	_, err := store.GetVirtualKey(context.Background(), createResponse.VirtualKey.ID)
	require.ErrorIs(t, err, configstore.ErrNotFound)

	var events []configstoreTables.TableGovernanceAuditEvent
	require.NoError(t, store.DB().Order("sequence ASC").Find(&events).Error)
	require.Len(t, events, 3)
	require.Equal(t, []string{"virtual_key.create", "virtual_key.update", "virtual_key.delete"},
		[]string{events[0].Action, events[1].Action, events[2].Action})
	for i := range events {
		require.Equal(t, uint64(i+1), events[i].Sequence)
		require.Equal(t, "success", events[i].Outcome)
		require.NotContains(t, events[i].BeforeJSON, createResponse.VirtualKey.Value)
		require.NotContains(t, events[i].AfterJSON, createResponse.VirtualKey.Value)
		require.NotContains(t, events[i].BeforeJSON, `"value"`)
		require.NotContains(t, events[i].AfterJSON, `"value"`)
	}
	require.Contains(t, events[1].BeforeJSON, "Enterprise key")
	require.Contains(t, events[1].AfterJSON, "Enterprise key updated")

	var head configstoreTables.TableGovernanceAuditHead
	require.NoError(t, store.DB().First(&head, "id = ?", governanceAuditHeadID).Error)
	verification := verifyGovernanceAuditEvents(events, head)
	require.True(t, verification.Valid, verification.Reason)
}

func TestGovernanceVirtualKeyWritesRollbackWithoutAuditSigningKey(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	logger := &mockLogger{}
	encrypt.Init("", logger)
	t.Cleanup(func() { encrypt.Init(governanceAuditTestEncryptionKey, logger) })

	createGovernanceAuditTestVirtualKey(t, store, "vk-no-key-update", "sk-bf-no-key-update")
	createGovernanceAuditTestVirtualKey(t, store, "vk-no-key-rotate", "sk-bf-no-key-rotate")
	createGovernanceAuditTestVirtualKey(t, store, "vk-no-key-delete", "sk-bf-no-key-delete")

	t.Run("create", func(t *testing.T) {
		var before int64
		require.NoError(t, store.DB().Model(&configstoreTables.TableVirtualKey{}).Count(&before).Error)
		ctx := performGovernanceAuditRequest(r, fasthttp.MethodPost, "/api/governance/virtual-keys", `{"name":"must roll back"}`, true)
		require.Equal(t, fasthttp.StatusInternalServerError, ctx.Response.StatusCode(), string(ctx.Response.Body()))
		var after int64
		require.NoError(t, store.DB().Model(&configstoreTables.TableVirtualKey{}).Count(&after).Error)
		require.Equal(t, before, after)
	})

	t.Run("update", func(t *testing.T) {
		ctx := performGovernanceAuditRequest(r, fasthttp.MethodPut, "/api/governance/virtual-keys/vk-no-key-update", `{"name":"changed"}`, true)
		require.Equal(t, fasthttp.StatusInternalServerError, ctx.Response.StatusCode(), string(ctx.Response.Body()))
		stored, err := store.GetVirtualKey(context.Background(), "vk-no-key-update")
		require.NoError(t, err)
		require.Equal(t, "Production vk-no-key-update", stored.Name)
	})

	t.Run("rotate", func(t *testing.T) {
		ctx := performGovernanceAuditRequest(r, fasthttp.MethodPost, "/api/governance/virtual-keys/vk-no-key-rotate/rotate", "", true)
		require.Equal(t, fasthttp.StatusInternalServerError, ctx.Response.StatusCode(), string(ctx.Response.Body()))
		stored, err := store.GetVirtualKey(context.Background(), "vk-no-key-rotate")
		require.NoError(t, err)
		require.Equal(t, "sk-bf-no-key-rotate", stored.Value.GetValue())
	})

	t.Run("delete", func(t *testing.T) {
		ctx := performGovernanceAuditRequest(r, fasthttp.MethodDelete, "/api/governance/virtual-keys/vk-no-key-delete", "", true)
		require.Equal(t, fasthttp.StatusInternalServerError, ctx.Response.StatusCode(), string(ctx.Response.Body()))
		stored, err := store.GetVirtualKey(context.Background(), "vk-no-key-delete")
		require.NoError(t, err)
		require.Equal(t, "vk-no-key-delete", stored.ID)
	})

	var eventCount int64
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditEvent{}).Count(&eventCount).Error)
	require.Zero(t, eventCount)
}

func TestGovernanceVirtualKeyMutationRollsBackWhenAuditInsertFails(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	createGovernanceAuditTestVirtualKey(t, store, "vk-audit-insert-failure", "sk-bf-audit-insert-failure")
	require.NoError(t, store.DB().Exec(`
		CREATE TRIGGER fail_governance_audit_insert
		BEFORE INSERT ON governance_audit_events
		BEGIN
			SELECT RAISE(FAIL, 'forced governance audit insert failure');
		END;
	`).Error)
	t.Cleanup(func() { _ = store.DB().Exec("DROP TRIGGER IF EXISTS fail_governance_audit_insert").Error })

	ctx := performGovernanceAuditRequest(r, fasthttp.MethodPut,
		"/api/governance/virtual-keys/vk-audit-insert-failure", `{"name":"must not persist"}`, true)
	require.Equal(t, fasthttp.StatusInternalServerError, ctx.Response.StatusCode(), string(ctx.Response.Body()))

	stored, err := store.GetVirtualKey(context.Background(), "vk-audit-insert-failure")
	require.NoError(t, err)
	require.Equal(t, "Production vk-audit-insert-failure", stored.Name)
	var eventCount int64
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditEvent{}).Count(&eventCount).Error)
	require.Zero(t, eventCount)
}

func TestGovernanceVirtualKeyBulkRotateIsAtomic(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	createGovernanceAuditTestVirtualKey(t, store, "vk-bulk-a", "sk-bf-bulk-a")
	createGovernanceAuditTestVirtualKey(t, store, "vk-bulk-b", "sk-bf-bulk-b")

	failCtx := performGovernanceAuditRequest(r, fasthttp.MethodPost, "/api/governance/virtual-keys/rotate",
		`{"ids":["vk-bulk-a","missing","vk-bulk-b"]}`, true)
	require.Equal(t, fasthttp.StatusNotFound, failCtx.Response.StatusCode(), string(failCtx.Response.Body()))
	for id, want := range map[string]string{"vk-bulk-a": "sk-bf-bulk-a", "vk-bulk-b": "sk-bf-bulk-b"} {
		stored, err := store.GetVirtualKey(context.Background(), id)
		require.NoError(t, err)
		require.Equal(t, want, stored.Value.GetValue())
	}
	var eventCount int64
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditEvent{}).Count(&eventCount).Error)
	require.Zero(t, eventCount)

	successCtx := performGovernanceAuditRequest(r, fasthttp.MethodPost, "/api/governance/virtual-keys/rotate",
		`{"ids":["vk-bulk-a","vk-bulk-b","vk-bulk-a"]}`, true)
	require.Equal(t, fasthttp.StatusOK, successCtx.Response.StatusCode(), string(successCtx.Response.Body()))
	var response struct {
		Committed     bool                     `json:"committed"`
		AuditReceipts []governanceAuditReceipt `json:"audit_receipts"`
	}
	require.NoError(t, json.Unmarshal(successCtx.Response.Body(), &response))
	require.True(t, response.Committed)
	require.Len(t, response.AuditReceipts, 2)
	for id, previous := range map[string]string{"vk-bulk-a": "sk-bf-bulk-a", "vk-bulk-b": "sk-bf-bulk-b"} {
		stored, err := store.GetVirtualKey(context.Background(), id)
		require.NoError(t, err)
		require.NotEqual(t, previous, stored.Value.GetValue())
	}
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditEvent{}).Count(&eventCount).Error)
	require.Equal(t, int64(2), eventCount)
}

func TestGovernanceVirtualKeyBulkRotateAuthorizationIsAllOrNothing(t *testing.T) {
	handler, store, r := setupGovernanceAuditHandler(t)
	createGovernanceAuditTestVirtualKey(t, store, "vk-bulk-allowed", "sk-bf-bulk-allowed")
	createGovernanceAuditTestVirtualKey(t, store, "vk-bulk-denied", "sk-bf-bulk-denied")
	handler.authorizer = governanceAuthorizerFunc(func(_ context.Context, _ AdminPrincipal, _ string, resource string) error {
		if resource == "virtual_key/vk-bulk-denied" {
			return errGovernanceForbidden
		}
		return nil
	})

	ctx := performGovernanceAuditRequest(r, fasthttp.MethodPost, "/api/governance/virtual-keys/rotate",
		`{"ids":["vk-bulk-allowed","vk-bulk-denied"]}`, true)
	require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	for id, expected := range map[string]string{
		"vk-bulk-allowed": "sk-bf-bulk-allowed",
		"vk-bulk-denied":  "sk-bf-bulk-denied",
	} {
		stored, err := store.GetVirtualKey(context.Background(), id)
		require.NoError(t, err)
		require.Equal(t, expected, stored.Value.GetValue())
	}
	var eventCount int64
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditEvent{}).Count(&eventCount).Error)
	require.Equal(t, int64(1), eventCount)
	var denied configstoreTables.TableGovernanceAuditEvent
	require.NoError(t, store.DB().First(&denied).Error)
	require.Equal(t, "denied", denied.Outcome)
	require.Equal(t, "virtual_key.rotate", denied.Action)
	require.Equal(t, "vk-bulk-denied", denied.ResourceID)
}

func TestGovernanceVirtualKeyBudgetOverrideRequiresAuthorizationAndAudits(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	createGovernanceAuditTestVirtualKey(t, store, "vk-budget-audit", "sk-bf-budget-audit")
	scopeID := "vk-budget-audit"
	modelConfig := &configstoreTables.TableModelConfig{
		ID: "mc-budget-audit", ModelName: configstoreTables.ModelConfigAllModels,
		Scope: configstoreTables.ModelConfigScopeVirtualKey, ScopeID: &scopeID,
		Budgets: []configstoreTables.TableBudget{{ID: "budget-audit", MaxLimit: 100, ResetDuration: "1d"}},
	}
	require.NoError(t, store.CreateModelConfig(context.Background(), modelConfig))

	denied := performGovernanceEnterpriseRequest(r, fasthttp.MethodPut,
		"/api/governance/virtual-keys/vk-budget-audit/budgets/budget-audit/override",
		`{"amount":25,"mode":"cycles","cycles":2}`, GovernancePermissionVirtualKeyRead)
	require.Equal(t, fasthttp.StatusForbidden, denied.Response.StatusCode(), string(denied.Response.Body()))
	budget, err := store.GetBudget(context.Background(), "budget-audit")
	require.NoError(t, err)
	require.Zero(t, budget.OverrideAmount)

	updated := performGovernanceAuditRequest(r, fasthttp.MethodPut,
		"/api/governance/virtual-keys/vk-budget-audit/budgets/budget-audit/override",
		`{"amount":25,"mode":"cycles","cycles":2}`, true)
	require.Equal(t, fasthttp.StatusOK, updated.Response.StatusCode(), string(updated.Response.Body()))
	var updateResponse struct {
		AuditReceipt governanceAuditReceipt `json:"audit_receipt"`
	}
	require.NoError(t, json.Unmarshal(updated.Response.Body(), &updateResponse))
	require.Equal(t, uint64(2), updateResponse.AuditReceipt.Sequence)

	cleared := performGovernanceAuditRequest(r, fasthttp.MethodDelete,
		"/api/governance/virtual-keys/vk-budget-audit/budgets/budget-audit/override", "", true)
	require.Equal(t, fasthttp.StatusOK, cleared.Response.StatusCode(), string(cleared.Response.Body()))
	var events []configstoreTables.TableGovernanceAuditEvent
	require.NoError(t, store.DB().Order("sequence ASC").Find(&events).Error)
	require.Len(t, events, 3)
	require.Equal(t, "denied", events[0].Outcome)
	require.Equal(t, "virtual_key.budget_override.update", events[0].Action)
	require.Equal(t, "success", events[1].Outcome)
	require.Equal(t, "virtual_key.budget_override.update", events[1].Action)
	require.Equal(t, "success", events[2].Outcome)
	require.Equal(t, "virtual_key.budget_override.delete", events[2].Action)
	require.Contains(t, events[1].BeforeJSON, `"max_limit":100`)
	require.Contains(t, events[1].AfterJSON, `"override_amount":25`)
}

func TestGovernanceVirtualKeyBudgetOverrideRollsBackWithoutAuditSigningKey(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	createGovernanceAuditTestVirtualKey(t, store, "vk-budget-no-key", "sk-bf-budget-no-key")
	scopeID := "vk-budget-no-key"
	require.NoError(t, store.CreateModelConfig(context.Background(), &configstoreTables.TableModelConfig{
		ID: "mc-budget-no-key", ModelName: configstoreTables.ModelConfigAllModels,
		Scope: configstoreTables.ModelConfigScopeVirtualKey, ScopeID: &scopeID,
		Budgets: []configstoreTables.TableBudget{{ID: "budget-no-key", MaxLimit: 100, ResetDuration: "1d"}},
	}))
	encrypt.Init("", &mockLogger{})

	ctx := performGovernanceAuditRequest(r, fasthttp.MethodPut,
		"/api/governance/virtual-keys/vk-budget-no-key/budgets/budget-no-key/override",
		`{"amount":25,"mode":"cycles","cycles":2}`, true)
	require.Equal(t, fasthttp.StatusInternalServerError, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	budget, err := store.GetBudget(context.Background(), "budget-no-key")
	require.NoError(t, err)
	require.Zero(t, budget.OverrideAmount)
	var eventCount int64
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditEvent{}).Count(&eventCount).Error)
	require.Zero(t, eventCount)
}

func TestGovernanceAuditHTTPQueryExportPublicKeyAndVerify(t *testing.T) {
	_, _, r := setupGovernanceAuditHandler(t)
	createCtx := performGovernanceAuditRequest(r, fasthttp.MethodPost, "/api/governance/virtual-keys", `{"name":"Audited key"}`, true)
	require.Equal(t, fasthttp.StatusOK, createCtx.Response.StatusCode(), string(createCtx.Response.Body()))
	var created struct {
		AuditReceipt governanceAuditReceipt `json:"audit_receipt"`
	}
	require.NoError(t, json.Unmarshal(createCtx.Response.Body(), &created))

	listCtx := performGovernanceAuditRequest(r, fasthttp.MethodGet, "/api/governance/audit-logs?limit=10", "", true)
	require.Equal(t, fasthttp.StatusOK, listCtx.Response.StatusCode(), string(listCtx.Response.Body()))
	var listResponse struct {
		AuditLogs []configstoreTables.TableGovernanceAuditEvent `json:"audit_logs"`
		Total     int64                                         `json:"total_count"`
	}
	require.NoError(t, json.Unmarshal(listCtx.Response.Body(), &listResponse))
	require.Equal(t, int64(1), listResponse.Total)
	require.Len(t, listResponse.AuditLogs, 1)

	publicKeyCtx := performGovernanceAuditRequest(r, fasthttp.MethodGet, "/api/governance/audit-logs/public-key", "", true)
	require.Equal(t, fasthttp.StatusOK, publicKeyCtx.Response.StatusCode(), string(publicKeyCtx.Response.Body()))
	var publicKeyResponse struct {
		Algorithm string `json:"algorithm"`
		KeyID     string `json:"key_id"`
		PublicKey string `json:"public_key"`
	}
	require.NoError(t, json.Unmarshal(publicKeyCtx.Response.Body(), &publicKeyResponse))
	require.Equal(t, "Ed25519", publicKeyResponse.Algorithm)
	require.NotEmpty(t, publicKeyResponse.KeyID)

	for _, uri := range []string{
		"/api/governance/audit-logs/verify",
		"/api/governance/audit-logs/" + created.AuditReceipt.EventID + "/verify",
	} {
		verifyCtx := performGovernanceAuditRequest(r, fasthttp.MethodGet, uri, "", true)
		require.Equal(t, fasthttp.StatusOK, verifyCtx.Response.StatusCode(), string(verifyCtx.Response.Body()))
		var verification governanceAuditVerifyResult
		require.NoError(t, json.Unmarshal(verifyCtx.Response.Body(), &verification))
		require.True(t, verification.Valid, verification.Reason)
	}

	exportCtx := performGovernanceAuditRequest(r, fasthttp.MethodGet, "/api/governance/audit-logs/export", "", true)
	require.Equal(t, fasthttp.StatusOK, exportCtx.Response.StatusCode(), string(exportCtx.Response.Body()))
	require.Contains(t, string(exportCtx.Response.Header.Peek("Content-Disposition")), "governance-audit-export.json")
	var exportResponse struct {
		Manifest          governanceAuditExportManifest                 `json:"manifest"`
		ManifestHash      string                                        `json:"manifest_hash"`
		ManifestSignature string                                        `json:"manifest_signature"`
		Events            []configstoreTables.TableGovernanceAuditEvent `json:"events"`
	}
	require.NoError(t, json.Unmarshal(exportCtx.Response.Body(), &exportResponse))
	require.Equal(t, 1, exportResponse.Manifest.Count)
	require.Len(t, exportResponse.Events, 1)
	canonicalManifest, err := json.Marshal(exportResponse.Manifest)
	require.NoError(t, err)
	expectedManifestDigest := sha256.Sum256(canonicalManifest)
	require.Equal(t, hex.EncodeToString(expectedManifestDigest[:]), exportResponse.ManifestHash)
	publicKey, err := base64.StdEncoding.DecodeString(publicKeyResponse.PublicKey)
	require.NoError(t, err)
	manifestDigest, err := hex.DecodeString(exportResponse.ManifestHash)
	require.NoError(t, err)
	manifestSignature, err := base64.StdEncoding.DecodeString(exportResponse.ManifestSignature)
	require.NoError(t, err)
	require.True(t, ed25519.Verify(ed25519.PublicKey(publicKey), manifestDigest, manifestSignature))
}

func TestGovernanceAuditVerificationSurvivesSigningKeyRotation(t *testing.T) {
	handler, store, r := setupGovernanceAuditHandler(t)
	principal := AdminPrincipal{ID: "local-admin", Name: "Local admin", AuthMethod: "local-session", Authenticated: true, LocalAdmin: true}
	appendEvent := func(action string) {
		require.NoError(t, store.ExecuteTransaction(context.Background(), func(tx *gorm.DB) error {
			_, err := handler.audit.append(context.Background(), tx, governanceAuditInput{
				Principal: principal, Action: action, Resource: "virtual_key", ResourceID: "vk-key-rotation", Outcome: "success",
			})
			return err
		}))
	}

	appendEvent("virtual_key.create")
	encrypt.Init("elygate-governance-audit-rotated-key-32-bytes", &mockLogger{})
	appendEvent("virtual_key.rotate")

	verifyCtx := performGovernanceAuditRequest(r, fasthttp.MethodGet, "/api/governance/audit-logs/verify", "", true)
	require.Equal(t, fasthttp.StatusOK, verifyCtx.Response.StatusCode(), string(verifyCtx.Response.Body()))
	var verification governanceAuditVerifyResult
	require.NoError(t, json.Unmarshal(verifyCtx.Response.Body(), &verification))
	require.True(t, verification.Valid, verification.Reason)
	require.Equal(t, uint64(2), verification.CheckedThroughSequence)

	var publicKeys []configstoreTables.TableGovernanceAuditPublicKey
	require.NoError(t, store.DB().Order("created_at ASC").Find(&publicKeys).Error)
	require.Len(t, publicKeys, 2)
	require.NotEqual(t, publicKeys[0].KeyID, publicKeys[1].KeyID)

	exportCtx := performGovernanceAuditRequest(r, fasthttp.MethodGet, "/api/governance/audit-logs/export", "", true)
	require.Equal(t, fasthttp.StatusOK, exportCtx.Response.StatusCode(), string(exportCtx.Response.Body()))
	var exported struct {
		PublicKeys []configstoreTables.TableGovernanceAuditPublicKey `json:"public_keys"`
	}
	require.NoError(t, json.Unmarshal(exportCtx.Response.Body(), &exported))
	require.Len(t, exported.PublicKeys, 2)
	encrypt.Init(governanceAuditTestEncryptionKey, &mockLogger{})
}

func TestGovernanceAuditBootstrapPreservesPreKeyringHistoryAcrossRotation(t *testing.T) {
	handler, store, _ := setupGovernanceAuditHandler(t)
	principal := AdminPrincipal{ID: "local-admin", Name: "Local admin", AuthMethod: "local-session", Authenticated: true, LocalAdmin: true}
	require.NoError(t, store.ExecuteTransaction(context.Background(), func(tx *gorm.DB) error {
		_, err := handler.audit.append(context.Background(), tx, governanceAuditInput{
			Principal: principal, Action: "virtual_key.create", Resource: "virtual_key",
			ResourceID: "vk-pre-keyring-upgrade", Outcome: "success",
		})
		return err
	}))

	// Simulate an upgrade from the audit schema that predates the public-key
	// registry: the signed event remains, but no keyring row has been persisted.
	require.NoError(t, store.DB().Where("1 = 1").Delete(&configstoreTables.TableGovernanceAuditPublicKey{}).Error)
	var publicKeyCount int64
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditPublicKey{}).Count(&publicKeyCount).Error)
	require.Zero(t, publicKeyCount)

	bootstrapped, err := NewGovernanceHandler(handler.governanceManager, store, nil, nil)
	require.NoError(t, err)
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditPublicKey{}).Count(&publicKeyCount).Error)
	require.Equal(t, int64(1), publicKeyCount)

	// Rotate before appending another event. Verification must still resolve the
	// historical event's old key from the bootstrapped persistent keyring.
	encrypt.Init("elygate-governance-audit-rotated-key-32-bytes", &mockLogger{})
	r := router.New()
	bootstrapped.RegisterRoutes(r)
	verifyCtx := performGovernanceAuditRequest(r, fasthttp.MethodGet, "/api/governance/audit-logs/verify", "", true)
	require.Equal(t, fasthttp.StatusOK, verifyCtx.Response.StatusCode(), string(verifyCtx.Response.Body()))
	var verification governanceAuditVerifyResult
	require.NoError(t, json.Unmarshal(verifyCtx.Response.Body(), &verification))
	require.True(t, verification.Valid, verification.Reason)
	require.Equal(t, uint64(1), verification.CheckedThroughSequence)
	encrypt.Init(governanceAuditTestEncryptionKey, &mockLogger{})
}

func TestGovernanceAuditBootstrapAllowsMissingEncryptionKey(t *testing.T) {
	handler, store, _ := setupGovernanceAuditHandler(t)
	encrypt.Init("", &mockLogger{})
	require.NoError(t, store.DB().Where("1 = 1").Delete(&configstoreTables.TableGovernanceAuditPublicKey{}).Error)

	bootstrapped, err := NewGovernanceHandler(handler.governanceManager, store, nil, nil)
	require.NoError(t, err)
	require.Nil(t, bootstrapped.audit)
	r := router.New()
	bootstrapped.RegisterRoutes(r)
	listCtx := performGovernanceAuditRequest(r, fasthttp.MethodGet, "/api/governance/virtual-keys", "", true)
	require.Equal(t, fasthttp.StatusOK, listCtx.Response.StatusCode(), string(listCtx.Response.Body()))
	var publicKeyCount int64
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditPublicKey{}).Count(&publicKeyCount).Error)
	require.Zero(t, publicKeyCount)
}

func TestGovernanceAuditSingleEventTamperReturnsConflict(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	createCtx := performGovernanceAuditRequest(r, fasthttp.MethodPost, "/api/governance/virtual-keys", `{"name":"Tamper target"}`, true)
	require.Equal(t, fasthttp.StatusOK, createCtx.Response.StatusCode(), string(createCtx.Response.Body()))
	var created struct {
		AuditReceipt governanceAuditReceipt `json:"audit_receipt"`
	}
	require.NoError(t, json.Unmarshal(createCtx.Response.Body(), &created))
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditEvent{}).
		Where("id = ?", created.AuditReceipt.EventID).
		UpdateColumn("after_json", `{"name":"tampered"}`).Error)

	verifyCtx := performGovernanceAuditRequest(r, fasthttp.MethodGet,
		"/api/governance/audit-logs/"+created.AuditReceipt.EventID+"/verify", "", true)
	require.Equal(t, fasthttp.StatusConflict, verifyCtx.Response.StatusCode(), string(verifyCtx.Response.Body()))
	var verification governanceAuditVerifyResult
	require.NoError(t, json.Unmarshal(verifyCtx.Response.Body(), &verification))
	require.False(t, verification.Valid)
	require.Equal(t, uint64(1), verification.FailureSequence)
}

func TestGovernanceAuditOnlineLimitReturnsRequestEntityTooLarge(t *testing.T) {
	_, store, r := setupGovernanceAuditHandler(t)
	require.NoError(t, store.DB().Model(&configstoreTables.TableGovernanceAuditHead{}).
		Where("id = ?", governanceAuditHeadID).
		Updates(map[string]any{
			"last_sequence": governanceAuditMaxOnlineEvents + 1,
			"last_hash":     strings.Repeat("a", 64),
		}).Error)
	overLimitEvent := configstoreTables.TableGovernanceAuditEvent{
		Sequence: governanceAuditMaxOnlineEvents + 1, ID: "audit-over-online-limit", SchemaVersion: governanceAuditSchemaVersion,
		OccurredAt: time.Now().UTC().Truncate(time.Microsecond), ActorID: "local-admin", ActorName: "Local administrator",
		AuthMethod: "local-session", LocalAdmin: true, Action: "virtual_key.update", Resource: "virtual_key",
		ResourceID: "vk-over-limit", Outcome: "success", BeforeJSON: "{}", AfterJSON: "{}", MetadataJSON: "{}",
		PreviousHash: strings.Repeat("a", 64), EventHash: strings.Repeat("b", 64), Signature: "invalid", KeyID: "invalid",
	}
	require.NoError(t, store.DB().Create(&overLimitEvent).Error)

	for _, uri := range []string{
		"/api/governance/audit-logs/verify",
		"/api/governance/audit-logs/export",
		"/api/governance/audit-logs/audit-over-online-limit/verify",
	} {
		ctx := performGovernanceAuditRequest(r, fasthttp.MethodGet, uri, "", true)
		require.Equal(t, fasthttp.StatusRequestEntityTooLarge, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	}
}

func TestGovernanceAuditConcurrentAppendMaintainsContinuousChain(t *testing.T) {
	handler, store, _ := setupGovernanceAuditHandler(t)
	const writers = 100
	start := make(chan struct{})
	errs := make(chan error, writers)
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			errs <- store.ExecuteTransaction(context.Background(), func(tx *gorm.DB) error {
				_, err := handler.audit.append(context.Background(), tx, governanceAuditInput{
					Principal: AdminPrincipal{ID: "writer-" + strconv.Itoa(index), Name: "Writer", AuthMethod: "test", Authenticated: true},
					Action:    "virtual_key.update", Resource: "virtual_key", ResourceID: "vk-" + strconv.Itoa(index), Outcome: "success",
				})
				return err
			})
		}(i)
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}

	var events []configstoreTables.TableGovernanceAuditEvent
	require.NoError(t, store.DB().Order("sequence ASC").Find(&events).Error)
	require.Len(t, events, writers)
	var head configstoreTables.TableGovernanceAuditHead
	require.NoError(t, store.DB().First(&head, "id = ?", governanceAuditHeadID).Error)
	verification := verifyGovernanceAuditEvents(events, head)
	require.True(t, verification.Valid, verification.Reason)
}

func TestGovernanceVirtualKeyCommittedReloadFailuresReturnReceipt(t *testing.T) {
	t.Run("create", func(t *testing.T) {
		handler, store, r := setupGovernanceAuditHandler(t)
		manager := handler.governanceManager.(*auditTestGovernanceManager)
		manager.failReloadCall = 1
		ctx := performGovernanceAuditRequest(r, fasthttp.MethodPost, "/api/governance/virtual-keys", `{"name":"Committed create"}`, true)
		require.Equal(t, fasthttp.StatusInternalServerError, ctx.Response.StatusCode(), string(ctx.Response.Body()))
		var response struct {
			Committed    bool                   `json:"committed"`
			AuditReceipt governanceAuditReceipt `json:"audit_receipt"`
		}
		require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
		require.True(t, response.Committed)
		require.NotEmpty(t, response.AuditReceipt.EventID)
		var count int64
		require.NoError(t, store.DB().Model(&configstoreTables.TableVirtualKey{}).Where("name = ?", "Committed create").Count(&count).Error)
		require.Equal(t, int64(1), count)
	})

	t.Run("update second reload", func(t *testing.T) {
		handler, store, r := setupGovernanceAuditHandler(t)
		createGovernanceAuditTestVirtualKey(t, store, "vk-committed-update", "sk-bf-committed-update")
		manager := handler.governanceManager.(*auditTestGovernanceManager)
		manager.failReloadCall = 2
		ctx := performGovernanceAuditRequest(r, fasthttp.MethodPut, "/api/governance/virtual-keys/vk-committed-update", `{"name":"Committed update"}`, true)
		require.Equal(t, fasthttp.StatusInternalServerError, ctx.Response.StatusCode(), string(ctx.Response.Body()))
		var response struct {
			Committed    bool                   `json:"committed"`
			AuditReceipt governanceAuditReceipt `json:"audit_receipt"`
		}
		require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
		require.True(t, response.Committed)
		require.NotEmpty(t, response.AuditReceipt.EventID)
		stored, err := store.GetVirtualKey(context.Background(), "vk-committed-update")
		require.NoError(t, err)
		require.Equal(t, "Committed update", stored.Name)
	})
}
