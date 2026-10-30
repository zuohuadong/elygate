package controlplane

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestRoutingInstallationStartupAndReplay(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := t.Context()
	compile := func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
		return []*tables.TableRoutingRule{{
			ID: "installed-rule", Name: "Installed", Scope: "global", CelExpression: "true",
			Enabled: new(true), Targets: []tables.TableRoutingTarget{{Provider: ptr("openai"), Weight: 1}},
		}}, nil
	}
	managed, err := CheckRoutingPolicyStartup(ctx, cs, compile)
	require.NoError(t, err)
	require.False(t, managed)
	require.NoError(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{RoutingChainMaxDepth: 7}))
	version := routingReleaseVersion(t, store)
	attempt, err := store.AcceptRoutingRelease(ctx, RoutingReleaseRequest{
		VersionID: version.ID, IdempotencyKey: uuid.NewString(),
	})
	require.NoError(t, err)
	_, err = CheckRoutingPolicyStartup(ctx, cs, compile)
	require.ErrorIs(t, err, ErrRoutingPolicyNotReady)
	live, err := cs.GetRoutingRules(ctx)
	require.NoError(t, err)
	require.Empty(t, live, "pending startup must not install a policy")

	head, err := store.InstallAcceptedRoutingRelease(ctx, attempt.Epoch, compile, "installer")
	require.NoError(t, err)
	require.True(t, head.IsApplied())
	replayed, err := store.InstallAcceptedRoutingRelease(ctx, attempt.Epoch, compile, "retry")
	require.NoError(t, err)
	require.Equal(t, *head, *replayed)
	require.Len(t, routingReleaseAudits(t, store), 2, "one accept and one apply audit")
	managed, err = CheckRoutingPolicyStartup(ctx, cs, compile)
	require.NoError(t, err)
	require.True(t, managed)
	require.ErrorIs(t, cs.DeleteRoutingRule(ctx, "installed-rule"), ErrRoutingPolicyManaged)
	require.ErrorIs(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{RoutingChainMaxDepth: 9}), ErrRoutingPolicyManaged)
	require.NoError(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{
		RoutingChainMaxDepth: version.ChainMaxDepth, InitialPoolSize: 91,
	}), "unrelated client fields remain writable")

	require.NoError(t, cs.DB().Model(&tables.TableRoutingRule{}).
		Where("id = ?", "installed-rule").UpdateColumn("cel_expression", "false").Error)
	_, err = CheckRoutingPolicyStartup(ctx, cs, compile)
	require.ErrorIs(t, err, ErrRoutingPolicyNotReady, "out-of-band drift fails closed")
	_, err = store.InstallAcceptedRoutingRelease(ctx, attempt.Epoch, compile, "repair")
	require.ErrorIs(t, err, ErrRoutingPolicyNotReady, "replay must not silently repair drift")
	require.Len(t, routingReleaseAudits(t, store), 2)
}

func TestRoutingInstallationFailuresRollBack(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := t.Context()
	require.NoError(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{RoutingChainMaxDepth: 7}))
	require.NoError(t, cs.CreateRoutingRule(ctx, &tables.TableRoutingRule{
		ID: "old-rule", Name: "Old", Scope: "global", CelExpression: "true", Enabled: new(true),
	}))
	version := routingReleaseVersion(t, store)
	attempt, err := store.AcceptRoutingRelease(ctx, RoutingReleaseRequest{
		VersionID: version.ID, IdempotencyKey: uuid.NewString(),
	})
	require.NoError(t, err)
	empty := func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
		return nil, nil
	}
	rejected := errors.New("installation rejected")
	_, err = store.InstallAcceptedRoutingRelease(ctx, attempt.Epoch, func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
		return nil, rejected
	}, "installer")
	require.ErrorIs(t, err, rejected)
	_, err = store.InstallAcceptedRoutingRelease(ctx, attempt.Epoch+1, empty, "installer")
	require.ErrorIs(t, err, ErrRoutingReleaseConflict)
	const callback = "test:routing-install-audit"
	require.NoError(t, cs.DB().Callback().Create().After("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			tx.AddError(rejected)
		}
	}))
	_, err = store.InstallAcceptedRoutingRelease(ctx, attempt.Epoch, empty, "installer")
	require.NoError(t, cs.DB().Callback().Create().Remove(callback))
	require.ErrorIs(t, err, rejected)
	requirePendingRoutingHead(t, store, attempt)
	live, err := cs.GetRoutingRules(ctx)
	require.NoError(t, err)
	require.Len(t, live, 1)
	require.Equal(t, "old-rule", live[0].ID)
	client, err := cs.GetClientConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, 7, client.RoutingChainMaxDepth)
	require.Len(t, routingReleaseAudits(t, store), 1)
}
