package routing

import (
	"context"
	"errors"
	"testing"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	tables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/routing/rules"
	"github.com/stretchr/testify/require"
)

type rejectingPolicyDepthStore struct {
	rules.Store
}

func (rejectingPolicyDepthStore) UpdateChainMaxDepth(int) error {
	return errors.New("depth update rejected")
}

type customPolicyStore struct{ rules.Store }

func TestRoutingPluginInitializesSnapshotDepth(t *testing.T) {
	for _, depth := range []*int{nil, bifrost.Ptr(2)} {
		store, err := rules.NewLocalStore(t.Context(), rules.NewMockLogger(), nil)
		require.NoError(t, err)
		plugin, err := InitFromStore(t.Context(), &Config{ChainMaxDepth: depth}, rules.NewMockLogger(), nil, store, NewMockGovernance())
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, plugin.Cleanup()) })
		snapshot := store.Snapshot().(interface{ ChainMaxDepth() int })
		want := rules.DefaultChainMaxDepth
		if depth != nil {
			want = *depth
			*depth = 1
		}
		require.Equal(t, want, snapshot.ChainMaxDepth())
		require.Equal(t, want, store.Snapshot().(interface{ ChainMaxDepth() int }).ChainMaxDepth())
	}
}

func TestRoutingPluginRejectsDepthInitializationFailure(t *testing.T) {
	store, err := rules.NewLocalStore(t.Context(), rules.NewMockLogger(), nil)
	require.NoError(t, err)
	plugin, err := InitFromStore(t.Context(), nil, rules.NewMockLogger(), nil, rejectingPolicyDepthStore{store}, NewMockGovernance())
	require.ErrorContains(t, err, "depth update rejected")
	require.Nil(t, plugin)
	for _, depth := range []int{0, -1} {
		plugin, err = InitFromStore(t.Context(), &Config{ChainMaxDepth: &depth}, rules.NewMockLogger(), nil, store, NewMockGovernance())
		require.ErrorContains(t, err, "greater than 0")
		require.Nil(t, plugin)
	}
}

func TestRoutingPluginCustomStoreRetainsDepthPointer(t *testing.T) {
	ctx := context.Background()
	store, err := rules.NewLocalStore(ctx, rules.NewMockLogger(), nil)
	require.NoError(t, err)
	for index, stage := range []struct{ from, to string }{{"incoming", "middle"}, {"middle", "final"}} {
		require.NoError(t, store.UpsertRule(ctx, &tables.TableRoutingRule{
			ID: stage.from, Name: stage.from, Scope: "global", Priority: index,
			Enabled: bifrost.Ptr(true), ChainRule: true, CelExpression: `model == "` + stage.from + `"`,
			Targets: []tables.TableRoutingTarget{{Model: bifrost.Ptr(stage.to), Weight: 1}},
		}))
	}
	depth := 1
	plugin, err := InitFromStore(ctx, &Config{ChainMaxDepth: &depth}, rules.NewMockLogger(), nil, customPolicyStore{store}, NewMockGovernance())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, plugin.Cleanup()) })
	for _, want := range []string{"middle", "final"} {
		request, cancel := schemas.NewBifrostContextWithCancel(ctx)
		decision, err := plugin.engine.EvaluateRoutingRules(request, &rules.EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
		cancel()
		require.NoError(t, err)
		require.NotNil(t, decision)
		require.Equal(t, want, decision.Model)
		depth = 2
	}
}
