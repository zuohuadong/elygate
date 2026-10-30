package lib

import (
	"context"
	"fmt"

	"github.com/maximhq/bifrost/framework/configstore"
)

// ConfigLoadOption extends startup without changing the default upstream load.
type ConfigLoadOption func(*Config)

// WithRoutingPolicyGuard delegates policy ownership/readiness to an extension.
// true means the database owns rules and depth, never the configuration file.
func WithRoutingPolicyGuard(guard func(context.Context, configstore.ConfigStore) (bool, error)) ConfigLoadOption {
	return func(config *Config) { config.routingPolicyGuard = guard }
}

func (config *Config) checkRoutingPolicyStartup(ctx context.Context) error {
	if config.routingPolicyGuard == nil {
		return nil
	}
	managed, err := config.routingPolicyGuard(ctx, config.ConfigStore)
	if err != nil {
		return fmt.Errorf("routing policy startup guard: %w", err)
	}
	config.routingPolicyManaged = managed
	return nil
}
