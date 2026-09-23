package employees

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
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
