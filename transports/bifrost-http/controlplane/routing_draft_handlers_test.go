package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

const routingDraftCollection = "/api/control-plane/routing/drafts"
const routingDraftFixture = `{"name":"Candidate","rules":[],"chain_max_depth":10}`

type routingDraftHTTPRequest struct {
	method, path, body, mediaType, origin string
	admin, bypass                         bool
	status                                int
}

func serveRoutingDraftRequest(t *testing.T, r *router.Router, request routingDraftHTTPRequest) *fasthttp.RequestCtx {
	t.Helper()
	var ctx fasthttp.RequestCtx
	ctx.Request.Header.SetMethod(request.method)
	ctx.Request.Header.SetContentType(request.mediaType)
	ctx.Request.Header.Set("Origin", request.origin)
	ctx.Request.SetRequestURI("http://gateway.test" + request.path)
	ctx.Request.SetBodyString(request.body)
	ctx.SetUserValue(schemas.IsLocalAdminContextKey, request.admin)
	ctx.SetUserValue(schemas.BifrostContextKeyAuthBypassed, request.bypass)
	ctx.SetUserValue(schemas.BifrostContextKeyUserID, "draft-admin")
	r.Handler(&ctx)
	require.Equal(t, request.status, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.Equal(t, "no-store", string(ctx.Response.Header.Peek("Cache-Control")))
	return &ctx
}

func routingDraftHTTPRouter(store *Store) *router.Router {
	r := router.New()
	NewHandler(store, nil).RegisterRoutingDraftRoutes(r, func(rules string) error {
		if strings.TrimSpace(rules) != "[]" {
			return errors.New("fixture compiler rejected rules")
		}
		return nil
	})
	return r
}

func TestRoutingDraftHTTPGuardsEveryRoute(t *testing.T) {
	r := router.New()
	NewHandler(nil, nil).RegisterRoutingDraftRoutes(r, func(string) error {
		t.Fatal("denied requests must not reach compilation")
		return nil
	})
	detail := routingDraftCollection + "/" + uuid.NewString()
	for _, route := range []struct{ method, path string }{
		{"GET", routingDraftCollection}, {"GET", detail},
		{"POST", routingDraftCollection}, {"PUT", detail}, {"DELETE", detail},
	} {
		t.Run(route.method+route.path, func(t *testing.T) {
			serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
				method: route.method, path: route.path, body: routingDraftFixture, mediaType: "application/json", status: 401,
			})
			serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
				method: route.method, path: route.path, body: routingDraftFixture, mediaType: "application/json",
				admin: true, bypass: true, status: 403,
			})
			if route.method != "GET" {
				serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
					method: route.method, path: route.path, body: routingDraftFixture, mediaType: "text/plain",
					admin: true, status: 415,
				})
				serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
					method: route.method, path: route.path, body: routingDraftFixture, mediaType: "application/json",
					admin: true, origin: "https://elsewhere.test", status: 403,
				})
			}
		})
	}
}

func TestRoutingDraftHTTPRejectsInvalidPayloadWithoutMutations(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	r := routingDraftHTTPRouter(store)
	// Cases: missing/null/wrong types, unknown fields, trailing JSON and name/depth/body bounds.
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"empty", "", 400}, {"malformed", "{", 400}, {"null", "null", 400},
		{"unknown", `{"name":"Candidate","rules":[],"chain_max_depth":10,"samples":[]}`, 400},
		{"trailing", routingDraftFixture + " {}", 400},
		{"missing name", `{"rules":[],"chain_max_depth":10}`, 400},
		{"blank name", `{"name":" \t","rules":[],"chain_max_depth":10}`, 400},
		{"control name", `{"name":"A\nB","rules":[],"chain_max_depth":10}`, 400},
		{"long name", `{"name":"` + strings.Repeat("a", 129) + `","rules":[],"chain_max_depth":10}`, 400},
		{"missing rules", `{"name":"Candidate","chain_max_depth":10}`, 400},
		{"null rules", `{"name":"Candidate","rules":null,"chain_max_depth":10}`, 400},
		{"rules type", `{"name":"Candidate","rules":{},"chain_max_depth":10}`, 400},
		{"compiler rejects", `{"name":"Candidate","rules":[{}],"chain_max_depth":10}`, 400},
		{"missing depth", `{"name":"Candidate","rules":[]}`, 400},
		{"zero depth", `{"name":"Candidate","rules":[],"chain_max_depth":0}`, 400},
		{"large depth", `{"name":"Candidate","rules":[],"chain_max_depth":21}`, 400},
		{"fractional depth", `{"name":"Candidate","rules":[],"chain_max_depth":1.5}`, 400},
		{"create revision", `{"name":"Candidate","rules":[],"chain_max_depth":10,"expected_revision":1}`, 400},
		{"oversized", strings.Repeat(" ", maxRoutingDraftBytes+1), 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
				method: "POST", path: routingDraftCollection, body: tc.body, mediaType: "application/json", admin: true, status: tc.status,
			})
		})
	}
	drafts, err := store.ListRoutingDrafts(context.Background(), 100, 0)
	require.NoError(t, err)
	require.Empty(t, drafts)
	require.Empty(t, routingDraftAudits(t, store))
}

func TestRoutingDraftHTTPRevisionAndIdentifierBounds(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	r := routingDraftHTTPRouter(store)
	draft, err := store.CreateRoutingDraft(context.Background(), RoutingDraftContent{Name: "Original", RulesJSON: "[]", ChainMaxDepth: 10})
	require.NoError(t, err)
	detail := routingDraftCollection + "/" + draft.ID
	for _, method := range []string{"PUT", "DELETE"} {
		for _, revision := range []string{"", "null", "0", "-1", "1.5", `"1"`, "9007199254740991", "9007199254740992", "9223372036854775808"} {
			t.Run(method+"/revision/"+revision, func(t *testing.T) {
				body := `{"name":"Replacement","rules":[],"chain_max_depth":10`
				if method == "DELETE" {
					body = "{"
				} else if revision != "" {
					body += ","
				}
				if revision != "" {
					body += `"expected_revision":` + revision
				}
				serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
					method: method, path: detail, body: body + "}", mediaType: "application/json", admin: true, status: 400,
				})
			})
		}
	}
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		for _, id := range []string{"not-a-uuid", strings.ToUpper(draft.ID), "{" + draft.ID + "}", strings.ReplaceAll(draft.ID, "-", "")} {
			t.Run(method+"/id/"+id, func(t *testing.T) {
				serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
					method: method, path: routingDraftCollection + "/" + id, body: `{"expected_revision":1}`,
					mediaType: "application/json", admin: true, status: 400,
				})
			})
		}
	}
	persisted, err := store.GetRoutingDraft(context.Background(), draft.ID)
	require.NoError(t, err)
	requireRoutingDraftEqual(t, draft, persisted)
	require.Len(t, routingDraftAudits(t, store), 1)
}

func TestRoutingDraftHTTPRoundTripPaginationAndConflict(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	r := routingDraftHTTPRouter(store)
	name := strings.Repeat("\u754c", 128)
	body, err := json.Marshal(map[string]any{"name": " " + name + " ", "rules": []any{}, "chain_max_depth": 20})
	require.NoError(t, err)
	created := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "POST", path: routingDraftCollection, body: string(body), mediaType: "application/json; charset=utf-8",
		origin: "http://gateway.test", admin: true, status: 201,
	})
	var original routingDraftResponse
	require.NoError(t, json.Unmarshal(created.Response.Body(), &original))
	require.NotNil(t, original.RoutingDraft)
	require.Equal(t, name, original.Name)
	require.EqualValues(t, 1, original.Revision)
	require.JSONEq(t, "[]", string(original.Rules))
	detail := routingDraftCollection + "/" + original.ID
	loaded := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: detail, admin: true, status: 200})
	var retrieved routingDraftResponse
	require.NoError(t, json.Unmarshal(loaded.Response.Body(), &retrieved))
	requireRoutingDraftEqual(t, original.RoutingDraft, retrieved.RoutingDraft)
	require.JSONEq(t, string(original.Rules), string(retrieved.Rules))
	second, err := store.CreateRoutingDraft(context.Background(), RoutingDraftContent{Name: "Second", RulesJSON: "[]", ChainMaxDepth: 1})
	require.NoError(t, err)
	var page struct {
		Drafts []map[string]any `json:"drafts"`
		Limit  int              `json:"limit"`
		Offset int              `json:"offset"`
	}
	listed := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: routingDraftCollection + "?limit=1&offset=1", admin: true, status: 200})
	require.NoError(t, json.Unmarshal(listed.Response.Body(), &page))
	require.Len(t, page.Drafts, 1)
	require.Equal(t, original.ID, page.Drafts[0]["id"])
	require.NotContains(t, page.Drafts[0], "rules")
	require.NotContains(t, page.Drafts[0], "rules_json")
	require.Equal(t, 1, page.Limit)
	require.Equal(t, 1, page.Offset)
	for _, query := range []string{"limit=0", "limit=101", "limit=", "limit=-1", "limit=1.5", "limit=1&limit=2", "offset=", "offset=-1", "offset=1&offset=2", "offset=9999999999999999999999"} {
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: routingDraftCollection + "?" + query, admin: true, status: 400})
	}
	updated := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "PUT", path: detail, body: `{"name":"Revised","rules":[],"chain_max_depth":1,"expected_revision":1}`,
		mediaType: "application/json", admin: true, status: 200,
	})
	var replacement routingDraftResponse
	require.NoError(t, json.Unmarshal(updated.Response.Body(), &replacement))
	require.EqualValues(t, 2, replacement.Revision)
	require.Equal(t, "Revised", replacement.Name)
	for _, method := range []string{"PUT", "DELETE"} {
		payload := `{"expected_revision":1}`
		if method == "PUT" {
			payload = `{"name":"Stale","rules":[],"chain_max_depth":10,"expected_revision":1}`
		}
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
			method: method, path: detail, body: payload, mediaType: "application/json", admin: true, status: 409,
		})
	}
	require.Len(t, routingDraftAudits(t, store), 3)
	restarted, err := NewStore(context.Background(), cs)
	require.NoError(t, err)
	persisted, err := restarted.GetRoutingDraft(context.Background(), original.ID)
	require.NoError(t, err)
	require.Equal(t, replacement.Name, persisted.Name)
	require.Equal(t, replacement.Revision, persisted.Revision)
	deleted := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "DELETE", path: detail, body: `{"expected_revision":2}`, mediaType: "application/json", admin: true, status: 204,
	})
	require.Empty(t, deleted.Response.Body())
	serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: detail, admin: true, status: 404})
	serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "PUT", path: detail, body: `{"name":"Missing","rules":[],"chain_max_depth":10,"expected_revision":2}`,
		mediaType: "application/json", admin: true, status: 404,
	})
	serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "DELETE", path: detail, body: `{"expected_revision":2}`, mediaType: "application/json", admin: true, status: 404,
	})
	events := routingDraftAudits(t, store)
	require.Len(t, events, 4)
	for _, event := range events {
		if event.ResourceID != second.ID {
			require.Equal(t, "draft-admin", event.ActorID)
		}
	}
	live, err := cs.GetRoutingRules(context.Background())
	require.NoError(t, err)
	require.Empty(t, live)
}

func TestRoutingDraftHTTPStorageFailuresAreSafeAndAtomic(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	r := routingDraftHTTPRouter(store)
	ctx := context.Background()
	draft, err := store.CreateRoutingDraft(ctx, RoutingDraftContent{Name: "Original", RulesJSON: "[]", ChainMaxDepth: 10})
	require.NoError(t, err)
	detail := routingDraftCollection + "/" + draft.ID
	db := store.db(ctx)
	const callback = "test:routing-draft-http-audit"
	require.NoError(t, db.Callback().Create().After("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			tx.AddError(errors.New("private audit database diagnostic"))
		}
	}))
	t.Cleanup(func() { db.Callback().Create().Remove(callback) })
	for _, request := range []routingDraftHTTPRequest{
		{method: "POST", path: routingDraftCollection, body: routingDraftFixture},
		{method: "PUT", path: detail, body: `{"name":"Rejected","rules":[],"chain_max_depth":1,"expected_revision":1}`},
		{method: "DELETE", path: detail, body: `{"expected_revision":1}`},
	} {
		request.admin, request.status, request.mediaType = true, 500, "application/json"
		response := serveRoutingDraftRequest(t, r, request)
		require.JSONEq(t, `{"error":"routing draft storage operation failed"}`, string(response.Response.Body()))
		persisted, err := store.GetRoutingDraft(ctx, draft.ID)
		require.NoError(t, err)
		requireRoutingDraftEqual(t, draft, persisted)
		require.Len(t, routingDraftAudits(t, store), 1)
	}
	require.NoError(t, db.Migrator().DropTable(&RoutingDraft{}))
	for _, path := range []string{routingDraftCollection, detail} {
		response := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: path, admin: true, status: 500})
		require.JSONEq(t, `{"error":"routing draft storage operation failed"}`, string(response.Response.Body()))
	}
}
