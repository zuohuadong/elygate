package handlers

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestWebhookHandlerBudgetSubscriptionAndRedelivery(t *testing.T) {
	handler, config := newWebhookTestHandler(t)
	create := newWebhookRequestCtx(`{"name":"budget-alerts","url":"https://93.184.216.34/budgets","events":["budget.threshold_reached"]}`, nil)
	handler.createWebhookEndpoint(create)
	require.Equal(t, fasthttp.StatusCreated, create.Response.StatusCode(), "%s", create.Response.Body())
	endpoint := decodeJSONResponse(t, create)["endpoint"].(map[string]any)
	endpointID := endpoint["id"].(string)
	delivery := &logstore.WebhookDelivery{
		ID: "budget-attempt", WebhookID: "budget-event", EndpointID: endpointID,
		Event: tables.WebhookEventBudgetThresholdReached, ResourceID: "budget-alert",
		PayloadJSON: `{"id":"budget-alert","scope_type":"application","usage":8,"limit":10}`,
		Outcome:     logstore.WebhookDeliveryOutcomeDelivered, AttemptNo: 1, CreatedAt: time.Now().UTC(),
	}
	require.NoError(t, config.LogsStore.CreateWebhookDelivery(context.Background(), delivery))
	ctx := newWebhookRequestCtx("", map[string]string{"id": delivery.ID})
	handler.redeliverWebhook(ctx)
	require.Equal(t, fasthttp.StatusAccepted, ctx.Response.StatusCode(), "%s", ctx.Response.Body())
	jobs, err := config.ConfigStore.ListDueWebhookJobs(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, jobs, 1)
	require.Equal(t, delivery.WebhookID, jobs[0].ID)
	require.Equal(t, delivery.ResourceID, jobs[0].ResourceID)
	require.Equal(t, delivery.PayloadJSON, jobs[0].PayloadJSON)
	require.Empty(t, jobs[0].AsyncJobID)
	history := newWebhookRequestCtx("", map[string]string{"id": endpointID})
	handler.listWebhookDeliveries(history)
	require.Equal(t, fasthttp.StatusOK, history.Response.StatusCode())
	require.NotContains(t, string(history.Response.Body()), "payload_json")
	require.NotContains(t, string(history.Response.Body()), `"usage"`)
}
