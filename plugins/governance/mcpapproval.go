package governance

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

// MCPApprovalConfigKey is the shared config-store key for short-lived MCP
// execution approvals. Only token hashes are persisted; the bearer token is
// returned once by the management API and is never recoverable from storage.
const MCPApprovalConfigKey = "mcp_execution_approvals"

// MCPApprovalHeader is the request header accepted by the MCP execution gate.
// It is intentionally separate from authentication and virtual-key headers.
const MCPApprovalHeader = "x-bf-mcp-approval"

const (
	MCPApprovalMinTTL        = time.Second
	MCPApprovalMaxTTL        = 15 * time.Minute
	maxMCPApprovalFieldSize  = 255
	maxMCPApprovalReasonSize = 512
)

// MCPExecutionApproval is the redacted, operator-visible representation of an
// approval. TokenHash is intentionally not exported in this view.
type MCPExecutionApproval struct {
	ID         string     `json:"id"`
	ClientName string     `json:"client_name"`
	ToolName   string     `json:"tool_name"`
	IssuedAt   time.Time  `json:"issued_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	Reason     string     `json:"reason,omitempty"`
}

// MCPExecutionApprovalRecord is the durable representation. TokenHash is
// never returned by the management handlers, but is needed by the execution
// gate for constant-time token verification.
type MCPExecutionApprovalRecord struct {
	MCPExecutionApproval
	TokenHash string `json:"token_hash"`
}

type mcpExecutionApprovalDocument struct {
	Version   uint64                       `json:"version"`
	UpdatedAt time.Time                    `json:"updated_at"`
	Approvals []MCPExecutionApprovalRecord `json:"approvals"`
}

// ValidateMCPExecutionApprovalTarget validates the exact upstream binding.
func ValidateMCPExecutionApprovalTarget(clientName, toolName string) error {
	if strings.TrimSpace(clientName) == "" || strings.TrimSpace(toolName) == "" {
		return fmt.Errorf("client_name and tool_name are required")
	}
	if len(clientName) > maxMCPApprovalFieldSize || len(toolName) > maxMCPApprovalFieldSize {
		return fmt.Errorf("client_name and tool_name must be at most %d characters", maxMCPApprovalFieldSize)
	}
	if strings.ContainsAny(clientName, "\r\n") || strings.ContainsAny(toolName, "\r\n") {
		return fmt.Errorf("client_name and tool_name must not contain line breaks")
	}
	return nil
}

// ValidateMCPExecutionApprovalTTL checks the bounded lifetime required for a
// destructive-tool approval.
func ValidateMCPExecutionApprovalTTL(ttl time.Duration) error {
	if ttl < MCPApprovalMinTTL || ttl > MCPApprovalMaxTTL {
		return fmt.Errorf("ttl must be between %s and %s", MCPApprovalMinTTL, MCPApprovalMaxTTL)
	}
	return nil
}

// ValidateMCPExecutionApprovalReason bounds operator-supplied audit context.
func ValidateMCPExecutionApprovalReason(reason string) error {
	if len(reason) > maxMCPApprovalReasonSize {
		return fmt.Errorf("reason must be at most %d characters", maxMCPApprovalReasonSize)
	}
	return nil
}

// HashMCPApprovalToken returns the stable digest used for constant-time lookup.
func HashMCPApprovalToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// GenerateMCPApprovalToken creates a high-entropy URL-safe bearer token.
func GenerateMCPApprovalToken() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate MCP approval token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

// DecodeMCPApprovals decodes the versioned durable document. The legacy bare
// array shape is accepted so an in-flight upgrade cannot discard approvals.
func DecodeMCPApprovals(value string) ([]MCPExecutionApproval, error) {
	records, err := DecodeMCPApprovalRecords(value)
	if err != nil {
		return nil, err
	}
	out := make([]MCPExecutionApproval, 0, len(records))
	for _, record := range records {
		out = append(out, record.MCPExecutionApproval)
	}
	return out, nil
}

// DecodeMCPApprovalRecords decodes the durable representation for governance
// management code. Callers must not serialize TokenHash in API responses.
func DecodeMCPApprovalRecords(value string) ([]MCPExecutionApprovalRecord, error) {
	if strings.TrimSpace(value) == "" {
		return []MCPExecutionApprovalRecord{}, nil
	}
	var document mcpExecutionApprovalDocument
	if err := json.Unmarshal([]byte(value), &document); err == nil && document.Approvals != nil {
		return normalizeMCPApprovalRecords(document.Approvals)
	}
	var records []MCPExecutionApprovalRecord
	if err := json.Unmarshal([]byte(value), &records); err != nil {
		return nil, fmt.Errorf("invalid MCP approval document: %w", err)
	}
	return normalizeMCPApprovalRecords(records)
}

// EncodeMCPApprovals serializes redacted approvals for diagnostics and tests.
// Management writes use EncodeMCPApprovalRecords through the package-private
// helper below so token hashes remain in storage.
func EncodeMCPApprovals(approvals []MCPExecutionApproval, now time.Time) (string, error) {
	records := make([]MCPExecutionApprovalRecord, 0, len(approvals))
	for _, approval := range approvals {
		records = append(records, MCPExecutionApprovalRecord{MCPExecutionApproval: approval})
	}
	return EncodeMCPApprovalRecords(records, now)
}

// EncodeMCPApprovalRecords serializes durable approval records.
func EncodeMCPApprovalRecords(records []MCPExecutionApprovalRecord, now time.Time) (string, error) {
	normalized, err := normalizeMCPApprovalRecords(records)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(mcpExecutionApprovalDocument{
		Version:   1,
		UpdatedAt: now.UTC(),
		Approvals: normalized,
	})
	if err != nil {
		return "", fmt.Errorf("marshal MCP approval document: %w", err)
	}
	return string(payload), nil
}

func normalizeMCPApprovalRecords(records []MCPExecutionApprovalRecord) ([]MCPExecutionApprovalRecord, error) {
	out := make([]MCPExecutionApprovalRecord, 0, len(records))
	seen := make(map[string]struct{}, len(records))
	for _, record := range records {
		record.ClientName = strings.TrimSpace(record.ClientName)
		record.ToolName = strings.TrimSpace(record.ToolName)
		record.Reason = strings.TrimSpace(record.Reason)
		if err := ValidateMCPExecutionApprovalTarget(record.ClientName, record.ToolName); err != nil {
			return nil, err
		}
		if err := ValidateMCPExecutionApprovalReason(record.Reason); err != nil {
			return nil, err
		}
		if record.ID == "" || record.TokenHash == "" || record.ExpiresAt.IsZero() || record.IssuedAt.IsZero() {
			return nil, fmt.Errorf("MCP approval record is incomplete")
		}
		if _, exists := seen[record.ID]; exists {
			return nil, fmt.Errorf("duplicate MCP approval %s", record.ID)
		}
		seen[record.ID] = struct{}{}
		record.IssuedAt = record.IssuedAt.UTC()
		record.ExpiresAt = record.ExpiresAt.UTC()
		if record.RevokedAt != nil {
			value := record.RevokedAt.UTC()
			record.RevokedAt = &value
		}
		out = append(out, record)
	}
	return out, nil
}

func approvalTokenMatches(record MCPExecutionApprovalRecord, token string) bool {
	got := HashMCPApprovalToken(token)
	return subtle.ConstantTimeCompare([]byte(got), []byte(record.TokenHash)) == 1
}

// resolveMCPApprovalFromHeaders turns a durable bearer token into the existing
// request-scoped authorization marker. It returns false for absent, invalid,
// expired, revoked, or retargeted approvals and never logs the token.
func (p *GovernancePlugin) resolveMCPApprovalFromHeaders(ctx *schemas.BifrostContext, req *schemas.BifrostMCPRequest) bool {
	if p == nil || p.configStore == nil || ctx == nil || req == nil {
		return false
	}
	metadata, _ := ctx.Value(schemas.BifrostContextKeyMCPToolExecutionMetadata).(*schemas.MCPToolExecutionMetadata)
	if metadata == nil || metadata.RiskLevel != schemas.MCPToolRiskHigh {
		return false
	}
	headers, _ := ctx.Value(schemas.BifrostContextKeyRequestHeaders).(map[string]string)
	token := strings.TrimSpace(headers[MCPApprovalHeader])
	if token == "" {
		return false
	}
	config, err := p.configStore.GetConfig(ctx, MCPApprovalConfigKey)
	if err != nil || config == nil {
		return false
	}
	records, err := DecodeMCPApprovalRecords(config.Value)
	if err != nil {
		return false
	}
	now := time.Now()
	for _, record := range records {
		if record.ClientName != req.ClientName || record.ToolName != req.GetToolName() ||
			record.RevokedAt != nil || !now.Before(record.ExpiresAt) || !approvalTokenMatches(record, token) {
			continue
		}
		SetMCPExecutionAuthorizationWithTTL(ctx, record.ClientName, record.ToolName, time.Until(record.ExpiresAt))
		return true
	}
	return false
}
