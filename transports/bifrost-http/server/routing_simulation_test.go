package server

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
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

func TestRoutingDraftServerCompilerAndPersistence(t *testing.T) {
	ctx := context.Background()
	cs, err := configstore.NewConfigStore(ctx, &configstore.Config{
		Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "routing-drafts.db")},
	}, noopTestLogger{})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, cs.Close(ctx)) })
	store, err := controlplane.NewStore(ctx, cs)
	require.NoError(t, err)
	require.NoError(t, cs.CreateRoutingRule(ctx, &configtables.TableRoutingRule{
		ID: "live-before-draft", Name: "Live baseline", Scope: "global", CelExpression: "true",
		Targets: []configtables.TableRoutingTarget{{Weight: 1}},
	}))
	liveBefore, err := cs.GetRoutingRules(ctx)
	require.NoError(t, err)
	server := &BifrostHTTPServer{Router: router.New(), ControlPlaneHandler: controlplane.NewHandler(store, nil)}
	middlewareCalls := 0
	server.registerRoutingSimulationRoute(func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(request *fasthttp.RequestCtx) {
			middlewareCalls++
			request.SetUserValue(schemas.IsLocalAdminContextKey, true)
			next(request)
		}
	})
	requestDraft := func(method, path, body string, status int) []byte {
		t.Helper()
		var request fasthttp.RequestCtx
		request.Request.Header.SetMethod(method)
		request.Request.Header.SetContentType("application/json")
		request.Request.SetRequestURI("http://gateway.test" + path)
		request.Request.SetBodyString(body)
		server.Router.Handler(&request)
		require.Equal(t, status, request.Response.StatusCode(), string(request.Response.Body()))
		require.Equal(t, "no-store", string(request.Response.Header.Peek("Cache-Control")))
		return append([]byte(nil), request.Response.Body()...)
	}
	const collection = "/api/control-plane/routing/drafts"
	validRules := `[{"id":"candidate-rule","name":"Candidate rule","cel_expression":"model == 'input'","targets":[{"model":"target","weight":1}]}]`
	unknownFallback := `[{"name":"Unknown fallback field","targets":[{"weight":1}],"fallbacks":[{"provider":"openai","model":"mini","api_key":"invalid-field-marker"}]}]`
	for _, rules := range []string{
		"null", "{}", "[null]",
		`[{"name":"Invalid CEL","cel_expression":"model ==","targets":[{"weight":1}]}]`,
		`[{"name":"Unknown target field","targets":[{"weight":1,"credential":"not-allowed"}]}]`,
		`[{"name":"Duplicate A","targets":[{"weight":1}]},{"name":"Duplicate B","targets":[{"weight":1}]}]`,
		unknownFallback,
	} {
		requestDraft("POST", collection, `{"name":"Invalid","chain_max_depth":10,"rules":`+rules+`}`, 400)
	}
	created := requestDraft("POST", collection, `{"name":"Durable candidate","chain_max_depth":10,"rules":`+validRules+`}`, 201)
	var response struct {
		ID       string          `json:"id"`
		Revision int64           `json:"revision"`
		Rules    json.RawMessage `json:"rules"`
	}
	require.NoError(t, json.Unmarshal(created, &response))
	require.NotEmpty(t, response.ID)
	require.EqualValues(t, 1, response.Revision)
	require.JSONEq(t, validRules, string(response.Rules))
	requestDraft("PUT", collection+"/"+response.ID,
		`{"name":"Must not persist","chain_max_depth":10,"expected_revision":1,"rules":`+unknownFallback+`}`, 400)
	loaded := requestDraft("GET", collection+"/"+response.ID, "", 200)
	require.JSONEq(t, string(created), string(loaded))
	reopened, err := controlplane.NewStore(ctx, cs)
	require.NoError(t, err)
	saved, err := reopened.GetRoutingDraft(ctx, response.ID)
	require.NoError(t, err)
	require.JSONEq(t, validRules, saved.RulesJSON)
	drafts, err := reopened.ListRoutingDrafts(ctx, 100, 0)
	require.NoError(t, err)
	require.Len(t, drafts, 1, "rejected candidates must not be persisted")
	audits, err := reopened.ListAudit(ctx, 100)
	require.NoError(t, err)
	require.Len(t, audits, 1, "rejected candidates must not append success events")
	liveAfter, err := cs.GetRoutingRules(ctx)
	require.NoError(t, err)
	require.Equal(t, liveBefore, liveAfter)
	require.Equal(t, 10, middlewareCalls)
}
