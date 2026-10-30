package server

import (
	"fmt"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/plugins/routing"
	"github.com/maximhq/bifrost/plugins/routing/rules"
)

func (s *BifrostHTTPServer) reloadRoutingChainMaxDepth(config *configstore.ClientConfig) error {
	if config.RoutingChainMaxDepth == 0 {
		config.RoutingChainMaxDepth = rules.DefaultChainMaxDepth
	}
	if !s.Config.IsPluginLoaded(routing.PluginName) {
		return nil
	}
	plugin, err := s.getRoutingPlugin()
	if err != nil {
		return err
	}
	if updater, ok := plugin.GetRuleStore().(rules.ChainMaxDepthUpdater); ok {
		if err := updater.UpdateChainMaxDepth(config.RoutingChainMaxDepth); err != nil {
			return fmt.Errorf("failed to reload routing chain depth: %w", err)
		}
	}
	return nil
}
