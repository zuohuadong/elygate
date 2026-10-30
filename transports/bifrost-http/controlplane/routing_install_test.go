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
	state, err := CheckRoutingPolicyStartup(ctx, cs, compile)
	require.NoError(t, err)
	require.False(t, state.Managed)
	require.Nil(t, state.Policy)
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
	require.True(t, head.Head.IsApplied())
	require.Equal(t, version.ChainMaxDepth, head.Policy.ChainMaxDepth)
	require.Len(t, head.Policy.Rules, 1)
	require.Equal(t, "installed-rule", head.Policy.Rules[0].ID)
	require.Equal(t, "true", head.Policy.Rules[0].CelExpression)
	replayed, err := store.InstallAcceptedRoutingRelease(ctx, attempt.Epoch, compile, "retry")
	require.NoError(t, err)
	require.Equal(t, head.Head, replayed.Head)
	require.Equal(t, head.Policy, replayed.Policy)
	require.Len(t, routingReleaseAudits(t, store), 2, "one accept and one apply audit")
	state, err = CheckRoutingPolicyStartup(ctx, cs, compile)
	require.NoError(t, err)
	require.True(t, state.Managed)
	require.NotNil(t, state.Policy)
	require.ErrorIs(t, cs.DeleteRoutingRule(ctx, "installed-rule"), ErrRoutingPolicyManaged)
	require.ErrorIs(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{RoutingChainMaxDepth: 9}), ErrRoutingPolicyManaged)
	require.NoError(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{
		RoutingChainMaxDepth: version.ChainMaxDepth, InitialPoolSize: 91,
	}), "unrelated client fields remain writable")

	require.NoError(t, cs.DB().Model(&tables.TableRoutingRule{}).
		Where("id = ?", "installed-rule").UpdateColumn("cel_expression", "false").Error)
	require.Equal(t, "true", head.Policy.Rules[0].CelExpression, "returned policy does not follow later live edits")
	_, err = CheckRoutingPolicyStartup(ctx, cs, compile)
	require.ErrorIs(t, err, ErrRoutingPolicyNotReady, "out-of-band drift fails closed")
	rejectedInstallation, err := store.InstallAcceptedRoutingRelease(ctx, attempt.Epoch, compile, "repair")
	require.Nil(t, rejectedInstallation)
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
	rejectedInstallation, err := store.InstallAcceptedRoutingRelease(ctx, attempt.Epoch, func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
		return nil, rejected
	}, "installer")
	require.ErrorIs(t, err, rejected)
	require.NotErrorIs(t, err, ErrRoutingInstallationUncertain)
	require.Nil(t, rejectedInstallation)
	rejectedInstallation, err = store.InstallAcceptedRoutingRelease(ctx, attempt.Epoch+1, empty, "installer")
	require.ErrorIs(t, err, ErrRoutingReleaseConflict)
	require.NotErrorIs(t, err, ErrRoutingInstallationUncertain)
	require.Nil(t, rejectedInstallation)
	const callback = "test:routing-install-audit"
	require.NoError(t, cs.DB().Callback().Create().After("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			tx.AddError(rejected)
		}
	}))
	rejectedInstallation, err = store.InstallAcceptedRoutingRelease(ctx, attempt.Epoch, empty, "installer")
	require.NoError(t, cs.DB().Callback().Create().Remove(callback))
	require.ErrorIs(t, err, rejected)
	require.NotErrorIs(t, err, ErrRoutingInstallationUncertain)
	require.Nil(t, rejectedInstallation)
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

func TestRoutingInstallationMissingClientLeavesReleasePending(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	version := routingReleaseVersion(t, store)
	attempt, err := store.AcceptRoutingRelease(t.Context(), RoutingReleaseRequest{
		VersionID: version.ID, IdempotencyKey: uuid.NewString(),
	})
	require.NoError(t, err)
	installed, err := store.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
		return nil, nil
	}, "installer")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	require.Nil(t, installed)
	requirePendingRoutingHead(t, store, attempt)
	var clients int64
	require.NoError(t, cs.DB().Model(&tables.TableClientConfig{}).Count(&clients).Error)
	require.Zero(t, clients)
	require.Len(t, routingReleaseAudits(t, store), 1, "failed installation cannot acknowledge apply")
}
