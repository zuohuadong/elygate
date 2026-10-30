package controlplane

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

const routingVersionCollection = "/api/control-plane/routing/versions"

func TestRoutingVersionHTTPGuards(t *testing.T) {
	r := router.New()
	NewHandler(nil, nil).RegisterRoutingPolicyVersionRoutes(r)
	for _, endpoint := range []struct{ method, path string }{
		{"GET", routingVersionCollection}, {"GET", routingVersionCollection + "/" + uuid.NewString()},
		{"POST", routingDraftCollection + "/" + uuid.NewString() + "/versions"},
	} {
		for _, auth := range []struct {
			admin, bypass bool
			status        int
		}{{false, false, 401}, {true, true, 403}} {
			serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
				method: endpoint.method, path: endpoint.path, body: `{"expected_revision":1}`,
				mediaType: "application/json", admin: auth.admin, bypass: auth.bypass, status: auth.status,
			})
		}
		if endpoint.method == "POST" {
			serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
				method: "POST", path: endpoint.path, body: `{"expected_revision":1}`, mediaType: "text/plain", admin: true, status: 415,
			})
			serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
				method: "POST", path: endpoint.path, body: `{"expected_revision":1}`, mediaType: "application/json",
				origin: "https://foreign.invalid", admin: true, status: 403,
			})
		}
	}
}

func TestRoutingVersionHTTPValidationAndLifecycle(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	r := router.New()
	NewHandler(store, nil).RegisterRoutingPolicyVersionRoutes(r)
	draft, err := store.CreateRoutingDraft(context.Background(), RoutingDraftContent{Name: "Candidate", RulesJSON: "[]", ChainMaxDepth: 10})
	require.NoError(t, err)
	collection := routingDraftCollection + "/" + draft.ID + "/versions"
	// Revision boundaries: omitted/null/zero/negative/unsafe/fractional/string/trailing/unknown are rejected.
	for _, body := range []string{
		`{}`, `{"expected_revision":null}`, `{"expected_revision":0}`, `{"expected_revision":-1}`,
		`{"expected_revision":9007199254740991}`, `{"expected_revision":1.5}`, `{"expected_revision":"1"}`,
		`{"expected_revision":1} {}`, `{"expected_revision":1,"rules":[]}`,
	} {
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "POST", path: collection, body: body,
			mediaType: "application/json", admin: true, status: 400})
	}
	serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "POST", path: collection,
		body:      `{"expected_revision":1,"padding":"` + strings.Repeat("x", maxRoutingDraftBytes) + `"}`,
		mediaType: "application/json", admin: true, status: 413})
	serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "POST", path: collection, body: `{"expected_revision":2}`,
		mediaType: "application/json", admin: true, status: 409})
	require.Empty(t, routingVersionAudits(t, store))
	created := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "POST", path: collection, body: `{"expected_revision":1}`,
		mediaType: "application/json", admin: true, status: 201})
	var version routingVersionResponse
	require.NoError(t, json.Unmarshal(created.Response.Body(), &version))
	require.JSONEq(t, "[]", string(version.Rules))
	require.Equal(t, draft.ID, version.DraftID)
	require.EqualValues(t, 1, version.DraftRevision)
	detail := routingVersionCollection + "/" + version.ID
	retrieved := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: detail, admin: true, status: 200})
	require.JSONEq(t, string(created.Response.Body()), string(retrieved.Response.Body()))
	listed := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: routingVersionCollection, admin: true, status: 200})
	require.NotContains(t, string(listed.Response.Body()), `"rules"`)
	require.NotContains(t, string(listed.Response.Body()), "rules_json")
	require.NoError(t, store.DeleteRoutingDraft(context.Background(), draft.ID, 1, "admin"))
	replayed := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "POST", path: collection, body: `{"expected_revision":1}`,
		mediaType: "application/json", admin: true, status: 201})
	require.JSONEq(t, string(created.Response.Body()), string(replayed.Response.Body()))
	require.Len(t, routingVersionAudits(t, store), 1)
	for _, query := range []string{"limit=0", "limit=101", "limit=1&limit=2", "offset=-1", "offset=1.5", "offset=999999999999999999999999"} {
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: routingVersionCollection + "?" + query, admin: true, status: 400})
	}
	for _, id := range []string{"invalid", strings.ToUpper(uuid.NewString())} {
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: routingVersionCollection + "/" + id, admin: true, status: 400})
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "POST", path: routingDraftCollection + "/" + id + "/versions",
			body: `{"expected_revision":1}`, mediaType: "application/json", admin: true, status: 400})
	}
	serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: routingVersionCollection + "/" + uuid.NewString(), admin: true, status: 404})
}
