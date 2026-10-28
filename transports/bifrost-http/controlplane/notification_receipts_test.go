package controlplane

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
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

func createReceiptNotification(t *testing.T, store *Store) string {
	t.Helper()
	id := uuid.NewString()
	require.NoError(t, store.db(context.Background()).Create(&configtables.TableNotification{
		ID: id, Audience: "admin", Severity: "warning", Title: "Budget", Message: "Threshold reached",
		CreatedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(time.Hour),
	}).Error)
	return id
}

func receiptAudits(t *testing.T, store *Store) []AuditEvent {
	t.Helper()
	var events []AuditEvent
	require.NoError(t, store.db(context.Background()).Where("resource_type = ?", "notification").Order("created_at").Find(&events).Error)
	return events
}

func TestNotificationReceiptsPersistIdempotentlyAndPreserveUpstreamEvent(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	id, unreadID := createReceiptNotification(t, store), createReceiptNotification(t, store)
	var original configtables.TableNotification
	require.NoError(t, cs.DB().First(&original, "id = ?", id).Error)
	mutation := notificationReadMutation{NotificationID: id, Read: true}
	first, err := store.SetNotificationReadState(ctx, mutation)
	require.NoError(t, err)
	require.True(t, first.Read)
	require.NotNil(t, first.ReadAt)
	reopened, err := NewStore(ctx, cs)
	require.NoError(t, err)
	retry, err := reopened.SetNotificationReadState(ctx, mutation)
	require.NoError(t, err)
	require.WithinDuration(t, *first.ReadAt, *retry.ReadAt, time.Microsecond)
	states, err := reopened.NotificationReadStates(ctx, []string{unreadID, id})
	require.NoError(t, err)
	require.Equal(t, unreadID, states[0].NotificationID)
	require.False(t, states[0].Read)
	require.Nil(t, states[0].ReadAt)
	require.True(t, states[1].Read)
	require.Len(t, receiptAudits(t, store), 1)
	mutation.Read = false
	for range 2 {
		state, err := reopened.SetNotificationReadState(ctx, mutation)
		require.NoError(t, err)
		require.False(t, state.Read)
		require.Nil(t, state.ReadAt)
	}
	events := receiptAudits(t, store)
	require.Len(t, events, 2)
	require.Equal(t, []string{"notification.read", "notification.unread"}, []string{events[0].Action, events[1].Action})
	require.Equal(t, localAdminReceiptPrincipal, events[0].ActorID)
	var unchanged configtables.TableNotification
	require.NoError(t, cs.DB().First(&unchanged, "id = ?", id).Error)
	require.Equal(t, original, unchanged)
}

func TestNotificationReceiptsRollbackWithAuditFailure(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	id := createReceiptNotification(t, store)
	db := store.db(ctx)
	failAudit := false
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:receipt-audit", func(tx *gorm.DB) {
		if failAudit && tx.Statement.Table == (AuditEvent{}).TableName() {
			tx.AddError(errors.New("receipt audit unavailable"))
		}
	}))
	t.Cleanup(func() { db.Callback().Create().Remove("test:receipt-audit") })
	failAudit = true
	_, err := store.SetNotificationReadState(ctx, notificationReadMutation{id, true})
	require.ErrorContains(t, err, "receipt audit unavailable")
	states, err := store.NotificationReadStates(ctx, []string{id})
	require.NoError(t, err)
	require.False(t, states[0].Read)
	failAudit = false
	_, err = store.SetNotificationReadState(ctx, notificationReadMutation{id, true})
	require.NoError(t, err)
	failAudit = true
	_, err = store.SetNotificationReadState(ctx, notificationReadMutation{id, false})
	require.ErrorContains(t, err, "receipt audit unavailable")
	states, err = store.NotificationReadStates(ctx, []string{id})
	require.NoError(t, err)
	require.True(t, states[0].Read)
	require.Len(t, receiptAudits(t, store), 1)
}

func TestNotificationReceiptsExpiryCascadeAndMissingEvents(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	id := createReceiptNotification(t, store)
	_, err := store.SetNotificationReadState(ctx, notificationReadMutation{id, true})
	require.NoError(t, err)
	expired := time.Now().UTC().Add(-time.Second)
	require.NoError(t, store.db(ctx).Model(&configtables.TableNotification{}).Where("id = ?", id).
		Update("expires_at", expired).Error)
	require.NoError(t, store.db(ctx).Model(&notificationReceipt{}).Where("notification_id = ?", id).
		Update("expires_at", expired).Error)
	for _, missingID := range []string{id, uuid.NewString()} {
		_, err = store.NotificationReadStates(ctx, []string{missingID})
		require.ErrorIs(t, err, gorm.ErrRecordNotFound)
		for _, read := range []bool{false, true} {
			_, err = store.SetNotificationReadState(ctx, notificationReadMutation{missingID, read})
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
		}
	}
	monitor := NewBudgetMonitor(ctx, NewHandler(store, nil), nil)
	monitor.sweep(ctx)
	var count int64
	require.NoError(t, store.db(ctx).Model(&notificationReceipt{}).Count(&count).Error)
	require.Zero(t, count, "cleanup runs even with no usage source")
	id = createReceiptNotification(t, store)
	_, err = store.SetNotificationReadState(ctx, notificationReadMutation{id, true})
	require.NoError(t, err)
	require.NoError(t, store.db(ctx).Delete(&configtables.TableNotification{}, "id = ?", id).Error)
	require.NoError(t, store.db(ctx).Model(&notificationReceipt{}).Count(&count).Error)
	require.Zero(t, count, "physical notification deletion cascades")
	orphan := &notificationReceipt{PrincipalID: localAdminReceiptPrincipal, NotificationID: uuid.NewString(), ReadAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour)}
	require.Error(t, store.db(ctx).Create(orphan).Error, "FK rejects orphan receipt")
	require.Len(t, receiptAudits(t, store), 2, "cleanup does not invent user actions")
}

func TestNotificationReceiptsConcurrentReadAndUnreadAreIdempotent(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	other, err := NewStore(context.Background(), cs)
	require.NoError(t, err)
	id := createReceiptNotification(t, store)
	for _, read := range []bool{true, false} {
		var writers sync.WaitGroup
		failures := make(chan error, 12)
		for index := range 12 {
			writers.Go(func() {
				writer := []*Store{store, other}[index%2]
				_, err := writer.SetNotificationReadState(context.Background(), notificationReadMutation{id, read})
				failures <- err
			})
		}
		writers.Wait()
		close(failures)
		for err := range failures {
			require.NoError(t, err)
		}
	}
	require.Len(t, receiptAudits(t, store), 2)
}

func receiptRequest(r *router.Router, method, path, body string) *fasthttp.RequestCtx {
	request := &fasthttp.RequestCtx{}
	request.Request.SetRequestURI("http://admin.test" + path)
	request.Request.Header.SetMethod(method)
	request.Request.Header.SetContentType("application/json")
	request.Request.SetBodyString(body)
	r.Handler(request)
	return request
}

func TestNotificationReceiptRoutesValidatePayloadAndIDs(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	id := createReceiptNotification(t, store)
	r := router.New()
	NewHandler(store, nil).RegisterRoutes(r, func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
			ctx.SetUserValue(schemas.BifrostContextKeyUserID, "client-must-not-choose-principal")
			next(ctx)
		}
	})
	base := "/api/control-plane/notification-receipts"
	// Boundary cases are distinct: absent/null, invalid types/unknown fields,
	// trailing values, empty/duplicate/noncanonical IDs and 1/50/51 requests.
	for _, body := range []string{"", "null", "{}", `{"read":null}`, `{"read":1}`, `{"read":"true"}`,
		`{"read":true,"actor":"other"}`, `{"read":true} {}`, `{"read":true} rubbish`} {
		require.Equal(t, 400, receiptRequest(r, "PUT", base+"/"+id, body).Response.StatusCode(), body)
	}
	for _, path := range []string{base, base + "?notification_id=", base + "?notification_id=invalid",
		base + "?notification_id=" + strings.ToUpper(id), base + "?notification_id=" + id + "&notification_id=" + id} {
		require.Equal(t, 400, receiptRequest(r, "GET", path, "").Response.StatusCode(), path)
	}
	require.Equal(t, 404, receiptRequest(r, "PUT", base+"/"+uuid.NewString(), `{"read":true}`).Response.StatusCode())
	query := url.Values{}
	for range 50 {
		query.Add("notification_id", createReceiptNotification(t, store))
	}
	require.Equal(t, 200, receiptRequest(r, "GET", base+"?"+query.Encode(), "").Response.StatusCode())
	query.Add("notification_id", id)
	require.Equal(t, 400, receiptRequest(r, "GET", base+"?"+query.Encode(), "").Response.StatusCode())
	response := receiptRequest(r, "PUT", base+"/"+id, `{"read":true}`)
	require.Equal(t, 200, response.Response.StatusCode(), string(response.Response.Body()))
	var written NotificationReadState
	require.NoError(t, json.Unmarshal(response.Response.Body(), &written))
	require.True(t, written.Read)
	response = receiptRequest(r, "GET", base+"?notification_id="+id, "")
	require.Equal(t, 200, response.Response.StatusCode())
	var page struct{ Data []NotificationReadState }
	require.NoError(t, json.Unmarshal(response.Response.Body(), &page))
	require.Len(t, page.Data, 1)
	require.True(t, page.Data[0].Read)
	require.Equal(t, localAdminReceiptPrincipal, receiptAudits(t, store)[0].ActorID)
}

func TestNotificationReceiptRoutesRejectAmbiguousMutationsWithoutSideEffects(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	id := createReceiptNotification(t, store)
	r := router.New()
	NewHandler(store, nil).RegisterRoutes(r, func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
			next(ctx)
		}
	})
	path := "/api/control-plane/notification-receipts/" + id
	for _, initial := range []bool{false, true} {
		body, err := json.Marshal(map[string]bool{"read": initial})
		require.NoError(t, err)
		require.Equal(t, 200, receiptRequest(r, "PUT", path, string(body)).Response.StatusCode())
		before, err := store.NotificationReadStates(context.Background(), []string{id})
		require.NoError(t, err)
		audits := receiptAudits(t, store)
		// Reject duplicate/case-variant keys in either state, including a
		// repeated identical value that would otherwise look idempotent.
		for _, invalid := range []string{
			`{"read":true,"read":false}`, `{"read":false,"read":true}`,
			`{"read":true,"read":true}`, `{"read":false,"read":false}`,
			`{"read":false,"\u0072ead":true}`, `{"\u0072ead":true,"read":false}`,
			`{"Read":true}`, `{"Read":false}`, `{"read":false,"Read":true}`,
		} {
			response := receiptRequest(r, "PUT", path, invalid)
			require.Equal(t, 400, response.Response.StatusCode(), invalid)
			after, err := store.NotificationReadStates(context.Background(), []string{id})
			require.NoError(t, err)
			require.Equal(t, before, after, invalid)
			require.Equal(t, audits, receiptAudits(t, store), invalid)
		}
	}
}

func TestNotificationReceiptRoutesRequireRealAdminAndJSONHostGuard(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	id := createReceiptNotification(t, store)
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
			NewHandler(store, nil).RegisterRoutes(r, func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
				return func(ctx *fasthttp.RequestCtx) {
					ctx.SetUserValue(schemas.IsLocalAdminContextKey, tc.admin)
					ctx.SetUserValue(schemas.BifrostContextKeyAuthBypassed, tc.bypassed)
					next(ctx)
				}
			})
			request := &fasthttp.RequestCtx{}
			request.Request.SetRequestURI("http://admin.test/api/control-plane/notification-receipts/" + id)
			request.Request.Header.SetMethod("PUT")
			request.Request.Header.SetContentType(tc.contentType)
			request.Request.Header.Set("Origin", tc.origin)
			request.Request.SetBodyString(`{"read":true}`)
			r.Handler(request)
			require.Equal(t, tc.status, request.Response.StatusCode())
		})
	}
}

func TestNotificationReceiptBasicAndSessionShareLocalAdminState(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	id := createReceiptNotification(t, store)
	hash, err := encrypt.Hash("receipt-test-only")
	require.NoError(t, err)
	handlers.SetLogger(bifrost.NewDefaultLogger(schemas.LogLevelError))
	auth, err := handlers.InitAuthMiddleware(cs, nil, nil, "")
	require.NoError(t, err)
	auth.UpdateAuthConfig(&configstore.AuthConfig{IsEnabled: true,
		AdminUserName: schemas.NewSecretVar("operator"), AdminPassword: schemas.NewSecretVar(hash)})
	r := router.New()
	NewHandler(store, nil).RegisterRoutes(r, auth.APIMiddleware())
	for _, password := range []string{"wrong", "receipt-test-only"} {
		request := &fasthttp.RequestCtx{}
		request.Request.SetRequestURI("http://admin.test/api/control-plane/notification-receipts/" + id)
		request.Request.Header.SetMethod("PUT")
		request.Request.Header.SetContentType("application/json")
		request.Request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("operator:"+password)))
		request.Request.SetBodyString(`{"read":true}`)
		r.Handler(request)
		if password == "wrong" {
			require.Equal(t, 401, request.Response.StatusCode())
		} else {
			require.Equal(t, 200, request.Response.StatusCode(), string(request.Response.Body()))
		}
	}
	for range 2 {
		token := uuid.NewString()
		require.NoError(t, cs.CreateSession(context.Background(), &configtables.SessionsTable{
			Token: token, CreatedAt: time.Now(), UpdatedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour),
		}))
		request := &fasthttp.RequestCtx{}
		request.Request.SetRequestURI("http://admin.test/api/control-plane/notification-receipts?notification_id=" + id)
		request.Request.Header.SetCookie("token", token)
		r.Handler(request)
		require.Equal(t, 200, request.Response.StatusCode(), string(request.Response.Body()))
		require.Contains(t, string(request.Response.Body()), `"read":true`)
	}
	require.Len(t, receiptAudits(t, store), 1)
}
