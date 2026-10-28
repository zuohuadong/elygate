package webhooks

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/stretchr/testify/require"
)

func resourceWebhookJob() tables.TableWebhookJob {
	return tables.TableWebhookJob{ID: "budget-webhook", EndpointID: "ep-1",
		Event: tables.WebhookEventBudgetThresholdReached, ResourceID: "alert-1",
		PayloadJSON: `{"id":"alert-1","scope_type":"project","scope_id":"project-1","threshold":0.8,"usage":8,"limit":10}`,
		CreatedAt:   time.Now().UTC(), NextAttemptAt: time.Now().UTC().Add(-time.Second)}
}

func TestResourceWebhookPayloadIsStableAndRejectsNonObjects(t *testing.T) {
	job := resourceWebhookJob()
	first, err := renderResourcePayload(job)
	require.NoError(t, err)
	repeated, err := renderResourcePayload(job)
	require.NoError(t, err)
	require.Equal(t, first, repeated)
	var envelope struct {
		Event tables.WebhookEvent `json:"event"`
		Data  struct {
			ID    string  `json:"id"`
			Usage float64 `json:"usage"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(first, &envelope))
	require.Equal(t, job.Event, envelope.Event)
	require.Equal(t, job.ResourceID, envelope.Data.ID)
	require.Equal(t, 8.0, envelope.Data.Usage)
	for _, payload := range []string{"", "null", "[]", "true", "broken"} {
		job.PayloadJSON = payload
		_, err := renderResourcePayload(job)
		require.Error(t, err)
	}
}

func TestResourceWebhookDeliveryDoesNotLookUpAsyncJobs(t *testing.T) {
	endpoint := testEndpoint("ep-1", "https://receiver.example/hook")
	f := newFixture(t, endpoint)
	f.logStore.findErr = errors.New("async store must not be consulted")
	job := resourceWebhookJob()
	require.NoError(t, f.configStore.CreateWebhookJob(context.Background(), &job))
	f.resolver.endpoints["ep-1"].Disabled = true
	f.dispatcher.processDue(job)
	require.Nil(t, f.configStore.job(job.ID))
	require.Len(t, f.logStore.deliveries, 1)
	history := f.logStore.deliveries[0]
	require.Equal(t, job.ResourceID, history.ResourceID)
	require.Equal(t, job.PayloadJSON, history.PayloadJSON)
	require.Empty(t, history.AsyncJobID)
	require.Equal(t, logstore.WebhookDeliveryOutcomePermanentFailure, history.Outcome)
}

func TestResourceWebhookSignedRetryAndReplay(t *testing.T) {
	type receivedDelivery struct {
		body      []byte
		id        string
		timestamp string
		signature string
		event     string
	}
	received := make(chan receivedDelivery, 3)
	var requests atomic.Int32
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		received <- receivedDelivery{body, r.Header.Get("webhook-id"), r.Header.Get("webhook-timestamp"),
			r.Header.Get("webhook-signature"), r.Header.Get("X-Bifrost-Event")}
		if requests.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
		} else {
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer receiver.Close()
	endpoint := testEndpoint("ep-1", receiver.URL)
	endpoint.Events = []tables.WebhookEvent{tables.WebhookEventBudgetThresholdReached}
	f := newFixture(t, endpoint)
	f.logStore.findErr = errors.New("async store is unavailable")
	job := resourceWebhookJob()
	require.NoError(t, f.configStore.CreateWebhookJob(context.Background(), &job))
	f.dispatcher.processDue(job)
	retry := f.configStore.job(job.ID)
	require.NotNil(t, retry)
	require.Equal(t, 1, retry.AttemptCount)
	require.True(t, retry.NextAttemptAt.After(time.Now()))
	f.dispatcher.processDue(*retry)
	require.EqualValues(t, 1, requests.Load(), "a future retry cannot be claimed early")
	f.configStore.mu.Lock()
	f.configStore.jobs[job.ID].NextAttemptAt = time.Now().Add(-time.Second)
	f.configStore.mu.Unlock()
	retry = f.configStore.job(job.ID)
	f.dispatcher.processDue(*retry)
	require.Nil(t, f.configStore.job(job.ID))
	history := f.logStore.deliveryList()
	require.Len(t, history, 2)
	require.Equal(t, logstore.WebhookDeliveryOutcomeRetryableFailure, history[0].Outcome)
	require.Equal(t, logstore.WebhookDeliveryOutcomeDelivered, history[1].Outcome)
	replay := tables.TableWebhookJob{ID: history[1].WebhookID, EndpointID: history[1].EndpointID,
		ResourceID: history[1].ResourceID, PayloadJSON: history[1].PayloadJSON, Event: history[1].Event}
	require.NoError(t, f.configStore.CreateWebhookJob(context.Background(), &replay))
	f.dispatcher.processDue(replay)
	require.Nil(t, f.configStore.job(job.ID))
	for range 3 {
		delivery := <-received
		require.Equal(t, job.ID, delivery.id)
		require.Equal(t, string(job.Event), delivery.event)
		timestamp, err := strconv.ParseInt(delivery.timestamp, 10, 64)
		require.NoError(t, err)
		expected, err := Sign(testSecret, delivery.id, time.Unix(timestamp, 0), delivery.body)
		require.NoError(t, err)
		require.Equal(t, expected, delivery.signature)
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		require.NoError(t, json.Unmarshal(delivery.body, &envelope))
		require.JSONEq(t, job.PayloadJSON, string(envelope.Data))
	}
}
