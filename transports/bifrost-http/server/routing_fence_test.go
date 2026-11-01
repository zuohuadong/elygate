package server

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRoutingAdmissionFailsClosedAfterFenceLoss(t *testing.T) {
	server, releases, _, _ := pendingRoutingActivation(t, activationRoutingRules)
	lease, err := releases.AcquireRoutingRuntimeFence(t.Context(), "server-test", time.Hour)
	require.NoError(t, err)
	server.routingFence = lease
	t.Cleanup(func() {
		lease.MarkLost()
		_ = releases.ReleaseRoutingRuntimeFence(t.Context(), lease.Token())
	})

	require.NoError(t, server.configureRoutingAdmission())
	require.Nil(t, activationAdmission(server, t))

	lease.MarkLost()
	server.markRoutingFenceLost()
	refusal := activationAdmission(server, t)
	require.NotNil(t, refusal)
	require.Equal(t, 503, refusal.EffectiveHTTPStatus())
	require.False(t, *refusal.AllowFallbacks)
}
