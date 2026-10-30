package server

import (
	"context"
	"errors"
	"testing"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/routing"
	"github.com/maximhq/bifrost/plugins/routing/rules"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
)

type startupRoutingStore struct {
	configstore.ConfigStore
	ruleReads int
	reject    bool
}

func (s *startupRoutingStore) GetRoutingRules(ctx context.Context) ([]tables.TableRoutingRule, error) {
	s.ruleReads++
	if s.reject {
		return nil, errors.New("unexpected live routing read after validation")
	}
	return s.ConfigStore.GetRoutingRules(ctx)
}

func newStartupRoutingStore(t *testing.T) *startupRoutingStore {
	t.Helper()
	logger = noopTestLogger{}
	return &startupRoutingStore{ConfigStore: newRoutingTestConfigStore(t)}
}

func TestRoutingStartupManagedPluginUsesSnapshotWithoutLiveRuleRead(t *testing.T) {
	for _, empty := range []bool{false, true} {
		t.Run(map[bool]string{false: "rules", true: "empty"}[empty], func(t *testing.T) {
			store := newStartupRoutingStore(t)
			store.reject = true
			policy := &configstore.RoutingPolicySnapshot{ChainMaxDepth: 2}
			if !empty {
				policy.Rules = []tables.TableRoutingRule{{
					ID: "snapshot", Name: "Snapshot", Scope: "global", Enabled: new(true),
					CelExpression: "true", Targets: []tables.TableRoutingTarget{{Model: new("snapshot-model"), Weight: 1}},
				}}
			}
			config := &lib.Config{ConfigStore: store}
			lib.WithRoutingPolicyGuard(func(context.Context, configstore.ConfigStore) (configstore.RoutingPolicyStartupState, error) {
				return configstore.RoutingPolicyStartupState{Managed: true, Policy: policy}, nil
			})(config)
			options := &routing.Config{ChainMaxDepth: new(9)}
			plugin, err := initRoutingPlugin(t.Context(), options, config, routing.NewMockGovernance())
			require.NoError(t, err)
			defer func() { require.NoError(t, plugin.Cleanup()) }()
			require.Zero(t, store.ruleReads)
			require.Equal(t, 9, *options.ChainMaxDepth, "managed depth must not mutate caller options")
			local := plugin.GetRuleStore().(*rules.LocalStore)
			require.Equal(t, 2, local.Snapshot().(interface{ ChainMaxDepth() int }).ChainMaxDepth())
			require.Len(t, local.GetAllRules(t.Context()), len(policy.Rules))
			if !empty {
				policy.Rules[0].CelExpression = "false"
				compiled := local.GetAllRules(t.Context())[0]
				require.Equal(t, "true", compiled.CelExpression, "the installed generation owns its rules")
				_, err := local.GetProgram(t.Context(), compiled)
				require.NoError(t, err)
			}
		})
	}
}

func TestRoutingStartupUnmanagedPluginKeepsStoreLoading(t *testing.T) {
	store := newStartupRoutingStore(t)
	require.NoError(t, store.CreateRoutingRule(t.Context(), &tables.TableRoutingRule{
		ID: "file-owned", Name: "File owned", Scope: "global", Enabled: new(true), CelExpression: "true",
	}))
	plugin, err := initRoutingPlugin(t.Context(), nil, &lib.Config{ConfigStore: store}, routing.NewMockGovernance())
	require.NoError(t, err)
	defer func() { require.NoError(t, plugin.Cleanup()) }()
	require.Equal(t, 1, store.ruleReads)
	require.Equal(t, "file-owned", plugin.GetRuleStore().GetAllRules(t.Context())[0].ID)
}

func TestRoutingStartupPluginRejectsGuardFailureBeforeReadingLive(t *testing.T) {
	store := newStartupRoutingStore(t)
	config := &lib.Config{ConfigStore: store}
	rejected := errors.New("pending or drifted")
	lib.WithRoutingPolicyGuard(func(context.Context, configstore.ConfigStore) (configstore.RoutingPolicyStartupState, error) {
		return configstore.RoutingPolicyStartupState{}, rejected
	})(config)
	plugin, err := initRoutingPlugin(t.Context(), nil, config, routing.NewMockGovernance())
	require.ErrorIs(t, err, rejected)
	require.Nil(t, plugin)
	require.Zero(t, store.ruleReads)
}
