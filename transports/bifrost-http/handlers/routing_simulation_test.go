package handlers

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func simulationFixture() routingSimulationRequest {
	return routingSimulationRequest{
		ChainMaxDepth: 10,
		Rules: []simulationRule{{ID: "rule-1", CreateRoutingRuleRequest: CreateRoutingRuleRequest{
			Name: "fixture", CelExpression: "true",
			Targets: []RoutingTarget{{Provider: bifrost.Ptr("openai"), Model: bifrost.Ptr("target"), Weight: 1}},
		}}},
		Samples: []simulationSample{{
			Name: "sample", Provider: schemas.OpenAI, Model: "input", RequestType: "chat_completion",
			Usage: []simulationUsage{{Provider: "openai", Model: "input"}},
		}},
	}
}

func BenchmarkRoutingSimulation(b *testing.B) {
	body, err := json.Marshal(simulationFixture())
	require.NoError(b, err)
	ctx := newTestRequestCtx(string(body))
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		ctx.Response.Reset()
		SimulateRouting(ctx)
		if ctx.Response.StatusCode() != fasthttp.StatusOK {
			b.Fatalf("simulation failed: %s", ctx.Response.Body())
		}
	}
}

func runSimulationFixture(t *testing.T, request routingSimulationRequest) []simulationResult {
	t.Helper()
	body, err := json.Marshal(request)
	require.NoError(t, err)
	ctx := newTestRequestCtx(string(body))
	SimulateRouting(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.Equal(t, "no-store", string(ctx.Response.Header.Peek("Cache-Control")))
	var response struct {
		Mode      string             `json:"mode"`
		Selection string             `json:"selection"`
		Results   []simulationResult `json:"results"`
	}
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
	require.Equal(t, "offline", response.Mode)
	require.Equal(t, "weighted_sample", response.Selection)
	require.Len(t, response.Results, len(request.Samples))
	return response.Results
}

func TestRoutingSimulationDecision(t *testing.T) {
	request := simulationFixture()
	request.Rules[0].Targets[0].KeyID = bifrost.Ptr("target-key")
	request.Rules[0].Targets[0].TTFTTimeoutMs = bifrost.Ptr(1234)
	request.Rules[0].Fallbacks = []tables.RoutingFallback{{
		Fallback: schemas.Fallback{Provider: schemas.Anthropic, Model: "backup", KeyID: "backup-key"},
	}}
	decision := runSimulationFixture(t, request)[0]
	require.Empty(t, decision.Error)
	require.True(t, decision.Matched)
	require.NotNil(t, decision.Decision)
	require.Equal(t, "target", decision.Decision.Model)
	require.Equal(t, "target-key", decision.Decision.KeyID)
	require.EqualValues(t, 1234, decision.Decision.TTFTTimeoutMs)
	require.Equal(t, request.Rules[0].Fallbacks, decision.Decision.Fallbacks)
	require.Equal(t, "rule-1", decision.Decision.RuleID)
	require.NotEmpty(t, decision.Logs)
}

func TestRoutingSimulationScopeAndPriority(t *testing.T) {
	request := simulationFixture()
	global := request.Rules[0]
	team := global
	team.ID, team.Name, team.Scope, team.ScopeID = "team-rule", "team", "team", bifrost.Ptr("team-1")
	team.Targets = []RoutingTarget{{Model: bifrost.Ptr("team-target"), Weight: 1}}
	team.Priority = 100
	disabled := team
	disabled.ID, disabled.Priority, disabled.Enabled = "disabled", 0, bifrost.Ptr(false)
	request.Rules = []simulationRule{global, disabled, team}
	request.Samples[0].Scope.TeamID = "team-1"
	other := request.Samples[0]
	other.Name, other.Scope.TeamID = "other", "team-2"
	request.Samples = append(request.Samples, other)
	results := runSimulationFixture(t, request)
	require.Empty(t, results[0].Error)
	require.Equal(t, "team-rule", results[0].Decision.RuleID)
	require.Equal(t, "rule-1", results[1].Decision.RuleID)
}

func TestRoutingSimulationChainUsage(t *testing.T) {
	request := simulationFixture()
	request.Rules[0].CelExpression = `model == "input"`
	request.Rules[0].ChainRule = bifrost.Ptr(true)
	terminal := request.Rules[0]
	terminal.ID, terminal.Name, terminal.Priority = "rule-2", "terminal", 1
	terminal.ChainRule = bifrost.Ptr(false)
	terminal.CelExpression = `model == "target" && budget_used > 50.0`
	terminal.Targets = []RoutingTarget{{Model: bifrost.Ptr("final"), Weight: 1}}
	request.Rules = append(request.Rules, terminal)
	missing := runSimulationFixture(t, request)[0]
	require.False(t, missing.Matched)
	require.Nil(t, missing.Decision)
	require.Contains(t, missing.Error, "missing usage snapshot")
	request.Samples[0].Usage = append(request.Samples[0].Usage, simulationUsage{
		Provider: "openai", Model: "target", Status: &governance.BudgetAndRateLimitStatus{BudgetPercentUsed: 80},
	})
	decision := runSimulationFixture(t, request)[0]
	require.Empty(t, decision.Error)
	require.Equal(t, "final", decision.Decision.Model)
	request.ChainMaxDepth = 1
	truncated := runSimulationFixture(t, request)[0]
	require.False(t, truncated.Matched)
	require.Contains(t, truncated.Error, "incomplete")
	require.NotEmpty(t, truncated.Logs)
}

func TestRoutingSimulationCEL(t *testing.T) {
	for _, tc := range []struct {
		name, expression, tier string
		wantMatch              bool
		wantError              string
	}{
		{name: "false", expression: "false"},
		{name: "header normalization", expression: `headers["X-Tier"] == "gold"`, wantMatch: true},
		{name: "unknown complexity", expression: `complexity_tier != "SIMPLE"`},
		{name: "explicit complexity", expression: `complexity_tier == "COMPLEX"`, tier: "COMPLEX", wantMatch: true},
		{name: "non boolean", expression: "string(model)", wantError: "evaluation failed"},
		{name: "runtime type error", expression: `int(headers["X-Tier"]) > 0`, wantError: "evaluation failed"},
		{name: "cost exhausted", expression: `headers.all(k, headers.all(j, true))`, wantError: "evaluation failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := simulationFixture()
			request.Rules[0].CelExpression = tc.expression
			request.Samples[0].ComplexityTier = tc.tier
			request.Samples[0].Headers = map[string]string{"X-Tier": "gold"}
			if tc.name == "cost exhausted" {
				for i := range 100 {
					request.Samples[0].Headers[fmt.Sprintf("key-%d", i)] = "sample"
				}
			}
			decision := runSimulationFixture(t, request)[0]
			require.Equal(t, tc.wantMatch, decision.Matched)
			if tc.wantError == "" {
				require.Empty(t, decision.Error)
			} else {
				require.Contains(t, decision.Error, tc.wantError)
			}
		})
	}
}

func TestRoutingSimulationEmptyAndIsolatedRules(t *testing.T) {
	request := simulationFixture()
	require.True(t, runSimulationFixture(t, request)[0].Matched)
	request.Rules = []simulationRule{}
	request.Samples[0].Usage = nil
	decision := runSimulationFixture(t, request)[0]
	require.False(t, decision.Matched)
	require.Nil(t, decision.Decision)
	require.Empty(t, decision.Error)
}

func TestRoutingSimulationInvalidInput(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*routingSimulationRequest)
	}{
		{"null rules", func(r *routingSimulationRequest) { r.Rules = nil }},
		{"no samples", func(r *routingSimulationRequest) { r.Samples = nil }},
		{"too many samples", func(r *routingSimulationRequest) { r.Samples = make([]simulationSample, 17) }},
		{"too many rules", func(r *routingSimulationRequest) { r.Rules = make([]simulationRule, 33) }},
		{"zero depth", func(r *routingSimulationRequest) { r.ChainMaxDepth = 0 }},
		{"excess depth", func(r *routingSimulationRequest) { r.ChainMaxDepth = 21 }},
		{"invalid tier", func(r *routingSimulationRequest) { r.Samples[0].ComplexityTier = "REASONING" }},
		{"duplicate usage", func(r *routingSimulationRequest) {
			r.Samples[0].Usage = append(r.Samples[0].Usage, r.Samples[0].Usage[0])
		}},
		{"negative usage", func(r *routingSimulationRequest) {
			r.Samples[0].Usage[0].Status = &governance.BudgetAndRateLimitStatus{BudgetPercentUsed: -1}
		}},
		{"duplicate ID", func(r *routingSimulationRequest) { r.Rules = append(r.Rules, r.Rules[0]) }},
		{"duplicate priority", func(r *routingSimulationRequest) {
			copyRule := r.Rules[0]
			copyRule.ID = "another"
			r.Rules = append(r.Rules, copyRule)
		}},
		{"missing scope id", func(r *routingSimulationRequest) { r.Rules[0].Scope = "team" }},
		{"invalid scope", func(r *routingSimulationRequest) { r.Rules[0].Scope = "unknown" }},
		{"invalid weights", func(r *routingSimulationRequest) { r.Rules[0].Targets[0].Weight = 0 }},
		{"invalid TTFT", func(r *routingSimulationRequest) { r.Rules[0].Targets[0].TTFTTimeoutMs = bifrost.Ptr(-1) }},
		{"invalid CEL", func(r *routingSimulationRequest) { r.Rules[0].CelExpression = "model ==" }},
		{"long CEL", func(r *routingSimulationRequest) { r.Rules[0].CelExpression = strings.Repeat(" ", 4097) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := simulationFixture()
			tc.mutate(&request)
			body, err := json.Marshal(request)
			require.NoError(t, err)
			ctx := newTestRequestCtx(string(body))
			SimulateRouting(ctx)
			require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode(), string(ctx.Response.Body()))
		})
	}
	for _, body := range []string{`{`, `null`, `{}`, `{"unknown":true}`, `{} {}`} {
		ctx := newTestRequestCtx(body)
		SimulateRouting(ctx)
		require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode())
	}
	ctx := newTestRequestCtx(strings.Repeat(" ", maxRoutingSimulationBytes+1))
	SimulateRouting(ctx)
	require.Equal(t, fasthttp.StatusRequestEntityTooLarge, ctx.Response.StatusCode())
}
