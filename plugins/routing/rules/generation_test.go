package rules

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	tables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func TestRuleGenerationOwnsInput(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	rule := snapshotTestRule("owned")
	rule.Scope = "team"
	rule.ScopeID = bifrost.Ptr("original-team")
	rule.Targets[0].Provider = bifrost.Ptr("openai")
	rule.Targets[0].KeyID = bifrost.Ptr("original-key")
	rule.Targets[0].ProviderKeyName = bifrost.Ptr("original-alias")
	rule.Targets[0].RuleID = rule.ID
	rule.Targets[0].Position = bifrost.Ptr(0)
	rule.Targets[0].TTFTTimeoutMs = bifrost.Ptr(200)
	rule.ParsedFallbacks = []tables.RoutingFallback{{
		Fallback:        schemas.Fallback{Provider: schemas.OpenAI, Model: "fallback"},
		ProviderKeyName: bifrost.Ptr("fallback-alias"),
	}}
	rule.ParsedQuery = map[string]any{"nested": []any{map[string]any{"key": "original"}}}
	rule.Query = bifrost.Ptr("original-query-column")
	rule.Fallbacks = bifrost.Ptr("original-fallback-column")
	require.NoError(t, store.UpsertRule(ctx, rule))
	pinned := store.Snapshot()
	*rule.Enabled = false
	*rule.ScopeID = "changed-team"
	*rule.Targets[0].Model = "changed-model"
	*rule.Targets[0].Provider = "anthropic"
	*rule.Targets[0].KeyID = "changed-key"
	*rule.Targets[0].ProviderKeyName = "changed-alias"
	*rule.Targets[0].Position = 9
	*rule.Targets[0].TTFTTimeoutMs = 900
	rule.Targets[0].RuleID = "changed-id"
	*rule.ParsedFallbacks[0].ProviderKeyName = "changed-fallback-alias"
	rule.ParsedFallbacks[0].Model = "changed-fallback"
	rule.ParsedQuery["nested"].([]any)[0].(map[string]any)["key"] = "changed"
	*rule.Query, *rule.Fallbacks = "changed", "changed"
	rule.CelExpression = "false"
	owned := pinned.GetScopedRules(ctx, "team", "original-team")
	require.Len(t, owned, 1)
	require.Equal(t, "original", *owned[0].Targets[0].Model)
	require.Equal(t, "openai", *owned[0].Targets[0].Provider)
	require.Equal(t, "original-key", *owned[0].Targets[0].KeyID)
	require.Equal(t, "original-alias", *owned[0].Targets[0].ProviderKeyName)
	require.Equal(t, 0, *owned[0].Targets[0].Position)
	require.Equal(t, 200, *owned[0].Targets[0].TTFTTimeoutMs)
	require.Equal(t, "owned", owned[0].Targets[0].RuleID)
	require.Equal(t, "fallback-alias", *owned[0].ParsedFallbacks[0].ProviderKeyName)
	require.Equal(t, "fallback", owned[0].ParsedFallbacks[0].Model)
	require.Equal(t, "original", owned[0].ParsedQuery["nested"].([]any)[0].(map[string]any)["key"])
	require.Equal(t, "original-query-column", *owned[0].Query)
	require.Equal(t, "original-fallback-column", *owned[0].Fallbacks)
	program, err := pinned.GetProgram(ctx, owned[0])
	require.NoError(t, err)
	matches, _, err := program.Eval(map[string]any{"model": "incoming"})
	require.NoError(t, err)
	require.Equal(t, true, matches.Value())
}

func TestRuleGenerationScopeMoveDeleteAndRecreate(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	rule := snapshotTestRule("reused")
	require.NoError(t, store.UpsertRule(ctx, rule))
	old := store.Snapshot()
	rule.Scope, rule.ScopeID = "team", bifrost.Ptr("team")
	rule.CelExpression = "false"
	require.NoError(t, store.UpsertRule(ctx, rule))
	moved := store.Snapshot()
	require.Len(t, old.GetScopedRules(ctx, "global", ""), 1)
	require.Empty(t, old.GetScopedRules(ctx, "team", "team"))
	require.Empty(t, moved.GetScopedRules(ctx, "global", ""))
	require.Len(t, moved.GetScopedRules(ctx, "team", "team"), 1)
	require.NoError(t, store.DeleteRule(ctx, rule.ID))
	require.False(t, store.HasRules(ctx))
	require.Empty(t, store.GetAllRules(ctx))
	require.Len(t, moved.GetScopedRules(ctx, "team", "team"), 1)
	recreated := snapshotTestRule("reused")
	recreated.CelExpression = "false"
	require.NoError(t, store.UpsertRule(ctx, recreated))
	// A stale direct compiler call cannot poison the current generation.
	oldRule := old.GetScopedRules(ctx, "global", "")[0]
	_, err = store.GetProgram(ctx, oldRule)
	require.NoError(t, err)
	currentRule := store.GetScopedRules(ctx, "global", "")[0]
	program, err := store.GetProgram(ctx, currentRule)
	require.NoError(t, err)
	matches, _, err := program.Eval(map[string]any{"model": "incoming"})
	require.NoError(t, err)
	require.Equal(t, false, matches.Value())
}

func TestRuleGenerationCachesCompilationFailures(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	broken := snapshotTestRule("broken")
	broken.CelExpression = "model =="
	require.NoError(t, store.UpsertRule(ctx, broken))
	pinned := store.Snapshot()
	brokenRule := pinned.GetScopedRules(ctx, "global", "")[0]
	_, firstErr := pinned.GetProgram(ctx, brokenRule)
	require.Error(t, firstErr)
	require.NoError(t, store.UpsertRule(ctx, snapshotTestRule("good")))
	current := store.Snapshot()
	_, secondErr := current.GetProgram(ctx, brokenRule)
	require.Same(t, firstErr, secondErr)
	// The request view has no dependency on the compiler after publication,
	// including negative entries.
	store.celEnv = nil
	_, err = pinned.GetProgram(ctx, brokenRule)
	require.Same(t, firstErr, err)
	program, err := current.GetProgram(ctx, snapshotTestRule("good"))
	require.NoError(t, err)
	require.NotNil(t, program)
}

func TestRuleGenerationRejectsUncopyableQueryWithoutPublishing(t *testing.T) {
	store, err := NewLocalStore(context.Background(), NewMockLogger(), nil)
	require.NoError(t, err)
	original := store.Snapshot()
	rule := snapshotTestRule("invalid-query")
	rule.ParsedQuery = map[string]any{"unsupported": func() {}}
	require.ErrorContains(t, store.UpsertRule(context.Background(), rule), "failed to copy routing rule")
	require.Same(t, original, store.Snapshot())
	require.False(t, store.HasRules(context.Background()))
}

func TestRuleGenerationPreservesDisabledPresence(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	rule := snapshotTestRule("disabled")
	rule.Enabled = bifrost.Ptr(false)
	require.NoError(t, store.UpsertRule(ctx, rule))
	require.True(t, store.HasRules(ctx))
	require.Len(t, store.GetAllRules(ctx), 1)
	require.Empty(t, store.Snapshot().GetScopedRules(ctx, "global", ""))
	require.NoError(t, store.DeleteRule(ctx, "absent"))
	require.True(t, store.HasRules(ctx))
}

func TestRuleGenerationConcurrentWritersAndReaders(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	const writers = 32
	start, stop := make(chan struct{}), make(chan struct{})
	failures := make(chan error, writers+1)
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		for {
			select {
			case <-stop:
				return
			default:
			}
			view := store.Snapshot()
			for _, rule := range view.GetScopedRules(ctx, "global", "") {
				if _, err := view.GetProgram(ctx, rule); err != nil {
					failures <- err
					return
				}
			}
		}
	}()
	var workers sync.WaitGroup
	for index := range writers {
		workers.Go(func() {
			<-start
			rule := snapshotTestRule(fmt.Sprintf("concurrent-%d", index))
			rule.Priority = index
			if err := store.UpsertRule(ctx, rule); err != nil {
				failures <- err
			}
		})
	}
	close(start)
	workers.Wait()
	close(stop)
	<-readerDone
	close(failures)
	for err := range failures {
		require.NoError(t, err)
	}
	require.Len(t, store.GetAllRules(ctx), writers)
	require.Len(t, store.GetScopedRules(ctx, "global", ""), writers)
	for index, rule := range store.GetScopedRules(ctx, "global", "") {
		require.Equal(t, index, rule.Priority)
	}
}

// An external store implementing only the original interface remains supported.
type legacyRuleStore struct{ Store }

func TestRuleGenerationLegacyStoreContract(t *testing.T) {
	store, err := NewLocalStore(context.Background(), NewMockLogger(), nil)
	require.NoError(t, err)
	require.NoError(t, store.UpsertRule(context.Background(), snapshotTestRule("legacy")))
	depth := 10
	engine, err := NewEngine(legacyRuleStore{store}, NewMockGovernanceStore(), NewMockLogger(), &depth)
	require.NoError(t, err)
	ctx, cancel := schemas.NewBifrostContextWithCancel(context.Background())
	defer cancel()
	decision, err := engine.EvaluateRoutingRules(ctx, &EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
	require.NoError(t, err)
	require.NotNil(t, decision)
	require.Equal(t, "original", decision.Model)
}

func TestRuleGenerationDirectCompilationMatchesExpression(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	rule := snapshotTestRule("ad-hoc")
	for _, expression := range []string{"true", "false", "true"} {
		rule.CelExpression = expression
		program, err := store.GetProgram(ctx, rule)
		require.NoError(t, err)
		matches, _, err := program.Eval(map[string]any{})
		require.NoError(t, err)
		require.Equal(t, expression == "true", matches.Value())
	}
	require.False(t, store.HasRules(ctx))
}

type pausedScopeStore struct {
	Store
	entered   chan struct{}
	resume    chan struct{}
	once      sync.Once
	snapshots atomic.Int32
}

func (s *pausedScopeStore) pause() {
	s.once.Do(func() {
		close(s.entered)
		<-s.resume
	})
}

func (s *pausedScopeStore) GetScopedRules(ctx context.Context, scope, scopeID string) []*tables.TableRoutingRule {
	rules := s.Store.GetScopedRules(ctx, scope, scopeID)
	s.pause()
	return rules
}

func (s *pausedScopeStore) Snapshot() ReadStore {
	s.snapshots.Add(1)
	return pausedScopeView{s.Store.(Snapshotter).Snapshot(), s}
}

type pausedScopeView struct {
	ReadStore
	pause *pausedScopeStore
}

func (view pausedScopeView) GetScopedRules(ctx context.Context, scope, scopeID string) []*tables.TableRoutingRule {
	rules := view.ReadStore.GetScopedRules(ctx, scope, scopeID)
	view.pause.pause()
	return rules
}

func TestRoutingEvaluationPinsOneGenerationAcrossScopes(t *testing.T) {
	base, err := NewLocalStore(context.Background(), NewMockLogger(), nil)
	require.NoError(t, err)
	rule := snapshotTestRule("moved")
	rule.Scope, rule.ScopeID, rule.CelExpression = "virtual_key", bifrost.Ptr("key"), "false"
	require.NoError(t, base.UpsertRule(context.Background(), rule))
	store := &pausedScopeStore{Store: base, entered: make(chan struct{}), resume: make(chan struct{})}
	var release sync.Once
	t.Cleanup(func() { release.Do(func() { close(store.resume) }) })
	depth := 10
	engine, err := NewEngine(store, NewMockGovernanceStore(), NewMockLogger(), &depth)
	require.NoError(t, err)
	type evaluation struct {
		decision *Decision
		err      error
	}
	finished := make(chan evaluation, 1)
	go func() {
		ctx, cancel := schemas.NewBifrostContextWithCancel(context.Background())
		defer cancel()
		decision, err := engine.EvaluateRoutingRules(ctx, &EvaluationContext{
			Provider: schemas.OpenAI, Model: "incoming", Scope: GovernanceScope{VirtualKeyID: "key"},
		})
		finished <- evaluation{decision, err}
	}()
	select {
	case <-store.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("routing evaluation did not reach the scope boundary")
	}
	rule.Scope, rule.ScopeID, rule.CelExpression = "global", nil, "true"
	require.NoError(t, base.UpsertRule(context.Background(), rule))
	release.Do(func() { close(store.resume) })
	select {
	case evaluated := <-finished:
		require.NoError(t, evaluated.err)
		require.Nil(t, evaluated.decision)
	case <-time.After(5 * time.Second):
		t.Fatal("routing evaluation did not resume")
	}
	require.Equal(t, int32(1), store.snapshots.Load())
	ctx, cancel := schemas.NewBifrostContextWithCancel(context.Background())
	defer cancel()
	decision, err := engine.EvaluateRoutingRules(ctx, &EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
	require.NoError(t, err)
	require.NotNil(t, decision)
	require.Equal(t, int32(2), store.snapshots.Load())
}

func TestRuleGenerationConcurrentScopeMoves(t *testing.T) {
	ctx := context.Background()
	store, err := NewLocalStore(ctx, NewMockLogger(), nil)
	require.NoError(t, err)
	rule := snapshotTestRule("moving")
	rule.CelExpression, rule.Targets[0].Model = `model == "global"`, bifrost.Ptr("global")
	require.NoError(t, store.UpsertRule(ctx, rule))
	stop, readerDone := make(chan struct{}), make(chan struct{})
	failures := make(chan error, 1)
	go func() {
		defer close(readerDone)
		for {
			select {
			case <-stop:
				return
			default:
			}
			view := store.Snapshot()
			rules := append([]*tables.TableRoutingRule{}, view.GetScopedRules(ctx, "global", "")...)
			rules = append(rules, view.GetScopedRules(ctx, "team", "team")...)
			if len(rules) != 1 {
				failures <- fmt.Errorf("one generation has %d copies of the moved rule", len(rules))
				return
			}
			program, err := view.GetProgram(ctx, rules[0])
			if err != nil {
				failures <- err
				return
			}
			matches, _, err := program.Eval(map[string]any{"model": *rules[0].Targets[0].Model})
			if err != nil || matches.Value() != true {
				failures <- fmt.Errorf("mixed target/program generation: %v", err)
				return
			}
		}
	}()
	for index := range 100 {
		scope := "global"
		rule.ScopeID = nil
		if index%2 == 0 {
			scope, rule.ScopeID = "team", bifrost.Ptr("team")
		}
		rule.Scope = scope
		rule.CelExpression = fmt.Sprintf("model == %q", scope)
		rule.Targets[0].Model = bifrost.Ptr(scope)
		if err := store.UpsertRule(ctx, rule); err != nil {
			close(stop)
			<-readerDone
			t.Fatal(err)
		}
	}
	close(stop)
	<-readerDone
	close(failures)
	for err := range failures {
		require.NoError(t, err)
	}
}
