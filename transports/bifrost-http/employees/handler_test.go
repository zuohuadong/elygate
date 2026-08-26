package employees

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
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

	sameOrigin := &fasthttp.RequestCtx{}
	sameOrigin.Request.Header.SetMethod(fasthttp.MethodPost)
	sameOrigin.Request.Header.SetContentType("application/json")
	sameOrigin.Request.SetHost("admin.example.test")
	sameOrigin.Request.Header.Set("Origin", "https://admin.example.test")
	sameOrigin.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(sameOrigin)
	require.Equal(t, fasthttp.StatusNoContent, sameOrigin.Response.StatusCode())
}
