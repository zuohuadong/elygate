package controlplane

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestRoutingReleaseReadHTTPGuardsAndEmptyHistory(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	r := router.New()
	NewHandler(store, nil).RegisterRoutingReleaseReadRoutes(r)
	for _, endpoint := range []string{
		"/api/control-plane/routing/releases/head",
		"/api/control-plane/routing/releases?limit=25&offset=0",
	} {
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: endpoint, admin: false, status: 401})
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: endpoint, admin: true, bypass: true, status: 403})
	}
	serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: "/api/control-plane/routing/releases?limit=0", admin: true, status: 400})
	serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: "/api/control-plane/routing/releases?offset=-1", admin: true, status: 400})
	headResponse := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: "/api/control-plane/routing/releases/head", admin: true, status: 200})
	var head RoutingReleaseHead
	require.NoError(t, json.Unmarshal(headResponse.Response.Body(), &head))
	require.Equal(t, int64(0), head.Epoch)
	require.Equal(t, "pending", head.State)
	historyResponse := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: "/api/control-plane/routing/releases?limit=25&offset=0", admin: true, status: 200})
	var history struct {
		Releases []RoutingReleaseHistoryEntry `json:"releases"`
		Limit    int                          `json:"limit"`
		Offset   int                          `json:"offset"`
	}
	require.NoError(t, json.Unmarshal(historyResponse.Response.Body(), &history))
	require.Empty(t, history.Releases)
	require.Equal(t, 25, history.Limit)
	require.Zero(t, history.Offset)
	for _, query := range []string{"limit=101", "limit=1&limit=2", "limit=", "offset=1&offset=2", "offset=1.5", "offset=99999999999999999999"} {
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: "/api/control-plane/routing/releases?" + query, admin: true, status: 400})
	}
	headAfter, err := store.GetRoutingReleaseHead(t.Context())
	require.NoError(t, err)
	require.Equal(t, head.Epoch, headAfter.Epoch)
	require.Equal(t, head.State, headAfter.State)
	require.Equal(t, head.DesiredVersionID, headAfter.DesiredVersionID)
	require.Equal(t, head.DesiredFingerprint, headAfter.DesiredFingerprint)
	require.Equal(t, head.AppliedVersionID, headAfter.AppliedVersionID)
	require.Equal(t, head.AppliedFingerprint, headAfter.AppliedFingerprint)
	require.Empty(t, routingReleaseAudits(t, store))
	live, err := cs.GetRoutingRules(t.Context())
	require.NoError(t, err)
	require.Empty(t, live)
}

func TestRoutingReleaseReadHTTPDistinguishesPendingAndApplied(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	version := routingReleaseVersion(t, store)
	ctx := context.Background()
	require.NoError(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{RoutingChainMaxDepth: 3}))
	pending, err := store.AcceptRoutingRelease(ctx, RoutingReleaseRequest{
		VersionID: version.ID, IdempotencyKey: uuid.NewString(), ActorID: "read-test",
	})
	require.NoError(t, err)
	r := router.New()
	NewHandler(store, nil).RegisterRoutingReleaseReadRoutes(r)
	pendingResponse := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "GET", path: "/api/control-plane/routing/releases?limit=25&offset=0", admin: true, status: 200,
	})
	var pendingPage struct {
		Releases []map[string]any `json:"releases"`
	}
	require.NoError(t, json.Unmarshal(pendingResponse.Response.Body(), &pendingPage))
	require.Len(t, pendingPage.Releases, 1)
	require.Nil(t, pendingPage.Releases[0]["application"])
	require.Equal(t, float64(pending.Epoch), pendingPage.Releases[0]["epoch"])

	_, err = store.InstallAcceptedRoutingRelease(ctx, pending.Epoch, rollbackTestCompiler, "read-test")
	require.NoError(t, err)
	appliedResponse := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "GET", path: "/api/control-plane/routing/releases?limit=25&offset=0", admin: true, status: 200,
	})
	var appliedPage struct {
		Releases []map[string]any `json:"releases"`
	}
	require.NoError(t, json.Unmarshal(appliedResponse.Response.Body(), &appliedPage))
	require.Len(t, appliedPage.Releases, 1)
	require.NotNil(t, appliedPage.Releases[0]["application"])
	require.NotContains(t, string(appliedResponse.Response.Body()), "idempotency")
	require.NotContains(t, string(appliedResponse.Response.Body()), pending.IdempotencyKey)
	headBefore, err := store.GetRoutingReleaseHead(ctx)
	require.NoError(t, err)
	auditsBefore := routingReleaseAudits(t, store)
	readHead := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: "/api/control-plane/routing/releases/head", admin: true, status: 200})
	var head RoutingReleaseHead
	require.NoError(t, json.Unmarshal(readHead.Response.Body(), &head))
	require.True(t, head.IsApplied())
	require.Equal(t, headBefore.Epoch, head.Epoch)
	require.Equal(t, headBefore.State, head.State)
	require.Equal(t, headBefore.DesiredVersionID, head.DesiredVersionID)
	require.Equal(t, headBefore.DesiredFingerprint, head.DesiredFingerprint)
	require.Equal(t, headBefore.AppliedVersionID, head.AppliedVersionID)
	require.Equal(t, headBefore.AppliedFingerprint, head.AppliedFingerprint)
	require.Equal(t, auditsBefore, routingReleaseAudits(t, store))
}

func TestRoutingReleaseReadHistoryPaginationAndRollback(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := t.Context()
	require.NoError(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{RoutingChainMaxDepth: 3}))
	first := appliedRollbackFixture(t, store, "First", 3)
	second := appliedRollbackFixture(t, store, "Second", 4)
	rollback, err := store.AcceptRoutingRelease(ctx, rollbackRequest(first, second))
	require.NoError(t, err)
	snapshot, err := store.ReadRoutingReleasePage(ctx, 2, 0)
	require.NoError(t, err)
	require.Equal(t, rollback.Epoch, snapshot.Head.Epoch)
	require.Equal(t, "pending", snapshot.Head.State)
	require.Equal(t, rollback.ID, snapshot.Releases[0].ID)
	require.Nil(t, snapshot.Releases[0].Application)
	require.NotNil(t, snapshot.Releases[1].Application)
	page, err := store.ListRoutingReleaseHistory(ctx, 2, 0)
	require.NoError(t, err)
	require.Len(t, page, 2)
	require.Equal(t, rollback.ID, page[0].ID)
	require.Equal(t, int64(1), page[0].RollbackOfEpoch)
	require.Nil(t, page[0].Application)
	require.Equal(t, second.ID, page[1].ID)
	require.Equal(t, second.ID, page[1].Application.AttemptID)
	nextPage, err := store.ListRoutingReleaseHistory(ctx, 2, 2)
	require.NoError(t, err)
	require.Len(t, nextPage, 1)
	require.Equal(t, first.ID, nextPage[0].ID)
	require.NotNil(t, nextPage[0].Application)
	empty, err := store.ListRoutingReleaseHistory(ctx, 2, 3)
	require.NoError(t, err)
	require.NotNil(t, empty)
	require.Empty(t, empty)
	for _, bounds := range [][2]int{{0, 0}, {101, 0}, {1, -1}} {
		_, err := store.ListRoutingReleaseHistory(ctx, bounds[0], bounds[1])
		require.ErrorIs(t, err, ErrRoutingReleaseRequest)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	_, err = store.ListRoutingReleaseHistory(canceled, 25, 0)
	require.ErrorIs(t, err, context.Canceled)
}

func TestRoutingReleaseReadHTTPPreservesMiddlewareAndRedactsStorageErrors(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	r := router.New()
	blocked := schemas.BifrostHTTPMiddleware(func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) { ctx.SetStatusCode(418) }
	})
	NewHandler(store, nil).RegisterRoutingReleaseReadRoutes(r, blocked)
	serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: "/api/control-plane/routing/releases/head", admin: true, status: 418})

	r = router.New()
	NewHandler(store, nil).RegisterRoutes(r)
	for _, endpoint := range []string{"/api/control-plane/routing/releases", "/api/control-plane/routing/releases/head"} {
		var request fasthttp.RequestCtx
		request.Init(&fasthttp.Request{}, nil, nil)
		request.Request.Header.SetMethod("POST")
		request.Request.SetRequestURI("http://gateway.test" + endpoint)
		r.Handler(&request)
		require.Equal(t, 405, request.Response.StatusCode())
	}
	require.NoError(t, cs.DB().Migrator().DropTable(&RoutingReleaseHead{}))
	head := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: "/api/control-plane/routing/releases/head", admin: true, status: 500})
	require.Contains(t, string(head.Response.Body()), "routing release storage operation failed")
	require.NotContains(t, string(head.Response.Body()), (RoutingReleaseHead{}).TableName())
	require.NoError(t, cs.DB().Migrator().DropTable(&RoutingReleaseAttempt{}))
	history := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: "/api/control-plane/routing/releases", admin: true, status: 500})
	require.Contains(t, string(history.Response.Body()), "routing release storage operation failed")
	require.NotContains(t, string(history.Response.Body()), (RoutingReleaseAttempt{}).TableName())
}

func TestRoutingReleaseReadRejectsMismatchedInstallationReceipt(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := t.Context()
	require.NoError(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{RoutingChainMaxDepth: 3}))
	attempt := appliedRollbackFixture(t, store, "First", 3)
	require.NoError(t, cs.DB().Model(&RoutingReleaseApplication{}).Where("attempt_id = ?", attempt.ID).
		Update("policy_fingerprint", strings.Repeat("z", 64)).Error)
	_, err := store.ListRoutingReleaseHistory(ctx, 25, 0)
	require.ErrorIs(t, err, ErrRoutingReleaseNotApplied)
}

func TestRoutingReleaseReadHTTPRejectsUnprovenAppliedHead(t *testing.T) {
	// Applied fields alone, a missing receipt and a corrupt receipt cannot prove installation.
	for _, corruption := range []string{"head", "missing", "fingerprint"} {
		t.Run(corruption, func(t *testing.T) {
			store, cs := testControlPlaneStore(t)
			require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 3}))
			attempt := appliedRollbackFixture(t, store, "Read validation", 3)
			switch corruption {
			case "head":
				require.NoError(t, cs.DB().Model(&RoutingReleaseHead{}).Where("id = ?", 1).
					Update("applied_fingerprint", strings.Repeat("b", 64)).Error)
			case "missing":
				require.NoError(t, cs.DB().Where("attempt_id = ?", attempt.ID).Delete(&RoutingReleaseApplication{}).Error)
			case "fingerprint":
				require.NoError(t, cs.DB().Model(&RoutingReleaseApplication{}).Where("attempt_id = ?", attempt.ID).
					Update("policy_fingerprint", strings.Repeat("z", 64)).Error)
			}
			r := router.New()
			NewHandler(store, nil).RegisterRoutingReleaseReadRoutes(r)
			for _, endpoint := range []string{"/api/control-plane/routing/releases/head", "/api/control-plane/routing/releases"} {
				serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{method: "GET", path: endpoint, admin: true, status: 500})
			}
		})
	}
}
