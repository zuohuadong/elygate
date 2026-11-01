package governance

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func destructiveMCPRequest(clientName, toolName string) (*schemas.BifrostMCPRequest, *schemas.MCPToolExecutionMetadata) {
	return &schemas.BifrostMCPRequest{
			RequestType: schemas.MCPRequestTypeChatToolCall,
			ClientName:  clientName,
			ChatAssistantMessageToolCall: &schemas.ChatAssistantMessageToolCall{
				Function: schemas.ChatAssistantMessageToolCallFunction{Name: &toolName, Arguments: "{}"},
			},
		},
		&schemas.MCPToolExecutionMetadata{
			ClientName: clientName,
			ToolName:   toolName,
			RiskLevel:  schemas.MCPToolRiskHigh,
		}
}

// TestMCPExecutionAuthorization preserves governance while replacing only the exact tool permit.
func TestMCPExecutionAuthorization(t *testing.T) {
	p := newPluginForMCPStamping(t, buildVKForMCPStamping(nil), false)
	for _, tc := range []struct {
		name, client, tool, key string
		approved, allowed       bool
	}{
		{"gateway", "local", "local-read", mcpTestVKValue, false, false},
		{"approved", "local", "local-read", mcpTestVKValue, true, true},
		{"other tool", "local", "local-write", mcpTestVKValue, true, false},
		{"other client", "other", "local-read", mcpTestVKValue, true, false},
		{"invalid identity", "local", "local-read", "invalid", true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := presentCtx(tc.key)
			if tc.approved {
				SetMCPExecutionAuthorization(ctx, "local", "local-read")
			}
			req := &schemas.BifrostMCPRequest{RequestType: schemas.MCPRequestTypeChatToolCall, ClientName: tc.client, ChatAssistantMessageToolCall: &schemas.ChatAssistantMessageToolCall{Function: schemas.ChatAssistantMessageToolCallFunction{Name: &tc.tool, Arguments: "{}"}}}
			_, short, err := p.PreMCPHook(ctx, req)
			require.NoError(t, err)
			if tc.allowed {
				require.Nil(t, short)
			} else {
				require.NotNil(t, short)
				require.NotNil(t, short.Error)
			}
		})
	}
}

// TestMCPExecutionAuthorizationRequiresHeaders keeps transport requirements ahead of tool approval.
func TestMCPExecutionAuthorizationRequiresHeaders(t *testing.T) {
	p := newPluginForMCPStamping(t, buildVKForMCPStamping(nil), false)
	p.requiredHeaders = &[]string{"x-required"}
	ctx := presentCtx(mcpTestVKValue)
	SetMCPExecutionAuthorization(ctx, "local", "local-read")
	name := "local-read"
	req := &schemas.BifrostMCPRequest{RequestType: schemas.MCPRequestTypeChatToolCall, ClientName: "local", ChatAssistantMessageToolCall: &schemas.ChatAssistantMessageToolCall{Function: schemas.ChatAssistantMessageToolCallFunction{Name: &name, Arguments: "{}"}}}
	_, short, err := p.PreMCPHook(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, short)
	require.Equal(t, "missing_required_headers", *short.Error.Type)
}

// TestMCPExecutionAuthorizationForInjectedTool lets a provider-injected tool past the
// virtual key's tool permits. The operator chose the tool in the provider config, so
// the key's MCP grants never listed it; identity and limits still apply.
func TestMCPExecutionAuthorizationForInjectedTool(t *testing.T) {
	p := newPluginForMCPStamping(t, buildVKForMCPStamping(nil), false)
	for _, tc := range []struct {
		name, injectedClient, injected, tool, key string
		allowed                                   bool
	}{
		{"injected tool", "local", "local-write", "local-write", mcpTestVKValue, true},
		{"sibling of the injected tool", "local", "local-write", "local-delete", mcpTestVKValue, false},
		{"another client's tool of the same name", "other", "local-write", "local-write", mcpTestVKValue, false},
		{"invalid identity", "local", "local-write", "local-write", "invalid", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			restore := isInjectedToolExecution
			t.Cleanup(func() { isInjectedToolExecution = restore })
			isInjectedToolExecution = func(_ *schemas.BifrostContext, clientName, toolName string) bool {
				return clientName == tc.injectedClient && toolName == tc.injected
			}
			ctx := presentCtx(tc.key)
			req := &schemas.BifrostMCPRequest{RequestType: schemas.MCPRequestTypeChatToolCall, ClientName: "local", ChatAssistantMessageToolCall: &schemas.ChatAssistantMessageToolCall{Function: schemas.ChatAssistantMessageToolCallFunction{Name: &tc.tool, Arguments: "{}"}}}
			_, short, err := p.PreMCPHook(ctx, req)
			require.NoError(t, err)
			if tc.allowed {
				require.Nil(t, short)
			} else {
				require.NotNil(t, short)
			}
		})
	}
}

// TestMCPExecutionAuthorizationRejectsForgedInjectedMarker keeps the injected-tool
// permit core-only. A plugin can lift BlockRestrictedWrites and call public SetValue,
// so a marker planted that way must not stand in for the virtual key's tool grants.
func TestMCPExecutionAuthorizationRejectsForgedInjectedMarker(t *testing.T) {
	p := newPluginForMCPStamping(t, buildVKForMCPStamping(nil), false)
	ctx := presentCtx(mcpTestVKValue)
	ctx.Root().UnblockRestrictedWrites()
	ctx.SetValue(schemas.BifrostContextKey("bifrost-injected-tool-execution"), struct{ ClientName, ToolName string }{ClientName: "local", ToolName: "local-write"})
	tool := "local-write"
	req := &schemas.BifrostMCPRequest{RequestType: schemas.MCPRequestTypeChatToolCall, ClientName: "local", ChatAssistantMessageToolCall: &schemas.ChatAssistantMessageToolCall{Function: schemas.ChatAssistantMessageToolCallFunction{Name: &tool, Arguments: "{}"}}}
	_, short, err := p.PreMCPHook(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, short, "a marker written through public SetValue must not bypass the virtual key's tool permits")
}

func TestMCPDestructiveToolRequiresShortLivedAuthorization(t *testing.T) {
	p := newPluginForMCPStamping(t, buildVKForMCPStamping(nil), false)

	t.Run("missing approval", func(t *testing.T) {
		ctx := emptyCtx()
		req, metadata := destructiveMCPRequest("local", "local-delete")
		ctx.SetValue(schemas.BifrostContextKeyMCPToolExecutionMetadata, metadata)
		_, short, err := p.PreMCPHook(ctx, req)
		require.NoError(t, err)
		require.NotNil(t, short)
		require.Contains(t, short.Error.Error.Message, "short-term authorization")
		audit, ok := ctx.Value(schemas.BifrostContextKeyMCPGovernanceAudit).(*schemas.MCPGovernanceAudit)
		require.True(t, ok)
		require.Equal(t, "missing", audit.ApprovalState)
		require.Equal(t, "deny", audit.GovernanceDecision)
		require.Equal(t, "short_lived_authorization_required", audit.GovernanceReason)
	})

	t.Run("legacy approval is insufficient", func(t *testing.T) {
		ctx := presentCtx(mcpTestVKValue)
		req, metadata := destructiveMCPRequest("local", "local-delete")
		ctx.SetValue(schemas.BifrostContextKeyMCPToolExecutionMetadata, metadata)
		SetMCPExecutionAuthorization(ctx, "local", "local-delete")
		_, short, err := p.PreMCPHook(ctx, req)
		require.NoError(t, err)
		require.NotNil(t, short)
		audit, _ := ctx.Value(schemas.BifrostContextKeyMCPGovernanceAudit).(*schemas.MCPGovernanceAudit)
		require.Equal(t, "legacy", audit.ApprovalState)
	})

	t.Run("unexpired exact approval is accepted", func(t *testing.T) {
		ctx := presentCtx(mcpTestVKValue)
		req, metadata := destructiveMCPRequest("local", "local-delete")
		ctx.SetValue(schemas.BifrostContextKeyMCPToolExecutionMetadata, metadata)
		SetMCPExecutionAuthorizationWithTTL(ctx, "local", "local-delete", time.Minute)
		_, short, err := p.PreMCPHook(ctx, req)
		require.NoError(t, err)
		require.Nil(t, short)
		audit, _ := ctx.Value(schemas.BifrostContextKeyMCPGovernanceAudit).(*schemas.MCPGovernanceAudit)
		require.Equal(t, "approved", audit.ApprovalState)
		require.Equal(t, "allow", audit.GovernanceDecision)
	})

	t.Run("expired approval is rejected", func(t *testing.T) {
		ctx := presentCtx(mcpTestVKValue)
		req, metadata := destructiveMCPRequest("local", "local-delete")
		ctx.SetValue(schemas.BifrostContextKeyMCPToolExecutionMetadata, metadata)
		SetMCPExecutionAuthorizationWithTTL(ctx, "local", "local-delete", -time.Second)
		_, short, err := p.PreMCPHook(ctx, req)
		require.NoError(t, err)
		require.NotNil(t, short)
		audit, _ := ctx.Value(schemas.BifrostContextKeyMCPGovernanceAudit).(*schemas.MCPGovernanceAudit)
		require.Equal(t, "expired", audit.ApprovalState)
	})

	t.Run("retargeted approval is rejected", func(t *testing.T) {
		ctx := presentCtx(mcpTestVKValue)
		SetMCPExecutionAuthorizationWithTTL(ctx, "local", "local-delete", time.Minute)
		otherReq, otherMetadata := destructiveMCPRequest("local", "local-update")
		ctx.SetValue(schemas.BifrostContextKeyMCPToolExecutionMetadata, otherMetadata)
		_, short, err := p.PreMCPHook(ctx, otherReq)
		require.NoError(t, err)
		require.NotNil(t, short)
		audit, _ := ctx.Value(schemas.BifrostContextKeyMCPGovernanceAudit).(*schemas.MCPGovernanceAudit)
		require.Equal(t, "mismatched", audit.ApprovalState)
	})

	t.Run("unannotated tool path remains compatible", func(t *testing.T) {
		ctx := emptyCtx()
		toolName := "local-legacy"
		req := &schemas.BifrostMCPRequest{
			RequestType: schemas.MCPRequestTypeChatToolCall,
			ClientName:  "local",
			ChatAssistantMessageToolCall: &schemas.ChatAssistantMessageToolCall{
				Function: schemas.ChatAssistantMessageToolCallFunction{Name: &toolName, Arguments: "{}"},
			},
		}
		ctx.SetValue(schemas.BifrostContextKeyMCPToolExecutionMetadata, &schemas.MCPToolExecutionMetadata{
			ClientName: "local",
			ToolName:   toolName,
			RiskLevel:  schemas.MCPToolRiskUnknown,
		})
		_, short, err := p.PreMCPHook(ctx, req)
		require.NoError(t, err)
		require.Nil(t, short)
	})
}

func TestMCPDurableApprovalHeaderHydratesExactShortLivedAuthorization(t *testing.T) {
	store, err := configstore.NewConfigStore(context.Background(), &configstore.Config{
		Enabled: true,
		Type:    configstore.ConfigStoreTypeSQLite,
		Config:  &configstore.SQLiteConfig{Path: t.TempDir() + "/mcp-approval.db"},
	}, NewMockLogger())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close(context.Background())) })

	plugin := newAccessTestPlugin(t, buildVKForMCPStamping(nil), nil)
	plugin.configStore = store
	now := time.Now().UTC()
	token := "approval-token"
	record := MCPExecutionApprovalRecord{
		MCPExecutionApproval: MCPExecutionApproval{
			ID:         "approval-1",
			ClientName: "local",
			ToolName:   "local-delete",
			IssuedAt:   now,
			ExpiresAt:  now.Add(time.Minute),
		},
		TokenHash: HashMCPApprovalToken(token),
	}
	value, err := EncodeMCPApprovalRecords([]MCPExecutionApprovalRecord{record}, now)
	require.NoError(t, err)
	require.NoError(t, store.UpdateConfig(context.Background(), &configstoreTables.TableGovernanceConfig{
		Key: MCPApprovalConfigKey, Value: value,
	}))

	ctx := presentCtx(mcpTestVKValue)
	ctx.SetValue(schemas.BifrostContextKeyRequestHeaders, map[string]string{MCPApprovalHeader: token})
	req, metadata := destructiveMCPRequest("local", "local-delete")
	ctx.SetValue(schemas.BifrostContextKeyMCPToolExecutionMetadata, metadata)
	_, short, err := plugin.PreMCPHook(ctx, req)
	require.NoError(t, err)
	require.Nil(t, short)
	audit, _ := ctx.Value(schemas.BifrostContextKeyMCPGovernanceAudit).(*schemas.MCPGovernanceAudit)
	require.Equal(t, mcpApprovalApproved, audit.ApprovalState)

	ctx = presentCtx(mcpTestVKValue)
	ctx.SetValue(schemas.BifrostContextKeyRequestHeaders, map[string]string{MCPApprovalHeader: token})
	req, metadata = destructiveMCPRequest("local", "other-tool")
	ctx.SetValue(schemas.BifrostContextKeyMCPToolExecutionMetadata, metadata)
	_, short, err = plugin.PreMCPHook(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, short)
}

// BenchmarkPreMCPHook measures governing one MCP call: a tool call, the baseline, beside the prompt
// and resource reads now governed too (identity and limits, no per-tool permit).
func BenchmarkPreMCPHook(b *testing.B) {
	p := newAccessTestPlugin(b, buildVKForMCPStamping(nil), nil)
	tool := "local-read"
	for _, tc := range []struct {
		name string
		req  *schemas.BifrostMCPRequest
	}{
		{"tool-call", &schemas.BifrostMCPRequest{RequestType: schemas.MCPRequestTypeChatToolCall, ClientName: "local", ChatAssistantMessageToolCall: &schemas.ChatAssistantMessageToolCall{Function: schemas.ChatAssistantMessageToolCallFunction{Name: &tool, Arguments: "{}"}}}},
		{"prompt-get", &schemas.BifrostMCPRequest{RequestType: schemas.MCPRequestTypeGetPrompt, ClientName: "local", BifrostMCPGetPromptRequest: &schemas.BifrostMCPGetPromptRequest{Name: "local-review"}}},
		{"resource-read", &schemas.BifrostMCPRequest{RequestType: schemas.MCPRequestTypeReadResource, ClientName: "local", BifrostMCPReadResourceRequest: &schemas.BifrostMCPReadResourceRequest{URI: "file:///handbook.md"}}},
	} {
		b.Run(tc.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				if _, _, err := p.PreMCPHook(presentCtx(mcpTestVKValue), tc.req); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
