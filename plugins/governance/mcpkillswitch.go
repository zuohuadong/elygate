package governance

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
)

// MCPKillSwitchConfigKey is the durable governance_config key used for the
// emergency MCP deny list. Keeping the document in the shared config store
// lets every gateway instance observe the same decision without adding a
// second persistence contract.
const MCPKillSwitchConfigKey = "mcp_kill_switches"

const (
	MCPKillSwitchScopeGlobal      = "global"
	MCPKillSwitchScopeTenant      = "tenant"
	MCPKillSwitchScopeAgent       = "agent"
	MCPKillSwitchScopeApplication = "application"
	MCPKillSwitchScopeTool        = "tool"
	mcpKillSwitchRefreshInterval  = time.Second
	maxMCPKillSwitchReasonLength  = 512
	maxMCPKillSwitchTargetLength  = 255
)

// MCPKillSwitch is one persisted emergency deny rule. Scope and Target are
// immutable identity fields for an entry; Enabled controls whether it is live.
// ExpiresAt is optional and is evaluated by every request, so an expired switch
// cannot remain active merely because a process has not restarted.
type MCPKillSwitch struct {
	Scope     string     `json:"scope"`
	Target    string     `json:"target"`
	Enabled   bool       `json:"enabled"`
	Reason    string     `json:"reason,omitempty"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type mcpKillSwitchDocument struct {
	Version   uint64          `json:"version"`
	UpdatedAt time.Time       `json:"updated_at"`
	Switches  []MCPKillSwitch `json:"switches"`
}

// DecodeMCPKillSwitches accepts the current document shape and the original
// bare-array shape so a partially upgraded node never drops an emergency rule.
func DecodeMCPKillSwitches(value string) ([]MCPKillSwitch, error) {
	if strings.TrimSpace(value) == "" {
		return []MCPKillSwitch{}, nil
	}
	var document mcpKillSwitchDocument
	if err := json.Unmarshal([]byte(value), &document); err == nil && document.Switches != nil {
		return normalizeMCPKillSwitches(document.Switches)
	}
	var switches []MCPKillSwitch
	if err := json.Unmarshal([]byte(value), &switches); err != nil {
		return nil, fmt.Errorf("invalid MCP kill-switch document: %w", err)
	}
	return normalizeMCPKillSwitches(switches)
}

// EncodeMCPKillSwitches serializes a stable versioned document for the shared
// config store. The timestamp is supplied by the caller to make tests and
// audit receipts deterministic.
func EncodeMCPKillSwitches(switches []MCPKillSwitch, now time.Time) (string, error) {
	normalized, err := normalizeMCPKillSwitches(switches)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(mcpKillSwitchDocument{
		Version:   1,
		UpdatedAt: now.UTC(),
		Switches:  normalized,
	})
	if err != nil {
		return "", fmt.Errorf("marshal MCP kill-switch document: %w", err)
	}
	return string(payload), nil
}

// ValidateMCPKillSwitch validates one management API mutation before it is
// persisted. Targets intentionally remain opaque IDs, but scope-specific
// syntax is checked at the execution boundary.
func ValidateMCPKillSwitch(rule MCPKillSwitch) error {
	rule.Scope = strings.ToLower(strings.TrimSpace(rule.Scope))
	rule.Target = strings.TrimSpace(rule.Target)
	switch rule.Scope {
	case MCPKillSwitchScopeGlobal:
		if rule.Target != "" && rule.Target != "*" {
			return fmt.Errorf("global kill switch target must be empty or *")
		}
	case MCPKillSwitchScopeTenant, MCPKillSwitchScopeAgent, MCPKillSwitchScopeApplication, MCPKillSwitchScopeTool:
		if rule.Target == "" || rule.Target == "*" {
			return fmt.Errorf("%s kill switch target must be non-empty", rule.Scope)
		}
	default:
		return fmt.Errorf("unsupported MCP kill switch scope %q", rule.Scope)
	}
	if len(rule.Target) > maxMCPKillSwitchTargetLength {
		return fmt.Errorf("MCP kill switch target must be at most %d characters", maxMCPKillSwitchTargetLength)
	}
	if len(rule.Reason) > maxMCPKillSwitchReasonLength {
		return fmt.Errorf("MCP kill switch reason must be at most %d characters", maxMCPKillSwitchReasonLength)
	}
	if rule.ExpiresAt != nil && rule.ExpiresAt.IsZero() {
		return fmt.Errorf("MCP kill switch expires_at must be a real timestamp")
	}
	return nil
}

func normalizeMCPKillSwitches(switches []MCPKillSwitch) ([]MCPKillSwitch, error) {
	out := make([]MCPKillSwitch, 0, len(switches))
	seen := make(map[string]struct{}, len(switches))
	for _, rule := range switches {
		rule.Scope = strings.ToLower(strings.TrimSpace(rule.Scope))
		rule.Target = strings.TrimSpace(rule.Target)
		rule.Reason = strings.TrimSpace(rule.Reason)
		if rule.Scope == MCPKillSwitchScopeGlobal && rule.Target == "" {
			rule.Target = "*"
		}
		if err := ValidateMCPKillSwitch(rule); err != nil {
			return nil, err
		}
		key := rule.Scope + "\x00" + rule.Target
		if _, exists := seen[key]; exists {
			return nil, fmt.Errorf("duplicate MCP kill switch %s/%s", rule.Scope, rule.Target)
		}
		seen[key] = struct{}{}
		if rule.ExpiresAt != nil {
			value := rule.ExpiresAt.UTC()
			rule.ExpiresAt = &value
		}
		if !rule.UpdatedAt.IsZero() {
			rule.UpdatedAt = rule.UpdatedAt.UTC()
		}
		out = append(out, rule)
	}
	slices.SortFunc(out, func(a, b MCPKillSwitch) int {
		if a.Scope != b.Scope {
			return strings.Compare(a.Scope, b.Scope)
		}
		return strings.Compare(a.Target, b.Target)
	})
	return out, nil
}

// killSwitchCache is embedded by GovernancePlugin. A one-second refresh keeps
// emergency changes visible across replicas while avoiding a database read on
// every tool call.
type mcpKillSwitchCache struct {
	mu       sync.RWMutex
	loadedAt time.Time
	switches []MCPKillSwitch
}

func (p *GovernancePlugin) refreshMCPKillSwitches(ctx *schemas.BifrostContext) []MCPKillSwitch {
	now := time.Now()
	p.mcpKillSwitches.mu.RLock()
	if !p.mcpKillSwitches.loadedAt.IsZero() && now.Sub(p.mcpKillSwitches.loadedAt) < mcpKillSwitchRefreshInterval {
		result := slices.Clone(p.mcpKillSwitches.switches)
		p.mcpKillSwitches.mu.RUnlock()
		return result
	}
	p.mcpKillSwitches.mu.RUnlock()

	if p.configStore == nil {
		return nil
	}
	config, err := p.configStore.GetConfig(ctx, MCPKillSwitchConfigKey)
	if err != nil {
		if errors.Is(err, configstore.ErrNotFound) {
			p.mcpKillSwitches.mu.Lock()
			p.mcpKillSwitches.loadedAt = now
			p.mcpKillSwitches.switches = nil
			p.mcpKillSwitches.mu.Unlock()
			return nil
		}
		// Keep a previously observed active switch during a transient DB error.
		// The cache timestamp still bounds retries, avoiding request storms.
		p.mcpKillSwitches.mu.Lock()
		p.mcpKillSwitches.loadedAt = now
		result := slices.Clone(p.mcpKillSwitches.switches)
		p.mcpKillSwitches.mu.Unlock()
		if p.logger != nil {
			p.logger.Warn("governance: failed to refresh MCP kill switches: %v", err)
		}
		return result
	}
	if config == nil {
		p.mcpKillSwitches.mu.Lock()
		p.mcpKillSwitches.loadedAt = now
		p.mcpKillSwitches.switches = nil
		p.mcpKillSwitches.mu.Unlock()
		return nil
	}
	switches, err := DecodeMCPKillSwitches(config.Value)
	if err != nil {
		p.mcpKillSwitches.mu.Lock()
		p.mcpKillSwitches.loadedAt = now
		result := slices.Clone(p.mcpKillSwitches.switches)
		p.mcpKillSwitches.mu.Unlock()
		if p.logger != nil {
			p.logger.Error("governance: invalid persisted MCP kill switches: %v", err)
		}
		return result
	}
	p.mcpKillSwitches.mu.Lock()
	p.mcpKillSwitches.loadedAt = now
	p.mcpKillSwitches.switches = switches
	result := slices.Clone(switches)
	p.mcpKillSwitches.mu.Unlock()
	return result
}

func mcpKillSwitchIdentities(ctx *schemas.BifrostContext, req *schemas.BifrostMCPRequest) map[string]map[string]struct{} {
	identities := map[string]map[string]struct{}{
		MCPKillSwitchScopeGlobal:      {"": {}, "*": {}},
		MCPKillSwitchScopeTenant:      {},
		MCPKillSwitchScopeAgent:       {},
		MCPKillSwitchScopeApplication: {},
		MCPKillSwitchScopeTool:        {},
	}
	if req != nil {
		tool := req.GetToolName()
		if req.ClientName != "" && tool != "" {
			identities[MCPKillSwitchScopeTool][req.ClientName+"/"+tool] = struct{}{}
			identities[MCPKillSwitchScopeTool][req.ClientName+"-"+tool] = struct{}{}
		}
	}
	for _, entry := range []struct {
		scope string
		key   schemas.BifrostContextKey
	}{
		{MCPKillSwitchScopeTenant, schemas.BifrostContextKeyGovernanceCustomerID},
		{MCPKillSwitchScopeTenant, schemas.BifrostContextKeyGovernanceTeamID},
		{MCPKillSwitchScopeTenant, schemas.BifrostContextKeyGovernanceBusinessUnitID},
		{MCPKillSwitchScopeApplication, schemas.BifrostContextKeyApp},
	} {
		if value, ok := ctx.Value(entry.key).(string); ok && strings.TrimSpace(value) != "" {
			identities[entry.scope][strings.TrimSpace(value)] = struct{}{}
		}
	}
	if userAgent, ok := ctx.Value(schemas.BifrostContextKeyUserAgent).(string); ok && userAgent != "" {
		identities[MCPKillSwitchScopeApplication][schemas.DetectAppFromUserAgent(userAgent)] = struct{}{}
	}
	if headers, ok := ctx.Value(schemas.BifrostContextKeyRequestHeaders).(map[string]string); ok {
		for _, key := range []string{"x-bf-agent-id", "x-bf-agent-name", "x-bf-agent-correlation-id"} {
			if value := strings.TrimSpace(headers[key]); value != "" {
				identities[MCPKillSwitchScopeAgent][value] = struct{}{}
			}
		}
	}
	return identities
}

func (p *GovernancePlugin) mcpKillSwitchDecision(ctx *schemas.BifrostContext, req *schemas.BifrostMCPRequest) (MCPKillSwitch, bool) {
	now := time.Now()
	switches := p.refreshMCPKillSwitches(ctx)
	if len(switches) == 0 {
		return MCPKillSwitch{}, false
	}
	identities := mcpKillSwitchIdentities(ctx, req)
	for _, rule := range switches {
		if !rule.Enabled || (rule.ExpiresAt != nil && !now.Before(*rule.ExpiresAt)) {
			continue
		}
		if _, ok := identities[rule.Scope][rule.Target]; ok {
			return rule, true
		}
	}
	return MCPKillSwitch{}, false
}

func formatMCPKillSwitchReason(rule MCPKillSwitch) string {
	reason := strings.TrimSpace(rule.Reason)
	if reason == "" {
		reason = "operator emergency stop"
	}
	return fmt.Sprintf("kill_switch:%s:%s:%s", rule.Scope, rule.Target, reason)
}
