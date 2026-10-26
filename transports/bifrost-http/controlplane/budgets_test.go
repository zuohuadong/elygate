package controlplane

import (
	"context"
	"errors"
	"math"
	"sync"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestBudgetAlertsUseUTCCalendarWindowsAndDeduplicate(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	daily, monthly, applicationDaily := 10.0, 20.0, 5.0
	project := &Project{Name: "Budgeted project", DailyBudget: &daily, MonthlyBudget: &monthly}
	require.NoError(t, store.CreateProject(ctx, project))
	application := &Application{ProjectID: project.ID, Name: "Budgeted app", DailyBudget: &applicationDaily}
	require.NoError(t, store.CreateApplication(ctx, application))
	now := time.Date(2026, time.October, 27, 12, 0, 0, 0, time.UTC)
	previousMonth := now.AddDate(0, -1, 0)
	require.NoError(t, store.db(ctx).Create(&[]UsageLedgerEntry{
		{ID: "budget-current", SourceLogID: "budget-current", OccurredAt: now, ProjectID: project.ID, ApplicationID: application.ID, Cost: 8, Status: "success"},
		{ID: "budget-previous", SourceLogID: "budget-previous", OccurredAt: previousMonth, ProjectID: project.ID, ApplicationID: application.ID, Cost: 100, Status: "success"},
	}).Error)

	statuses, err := store.UsageBudgetStatus(ctx, UsageQuery{ProjectID: project.ID}, now)
	require.NoError(t, err)
	require.Len(t, statuses, 3)
	for _, status := range statuses {
		if status.Window == "daily" {
			require.Equal(t, 27, status.PeriodStart.Day())
		} else {
			require.Equal(t, 1, status.PeriodStart.Day())
		}
		if status.ScopeType == "project" && status.Window == "daily" {
			require.InDelta(t, 8, status.Usage, 0.000001)
			require.Equal(t, "warning", status.State)
		}
		if status.ScopeType == "application" {
			require.Equal(t, "exceeded", status.State)
		}
	}

	created, err := store.EvaluateBudgetAlerts(ctx, now)
	require.NoError(t, err)
	require.EqualValues(t, 3, created)
	created, err = store.EvaluateBudgetAlerts(ctx, now.Add(time.Minute))
	require.NoError(t, err)
	require.Zero(t, created)
	alerts, err := store.ListBudgetAlerts(ctx, UsageQuery{ProjectID: project.ID})
	require.NoError(t, err)
	require.Len(t, alerts, 3)
}

func TestBudgetLimitsCanBeClearedAndAudited(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	daily := 10.0
	project := &Project{Name: "Budget update", DailyBudget: &daily}
	require.NoError(t, store.CreateProject(ctx, project))

	require.NoError(t, store.SetBudgetLimits(ctx, BudgetScope{Type: "project", ID: project.ID}, BudgetLimits{MonthlyBudget: ptr(25.0)}, "admin"))
	updated, err := store.GetProject(ctx, project.ID)
	require.NoError(t, err)
	require.Nil(t, updated.DailyBudget)
	require.NotNil(t, updated.MonthlyBudget)
	require.InDelta(t, 25, *updated.MonthlyBudget, 0.000001)

	audits, err := store.ListAudit(ctx, 20)
	require.NoError(t, err)
	require.NotEmpty(t, audits)
	require.Equal(t, "project.budget_update", audits[0].Action)
}

func TestBudgetLimitsRejectNonPositiveValues(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Invalid budget"}
	require.NoError(t, store.CreateProject(ctx, project))

	require.ErrorIs(t, store.SetBudgetLimits(ctx, BudgetScope{Type: "project", ID: project.ID}, BudgetLimits{DailyBudget: ptr(0.0)}, "admin"), errInvalidBudget)
	require.ErrorIs(t, store.SetBudgetLimits(ctx, BudgetScope{Type: "project", ID: project.ID}, BudgetLimits{DailyBudget: ptr(-1.0)}, "admin"), errInvalidBudget)
}

func TestBudgetLimitsValidateFiniteAmountsAndScopes(t *testing.T) {
	for _, invalid := range []float64{0, -1, math.NaN(), math.Inf(1), math.Inf(-1)} {
		require.ErrorIs(t, (BudgetLimits{DailyBudget: &invalid}).validate(), errInvalidBudget)
		require.ErrorIs(t, (BudgetLimits{MonthlyBudget: &invalid}).validate(), errInvalidBudget)
	}
	require.NoError(t, (BudgetLimits{}).validate())
	require.NoError(t, (BudgetLimits{DailyBudget: ptr(0.01), MonthlyBudget: ptr(100.0)}).validate())
	for _, scope := range []BudgetScope{{"project", ""}, {"wrong", "id"}} {
		_, err := scope.model()
		require.ErrorIs(t, err, errInvalidBudget)
	}
}

func TestBudgetPeriodsUseUTCLeapMonthAndYearBoundaries(t *testing.T) {
	// Cases: leap February / local day differs from UTC / December rolls into January.
	for _, tc := range []struct{ now, day, month, nextMonth string }{
		{"2028-02-29T23:59:59Z", "2028-02-29", "2028-02-01", "2028-03-01"},
		{"2026-10-27T01:00:00+08:00", "2026-10-26", "2026-10-01", "2026-11-01"},
		{"2026-12-31T23:59:59-08:00", "2027-01-01", "2027-01-01", "2027-02-01"},
	} {
		now, err := time.Parse(time.RFC3339, tc.now)
		require.NoError(t, err)
		periods := budgetPeriods(budgetScope{Limits: BudgetLimits{ptr(10.0), ptr(100.0)}}, now)
		require.Len(t, periods, 2)
		require.Equal(t, tc.day, periods[0].PeriodStart.Format(time.DateOnly))
		require.Equal(t, 24*time.Hour, periods[0].PeriodEnd.Sub(periods[0].PeriodStart))
		require.Equal(t, tc.month, periods[1].PeriodStart.Format(time.DateOnly))
		require.Equal(t, tc.nextMonth, periods[1].PeriodEnd.Format(time.DateOnly))
	}
	require.Empty(t, budgetPeriods(budgetScope{}, time.Now()))
	for _, tc := range []struct {
		usage float64
		state string
	}{{0, "healthy"}, {79.99, "healthy"}, {80, "warning"}, {99.99, "warning"}, {100, "exceeded"}, {150, "exceeded"}} {
		require.Equal(t, tc.state, budgetState(tc.usage, 100))
	}
	require.Equal(t, "warning", budgetState(0.08, 0.10))
	require.True(t, reachedBudgetThreshold(0.01+0.07, 0.10, 0.8))
	require.False(t, reachedBudgetThreshold(0.079999, 0.10, 0.8))
	require.False(t, reachedBudgetThreshold(0, math.SmallestNonzeroFloat64, 0.8))
	require.False(t, reachedBudgetThreshold(0, math.SmallestNonzeroFloat64, 1))
	require.False(t, reachedBudgetThreshold(-1, math.SmallestNonzeroFloat64, 0.8))
	require.True(t, reachedBudgetThreshold(math.SmallestNonzeroFloat64, math.SmallestNonzeroFloat64, 0.8))
}

func TestBudgetAlertBoundariesRolloverAndScopeFilters(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Calendar budget", DailyBudget: ptr(100.0), MonthlyBudget: ptr(200.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{ProjectID: project.ID, Name: "Budgeted", DailyBudget: ptr(50.0), MonthlyBudget: ptr(100.0)}
	require.NoError(t, store.CreateApplication(ctx, app))
	otherProject := &Project{Name: "Other project", DailyBudget: ptr(10.0)}
	require.NoError(t, store.CreateProject(ctx, otherProject))
	otherApp := &Application{ProjectID: otherProject.ID, Name: "Other"}
	require.NoError(t, store.CreateApplication(ctx, otherApp))
	now := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	start := time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)
	nextMonth := start.AddDate(0, 0, 1)
	require.NoError(t, store.db(ctx).Create(&[]UsageLedgerEntry{
		{ID: "at-start", SourceLogID: "at-start", ProjectID: project.ID, ApplicationID: app.ID, OccurredAt: start, Cost: 50},
		{ID: "other-app", SourceLogID: "other-app", ProjectID: project.ID, ApplicationID: "sibling", OccurredAt: now, Cost: 30},
		{ID: "yesterday", SourceLogID: "yesterday", ProjectID: project.ID, ApplicationID: app.ID, OccurredAt: start.Add(-time.Second), Cost: 100},
		{ID: "old-month", SourceLogID: "old-month", ProjectID: project.ID, ApplicationID: app.ID, OccurredAt: time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC), Cost: 999},
		{ID: "at-end", SourceLogID: "at-end", ProjectID: project.ID, ApplicationID: app.ID, OccurredAt: nextMonth, Cost: 999},
		{ID: "other-project", SourceLogID: "other-project", ProjectID: otherProject.ID, ApplicationID: otherApp.ID, OccurredAt: now, Cost: 20},
	}).Error)
	created, err := store.EvaluateBudgetAlerts(ctx, now)
	require.NoError(t, err)
	require.EqualValues(t, 8, created)
	restarted, err := NewStore(ctx, cs)
	require.NoError(t, err)
	created, err = restarted.EvaluateBudgetAlerts(ctx, now)
	require.NoError(t, err)
	require.Zero(t, created)
	for _, tc := range []struct {
		query UsageQuery
		count int
	}{
		{UsageQuery{}, 8},
		{UsageQuery{ProjectID: project.ID}, 6},
		{UsageQuery{ApplicationID: app.ID}, 4},
		{UsageQuery{ProjectID: project.ID, ApplicationID: app.ID}, 4},
		{UsageQuery{ProjectID: project.ID, ApplicationID: otherApp.ID}, 0},
		{UsageQuery{Limit: 1, Offset: 7}, 1},
	} {
		alerts, err := store.ListBudgetAlerts(ctx, tc.query)
		require.NoError(t, err)
		require.Len(t, alerts, tc.count)
	}
	statuses, err := store.UsageBudgetStatus(ctx, UsageQuery{ApplicationID: app.ID}, now)
	require.NoError(t, err)
	require.Len(t, statuses, 2)
	require.Equal(t, 50.0, statuses[0].Usage)
	require.Equal(t, 150.0, statuses[1].Usage)
	created, err = store.EvaluateBudgetAlerts(ctx, nextMonth)
	require.NoError(t, err)
	require.EqualValues(t, 8, created, "new day and month allow fresh threshold events")
}

func TestBudgetLimitsAuditFailureRollsBackAndCreationValidates(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	require.ErrorIs(t, store.CreateProject(ctx, &Project{Name: "Invalid", DailyBudget: ptr(-1.0)}), errInvalidBudget)
	project := &Project{Name: "Atomic budget", DailyBudget: ptr(10.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	require.ErrorIs(t, store.CreateApplication(ctx, &Application{ProjectID: project.ID, Name: "Invalid", MonthlyBudget: ptr(-1.0)}), errInvalidBudget)
	require.ErrorIs(t, store.SetBudgetLimits(ctx, BudgetScope{"project", "missing"}, BudgetLimits{}, "admin"), gorm.ErrRecordNotFound)
	require.NoError(t, store.db(ctx).Migrator().DropTable(&AuditEvent{}))
	require.Error(t, store.SetBudgetLimits(ctx, BudgetScope{"project", project.ID}, BudgetLimits{MonthlyBudget: ptr(20.0)}, "admin"))
	persisted, err := store.GetProject(ctx, project.ID)
	require.NoError(t, err)
	require.Equal(t, 10.0, *persisted.DailyBudget)
	require.Nil(t, persisted.MonthlyBudget)
}

func TestBudgetAlertConcurrentEvaluation(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Concurrent budget", DailyBudget: ptr(10.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	now := time.Now().UTC()
	require.NoError(t, store.db(ctx).Create(&UsageLedgerEntry{ID: "concurrent", SourceLogID: "concurrent", ProjectID: project.ID, OccurredAt: now, Cost: 10}).Error)
	var workers sync.WaitGroup
	failures := make(chan error, 4)
	for range 4 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			_, err := store.EvaluateBudgetAlerts(ctx, now)
			failures <- err
		}()
	}
	workers.Wait()
	close(failures)
	for err := range failures {
		require.NoError(t, err)
	}
	alerts, err := store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.Len(t, alerts, 2)
}

func TestBudgetMonitorSkipsUnconfiguredAndFailedReconciliation(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	reader := &countingUsageReader{}
	h := NewHandler(store, &snapshotLogManager{UsageLogReader: reader})
	require.NoError(t, h.refreshBudgetAlerts(ctx))
	require.Zero(t, reader.calls.Load(), "unconfigured budgets do not initiate source scans")
	project := &Project{Name: "Stale budget", DailyBudget: ptr(1.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	require.NoError(t, store.db(ctx).Create(&UsageLedgerEntry{ID: "stale", SourceLogID: "stale", ProjectID: project.ID, OccurredAt: time.Now().UTC(), Cost: 10}).Error)
	sourceErr := errors.New("source unavailable")
	h.logManager = nil
	require.ErrorIs(t, h.refreshBudgetAlerts(ctx), errBudgetUsageSourceUnavailable)
	h.logManager = &failingFingerprintLogManager{snapshotLogManager: &snapshotLogManager{UsageLogReader: reader}, err: sourceErr}
	require.ErrorIs(t, h.refreshBudgetAlerts(ctx), sourceErr)
	alerts, err := store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.Empty(t, alerts, "stale ledger cannot trigger an alert after sync failure")

	h.logManager = &snapshotLogManager{UsageLogReader: completeSnapshotReader{logs: []logstore.Log{{ID: "fresh", Timestamp: time.Now().UTC(), Status: "success", Cost: ptr(2.0)}}}}
	require.NoError(t, h.refreshBudgetAlerts(ctx))
	// The complete snapshot removes stale project usage; unrelated/default usage must not charge this project.
	alerts, err = store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.Empty(t, alerts)
}
