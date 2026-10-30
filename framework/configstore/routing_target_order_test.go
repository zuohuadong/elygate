package configstore

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func TestRoutingTargetPositionsPreservePublishedOrderAfterReload(t *testing.T) {
	store := setupRDBTestStore(t)
	ctx := context.Background()
	firstPosition, secondPosition := 0, 1
	firstModel, secondModel := "first", "second"
	rule := &tables.TableRoutingRule{
		ID: "positioned-rule", Name: "Positioned", Scope: "global",
		CelExpression: "true", Enabled: new(true),
		Targets: []tables.TableRoutingTarget{
			{Model: &firstModel, Position: &firstPosition, Weight: 0.1},
			{Model: &secondModel, Position: &secondPosition, Weight: 0.9},
		},
	}
	require.NoError(t, store.CreateRoutingRule(ctx, rule))

	reloaded, err := store.GetRoutingRules(ctx)
	require.NoError(t, err)
	require.Len(t, reloaded, 1)
	require.Len(t, reloaded[0].Targets, 2)
	require.Equal(t, "first", *reloaded[0].Targets[0].Model)
	require.Equal(t, 0, *reloaded[0].Targets[0].Position)
	require.Equal(t, "second", *reloaded[0].Targets[1].Model)
	require.Equal(t, 1, *reloaded[0].Targets[1].Position)

	single, err := store.GetRoutingRule(ctx, rule.ID)
	require.NoError(t, err)
	require.Equal(t, reloaded[0].Targets, single.Targets)
	scoped, err := store.GetRoutingRulesByScope(ctx, "global", "")
	require.NoError(t, err)
	require.Len(t, scoped, 1)
	require.Equal(t, reloaded[0].Targets, scoped[0].Targets)
	paginated, total, err := store.GetRoutingRulesPaginated(ctx, RoutingRulesQueryParams{})
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, paginated, 1)
	require.Equal(t, reloaded[0].Targets, paginated[0].Targets)
}

func TestRoutingTargetPositionsRetainUpstreamWeightOrdering(t *testing.T) {
	store := setupRDBTestStore(t)
	ctx := context.Background()
	firstModel, secondModel := "first", "second"
	rule := &tables.TableRoutingRule{
		ID: "unpositioned-rule", Name: "Unpositioned", Scope: "global",
		CelExpression: "true", Enabled: new(true),
		Targets: []tables.TableRoutingTarget{
			{Model: &firstModel, Weight: 0.1},
			{Model: &secondModel, Weight: 0.9},
		},
	}
	require.NoError(t, store.CreateRoutingRule(ctx, rule))
	reloaded, err := store.GetRoutingRule(ctx, rule.ID)
	require.NoError(t, err)
	require.Len(t, reloaded.Targets, 2)
	require.Equal(t, "second", *reloaded.Targets[0].Model)
	require.Nil(t, reloaded.Targets[0].Position)
	require.Nil(t, reloaded.Targets[1].Position)
}

func TestValidateRoutingTargetPositionsRejectsMixedAndNonCanonicalLists(t *testing.T) {
	firstPosition, secondPosition := 0, 1
	require.Error(t, validateRoutingTargetPositions([]tables.TableRoutingTarget{
		{Position: &firstPosition}, {},
	}))
	require.Error(t, validateRoutingTargetPositions([]tables.TableRoutingTarget{
		{Position: &firstPosition}, {Position: &firstPosition},
	}))
	require.NoError(t, validateRoutingTargetPositions([]tables.TableRoutingTarget{
		{Position: &firstPosition}, {Position: &secondPosition},
	}))
	require.NoError(t, validateRoutingTargetPositions([]tables.TableRoutingTarget{{}}))
}

func TestValidateRoutingTargetPositionsRejectsNegativeAndGappedLists(t *testing.T) {
	negative, one := -1, 1
	require.Error(t, validateRoutingTargetPositions([]tables.TableRoutingTarget{
		{Position: &negative}, {Position: &one},
	}))

	zero, two := 0, 2
	require.Error(t, validateRoutingTargetPositions([]tables.TableRoutingTarget{
		{Position: &zero}, {Position: &two},
	}))
}
