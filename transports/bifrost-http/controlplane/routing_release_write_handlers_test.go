package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

type routingReleaseHTTPActivator struct {
	fail  bool
	calls int
}

func (a *routingReleaseHTTPActivator) ReloadVirtualKey(context.Context, string) (*configtables.TableVirtualKey, error) {
	return nil, nil
}

func (a *routingReleaseHTTPActivator) RemoveVirtualKey(context.Context, string) error {
	return nil
}

func (a *routingReleaseHTTPActivator) ActivateRoutingRelease(ctx context.Context, store *Store, epoch int64, actor string) error {
	a.calls++
	if a.fail {
		return errors.New("runtime activation failed")
	}
	_, err := store.InstallAcceptedRoutingRelease(ctx, epoch, rollbackTestCompiler, actor)
	return err
}

func routingReleaseWriteRouter(store *Store, activator *routingReleaseHTTPActivator) *router.Router {
	r := router.New()
	NewHandler(store, nil, activator).RegisterRoutingReleaseWriteRoutes(r)
	return r
}

func TestRoutingReleaseWriteHTTPGuardsAndStrictPayloads(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	activator := &routingReleaseHTTPActivator{}
	r := routingReleaseWriteRouter(store, activator)
	for _, path := range []string{
		"/api/control-plane/routing/releases/publish",
		"/api/control-plane/routing/releases/rollback",
	} {
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
			method: "POST", path: path, body: `{}`, mediaType: "application/json", status: 401,
		})
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
			method: "POST", path: path, body: `{}`, mediaType: "application/json", admin: true, bypass: true, status: 403,
		})
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
			method: "POST", path: path, body: `{}`, mediaType: "text/plain", admin: true, status: 415,
		})
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
			method: "POST", path: path, body: `{}`, mediaType: "application/json", admin: true,
			origin: "https://elsewhere.test", status: 403,
		})
	}
	for _, body := range []string{
		"", `{`, `null`, `{} {}`,
		`{"expected_epoch":0,"idempotency_key":"x","version_id":"bad","unknown":true}`,
		`{"expected_epoch":0,"idempotency_key":"x"}`,
		`{"expected_epoch":0,"idempotency_key":"x","version_id":"bad","rollback_of_epoch":1}`,
	} {
		serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
			method: "POST", path: "/api/control-plane/routing/releases/publish", body: body,
			mediaType: "application/json", admin: true, status: 400,
		})
	}
	require.Zero(t, activator.calls)
	require.Empty(t, routingReleaseAudits(t, store))
}

func TestRoutingReleaseWriteHTTPPublishesAndRetriesIdempotently(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 3}))
	version := routingReleaseVersion(t, store)
	activator := &routingReleaseHTTPActivator{}
	r := routingReleaseWriteRouter(store, activator)
	body := `{"version_id":"` + version.ID + `","expected_epoch":0,"idempotency_key":"publish-http-1"}`
	first := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "POST", path: "/api/control-plane/routing/releases/publish", body: body,
		mediaType: "application/json", admin: true, status: 200,
	})
	var response routingReleaseMutationResponse
	require.NoError(t, json.Unmarshal(first.Response.Body(), &response))
	require.Equal(t, "applied", response.ActivationState)
	require.True(t, response.Head.IsApplied())
	require.Equal(t, version.ID, response.Release.VersionID)
	require.Equal(t, 1, activator.calls)
	require.Len(t, routingReleaseAudits(t, store), 2)

	replayed := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "POST", path: "/api/control-plane/routing/releases/publish", body: body,
		mediaType: "application/json", admin: true, status: 200,
	})
	var replayedResponse routingReleaseMutationResponse
	require.NoError(t, json.Unmarshal(replayed.Response.Body(), &replayedResponse))
	require.Equal(t, response.Release.ID, replayedResponse.Release.ID)
	require.Equal(t, "applied", replayedResponse.ActivationState)
	require.Equal(t, 2, activator.calls)
	require.Len(t, routingReleaseAudits(t, store), 2, "idempotent replay must not create another audit")

	conflict := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "POST", path: "/api/control-plane/routing/releases/publish",
		body:      `{"version_id":"` + version.ID + `","expected_epoch":0,"idempotency_key":"publish-http-2"}`,
		mediaType: "application/json", admin: true, status: 409,
	})
	require.Contains(t, string(conflict.Response.Body()), "routing release head changed")
}

func TestRoutingReleaseWriteHTTPLeavesPendingForSafeRetry(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 3}))
	version := routingReleaseVersion(t, store)
	activator := &routingReleaseHTTPActivator{fail: true}
	r := routingReleaseWriteRouter(store, activator)
	body := `{"version_id":"` + version.ID + `","expected_epoch":0,"idempotency_key":"pending-http-1"}`
	pending := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "POST", path: "/api/control-plane/routing/releases/publish", body: body,
		mediaType: "application/json", admin: true, status: 503,
	})
	var pendingResponse routingReleaseMutationResponse
	require.NoError(t, json.Unmarshal(pending.Response.Body(), &pendingResponse))
	require.Equal(t, "pending", pendingResponse.ActivationState)
	require.Equal(t, "pending", pendingResponse.Head.State)
	requirePendingRoutingHead(t, store, pendingResponse.Release)
	require.Len(t, routingReleaseAudits(t, store), 1)

	activator.fail = false
	applied := serveRoutingDraftRequest(t, r, routingReleaseWriteRequest(body))
	var appliedResponse routingReleaseMutationResponse
	require.NoError(t, json.Unmarshal(applied.Response.Body(), &appliedResponse))
	require.Equal(t, "applied", appliedResponse.ActivationState)
	require.True(t, appliedResponse.Head.IsApplied())
	require.Equal(t, pendingResponse.Release.ID, appliedResponse.Release.ID)
	require.Len(t, routingReleaseAudits(t, store), 2)
}

func routingReleaseWriteRequest(body string) routingDraftHTTPRequest {
	return routingDraftHTTPRequest{
		method: "POST", path: "/api/control-plane/routing/releases/publish", body: body,
		mediaType: "application/json", admin: true, status: 200,
	}
}

func TestRoutingReleaseWriteHTTPPublishesAndRollsBack(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 3}))
	first := routingReleaseVersion(t, store)
	second := routingReleaseVersion(t, store)
	activator := &routingReleaseHTTPActivator{}
	r := routingReleaseWriteRouter(store, activator)

	serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "POST", path: "/api/control-plane/routing/releases/publish",
		body:      `{"version_id":"` + first.ID + `","expected_epoch":0,"idempotency_key":"rollback-http-1"}`,
		mediaType: "application/json", admin: true, status: 200,
	})
	serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "POST", path: "/api/control-plane/routing/releases/publish",
		body:      `{"version_id":"` + second.ID + `","expected_epoch":1,"idempotency_key":"rollback-http-2"}`,
		mediaType: "application/json", admin: true, status: 200,
	})
	rollback := serveRoutingDraftRequest(t, r, routingDraftHTTPRequest{
		method: "POST", path: "/api/control-plane/routing/releases/rollback",
		body:      `{"rollback_of_epoch":1,"expected_epoch":2,"idempotency_key":"rollback-http-3"}`,
		mediaType: "application/json", admin: true, status: 200,
	})
	var response routingReleaseMutationResponse
	require.NoError(t, json.Unmarshal(rollback.Response.Body(), &response))
	require.Equal(t, "rollback", response.Release.Operation)
	require.EqualValues(t, 1, response.Release.RollbackOfEpoch)
	require.Equal(t, first.ID, response.Release.VersionID)
	require.True(t, response.Head.IsApplied())
	require.Equal(t, first.ID, response.Head.AppliedVersionID)
	require.Len(t, routingReleaseAudits(t, store), 6)
}
