package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func budgetAnalysisRequest(path string, admin bool) *fasthttp.RequestCtx {
	req := &fasthttp.RequestCtx{}
	req.Request.Header.SetMethod("GET")
	req.Request.SetRequestURI("http://admin.example.test" + path)
	req.SetUserValue(schemas.IsLocalAdminContextKey, admin)
	return req
}

func historyAnalysisQuery(start, end time.Time) BudgetHistoryQuery {
	return BudgetHistoryQuery{Window: "daily", StartTime: start, EndTime: end, Limit: 100}
}

func TestBudgetAnalysisFinalPolicyZeroUsageFiltersAndPagination(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2026, 1, 30, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 2, 2, 0, 0, 0, 0, time.UTC)
	project, app := budgetHistoryApplication(t, store, start)
	for _, revision := range []BudgetPolicyRevision{
		{ScopeType: "project", ScopeID: project.ID, EffectiveAt: start.AddDate(0, 0, 1).Add(time.Hour)},
		{ScopeType: "project", ScopeID: project.ID, EffectiveAt: start.AddDate(0, 0, 2).Add(time.Hour), BudgetLimits: BudgetLimits{DailyBudget: ptr(20.0)}},
		{ScopeType: "application", ScopeID: app.ID, EffectiveAt: start.AddDate(0, 0, 1)},
		{ScopeType: "application", ScopeID: app.ID, EffectiveAt: start.AddDate(0, 0, 1), BudgetLimits: BudgetLimits{DailyBudget: ptr(6.0), MonthlyBudget: ptr(60.0)}},
		{ScopeType: "application", ScopeID: app.ID, EffectiveAt: end, BudgetLimits: BudgetLimits{DailyBudget: ptr(999.0)}},
	} {
		require.NoError(t, store.db(ctx).Create(&revision).Error)
	}
	for index, cost := range []float64{8, 6} {
		log := historyUsageLog(start.AddDate(0, 0, index).Add(time.Hour), cost)
		log.ID = fmt.Sprintf("history-analysis-%d", index)
		_, err := store.ProjectLogs(ctx, []logstore.Log{log})
		require.NoError(t, err)
	}
	require.NoError(t, store.SetBudgetLimits(ctx, BudgetScope{"project", project.ID}, BudgetLimits{}, "admin"))
	clearBudgetHistoryPeriods(t, store)
	query := historyAnalysisQuery(start.AddDate(0, 0, -1), end)
	page, err := store.UsageBudgetHistory(ctx, query, end)
	require.NoError(t, err)
	require.EqualValues(t, 5, page.Total)
	require.Len(t, page.Data, 5)
	require.Equal(t, []string{"application", "project", "application", "application", "project"}, historyAnalysisTypes(page))
	require.Equal(t, []float64{0, 0, 6, 8, 8}, historyAnalysisUsages(page))
	require.Equal(t, []float64{6, 20, 6, 5, 10}, historyAnalysisLimits(page))
	require.Equal(t, []string{"healthy", "healthy", "exceeded", "exceeded", "warning"}, historyAnalysisStates(page))
	for _, status := range page.Data {
		require.Equal(t, project.ID, status.ProjectID)
		if status.ScopeType == "project" {
			require.Equal(t, project.Name, status.ScopeName)
		} else {
			require.Equal(t, app.Name, status.ScopeName)
		}
	}
	for offset := range 7 {
		paged := query
		paged.Limit, paged.Offset = 2, offset
		got, err := store.UsageBudgetHistory(ctx, paged, end)
		require.NoError(t, err)
		require.Equal(t, page.Total, got.Total)
		require.Equal(t, page.Data[min(offset, 5):min(offset+2, 5)], got.Data)
	}
	for _, filter := range []struct {
		project, application string
		count                int
	}{
		{project.ID, "", 5}, {"", app.ID, 3}, {project.ID, app.ID, 3},
		{"missing", app.ID, 0}, {project.ID, "missing", 0},
		{"' OR 1=1 --", "", 0},
	} {
		filtered := query
		filtered.ProjectID, filtered.ApplicationID = filter.project, filter.application
		got, err := store.UsageBudgetHistory(ctx, filtered, end)
		require.NoError(t, err)
		require.EqualValues(t, filter.count, got.Total)
		require.Len(t, got.Data, filter.count)
	}
	alerts, err := store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.Empty(t, alerts)
	require.Empty(t, budgetNotificationRows(t, store))
	require.Empty(t, budgetHistoryPeriods(t, store), "analysis does not require or enqueue recalculation work")
}

func historyAnalysisTypes(page BudgetHistoryPage) []string {
	var types []string
	for _, status := range page.Data {
		types = append(types, status.ScopeType)
	}
	return types
}

func historyAnalysisUsages(page BudgetHistoryPage) []float64 {
	var usages []float64
	for _, status := range page.Data {
		usages = append(usages, status.Usage)
	}
	return usages
}

func historyAnalysisLimits(page BudgetHistoryPage) []float64 {
	var limits []float64
	for _, status := range page.Data {
		limits = append(limits, status.Limit)
	}
	return limits
}

func historyAnalysisStates(page BudgetHistoryPage) []string {
	var states []string
	for _, status := range page.Data {
		states = append(states, status.State)
	}
	return states
}

func TestBudgetAnalysisMonthlyLeapBoundaryAndLateCorrections(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2024, 2, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)
	project, app := budgetHistoryApplication(t, store, start)
	log := historyUsageLog(end.Add(-time.Microsecond), 8)
	_, err := store.ProjectLogs(ctx, []logstore.Log{log})
	require.NoError(t, err)
	_, err = store.EvaluateBudgetAlerts(ctx, end)
	require.NoError(t, err)
	alerts, err := store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	deliveries := budgetNotificationRows(t, store)
	query := historyAnalysisQuery(start, end)
	query.Window, query.ProjectID, query.ApplicationID = "monthly", project.ID, app.ID
	page, err := store.UsageBudgetHistory(ctx, query, end)
	require.NoError(t, err)
	require.Len(t, page.Data, 1)
	require.Equal(t, 10.0, page.Data[0].Limit)
	require.Equal(t, 8.0, page.Data[0].Usage)
	require.Equal(t, "warning", page.Data[0].State)
	require.True(t, page.Data[0].PeriodEnd.Equal(end))
	log.Cost = ptr(1.0)
	require.NoError(t, store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{log}}))
	page, err = store.UsageBudgetHistory(ctx, query, end.In(time.FixedZone("UTC+8", 8*3600)))
	require.NoError(t, err)
	require.Equal(t, 1.0, page.Data[0].Usage)
	require.Equal(t, "healthy", page.Data[0].State)
	persisted, err := store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.Equal(t, alerts, persisted)
	require.Equal(t, deliveries, budgetNotificationRows(t, store))
	log.Timestamp = end
	require.NoError(t, store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{log}}))
	page, err = store.UsageBudgetHistory(ctx, query, end)
	require.NoError(t, err)
	require.Zero(t, page.Data[0].Usage, "usage at period end belongs to the next month")
}

func TestBudgetAnalysisRangeDefaultsAndBounds(t *testing.T) {
	now := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	for _, window := range []string{"daily", "monthly"} {
		query, err := (BudgetHistoryQuery{Window: window}).normalize(now)
		require.NoError(t, err)
		require.Equal(t, 25, query.Limit)
		require.Equal(t, 0, query.Offset)
		expected := 30
		maximum := 366
		if window == "monthly" {
			expected, maximum = 12, 60
		}
		require.Len(t, query.periods(), expected)
		query.StartTime = shiftBudgetHistoryPeriod(window, query.EndTime, -maximum)
		query, err = query.normalize(now)
		require.NoError(t, err)
		require.Len(t, query.periods(), maximum)
		query.StartTime = shiftBudgetHistoryPeriod(window, query.StartTime, -1)
		_, err = query.normalize(now)
		require.ErrorIs(t, err, errInvalidBudgetHistory)
	}
	// Cases: unpaired / empty / reversed / unaligned / open / unsupported / invalid pagination.
	start := budgetHistoryPeriodStart("daily", now).AddDate(0, 0, -2)
	end := start.AddDate(0, 0, 1)
	for _, query := range []BudgetHistoryQuery{
		{StartTime: start}, {EndTime: end}, {StartTime: end, EndTime: end},
		{StartTime: end, EndTime: start}, {StartTime: start.Add(time.Hour), EndTime: end},
		{StartTime: start, EndTime: end.Add(time.Second)},
		{StartTime: start, EndTime: end.AddDate(0, 0, 2)},
		{Window: "weekly"}, {Limit: -1}, {Limit: 101}, {Offset: -1},
		{Window: "monthly", StartTime: start, EndTime: end},
	} {
		_, err := query.normalize(now)
		require.ErrorIs(t, err, errInvalidBudgetHistory, "%+v", query)
	}
}

func TestBudgetAnalysisRoutesValidateBeforeSourceAndEnforceAdmin(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	reader := &countingUsageReader{}
	handler := NewHandler(store, &snapshotLogManager{UsageLogReader: reader})
	r := router.New()
	handler.RegisterRoutes(r)
	for _, raw := range []string{
		"window=weekly", "window=", "window=daily&window=monthly",
		"limit=0", "limit=-1", "limit=101", "limit=1.5", "limit=+1", "limit=",
		"limit=1&limit=2", "limit=999999999999999999999",
		"offset=-1", "offset=1e3", "offset=999999999999999999999",
		"start_time=2026-01-01T00:00:00Z", "end_time=2026-01-02T00:00:00Z",
		"start_time=invalid&end_time=invalid", "start_time=&end_time=",
		"start_time=0001-01-01T00:00:00Z&end_time=0001-01-01T00:00:00Z",
		"start_time=2026-01-01T00:00:00Z&end_time=2026-01-01T12:00:00Z",
		"start_time=2026-01-01T00:00:00Z&end_time=2026-01-01T00:00:00Z",
		"start_time=2026-01-01T00:00:00Z&end_time=9999-01-01T00:00:00Z",
		"start_time=2020-01-01T00:00:00Z&end_time=2026-01-01T00:00:00Z",
		"window=monthly&start_time=2026-01-02T00:00:00Z&end_time=2026-02-01T00:00:00Z",
	} {
		req := budgetAnalysisRequest("/api/control-plane/usage/budgets/history?"+raw, true)
		r.Handler(req)
		require.Equal(t, 400, req.Response.StatusCode(), "%s: %s", raw, req.Response.Body())
	}
	require.Zero(t, reader.calls.Load())
	for _, admin := range []bool{false, true} {
		req := budgetAnalysisRequest("/api/control-plane/usage/budgets/history", admin)
		r.Handler(req)
		if !admin {
			require.Equal(t, 401, req.Response.StatusCode())
			continue
		}
		require.Equal(t, 200, req.Response.StatusCode(), string(req.Response.Body()))
		var page BudgetHistoryPage
		require.NoError(t, json.Unmarshal(req.Response.Body(), &page))
		require.NotNil(t, page.Data)
		require.Empty(t, page.Data)
		require.Zero(t, page.Total)
		require.Equal(t, 25, page.Limit)
		require.Equal(t, "daily", page.Window)
	}
	req := budgetAnalysisRequest("/api/control-plane/usage/budgets/history", true)
	req.SetUserValue(schemas.BifrostContextKeyAuthBypassed, true)
	r.Handler(req)
	require.Equal(t, 403, req.Response.StatusCode())
	require.Zero(t, reader.calls.Load(), "empty history must not read the source")
}

func TestBudgetAnalysisHTTPReconcilesHistoryAndReportsErrors(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	project, app := budgetHistoryApplication(t, store, start)
	for _, scope := range []BudgetScope{{"project", project.ID}, {"application", app.ID}} {
		require.NoError(t, store.SetBudgetLimits(ctx, scope, BudgetLimits{}, "admin"))
	}
	params := url.Values{"window": {"daily"}, "start_time": {start.Format(time.RFC3339)},
		"end_time": {start.AddDate(0, 0, 1).Format(time.RFC3339)}, "project_id": {project.ID}, "application_id": {app.ID}}
	path := "/api/control-plane/usage/budgets/history?" + params.Encode()
	reader := &observedBudgetReader{logs: []logstore.Log{historyUsageLog(start.Add(time.Hour), 8)}, started: make(chan struct{}, 1)}
	handler := NewHandler(store, &snapshotLogManager{UsageLogReader: reader})
	req := budgetAnalysisRequest(path, true)
	handler.usageBudgetHistory(req)
	require.Equal(t, 200, req.Response.StatusCode(), string(req.Response.Body()))
	var page BudgetHistoryPage
	require.NoError(t, json.Unmarshal(req.Response.Body(), &page))
	require.Len(t, page.Data, 1)
	require.Equal(t, 8.0, page.Data[0].Usage)
	require.Equal(t, app.Name, page.Data[0].ScopeName)
	require.EqualValues(t, 1, reader.calls.Load())
	alerts, err := store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.Empty(t, alerts, "GET history must not evaluate threshold alerts")
	handler.logManager = nil
	req = budgetAnalysisRequest(path, true)
	handler.usageBudgetHistory(req)
	require.Equal(t, 500, req.Response.StatusCode())
	require.Contains(t, string(req.Response.Body()), errBudgetUsageSourceUnavailable.Error())
	handler.logManager = &failingFingerprintLogManager{snapshotLogManager: &snapshotLogManager{UsageLogReader: reader}, err: errors.New("history source failed")}
	req = budgetAnalysisRequest(path, true)
	handler.usageBudgetHistory(req)
	require.Equal(t, 500, req.Response.StatusCode())
	require.Contains(t, string(req.Response.Body()), "history source failed")
	require.NoError(t, store.db(ctx).Migrator().DropTable(&BudgetPolicyRevision{}))
	req = budgetAnalysisRequest(path, true)
	handler.usageBudgetHistory(req)
	require.Equal(t, 500, req.Response.StatusCode())
}

func TestBudgetAnalysisStorageFailureDoesNotReturnEmptySuccess(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	budgetHistoryApplication(t, store, start)
	require.NoError(t, store.db(ctx).Migrator().DropTable(&UsageLedgerEntry{}))
	_, err := store.UsageBudgetHistory(ctx, historyAnalysisQuery(start, start.AddDate(0, 0, 1)), start.AddDate(0, 0, 1))
	require.Error(t, err)
}

func TestBudgetAnalysisCountPageAndUsageShareProjectionLock(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	_, app := budgetHistoryApplication(t, store, start)
	log := historyUsageLog(start.Add(time.Hour), 1)
	_, err := store.ProjectLogs(ctx, []logstore.Log{log})
	require.NoError(t, err)
	counted, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	var paused atomic.Bool
	db := store.db(ctx)
	require.NoError(t, db.Callback().Query().After("gorm:query").Register("test:budget-analysis-count", func(tx *gorm.DB) {
		if strings.Contains(tx.Statement.SQL.String(), "AS budgets") && paused.CompareAndSwap(false, true) {
			close(counted)
			select {
			case <-release:
			case <-ctx.Done():
				tx.AddError(ctx.Err())
			}
		}
	}))
	t.Cleanup(func() { db.Callback().Query().Remove("test:budget-analysis-count") })
	query := historyAnalysisQuery(start, start.AddDate(0, 0, 1))
	query.ApplicationID = app.ID
	type historyRead struct {
		page BudgetHistoryPage
		err  error
	}
	read := make(chan historyRead, 1)
	go func() {
		page, err := store.UsageBudgetHistory(ctx, query, query.EndTime)
		read <- historyRead{page, err}
	}()
	select {
	case <-counted:
	case <-ctx.Done():
		t.Fatal("history did not reach its count query")
	}
	corrected := make(chan error, 1)
	log.Cost = ptr(9.0)
	go func() { corrected <- store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{log}}) }()
	select {
	case err := <-corrected:
		t.Fatalf("projection correction escaped the history lock: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	unblock()
	snapshot := <-read
	require.NoError(t, snapshot.err)
	require.EqualValues(t, 1, snapshot.page.Total)
	require.Len(t, snapshot.page.Data, 1)
	require.Equal(t, 1.0, snapshot.page.Data[0].Usage)
	require.NoError(t, <-corrected)
	current, err := store.UsageBudgetHistory(ctx, query, query.EndTime)
	require.NoError(t, err)
	require.Equal(t, 9.0, current.Data[0].Usage)
}

func TestBudgetAnalysisRepresentativeQueryPlanAndCost(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 0, 366)
	var projects []Project
	var apps []Application
	var revisions []BudgetPolicyRevision
	for index := range 100 {
		project := Project{ID: fmt.Sprintf("analysis-project-%03d", index), Name: fmt.Sprintf("Project %d", index)}
		projects = append(projects, project)
		revisions = append(revisions, BudgetPolicyRevision{ScopeType: "project", ScopeID: project.ID,
			EffectiveAt: start, BudgetLimits: BudgetLimits{DailyBudget: ptr(10.0)}})
		for child := range 2 {
			app := Application{ID: fmt.Sprintf("analysis-app-%03d-%d", index, child), ProjectID: project.ID, Name: fmt.Sprintf("App %d/%d", index, child)}
			apps = append(apps, app)
			revisions = append(revisions, BudgetPolicyRevision{ScopeType: "application", ScopeID: app.ID,
				EffectiveAt: start, BudgetLimits: BudgetLimits{DailyBudget: ptr(5.0)}})
		}
	}
	db := store.db(ctx)
	require.NoError(t, db.CreateInBatches(projects, 100).Error)
	require.NoError(t, db.CreateInBatches(apps, 100).Error)
	require.NoError(t, db.CreateInBatches(revisions, 100).Error)
	for batch := range 300 {
		var entries []UsageLedgerEntry
		for index := range 100 {
			ordinal := batch*100 + index
			app := apps[ordinal%len(apps)]
			id := fmt.Sprintf("analysis-usage-%d", ordinal)
			entries = append(entries, UsageLedgerEntry{ID: id, SourceLogID: id, ProjectID: app.ProjectID, ApplicationID: app.ID,
				OccurredAt: start.AddDate(0, 0, ordinal%366).Add(time.Hour), Status: "success", Cost: .01})
		}
		require.NoError(t, db.Create(&entries).Error)
	}
	query := historyAnalysisQuery(start, end)
	began := time.Now()
	page, err := store.UsageBudgetHistory(ctx, query, end)
	require.NoError(t, err)
	require.EqualValues(t, 109800, page.Total)
	require.Len(t, page.Data, 100)
	t.Logf("history count + 100 rows + usage: %s; scopes=300, periods=366, revisions=300, ledger=30000", time.Since(began))
	candidates := budgetHistoryCandidates(db, query)
	if db.Dialector.Name() == "sqlite" {
		var plans []struct{ Detail string }
		require.NoError(t, db.Raw("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM (?) AS budgets", candidates).Scan(&plans).Error)
		t.Logf("SQLite candidate count plan: %+v", plans)
		plans = nil
		require.NoError(t, db.Raw("EXPLAIN QUERY PLAN SELECT SUM(cost) FROM elygate_control_usage_ledger WHERE project_id = ? AND occurred_at >= ? AND occurred_at < ?",
			projects[0].ID, start, start.AddDate(0, 0, 1)).Scan(&plans).Error)
		t.Logf("SQLite usage plan: %+v", plans)
	} else {
		var plans []struct {
			Plan string `gorm:"column:QUERY PLAN"`
		}
		require.NoError(t, db.Raw("EXPLAIN (ANALYZE, BUFFERS) SELECT COUNT(*) FROM (?) AS budgets", candidates).Scan(&plans).Error)
		for _, plan := range plans {
			t.Log(plan.Plan)
		}
	}
}
