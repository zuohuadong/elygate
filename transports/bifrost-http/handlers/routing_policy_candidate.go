package handlers

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/routing/rules"
)

type RoutingPolicyCandidate struct {
	VersionID     uuid.UUID
	RulesJSON     string
	ChainMaxDepth int
	CreatedAt     time.Time
}

// CompileRoutingPolicy returns an isolated, complete candidate, never a serving
// generation. Scope/key existence and authorization still require live checks
// at publication; a syntactically valid key ID is not proof of access.
func CompileRoutingPolicy(ctx context.Context, candidate RoutingPolicyCandidate) ([]*configtables.TableRoutingRule, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if candidate.VersionID == uuid.Nil || candidate.ChainMaxDepth < 1 || candidate.ChainMaxDepth > 20 {
		return nil, errors.New("a version ID and chain depth between 1 and 20 are required")
	}
	drafts, err := decodeRoutingDraftRules(candidate.RulesJSON)
	if err != nil {
		return nil, err
	}
	compiled, err := normalizeRoutingPolicyRules(drafts)
	if err != nil {
		return nil, err
	}
	slices.SortFunc(compiled, compareRoutingPolicyRules)
	return compileRoutingPolicyRules(ctx, candidate, compiled)
}

type normalizedRoutingRule struct {
	rule          *configtables.TableRoutingRule
	originalIndex int
}

func normalizeRoutingPolicyRules(drafts []simulationRule) ([]normalizedRoutingRule, error) {
	normalized := make([]normalizedRoutingRule, 0, len(drafts))
	ids := make(map[string]bool)
	for index, draft := range drafts {
		if draft.ID != "" && ids[draft.ID] {
			return nil, fmt.Errorf("rules[%d]: duplicate rule id", index)
		}
		ids[draft.ID] = true
		rule, err := normalizeRoutingPolicyRule(draft)
		if err != nil {
			return nil, fmt.Errorf("rules[%d]: %w", index, err)
		}
		for _, prior := range normalized {
			if prior.rule.Scope == rule.Scope && routingScopeID(prior.rule) == routingScopeID(rule) &&
				(prior.rule.Name == rule.Name || prior.rule.Priority == rule.Priority) {
				return nil, fmt.Errorf("rules[%d]: duplicate name or priority within scope", index)
			}
		}
		normalized = append(normalized, normalizedRoutingRule{rule: rule, originalIndex: index})
	}
	return normalized, nil
}

func normalizeRoutingPolicyRule(draft simulationRule) (*configtables.TableRoutingRule, error) {
	if err := validateSimulationRule(draft); err != nil {
		return nil, err
	}
	if strings.TrimSpace(draft.CelExpression) == "" {
		return nil, errors.New("cel_expression must not be blank")
	}
	name := strings.TrimSpace(draft.Name)
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) > 255 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return nil, errors.New("rule name must contain 1..255 characters without control characters")
	}
	scope := draft.Scope
	if scope == "" {
		scope = "global"
	}
	scopeID := draft.ScopeID
	if scope == "global" {
		scopeID = nil
	} else if scopeID == nil || strings.TrimSpace(*scopeID) != *scopeID || strings.TrimSpace(*scopeID) == "" {
		return nil, errors.New("scope_id must not be blank or padded")
	}
	expression := strings.TrimSpace(draft.CelExpression)
	enabled := draft.Enabled == nil || *draft.Enabled
	rule := &configtables.TableRoutingRule{
		Name: name, Description: draft.Description, Enabled: &enabled,
		Scope: scope, ScopeID: scopeID, CelExpression: expression, Priority: draft.Priority,
		ChainRule:   draft.ChainRule != nil && *draft.ChainRule,
		ParsedQuery: draft.Query, ParsedFallbacks: draft.Fallbacks,
		Targets: make([]configtables.TableRoutingTarget, 0, len(draft.Targets)),
	}
	for targetIndex, target := range draft.Targets {
		position := targetIndex
		rule.Targets = append(rule.Targets, configtables.TableRoutingTarget{
			Provider: nonemptyRoutingField(target.Provider), Model: nonemptyRoutingField(target.Model),
			KeyID: nonemptyRoutingField(target.KeyID), Position: &position, Weight: target.Weight,
			TTFTTimeoutMs: nilIfZero(target.TTFTTimeoutMs),
		})
	}
	for index := range rule.ParsedFallbacks {
		// API aliases are not persisted; blank aliases carry no pin.
		rule.ParsedFallbacks[index].ProviderKeyName = nil
	}
	return rule, nil
}

func nonemptyRoutingField(field *string) *string {
	if field == nil || *field == "" {
		return nil
	}
	cloned := *field
	return &cloned
}

func routingScopeID(rule *configtables.TableRoutingRule) string {
	if rule.ScopeID == nil {
		return ""
	}
	return *rule.ScopeID
}

func compareRoutingPolicyRules(a, b normalizedRoutingRule) int {
	if rank := routingScopeRank(a.rule.Scope) - routingScopeRank(b.rule.Scope); rank != 0 {
		return rank
	}
	if compared := strings.Compare(routingScopeID(a.rule), routingScopeID(b.rule)); compared != 0 {
		return compared
	}
	if a.rule.Priority < b.rule.Priority {
		return -1
	}
	if a.rule.Priority > b.rule.Priority {
		return 1
	}
	if a.originalIndex < b.originalIndex {
		return -1
	}
	if a.originalIndex > b.originalIndex {
		return 1
	}
	return 0
}

func routingScopeRank(scope string) int {
	switch scope {
	case "virtual_key":
		return 0
	case "user":
		return 1
	case "team":
		return 2
	case "customer":
		return 3
	case "global":
		return 4
	default:
		return 5
	}
}

func compileRoutingPolicyRules(ctx context.Context, candidate RoutingPolicyCandidate, compiled []normalizedRoutingRule) ([]*configtables.TableRoutingRule, error) {
	compiler, err := rules.NewSimulationStore(ctx, bifrost.NewDefaultLogger(schemas.LogLevelError))
	if err != nil {
		return nil, err
	}
	result := make([]*configtables.TableRoutingRule, 0, len(compiled))
	for index, normalized := range compiled {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		// Version-local identities cannot overwrite caller-named live rules.
		rule := normalized.rule
		rule.ID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(candidate.VersionID.String()+"/"+strconv.Itoa(index))).String()
		rule.CreatedAt = candidate.CreatedAt.UTC().Truncate(time.Microsecond)
		rule.UpdatedAt = rule.CreatedAt
		for target := range rule.Targets {
			rule.Targets[target].RuleID = rule.ID
		}
		if _, err := compiler.GetProgram(ctx, rule); err != nil {
			return nil, fmt.Errorf("rules[%d]: %w", index, err)
		}
		result = append(result, rule)
	}
	return result, ctx.Err()
}
