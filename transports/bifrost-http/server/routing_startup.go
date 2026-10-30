package server

import (
	"context"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/routing"
	"github.com/maximhq/bifrost/plugins/routing/rules"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
)

func compileRoutingRelease(ctx context.Context, version controlplane.RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
	id, err := uuid.Parse(version.ID)
	if err != nil {
		return nil, err
	}
	return handlers.CompileRoutingPolicy(ctx, handlers.RoutingPolicyCandidate{
		VersionID: id, RulesJSON: version.RulesJSON, ChainMaxDepth: version.ChainMaxDepth, CreatedAt: version.CreatedAt,
	})
}

func checkRoutingPolicyStartup(ctx context.Context, store configstore.ConfigStore) (configstore.RoutingPolicyStartupState, error) {
	return controlplane.CheckRoutingPolicyStartup(ctx, store, compileRoutingRelease)
}

func initRoutingPlugin(ctx context.Context, options *routing.Config, config *lib.Config, governancePlugin routing.Governance) (*routing.RoutingPlugin, error) {
	policy, err := config.RoutingPolicyForPlugin(ctx)
	if err != nil {
		return nil, err
	}
	if policy == nil {
		return routing.Init(ctx, options, logger, config.ConfigStore, governancePlugin)
	}
	store, err := preparedRoutingStore(ctx, policy)
	if err != nil {
		return nil, err
	}
	managedOptions := routing.Config{}
	if options != nil {
		managedOptions = *options
	}
	depth := policy.ChainMaxDepth
	managedOptions.ChainMaxDepth = &depth
	return routing.InitFromStore(ctx, &managedOptions, logger, config.ConfigStore, store, governancePlugin)
}

func preparedRoutingStore(ctx context.Context, policy *configstore.RoutingPolicySnapshot) (*rules.LocalStore, error) {
	store, err := rules.NewLocalStore(ctx, logger, nil)
	if err != nil {
		return nil, err
	}
	compiled := make([]*tables.TableRoutingRule, len(policy.Rules))
	for index := range policy.Rules {
		compiled[index] = &policy.Rules[index]
	}
	prepared, err := store.PreparePolicy(ctx, compiled, policy.ChainMaxDepth)
	if err != nil {
		return nil, err
	}
	if err := store.InstallPreparedPolicy(ctx, prepared); err != nil {
		return nil, err
	}
	return store, nil
}
