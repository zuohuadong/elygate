package governance

import (
	"fmt"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
)

// isInjectedToolExecution reads core's provider-injected tool marker. Only core can set
// it; tests swap this to stand in for an execution core started.
var isInjectedToolExecution = bifrost.InjectedToolAuthorized

const mcpAuthorizationContextKey schemas.BifrostContextKey = "bf-governance-mcp-authorization"

// mcpAuthorization binds trusted transport approval to one exact execution target.
// Legacy approvals have no expiry; short-lived approvals set shortLived and
// expiresAt and are the only approvals accepted for explicitly destructive tools.
type mcpAuthorization struct {
	clientName string
	toolName   string
	shortLived bool
	expiresAt  time.Time
}

const (
	mcpApprovalNotRequired = "not_required"
	mcpApprovalApproved    = "approved"
	mcpApprovalMissing     = "missing"
	mcpApprovalExpired     = "expired"
	mcpApprovalMismatched  = "mismatched"
	mcpApprovalLegacy      = "legacy"
)

// stampMCPGovernanceAudit initializes the request-scoped audit record before
// governance evaluates the request. The logging plugin persists the final
// decision after all pre-hooks have run.
func stampMCPGovernanceAudit(ctx *schemas.BifrostContext, req *schemas.BifrostMCPRequest) {
	if ctx == nil || req == nil {
		return
	}
	audit := &schemas.MCPGovernanceAudit{
		RiskLevel:     schemas.MCPToolRiskUnknown,
		ApprovalState: mcpApprovalNotRequired,
	}
	if metadata, _ := ctx.Value(schemas.BifrostContextKeyMCPToolExecutionMetadata).(*schemas.MCPToolExecutionMetadata); metadata != nil {
		audit.RiskLevel = metadata.RiskLevel
	}
	if audit.RiskLevel == schemas.MCPToolRiskHigh {
		audit.ApprovalState, audit.ApprovalExpiresAt = mcpApprovalState(ctx, req)
	}
	ctx.SetMCPGovernanceAudit(audit)
}

func mcpApprovalState(ctx *schemas.BifrostContext, req *schemas.BifrostMCPRequest) (string, *time.Time) {
	approval, ok := ctx.Value(mcpAuthorizationContextKey).(mcpAuthorization)
	if !ok {
		return mcpApprovalMissing, nil
	}
	expiresAt := approval.expiresAt
	var expiresAtPtr *time.Time
	if !expiresAt.IsZero() {
		copy := expiresAt
		expiresAtPtr = &copy
	}
	if approval.clientName == "" || approval.toolName == "" ||
		req.ClientName != approval.clientName || req.GetToolName() != approval.toolName {
		return mcpApprovalMismatched, expiresAtPtr
	}
	if !approval.shortLived {
		return mcpApprovalLegacy, expiresAtPtr
	}
	if expiresAt.IsZero() || !time.Now().Before(expiresAt) {
		return mcpApprovalExpired, expiresAtPtr
	}
	return mcpApprovalApproved, expiresAtPtr
}

func finishMCPGovernanceAudit(ctx *schemas.BifrostContext, decision, reason string) {
	if ctx == nil {
		return
	}
	audit, _ := ctx.Value(schemas.BifrostContextKeyMCPGovernanceAudit).(*schemas.MCPGovernanceAudit)
	if audit == nil {
		audit = &schemas.MCPGovernanceAudit{
			RiskLevel:     schemas.MCPToolRiskUnknown,
			ApprovalState: mcpApprovalNotRequired,
		}
	}
	audit.GovernanceDecision = decision
	audit.GovernanceReason = reason
	ctx.SetMCPGovernanceAudit(audit)
}

func mcpAuditReason(err *schemas.BifrostError, fallback string) string {
	if err == nil {
		return fallback
	}
	if err.Type != nil && *err.Type != "" {
		return *err.Type
	}
	if err.Error != nil && err.Error.Message != "" {
		const maxReasonLength = 512
		if len(err.Error.Message) > maxReasonLength {
			return err.Error.Message[:maxReasonLength]
		}
		return err.Error.Message
	}
	return fmt.Sprintf("mcp_governance_error:%s", fallback)
}

// SetMCPExecutionAuthorization records a transport-verified approval for one MCP call.
// Only trusted handlers may call this after checking their own authorization policy;
// it replaces the MCP tool permit check, never identity, headers or usage limits.
func SetMCPExecutionAuthorization(ctx *schemas.BifrostContext, clientName, toolName string) {
	if ctx == nil {
		return
	}
	ctx.SetValue(mcpAuthorizationContextKey, mcpAuthorization{clientName: clientName, toolName: toolName})
}

// SetMCPExecutionAuthorizationWithTTL records a trusted approval that expires
// after ttl. The target remains exact-match bound and a non-positive ttl is
// immediately expired, which makes accidental zero-value approvals fail closed.
func SetMCPExecutionAuthorizationWithTTL(ctx *schemas.BifrostContext, clientName, toolName string, ttl time.Duration) {
	if ctx == nil {
		return
	}
	ctx.SetValue(mcpAuthorizationContextKey, mcpAuthorization{
		clientName: clientName,
		toolName:   toolName,
		shortLived: true,
		expiresAt:  time.Now().Add(ttl),
	})
}

// hasMCPExecutionAuthorization prevents approval from following a retargeted request.
//
// Core's provider-injected tool marker is the second approval source: Bifrost sets it
// when it runs the tool an operator configured in the provider's injected_tools, which
// no virtual key grant lists. Like the approval above it names one client and one exact
// prefixed tool, and both must match the request.
func hasMCPExecutionAuthorization(ctx *schemas.BifrostContext, req *schemas.BifrostMCPRequest) bool {
	if isInjectedToolExecution(ctx, req.ClientName, req.GetToolName()) {
		return true
	}
	approval, ok := ctx.Value(mcpAuthorizationContextKey).(mcpAuthorization)
	return ok && approval.clientName != "" && approval.toolName != "" && req.ClientName == approval.clientName && req.GetToolName() == approval.toolName
}

func hasMCPShortLivedExecutionAuthorization(ctx *schemas.BifrostContext, req *schemas.BifrostMCPRequest) bool {
	approval, ok := ctx.Value(mcpAuthorizationContextKey).(mcpAuthorization)
	return ok &&
		approval.shortLived &&
		!approval.expiresAt.IsZero() &&
		time.Now().Before(approval.expiresAt) &&
		approval.clientName != "" &&
		approval.toolName != "" &&
		req.ClientName == approval.clientName &&
		req.GetToolName() == approval.toolName
}
