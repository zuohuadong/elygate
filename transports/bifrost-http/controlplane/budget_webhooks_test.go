package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/maximhq/bifrost/framework/webhooks"
	"github.com/maximhq/bifrost/plugins/logging"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type budgetWebhookReceipt struct {
	body   []byte
	header http.Header
	err    error
}

func budgetWebhookReceiver(t *testing.T) (*httptest.Server, <-chan budgetWebhookReceipt) {
	t.Helper()
	received := make(chan budgetWebhookReceipt, 8)
	var attempts atomic.Int32
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		select {
		case received <- budgetWebhookReceipt{body, r.Header.Clone(), err}:
		case <-r.Context().Done():
			return
		}
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
		} else if attempts.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
		} else {
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	t.Cleanup(receiver.Close)
	return receiver, received
}

func budgetWebhookLogSource(t *testing.T) (logstore.LogStore, *logging.PluginLogManager) {
	t.Helper()
	ctx := context.Background()
	logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	logConfig := &logstore.Config{
		Enabled: true, Type: logstore.LogStoreTypeSQLite,
		Config: &logstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "logs.db")},
	}
	if socket := os.Getenv("ELYGATE_TEST_POSTGRES_SOCKET"); socket != "" {
		controlPlaneConfig := testPostgresControlPlaneConfig(t, socket)
		postgreSQLConfig := controlPlaneConfig.Config.(*configstore.PostgresConfig)
		// The socket uses trust auth, but the upstream log-store constructor requires a nonempty value.
		postgreSQLConfig.Password = schemas.NewSecretVar(uuid.NewString())
		logConfig.Type = logstore.LogStoreTypePostgres
		logConfig.Config = &logstore.PostgresConfig{
			Config:                 *postgreSQLConfig,
			MatViewRefreshInterval: "off",
		}
	}
	logs, err := logstore.NewLogStore(ctx, logConfig, logger)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, logs.Close(ctx)) })
	rdb, ok := logs.(*logstore.RDBLogStore)
	require.True(t, ok, "budget webhook tests require the production relational log store")
	require.Equal(t, string(logConfig.Type), rdb.ScopedDB(ctx).Dialector.Name())
	t.Logf("budget webhook log backend: %s", logConfig.Type)
	plugin, err := logging.Init(ctx, &logging.Config{}, logger, logs, nil, nil, nil)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, plugin.Cleanup()) })
	return logs, plugin.GetPluginLogManager()
}

func requireBudgetWebhookReceipt(t *testing.T, received <-chan budgetWebhookReceipt, endpoint *tables.TableWebhookEndpoint, job tables.TableWebhookJob) []byte {
	t.Helper()
	select {
	case receipt := <-received:
		require.NoError(t, receipt.err)
		require.Equal(t, job.ID, receipt.header.Get("webhook-id"))
		require.Equal(t, string(job.Event), receipt.header.Get("X-Bifrost-Event"))
		require.Equal(t, "application/json", receipt.header.Get("Content-Type"))
		timestamp, err := strconv.ParseInt(receipt.header.Get("webhook-timestamp"), 10, 64)
		require.NoError(t, err)
		signature, err := webhooks.Sign(endpoint.Secret.GetValue(), job.ID, time.Unix(timestamp, 0), receipt.body)
		require.NoError(t, err)
		require.Equal(t, signature, receipt.header.Get("webhook-signature"))
		var envelope struct {
			Event     tables.WebhookEvent `json:"event"`
			CreatedAt time.Time           `json:"created_at"`
			Data      json.RawMessage     `json:"data"`
		}
		require.NoError(t, json.Unmarshal(receipt.body, &envelope))
		require.Equal(t, job.Event, envelope.Event)
		require.True(t, job.CreatedAt.Equal(envelope.CreatedAt))
		require.JSONEq(t, job.PayloadJSON, string(envelope.Data))
		return receipt.body
	case <-time.After(20 * time.Second):
		t.Fatal("budget webhook did not reach the HTTP receiver")
		return nil
	}
}

func TestBudgetWebhookMonitorPersistentRetryRecovery(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	logs, logManager := budgetWebhookLogSource(t)
	ctx := context.Background()
	logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	receiver, received := budgetWebhookReceiver(t)
	endpoint := &tables.TableWebhookEndpoint{
		Name: "budget-recovery", URL: receiver.URL, AllowPrivateNetwork: true,
		Events:                     []tables.WebhookEvent{tables.WebhookEventBudgetThresholdReached},
		RetryBackoffInitialSeconds: 1, RetryBackoffMaxSeconds: 1, AttemptTimeoutSeconds: 3,
	}
	require.NoError(t, endpoint.Validate())
	require.NoError(t, cs.CreateWebhookEndpoint(ctx, endpoint))
	project := &Project{Name: "Persistent webhook budget", DailyBudget: ptr(10.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{ProjectID: project.ID, Name: "Metered application"}
	require.NoError(t, store.CreateApplication(ctx, app))
	key, err := store.CreateApplicationKey(ctx, app.ID, "budget-source", "", nil, "admin")
	require.NoError(t, err)
	require.NoError(t, logs.Create(ctx, &logstore.Log{
		ID: uuid.NewString(), Timestamp: time.Now().UTC(), Object: "chat.completion",
		Provider: "openai", Model: "test-model", Status: "success",
		VirtualKeyID: ptr(key.VirtualKeyID), Cost: ptr(9.0),
	}))

	// The only trigger is the production startup sweep, not a panel read or direct alert insert.
	monitor := NewBudgetMonitor(ctx, NewHandler(store, logManager), logger)
	monitor.SetNotificationPublisher(handlers.NewNotificationService(cs, nil).PublishOnce)
	monitor.interval = time.Hour
	monitor.Start()
	t.Cleanup(monitor.Stop)
	require.Eventually(t, func() bool {
		var count int64
		return cs.DB().Model(&BudgetNotificationOutbox{}).
			Where("status = ?", BudgetNotificationDelivered).Count(&count).Error == nil && count == 1
	}, 20*time.Second, 20*time.Millisecond)
	monitor.Stop()
	var alert BudgetAlert
	require.NoError(t, cs.DB().First(&alert).Error)
	require.Equal(t, project.ID, alert.ScopeID)
	require.Equal(t, "project", alert.ScopeType)
	require.Equal(t, "daily", alert.Window)
	require.Equal(t, 0.8, alert.Threshold)
	require.Equal(t, 9.0, alert.Usage)
	require.Equal(t, 10.0, alert.Limit)
	var job tables.TableWebhookJob
	require.NoError(t, cs.DB().First(&job).Error)
	require.Equal(t, alert.ID, job.ResourceID)
	require.Empty(t, job.AsyncJobID)
	require.Equal(t, tables.WebhookEventBudgetThresholdReached, job.Event)
	expectedID := uuid.NewSHA1(uuid.NameSpaceURL, []byte("elygate:budget-webhook:"+alert.ID+":"+endpoint.ID)).String()
	require.Equal(t, expectedID, job.ID)
	var notification tables.TableNotification
	require.NoError(t, cs.DB().First(&notification).Error)
	require.Equal(t, string(schemas.NotificationAudienceAdmin), notification.Audience)

	// Reload the persisted endpoint just as a fresh process does; no mock queue or history store.
	newDispatcher := func(runnerID string) *webhooks.Dispatcher {
		persisted, err := cs.GetWebhookEndpointByID(ctx, endpoint.ID)
		require.NoError(t, err)
		resolver := &lib.Config{ConfigStore: cs, LogsStore: logs}
		resolver.SetWebhookEndpoint(persisted)
		dispatcher := webhooks.NewDispatcher(ctx, runnerID, 24*time.Hour, cs, logs, resolver, logger)
		t.Cleanup(dispatcher.Stop)
		dispatcher.Start()
		return dispatcher
	}
	first := newDispatcher("before-restart")
	firstBody := requireBudgetWebhookReceipt(t, received, endpoint, job)
	require.Eventually(t, func() bool {
		var retry tables.TableWebhookJob
		return cs.DB().First(&retry, "id = ?", job.ID).Error == nil &&
			retry.AttemptCount == 1 && retry.ClaimedUntil == nil
	}, 20*time.Second, 20*time.Millisecond)
	first.Stop()
	restarted := newDispatcher("after-restart")
	require.Equal(t, firstBody, requireBudgetWebhookReceipt(t, received, endpoint, job))
	require.Eventually(t, func() bool {
		var count int64
		return cs.DB().Model(&tables.TableWebhookJob{}).Count(&count).Error == nil && count == 0
	}, 20*time.Second, 20*time.Millisecond)
	restarted.Stop()
	history, err := logs.SearchWebhookDeliveries(ctx, &logstore.WebhookDeliverySearchFilters{DeliveryID: job.ID}, logstore.PaginationOptions{Limit: 10})
	require.NoError(t, err)
	require.Len(t, history.Deliveries, 2)
	for _, delivery := range history.Deliveries {
		require.Equal(t, job.ID, delivery.WebhookID)
		require.Equal(t, alert.ID, delivery.ResourceID)
		require.JSONEq(t, job.PayloadJSON, delivery.PayloadJSON)
		require.Empty(t, delivery.AsyncJobID)
		require.Empty(t, delivery.RequestID)
		if delivery.AttemptNo == 1 {
			require.Equal(t, logstore.WebhookDeliveryOutcomeRetryableFailure, delivery.Outcome)
			require.Equal(t, http.StatusServiceUnavailable, delivery.StatusCode)
		} else {
			require.Equal(t, 2, delivery.AttemptNo)
			require.Equal(t, logstore.WebhookDeliveryOutcomeDelivered, delivery.Outcome)
			require.Equal(t, http.StatusNoContent, delivery.StatusCode)
		}
	}
	monitor.sweep(ctx)
	for _, model := range []any{&BudgetAlert{}, &BudgetNotificationOutbox{}, &tables.TableNotification{}} {
		var count int64
		require.NoError(t, cs.DB().Model(model).Count(&count).Error)
		require.EqualValues(t, 1, count)
	}
	var queued int64
	require.NoError(t, cs.DB().Model(&tables.TableWebhookJob{}).Count(&queued).Error)
	require.Zero(t, queued, "a delivered threshold must not be re-enqueued by the next sweep")
}

func TestBudgetWebhookFanoutAtomicAndIdempotent(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	for _, endpoint := range []tables.TableWebhookEndpoint{
		{ID: uuid.NewString(), Name: "budget", URL: "https://example.com/budget", Events: []tables.WebhookEvent{tables.WebhookEventBudgetThresholdReached}},
		{ID: uuid.NewString(), Name: "mixed", URL: "https://example.com/mixed", Events: []tables.WebhookEvent{tables.WebhookEventAsyncJobCompleted, tables.WebhookEventBudgetThresholdReached}},
		{ID: uuid.NewString(), Name: "disabled", URL: "https://example.com/disabled", Disabled: true, Events: []tables.WebhookEvent{tables.WebhookEventBudgetThresholdReached}},
		{ID: uuid.NewString(), Name: "async", URL: "https://example.com/async", Events: []tables.WebhookEvent{tables.WebhookEventAsyncJobCompleted}},
	} {
		require.NoError(t, cs.CreateWebhookEndpoint(ctx, &endpoint))
	}
	notifications := seedBudgetNotifications(t, store, 10)
	require.Len(t, notifications, 2)
	var jobs []tables.TableWebhookJob
	require.NoError(t, cs.DB().Find(&jobs).Error)
	require.Len(t, jobs, 4)
	for _, job := range jobs {
		require.Empty(t, job.AsyncJobID, "a budget alert must never impersonate an inference job")
		require.Equal(t, tables.WebhookEventBudgetThresholdReached, job.Event)
		var alert BudgetAlert
		require.NoError(t, json.Unmarshal([]byte(job.PayloadJSON), &alert))
		require.Equal(t, job.ResourceID, alert.ID)
		require.Equal(t, 10.0, alert.Usage)
		require.Equal(t, 10.0, alert.Limit)
		require.Equal(t, schemas.NotificationAudienceAdmin, budgetNotificationInput(notifications[0]).Audience)
	}
	var alert BudgetAlert
	require.NoError(t, cs.DB().First(&alert).Error)
	require.NoError(t, cs.DB().Transaction(func(tx *gorm.DB) error {
		count, err := createBudgetAlerts(tx, BudgetStatus{ScopeType: alert.ScopeType, ScopeID: alert.ScopeID,
			Window: alert.Window, PeriodStart: alert.PeriodStart, Usage: alert.Usage, Limit: alert.Limit}, time.Now().UTC())
		require.Zero(t, count)
		return err
	}))
	var count int64
	require.NoError(t, cs.DB().Model(&tables.TableWebhookJob{}).Count(&count).Error)
	require.EqualValues(t, 4, count)
}

func TestBudgetWebhookFailureRollsBackAlertAndDashboardNotification(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	endpoint := &tables.TableWebhookEndpoint{Name: "budget", URL: "https://example.com/budget",
		Events: []tables.WebhookEvent{tables.WebhookEventBudgetThresholdReached}}
	require.NoError(t, cs.CreateWebhookEndpoint(ctx, endpoint))
	failure := errors.New("webhook queue unavailable")
	require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:budget_webhook_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == (tables.TableWebhookJob{}).TableName() {
			tx.AddError(failure)
		}
	}))
	t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:budget_webhook_failure") })
	err := cs.DB().Transaction(func(tx *gorm.DB) error {
		_, err := createBudgetAlerts(tx, BudgetStatus{ScopeType: "application", ScopeID: uuid.NewString(),
			Window: "monthly", PeriodStart: time.Now().UTC().Truncate(24 * time.Hour), Usage: 9, Limit: 10}, time.Now().UTC())
		return err
	})
	require.ErrorIs(t, err, failure)
	for _, model := range []any{&BudgetAlert{}, &BudgetNotificationOutbox{}, &tables.TableWebhookJob{}} {
		var count int64
		require.NoError(t, store.db(ctx).Model(model).Count(&count).Error)
		require.Zero(t, count)
	}
}

func TestBudgetWebhookFanoutAcrossBatches(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	subscribed := make(map[string]bool)
	for index := range 205 {
		endpoint := &tables.TableWebhookEndpoint{
			ID: fmt.Sprintf("%036d", index), Name: fmt.Sprintf("endpoint-%03d", index),
			URL:    "https://example.com/budget",
			Events: []tables.WebhookEvent{tables.WebhookEventAsyncJobCompleted},
		}
		if index%3 == 0 {
			endpoint.Events = []tables.WebhookEvent{tables.WebhookEventBudgetThresholdReached}
			subscribed[endpoint.ID] = true
		}
		require.NoError(t, cs.CreateWebhookEndpoint(ctx, endpoint))
	}
	require.Len(t, seedBudgetNotifications(t, store, 10), 2)
	var jobs []tables.TableWebhookJob
	require.NoError(t, cs.DB().Find(&jobs).Error)
	require.Len(t, jobs, 2*len(subscribed))
	counts := make(map[string]int)
	for _, job := range jobs {
		require.True(t, subscribed[job.EndpointID], "unsubscribed endpoint %s received a budget event", job.EndpointID)
		counts[job.EndpointID]++
	}
	for endpointID := range subscribed {
		require.Equal(t, 2, counts[endpointID])
	}
}

func TestBudgetWebhookLaterBatchFailureRollsBackFanout(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	for index := range 101 {
		endpoint := &tables.TableWebhookEndpoint{
			ID: fmt.Sprintf("%036d", index), Name: fmt.Sprintf("endpoint-%03d", index),
			URL: "https://example.com/budget", Events: []tables.WebhookEvent{tables.WebhookEventBudgetThresholdReached},
		}
		require.NoError(t, cs.CreateWebhookEndpoint(ctx, endpoint))
	}
	failure := errors.New("later batch queue unavailable")
	inserts := 0
	require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:later_budget_webhook_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == (tables.TableWebhookJob{}).TableName() {
			inserts++
			if inserts == 101 {
				tx.AddError(failure)
			}
		}
	}))
	t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:later_budget_webhook_failure") })
	err := cs.DB().Transaction(func(tx *gorm.DB) error {
		_, err := createBudgetAlerts(tx, BudgetStatus{ScopeType: "application", ScopeID: uuid.NewString(),
			Window: "monthly", PeriodStart: time.Now().UTC().Truncate(24 * time.Hour), Usage: 9, Limit: 10}, time.Now().UTC())
		return err
	})
	require.ErrorIs(t, err, failure)
	require.Equal(t, 101, inserts)
	for _, model := range []any{&BudgetAlert{}, &BudgetNotificationOutbox{}, &tables.TableWebhookJob{}} {
		var count int64
		require.NoError(t, store.db(ctx).Model(model).Count(&count).Error)
		require.Zero(t, count)
	}
}
