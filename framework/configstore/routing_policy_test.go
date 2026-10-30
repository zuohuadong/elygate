package configstore

import (
	"errors"
	"testing"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestRoutingPolicySnapshotReplaceRoundTrip(t *testing.T) {
	forRoutingLockBackends(t, func(t *testing.T, first, _ *RDBConfigStore) {
		ctx := t.Context()
		require.NoError(t, first.UpdateClientConfig(ctx, &ClientConfig{RoutingChainMaxDepth: 7, InitialPoolSize: 91}))
		require.NoError(t, first.UpdateClientMetadata(ctx, map[string]any{"theme": "dark"}))
		require.NoError(t, first.CreateRoutingRule(ctx, routingRuleFixture("old", 1, "openai")))
		clientBefore, err := first.GetClientConfig(ctx)
		require.NoError(t, err)
		var original *RoutingPolicySnapshot
		require.NoError(t, first.DB().Transaction(func(tx *gorm.DB) error {
			var err error
			original, err = SnapshotRoutingPolicy(tx)
			return err
		}))
		rule := routingRuleFixture("replacement", 2, "anthropic")
		zero, one := 0, 1
		rule.Targets[0].Position = &zero
		rule.Targets[0].Weight = 0
		rule.Targets = append(rule.Targets, tables.TableRoutingTarget{Position: &one, Weight: 1})
		wanted := RoutingPolicySnapshot{Rules: []tables.TableRoutingRule{*rule}, ChainMaxDepth: 3}
		expected, err := RoutingPolicyFingerprint(wanted)
		require.NoError(t, err)
		require.NoError(t, first.DB().Transaction(func(tx *gorm.DB) error {
			if err := ReplaceRoutingPolicy(tx, wanted); err != nil {
				return err
			}
			actual, err := SnapshotRoutingPolicy(tx)
			require.NoError(t, err)
			actualHash, err := RoutingPolicyFingerprint(*actual)
			require.NoError(t, err)
			require.Equal(t, expected, actualHash)
			return nil
		}))
		unchangedInput, err := RoutingPolicyFingerprint(wanted)
		require.NoError(t, err)
		require.Equal(t, expected, unchangedInput)
		clientAfter, err := first.GetClientConfig(ctx)
		require.NoError(t, err)
		clientBefore.RoutingChainMaxDepth = 3
		require.Equal(t, clientBefore, clientAfter)
		metadata, err := first.GetClientMetadata(ctx)
		require.NoError(t, err)
		require.Equal(t, "dark", metadata["theme"])
		require.NoError(t, first.DB().Transaction(func(tx *gorm.DB) error {
			return ReplaceRoutingPolicy(tx, *original)
		}))
	})
}

func TestRoutingPolicyReplacementRollbackAndEmpty(t *testing.T) {
	forRoutingLockBackends(t, func(t *testing.T, first, _ *RDBConfigStore) {
		ctx := t.Context()
		require.NoError(t, first.UpdateClientConfig(ctx, &ClientConfig{RoutingChainMaxDepth: 7}))
		require.NoError(t, first.CreateRoutingRule(ctx, routingRuleFixture("old", 1, "openai")))
		rejected := errors.New("outer transaction rejected")
		require.ErrorIs(t, first.DB().Transaction(func(tx *gorm.DB) error {
			require.NoError(t, ReplaceRoutingPolicy(tx, RoutingPolicySnapshot{ChainMaxDepth: 2}))
			return rejected
		}), rejected)
		stored, err := first.GetRoutingRules(ctx)
		require.NoError(t, err)
		require.Len(t, stored, 1)
		require.Equal(t, "old", stored[0].ID)
		require.NoError(t, first.DB().Transaction(func(tx *gorm.DB) error {
			return ReplaceRoutingPolicy(tx, RoutingPolicySnapshot{ChainMaxDepth: 2})
		}))
		stored, err = first.GetRoutingRules(ctx)
		require.NoError(t, err)
		require.Empty(t, stored)
		client, err := first.GetClientConfig(ctx)
		require.NoError(t, err)
		require.Equal(t, 2, client.RoutingChainMaxDepth)
	})
}

func TestRoutingPolicyRequiresTransactionAndCreatesMissingClient(t *testing.T) {
	store := setupRDBTestStore(t)
	_, err := SnapshotRoutingPolicy(nil)
	require.Error(t, err)
	_, err = SnapshotRoutingPolicy(store.DB())
	require.Error(t, err)
	require.Error(t, ReplaceRoutingPolicy(nil, RoutingPolicySnapshot{ChainMaxDepth: 1}))
	require.Error(t, ReplaceRoutingPolicy(store.DB(), RoutingPolicySnapshot{ChainMaxDepth: 1}))
	require.NoError(t, store.DB().Transaction(func(tx *gorm.DB) error {
		return ReplaceRoutingPolicy(tx, RoutingPolicySnapshot{ChainMaxDepth: 1})
	}))
	client, err := store.GetClientConfig(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, client.RoutingChainMaxDepth)
}

func TestRoutingPolicyWriteGuardCoversEveryWriter(t *testing.T) {
	store := setupRDBTestStore(t)
	ctx := t.Context()
	require.NoError(t, store.UpdateClientConfig(ctx, &ClientConfig{RoutingChainMaxDepth: 7}))
	require.NoError(t, store.CreateRoutingRule(ctx, routingRuleFixture("guarded", 1, "openai")))
	rejected := errors.New("policy is managed")
	store.SetRoutingPolicyWriteGuard(func(tx *gorm.DB, depth *int) error {
		require.NoError(t, LockRoutingPolicyWrite(tx), "guard executes in an already locked transaction")
		return rejected
	})
	require.ErrorIs(t, store.UpdateClientConfig(ctx, &ClientConfig{RoutingChainMaxDepth: 8}), rejected)
	require.ErrorIs(t, store.CreateRoutingRule(ctx, routingRuleFixture("another", 2, "openai")), rejected)
	require.ErrorIs(t, store.UpdateRoutingRule(ctx, routingRuleFixture("guarded", 1, "anthropic")), rejected)
	require.ErrorIs(t, store.DeleteRoutingRule(ctx, "guarded"), rejected)
	require.ErrorIs(t, store.SyncRoutingRules(ctx, nil, []tables.TableRoutingRule{*routingRuleFixture("guarded", 1, "anthropic")}), rejected)
	require.NoError(t, store.SyncRoutingRules(ctx, nil, nil))
	store.SetRoutingPolicyWriteGuard(nil)
	require.NoError(t, store.DeleteRoutingRule(ctx, "guarded"))
}
