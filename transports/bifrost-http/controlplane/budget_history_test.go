package controlplane

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func budgetHistoryPeriods(t *testing.T, store *Store) []BudgetPeriodRecalculation {
	t.Helper()
	var periods []BudgetPeriodRecalculation
	require.NoError(t, store.db(context.Background()).Order("period_end, id").Find(&periods).Error)
	return periods
}

func clearBudgetHistoryPeriods(t *testing.T, store *Store) {
	t.Helper()
	require.NoError(t, store.db(context.Background()).Where("1 = 1").Delete(&BudgetPeriodRecalculation{}).Error)
}

func budgetHistoryApplication(t *testing.T, store *Store, at time.Time) (*Project, *Application) {
	t.Helper()
	ctx := context.Background()
	project := &Project{Name: "Historical project", DailyBudget: ptr(10.0), MonthlyBudget: ptr(20.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{ProjectID: project.ID, Name: "Historical app", DailyBudget: ptr(5.0), MonthlyBudget: ptr(10.0)}
	require.NoError(t, store.CreateApplication(ctx, app))
	require.NoError(t, store.db(ctx).Create(&ApplicationVirtualKeyBinding{
		ID: "history-binding", ApplicationID: app.ID, VirtualKeyID: "history-key",
		CreatedAt: at.Add(-time.Hour), UpdatedAt: at.Add(-time.Hour),
	}).Error)
	require.NoError(t, store.db(ctx).Model(&BudgetPolicyRevision{}).Where("1 = 1").Update("effective_at", at).Error)
	clearBudgetHistoryPeriods(t, store)
	return project, app
}

func historyUsageLog(at time.Time, cost float64) logstore.Log {
	return logstore.Log{ID: "history-log", Timestamp: at, VirtualKeyID: ptr("history-key"), Status: "success", Cost: &cost}
}

func TestBudgetHistoryPolicyCreationReplacementAndAuditAreAtomic(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Audited history", DailyBudget: ptr(10.0)}
	require.NoError(t, store.CreateProjectWithAudit(ctx, project, "admin"))
	app := &Application{ProjectID: project.ID, Name: "Audited app", MonthlyBudget: ptr(50.0)}
	require.NoError(t, store.CreateApplicationWithAudit(ctx, app, "admin"))
	for _, scope := range []BudgetScope{{"project", project.ID}, {"application", app.ID}} {
		require.NoError(t, store.SetBudgetLimits(ctx, scope, BudgetLimits{DailyBudget: ptr(25.0)}, "admin"))
		require.NoError(t, store.SetBudgetLimits(ctx, scope, BudgetLimits{}, "admin"))
		var revisions []BudgetPolicyRevision
		require.NoError(t, store.db(ctx).Where("scope_type = ? AND scope_id = ?", scope.Type, scope.ID).Order("id").Find(&revisions).Error)
		require.Len(t, revisions, 3)
		require.Equal(t, 25.0, *revisions[1].DailyBudget)
		require.Nil(t, revisions[1].MonthlyBudget)
		require.Nil(t, revisions[2].DailyBudget)
		require.Nil(t, revisions[2].MonthlyBudget)
		for _, revision := range revisions {
			require.Zero(t, revision.EffectiveAt.Nanosecond()%1000, "SQLite and PostgreSQL use the same microsecond precision")
		}
	}
	audits, err := store.ListAudit(ctx, 100)
	require.NoError(t, err)
	require.Len(t, audits, 6)
	periods := budgetHistoryPeriods(t, store)
	var revisionsBefore int64
	require.NoError(t, store.db(ctx).Model(&BudgetPolicyRevision{}).Count(&revisionsBefore).Error)
	db := store.db(ctx)
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:history_audit_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			tx.AddError(errors.New("history audit failure"))
		}
	}))
	t.Cleanup(func() { db.Callback().Create().Remove("test:history_audit_failure") })
	require.ErrorContains(t, store.SetBudgetLimits(ctx, BudgetScope{"project", project.ID}, BudgetLimits{DailyBudget: ptr(99.0)}, "admin"), "history audit failure")
	failedProject := &Project{Name: "Must roll back", DailyBudget: ptr(10.0)}
	require.ErrorContains(t, store.CreateProjectWithAudit(ctx, failedProject, "admin"), "history audit failure")
	failedApp := &Application{ProjectID: project.ID, Name: "Must roll back", DailyBudget: ptr(10.0)}
	require.ErrorContains(t, store.CreateApplicationWithAudit(ctx, failedApp, "admin"), "history audit failure")
	var revisionsAfter, projects, apps int64
	require.NoError(t, db.Model(&BudgetPolicyRevision{}).Count(&revisionsAfter).Error)
	require.NoError(t, db.Model(&Project{}).Count(&projects).Error)
	require.NoError(t, db.Model(&Application{}).Count(&apps).Error)
	require.Equal(t, revisionsBefore, revisionsAfter)
	require.EqualValues(t, 1, projects)
	require.EqualValues(t, 1, apps)
	persisted, err := store.GetProject(ctx, project.ID)
	require.NoError(t, err)
	require.Nil(t, persisted.DailyBudget)
	require.Equal(t, periods, budgetHistoryPeriods(t, store))
}

func TestBudgetHistoryCreationRollsBackWhenRevisionCannotPersist(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	parent := &Project{Name: "No budget"}
	require.NoError(t, store.CreateProject(ctx, parent))
	db := store.db(ctx)
	require.NoError(t, db.Migrator().DropTable(&BudgetPolicyRevision{}))
	failedProject := &Project{Name: "Failed policy", DailyBudget: ptr(10.0)}
	require.Error(t, store.CreateProject(ctx, failedProject))
	failedApp := &Application{ProjectID: parent.ID, Name: "Failed policy", DailyBudget: ptr(10.0)}
	require.Error(t, store.CreateApplication(ctx, failedApp))
	var projects, apps int64
	require.NoError(t, db.Model(&Project{}).Count(&projects).Error)
	require.NoError(t, db.Model(&Application{}).Count(&apps).Error)
	require.EqualValues(t, 1, projects)
	require.Zero(t, apps)
}

func TestBudgetHistorySelectsFinalPolicyBeforeCloseIncludingClearing(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 0, 1)
	// Cases: no known policy / late policy / end-exclusive / clear / same-microsecond ties / window-specific clearing.
	for _, tc := range []struct {
		name      string
		revisions []BudgetPolicyRevision
		limit     *float64
	}{
		{name: "unknown"},
		{name: "after-close", revisions: []BudgetPolicyRevision{{EffectiveAt: end, BudgetLimits: BudgetLimits{DailyBudget: ptr(1.0)}}}},
		{name: "before-close", revisions: []BudgetPolicyRevision{
			{EffectiveAt: start, BudgetLimits: BudgetLimits{DailyBudget: ptr(10.0)}},
			{EffectiveAt: end.Add(-time.Microsecond), BudgetLimits: BudgetLimits{DailyBudget: ptr(5.0)}},
			{EffectiveAt: end, BudgetLimits: BudgetLimits{DailyBudget: ptr(1.0)}},
		}, limit: ptr(5.0)},
		{name: "clear-before-close", revisions: []BudgetPolicyRevision{
			{EffectiveAt: start, BudgetLimits: BudgetLimits{DailyBudget: ptr(10.0)}},
			{EffectiveAt: end.Add(-time.Microsecond)},
		}},
		{name: "clear-after-close", revisions: []BudgetPolicyRevision{
			{EffectiveAt: start, BudgetLimits: BudgetLimits{DailyBudget: ptr(10.0)}}, {EffectiveAt: end},
		}, limit: ptr(10.0)},
		{name: "same-time-clear", revisions: []BudgetPolicyRevision{
			{EffectiveAt: start, BudgetLimits: BudgetLimits{DailyBudget: ptr(10.0)}}, {EffectiveAt: start},
		}},
		{name: "same-time-set", revisions: []BudgetPolicyRevision{
			{EffectiveAt: start}, {EffectiveAt: start, BudgetLimits: BudgetLimits{DailyBudget: ptr(12.0)}},
		}, limit: ptr(12.0)},
		{name: "other-window-only", revisions: []BudgetPolicyRevision{
			{EffectiveAt: start, BudgetLimits: BudgetLimits{DailyBudget: ptr(10.0)}},
			{EffectiveAt: start.Add(time.Hour), BudgetLimits: BudgetLimits{MonthlyBudget: ptr(20.0)}},
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, revision := range tc.revisions {
				revision.ScopeType, revision.ScopeID = "project", tc.name
				require.NoError(t, store.db(ctx).Create(&revision).Error)
			}
			status, err := store.closedBudgetStatus(ctx, BudgetPeriodRecalculation{
				ScopeType: "project", ScopeID: tc.name, Window: "daily", PeriodStart: start, PeriodEnd: end,
			})
			require.NoError(t, err)
			if tc.limit == nil {
				require.Nil(t, status)
			} else {
				require.NotNil(t, status)
				require.Equal(t, *tc.limit, status.Limit)
				require.True(t, start.Equal(status.PeriodStart))
				require.True(t, end.Equal(status.PeriodEnd))
			}
		})
	}
}

func TestBudgetHistoryProjectionQueuesRepricingAndOldNewCalendarPeriods(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	project, app := budgetHistoryApplication(t, store, start)
	log := historyUsageLog(time.Date(2026, 1, 31, 23, 59, 0, 0, time.UTC), 1)
	_, err := store.ProjectLogs(ctx, []logstore.Log{log})
	require.NoError(t, err)
	require.Len(t, budgetHistoryPeriods(t, store), 4, "a new row marks project/application day/month")
	clearBudgetHistoryPeriods(t, store)
	log.Cost = ptr(20.0)
	require.NoError(t, store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{log}}))
	require.Len(t, budgetHistoryPeriods(t, store), 4, "repricing alone must mark the original periods")
	clearBudgetHistoryPeriods(t, store)
	log.Timestamp = time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	log.VirtualKeyID = nil
	require.NoError(t, store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{log}}))
	periods := budgetHistoryPeriods(t, store)
	require.Len(t, periods, 8, "moving across a month marks both old and new days and months")
	for _, scope := range []BudgetScope{{"project", project.ID}, {"application", app.ID}} {
		for _, at := range []time.Time{start.AddDate(0, 0, 30), start.AddDate(0, 1, 0)} {
			for _, expected := range budgetPeriods(budgetScope{BudgetScope: scope, Limits: BudgetLimits{ptr(1.0), ptr(1.0)}}, at) {
				require.Condition(t, func() bool {
					for _, period := range periods {
						if period.ScopeType == scope.Type && period.ScopeID == scope.ID && period.Window == expected.Window &&
							period.PeriodStart.Equal(expected.PeriodStart) && period.PeriodEnd.Equal(expected.PeriodEnd) {
							return true
						}
					}
					return false
				}, "missing period: %+v", expected)
			}
		}
	}
	rows, _, err := store.ListUsage(ctx, UsageQuery{})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, project.ID, rows[0].ProjectID)
	require.Equal(t, app.ID, rows[0].ApplicationID, "timestamp/key corrections retain original ownership")
	require.Equal(t, 20.0, rows[0].Cost)
	clearBudgetHistoryPeriods(t, store)
	log.Model = "metadata-only"
	require.NoError(t, store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{log}}))
	require.Empty(t, budgetHistoryPeriods(t, store), "metadata changes do not change budget usage")
	require.NoError(t, store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{log}}))
	require.Empty(t, budgetHistoryPeriods(t, store), "an identical snapshot does not create work")
}

func TestBudgetHistoryBothSnapshotDeletionPathsMarkOriginalPeriods(t *testing.T) {
	for _, status := range []string{"success", "processing"} {
		t.Run(status, func(t *testing.T) {
			store, _ := testControlPlaneStore(t)
			ctx := context.Background()
			start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
			budgetHistoryApplication(t, store, start)
			_, err := store.ProjectLogs(ctx, []logstore.Log{historyUsageLog(start.Add(time.Hour), 10)})
			require.NoError(t, err)
			require.NoError(t, store.db(ctx).Model(&UsageLedgerEntry{}).Where("source_log_id = ?", "history-log").Update("status", status).Error)
			clearBudgetHistoryPeriods(t, store)
			require.NoError(t, store.ReconcileUsage(ctx, partialUsageReader{}))
			require.Empty(t, budgetHistoryPeriods(t, store), "a partial snapshot cannot delete rows")
			require.NoError(t, store.ReconcileUsage(ctx, completeSnapshotReader{}))
			require.Len(t, budgetHistoryPeriods(t, store), 4)
			_, total, err := store.ListUsage(ctx, UsageQuery{})
			require.NoError(t, err)
			require.Zero(t, total)
		})
	}
}

func TestBudgetHistoryQueueFailureRollsBackLedgerMutation(t *testing.T) {
	for _, mutation := range []string{"insert", "correction", "stale-delete", "processing-delete"} {
		t.Run(mutation, func(t *testing.T) {
			store, _ := testControlPlaneStore(t)
			ctx := context.Background()
			start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
			budgetHistoryApplication(t, store, start)
			log := historyUsageLog(start.Add(time.Hour), 1)
			if mutation != "insert" {
				_, err := store.ProjectLogs(ctx, []logstore.Log{log})
				require.NoError(t, err)
			}
			if mutation == "processing-delete" {
				require.NoError(t, store.db(ctx).Model(&UsageLedgerEntry{}).Where("source_log_id = ?", log.ID).Update("status", "processing").Error)
			}
			before, _, err := store.ListUsage(ctx, UsageQuery{})
			require.NoError(t, err)
			checkpoint, err := store.Checkpoint(ctx)
			require.NoError(t, err)
			clearBudgetHistoryPeriods(t, store)
			db, attempts := store.db(ctx), 0
			require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:history_queue_failure", func(tx *gorm.DB) {
				if tx.Statement.Table == (BudgetPeriodRecalculation{}).TableName() {
					attempts++
					if attempts == 2 {
						tx.AddError(errors.New("period queue failure"))
					}
				}
			}))
			t.Cleanup(func() { db.Callback().Create().Remove("test:history_queue_failure") })
			switch mutation {
			case "insert":
				_, err = store.ProjectLogs(ctx, []logstore.Log{log})
			case "correction":
				log.Timestamp, log.Cost = start.AddDate(0, 1, 0), ptr(20.0)
				err = store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{log}})
			default:
				err = store.ReconcileUsage(ctx, completeSnapshotReader{})
			}
			require.ErrorContains(t, err, "period queue failure")
			after, _, err := store.ListUsage(ctx, UsageQuery{})
			require.NoError(t, err)
			require.Equal(t, before, after)
			persistedCheckpoint, err := store.Checkpoint(ctx)
			require.NoError(t, err)
			require.Equal(t, checkpoint, persistedCheckpoint)
			require.Empty(t, budgetHistoryPeriods(t, store), "even the first successfully queued period rolls back")
		})
	}
}

func TestBudgetHistoryOpenPeriodsSurviveRestartAndCloseAtUTCBoundary(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	budgetHistoryApplication(t, store, start)
	log := historyUsageLog(time.Date(2026, 1, 31, 23, 0, 0, 0, time.UTC), 8)
	_, err := store.ProjectLogs(ctx, []logstore.Log{log})
	require.NoError(t, err)
	count, err := store.EvaluateBudgetAlerts(ctx, log.Timestamp)
	require.NoError(t, err)
	require.EqualValues(t, 4, count)
	pending := budgetHistoryPeriods(t, store)
	require.Len(t, pending, 4)
	restarted, err := NewStore(ctx, cs)
	require.NoError(t, err)
	require.Equal(t, pending, budgetHistoryPeriods(t, restarted))
	closeAt := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	count, err = restarted.EvaluateBudgetAlerts(ctx, closeAt.Add(-time.Microsecond))
	require.NoError(t, err)
	require.Zero(t, count)
	require.Len(t, budgetHistoryPeriods(t, restarted), 4)
	count, err = restarted.EvaluateBudgetAlerts(ctx, closeAt.In(time.FixedZone("UTC+8", 8*3600)))
	require.NoError(t, err)
	require.Zero(t, count, "closing periods must not duplicate already-observed thresholds")
	require.Empty(t, budgetHistoryPeriods(t, restarted))
}

func TestBudgetHistoryLateSettlementAfterClearingPreservesFirstAlertPayload(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	project, app := budgetHistoryApplication(t, store, start)
	log := historyUsageLog(time.Date(2026, 1, 31, 12, 0, 0, 0, time.UTC), 8)
	_, err := store.ProjectLogs(ctx, []logstore.Log{log})
	require.NoError(t, err)
	_, err = store.EvaluateBudgetAlerts(ctx, log.Timestamp)
	require.NoError(t, err)
	firstAlerts, err := store.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	firstDeliveries := budgetNotificationRows(t, store)
	require.Len(t, firstAlerts, 4)
	for _, scope := range []BudgetScope{{"project", project.ID}, {"application", app.ID}} {
		require.NoError(t, store.SetBudgetLimits(ctx, scope, BudgetLimits{}, "admin"))
	}
	log.Cost = ptr(20.0)
	require.NoError(t, store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{log}}))
	closedAt := time.Date(2026, 2, 2, 0, 0, 0, 0, time.UTC)
	count, err := store.EvaluateBudgetAlerts(ctx, closedAt)
	require.NoError(t, err)
	require.EqualValues(t, 4, count, "only newly crossed thresholds create alerts under the historical limits")
	alerts, err := store.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	require.Len(t, alerts, 8)
	for _, first := range firstAlerts {
		require.Contains(t, alerts, first)
	}
	deliveries := budgetNotificationRows(t, store)
	require.Len(t, deliveries, 8)
	for _, first := range firstDeliveries {
		require.Contains(t, deliveries, first)
	}
	log.Cost = ptr(1.0)
	require.NoError(t, store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{log}}))
	count, err = store.EvaluateBudgetAlerts(ctx, closedAt)
	require.NoError(t, err)
	require.Zero(t, count)
	persisted, err := store.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	require.Equal(t, alerts, persisted, "downward corrections neither retract nor rewrite threshold facts")
	require.Equal(t, deliveries, budgetNotificationRows(t, store))
}

func TestBudgetHistoryClosedEvaluationFailureRetainsQueueAndRollsBackAlerts(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	budgetHistoryApplication(t, store, start)
	_, err := store.ProjectLogs(ctx, []logstore.Log{historyUsageLog(start.Add(time.Hour), 20)})
	require.NoError(t, err)
	pending := budgetHistoryPeriods(t, store)
	db, attempts := store.db(ctx), 0
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:history_outbox_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == (BudgetNotificationOutbox{}).TableName() {
			attempts++
			if attempts == 3 {
				tx.AddError(errors.New("historical notification failure"))
			}
		}
	}))
	t.Cleanup(func() { db.Callback().Create().Remove("test:history_outbox_failure") })
	count, err := store.EvaluateBudgetAlerts(ctx, start.AddDate(0, 1, 0))
	require.ErrorContains(t, err, "historical notification failure")
	require.Zero(t, count)
	require.Equal(t, pending, budgetHistoryPeriods(t, store), "previously consumed periods must also roll back")
	alerts, err := store.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	require.Empty(t, alerts)
	require.Empty(t, budgetNotificationRows(t, store))
}

func TestBudgetHistoryBacklogIsBoundedRestartableAndSerialized(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	scope := budgetScope{BudgetScope: BudgetScope{"project", "backlog"}, Limits: BudgetLimits{DailyBudget: ptr(10.0)}}
	require.NoError(t, store.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := appendBudgetPolicyRevision(tx, scope, start); err != nil {
			return err
		}
		for i := range budgetRecalculationBatchSize + 1 {
			at := start.AddDate(0, 0, i)
			if err := tx.Create(&UsageLedgerEntry{ID: fmt.Sprintf("backlog-%d", i), SourceLogID: fmt.Sprintf("backlog-%d", i),
				ProjectID: scope.ID, OccurredAt: at, Cost: 10}).Error; err != nil {
				return err
			}
			if err := queueBudgetPolicyPeriods(tx, scope.BudgetScope, at); err != nil {
				return err
			}
		}
		return nil
	}))
	require.Len(t, budgetHistoryPeriods(t, store), budgetRecalculationBatchSize+1)
	now := start.AddDate(0, 0, budgetRecalculationBatchSize+10)
	count, err := store.EvaluateBudgetAlerts(ctx, now)
	require.NoError(t, err)
	require.EqualValues(t, budgetRecalculationBatchSize*2, count)
	require.Len(t, budgetHistoryPeriods(t, store), 1)
	restarted, err := NewStore(ctx, cs)
	require.NoError(t, err)
	var workers sync.WaitGroup
	failures := make(chan error, 4)
	for range 4 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			_, err := restarted.EvaluateBudgetAlerts(ctx, now)
			failures <- err
		}()
	}
	workers.Wait()
	close(failures)
	for err := range failures {
		require.NoError(t, err)
	}
	require.Empty(t, budgetHistoryPeriods(t, restarted))
	alerts, err := restarted.ListBudgetAlerts(ctx, BudgetAlertQuery{Limit: 1000})
	require.NoError(t, err)
	require.Len(t, alerts, (budgetRecalculationBatchSize+1)*2)
	require.Len(t, budgetNotificationRows(t, restarted), len(alerts))
}

func TestBudgetHistoryMonitorUsesNonemptyHistoryAfterCurrentLimitsClear(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "No configured budget"}
	require.NoError(t, store.CreateProject(ctx, project))
	reader := &countingUsageReader{}
	h := NewHandler(store, &snapshotLogManager{UsageLogReader: reader})
	require.NoError(t, store.SetBudgetLimits(ctx, BudgetScope{"project", project.ID}, BudgetLimits{}, "admin"))
	require.NoError(t, h.refreshBudgetAlerts(ctx))
	require.Zero(t, reader.calls.Load(), "empty-only policy history is not configured history")
	require.NoError(t, store.SetBudgetLimits(ctx, BudgetScope{"project", project.ID}, BudgetLimits{DailyBudget: ptr(10.0)}, "admin"))
	require.NoError(t, store.SetBudgetLimits(ctx, BudgetScope{"project", project.ID}, BudgetLimits{}, "admin"))
	configured, err := store.HasUsageBudgets(ctx)
	require.NoError(t, err)
	require.False(t, configured)
	require.NoError(t, h.refreshBudgetAlerts(ctx))
	require.EqualValues(t, 1, reader.calls.Load(), "clearing current budgets must not stop late-settlement discovery")
}

func TestBudgetHistoryMonitorDiscoversLateSettlementWithClearedBudgetsAfterRestart(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	project, app := budgetHistoryApplication(t, store, start)
	for _, scope := range []BudgetScope{{"project", project.ID}, {"application", app.ID}} {
		require.NoError(t, store.SetBudgetLimits(ctx, scope, BudgetLimits{}, "admin"))
	}
	restarted, err := NewStore(ctx, cs)
	require.NoError(t, err)
	reader := &observedBudgetReader{
		logs: []logstore.Log{historyUsageLog(start.Add(time.Hour), 20)}, started: make(chan struct{}, 1),
	}
	h := NewHandler(restarted, &snapshotLogManager{UsageLogReader: reader})
	require.NoError(t, h.refreshBudgetAlerts(ctx))
	require.EqualValues(t, 1, reader.calls.Load())
	alerts, err := restarted.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	require.Len(t, alerts, 8, "the source scan and closed-period evaluation both run with no current budgets")
	require.Len(t, budgetNotificationRows(t, restarted), 8)
	require.NoError(t, h.refreshBudgetAlerts(ctx))
	alerts, err = restarted.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	require.Len(t, alerts, 8)
	require.Len(t, budgetNotificationRows(t, restarted), 8)
}

func TestBudgetHistoryMigrationSeedsOnlyKnownPoliciesWithoutInventingEarlierVersions(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Before history", DailyBudget: ptr(10.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{ProjectID: project.ID, Name: "Before history", MonthlyBudget: ptr(20.0)}
	require.NoError(t, store.CreateApplication(ctx, app))
	require.NoError(t, store.CreateProject(ctx, &Project{Name: "Never budgeted"}))
	db := store.db(ctx)
	require.NoError(t, db.Migrator().DropTable(&BudgetPolicyRevision{}, &BudgetPeriodRecalculation{}))
	require.NoError(t, db.Exec("DELETE FROM migrations WHERE id = ?", "elygate_control_plane_v7_budget_policy_history").Error)
	before := time.Now().UTC().Truncate(time.Microsecond)
	upgraded, err := NewStore(ctx, cs)
	require.NoError(t, err)
	var revisions []BudgetPolicyRevision
	require.NoError(t, upgraded.db(ctx).Order("id").Find(&revisions).Error)
	require.Len(t, revisions, 2)
	for _, revision := range revisions {
		require.False(t, revision.EffectiveAt.Before(before))
		require.True(t, revision.ScopeID == project.ID || revision.ScopeID == app.ID)
		status, err := upgraded.closedBudgetStatus(ctx, BudgetPeriodRecalculation{
			ScopeType: revision.ScopeType, ScopeID: revision.ScopeID, Window: "daily",
			PeriodStart: before.AddDate(0, 0, -2), PeriodEnd: before.AddDate(0, 0, -1),
		})
		require.NoError(t, err)
		require.Nil(t, status, "migration cannot infer a policy for an earlier closed period")
	}
	require.Len(t, budgetHistoryPeriods(t, upgraded), 2)
	_, err = NewStore(ctx, cs)
	require.NoError(t, err)
	var count int64
	require.NoError(t, upgraded.db(ctx).Model(&BudgetPolicyRevision{}).Count(&count).Error)
	require.EqualValues(t, 2, count)
	require.Len(t, budgetHistoryPeriods(t, upgraded), 2)
}
