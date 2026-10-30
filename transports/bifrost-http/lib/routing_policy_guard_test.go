package lib

import (
	"context"
	"errors"
	"testing"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/stretchr/testify/require"
)

func TestRoutingPolicyGuardConsumesFinalStartupSnapshotThenRevalidates(t *testing.T) {
	config := &Config{}
	calls := 0
	WithRoutingPolicyGuard(func(context.Context, configstore.ConfigStore) (configstore.RoutingPolicyStartupState, error) {
		calls++
		return configstore.RoutingPolicyStartupState{
			Managed: true, Policy: &configstore.RoutingPolicySnapshot{ChainMaxDepth: calls},
		}, nil
	})(config)
	require.NoError(t, config.checkRoutingPolicyStartup(t.Context()))
	require.NoError(t, config.checkRoutingPolicyStartup(t.Context()))
	policy, err := config.RoutingPolicyForPlugin(t.Context())
	require.NoError(t, err)
	require.Equal(t, 2, policy.ChainMaxDepth)
	require.Equal(t, 2, calls, "initial plugin consumes the last proven snapshot without another read")
	require.Nil(t, config.routingPolicyStartup, "consumption releases the retained snapshot")
	policy, err = config.RoutingPolicyForPlugin(t.Context())
	require.NoError(t, err)
	require.Equal(t, 3, policy.ChainMaxDepth, "reload obtains a fresh proven snapshot")
}

func TestRoutingPolicyGuardRejectsMissingManagedSnapshotAndReloadErrors(t *testing.T) {
	config := &Config{}
	WithRoutingPolicyGuard(func(context.Context, configstore.ConfigStore) (configstore.RoutingPolicyStartupState, error) {
		return configstore.RoutingPolicyStartupState{Managed: true}, nil
	})(config)
	require.ErrorContains(t, config.checkRoutingPolicyStartup(t.Context()), "snapshot is missing")
	policy, err := config.RoutingPolicyForPlugin(t.Context())
	require.ErrorContains(t, err, "snapshot is missing")
	require.Nil(t, policy)
	rejected := errors.New("pending or drifted")
	WithRoutingPolicyGuard(func(context.Context, configstore.ConfigStore) (configstore.RoutingPolicyStartupState, error) {
		return configstore.RoutingPolicyStartupState{
			Managed: true, Policy: &configstore.RoutingPolicySnapshot{ChainMaxDepth: 2},
		}, rejected
	})(config)
	policy, err = config.RoutingPolicyForPlugin(t.Context())
	require.ErrorIs(t, err, rejected)
	require.Nil(t, policy, "a failed validation cannot expose a supplied snapshot")
}

func TestRoutingPolicyGuardUnmanagedAndAbsent(t *testing.T) {
	config := &Config{}
	require.NoError(t, config.checkRoutingPolicyStartup(t.Context()))
	policy, err := config.RoutingPolicyForPlugin(t.Context())
	require.NoError(t, err)
	require.Nil(t, policy)
	calls := 0
	WithRoutingPolicyGuard(func(context.Context, configstore.ConfigStore) (configstore.RoutingPolicyStartupState, error) {
		calls++
		return configstore.RoutingPolicyStartupState{}, nil
	})(config)
	require.NoError(t, config.checkRoutingPolicyStartup(t.Context()))
	policy, err = config.RoutingPolicyForPlugin(t.Context())
	require.NoError(t, err)
	require.Nil(t, policy)
	require.Equal(t, 1, calls, "an unmanaged startup result is also consumed once")
	policy, err = config.RoutingPolicyForPlugin(t.Context())
	require.NoError(t, err)
	require.Nil(t, policy)
	require.Equal(t, 2, calls)
}
