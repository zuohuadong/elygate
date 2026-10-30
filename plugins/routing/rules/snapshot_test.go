package rules

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	tables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/stretchr/testify/require"
)

type pausedRuleEvaluation struct {
	status  *MockGovernanceStore
	entered chan struct{}
	resume  chan struct{}
	once    sync.Once
}

func (g *pausedRuleEvaluation) GetBudgetAndRateLimitStatus(_ *schemas.BifrostContext, _ schemas.ModelProvider, _ string, _ map[string]float64, _ map[string]int64, _ map[string]int64) *governance.BudgetAndRateLimitStatus {
	g.once.Do(func() {
		close(g.entered)
		<-g.resume
	})
	return g.status.Status
}

func snapshotTestRule(id string) *tables.TableRoutingRule {
	return &tables.TableRoutingRule{
		ID: id, Name: id, Scope: "global", Enabled: bifrost.Ptr(true),
		CelExpression: `model == "incoming"`,
		Targets:       []tables.TableRoutingTarget{{Model: bifrost.Ptr("original"), Weight: 1}},
	}
}

func TestRoutingEvaluationKeepsRuleAndProgramGeneration(t *testing.T) {
	store, err := NewLocalStore(context.Background(), NewMockLogger(), nil)
	require.NoError(t, err)
	rule := snapshotTestRule("same-id")
	require.NoError(t, store.UpsertRule(context.Background(), rule))
	paused := &pausedRuleEvaluation{status: NewMockGovernanceStore(), entered: make(chan struct{}), resume: make(chan struct{})}
	var release sync.Once
	t.Cleanup(func() { release.Do(func() { close(paused.resume) }) })
	depth := 10
	engine, err := NewEngine(store, paused, NewMockLogger(), &depth)
	require.NoError(t, err)
	type evaluation struct {
		decision *Decision
		err      error
	}
	finished := make(chan evaluation, 1)
	go func() {
		ctx, cancel := schemas.NewBifrostContextWithCancel(context.Background())
		defer cancel()
		decision, err := engine.EvaluateRoutingRules(ctx, &EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
		finished <- evaluation{decision, err}
	}()
	select {
	case <-paused.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("routing evaluation did not reach the program lookup boundary")
	}
	// The in-flight evaluation already collected the old targets. Replacing its
	// program by ID must not make it evaluate those targets against new CEL.
	replacement := snapshotTestRule("same-id")
	replacement.CelExpression = "false"
	replacement.Targets[0].Model = bifrost.Ptr("replacement")
	err = store.UpsertRule(context.Background(), replacement)
	release.Do(func() { close(paused.resume) })
	require.NoError(t, err)
	var evaluated evaluation
	select {
	case evaluated = <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("routing evaluation did not finish after the update")
	}
	require.NoError(t, evaluated.err)
	require.NotNil(t, evaluated.decision)
	require.Equal(t, "original", evaluated.decision.Model)
	ctx, cancel := schemas.NewBifrostContextWithCancel(context.Background())
	defer cancel()
	decision, err := engine.EvaluateRoutingRules(ctx, &EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
	require.NoError(t, err)
	require.Nil(t, decision)
}

func BenchmarkRoutingRuleSnapshots(b *testing.B) {
	ctx := context.Background()
	logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	b.Run("empty", func(b *testing.B) {
		store, err := NewLocalStore(ctx, logger, nil)
		require.NoError(b, err)
		b.ReportAllocs()
		b.ResetTimer()
		for b.Loop() {
			if store.HasRules(ctx) {
				b.Fatal("empty store contains a rule")
			}
		}
	})
	store, err := NewLocalStore(ctx, logger, nil)
	require.NoError(b, err)
	require.NoError(b, store.UpsertRule(ctx, snapshotTestRule("benchmark")))
	b.Run("program", func(b *testing.B) {
		rule := snapshotTestRule("benchmark")
		b.ReportAllocs()
		for b.Loop() {
			program, err := store.GetProgram(ctx, rule)
			if err != nil || program == nil {
				b.Fatalf("missing program: %v", err)
			}
		}
	})
	b.Run("scope", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			if len(store.GetScopedRules(ctx, "global", "")) != 1 {
				b.Fatal("missing rule")
			}
		}
	})
	for _, model := range []string{"incoming", "unmatched"} {
		b.Run("evaluate-"+model, func(b *testing.B) {
			depth := 10
			engine, err := NewEngine(store, NewMockGovernanceStore(), logger, &depth)
			require.NoError(b, err)
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				requestCtx, cancel := schemas.NewBifrostContextWithCancel(ctx)
				decision, err := engine.EvaluateRoutingRules(requestCtx, &EvaluationContext{Provider: schemas.OpenAI, Model: model})
				cancel()
				if err != nil || (model == "incoming" && (decision == nil || decision.Model != "original")) || (model == "unmatched" && decision != nil) {
					b.Fatalf("unexpected evaluation: %v, %v", decision, err)
				}
			}
		})
	}
	b.Run("chain-three", benchmarkRoutingThreeStepChain)
}

func benchmarkRoutingThreeStepChain(b *testing.B) {
	ctx := context.Background()
	logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	store, err := NewLocalStore(ctx, logger, nil)
	require.NoError(b, err)
	previous := "incoming"
	for index := range 3 {
		rule := snapshotTestRule(fmt.Sprintf("chain-%d", index))
		rule.Priority, rule.ChainRule = index, index < 2
		rule.CelExpression = fmt.Sprintf("model == %q", previous)
		previous = fmt.Sprintf("step-%d", index+1)
		rule.Targets[0].Model = bifrost.Ptr(previous)
		require.NoError(b, store.UpsertRule(ctx, rule))
	}
	depth := 10
	engine, err := NewEngine(store, NewMockGovernanceStore(), logger, &depth)
	require.NoError(b, err)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		requestCtx, cancel := schemas.NewBifrostContextWithCancel(ctx)
		decision, err := engine.EvaluateRoutingRules(requestCtx, &EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
		cancel()
		if err != nil || decision == nil || decision.Model != "step-3" {
			b.Fatalf("unexpected chain decision: %v, %v", decision, err)
		}
	}
}
