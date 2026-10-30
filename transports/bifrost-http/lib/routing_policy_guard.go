package lib

import (
	"context"
	"fmt"

	"github.com/maximhq/bifrost/framework/configstore"
)

// ConfigLoadOption extends startup without changing the default upstream load.
type ConfigLoadOption func(*Config)

// WithRoutingPolicyGuard delegates policy ownership/readiness to an extension.
// Managed means the database owns rules and depth, never the configuration file.
func WithRoutingPolicyGuard(guard func(context.Context, configstore.ConfigStore) (configstore.RoutingPolicyStartupState, error)) ConfigLoadOption {
	return func(config *Config) { config.routingPolicyGuard = guard }
}

func (config *Config) checkRoutingPolicyStartup(ctx context.Context) error {
	if config.routingPolicyGuard == nil {
		return nil
	}
	state, err := config.loadRoutingPolicyState(ctx)
	if err != nil {
		return err
	}
	config.Mu.Lock()
	config.routingPolicyManaged = state.Managed
	config.routingPolicyStartup = &state
	config.Mu.Unlock()
	return nil
}

// RoutingPolicyForPlugin consumes the startup snapshot once, then revalidates
// for later plugin reloads. The snapshot avoids independent rules/depth reads.
func (config *Config) RoutingPolicyForPlugin(ctx context.Context) (*configstore.RoutingPolicySnapshot, error) {
	config.Mu.Lock()
	startup := config.routingPolicyStartup
	config.routingPolicyStartup = nil
	config.Mu.Unlock()
	if startup != nil {
		return startup.Policy, nil
	}
	state, err := config.loadRoutingPolicyState(ctx)
	return state.Policy, err
}

func (config *Config) loadRoutingPolicyState(ctx context.Context) (configstore.RoutingPolicyStartupState, error) {
	if config.routingPolicyGuard == nil {
		return configstore.RoutingPolicyStartupState{}, nil
	}
	state, err := config.routingPolicyGuard(ctx, config.ConfigStore)
	if err != nil {
		return configstore.RoutingPolicyStartupState{}, fmt.Errorf("routing policy guard: %w", err)
	}
	if state.Managed && state.Policy == nil {
		return configstore.RoutingPolicyStartupState{}, fmt.Errorf("managed routing policy snapshot is missing")
	}
	if !state.Managed {
		state.Policy = nil
	}
	return state, nil
}
