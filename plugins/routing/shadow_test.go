package routing

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/routing/rules"
	"github.com/stretchr/testify/require"
)

func TestShadowEvaluatorReportsCandidateDifferenceWithoutMutatingContext(t *testing.T) {
	candidateStore, err := rules.NewLocalStore(context.Background(), rules.NewMockLogger(), nil)
	require.NoError(t, err)
	enabled := true
	require.NoError(t, candidateStore.UpsertRule(context.Background(), &configstoreTables.TableRoutingRule{
		ID: uuid.NewString(), Name: "candidate", Scope: "global", Enabled: &enabled,
		CelExpression: "true", Priority: 1,
		Targets: []configstoreTables.TableRoutingTarget{
			{Provider: schemas.Ptr("openai"), Model: schemas.Ptr("candidate"), Weight: 1},
		},
	}))

	reported := make(chan ShadowReport, 1)
	evaluator, err := NewShadowEvaluator(candidateStore, rules.NewMockGovernanceStore(), rules.NewMockLogger(), 4, 1, 2, func(report ShadowReport) {
		reported <- report
	})
	require.NoError(t, err)

	attributes := map[string]string{"region": "eu"}
	headers := map[string]string{"x-tier": "gold"}
	routingCtx := &rules.EvaluationContext{
		Provider: schemas.OpenAI, Model: "incoming", RequestType: "chat_completion",
		ModelAttributes: attributes, Headers: headers,
		Scope: rules.GovernanceScope{VirtualKeyID: "vk-1"},
	}
	live := &rules.Decision{Provider: "openai", Model: "live"}
	require.True(t, evaluator.Submit(routingCtx, live))
	attributes["region"] = "mutated"
	headers["x-tier"] = "mutated"

	select {
	case report := <-reported:
		require.False(t, report.Match)
		require.Equal(t, "live", report.Live.Model)
		require.Equal(t, "candidate", report.Candidate.Model)
		require.Empty(t, report.CandidateErr)
		require.Equal(t, "vk-1", report.VirtualKeyID)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for shadow report")
	}
	evaluator.Close()
}

func TestShadowEvaluatorDropsWhenQueueIsFullAndDrainsOnClose(t *testing.T) {
	candidateStore, err := rules.NewLocalStore(context.Background(), rules.NewMockLogger(), nil)
	require.NoError(t, err)
	blockReporter := make(chan struct{})
	reportStarted := make(chan struct{})
	var once sync.Once
	reported := make(chan ShadowReport, 2)
	evaluator, err := NewShadowEvaluator(candidateStore, rules.NewMockGovernanceStore(), rules.NewMockLogger(), 4, 1, 1, func(report ShadowReport) {
		once.Do(func() { close(reportStarted) })
		<-blockReporter
		reported <- report
	})
	require.NoError(t, err)
	sample := &rules.EvaluationContext{Provider: schemas.OpenAI, Model: "incoming", RequestType: "chat_completion"}
	require.True(t, evaluator.Submit(sample, nil))
	select {
	case <-reportStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("shadow worker did not start")
	}
	require.True(t, evaluator.Submit(sample, nil), "one queued sample should fit")
	require.False(t, evaluator.Submit(sample, nil), "a full queue must drop rather than block")
	close(blockReporter)
	evaluator.Close()
	require.Len(t, reported, 2)
}

func TestShadowEvaluatorZeroSampleRateDoesNotQueue(t *testing.T) {
	candidateStore, err := rules.NewLocalStore(context.Background(), rules.NewMockLogger(), nil)
	require.NoError(t, err)
	reported := make(chan ShadowReport, 1)
	evaluator, err := NewShadowEvaluator(candidateStore, rules.NewMockGovernanceStore(), rules.NewMockLogger(), 4, 0, 1, func(report ShadowReport) {
		reported <- report
	})
	require.NoError(t, err)
	require.False(t, evaluator.Submit(&rules.EvaluationContext{
		Provider: schemas.OpenAI, Model: "incoming", RequestType: "chat_completion",
	}, nil))
	evaluator.Close()
	select {
	case <-reported:
		t.Fatal("zero-rate shadow evaluator emitted a report")
	default:
	}
}

func TestRoutingPluginSubmitsShadowAfterLiveDecision(t *testing.T) {
	liveStore, err := rules.NewLocalStore(context.Background(), rules.NewMockLogger(), nil)
	require.NoError(t, err)
	candidateStore, err := rules.NewLocalStore(context.Background(), rules.NewMockLogger(), nil)
	require.NoError(t, err)
	enabled := true
	target := func(model string) []configstoreTables.TableRoutingTarget {
		return []configstoreTables.TableRoutingTarget{{
			Provider: schemas.Ptr("openai"), Model: schemas.Ptr(model), Weight: 1,
		}}
	}
	require.NoError(t, liveStore.UpsertRule(context.Background(), &configstoreTables.TableRoutingRule{
		ID: uuid.NewString(), Name: "live", Scope: "global", Enabled: &enabled,
		CelExpression: "true", Priority: 1, Targets: target("live"),
	}))
	require.NoError(t, candidateStore.UpsertRule(context.Background(), &configstoreTables.TableRoutingRule{
		ID: uuid.NewString(), Name: "candidate", Scope: "global", Enabled: &enabled,
		CelExpression: "true", Priority: 1, Targets: target("candidate"),
	}))

	reported := make(chan ShadowReport, 1)
	plugin, err := InitFromStore(context.Background(), &Config{
		ShadowPolicyStore: candidateStore, ShadowSampleRate: 1, ShadowQueueSize: 1,
		ShadowReporter: func(report ShadowReport) { reported <- report },
	}, rules.NewMockLogger(), nil, liveStore, NewMockGovernance())
	require.NoError(t, err)
	defer plugin.Cleanup()

	ctx := schemas.NewBifrostContext(context.Background(), time.Now())
	req := &schemas.BifrostRequest{
		RequestType: schemas.ChatCompletionRequest,
		ChatRequest: &schemas.BifrostChatRequest{Provider: schemas.OpenAI, Model: "incoming"},
	}
	decision, err := plugin.applyRoutingRules(ctx, req, rules.GovernanceScope{})
	require.NoError(t, err)
	require.Equal(t, "live", decision.Model)
	select {
	case report := <-reported:
		require.Equal(t, "live", report.Live.Model)
		require.Equal(t, "candidate", report.Candidate.Model)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for wired shadow report")
	}
}
