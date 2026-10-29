package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func TestBudgetResolutionsPersistIndependentlyAndRetryIdempotently(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	deliveries := seedBudgetNotifications(t, store, 8)
	id := deliveries[0].AlertID
	first, err := store.SetBudgetResolution(ctx, budgetResolutionMutation{id, true})
	require.NoError(t, err)
	require.True(t, first.Resolved)
	require.False(t, first.Acknowledged, "resolution does not imply acknowledgement")
	require.NotNil(t, first.ResolvedAt)
	require.Zero(t, first.ResolvedAt.Nanosecond()%1000)
	require.Equal(t, budgetResolutionActor, *first.ResolvedBy)
	restarted, err := NewStore(ctx, cs)
	require.NoError(t, err)
	retry, err := restarted.SetBudgetResolution(ctx, budgetResolutionMutation{id, true})
	require.NoError(t, err)
	require.Equal(t, first, retry)
	require.Len(t, acknowledgementAudits(t, store), 1)
	confirmed, err := store.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, true})
	require.NoError(t, err)
	require.True(t, confirmed.Acknowledged)
	require.Equal(t, first.ResolvedAt, confirmed.ResolvedAt, "acknowledge returns real resolution")
	for range 2 {
		open, err := restarted.SetBudgetResolution(ctx, budgetResolutionMutation{id, false})
		require.NoError(t, err)
		require.False(t, open.Resolved)
		require.Nil(t, open.ResolvedAt)
		require.Nil(t, open.ResolvedBy)
		require.Equal(t, confirmed.AcknowledgedAt, open.AcknowledgedAt)
	}
	events := acknowledgementAudits(t, store)
	require.Len(t, events, 3)
	require.Equal(t, "budget-alert.resolve", events[0].Action)
	require.Equal(t, "budget-alert.reopen", events[2].Action)
	require.Equal(t, budgetResolutionActor, events[2].ActorID)
	require.Equal(t, deliveries, budgetNotificationRows(t, store))
	require.Error(t, budgetResolutionRollback(store.db(ctx)))
}

func TestBudgetResolutionMigrationPreservesExistingAlertsAndAcknowledgements(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	deliveries := seedBudgetNotifications(t, store, 8)
	id := deliveries[0].AlertID
	confirmed, err := store.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, true})
	require.NoError(t, err)
	db := store.db(ctx)
	require.NoError(t, db.Migrator().DropTable(&budgetResolution{}))
	require.NoError(t, db.Exec("DELETE FROM migrations WHERE id = ?", "elygate_control_plane_v10_budget_resolutions").Error)
	upgraded, err := NewStore(ctx, cs)
	require.NoError(t, err)
	alerts, err := upgraded.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	require.Equal(t, []BudgetAlertView{*confirmed}, alerts)
	require.Equal(t, deliveries, budgetNotificationRows(t, upgraded))
	require.Len(t, acknowledgementAudits(t, upgraded), 1)
	resolved, err := upgraded.SetBudgetResolution(ctx, budgetResolutionMutation{id, true})
	require.NoError(t, err)
	require.Equal(t, confirmed.AcknowledgedAt, resolved.AcknowledgedAt)
	require.True(t, resolved.Resolved)
	_, err = NewStore(ctx, cs)
	require.NoError(t, err, "migration is restart-idempotent")
}

func TestBudgetResolutionsAuditFailureAndCancellationRollback(t *testing.T) {
	for _, failure := range []string{"audit", "cancel-after-audit"} {
		t.Run(failure, func(t *testing.T) {
			store, _ := testControlPlaneStore(t)
			background := context.Background()
			id := seedBudgetNotifications(t, store, 8)[0].AlertID
			for _, initial := range []bool{false, true} {
				_, err := store.SetBudgetResolution(background, budgetResolutionMutation{id, initial})
				require.NoError(t, err)
				before, err := store.ListBudgetAlerts(background, BudgetAlertQuery{})
				require.NoError(t, err)
				audits := acknowledgementAudits(t, store)
				ctx, cancel := context.WithCancel(background)
				db := store.db(background)
				const callback = "test:resolution-audit-failure"
				require.NoError(t, db.Callback().Create().After("gorm:create").Register(callback, func(tx *gorm.DB) {
					if tx.Statement.Table != (AuditEvent{}).TableName() {
						return
					}
					if failure == "audit" {
						tx.AddError(errors.New("resolution audit unavailable"))
					} else {
						cancel()
					}
				}))
				_, err = store.SetBudgetResolution(ctx, budgetResolutionMutation{id, !initial})
				cancel()
				require.Error(t, err, "a successful audit insert is not a commit receipt")
				require.NoError(t, db.Callback().Create().Remove(callback))
				after, err := store.ListBudgetAlerts(background, BudgetAlertQuery{})
				require.NoError(t, err)
				require.Equal(t, before, after)
				require.Equal(t, audits, acknowledgementAudits(t, store))
			}
		})
	}
}

func TestBudgetResolutionsStateWriteFailuresRollback(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	id := seedBudgetNotifications(t, store, 8)[0].AlertID
	db := store.db(ctx)
	fail := func(tx *gorm.DB) {
		if tx.Statement.Table == budgetResolutionTable {
			tx.AddError(errors.New("resolution storage unavailable"))
		}
	}
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:resolution-insert", fail))
	_, err := store.SetBudgetResolution(ctx, budgetResolutionMutation{id, true})
	require.ErrorContains(t, err, "resolution storage unavailable")
	require.NoError(t, db.Callback().Create().Remove("test:resolution-insert"))
	require.Empty(t, acknowledgementAudits(t, store))
	_, err = store.SetBudgetResolution(ctx, budgetResolutionMutation{id, true})
	require.NoError(t, err)
	require.NoError(t, db.Callback().Delete().Before("gorm:delete").Register("test:resolution-delete", fail))
	_, err = store.SetBudgetResolution(ctx, budgetResolutionMutation{id, false})
	require.ErrorContains(t, err, "resolution storage unavailable")
	require.NoError(t, db.Callback().Delete().Remove("test:resolution-delete"))
	alerts, err := store.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	require.True(t, alerts[0].Resolved)
	require.Len(t, acknowledgementAudits(t, store), 1)
}

func TestBudgetResolutionsCascadeAndRejectMissingAlerts(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	id := seedBudgetNotifications(t, store, 8)[0].AlertID
	_, err := store.SetBudgetResolution(ctx, budgetResolutionMutation{id, true})
	require.NoError(t, err)
	require.NoError(t, store.db(ctx).Delete(&BudgetAlert{}, "id = ?", id).Error)
	var count int64
	require.NoError(t, store.db(ctx).Model(&budgetResolution{}).Count(&count).Error)
	require.Zero(t, count)
	orphan := budgetResolution{AlertID: uuid.NewString(), ResolvedAt: time.Now(), ResolvedBy: budgetResolutionActor}
	require.Error(t, store.db(ctx).Create(&orphan).Error)
	require.Error(t, store.db(ctx).Exec("INSERT INTO "+budgetResolutionTable+
		" (alert_id, resolved_at, resolved_by) VALUES (NULL, ?, ?)", time.Now(), budgetResolutionActor).Error)
	for _, resolved := range []bool{false, true} {
		_, err := store.SetBudgetResolution(ctx, budgetResolutionMutation{id, resolved})
		require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	}
}

func TestBudgetResolutionsConcurrentWithAcknowledgements(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	other, err := NewStore(ctx, cs)
	require.NoError(t, err)
	id := seedBudgetNotifications(t, store, 8)[0].AlertID
	for _, mode := range []string{"enable", "disable", "mixed"} {
		var writers sync.WaitGroup
		failures := make(chan error, 16)
		for index := range 16 {
			writers.Go(func() {
				writer := []*Store{store, other}[index%2]
				enabled := mode == "enable" || mode == "mixed" && index%4 < 2
				if index%2 == 0 {
					_, err := writer.SetBudgetResolution(ctx, budgetResolutionMutation{id, enabled})
					failures <- err
				} else {
					_, err := writer.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, enabled})
					failures <- err
				}
			})
		}
		writers.Wait()
		close(failures)
		for err := range failures {
			require.NoError(t, err)
		}
		if mode == "enable" {
			require.Len(t, acknowledgementAudits(t, store), 2)
		} else if mode == "disable" {
			require.Len(t, acknowledgementAudits(t, store), 4)
		}
	}
	expectedResolution, expectedAcknowledgement := false, false
	for _, event := range acknowledgementAudits(t, store) {
		switch event.Action {
		case "budget-alert.resolve", "budget-alert.reopen":
			require.Equal(t, !expectedResolution, event.Action == "budget-alert.resolve")
			expectedResolution = !expectedResolution
		case "budget-alert.acknowledge", "budget-alert.unacknowledge":
			require.Equal(t, !expectedAcknowledgement, event.Action == "budget-alert.acknowledge")
			expectedAcknowledgement = !expectedAcknowledgement
		default:
			t.Fatalf("unexpected budget action %s", event.Action)
		}
	}
	alerts, err := store.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	require.Equal(t, expectedResolution, alerts[0].Resolved)
	require.Equal(t, expectedAcknowledgement, alerts[0].Acknowledged)
}

func TestBudgetResolutionsDoNotRecoverOrSuppressBudgetBreaches(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	project := &Project{Name: "Still exceeded", DailyBudget: ptr(10.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	require.NoError(t, store.db(ctx).Create(&UsageLedgerEntry{ID: "resolve-usage", SourceLogID: "resolve-usage",
		ProjectID: project.ID, Cost: 10, OccurredAt: now}).Error)
	count, err := store.EvaluateBudgetAlerts(ctx, now)
	require.NoError(t, err)
	require.EqualValues(t, 2, count)
	statuses, err := store.UsageBudgetStatus(ctx, UsageQuery{ProjectID: project.ID}, now)
	require.NoError(t, err)
	deliveries := budgetNotificationRows(t, store)
	before, err := store.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	for _, alert := range before {
		_, err := store.SetBudgetResolution(ctx, budgetResolutionMutation{alert.ID, true})
		require.NoError(t, err)
	}
	count, err = store.EvaluateBudgetAlerts(ctx, now)
	require.NoError(t, err)
	require.Zero(t, count, "resolving does not clear threshold deduplication")
	current, err := store.UsageBudgetStatus(ctx, UsageQuery{ProjectID: project.ID}, now)
	require.NoError(t, err)
	require.Equal(t, statuses, current)
	require.Equal(t, "exceeded", current[0].State)
	after, err := store.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	for index := range after {
		require.Equal(t, before[index].BudgetAlert, after[index].BudgetAlert)
		require.False(t, after[index].Acknowledged)
	}
	require.Equal(t, deliveries, budgetNotificationRows(t, store))
}

func resolutionRouter(store *Store) *router.Router {
	r := router.New()
	NewHandler(store, nil).RegisterRoutes(r, func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
			ctx.SetUserValue(schemas.BifrostContextKeyUserID, "must-not-select-actor")
			next(ctx)
		}
	})
	return r
}

func TestBudgetResolutionRoutesStrictPayloadAndCompleteState(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	id := seedBudgetNotifications(t, store, 8)[0].AlertID
	r := resolutionRouter(store)
	base := "/api/control-plane/budget-alerts/"
	path := base + id + "/resolution"
	for _, initial := range []bool{false, true} {
		body, err := json.Marshal(map[string]bool{"resolved": initial})
		require.NoError(t, err)
		written := receiptRequest(r, "PUT", path, string(body))
		require.Equal(t, 200, written.Response.StatusCode())
		before, err := store.ListBudgetAlerts(context.Background(), BudgetAlertQuery{})
		require.NoError(t, err)
		audits := acknowledgementAudits(t, store)
		for _, invalid := range []string{"", "null", "{}", "[]", `{"resolved":null}`, `{"resolved":"true"}`,
			`{"resolved":1}`, `{"resolved":true,"actor":"other"}`, `{"resolved":true} {}`,
			`{"resolved":true} rubbish`, `{"resolved":false,"resolved":true}`, `{"Resolved":true}`,
			`{"resolved":true,"resolved":false}`, `{"\u0072esolved":true,"resolved":false}`} {
			require.Equal(t, 400, receiptRequest(r, "PUT", path, invalid).Response.StatusCode(), invalid)
			after, err := store.ListBudgetAlerts(context.Background(), BudgetAlertQuery{})
			require.NoError(t, err)
			require.Equal(t, before, after)
			require.Equal(t, audits, acknowledgementAudits(t, store))
		}
		list := receiptRequest(r, "GET", base[:len(base)-1], "")
		var page struct{ Data []json.RawMessage }
		require.NoError(t, json.Unmarshal(list.Response.Body(), &page))
		require.JSONEq(t, string(written.Response.Body()), string(page.Data[0]))
		if initial {
			require.Contains(t, string(written.Response.Body()), `"resolved_by":"local-admin"`)
			var view BudgetAlertView
			require.NoError(t, json.Unmarshal(written.Response.Body(), &view))
			require.NotNil(t, view.ResolvedAt)
			require.True(t, strings.HasSuffix(view.ResolvedAt.Format(time.RFC3339Nano), "Z"))
		}
	}
	for _, invalid := range []string{"invalid", strings.ToUpper(id)} {
		require.Equal(t, 400, receiptRequest(r, "PUT", base+invalid+"/resolution", `{"resolved":true}`).Response.StatusCode())
	}
	require.Equal(t, 404, receiptRequest(r, "PUT", base+uuid.NewString()+"/resolution", `{"resolved":false}`).Response.StatusCode())
}

func TestBudgetResolutionRoutesRequireAdminAndOriginGuard(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	id := seedBudgetNotifications(t, store, 8)[0].AlertID
	for _, tc := range []struct {
		name, contentType, origin string
		admin, bypassed           bool
		status                    int
	}{
		{"anonymous", "application/json", "", false, false, 401},
		{"bypassed", "application/json", "", true, true, 403},
		{"cross-host", "application/json", "http://other.test", true, false, 403},
		{"non-json", "text/plain", "", true, false, 415},
		{"same-host", "application/json", "http://admin.test", true, false, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := router.New()
			NewHandler(store, nil).RegisterRoutes(r)
			request := &fasthttp.RequestCtx{}
			request.Request.SetRequestURI("http://admin.test/api/control-plane/budget-alerts/" + id + "/resolution")
			request.Request.Header.SetMethod("PUT")
			request.Request.Header.SetContentType(tc.contentType)
			request.Request.Header.Set("Origin", tc.origin)
			request.Request.SetBodyString(`{"resolved":true}`)
			request.SetUserValue(schemas.IsLocalAdminContextKey, tc.admin)
			request.SetUserValue(schemas.BifrostContextKeyAuthBypassed, tc.bypassed)
			r.Handler(request)
			require.Equal(t, tc.status, request.Response.StatusCode())
		})
	}
}

func TestBudgetResolutionFiltersBeforePagingAndIntersectsScope(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Resolution scope"}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{Name: "Resolution app", ProjectID: project.ID}
	require.NoError(t, store.CreateApplication(ctx, app))
	now := time.Now().UTC().Truncate(time.Microsecond)
	for index, scope := range []BudgetScope{{"project", project.ID}, {"application", app.ID}, {"project", uuid.NewString()}} {
		require.NoError(t, store.db(ctx).Transaction(func(tx *gorm.DB) error {
			_, err := createBudgetAlerts(tx, BudgetStatus{ScopeType: scope.Type, ScopeID: scope.ID, Window: "daily",
				PeriodStart: now.Truncate(24 * time.Hour), Usage: 10, Limit: 10}, now.Add(time.Duration(index)*time.Second))
			return err
		}))
	}
	all, err := store.ListBudgetAlerts(ctx, BudgetAlertQuery{})
	require.NoError(t, err)
	require.Len(t, all, 6)
	for _, alert := range []BudgetAlertView{all[0], all[2], all[4]} {
		_, err := store.SetBudgetResolution(ctx, budgetResolutionMutation{alert.ID, true})
		require.NoError(t, err)
	}
	for _, tc := range []struct {
		query BudgetAlertQuery
		ids   []string
	}{
		{BudgetAlertQuery{Resolution: "resolved"}, []string{all[0].ID, all[2].ID, all[4].ID}},
		{BudgetAlertQuery{Resolution: "open", Limit: 1, Offset: 1}, []string{all[3].ID}},
		{BudgetAlertQuery{ProjectID: project.ID, Resolution: "resolved"}, []string{all[2].ID, all[4].ID}},
		{BudgetAlertQuery{ProjectID: project.ID, ApplicationID: app.ID, Resolution: "open"}, []string{all[3].ID}},
		{BudgetAlertQuery{ProjectID: uuid.NewString(), ApplicationID: app.ID, Resolution: "open"}, []string{}},
		{BudgetAlertQuery{Resolution: "resolved", Offset: 3}, []string{}},
	} {
		alerts, err := store.ListBudgetAlerts(ctx, tc.query)
		require.NoError(t, err)
		require.NotNil(t, alerts)
		ids := []string{}
		for _, alert := range alerts {
			ids = append(ids, alert.ID)
			require.Equal(t, tc.query.Resolution == "resolved", alert.Resolved)
		}
		require.Equal(t, tc.ids, ids)
	}
	_, err = store.ListBudgetAlerts(ctx, BudgetAlertQuery{Resolution: "bad"})
	require.ErrorIs(t, err, errInvalidBudgetAlertQuery)
}

func TestBudgetResolutionFilterRoutesRejectAmbiguity(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	seedBudgetNotifications(t, store, 8)
	r := resolutionRouter(store)
	for _, query := range []string{
		"resolution=invalid", "resolution=", "resolution=Open", "resolution=open&resolution=resolved",
		"project_id=", "application_id=", "project_id=a&project_id=b", "application_id=a&application_id=b",
		"limit=0", "limit=1001", "limit=-1", "limit=1.5", "limit=+1", "limit=1&limit=2",
		"offset=-1", "offset=1&offset=0", "offset=", "offset=999999999999999999999999999999",
	} {
		response := receiptRequest(r, "GET", "/api/control-plane/budget-alerts?"+query, "")
		require.Equal(t, 400, response.Response.StatusCode(), query)
	}
	for _, query := range []string{"", "resolution=all", "resolution=open", "resolution=resolved", "limit=1000&offset=0"} {
		require.Equal(t, 200, receiptRequest(r, "GET", "/api/control-plane/budget-alerts?"+query, "").Response.StatusCode(), query)
	}
	require.Empty(t, acknowledgementAudits(t, store))
}
