package server

import (
	"testing"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestRoutingSimulationRouteGuards(t *testing.T) {
	for _, tc := range []struct {
		name, contentType, origin string
		admin, bypassed           bool
		status                    int
	}{
		{name: "anonymous", contentType: "application/json", status: 401},
		{name: "admin", admin: true, contentType: "application/json", status: 200},
		{name: "same origin", admin: true, contentType: "application/json; charset=utf-8", origin: "http://gateway.test", status: 200},
		{name: "bypass denied", admin: true, bypassed: true, contentType: "application/json", status: 403},
		{name: "wrong media type", admin: true, contentType: "text/plain", status: 415},
		{name: "cross origin", admin: true, contentType: "application/json", origin: "https://other.test", status: 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := &BifrostHTTPServer{Router: router.New(), ControlPlaneHandler: controlplane.NewHandler(nil, nil)}
			middlewareCalled := false
			server.registerRoutingSimulationRoute(func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
				return func(ctx *fasthttp.RequestCtx) {
					middlewareCalled = true
					ctx.SetUserValue(schemas.IsLocalAdminContextKey, tc.admin)
					ctx.SetUserValue(schemas.BifrostContextKeyAuthBypassed, tc.bypassed)
					next(ctx)
				}
			})
			var ctx fasthttp.RequestCtx
			ctx.Request.Header.SetMethod(fasthttp.MethodPost)
			ctx.Request.Header.SetContentType(tc.contentType)
			ctx.Request.SetRequestURI("http://gateway.test/api/control-plane/routing/simulate")
			if tc.origin != "" {
				ctx.Request.Header.Set("Origin", tc.origin)
			}
			ctx.Request.SetBodyString(`{"rules":[],"samples":[{"model":"input","request_type":"chat_completion"}],"chain_max_depth":10}`)
			server.Router.Handler(&ctx)
			require.True(t, middlewareCalled)
			require.Equal(t, tc.status, ctx.Response.StatusCode(), string(ctx.Response.Body()))
		})
	}
}
