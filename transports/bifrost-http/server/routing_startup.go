package server

import (
	"context"
	"fmt"

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

func (s *BifrostHTTPServer) initializeRoutingRuntimeFence(ctx context.Context) error {
	if s == nil || s.Config == nil || s.Config.ConfigStore == nil ||
		!s.Config.IsPluginLoaded(routing.PluginName) {
		return nil
	}
	releases, err := controlplane.NewStore(ctx, s.Config.ConfigStore)
	if err != nil {
		return fmt.Errorf("initialize routing runtime fence store: %w", err)
	}
	lease, err := releases.AcquireRoutingRuntimeFence(
		ctx, uuid.NewString(), controlplane.DefaultRoutingRuntimeFenceTTL,
	)
	if err != nil {
		return fmt.Errorf("acquire routing runtime fence: %w", err)
	}
	s.routingFence = lease
	s.stopRoutingFence = lease.StartRenewal(s.Ctx, s.markRoutingFenceLost)
	if err := s.configureRoutingAdmission(); err != nil {
		s.stopRoutingRuntimeFence()
		return fmt.Errorf("bind routing runtime fence admission: %w", err)
	}
	return nil
}

func (s *BifrostHTTPServer) stopRoutingRuntimeFence() {
	if s == nil {
		return
	}
	if s.stopRoutingFence != nil {
		stop := s.stopRoutingFence
		s.stopRoutingFence = nil
		stop()
	}
	s.routingFence = nil
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
	plugin, err := routing.InitFromStore(ctx, &managedOptions, logger, config.ConfigStore, store, governancePlugin)
	if err != nil {
		return nil, err
	}
	store.ManagePolicy()
	return plugin, nil
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
