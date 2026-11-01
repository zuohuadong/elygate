package handlers

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestMCPApprovalIssueReturnsBearerOnceAndPersistsOnlyHash(t *testing.T) {
	store := setupPricingOverrideHandlerStore(t)
	handler := &GovernanceHandler{configStore: store}

	ctx := newTestRequestCtx(`{"client_name":"local","tool_name":"local-delete","ttl_seconds":60,"reason":"incident"}`)
	handler.issueMCPApproval(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	requireSingleAuditChange(t, ctx, "mcp_approval.issued")

	var response struct {
		Approval governance.MCPExecutionApproval `json:"approval"`
		Token    string                          `json:"token"`
	}
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
	require.NotEmpty(t, response.Token)
	require.Equal(t, "local", response.Approval.ClientName)
	require.Equal(t, "local-delete", response.Approval.ToolName)

	row, err := store.GetConfig(context.Background(), governance.MCPApprovalConfigKey)
	require.NoError(t, err)
	require.NotContains(t, row.Value, response.Token)
	records, err := governance.DecodeMCPApprovalRecords(row.Value)
	require.NoError(t, err)
	require.Len(t, records, 1)
	require.Equal(t, governance.HashMCPApprovalToken(response.Token), records[0].TokenHash)
}

func TestMCPApprovalRejectsInvalidTTLAndUnknownFields(t *testing.T) {
	store := setupPricingOverrideHandlerStore(t)
	handler := &GovernanceHandler{configStore: store}

	for _, body := range []string{
		`{"client_name":"local","tool_name":"local-delete","ttl_seconds":0}`,
		`{"client_name":"local","tool_name":"local-delete","ttl_seconds":901}`,
		`{"client_name":"local","tool_name":"local-delete","ttl_seconds":60,"unexpected":true}`,
	} {
		ctx := newTestRequestCtx(body)
		handler.issueMCPApproval(ctx)
		require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode(), body)
		require.Empty(t, auditChanges(t, ctx))
	}
}

func TestMCPApprovalRevokeIsIdempotentAndStopsExecution(t *testing.T) {
	store := setupPricingOverrideHandlerStore(t)
	handler := &GovernanceHandler{configStore: store}
	issue := newTestRequestCtx(`{"client_name":"local","tool_name":"local-delete","ttl_seconds":60}`)
	handler.issueMCPApproval(issue)
	require.Equal(t, fasthttp.StatusOK, issue.Response.StatusCode())
	var issued struct {
		Approval governance.MCPExecutionApproval `json:"approval"`
		Token    string                          `json:"token"`
	}
	require.NoError(t, json.Unmarshal(issue.Response.Body(), &issued))

	revoke := &fasthttp.RequestCtx{}
	revoke.Request.SetRequestURI("/api/governance/mcp/approvals/" + issued.Approval.ID)
	revoke.SetUserValue("approval_id", issued.Approval.ID)
	handler.revokeMCPApproval(revoke)
	require.Equal(t, fasthttp.StatusOK, revoke.Response.StatusCode(), string(revoke.Response.Body()))
	requireSingleAuditChange(t, revoke, "mcp_approval.revoked")

	records, err := handler.readMCPApprovalRecords(context.Background())
	require.NoError(t, err)
	require.Len(t, records, 1)
	require.NotNil(t, records[0].RevokedAt)
	require.True(t, strings.Contains(records[0].TokenHash, governance.HashMCPApprovalToken(issued.Token)))

	revokeAgain := &fasthttp.RequestCtx{}
	revokeAgain.Request.SetRequestURI("/api/governance/mcp/approvals/" + issued.Approval.ID)
	revokeAgain.SetUserValue("approval_id", issued.Approval.ID)
	handler.revokeMCPApproval(revokeAgain)
	require.Equal(t, fasthttp.StatusOK, revokeAgain.Response.StatusCode(), string(revokeAgain.Response.Body()))
	require.Empty(t, auditChanges(t, revokeAgain))
}

func TestMCPApprovalViewsExpireWithoutDeletingRecord(t *testing.T) {
	now := time.Now().UTC()
	record := governance.MCPExecutionApprovalRecord{
		MCPExecutionApproval: governance.MCPExecutionApproval{
			ID:         "approval-1",
			ClientName: "local",
			ToolName:   "local-delete",
			IssuedAt:   now.Add(-time.Minute),
			ExpiresAt:  now.Add(-time.Second),
		},
		TokenHash: "hash",
	}
	views := mcpApprovalViews([]governance.MCPExecutionApprovalRecord{record}, now)
	require.Len(t, views, 1)
	require.Equal(t, "expired", views[0].Status)
}
