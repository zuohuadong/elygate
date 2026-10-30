package rules

import (
	"context"
	"sync"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
)

// Boundaries: no rules, old rules replaced by none, pin before close, new request
// during close, inherited internal requests, copied realtime sessions and reopen.
func TestRoutingAdmissionPinsGenerationAcrossInstallation(t *testing.T) {
	store, err := NewLocalStore(t.Context(), NewMockLogger(), nil)
	require.NoError(t, err)
	original, err := store.PreparePolicy(t.Context(), policyTestChain("old"), 2)
	require.NoError(t, err)
	require.NoError(t, store.InstallPreparedPolicy(t.Context(), original))
	engine, err := NewEngine(store, NewMockGovernanceStore(), NewMockLogger(), new(10))
	require.NoError(t, err)
	request := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	defer request.Cancel()
	require.True(t, store.Admit(request, &schemas.BifrostRequest{RequestType: schemas.RealtimeRequest}))
	pinned := store.SnapshotForRequest(request)
	require.True(t, store.CloseAdmission())
	require.False(t, store.CloseAdmission())
	late := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	defer late.Cancel()
	require.False(t, store.Admit(late, nil))
	require.True(t, store.Admit(request, nil))
	require.ErrorIs(t, store.UpsertRule(t.Context(), snapshotTestRule("blocked")), ErrPolicyAdmissionClosed)
	require.ErrorIs(t, store.DeleteRule(t.Context(), "old-1"), ErrPolicyAdmissionClosed)
	require.ErrorIs(t, store.UpdateChainMaxDepth(3), ErrPolicyAdmissionClosed)
	next, err := store.PreparePolicy(t.Context(), nil, 3)
	require.NoError(t, err)
	require.NoError(t, store.InstallPreparedPolicy(t.Context(), next))
	require.NotSame(t, pinned, store.Snapshot())
	require.True(t, store.HasRules(request))
	require.False(t, store.HasRules(late))

	assertOld := func(ctx *schemas.BifrostContext) {
		t.Helper()
		require.True(t, store.Admit(ctx, nil))
		require.Same(t, pinned, store.SnapshotForRequest(ctx))
		decision, err := engine.EvaluateRoutingRules(ctx, &EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
		require.NoError(t, err)
		require.NotNil(t, decision)
		require.Equal(t, "old-step-2", decision.Model)
	}
	assertOld(request)
	child := schemas.NewBifrostContext(request, schemas.NoDeadline)
	defer child.Cancel()
	assertOld(child)
	session := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	defer session.Cancel()
	for key, value := range request.GetRealtimeTurnValues() {
		session.SetValue(key, value)
	}
	assertOld(session)
	store.ManagePolicy()
	store.OpenAdmission()
	require.True(t, store.Admit(late, nil))
	require.NotSame(t, pinned, store.SnapshotForRequest(late))
	require.NoError(t, store.UpdateChainMaxDepth(3), "same depth is not another generation")
	require.ErrorIs(t, store.UpdateChainMaxDepth(4), ErrPolicyManaged)
	require.ErrorIs(t, store.UpsertRule(t.Context(), snapshotTestRule("blocked")), ErrPolicyManaged)
	require.ErrorIs(t, store.DeleteRule(t.Context(), "old-1"), ErrPolicyManaged)
	other, err := NewLocalStore(t.Context(), NewMockLogger(), nil)
	require.NoError(t, err)
	other.CloseAdmission()
	require.False(t, other.Admit(request, nil), "a pin for another store is not an admission receipt")
}

func TestRoutingAdmissionConcurrentCloseAndInstall(t *testing.T) {
	store, err := NewLocalStore(t.Context(), NewMockLogger(), nil)
	require.NoError(t, err)
	require.False(t, store.Admit(nil, nil))
	var workers sync.WaitGroup
	for range 4 {
		workers.Go(func() {
			for range 100 {
				ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
				if store.Admit(ctx, nil) {
					view := store.SnapshotForRequest(ctx)
					if !store.Admit(ctx, nil) || view != store.SnapshotForRequest(ctx) {
						t.Error("an admitted request changed generation")
					}
				}
				ctx.Cancel()
			}
		})
	}
	for range 20 {
		store.CloseAdmission()
		prepared, err := store.PreparePolicy(t.Context(), nil, 2)
		require.NoError(t, err)
		require.NoError(t, store.InstallPreparedPolicy(t.Context(), prepared))
		store.OpenAdmission()
	}
	workers.Wait()
}
