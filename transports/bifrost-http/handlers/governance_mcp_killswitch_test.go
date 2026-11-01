package handlers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestMCPKillSwitchHandlerUpdateNormalizesAndReplaces(t *testing.T) {
	store := setupPricingOverrideHandlerStore(t)
	handler := &GovernanceHandler{configStore: store}

	ctx := newTestRequestCtx(`{"scope":" TOOL ","target":" client/tool ","enabled":true,"reason":" incident "}`)
	handler.updateMCPKillSwitch(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	requireSingleAuditChange(t, ctx, "mcp_kill_switch.updated")

	row, err := store.GetConfig(context.Background(), governance.MCPKillSwitchConfigKey)
	require.NoError(t, err)
	switches, err := governance.DecodeMCPKillSwitches(row.Value)
	require.NoError(t, err)
	require.Len(t, switches, 1)
	assert.Equal(t, governance.MCPKillSwitchScopeTool, switches[0].Scope)
	assert.Equal(t, "client/tool", switches[0].Target)
	assert.Equal(t, "incident", switches[0].Reason)

	ctx = newTestRequestCtx(`{"scope":"tool","target":"client/tool","enabled":false}`)
	handler.updateMCPKillSwitch(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	requireSingleAuditChange(t, ctx, "mcp_kill_switch.updated")

	row, err = store.GetConfig(context.Background(), governance.MCPKillSwitchConfigKey)
	require.NoError(t, err)
	switches, err = governance.DecodeMCPKillSwitches(row.Value)
	require.NoError(t, err)
	require.Len(t, switches, 1, "same scope/target is an idempotent replacement")
	assert.False(t, switches[0].Enabled)
}

func TestMCPKillSwitchHandlerCanonicalizesEmptyGlobalTarget(t *testing.T) {
	store := setupPricingOverrideHandlerStore(t)
	handler := &GovernanceHandler{configStore: store}

	ctx := newTestRequestCtx(`{"scope":"global","target":"","enabled":true}`)
	handler.updateMCPKillSwitch(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))

	row, err := store.GetConfig(context.Background(), governance.MCPKillSwitchConfigKey)
	require.NoError(t, err)
	switches, err := governance.DecodeMCPKillSwitches(row.Value)
	require.NoError(t, err)
	require.Len(t, switches, 1)
	assert.Equal(t, "*", switches[0].Target)
}

func TestMCPKillSwitchHandlerDeletePersistsAndAudits(t *testing.T) {
	store := setupPricingOverrideHandlerStore(t)
	handler := &GovernanceHandler{configStore: store}

	create := newTestRequestCtx(`{"scope":"global","target":"*","enabled":true}`)
	handler.updateMCPKillSwitch(create)
	require.Equal(t, fasthttp.StatusOK, create.Response.StatusCode(), string(create.Response.Body()))

	deleteCtx := &fasthttp.RequestCtx{}
	deleteCtx.Request.SetRequestURI("/api/governance/mcp/kill-switches?scope=GLOBAL&target=*")
	handler.deleteMCPKillSwitch(deleteCtx)
	require.Equal(t, fasthttp.StatusOK, deleteCtx.Response.StatusCode(), string(deleteCtx.Response.Body()))
	requireSingleAuditChange(t, deleteCtx, "mcp_kill_switch.deleted")

	row, err := store.GetConfig(context.Background(), governance.MCPKillSwitchConfigKey)
	require.NoError(t, err)
	switches, err := governance.DecodeMCPKillSwitches(row.Value)
	require.NoError(t, err)
	assert.Empty(t, switches)

	missing := &fasthttp.RequestCtx{}
	missing.Request.SetRequestURI("/api/governance/mcp/kill-switches?scope=global&target=*")
	handler.deleteMCPKillSwitch(missing)
	assert.Equal(t, fasthttp.StatusNotFound, missing.Response.StatusCode())
	assert.Empty(t, auditChanges(t, missing))
}

func TestMCPKillSwitchHandlerRejectsUnknownJSONFields(t *testing.T) {
	store := setupPricingOverrideHandlerStore(t)
	handler := &GovernanceHandler{configStore: store}
	ctx := newTestRequestCtx(`{"scope":"global","target":"*","enabled":true,"unexpected":true}`)

	handler.updateMCPKillSwitch(ctx)
	assert.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode())

	var body map[string]any
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &body))
	assert.NotEmpty(t, body)
	assert.Empty(t, auditChanges(t, ctx))
}

func TestMCPKillSwitchHandlerReadMissingConfigIsEmpty(t *testing.T) {
	store := setupPricingOverrideHandlerStore(t)
	handler := &GovernanceHandler{configStore: store}
	ctx := &fasthttp.RequestCtx{}

	handler.getMCPKillSwitches(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	var response struct {
		Switches []governance.MCPKillSwitch `json:"switches"`
	}
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
	assert.Empty(t, response.Switches)
}
