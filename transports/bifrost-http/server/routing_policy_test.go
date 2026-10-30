package server

import (
	"context"
	"errors"
	"sync"
	"testing"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	tables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/routing"
	"github.com/maximhq/bifrost/plugins/routing/rules"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
)

type routingPolicyConfigStore struct {
	configstore.ConfigStore
	depth int
	err   error
}

func (s *routingPolicyConfigStore) GetClientConfig(context.Context) (*configstore.ClientConfig, error) {
	return &configstore.ClientConfig{RoutingChainMaxDepth: s.depth}, s.err
}

func newRoutingPolicyReloadServer(t *testing.T) (*BifrostHTTPServer, *rules.LocalStore, *rules.Engine) {
	t.Helper()
	logger = noopTestLogger{}
	store, err := rules.NewLocalStore(t.Context(), rules.NewMockLogger(), nil)
	require.NoError(t, err)
	for index, stage := range []struct{ from, to string }{{"incoming", "middle"}, {"middle", "final"}} {
		require.NoError(t, store.UpsertRule(t.Context(), &tables.TableRoutingRule{
			ID: stage.from, Name: stage.from, Scope: "global", Priority: index,
			Enabled: bifrost.Ptr(true), ChainRule: true, CelExpression: `model == "` + stage.from + `"`,
			Targets: []tables.TableRoutingTarget{{Model: bifrost.Ptr(stage.to), Weight: 1}},
		}))
	}
	cfg := &lib.Config{
		ConfigStore:  &routingPolicyConfigStore{depth: 1},
		ClientConfig: &configstore.ClientConfig{RoutingChainMaxDepth: 1},
	}
	plugin, err := routing.InitFromStore(t.Context(), &routing.Config{ChainMaxDepth: &cfg.ClientConfig.RoutingChainMaxDepth}, rules.NewMockLogger(), nil, store, routing.NewMockGovernance())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, plugin.Cleanup()) })
	plugins := []schemas.BasePlugin{plugin}
	cfg.BasePlugins.Store(&plugins)
	engine, err := rules.NewEngine(store, rules.NewMockGovernanceStore(), rules.NewMockLogger(), &cfg.ClientConfig.RoutingChainMaxDepth)
	require.NoError(t, err)
	return &BifrostHTTPServer{Config: cfg}, store, engine
}

func TestRoutingPolicyClientConfigReloadPublishesDepth(t *testing.T) {
	server, store, engine := newRoutingPolicyReloadServer(t)
	old := store.Snapshot()
	server.Config.ConfigStore.(*routingPolicyConfigStore).depth = 2
	require.NoError(t, server.ReloadClientConfigFromConfigStore(t.Context()))
	require.Equal(t, 1, old.(interface{ ChainMaxDepth() int }).ChainMaxDepth())
	require.Equal(t, 2, store.Snapshot().(interface{ ChainMaxDepth() int }).ChainMaxDepth())
	require.Equal(t, 2, server.Config.ClientConfig.RoutingChainMaxDepth)
	request, cancel := schemas.NewBifrostContextWithCancel(t.Context())
	defer cancel()
	decision, err := engine.EvaluateRoutingRules(request, &rules.EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
	require.NoError(t, err)
	require.NotNil(t, decision)
	require.Equal(t, "final", decision.Model)
	// A zero persisted value uses the same effective default as initial config load.
	server.Config.ConfigStore.(*routingPolicyConfigStore).depth = 0
	require.NoError(t, server.ReloadClientConfigFromConfigStore(t.Context()))
	require.Equal(t, rules.DefaultChainMaxDepth, store.Snapshot().(interface{ ChainMaxDepth() int }).ChainMaxDepth())
	require.Equal(t, rules.DefaultChainMaxDepth, server.Config.ClientConfig.RoutingChainMaxDepth)
}

func TestRoutingPolicyFailedClientConfigReloadKeepsGeneration(t *testing.T) {
	server, store, _ := newRoutingPolicyReloadServer(t)
	source := server.Config.ConfigStore.(*routingPolicyConfigStore)
	old := store.Snapshot()
	source.depth, source.err = 2, errors.New("read rejected")
	require.ErrorContains(t, server.ReloadClientConfigFromConfigStore(t.Context()), "read rejected")
	require.Same(t, old, store.Snapshot())
	source.depth, source.err = -1, nil
	require.ErrorContains(t, server.ReloadClientConfigFromConfigStore(t.Context()), "greater than 0")
	require.Same(t, old, store.Snapshot())
	require.Equal(t, 1, server.Config.ClientConfig.RoutingChainMaxDepth)
}

func TestRoutingPolicyClientConfigReloadWithoutRoutingPlugin(t *testing.T) {
	server, _, _ := newRoutingPolicyReloadServer(t)
	server.Config.BasePlugins.Store(nil)
	server.Config.ConfigStore.(*routingPolicyConfigStore).depth = 2
	require.NoError(t, server.ReloadClientConfigFromConfigStore(t.Context()))
	require.Equal(t, 2, server.Config.ClientConfig.RoutingChainMaxDepth)
}

type routingPolicyCustomStore struct{ rules.Store }

func TestRoutingPolicyCustomStoreReloadUsesEffectiveDefault(t *testing.T) {
	server, store, _ := newRoutingPolicyReloadServer(t)
	custom := routingPolicyCustomStore{store}
	plugin, err := routing.InitFromStore(t.Context(), &routing.Config{ChainMaxDepth: &server.Config.ClientConfig.RoutingChainMaxDepth}, rules.NewMockLogger(), nil, custom, routing.NewMockGovernance())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, plugin.Cleanup()) })
	plugins := []schemas.BasePlugin{plugin}
	server.Config.BasePlugins.Store(&plugins)
	engine, err := rules.NewEngine(custom, rules.NewMockGovernanceStore(), rules.NewMockLogger(), &server.Config.ClientConfig.RoutingChainMaxDepth)
	require.NoError(t, err)
	server.Config.ConfigStore.(*routingPolicyConfigStore).depth = 0
	require.NoError(t, server.ReloadClientConfigFromConfigStore(t.Context()))
	require.Equal(t, rules.DefaultChainMaxDepth, server.Config.ClientConfig.RoutingChainMaxDepth)
	request, cancel := schemas.NewBifrostContextWithCancel(t.Context())
	defer cancel()
	decision, err := engine.EvaluateRoutingRules(request, &rules.EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
	require.NoError(t, err)
	require.NotNil(t, decision)
	require.Equal(t, "final", decision.Model)
}

func TestRoutingPolicyClientConfigReloadDoesNotRaceEvaluation(t *testing.T) {
	server, store, engine := newRoutingPolicyReloadServer(t)
	finished := make(chan error, 1)
	var reader sync.WaitGroup
	reader.Go(func() {
		for range 100 {
			request, cancel := schemas.NewBifrostContextWithCancel(t.Context())
			decision, err := engine.EvaluateRoutingRules(request, &rules.EvaluationContext{Provider: schemas.OpenAI, Model: "incoming"})
			cancel()
			if err != nil {
				finished <- err
				return
			}
			if decision == nil || (decision.Model != "middle" && decision.Model != "final") {
				finished <- errors.New("evaluation observed incoherent routing policy")
				return
			}
		}
		finished <- nil
	})
	for index := range 100 {
		server.Config.ConfigStore.(*routingPolicyConfigStore).depth = index%2 + 1
		require.NoError(t, server.ReloadClientConfigFromConfigStore(t.Context()))
	}
	reader.Wait()
	require.NoError(t, <-finished)
	require.Equal(t, 2, store.Snapshot().(interface{ ChainMaxDepth() int }).ChainMaxDepth())
}
