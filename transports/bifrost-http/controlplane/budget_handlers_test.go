package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/maximhq/bifrost/plugins/logging"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestBudgetRoutesEnforceAdminAndValidateUpdates(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "API budget"}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{ProjectID: project.ID, Name: "API app"}
	require.NoError(t, store.CreateApplication(ctx, app))
	r := router.New()
	NewHandler(store, &snapshotLogManager{UsageLogReader: completeSnapshotReader{}}).RegisterRoutes(r)
	projectPath := "/api/control-plane/projects/" + project.ID + "/budgets"
	appPath := "/api/control-plane/applications/" + app.ID + "/budgets"
	for _, tc := range []struct {
		name, method, path, body string
		admin, bypass, cross     bool
		status                   int
	}{
		{"anonymous", "PUT", projectPath, `{}`, false, false, false, 401},
		{"bypassed", "PUT", projectPath, `{}`, true, true, false, 403},
		{"cross-origin", "PUT", projectPath, `{}`, true, false, true, 403},
		{"malformed", "PUT", projectPath, `{`, true, false, false, 400},
		{"null", "PUT", projectPath, `null`, true, false, false, 400},
		{"unknown", "PUT", projectPath, `{"daily_budgte":10}`, true, false, false, 400},
		{"trailing", "PUT", projectPath, `{} {}`, true, false, false, 400},
		{"invalid", "PUT", projectPath, `{"daily_budget":0}`, true, false, false, 400},
		{"missing", "PUT", "/api/control-plane/projects/missing/budgets", `{}`, true, false, false, 404},
		{"project", "PUT", projectPath, `{"daily_budget":10,"monthly_budget":50}`, true, false, false, 200},
		{"application", "PUT", appPath, `{"daily_budget":2}`, true, false, false, 200},
		{"status-anonymous", "GET", "/api/control-plane/usage/budgets", "", false, false, false, 401},
		{"alerts-bypassed", "GET", "/api/control-plane/budget-alerts", "", true, true, false, 403},
		{"status", "GET", "/api/control-plane/usage/budgets?project_id=" + project.ID, "", true, false, false, 200},
		{"alerts", "GET", "/api/control-plane/budget-alerts?project_id=" + project.ID, "", true, false, false, 200},
		{"clear", "PUT", projectPath, `{"daily_budget":null,"monthly_budget":null}`, true, false, false, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := &fasthttp.RequestCtx{}
			req.Request.Header.SetMethod(tc.method)
			req.Request.Header.SetContentType("application/json")
			req.Request.SetRequestURI("http://admin.example.test" + tc.path)
			req.Request.SetBodyString(tc.body)
			req.SetUserValue(schemas.IsLocalAdminContextKey, tc.admin)
			req.SetUserValue(schemas.BifrostContextKeyAuthBypassed, tc.bypass)
			req.SetUserValue(schemas.BifrostContextKeyUserID, "budget-admin")
			if tc.cross {
				req.Request.Header.Set("Origin", "https://elsewhere.example.test")
			}
			r.Handler(req)
			require.Equal(t, tc.status, req.Response.StatusCode(), string(req.Response.Body()))
			if tc.name == "status" {
				var payload struct{ Data []BudgetStatus }
				require.NoError(t, json.Unmarshal(req.Response.Body(), &payload))
				require.Len(t, payload.Data, 3)
				require.Equal(t, 10.0, payload.Data[0].Limit)
			}
		})
	}
	persisted, err := store.GetProject(ctx, project.ID)
	require.NoError(t, err)
	require.Nil(t, persisted.DailyBudget)
	require.Nil(t, persisted.MonthlyBudget)
	audits, err := store.ListAudit(ctx, 100)
	require.NoError(t, err)
	require.Len(t, audits, 3)
	for _, audit := range audits {
		require.Equal(t, "budget-admin", audit.ActorID)
	}
}

func TestBudgetStatusReturnsStorageAndSourceErrors(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	require.NoError(t, store.CreateProject(context.Background(), &Project{Name: "Budget source errors", DailyBudget: ptr(1.0)}))
	reader := &countingUsageReader{}
	sourceErr := errors.New("budget source unavailable")
	h := NewHandler(store, &failingFingerprintLogManager{
		snapshotLogManager: &snapshotLogManager{UsageLogReader: reader}, err: sourceErr,
	})
	req := &fasthttp.RequestCtx{}
	h.usageBudgets(req)
	require.Equal(t, 500, req.Response.StatusCode())
	require.Contains(t, string(req.Response.Body()), sourceErr.Error())
	h.logManager = nil
	req = &fasthttp.RequestCtx{}
	h.usageBudgets(req)
	require.Equal(t, 500, req.Response.StatusCode())
	require.Contains(t, string(req.Response.Body()), errBudgetUsageSourceUnavailable.Error())
	h.logManager = &snapshotLogManager{UsageLogReader: completeSnapshotReader{}}
	require.NoError(t, store.db(context.Background()).Migrator().DropTable(&BudgetAlert{}))
	req = &fasthttp.RequestCtx{}
	h.listBudgetAlerts(req)
	require.Equal(t, 500, req.Response.StatusCode())
	require.NoError(t, store.db(context.Background()).Migrator().DropTable(&Project{}))
	req = &fasthttp.RequestCtx{}
	h.usageBudgets(req)
	require.Equal(t, 500, req.Response.StatusCode())
}

func TestBudgetStatusWithoutBudgetsDoesNotReadSource(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	reader := &countingUsageReader{}
	failingSource := &failingFingerprintLogManager{
		snapshotLogManager: &snapshotLogManager{UsageLogReader: reader},
		err:                errors.New("must not fingerprint an unused source"),
	}
	// Cases: readable / failing / absent log source, all without configured budgets.
	for _, source := range []logging.LogManager{
		&snapshotLogManager{UsageLogReader: reader}, failingSource, nil,
	} {
		req := &fasthttp.RequestCtx{}
		NewHandler(store, source).usageBudgets(req)
		require.Equal(t, 200, req.Response.StatusCode(), string(req.Response.Body()))
		require.JSONEq(t, `{"data":[]}`, string(req.Response.Body()))
	}
	require.Zero(t, reader.calls.Load())
}

type observedBudgetReader struct {
	logs    []logstore.Log
	started chan struct{}
	calls   atomic.Int32
}

func (reader *observedBudgetReader) ScanUsageLogs(_ context.Context, visit func([]logstore.Log) error) error {
	reader.calls.Add(1)
	select {
	case reader.started <- struct{}{}:
	default:
	}
	return visit(reader.logs)
}

func TestBudgetMonitorProjectsAndAlertsWithoutPanelRead(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Background budget", DailyBudget: ptr(1.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{ProjectID: project.ID, Name: "Background"}
	require.NoError(t, store.CreateApplication(ctx, app))
	key, err := store.CreateApplicationKey(ctx, app.ID, "background", "", nil, "admin")
	require.NoError(t, err)
	reader := &observedBudgetReader{
		started: make(chan struct{}, 1),
		logs:    []logstore.Log{{ID: "background-cost", Timestamp: time.Now().UTC(), VirtualKeyID: ptr(key.VirtualKeyID), Status: "success", Cost: ptr(2.0)}},
	}
	monitor := NewBudgetMonitor(ctx, NewHandler(store, &snapshotLogManager{UsageLogReader: reader}), nil)
	monitor.interval = time.Hour
	monitor.Start()
	t.Cleanup(monitor.Stop)
	select {
	case <-reader.started:
	case <-time.After(10 * time.Second):
		t.Fatal("monitor did not reconcile on startup")
	}
	require.Eventually(t, func() bool {
		alerts, err := store.ListBudgetAlerts(ctx, BudgetAlertQuery{})
		return err == nil && len(alerts) == 2
	}, 20*time.Second, 20*time.Millisecond)
	monitor.Stop()
	require.EqualValues(t, 1, reader.calls.Load())
}

func TestBudgetMigrationUpgradesV4AndPreservesResources(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Before v5"}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{ProjectID: project.ID, Name: "Before v5"}
	require.NoError(t, store.CreateApplication(ctx, app))
	db := store.db(ctx)
	require.NoError(t, db.Migrator().DropTable(&BudgetAlert{}))
	for _, model := range []any{&Project{}, &Application{}} {
		for _, column := range []string{"daily_budget", "monthly_budget"} {
			require.NoError(t, db.Migrator().DropColumn(model, column))
		}
	}
	require.NoError(t, db.Exec("DELETE FROM migrations WHERE id = ?", "elygate_control_plane_v5_budget_alerts").Error)
	upgraded, err := NewStore(ctx, cs)
	require.NoError(t, err)
	require.True(t, upgraded.db(ctx).Migrator().HasTable(&BudgetAlert{}))
	persisted, err := upgraded.GetProject(ctx, project.ID)
	require.NoError(t, err)
	require.Equal(t, project.Name, persisted.Name)
	require.Nil(t, persisted.DailyBudget)
	persistedApp, err := upgraded.GetApplication(ctx, app.ID)
	require.NoError(t, err)
	require.Equal(t, app.Name, persistedApp.Name)
	require.NoError(t, upgraded.SetBudgetLimits(ctx, BudgetScope{"application", app.ID}, BudgetLimits{DailyBudget: ptr(5.0)}, "admin"))
	_, err = NewStore(ctx, cs)
	require.NoError(t, err)
}
