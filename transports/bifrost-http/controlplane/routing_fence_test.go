package controlplane

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func TestRoutingRuntimeFenceExclusivityAndTakeover(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	first, err := store.AcquireRoutingRuntimeFence(ctx, "instance-a", time.Hour)
	require.NoError(t, err)
	require.Equal(t, int64(1), first.Token().Token)
	require.NoError(t, store.ValidateRoutingRuntimeFence(ctx, first.Token()))

	_, err = store.AcquireRoutingRuntimeFence(ctx, "instance-b", time.Hour)
	require.ErrorIs(t, err, ErrRoutingRuntimeFenceOwned)

	expired := time.Now().UTC().Add(-time.Minute)
	require.NoError(t, cs.DB().Model(&RoutingRuntimeFence{}).
		Where("id = ?", routingRuntimeFenceRowID).
		Updates(map[string]any{"expires_at": expired}).Error)
	second, err := store.AcquireRoutingRuntimeFence(ctx, "instance-b", time.Hour)
	require.NoError(t, err)
	require.Equal(t, int64(2), second.Token().Token)
	require.ErrorIs(t, store.ValidateRoutingRuntimeFence(ctx, first.Token()), ErrRoutingRuntimeFenceLost)
	require.NoError(t, store.ValidateRoutingRuntimeFence(ctx, second.Token()))

	require.NoError(t, store.ReleaseRoutingRuntimeFence(ctx, second.Token()))
	require.ErrorIs(t, store.ValidateRoutingRuntimeFence(ctx, second.Token()), ErrRoutingRuntimeFenceLost)
}

func TestRoutingRuntimeFenceRenewalRejectsStaleToken(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	first, err := store.AcquireRoutingRuntimeFence(ctx, "instance-a", time.Hour)
	require.NoError(t, err)
	require.NoError(t, store.RenewRoutingRuntimeFence(ctx, first.Token(), time.Hour))

	expired := time.Now().UTC().Add(-time.Minute)
	require.NoError(t, cs.DB().Model(&RoutingRuntimeFence{}).
		Where("id = ?", routingRuntimeFenceRowID).
		Updates(map[string]any{"expires_at": expired}).Error)
	second, err := store.AcquireRoutingRuntimeFence(ctx, "instance-b", time.Hour)
	require.NoError(t, err)
	require.ErrorIs(t, store.RenewRoutingRuntimeFence(ctx, first.Token(), time.Hour), ErrRoutingRuntimeFenceLost)
	require.NoError(t, store.ReleaseRoutingRuntimeFence(ctx, second.Token()))
}

func TestRoutingRuntimeFenceRenewalNotifiesOnLoss(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first, err := store.AcquireRoutingRuntimeFence(ctx, "instance-a", 30*time.Millisecond)
	require.NoError(t, err)
	lost := make(chan struct{})
	stop := first.StartRenewal(ctx, func() { close(lost) })
	defer stop()

	expired := time.Now().UTC().Add(-time.Minute)
	require.NoError(t, cs.DB().Model(&RoutingRuntimeFence{}).
		Where("id = ?", routingRuntimeFenceRowID).
		Updates(map[string]any{"expires_at": expired}).Error)
	second, err := store.AcquireRoutingRuntimeFence(ctx, "instance-b", time.Hour)
	require.NoError(t, err)
	defer func() { require.NoError(t, store.ReleaseRoutingRuntimeFence(ctx, second.Token())) }()

	select {
	case <-lost:
	case <-time.After(time.Second):
		t.Fatal("renewal did not report lost ownership")
	}
	require.False(t, first.Valid())
}

func TestFencedRoutingInstallationRejectsLostOwner(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	require.NoError(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{RoutingChainMaxDepth: 2}))
	version := routingReleaseVersion(t, store)
	attempt, err := store.AcceptRoutingRelease(ctx, RoutingReleaseRequest{
		VersionID: version.ID, IdempotencyKey: uuid.NewString(),
	})
	require.NoError(t, err)
	first, err := store.AcquireRoutingRuntimeFence(ctx, "instance-a", time.Hour)
	require.NoError(t, err)

	expired := time.Now().UTC().Add(-time.Minute)
	require.NoError(t, cs.DB().Model(&RoutingRuntimeFence{}).
		Where("id = ?", routingRuntimeFenceRowID).
		Updates(map[string]any{"expires_at": expired}).Error)
	second, err := store.AcquireRoutingRuntimeFence(ctx, "instance-b", time.Hour)
	require.NoError(t, err)
	defer func() { require.NoError(t, store.ReleaseRoutingRuntimeFence(ctx, second.Token())) }()

	installed, err := store.InstallAcceptedRoutingReleaseFenced(ctx, attempt.Epoch,
		func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
			return nil, nil
		}, "stale", first.Token())
	require.ErrorIs(t, err, ErrRoutingRuntimeFenceLost)
	require.Nil(t, installed)
	head, err := store.GetRoutingReleaseHead(ctx)
	require.NoError(t, err)
	require.False(t, head.IsApplied())
	require.True(t, errors.Is(store.ValidateRoutingRuntimeFence(ctx, first.Token()), ErrRoutingRuntimeFenceLost))
}
