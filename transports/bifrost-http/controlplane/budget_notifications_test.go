package controlplane

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func seedBudgetNotifications(t *testing.T, store *Store, usage float64) []BudgetNotificationOutbox {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Microsecond)
	status := BudgetStatus{ScopeType: "project", ScopeID: uuid.NewString(),
		Window: "daily", PeriodStart: now.Truncate(24 * time.Hour), Usage: usage, Limit: 10}
	require.NoError(t, store.db(context.Background()).Transaction(func(tx *gorm.DB) error {
		_, err := createBudgetAlerts(tx, status, now)
		return err
	}))
	return budgetNotificationRows(t, store)
}

func budgetNotificationRows(t *testing.T, store *Store) []BudgetNotificationOutbox {
	t.Helper()
	var rows []BudgetNotificationOutbox
	require.NoError(t, store.db(context.Background()).Order("id").Find(&rows).Error)
	return rows
}

func TestBudgetNotificationOutboxAtomicAndIdempotent(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	project := &Project{Name: "Atomic notification", DailyBudget: ptr(10.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	require.NoError(t, store.db(ctx).Create(&UsageLedgerEntry{ID: "outbox-usage", SourceLogID: "outbox-usage",
		ProjectID: project.ID, OccurredAt: now, Cost: 10}).Error)
	for _, expected := range []int64{2, 0} {
		count, err := store.EvaluateBudgetAlerts(ctx, now)
		require.NoError(t, err)
		require.Equal(t, expected, count)
	}
	rows := budgetNotificationRows(t, store)
	require.Len(t, rows, 2)
	for _, row := range rows {
		require.Equal(t, BudgetNotificationPending, row.Status)
		require.Equal(t, project.ID, row.ScopeID)
		require.Equal(t, 10.0, row.Usage)
		require.Zero(t, row.Attempts)
		require.NoError(t, uuid.Validate(row.ID))
	}
	require.NoError(t, backfillBudgetNotifications(store.db(ctx)))
	require.Len(t, budgetNotificationRows(t, store), 2)
	require.NoError(t, store.db(ctx).Migrator().DropTable(&BudgetNotificationOutbox{}))
	require.NoError(t, store.db(ctx).Model(&Project{}).Where("id = ?", project.ID).Update("monthly_budget", 10).Error)
	_, err := store.EvaluateBudgetAlerts(ctx, now)
	require.Error(t, err)
	alerts, err := store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.Len(t, alerts, 2, "new monthly alerts roll back with their failed enqueue")
}

func TestBudgetNotificationRetryAndRestartUseRealPublisher(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	seedBudgetNotifications(t, store, 10)
	publisher := handlers.NewNotificationService(cs, nil)
	monitor := NewBudgetMonitor(ctx, NewHandler(store, nil), nil)
	failed := false
	monitor.SetNotificationPublisher(func(ctx context.Context, id string, input schemas.NotificationInput) (*schemas.Notification, error) {
		if !failed {
			failed = true
			return nil, errors.New("temporary storage failure")
		}
		return publisher.PublishOnce(ctx, id, input)
	})
	started := time.Now().UTC()
	require.ErrorContains(t, monitor.deliverBudgetNotifications(ctx), "temporary storage failure")
	var pendingID string
	for _, row := range budgetNotificationRows(t, store) {
		require.Equal(t, 1, row.Attempts)
		require.Empty(t, row.ClaimedBy)
		require.Nil(t, row.ClaimedUntil)
		if row.Status == BudgetNotificationPending {
			pendingID = row.ID
			require.Equal(t, "notification publishing failed", row.LastError)
			require.False(t, row.NextAttemptAt.Before(started.Add(time.Minute)))
		} else {
			require.Equal(t, BudgetNotificationDelivered, row.Status)
		}
	}
	require.NotEmpty(t, pendingID)
	require.NoError(t, monitor.deliverBudgetNotifications(ctx), "future retries are not attempted early")
	restarted, err := NewStore(ctx, cs)
	require.NoError(t, err)
	require.NoError(t, restarted.db(ctx).Model(&BudgetNotificationOutbox{}).Where("id = ?", pendingID).
		Update("next_attempt_at", time.Now().UTC().Add(-time.Second)).Error)
	recovered := NewBudgetMonitor(ctx, NewHandler(restarted, nil), nil)
	recovered.SetNotificationPublisher(publisher.PublishOnce)
	require.NoError(t, recovered.deliverBudgetNotifications(ctx))
	require.NoError(t, recovered.deliverBudgetNotifications(ctx))
	for _, row := range budgetNotificationRows(t, restarted) {
		require.Equal(t, BudgetNotificationDelivered, row.Status)
		require.Empty(t, row.LastError)
	}
	var notifications []configtables.TableNotification
	require.NoError(t, restarted.db(ctx).Find(&notifications).Error)
	require.Len(t, notifications, 2)
	for _, notification := range notifications {
		require.Equal(t, string(schemas.NotificationAudienceAdmin), notification.Audience)
		require.Empty(t, notification.RoleIDs)
		require.Contains(t, notification.Message, "USD 10")
		require.Equal(t, "/#/control-plane-projects", notification.ActionPath)
	}
}

func TestBudgetNotificationCrashAfterPublishDoesNotDuplicate(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	rows := seedBudgetNotifications(t, store, 8)
	require.Len(t, rows, 1)
	publisher := handlers.NewNotificationService(cs, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	monitor := NewBudgetMonitor(context.Background(), NewHandler(store, nil), nil)
	var original *schemas.Notification
	monitor.SetNotificationPublisher(func(ctx context.Context, id string, input schemas.NotificationInput) (*schemas.Notification, error) {
		notification, err := publisher.PublishOnce(ctx, id, input)
		original = notification
		cancel() // Simulate shutdown between the committed notification and outbox acknowledgement.
		return notification, err
	})
	require.ErrorIs(t, monitor.deliverBudgetNotifications(ctx), context.Canceled)
	require.NotNil(t, original)
	pending := budgetNotificationRows(t, store)
	require.Equal(t, BudgetNotificationPending, pending[0].Status)
	require.NotNil(t, pending[0].ClaimedUntil)
	notificationsStore := cs.(configstore.NotificationStore)
	deleted, err := notificationsStore.DeleteExpiredNotifications(context.Background(), original.ExpiresAt.Add(time.Hour))
	require.NoError(t, err)
	require.Zero(t, deleted, "startup retention cleanup must not erase an unacknowledged publish receipt")
	claimed, err := store.claimBudgetNotification(context.Background(), rows[0].ID, time.Now().UTC())
	require.NoError(t, err)
	require.Nil(t, claimed, "live lease prevents immediate concurrent replay")
	require.NoError(t, store.db(context.Background()).Model(&BudgetNotificationOutbox{}).
		Where("id = ?", rows[0].ID).Update("claimed_until", time.Now().UTC().Add(-time.Second)).Error)
	restarted, err := NewStore(context.Background(), cs)
	require.NoError(t, err)
	recovered := NewBudgetMonitor(context.Background(), NewHandler(restarted, nil), nil)
	recovered.SetNotificationPublisher(publisher.PublishOnce)
	require.NoError(t, recovered.deliverBudgetNotifications(context.Background()))
	var notifications []configtables.TableNotification
	require.NoError(t, restarted.db(context.Background()).Find(&notifications).Error)
	require.Len(t, notifications, 1)
	require.Equal(t, original.ID, notifications[0].ID)
	require.True(t, original.CreatedAt.Equal(notifications[0].CreatedAt))
	require.True(t, original.ExpiresAt.Equal(notifications[0].ExpiresAt))
	finished := budgetNotificationRows(t, restarted)[0]
	require.Equal(t, BudgetNotificationDelivered, finished.Status)
	require.Equal(t, 2, finished.Attempts)
}

func TestBudgetNotificationConcurrentClaimsAndFencing(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	rows := seedBudgetNotifications(t, store, 8)
	now := time.Now().UTC()
	var workers sync.WaitGroup
	claims := make(chan *BudgetNotificationOutbox, 4)
	failures := make(chan error, 4)
	for range 4 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			claim, err := store.claimBudgetNotification(ctx, rows[0].ID, now)
			claims <- claim
			failures <- err
		}()
	}
	workers.Wait()
	close(claims)
	close(failures)
	for err := range failures {
		require.NoError(t, err)
	}
	var winner *BudgetNotificationOutbox
	for claim := range claims {
		if claim != nil {
			require.Nil(t, winner, "exactly one worker owns a live claim")
			winner = claim
		}
	}
	require.NotNil(t, winner)
	reclaimed, err := store.claimBudgetNotification(ctx, rows[0].ID, now.Add(2*time.Minute))
	require.NoError(t, err)
	require.NotNil(t, reclaimed)
	require.NotEqual(t, winner.ClaimedBy, reclaimed.ClaimedBy)
	require.ErrorIs(t, store.finishBudgetNotification(ctx, winner, nil, now), errBudgetNotificationClaimLost)
	require.NoError(t, store.finishBudgetNotification(ctx, reclaimed, errors.New("retry"), now.Add(2*time.Minute)))
	require.Equal(t, 2, reclaimed.Attempts)
	claim, err := store.claimBudgetNotification(ctx, rows[0].ID, now.Add(3*time.Minute))
	require.NoError(t, err)
	require.Nil(t, claim, "second failure backs off for two minutes")
	claim, err = store.claimBudgetNotification(ctx, rows[0].ID, now.Add(4*time.Minute))
	require.NoError(t, err)
	require.NotNil(t, claim, "due boundary is inclusive")
	require.NoError(t, store.finishBudgetNotification(ctx, claim, nil, now.Add(4*time.Minute)))
	require.ErrorIs(t, store.finishBudgetNotification(ctx, claim, errors.New("stale"), now), errBudgetNotificationClaimLost)
}

func TestBudgetNotificationMigrationAndBoundedBacklog(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	// Cases: empty / multiple batches / replay / due time with a non-UTC input.
	due, err := store.dueBudgetNotifications(ctx, now)
	require.NoError(t, err)
	require.Empty(t, due)
	alerts := make([]BudgetAlert, 103)
	for i := range alerts {
		alerts[i] = BudgetAlert{ID: uuid.NewString(), ScopeType: "application", ScopeID: fmt.Sprintf("app-%d", i),
			Window: "monthly", PeriodStart: now.Truncate(24 * time.Hour), Threshold: 1, Usage: 2, Limit: 1, TriggeredAt: now}
	}
	require.NoError(t, store.db(ctx).Create(&alerts).Error)
	require.NoError(t, store.db(ctx).Migrator().DropTable(&BudgetNotificationOutbox{}))
	require.NoError(t, store.db(ctx).Exec("DELETE FROM migrations WHERE id = ?", "elygate_control_plane_v6_budget_notification_outbox").Error)
	upgraded, err := NewStore(ctx, cs)
	require.NoError(t, err)
	require.Len(t, budgetNotificationRows(t, upgraded), 103)
	require.NoError(t, backfillBudgetNotifications(upgraded.db(ctx)))
	require.Len(t, budgetNotificationRows(t, upgraded), 103)
	_, err = NewStore(ctx, cs)
	require.NoError(t, err)
	due, err = upgraded.dueBudgetNotifications(ctx, now.In(time.FixedZone("offset", 8*60*60)))
	require.NoError(t, err)
	require.Len(t, due, budgetNotificationBatchSize)
	for _, delivery := range due {
		require.Equal(t, "application", delivery.ScopeType)
		require.Equal(t, "monthly", delivery.Window)
		require.Equal(t, 1.0, delivery.Threshold)
		require.Equal(t, 2.0, delivery.Usage)
	}
}

func TestBudgetNotificationMonitorDeliversWithoutFreshUsageOrBudgets(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Offline log source", DailyBudget: ptr(1.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	seedBudgetNotifications(t, store, 8)
	monitor := NewBudgetMonitor(ctx, NewHandler(store, nil), nil)
	require.ErrorContains(t, monitor.deliverBudgetNotifications(ctx), "publisher is unavailable")
	require.Zero(t, budgetNotificationRows(t, store)[0].Attempts)
	monitor.SetNotificationPublisher(handlers.NewNotificationService(cs, nil).PublishOnce)
	monitor.sweep(ctx)
	require.Equal(t, BudgetNotificationDelivered, budgetNotificationRows(t, store)[0].Status)
	require.NoError(t, store.SetBudgetLimits(ctx, BudgetScope{"project", project.ID}, BudgetLimits{}, "admin"))
	seedBudgetNotifications(t, store, 8)
	monitor.sweep(ctx)
	for _, delivery := range budgetNotificationRows(t, store) {
		require.Equal(t, BudgetNotificationDelivered, delivery.Status)
	}
}

func TestBudgetNotificationReceiptAndRetryBoundaries(t *testing.T) {
	for _, tc := range []struct {
		attempt int
		delay   time.Duration
	}{{0, time.Minute}, {1, time.Minute}, {2, 2 * time.Minute}, {6, 32 * time.Minute}, {7, time.Hour}, {1000, time.Hour}} {
		require.Equal(t, tc.delay, budgetNotificationRetryDelay(tc.attempt))
	}
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	rows := seedBudgetNotifications(t, store, 8)
	monitor := NewBudgetMonitor(ctx, NewHandler(store, nil), nil)
	monitor.SetNotificationPublisher(func(context.Context, string, schemas.NotificationInput) (*schemas.Notification, error) {
		return nil, nil
	})
	require.ErrorContains(t, monitor.deliverBudgetNotifications(ctx), "matching receipt")
	delivery := budgetNotificationRows(t, store)[0]
	require.Equal(t, BudgetNotificationPending, delivery.Status)
	require.Equal(t, rows[0].ID, delivery.ID)
	require.NoError(t, store.db(ctx).Model(&BudgetNotificationOutbox{}).Where("id = ?", delivery.ID).
		Update("next_attempt_at", time.Now().UTC().Add(-time.Second)).Error)
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	require.ErrorIs(t, monitor.deliverBudgetNotifications(canceled), context.Canceled)
	for _, threshold := range []float64{0.8, 1} {
		delivery.Threshold = threshold
		input := budgetNotificationInput(delivery)
		require.Equal(t, schemas.NotificationAudienceAdmin, input.Audience)
		if threshold == 1 {
			require.Equal(t, schemas.NotificationSeverityError, input.Severity)
		} else {
			require.Equal(t, schemas.NotificationSeverityWarning, input.Severity)
		}
	}
}
