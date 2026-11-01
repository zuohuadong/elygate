package governance

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mcpToolRequest(client, tool string) *schemas.BifrostMCPRequest {
	return &schemas.BifrostMCPRequest{
		RequestType: schemas.MCPRequestTypeExecuteTool,
		ClientName:  client,
		ChatAssistantMessageToolCall: &schemas.ChatAssistantMessageToolCall{
			Function: schemas.ChatAssistantMessageToolCallFunction{Name: &tool},
		},
	}
}

func cachedMCPKillSwitchPlugin(switches ...MCPKillSwitch) *GovernancePlugin {
	return &GovernancePlugin{
		mcpKillSwitches: mcpKillSwitchCache{
			loadedAt: time.Now(),
			switches: switches,
		},
	}
}

func TestMCPKillSwitchDecisionMatchesAllScopes(t *testing.T) {
	tests := []struct {
		name  string
		rule  MCPKillSwitch
		setup func(*schemas.BifrostContext, *schemas.BifrostMCPRequest)
	}{
		{
			name: "global",
			rule: MCPKillSwitch{Scope: MCPKillSwitchScopeGlobal, Target: "*", Enabled: true},
		},
		{
			name: "tenant customer",
			rule: MCPKillSwitch{Scope: MCPKillSwitchScopeTenant, Target: "tenant-1", Enabled: true},
			setup: func(ctx *schemas.BifrostContext, _ *schemas.BifrostMCPRequest) {
				ctx.SetValue(schemas.BifrostContextKeyGovernanceCustomerID, "tenant-1")
			},
		},
		{
			name: "agent",
			rule: MCPKillSwitch{Scope: MCPKillSwitchScopeAgent, Target: "agent-1", Enabled: true},
			setup: func(ctx *schemas.BifrostContext, _ *schemas.BifrostMCPRequest) {
				ctx.SetValue(schemas.BifrostContextKeyRequestHeaders, map[string]string{"x-bf-agent-id": "agent-1"})
			},
		},
		{
			name: "application",
			rule: MCPKillSwitch{Scope: MCPKillSwitchScopeApplication, Target: "app-1", Enabled: true},
			setup: func(ctx *schemas.BifrostContext, _ *schemas.BifrostMCPRequest) {
				ctx.SetValue(schemas.BifrostContextKeyApp, "app-1")
			},
		},
		{
			name: "tool",
			rule: MCPKillSwitch{Scope: MCPKillSwitchScopeTool, Target: "client-1/tool-1", Enabled: true},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
			req := mcpToolRequest("client-1", "tool-1")
			if tt.setup != nil {
				tt.setup(ctx, req)
			}
			plugin := cachedMCPKillSwitchPlugin(tt.rule)

			got, active := plugin.mcpKillSwitchDecision(ctx, req)
			require.True(t, active)
			assert.Equal(t, tt.rule.Scope, got.Scope)
			assert.Equal(t, tt.rule.Target, got.Target)
		})
	}
}

func TestMCPKillSwitchDecisionSkipsDisabledAndExpiredRules(t *testing.T) {
	expired := time.Now().Add(-time.Minute)
	plugin := cachedMCPKillSwitchPlugin(
		MCPKillSwitch{Scope: MCPKillSwitchScopeGlobal, Target: "*", Enabled: false},
		MCPKillSwitch{Scope: MCPKillSwitchScopeGlobal, Target: "", Enabled: true, ExpiresAt: &expired},
	)

	_, active := plugin.mcpKillSwitchDecision(
		schemas.NewBifrostContext(context.Background(), schemas.NoDeadline),
		mcpToolRequest("client", "tool"),
	)
	assert.False(t, active)
}

func TestPreMCPHookGlobalKillSwitchBlocksCodemode(t *testing.T) {
	plugin := cachedMCPKillSwitchPlugin(MCPKillSwitch{
		Scope:   MCPKillSwitchScopeGlobal,
		Target:  "*",
		Reason:  "incident",
		Enabled: true,
	})
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)

	_, shortCircuit, err := plugin.PreMCPHook(ctx, mcpToolRequest("client-1", "listToolFiles"))
	require.NoError(t, err)
	require.NotNil(t, shortCircuit)
	require.NotNil(t, shortCircuit.Error)
	require.NotNil(t, shortCircuit.Error.StatusCode)
	assert.Equal(t, 403, *shortCircuit.Error.StatusCode)
	assert.Equal(t, string(DecisionMCPToolBlocked), *shortCircuit.Error.Type)
	assert.Equal(t, true, ctx.Value(governanceRejectedContextKey))

	audit, _ := ctx.Value(schemas.BifrostContextKeyMCPGovernanceAudit).(*schemas.MCPGovernanceAudit)
	require.NotNil(t, audit)
	assert.Equal(t, "deny", audit.GovernanceDecision)
	assert.Contains(t, audit.GovernanceReason, "kill_switch:global:*:incident")
}

func TestRefreshMCPKillSwitchesClearsDeletedConfigAndReadsNewVersion(t *testing.T) {
	ctx := context.Background()
	store, err := configstore.NewConfigStore(ctx, &configstore.Config{
		Enabled: true,
		Type:    configstore.ConfigStoreTypeSQLite,
		Config:  &configstore.SQLiteConfig{Path: t.TempDir() + "/mcp-kill-switch.db"},
	}, NewMockLogger())
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = store.Close(ctx)
	})

	encoded, err := EncodeMCPKillSwitches([]MCPKillSwitch{{
		Scope:   MCPKillSwitchScopeGlobal,
		Target:  "*",
		Enabled: true,
	}}, time.Now())
	require.NoError(t, err)
	require.NoError(t, store.UpdateConfig(ctx, &configstoreTables.TableGovernanceConfig{
		Key:   MCPKillSwitchConfigKey,
		Value: encoded,
	}))

	plugin := &GovernancePlugin{configStore: store}
	bifrostCtx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	require.Len(t, plugin.refreshMCPKillSwitches(bifrostCtx), 1)

	require.NoError(t, store.DB().Where("key = ?", MCPKillSwitchConfigKey).
		Delete(&configstoreTables.TableGovernanceConfig{}).Error)
	plugin.mcpKillSwitches.mu.Lock()
	plugin.mcpKillSwitches.loadedAt = time.Time{}
	plugin.mcpKillSwitches.mu.Unlock()
	assert.Empty(t, plugin.refreshMCPKillSwitches(bifrostCtx),
		"deleting the shared config must clear an already observed switch")

	next, err := EncodeMCPKillSwitches([]MCPKillSwitch{{
		Scope:   MCPKillSwitchScopeTool,
		Target:  "client/tool",
		Enabled: true,
	}}, time.Now())
	require.NoError(t, err)
	require.NoError(t, store.UpdateConfig(ctx, &configstoreTables.TableGovernanceConfig{
		Key:   MCPKillSwitchConfigKey,
		Value: next,
	}))
	plugin.mcpKillSwitches.mu.Lock()
	plugin.mcpKillSwitches.loadedAt = time.Time{}
	plugin.mcpKillSwitches.mu.Unlock()
	got := plugin.refreshMCPKillSwitches(bifrostCtx)
	require.Len(t, got, 1)
	assert.Equal(t, "client/tool", got[0].Target)
}

func TestRefreshMCPKillSwitchesKeepsObservedRulesOnStorageError(t *testing.T) {
	ctx := context.Background()
	store, err := configstore.NewConfigStore(ctx, &configstore.Config{
		Enabled: true,
		Type:    configstore.ConfigStoreTypeSQLite,
		Config:  &configstore.SQLiteConfig{Path: t.TempDir() + "/mcp-kill-switch-error.db"},
	}, NewMockLogger())
	require.NoError(t, err)

	encoded, err := EncodeMCPKillSwitches([]MCPKillSwitch{{
		Scope:   MCPKillSwitchScopeGlobal,
		Target:  "*",
		Enabled: true,
	}}, time.Now())
	require.NoError(t, err)
	require.NoError(t, store.UpdateConfig(ctx, &configstoreTables.TableGovernanceConfig{
		Key:   MCPKillSwitchConfigKey,
		Value: encoded,
	}))

	plugin := &GovernancePlugin{configStore: store, logger: NewMockLogger()}
	bifrostCtx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	require.Len(t, plugin.refreshMCPKillSwitches(bifrostCtx), 1)
	require.NoError(t, store.Close(ctx))

	plugin.mcpKillSwitches.mu.Lock()
	plugin.mcpKillSwitches.loadedAt = time.Time{}
	plugin.mcpKillSwitches.mu.Unlock()
	got := plugin.refreshMCPKillSwitches(bifrostCtx)
	require.Len(t, got, 1)
	assert.Equal(t, MCPKillSwitchScopeGlobal, got[0].Scope)
}

func TestMCPKillSwitchDocumentAcceptsLegacyArray(t *testing.T) {
	raw := `[{"scope":"TOOL","target":" client/tool ","enabled":true},{"scope":"global","target":"","enabled":true}]`
	got, err := DecodeMCPKillSwitches(raw)
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, MCPKillSwitchScopeGlobal, got[0].Scope)
	assert.Equal(t, "*", got[0].Target)
	assert.Equal(t, MCPKillSwitchScopeTool, got[1].Scope)
	assert.Equal(t, "client/tool", got[1].Target)
}

func TestMCPKillSwitchValidationRejectsInvalidScope(t *testing.T) {
	err := ValidateMCPKillSwitch(MCPKillSwitch{Scope: "unknown", Target: "x"})
	require.Error(t, err)
	assert.False(t, errors.Is(err, configstore.ErrNotFound))
}

func BenchmarkMCPKillSwitchDecision(b *testing.B) {
	plugin := cachedMCPKillSwitchPlugin(MCPKillSwitch{
		Scope:   MCPKillSwitchScopeTool,
		Target:  "client/tool",
		Enabled: true,
	})
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	req := mcpToolRequest("client", "tool")
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = plugin.mcpKillSwitchDecision(ctx, req)
	}
}

func BenchmarkMCPKillSwitchDecisionNoRules(b *testing.B) {
	plugin := cachedMCPKillSwitchPlugin()
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	req := mcpToolRequest("client", "tool")
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = plugin.mcpKillSwitchDecision(ctx, req)
	}
}
