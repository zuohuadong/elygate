package rules

import (
	"context"
	"testing"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	tables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func TestRoutingEvaluationRefreshesModelGovernanceAcrossChain(t *testing.T) {
	store, err := NewLocalStore(context.Background(), NewMockLogger(), nil)
	require.NoError(t, err)

	first := snapshotTestRule("select-candidate")
	first.CelExpression = `model == "incoming"`
	first.ChainRule = true
	first.Targets = []tables.TableRoutingTarget{{Model: bifrost.Ptr("restricted-model"), Weight: 1}}
	require.NoError(t, store.UpsertRule(context.Background(), first))

	second := snapshotTestRule("enforce-data-class")
	second.CelExpression = `model_data_class == "restricted" && "vision" in model_capabilities`
	second.Targets = []tables.TableRoutingTarget{{Provider: bifrost.Ptr("azure"), Model: bifrost.Ptr("restricted-model"), Weight: 1}}
	require.NoError(t, store.UpsertRule(context.Background(), second))

	engine, err := NewEngine(store, NewMockGovernanceStore(), NewMockLogger(), bifrost.Ptr(3))
	require.NoError(t, err)
	ctx, cancel := schemas.NewBifrostContextWithCancel(context.Background())
	defer cancel()

	decision, err := engine.EvaluateRoutingRules(ctx, &EvaluationContext{
		Provider: schemas.OpenAI,
		Model:    "incoming",
		ModelInfo: func(_ schemas.ModelProvider, model string) map[string]string {
			if model == "restricted-model" {
				return map[string]string{"data_class": "restricted", "capabilities": "vision,tools"}
			}
			return nil
		},
	})
	require.NoError(t, err)
	require.NotNil(t, decision)
	require.Equal(t, "azure", decision.Provider)
	require.Equal(t, "restricted-model", decision.Model)
}
