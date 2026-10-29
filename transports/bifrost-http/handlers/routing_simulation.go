package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	tables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/maximhq/bifrost/plugins/routing/complexity"
	"github.com/maximhq/bifrost/plugins/routing/rules"
	"github.com/valyala/fasthttp"
)

const maxRoutingSimulationBytes = 128 * 1024

type simulationRule struct {
	ID string `json:"id"`
	CreateRoutingRuleRequest
}

type simulationUsage struct {
	Provider string                               `json:"provider"`
	Model    string                               `json:"model"`
	Status   *governance.BudgetAndRateLimitStatus `json:"status"`
}

type simulationSample struct {
	Name           string                `json:"name"`
	Provider       schemas.ModelProvider `json:"provider"`
	Model          string                `json:"model"`
	RequestType    string                `json:"request_type"`
	Scope          simulationScope       `json:"scope"`
	Headers        map[string]string     `json:"headers"`
	Params         map[string]string     `json:"params"`
	Metadata       map[string]string     `json:"metadata"`
	ComplexityTier string                `json:"complexity_tier"`
	Usage          []simulationUsage     `json:"usage"`
}

type simulationScope struct {
	VirtualKeyID   string `json:"virtual_key_id"`
	VirtualKeyName string `json:"virtual_key_name"`
	UserID         string `json:"user_id"`
	TeamID         string `json:"team_id"`
	TeamName       string `json:"team_name"`
	CustomerID     string `json:"customer_id"`
	CustomerName   string `json:"customer_name"`
}

type routingSimulationRequest struct {
	Rules         []simulationRule   `json:"rules"`
	Samples       []simulationSample `json:"samples"`
	ChainMaxDepth int                `json:"chain_max_depth"`
}

type simulationDecision struct {
	Provider      string                   `json:"provider"`
	Model         string                   `json:"model"`
	KeyID         string                   `json:"key_id"`
	Fallbacks     []tables.RoutingFallback `json:"fallbacks"`
	TTFTTimeoutMs int64                    `json:"ttft_timeout_ms"`
	RuleID        string                   `json:"rule_id"`
	RuleName      string                   `json:"rule_name"`
}

type simulationResult struct {
	Name     string                          `json:"name"`
	Matched  bool                            `json:"matched"`
	Decision *simulationDecision             `json:"decision"`
	Error    string                          `json:"error,omitempty"`
	Logs     []schemas.RoutingEngineLogEntry `json:"logs"`
}

// SimulateRouting is registered only behind the control-plane administrator gate.
// All rules, identities and usage are caller-supplied fixtures, never live credentials.
func SimulateRouting(ctx *fasthttp.RequestCtx) {
	ctx.Response.Header.Set("Cache-Control", "no-store")
	if len(ctx.PostBody()) > maxRoutingSimulationBytes {
		SendError(ctx, fasthttp.StatusRequestEntityTooLarge, "routing simulation exceeds 128 KiB")
		return
	}
	var request routingSimulationRequest
	decoder := json.NewDecoder(bytes.NewReader(ctx.PostBody()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || decoder.Decode(new(any)) != io.EOF {
		SendError(ctx, 400, "invalid routing simulation JSON")
		return
	}
	if err := validateRoutingSimulation(request); err != nil {
		SendError(ctx, 400, err.Error())
		return
	}
	// Do not send sample expressions or decision traces to the process logger.
	store, err := rules.NewSimulationStore(context.Background(), bifrost.NewDefaultLogger(schemas.LogLevelError))
	if err != nil {
		SendError(ctx, 500, "failed to initialize routing simulation")
		return
	}
	if err := loadSimulationRules(store, request.Rules); err != nil {
		SendError(ctx, 400, err.Error())
		return
	}
	results := make([]simulationResult, 0, len(request.Samples))
	for _, sample := range request.Samples {
		results = append(results, evaluateSimulationSample(store, sample, request.ChainMaxDepth))
	}
	SendJSON(ctx, map[string]any{"mode": "offline", "selection": "weighted_sample", "results": results})
}

func validateRoutingSimulation(request routingSimulationRequest) error {
	// Cases: empty rules are valid; samples and depth must be explicit and bounded.
	if request.Rules == nil || len(request.Rules) > 32 || len(request.Samples) < 1 || len(request.Samples) > 16 {
		return errors.New("rules must be an array of 0..32 rules; samples must contain 1..16 entries")
	}
	if request.ChainMaxDepth < 1 || request.ChainMaxDepth > 20 {
		return errors.New("chain_max_depth must be between 1 and 20")
	}
	for index, sample := range request.Samples {
		if sample.Model == "" || sample.RequestType == "" || len(sample.Usage) > 32 {
			return fmt.Errorf("samples[%d] requires model, request_type and at most 32 usage snapshots", index)
		}
		if sample.ComplexityTier != "" && sample.ComplexityTier != complexity.TierSimple && sample.ComplexityTier != complexity.TierMedium && sample.ComplexityTier != complexity.TierComplex {
			return fmt.Errorf("samples[%d] has an invalid complexity_tier", index)
		}
		seen := map[simulationRoute]bool{}
		for _, usage := range sample.Usage {
			key := simulationRoute{usage.Provider, usage.Model}
			if usage.Model == "" || seen[key] || !validSimulationUsage(usage.Status) {
				return fmt.Errorf("samples[%d] has an invalid or duplicate usage snapshot", index)
			}
			seen[key] = true
		}
	}
	return nil
}

func validSimulationUsage(status *governance.BudgetAndRateLimitStatus) bool {
	if status == nil {
		return true // Explicitly represents no configured limits for this pair.
	}
	for _, percent := range []float64{status.BudgetPercentUsed, status.RateLimitTokenPercentUsed, status.RateLimitRequestPercentUsed} {
		if math.IsNaN(percent) || math.IsInf(percent, 0) || percent < 0 {
			return false
		}
	}
	return true
}

func loadSimulationRules(store *rules.LocalStore, drafts []simulationRule) error {
	ids := map[string]bool{}
	priorities := map[string]map[int]bool{}
	for index, draft := range drafts {
		if err := validateSimulationRule(draft); err != nil {
			return fmt.Errorf("rules[%d]: %w", index, err)
		}
		id := draft.ID
		if id == "" {
			id = fmt.Sprintf("simulation-%d", index+1)
		}
		if ids[id] {
			return fmt.Errorf("rules[%d]: duplicate rule id", index)
		}
		ids[id] = true
		scope := draft.Scope
		if scope == "" {
			scope = "global"
		}
		scopeID := draft.ScopeID
		if scope == "global" {
			scopeID = nil
		}
		scopeKey := scope
		if scopeID != nil {
			scopeKey += "\x00" + *scopeID
		}
		if priorities[scopeKey] == nil {
			priorities[scopeKey] = map[int]bool{}
		}
		if priorities[scopeKey][draft.Priority] {
			return fmt.Errorf("rules[%d]: duplicate priority within scope", index)
		}
		priorities[scopeKey][draft.Priority] = true
		rule := simulationTableRule(draft)
		rule.ID, rule.Scope, rule.ScopeID = id, scope, scopeID
		if err := store.UpsertRule(context.Background(), rule); err != nil {
			return err
		}
		if _, err := store.GetProgram(context.Background(), rule); err != nil {
			return fmt.Errorf("rules[%d]: %w", index, err)
		}
	}
	return nil
}

func simulationTableRule(draft simulationRule) *tables.TableRoutingRule {
	targets := make([]tables.TableRoutingTarget, 0, len(draft.Targets))
	for _, target := range draft.Targets {
		targets = append(targets, tables.TableRoutingTarget{
			Provider: target.Provider, Model: target.Model, KeyID: target.KeyID,
			Weight: target.Weight, TTFTTimeoutMs: nilIfZero(target.TTFTTimeoutMs),
		})
	}
	return &tables.TableRoutingRule{
		Name: draft.Name, Description: draft.Description, Enabled: draft.Enabled,
		Priority: draft.Priority, CelExpression: strings.TrimSpace(draft.CelExpression),
		Targets: targets, ParsedFallbacks: draft.Fallbacks, ParsedQuery: draft.Query,
		ChainRule: draft.ChainRule != nil && *draft.ChainRule,
	}
}

func validateSimulationRule(draft simulationRule) error {
	if strings.TrimSpace(draft.Name) == "" || len(draft.CelExpression) > 4096 || len(draft.Targets) < 1 || len(draft.Targets) > 16 || len(draft.Fallbacks) > 16 {
		return errors.New("name is required; CEL <=4096 bytes; targets 1..16; fallbacks <=16")
	}
	if err := validateRoutingTargets(draft.Targets); err != nil {
		return err
	}
	if err := validateRoutingFallbacks(draft.Fallbacks); err != nil {
		return err
	}
	if draft.Scope != "" {
		if err := validateRoutingScope(draft.Scope); err != nil {
			return err
		}
	}
	if draft.Scope != "" && draft.Scope != "global" && (draft.ScopeID == nil || *draft.ScopeID == "") {
		return errors.New("scope_id is required for non-global scope")
	}
	return nil
}

type simulationRoute struct{ provider, model string }
type simulationGovernance struct {
	statuses map[simulationRoute]*governance.BudgetAndRateLimitStatus
	missing  []simulationRoute
}

func (g *simulationGovernance) GetBudgetAndRateLimitStatus(_ *schemas.BifrostContext, provider schemas.ModelProvider, model string, _ map[string]float64, _ map[string]int64, _ map[string]int64) *governance.BudgetAndRateLimitStatus {
	key := simulationRoute{string(provider), model}
	status, exists := g.statuses[key]
	if !exists {
		g.missing = append(g.missing, key)
	}
	return status
}

func evaluateSimulationSample(store *rules.LocalStore, sample simulationSample, depth int) simulationResult {
	governanceSnapshot := &simulationGovernance{statuses: map[simulationRoute]*governance.BudgetAndRateLimitStatus{}}
	for _, usage := range sample.Usage {
		governanceSnapshot.statuses[simulationRoute{usage.Provider, usage.Model}] = usage.Status
	}
	engine, err := rules.NewEngine(store, governanceSnapshot, bifrost.NewDefaultLogger(schemas.LogLevelError), &depth)
	sampleResult := simulationResult{Name: sample.Name, Logs: []schemas.RoutingEngineLogEntry{}}
	if err != nil {
		sampleResult.Error = "failed to initialize sample engine"
		return sampleResult
	}
	ctx, cancel := schemas.NewBifrostContextWithCancel(context.Background())
	defer cancel()
	decision, err := engine.EvaluateRoutingRules(ctx, simulationEvaluationContext(sample))
	sampleResult.Logs = append(sampleResult.Logs, ctx.GetRoutingEngineLogs()...)
	if len(governanceSnapshot.missing) > 0 {
		missing := governanceSnapshot.missing[0]
		sampleResult.Error = fmt.Sprintf("missing usage snapshot for provider=%q model=%q", missing.provider, missing.model)
		return sampleResult
	}
	if err != nil {
		sampleResult.Error = err.Error()
		return sampleResult
	}
	for _, entry := range sampleResult.Logs {
		if entry.Level == schemas.LogLevelError {
			sampleResult.Error = "rule evaluation failed; inspect decision trace"
			return sampleResult
		}
		if entry.Level == schemas.LogLevelWarn {
			sampleResult.Error = "rule evaluation incomplete; inspect decision trace"
			return sampleResult
		}
	}
	if decision != nil {
		sampleResult.Matched = true
		sampleResult.Decision = &simulationDecision{Provider: decision.Provider, Model: decision.Model, KeyID: decision.KeyID,
			Fallbacks: decision.Fallbacks, TTFTTimeoutMs: decision.TTFTTimeout.Milliseconds(), RuleID: decision.MatchedRuleID, RuleName: decision.MatchedRuleName}
	}
	return sampleResult
}

func simulationEvaluationContext(sample simulationSample) *rules.EvaluationContext {
	scope := sample.Scope
	routingContext := &rules.EvaluationContext{Provider: sample.Provider, Model: sample.Model, RequestType: sample.RequestType,
		Scope:   rules.GovernanceScope{VirtualKeyID: scope.VirtualKeyID, VirtualKeyName: scope.VirtualKeyName, UserID: scope.UserID, TeamID: scope.TeamID, TeamName: scope.TeamName, CustomerID: scope.CustomerID, CustomerName: scope.CustomerName},
		Headers: sample.Headers, QueryParams: sample.Params, Metadata: sample.Metadata}
	if sample.ComplexityTier != "" {
		routingContext.ComputeComplexity = func() *complexity.ComplexityResult {
			return &complexity.ComplexityResult{Tier: sample.ComplexityTier}
		}
	}
	return routingContext
}
