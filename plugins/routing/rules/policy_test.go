package rules

import (
	"context"
	"errors"
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

func policyTestChain(prefix string) []*tables.TableRoutingRule {
	chain := make([]*tables.TableRoutingRule, 0, 3)
	previous := "incoming"
	for index := range 3 {
		rule := snapshotTestRule(fmt.Sprintf("%s-%d", prefix, index+1))
		rule.Priority, rule.ChainRule = index, true
		rule.CelExpression = fmt.Sprintf("model == %q", previous)
		previous = fmt.Sprintf("%s-step-%d", prefix, index+1)
		rule.Targets[0].Model = bifrost.Ptr(previous)
		chain = append(chain, rule)
	}
	return chain
}

func evaluatePolicyModel(t *testing.T, engine *Engine) string {
	t.Helper()
	ctx, cancel := schemas.NewBifrostContextWithCancel(context.Background())
	defer cancel()
	decision, err := engine.EvaluateRoutingRules(ctx, &EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
	require.NoError(t, err)
	require.NotNil(t, decision)
	return decision.Model
}

func TestRoutingPolicyPrepareAndInstallCompleteGeneration(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	require.NoError(t, store.UpsertRule(ctx, snapshotTestRule("old")))
	require.NoError(t, store.UpdateChainMaxDepth(2))
	old := store.Snapshot()
	_, err = store.GetProgram(ctx, snapshotTestRule("ad-hoc"))
	require.NoError(t, err)

	input := policyTestChain("new")
	prepared, err := store.PreparePolicy(ctx, input, 3)
	require.NoError(t, err)
	require.Same(t, old, store.Snapshot(), "preparing must not publish")
	*input[0].Targets[0].Model = "caller-mutation"
	input[0].CelExpression = "false"
	input[1] = nil
	input = append(input, snapshotTestRule("not-prepared"))

	require.NoError(t, store.InstallPreparedPolicy(ctx, prepared))
	current := store.current.Load()
	require.Equal(t, 3, current.ChainMaxDepth())
	require.Len(t, current.allRules, 3)
	require.Len(t, old.GetScopedRules(ctx, "global", ""), 1)
	require.Equal(t, "old", old.GetScopedRules(ctx, "global", "")[0].ID)
	_, retained := store.adHoc.Load("ad-hoc")
	require.False(t, retained)
	engine, err := NewEngine(store, NewMockGovernanceStore(), NewMockLogger(), bifrost.Ptr(1))
	require.NoError(t, err)
	require.Equal(t, "new-step-3", evaluatePolicyModel(t, engine))
	require.ErrorIs(t, store.InstallPreparedPolicy(ctx, prepared), ErrPolicyConflict)
	require.Same(t, current, store.current.Load())

	empty, err := store.PreparePolicy(ctx, nil, 1)
	require.NoError(t, err)
	require.NoError(t, store.InstallPreparedPolicy(ctx, empty))
	require.False(t, store.HasRules(ctx))
	require.Empty(t, store.GetAllRules(ctx))
	require.Equal(t, 1, store.current.Load().ChainMaxDepth())
	require.Len(t, current.GetScopedRules(ctx, "global", ""), 3, "old readers retain complete policy")
}

func TestRoutingPolicyPreparationFailureDoesNotPublish(t *testing.T) {
	// Cases: non-positive depth, nil rule, duplicate ID, uncopyable query, cancellation.
	broken := snapshotTestRule("uncopyable")
	broken.ParsedQuery = map[string]any{"unsupported": func() {}}
	for _, tc := range []struct {
		name  string
		rules []*tables.TableRoutingRule
		depth int
	}{
		{"zero depth", nil, 0},
		{"negative depth", nil, -1},
		{"nil rule", []*tables.TableRoutingRule{nil}, 1},
		{"duplicate ID", []*tables.TableRoutingRule{snapshotTestRule("same"), snapshotTestRule("same")}, 1},
		{"uncopyable query", []*tables.TableRoutingRule{broken}, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store, err := NewLocalStore(t.Context(), NewMockLogger(), nil)
			require.NoError(t, err)
			before := store.Snapshot()
			prepared, err := store.PreparePolicy(t.Context(), tc.rules, tc.depth)
			require.Error(t, err)
			require.Nil(t, prepared)
			require.Same(t, before, store.Snapshot())
		})
	}
	store, err := NewLocalStore(t.Context(), NewMockLogger(), nil)
	require.NoError(t, err)
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	for _, input := range [][]*tables.TableRoutingRule{nil, policyTestChain("cancel")} {
		prepared, err := store.PreparePolicy(canceled, input, 1)
		require.ErrorIs(t, err, context.Canceled)
		require.Nil(t, prepared)
	}
	require.False(t, store.HasRules(t.Context()))
}

func TestRoutingPolicyInstallationGuards(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	other, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	prepared, err := store.PreparePolicy(ctx, policyTestChain("owned"), 2)
	require.NoError(t, err)
	before, otherBefore := store.Snapshot(), other.Snapshot()
	require.Error(t, store.InstallPreparedPolicy(ctx, nil))
	require.Error(t, store.InstallPreparedPolicy(ctx, &PreparedPolicy{}))
	require.Error(t, other.InstallPreparedPolicy(ctx, prepared))
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	require.ErrorIs(t, store.InstallPreparedPolicy(canceled, prepared), context.Canceled)
	require.Same(t, before, store.Snapshot())
	require.Same(t, otherBefore, other.Snapshot())
	require.NoError(t, store.InstallPreparedPolicy(ctx, prepared), "rejection does not consume a valid candidate")
}

func TestRoutingPolicyInstallationRejectsConcurrentEdits(t *testing.T) {
	for _, edit := range []struct {
		name string
		run  func(*LocalStore) error
	}{
		{"upsert", func(store *LocalStore) error { return store.UpsertRule(t.Context(), snapshotTestRule("concurrent")) }},
		{"delete", func(store *LocalStore) error { return store.DeleteRule(t.Context(), "original") }},
		{"depth", func(store *LocalStore) error { return store.UpdateChainMaxDepth(4) }},
	} {
		t.Run(edit.name, func(t *testing.T) {
			store, err := NewLocalStore(t.Context(), NewMockLogger(), nil)
			require.NoError(t, err)
			require.NoError(t, store.UpsertRule(t.Context(), snapshotTestRule("original")))
			prepared, err := store.PreparePolicy(t.Context(), policyTestChain("stale"), 3)
			require.NoError(t, err)
			require.NoError(t, edit.run(store))
			edited := store.Snapshot()
			require.ErrorIs(t, store.InstallPreparedPolicy(t.Context(), prepared), ErrPolicyConflict)
			require.Same(t, edited, store.Snapshot(), "CAS failure must preserve the winning edit")
		})
	}
}

func TestRoutingPolicyConcurrentInstallHasOneWinner(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	first, err := store.PreparePolicy(ctx, policyTestChain("first"), 2)
	require.NoError(t, err)
	second, err := store.PreparePolicy(ctx, policyTestChain("second"), 3)
	require.NoError(t, err)
	start := make(chan struct{})
	installed := make(chan error, 2)
	var workers sync.WaitGroup
	for _, candidate := range []*PreparedPolicy{first, second} {
		workers.Go(func() {
			<-start
			installed <- store.InstallPreparedPolicy(ctx, candidate)
		})
	}
	close(start)
	workers.Wait()
	close(installed)
	winners := 0
	for err := range installed {
		if err == nil {
			winners++
		} else {
			require.ErrorIs(t, err, ErrPolicyConflict)
		}
	}
	require.Equal(t, 1, winners)
	current := store.current.Load()
	require.True(t, current == first.next || current == second.next)
}

func TestRoutingPolicyDepthUpdatesShareImmutableRulesAndSurviveCRUD(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	prepared, err := store.PreparePolicy(ctx, policyTestChain("depth"), 2)
	require.NoError(t, err)
	require.NoError(t, store.InstallPreparedPolicy(ctx, prepared))
	old := store.current.Load()
	require.NoError(t, store.UpdateChainMaxDepth(3))
	current := store.current.Load()
	require.NotSame(t, old, current)
	require.Equal(t, 2, old.ChainMaxDepth())
	require.Equal(t, 3, current.ChainMaxDepth())
	require.Same(t, &old.allRules[0], &current.allRules[0], "depth-only changes do not copy the rule slice")
	for _, rule := range old.allRules {
		require.Same(t, old.programs[rule.ID].program, current.programs[rule.ID].program)
	}
	require.NoError(t, store.UpdateChainMaxDepth(3))
	require.Same(t, current, store.current.Load(), "a no-op reload need not invalidate prepared candidates")
	for _, depth := range []int{0, -1} {
		require.Error(t, store.UpdateChainMaxDepth(depth))
		require.Same(t, current, store.current.Load())
	}
	require.NoError(t, store.UpsertRule(ctx, snapshotTestRule("unrelated")))
	require.NoError(t, store.DeleteRule(ctx, "unrelated"))
	require.Equal(t, 3, store.current.Load().ChainMaxDepth())
}

func TestRoutingPolicyInvalidCELRetainsUpstreamSkipBehavior(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	invalid := snapshotTestRule("invalid")
	invalid.CelExpression = "model =="
	valid := snapshotTestRule("valid")
	valid.Priority = 1
	prepared, err := store.PreparePolicy(ctx, []*tables.TableRoutingRule{invalid, valid}, 2)
	require.NoError(t, err)
	require.NoError(t, store.InstallPreparedPolicy(ctx, prepared))
	_, compileErr := store.Snapshot().GetProgram(ctx, invalid)
	require.Error(t, compileErr)
	engine, err := NewEngine(store, NewMockGovernanceStore(), NewMockLogger(), bifrost.Ptr(10))
	require.NoError(t, err)
	require.Equal(t, "original", evaluatePolicyModel(t, engine))
}

func (view pausedScopeView) ChainMaxDepth() int {
	if policy, ok := view.ReadStore.(interface{ ChainMaxDepth() int }); ok {
		return policy.ChainMaxDepth()
	}
	return 0
}

func TestRoutingEvaluationPinsCompletePolicyAcrossInstall(t *testing.T) {
	ctx := context.Background()
	base, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	original, err := base.PreparePolicy(ctx, policyTestChain("old"), 2)
	require.NoError(t, err)
	require.NoError(t, base.InstallPreparedPolicy(ctx, original))
	store := &pausedScopeStore{Store: base, entered: make(chan struct{}), resume: make(chan struct{})}
	var release sync.Once
	t.Cleanup(func() { release.Do(func() { close(store.resume) }) })
	depth := 10
	engine, err := NewEngine(store, NewMockGovernanceStore(), NewMockLogger(), &depth)
	require.NoError(t, err)
	finished := make(chan struct {
		decision *Decision
		err      error
	}, 1)
	go func() {
		request, cancel := schemas.NewBifrostContextWithCancel(ctx)
		defer cancel()
		decision, err := engine.EvaluateRoutingRules(request, &EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
		finished <- struct {
			decision *Decision
			err      error
		}{decision, err}
	}()
	select {
	case <-store.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("evaluation did not reach the snapshot boundary")
	}
	next, err := base.PreparePolicy(ctx, policyTestChain("new"), 3)
	require.NoError(t, err)
	require.NoError(t, base.InstallPreparedPolicy(ctx, next))
	depth = 1 // managed evaluations must not read the former live pointer
	release.Do(func() { close(store.resume) })
	select {
	case completed := <-finished:
		require.NoError(t, completed.err)
		require.NotNil(t, completed.decision)
		require.Equal(t, "old-step-2", completed.decision.Model)
	case <-time.After(5 * time.Second):
		t.Fatal("evaluation did not finish after the policy swap")
	}
	require.Equal(t, "new-step-3", evaluatePolicyModel(t, engine))
	require.EqualValues(t, 2, store.snapshots.Load())
}

func TestRoutingPolicySDKDepthRemainsUnmanagedBetweenEvaluations(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	for _, rule := range policyTestChain("sdk") {
		require.NoError(t, store.UpsertRule(ctx, rule))
	}
	firstDepth, secondDepth := 2, 3
	first, err := NewEngine(store, NewMockGovernanceStore(), NewMockLogger(), &firstDepth)
	require.NoError(t, err)
	second, err := NewEngine(store, NewMockGovernanceStore(), NewMockLogger(), &secondDepth)
	require.NoError(t, err)
	require.Zero(t, store.current.Load().ChainMaxDepth(), "constructing an Engine must not mutate its store")
	require.Equal(t, "sdk-step-2", evaluatePolicyModel(t, first))
	require.Equal(t, "sdk-step-3", evaluatePolicyModel(t, second))
	firstDepth = 1
	require.Equal(t, "sdk-step-1", evaluatePolicyModel(t, first))
	require.Equal(t, "sdk-step-3", evaluatePolicyModel(t, second))

	custom, err := NewEngine(legacyRuleStore{store}, NewMockGovernanceStore(), NewMockLogger(), &firstDepth)
	require.NoError(t, err)
	require.NoError(t, store.UpdateChainMaxDepth(3))
	require.Equal(t, "sdk-step-1", evaluatePolicyModel(t, custom), "a custom Store need not implement the new optional methods")
}

type depthChangingGovernance struct {
	*MockGovernanceStore
	depth *int
}

func (g depthChangingGovernance) GetBudgetAndRateLimitStatus(ctx *schemas.BifrostContext, provider schemas.ModelProvider, model string, budgets map[string]float64, tokens, requests map[string]int64) *governance.BudgetAndRateLimitStatus {
	*g.depth = 1
	return g.MockGovernanceStore.GetBudgetAndRateLimitStatus(ctx, provider, model, budgets, tokens, requests)
}

func TestRoutingPolicySDKPinsDepthForOneEvaluation(t *testing.T) {
	store, err := NewLocalStore(t.Context(), NewMockLogger(), nil)
	require.NoError(t, err)
	for _, rule := range policyTestChain("sdk") {
		require.NoError(t, store.UpsertRule(t.Context(), rule))
	}
	depth := 2
	engine, err := NewEngine(store, depthChangingGovernance{NewMockGovernanceStore(), &depth}, NewMockLogger(), &depth)
	require.NoError(t, err)
	require.Equal(t, "sdk-step-2", evaluatePolicyModel(t, engine), "in-chain mutation applies only to the next evaluation")
	require.Equal(t, "sdk-step-1", evaluatePolicyModel(t, engine))
}

func TestRoutingPolicyConcurrentPreparationInstallationAndCRUD(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	start := make(chan struct{})
	failures := make(chan error, 4)
	var workers sync.WaitGroup
	for worker := range 4 {
		workers.Go(func() {
			<-start
			for index := range 20 {
				chain := policyTestChain(fmt.Sprintf("worker-%d-%d", worker, index))
				policy, err := store.PreparePolicy(ctx, chain, index%3+1)
				if err != nil {
					failures <- err
					return
				}
				if err := store.InstallPreparedPolicy(ctx, policy); err != nil && !errors.Is(err, ErrPolicyConflict) {
					failures <- err
					return
				}
				rule := snapshotTestRule(fmt.Sprintf("crud-%d", worker))
				if err := store.UpsertRule(ctx, rule); err != nil {
					failures <- err
					return
				}
				view := store.Snapshot()
				for _, scoped := range view.GetScopedRules(ctx, "global", "") {
					if _, err := view.GetProgram(ctx, scoped); err != nil {
						failures <- err
						return
					}
				}
				if err := store.DeleteRule(ctx, rule.ID); err != nil {
					failures <- err
					return
				}
			}
		})
	}
	close(start)
	workers.Wait()
	close(failures)
	for err := range failures {
		require.NoError(t, err)
	}
}

func BenchmarkRoutingManagedPolicy(b *testing.B) {
	ctx := context.Background()
	logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	store, err := NewLocalStore(ctx, logger, nil)
	require.NoError(b, err)
	require.NoError(b, store.UpsertRule(ctx, snapshotTestRule("benchmark")))
	require.NoError(b, store.UpdateChainMaxDepth(10))
	for _, model := range []string{"incoming", "unmatched"} {
		b.Run("evaluate-"+model, func(b *testing.B) {
			depth := 1
			engine, err := NewEngine(store, NewMockGovernanceStore(), logger, &depth)
			require.NoError(b, err)
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				request, cancel := schemas.NewBifrostContextWithCancel(ctx)
				decision, err := engine.EvaluateRoutingRules(request, &EvaluationContext{Provider: schemas.OpenAI, Model: model})
				cancel()
				if err != nil || (model == "incoming" && (decision == nil || decision.Model != "original")) || (model == "unmatched" && decision != nil) {
					b.Fatalf("unexpected evaluation: %v, %v", decision, err)
				}
			}
		})
	}
}
