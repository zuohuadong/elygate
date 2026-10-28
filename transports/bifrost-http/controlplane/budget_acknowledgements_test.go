package controlplane

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func acknowledgementAudits(t *testing.T, store *Store) []AuditEvent {
	t.Helper()
	var events []AuditEvent
	require.NoError(t, store.db(context.Background()).Where("resource_type = ?", "budget-alert").Order("created_at, id").Find(&events).Error)
	return events
}

func TestBudgetAcknowledgementsPersistAndPreserveAlertAndOutbox(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	deliveries := seedBudgetNotifications(t, store, 8)
	id := deliveries[0].AlertID
	var original BudgetAlert
	require.NoError(t, store.db(ctx).First(&original, "id = ?", id).Error)
	first, err := store.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, true})
	require.NoError(t, err)
	require.True(t, first.Acknowledged)
	require.NotNil(t, first.AcknowledgedAt)
	require.Zero(t, first.AcknowledgedAt.Nanosecond()%1000, "match PostgreSQL timestamp precision")
	require.Equal(t, budgetAcknowledgementActor, *first.AcknowledgedBy)
	reopened, err := NewStore(ctx, cs)
	require.NoError(t, err)
	retry, err := reopened.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, true})
	require.NoError(t, err)
	require.Equal(t, *first.AcknowledgedAt, *retry.AcknowledgedAt)
	require.Equal(t, first.AcknowledgedBy, retry.AcknowledgedBy)
	alerts, err := reopened.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.Len(t, alerts, 1)
	require.True(t, alerts[0].Acknowledged)
	require.Len(t, acknowledgementAudits(t, store), 1)
	for range 2 {
		cleared, err := reopened.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, false})
		require.NoError(t, err)
		require.False(t, cleared.Acknowledged)
		require.Nil(t, cleared.AcknowledgedAt)
		require.Nil(t, cleared.AcknowledgedBy)
	}
	events := acknowledgementAudits(t, store)
	require.Len(t, events, 2)
	require.Equal(t, []string{"budget-alert.acknowledge", "budget-alert.unacknowledge"}, []string{events[0].Action, events[1].Action})
	require.Equal(t, budgetAcknowledgementActor, events[0].ActorID)
	var unchanged BudgetAlert
	require.NoError(t, store.db(ctx).First(&unchanged, "id = ?", id).Error)
	require.Equal(t, original, unchanged)
	require.Equal(t, deliveries, budgetNotificationRows(t, store))
	require.Error(t, budgetAcknowledgementRollback(store.db(ctx)))
}

func TestBudgetAcknowledgementsRollbackOnAuditFailure(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	id := seedBudgetNotifications(t, store, 8)[0].AlertID
	db := store.db(ctx)
	failAudit := true
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:ack-audit", func(tx *gorm.DB) {
		if failAudit && tx.Statement.Table == (AuditEvent{}).TableName() {
			tx.AddError(errors.New("ack audit unavailable"))
		}
	}))
	t.Cleanup(func() { db.Callback().Create().Remove("test:ack-audit") })
	_, err := store.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, true})
	require.ErrorContains(t, err, "ack audit unavailable")
	alerts, err := store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.False(t, alerts[0].Acknowledged)
	failAudit = false
	_, err = store.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, true})
	require.NoError(t, err)
	failAudit = true
	_, err = store.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, false})
	require.ErrorContains(t, err, "ack audit unavailable")
	alerts, err = store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.True(t, alerts[0].Acknowledged)
	require.Len(t, acknowledgementAudits(t, store), 1)
}

func TestBudgetAcknowledgementsCascadeRejectOrphansAndMissingAlerts(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	id := seedBudgetNotifications(t, store, 8)[0].AlertID
	_, err := store.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, true})
	require.NoError(t, err)
	require.NoError(t, store.db(ctx).Delete(&BudgetAlert{}, "id = ?", id).Error)
	var count int64
	require.NoError(t, store.db(ctx).Model(&budgetAcknowledgement{}).Count(&count).Error)
	require.Zero(t, count)
	orphan := budgetAcknowledgement{AlertID: uuid.NewString(), AcknowledgedAt: time.Now(), AcknowledgedBy: budgetAcknowledgementActor}
	require.Error(t, store.db(ctx).Create(&orphan).Error)
	require.Error(t, store.db(ctx).Exec("INSERT INTO "+budgetAcknowledgementTable+
		" (alert_id, acknowledged_at, acknowledged_by) VALUES (NULL, ?, ?)", time.Now(), budgetAcknowledgementActor).Error)
	for _, acknowledged := range []bool{false, true} {
		_, err := store.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, acknowledged})
		require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	}
	require.Len(t, acknowledgementAudits(t, store), 1)
}

func TestBudgetAcknowledgementsConcurrentTransitionsSerialize(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	other, err := NewStore(ctx, cs)
	require.NoError(t, err)
	id := seedBudgetNotifications(t, store, 8)[0].AlertID
	for _, mode := range []string{"acknowledge", "unacknowledge", "mixed"} {
		var writers sync.WaitGroup
		failures := make(chan error, 12)
		for index := range 12 {
			writers.Go(func() {
				writer := []*Store{store, other}[index%2]
				acknowledged := mode == "acknowledge" || mode == "mixed" && index%2 == 0
				_, err := writer.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{id, acknowledged})
				failures <- err
			})
		}
		writers.Wait()
		close(failures)
		for err := range failures {
			require.NoError(t, err)
		}
		if mode != "mixed" {
			expected := 1
			if mode == "unacknowledge" {
				expected = 2
			}
			require.Len(t, acknowledgementAudits(t, store), expected)
		}
	}
	events := acknowledgementAudits(t, store)
	for index, event := range events {
		expected := "budget-alert.acknowledge"
		if index%2 == 1 {
			expected = "budget-alert.unacknowledge"
		}
		require.Equal(t, expected, event.Action, "only actual transitions audit")
	}
	alerts, err := store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.Equal(t, len(events)%2 == 1, alerts[0].Acknowledged)
}

func TestBudgetAcknowledgementsDoNotResolveOrSuppressBudgets(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	project := &Project{Name: "Acknowledged breach", DailyBudget: ptr(10.0)}
	require.NoError(t, store.CreateProject(ctx, project))
	require.NoError(t, store.db(ctx).Create(&UsageLedgerEntry{ID: "ack-usage", SourceLogID: "ack-usage",
		ProjectID: project.ID, OccurredAt: now, Cost: 10}).Error)
	count, err := store.EvaluateBudgetAlerts(ctx, now)
	require.NoError(t, err)
	require.EqualValues(t, 2, count)
	statuses, err := store.UsageBudgetStatus(ctx, UsageQuery{ProjectID: project.ID}, now)
	require.NoError(t, err)
	deliveries := budgetNotificationRows(t, store)
	alerts, err := store.ListBudgetAlerts(ctx, UsageQuery{ProjectID: project.ID})
	require.NoError(t, err)
	for _, alert := range alerts {
		_, err := store.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{alert.ID, true})
		require.NoError(t, err)
	}
	count, err = store.EvaluateBudgetAlerts(ctx, now)
	require.NoError(t, err)
	require.Zero(t, count)
	current, err := store.UsageBudgetStatus(ctx, UsageQuery{ProjectID: project.ID}, now)
	require.NoError(t, err)
	require.Equal(t, statuses, current)
	require.Equal(t, "exceeded", current[0].State)
	require.Equal(t, deliveries, budgetNotificationRows(t, store))
}

func TestBudgetAcknowledgementRoutesValidateAndPersistContract(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	id := seedBudgetNotifications(t, store, 8)[0].AlertID
	r := router.New()
	NewHandler(store, nil).RegisterRoutes(r, func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
			ctx.SetUserValue(schemas.BifrostContextKeyUserID, "must-not-select-actor")
			next(ctx)
		}
	})
	base := "/api/control-plane/budget-alerts/"
	path := base + id + "/acknowledgement"
	// Missing/null, types, unknown/duplicate keys and trailing JSON must not
	// turn an acknowledgement into an unintended undo.
	for _, body := range []string{"", "null", "{}", "[]", `{"acknowledged":null}`, `{"acknowledged":"true"}`,
		`{"acknowledged":1}`, `{"acknowledged":true,"actor":"other"}`, `{"acknowledged":true} {}`,
		`{"acknowledged":true} rubbish`, `{"acknowledged":true,"acknowledged":false}`} {
		require.Equal(t, 400, receiptRequest(r, "PUT", path, body).Response.StatusCode(), body)
	}
	for _, invalid := range []string{"invalid", strings.ToUpper(id)} {
		require.Equal(t, 400, receiptRequest(r, "PUT", base+invalid+"/acknowledgement", `{"acknowledged":true}`).Response.StatusCode())
	}
	require.Equal(t, 404, receiptRequest(r, "PUT", base+uuid.NewString()+"/acknowledgement", `{"acknowledged":false}`).Response.StatusCode())
	for _, acknowledged := range []bool{false, true, false} {
		body, err := json.Marshal(map[string]bool{"acknowledged": acknowledged})
		require.NoError(t, err)
		response := receiptRequest(r, "PUT", path, string(body))
		require.Equal(t, 200, response.Response.StatusCode(), string(response.Response.Body()))
		var written map[string]any
		require.NoError(t, json.Unmarshal(response.Response.Body(), &written))
		require.Equal(t, acknowledged, written["acknowledged"])
		require.Equal(t, id, written["id"])
		if acknowledged {
			require.NotNil(t, written["acknowledged_at"])
			require.True(t, strings.HasSuffix(written["acknowledged_at"].(string), "Z"), "acknowledgement timestamps use UTC on both backends")
			require.Equal(t, budgetAcknowledgementActor, written["acknowledged_by"])
		} else {
			require.Contains(t, written, "acknowledged_at")
			require.Nil(t, written["acknowledged_at"])
			require.Contains(t, written, "acknowledged_by")
			require.Nil(t, written["acknowledged_by"])
		}
		list := receiptRequest(r, "GET", "/api/control-plane/budget-alerts", "")
		require.Equal(t, 200, list.Response.StatusCode())
		var page struct{ Data []map[string]any }
		require.NoError(t, json.Unmarshal(list.Response.Body(), &page))
		require.Equal(t, written, page.Data[0])
	}
	require.Equal(t, budgetAcknowledgementActor, acknowledgementAudits(t, store)[0].ActorID)
}

func TestBudgetAcknowledgementRoutesRequireAdminAndWriteGuard(t *testing.T) {
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
			request.Request.SetRequestURI("http://admin.test/api/control-plane/budget-alerts/" + id + "/acknowledgement")
			request.Request.Header.SetMethod("PUT")
			request.Request.Header.SetContentType(tc.contentType)
			request.Request.Header.Set("Origin", tc.origin)
			request.Request.SetBodyString(`{"acknowledged":true}`)
			request.SetUserValue(schemas.IsLocalAdminContextKey, tc.admin)
			request.SetUserValue(schemas.BifrostContextKeyAuthBypassed, tc.bypassed)
			r.Handler(request)
			require.Equal(t, tc.status, request.Response.StatusCode())
		})
	}
}

func TestBudgetAcknowledgementsBasicAndSessionUseTrustedActor(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	id := seedBudgetNotifications(t, store, 8)[0].AlertID
	hash, err := encrypt.Hash("ack-test-only")
	require.NoError(t, err)
	handlers.SetLogger(bifrost.NewDefaultLogger(schemas.LogLevelError))
	auth, err := handlers.InitAuthMiddleware(cs, nil, nil, "")
	require.NoError(t, err)
	auth.UpdateAuthConfig(&configstore.AuthConfig{IsEnabled: true,
		AdminUserName: schemas.NewSecretVar("operator"), AdminPassword: schemas.NewSecretVar(hash)})
	r := router.New()
	NewHandler(store, nil).RegisterRoutes(r, auth.APIMiddleware())
	path := "/api/control-plane/budget-alerts/" + id + "/acknowledgement"
	for _, password := range []string{"wrong", "ack-test-only"} {
		request := &fasthttp.RequestCtx{}
		request.Request.SetRequestURI("http://admin.test" + path)
		request.Request.Header.SetMethod("PUT")
		request.Request.Header.SetContentType("application/json")
		request.Request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("operator:"+password)))
		request.Request.SetBodyString(`{"acknowledged":true}`)
		r.Handler(request)
		if password == "wrong" {
			require.Equal(t, 401, request.Response.StatusCode())
		} else {
			require.Equal(t, 200, request.Response.StatusCode(), string(request.Response.Body()))
			require.Contains(t, string(request.Response.Body()), `"acknowledged_by":"local-admin"`)
		}
	}
	token := uuid.NewString()
	require.NoError(t, cs.CreateSession(context.Background(), &configtables.SessionsTable{
		Token: token, CreatedAt: time.Now(), UpdatedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour),
	}))
	request := &fasthttp.RequestCtx{}
	request.Request.SetRequestURI("http://admin.test" + path)
	request.Request.Header.SetMethod("PUT")
	request.Request.Header.SetContentType("application/json")
	request.Request.Header.SetCookie("token", token)
	request.Request.SetBodyString(`{"acknowledged":true}`)
	r.Handler(request)
	require.Equal(t, 200, request.Response.StatusCode(), string(request.Response.Body()))
	require.Len(t, acknowledgementAudits(t, store), 1, "sessions and Basic share the same administrator")
}

func TestBudgetAcknowledgementsListPreservesFilteringAndPagination(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Ack project"}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{Name: "Ack app", ProjectID: project.ID}
	require.NoError(t, store.CreateApplication(ctx, app))
	now := time.Now().UTC().Truncate(time.Microsecond)
	for index, scope := range []BudgetScope{{"project", project.ID}, {"application", app.ID}, {"project", uuid.NewString()}} {
		require.NoError(t, store.db(ctx).Transaction(func(tx *gorm.DB) error {
			_, err := createBudgetAlerts(tx, BudgetStatus{ScopeType: scope.Type, ScopeID: scope.ID,
				Window: "daily", PeriodStart: now.Truncate(24 * time.Hour), Usage: 8, Limit: 10}, now.Add(time.Duration(index)*time.Second))
			return err
		}))
	}
	all, err := store.ListBudgetAlerts(ctx, UsageQuery{})
	require.NoError(t, err)
	require.Len(t, all, 3)
	_, err = store.SetBudgetAcknowledgement(ctx, budgetAcknowledgementMutation{all[1].ID, true})
	require.NoError(t, err)
	projectRows, err := store.ListBudgetAlerts(ctx, UsageQuery{ProjectID: project.ID})
	require.NoError(t, err)
	require.Len(t, projectRows, 2, "project and its applications only")
	require.Equal(t, all[1].ID, projectRows[0].ID)
	require.True(t, projectRows[0].Acknowledged)
	require.False(t, projectRows[1].Acknowledged)
	page, err := store.ListBudgetAlerts(ctx, UsageQuery{ProjectID: project.ID, Limit: 1, Offset: 1})
	require.NoError(t, err)
	require.Equal(t, projectRows[1:], page)
	both, err := store.ListBudgetAlerts(ctx, UsageQuery{ProjectID: project.ID, ApplicationID: app.ID})
	require.NoError(t, err)
	require.Len(t, both, 1)
	require.Equal(t, app.ID, both[0].ScopeID)
	require.True(t, both[0].Acknowledged)
	empty, err := store.ListBudgetAlerts(ctx, UsageQuery{ProjectID: uuid.NewString()})
	require.NoError(t, err)
	require.NotNil(t, empty, "HTTP empty data must be an array")
	require.Empty(t, empty)
}
