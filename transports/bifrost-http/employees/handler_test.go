package employees

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func TestAdminAccessMiddlewareRequiresAuthenticatedAdmin(t *testing.T) {
	h := &Handler{}
	called := false
	next := func(ctx *fasthttp.RequestCtx) {
		called = true
		ctx.SetStatusCode(fasthttp.StatusNoContent)
	}
	middleware := h.AdminAccessMiddleware()(next)

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodPost)
	ctx.Request.Header.SetContentType("application/json")
	ctx.Request.SetHost("admin.example.test")
	ctx.SetUserValue(schemas.BifrostContextKeyAuthBypassed, true)
	middleware(ctx)

	require.False(t, called)
	require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode())
}

func TestAdminAccessMiddlewareRejectsCrossOriginAndNonJSONWrites(t *testing.T) {
	h := &Handler{}
	next := func(ctx *fasthttp.RequestCtx) { ctx.SetStatusCode(fasthttp.StatusNoContent) }
	middleware := h.AdminAccessMiddleware()(next)

	nonJSON := &fasthttp.RequestCtx{}
	nonJSON.Request.Header.SetMethod(fasthttp.MethodPost)
	nonJSON.Request.Header.SetContentType("text/plain")
	nonJSON.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(nonJSON)
	require.Equal(t, fasthttp.StatusUnsupportedMediaType, nonJSON.Response.StatusCode())

	crossOrigin := &fasthttp.RequestCtx{}
	crossOrigin.Request.Header.SetMethod(fasthttp.MethodPost)
	crossOrigin.Request.Header.SetContentType("application/json")
	crossOrigin.Request.SetHost("admin.example.test")
	crossOrigin.Request.Header.Set("Origin", "https://attacker.example.test")
	crossOrigin.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(crossOrigin)
	require.Equal(t, fasthttp.StatusForbidden, crossOrigin.Response.StatusCode())

	spoofedForwardedHost := &fasthttp.RequestCtx{}
	spoofedForwardedHost.Request.Header.SetMethod(fasthttp.MethodPost)
	spoofedForwardedHost.Request.Header.SetContentType("application/json")
	spoofedForwardedHost.Request.SetHost("admin.example.test")
	spoofedForwardedHost.Request.Header.Set("Origin", "https://attacker.example.test")
	spoofedForwardedHost.Request.Header.Set("X-Forwarded-Host", "attacker.example.test")
	spoofedForwardedHost.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(spoofedForwardedHost)
	require.Equal(t, fasthttp.StatusForbidden, spoofedForwardedHost.Response.StatusCode())

	sameOrigin := &fasthttp.RequestCtx{}
	sameOrigin.Request.Header.SetMethod(fasthttp.MethodPost)
	sameOrigin.Request.Header.SetContentType("application/json")
	sameOrigin.Request.SetHost("admin.example.test")
	sameOrigin.Request.Header.Set("Origin", "https://admin.example.test")
	sameOrigin.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(sameOrigin)
	require.Equal(t, fasthttp.StatusNoContent, sameOrigin.Response.StatusCode())
}

func TestLogoutPreservesSessionCookieWhenDeletionFails(t *testing.T) {
	store, _ := testStore(t)
	ctx := context.Background()
	employee := &Employee{Username: "logout-user", Name: "Logout User", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "StrongPassword!123", nil))
	const token = "employee-session-token"
	const csrf = "employee-session-csrf"
	require.NoError(t, store.CreateSession(ctx, employee.ID, encrypt.HashSHA256(token), encrypt.HashSHA256(csrf), time.Now().Add(time.Hour)))
	require.NoError(t, store.db(ctx).Exec(`CREATE TRIGGER block_employee_session_delete BEFORE DELETE ON elygate_employee_sessions BEGIN SELECT RAISE(ABORT, 'delete blocked'); END`).Error)

	h := &Handler{store: store}
	req := &fasthttp.RequestCtx{}
	req.Init(&fasthttp.Request{}, &net.TCPAddr{IP: net.ParseIP("192.0.2.10"), Port: 12001}, nil)
	req.Request.Header.Set("Cookie", employeeCookieName+"="+token)
	req.Request.Header.Set("X-CSRF-Token", csrf)
	h.logout(req)

	require.Equal(t, fasthttp.StatusInternalServerError, req.Response.StatusCode())
	require.Empty(t, req.Response.Header.Peek("Set-Cookie"))
}

func TestEmployeeAdministrationBindsAuditToRequestAndFailsClosed(t *testing.T) {
	store, configStore := testStore(t)
	h := &Handler{store: store, configStore: configStore}
	for _, configured := range []bool{false, true} {
		t.Run(map[bool]string{false: "unconfigured", true: "failure"}[configured], func(t *testing.T) {
			request := &fasthttp.RequestCtx{}
			if configured {
				h.SetAuditAppenderFactory(func(captured *fasthttp.RequestCtx) EmployeeAuditAppender {
					require.Same(t, request, captured)
					return func(context.Context, *gorm.DB, EmployeeAuditEvent) error {
						return errors.New("signing failed")
					}
				})
			}
			employee := &Employee{Username: "audit.rollback", Name: "Rollback", IsActive: true}
			err := h.administrationStore(request).Create(context.Background(), employee, "StrongPassword!123", nil)
			require.ErrorIs(t, err, ErrEmployeeAudit)
			_, err = store.Get(context.Background(), employee.ID)
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
			require.True(t, sendAuditFailure(request, ErrEmployeeAudit))
			require.Equal(t, fasthttp.StatusInternalServerError, request.Response.StatusCode())
			require.NotContains(t, string(request.Response.Body()), "temporary_password")
		})
	}
}

func TestEmployeeMutationContextIsBounded(t *testing.T) {
	ctx, cancel := employeeMutationContext()
	defer cancel()
	deadline, ok := ctx.Deadline()
	require.True(t, ok)
	require.WithinDuration(t, time.Now().Add(30*time.Second), deadline, time.Second)
	select {
	case <-ctx.Done():
		t.Fatal("new mutation context must not already be cancelled")
	default:
	}
	cancel()
	require.ErrorIs(t, ctx.Err(), context.Canceled)
}

func TestEmployeeAdministrativeRoutesFailWithoutCommittingWhenAuditFails(t *testing.T) {
	store, configStore := testStore(t)
	ctx := context.Background()
	for _, id := range []string{"vk-route-existing", "vk-route-imported", "vk-route-create", "vk-route-import"} {
		seedVirtualKey(t, configStore, id, "sk-bf-"+id)
	}
	employee := &Employee{Username: "route.existing", Name: "Before", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", []string{"vk-route-existing"}))
	require.NoError(t, store.CreateSession(ctx, employee.ID, "route-token", "route-csrf", time.Now().Add(time.Hour)))
	imported := &Employee{Username: "route.imported", Name: "Imported", IsActive: true}
	_, err := store.BulkCreateImport(ctx, "batch-route-existing", "digest", []BulkCreateEntry{{
		Employee: imported, Password: "StrongPassword!123", VirtualKeyIDs: []string{"vk-route-imported"},
	}})
	require.NoError(t, err)
	h := &Handler{store: store, configStore: configStore}
	auditAttempts := 0
	h.SetAuditAppenderFactory(func(*fasthttp.RequestCtx) EmployeeAuditAppender {
		return func(context.Context, *gorm.DB, EmployeeAuditEvent) error {
			auditAttempts++
			return errors.New("audit unavailable")
		}
	})
	r := router.New()
	h.RegisterRoutes(r)
	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{fasthttp.MethodPost, "/api/employees", `{"username":"route.created","name":"Create","virtual_key_ids":["vk-route-create"]}`},
		{fasthttp.MethodPost, "/api/employees/import", `{"batch_id":"batch-route-new","employees":[{"username":"route.newimport","name":"New","virtual_key_ids":["vk-route-import"],"temporary_password":"ImportPassword!123"}]}`},
		{fasthttp.MethodPut, "/api/employees/" + employee.ID, `{"username":"route.existing","name":"After","is_active":false,"virtual_key_ids":["vk-route-existing"]}`},
		{fasthttp.MethodPost, "/api/employees/" + employee.ID + "/reset-password", `{}`},
		{fasthttp.MethodDelete, "/api/employees/import/batch-route-existing", `{}`},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			request := &fasthttp.RequestCtx{}
			request.Request.Header.SetMethod(tc.method)
			request.Request.Header.SetContentType("application/json")
			request.Request.SetRequestURI(tc.path)
			request.Request.SetBodyString(tc.body)
			request.SetUserValue(schemas.IsLocalAdminContextKey, true)
			r.Handler(request)
			require.Equal(t, fasthttp.StatusInternalServerError, request.Response.StatusCode(), string(request.Response.Body()))
			require.NotContains(t, string(request.Response.Body()), "temporary_password")
			require.NotContains(t, string(request.Response.Body()), "audit unavailable")
		})
	}
	require.Equal(t, 5, auditAttempts)
	current, err := store.Get(ctx, employee.ID)
	require.NoError(t, err)
	require.Equal(t, "Before", current.Name)
	require.True(t, current.IsActive)
	require.Equal(t, employee.PasswordHash, current.PasswordHash)
	current, err = store.Get(ctx, imported.ID)
	require.NoError(t, err)
	require.True(t, current.IsActive)
	_, _, err = store.Session(ctx, "route-token")
	require.NoError(t, err)
	employees, err := store.List(ctx)
	require.NoError(t, err)
	require.Len(t, employees, 2)
	var batch EmployeeImportBatch
	require.ErrorIs(t, store.db(ctx).First(&batch, "id = ?", "batch-route-new").Error, gorm.ErrRecordNotFound)

	request := &fasthttp.RequestCtx{}
	request.Request.Header.SetMethod(fasthttp.MethodPost)
	request.Request.Header.SetContentType("application/json")
	request.Request.SetRequestURI("/api/employees")
	r.Handler(request)
	require.Equal(t, fasthttp.StatusUnauthorized, request.Response.StatusCode())
	require.Equal(t, 5, auditAttempts, "authorization failure must not attempt a mutation or audit")
}
