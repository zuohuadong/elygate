package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestApplicationKeyRouterBodylessMutations(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Router contract"}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{ProjectID: project.ID, Name: "API"}
	require.NoError(t, store.CreateApplication(ctx, app))
	key, err := store.CreateApplicationKey(ctx, app.ID, "router-key", "", nil, "test")
	require.NoError(t, err)
	r := router.New()
	NewHandler(store, nil).RegisterRoutes(r, func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
			next(ctx)
		}
	})
	base := "/api/control-plane/applications/" + app.ID
	for _, operation := range []struct {
		method, path string
		status       int
	}{
		{"POST", base + "/keys/" + key.VirtualKeyID + "/rotate", 200},
		{"DELETE", base + "/keys/" + key.VirtualKeyID, 204},
		{"DELETE", base + "/virtual-key-binding", 204},
	} {
		if operation.path == base+"/virtual-key-binding" {
			_, err := store.CreateApplicationKey(ctx, app.ID, "binding-key", "", nil, "test")
			require.NoError(t, err)
		}
		request := &fasthttp.RequestCtx{}
		request.Request.SetRequestURI("http://admin.example.test" + operation.path)
		request.Request.Header.SetMethod(operation.method)
		request.Request.Header.SetContentType("application/json")
		request.Request.Header.Set("Origin", "http://admin.example.test")
		r.Handler(request)
		require.Equal(t, operation.status, request.Response.StatusCode(), string(request.Response.Body()))
	}
}

type recordingVirtualKeyLifecycle struct {
	reloaded  []string
	removed   []string
	reloadErr error
	removeErr error
}

func (r *recordingVirtualKeyLifecycle) ReloadVirtualKey(_ context.Context, id string) (*configtables.TableVirtualKey, error) {
	r.reloaded = append(r.reloaded, id)
	return nil, r.reloadErr
}

func (r *recordingVirtualKeyLifecycle) RemoveVirtualKey(_ context.Context, id string) error {
	r.removed = append(r.removed, id)
	return r.removeErr
}

func TestAdminAccessMiddlewareRequiresAuthenticatedAdmin(t *testing.T) {
	h := &Handler{}
	called := false
	middleware := h.AdminAccessMiddleware()(func(ctx *fasthttp.RequestCtx) {
		called = true
		ctx.SetStatusCode(fasthttp.StatusNoContent)
	})

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodPost)
	ctx.Request.Header.SetContentType("application/json")
	ctx.SetUserValue(schemas.BifrostContextKeyAuthBypassed, true)
	middleware(ctx)

	require.False(t, called)
	require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode())
}

func TestAdminAccessMiddlewareRejectsCrossOriginAndNonJSONWrites(t *testing.T) {
	h := &Handler{}
	middleware := h.AdminAccessMiddleware()(func(ctx *fasthttp.RequestCtx) {
		ctx.SetStatusCode(fasthttp.StatusNoContent)
	})

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

func TestUsageQueryReturnsEffectivePagination(t *testing.T) {
	h := &Handler{}
	ctx := &fasthttp.RequestCtx{}
	ctx.QueryArgs().Set("limit", "0")
	ctx.QueryArgs().Set("offset", "-3")

	query, err := h.usageQuery(ctx)
	require.NoError(t, err)
	require.Equal(t, 100, query.Limit)
	require.Zero(t, query.Offset)
}

func TestUsageQueryParsesFiltersAndRejectsMalformedTimes(t *testing.T) {
	h := &Handler{}
	ctx := &fasthttp.RequestCtx{}
	ctx.QueryArgs().Set("project_id", "project-1")
	ctx.QueryArgs().Set("application_id", "application-1")
	ctx.QueryArgs().Set("start_time", "2026-09-13T00:00:00+08:00")
	ctx.QueryArgs().Set("end_time", "2026-09-13T01:00:00+08:00")

	query, err := h.usageQuery(ctx)
	require.NoError(t, err)
	require.Equal(t, "project-1", query.ProjectID)
	require.Equal(t, "application-1", query.ApplicationID)
	require.Equal(t, "2026-09-12T16:00:00Z", query.StartTime.UTC().Format(time.RFC3339))
	require.Equal(t, "2026-09-12T17:00:00Z", query.EndTime.UTC().Format(time.RFC3339))

	ctx.QueryArgs().Set("start_time", "not-a-time")
	_, err = h.usageQuery(ctx)
	require.EqualError(t, err, "start_time must be RFC3339")

	ctx.QueryArgs().Set("start_time", "2026-09-13T02:00:00Z")
	ctx.QueryArgs().Set("end_time", "2026-09-13T01:00:00Z")
	_, err = h.usageQuery(ctx)
	require.EqualError(t, err, "start_time must be before end_time")
}

func TestUsageQueryParsesSessionTreeFilters(t *testing.T) {
	h := &Handler{}
	ctx := &fasthttp.RequestCtx{}
	ctx.QueryArgs().Set("session_id", "child-1")
	ctx.QueryArgs().Set("parent_session_id", "parent-1")
	ctx.QueryArgs().Set("agent_name", "reviewer")
	ctx.QueryArgs().Set("tree_session_id", "parent-1")
	ctx.QueryArgs().Set("is_subagent", "true")
	ctx.QueryArgs().Set("is_fork", "false")

	query, err := h.usageQuery(ctx)
	require.NoError(t, err)
	require.Equal(t, "child-1", query.SessionID)
	require.Equal(t, "parent-1", query.ParentSessionID)
	require.Equal(t, "reviewer", query.AgentName)
	require.Equal(t, "parent-1", query.TreeSessionID)
	require.NotNil(t, query.IsSubagent)
	require.True(t, *query.IsSubagent)
	require.NotNil(t, query.IsFork)
	require.False(t, *query.IsFork)

	ctx.QueryArgs().Set("is_subagent", "maybe")
	_, err = h.usageQuery(ctx)
	require.EqualError(t, err, "is_subagent must be a boolean")
}

func TestCheckVirtualKeyAccessHonorsApplicationBindingLifecycle(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	active := true
	require.NoError(t, cs.CreateVirtualKey(context.Background(), &configtables.TableVirtualKey{ID: "vk-handler", Name: "vk-handler", Value: *schemas.NewSecretVar("sk-handler"), IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now()}))
	h := NewHandler(store, nil)

	// Unbound keys remain compatible with the existing OSS behavior.
	require.NoError(t, h.CheckVirtualKeyAccess(context.Background(), "vk-handler"))

	project := &Project{Name: "Gateway"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "Worker"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	_, err := store.BindVirtualKey(context.Background(), app.ID, "vk-handler", nil)
	require.NoError(t, err)
	require.NoError(t, h.CheckVirtualKeyAccess(context.Background(), "vk-handler"))
	require.NoError(t, store.RevokeBinding(context.Background(), app.ID))
	require.EqualError(t, h.CheckVirtualKeyAccess(context.Background(), "vk-handler"), "application credential binding is revoked or expired")

	expires := time.Now().UTC().Add(-time.Minute)
	_, err = store.BindVirtualKey(context.Background(), app.ID, "vk-handler", &expires)
	require.NoError(t, err)
	require.EqualError(t, h.CheckVirtualKeyValueAccess(context.Background(), "sk-handler"), "application credential binding is revoked or expired")
}

func TestApplicationKeyHandlersCreateRotateAndRevoke(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	project := &Project{Name: "Handlers"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "API"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	lifecycle := &recordingVirtualKeyLifecycle{}
	h := NewHandler(store, nil, lifecycle)

	createCtx := &fasthttp.RequestCtx{}
	createCtx.SetUserValue("application_id", app.ID)
	createCtx.Request.SetBodyString(`{"name":"api-key"}`)
	h.createApplicationKey(createCtx)
	require.Equal(t, fasthttp.StatusCreated, createCtx.Response.StatusCode())
	var created ApplicationKey
	require.NoError(t, json.Unmarshal(createCtx.Response.Body(), &created))
	require.NotEmpty(t, created.Value)
	require.Equal(t, []string{created.VirtualKeyID}, lifecycle.reloaded)

	rotateCtx := &fasthttp.RequestCtx{}
	rotateCtx.SetUserValue("application_id", app.ID)
	rotateCtx.SetUserValue("virtual_key_id", created.VirtualKeyID)
	h.rotateApplicationKey(rotateCtx)
	require.Equal(t, fasthttp.StatusOK, rotateCtx.Response.StatusCode())
	var rotated ApplicationKey
	require.NoError(t, json.Unmarshal(rotateCtx.Response.Body(), &rotated))
	require.NotEqual(t, created.Value, rotated.Value)

	revokeCtx := &fasthttp.RequestCtx{}
	revokeCtx.SetUserValue("application_id", app.ID)
	revokeCtx.SetUserValue("virtual_key_id", created.VirtualKeyID)
	h.revokeApplicationKey(revokeCtx)
	require.Equal(t, fasthttp.StatusNoContent, revokeCtx.Response.StatusCode())
	require.Equal(t, []string{created.VirtualKeyID, created.VirtualKeyID, created.VirtualKeyID}, lifecycle.reloaded)
}

func TestSyncVirtualKeyRemovesStaleInMemoryKeyAfterReloadFailure(t *testing.T) {
	lifecycle := &recordingVirtualKeyLifecycle{reloadErr: errors.New("reload failed")}
	h := NewHandler(nil, nil, lifecycle)
	err := h.syncVirtualKey(context.Background(), "vk-stale")
	require.EqualError(t, err, "reload failed")
	require.Equal(t, []string{"vk-stale"}, lifecycle.removed)
}

func TestRotationTombstoneRejectsOldValueWhenMemorySyncFails(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	project := &Project{Name: "Fail closed"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "API"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	created, err := store.CreateApplicationKey(context.Background(), app.ID, "api-key-fail-closed", "", nil, "admin")
	require.NoError(t, err)

	lifecycle := &recordingVirtualKeyLifecycle{reloadErr: errors.New("reload failed"), removeErr: errors.New("remove failed")}
	h := NewHandler(store, nil, lifecycle)
	rotateCtx := &fasthttp.RequestCtx{}
	rotateCtx.SetUserValue("application_id", app.ID)
	rotateCtx.SetUserValue("virtual_key_id", created.VirtualKeyID)
	h.rotateApplicationKey(rotateCtx)
	require.Equal(t, fasthttp.StatusInternalServerError, rotateCtx.Response.StatusCode())
	require.EqualError(t, store.CheckVirtualKeyValueAccess(context.Background(), created.Value), "virtual key has been revoked or rotated")
}

type blockingUsageReader struct {
	calls   atomic.Int32
	started chan struct{}
	release chan struct{}
}

func (r *blockingUsageReader) ScanUsageLogs(_ context.Context, visit func([]logstore.Log) error) error {
	r.calls.Add(1)
	close(r.started)
	<-r.release
	return visit(nil)
}

type cancelableUsageReader struct {
	calls   atomic.Int32
	started chan struct{}
}

func (r *cancelableUsageReader) ScanUsageLogs(ctx context.Context, visit func([]logstore.Log) error) error {
	call := r.calls.Add(1)
	if call == 1 {
		close(r.started)
		<-ctx.Done()
		return ctx.Err()
	}
	return visit(nil)
}

type blockingFingerprintUsageManager struct {
	snapshotLogManager
	scans            atomic.Int32
	fingerprintCalls atomic.Int32
	started          chan struct{}
	release          chan struct{}
}

func (m *blockingFingerprintUsageManager) ScanUsageLogs(_ context.Context, visit func([]logstore.Log) error) error {
	call := m.scans.Add(1)
	if call == 1 {
		close(m.started)
		<-m.release
	}
	return visit(nil)
}

func (m *blockingFingerprintUsageManager) UsageLogFingerprint(context.Context) (logstore.UsageLogFingerprint, error) {
	m.fingerprintCalls.Add(1)
	return logstore.UsageLogFingerprint{Digest: "stable-snapshot"}, nil
}

type forceAwareUsageReader struct {
	calls        atomic.Int32
	firstStarted chan struct{}
	firstRelease chan struct{}
}

func (r *forceAwareUsageReader) ScanUsageLogs(_ context.Context, visit func([]logstore.Log) error) error {
	call := r.calls.Add(1)
	if call == 1 {
		close(r.firstStarted)
		<-r.firstRelease
	}
	return visit(nil)
}

type coalescedFingerprintUsageManager struct {
	*snapshotLogManager
	scans             atomic.Int32
	fingerprintCalls  atomic.Int32
	aggregateOnly     bool
	firstStarted      chan struct{}
	secondFingerprint chan struct{}
	releaseFirst      chan struct{}
}

func (m *coalescedFingerprintUsageManager) ScanUsageLogs(ctx context.Context, visit func([]logstore.Log) error) error {
	call := m.scans.Add(1)
	if call == 1 {
		close(m.firstStarted)
		<-m.releaseFirst
	}
	return visit(nil)
}

func (m *coalescedFingerprintUsageManager) UsageLogFingerprint(context.Context) (logstore.UsageLogFingerprint, error) {
	call := m.fingerprintCalls.Add(1)
	if m.aggregateOnly {
		if call == 2 {
			close(m.secondFingerprint)
		}
		return logstore.UsageLogFingerprint{Count: 1}, nil
	}
	if call == 1 {
		return logstore.UsageLogFingerprint{Digest: "snapshot-before"}, nil
	}
	if call == 2 {
		close(m.secondFingerprint)
	}
	return logstore.UsageLogFingerprint{Digest: "snapshot-after"}, nil
}

type aggregateOnlyFingerprintReader struct{}

func (aggregateOnlyFingerprintReader) UsageLogFingerprint(context.Context) (logstore.UsageLogFingerprint, error) {
	return logstore.UsageLogFingerprint{Count: 1}, nil
}

type postScanFailFingerprintLogManager struct {
	*snapshotLogManager
	calls atomic.Int32
	err   error
}

func (m *postScanFailFingerprintLogManager) UsageLogFingerprint(context.Context) (logstore.UsageLogFingerprint, error) {
	if m.calls.Add(1) == 1 {
		return logstore.UsageLogFingerprint{Digest: "pre-scan"}, nil
	}
	return logstore.UsageLogFingerprint{}, m.err
}

type countingUsageReader struct{ calls atomic.Int32 }

func (r *countingUsageReader) ScanUsageLogs(_ context.Context, visit func([]logstore.Log) error) error {
	r.calls.Add(1)
	return visit(nil)
}

type unsupportedFingerprintLogManager struct{ *snapshotLogManager }

func (*unsupportedFingerprintLogManager) UsageLogFingerprint(context.Context) (logstore.UsageLogFingerprint, error) {
	return logstore.UsageLogFingerprint{}, logstore.ErrUsageLogFingerprintUnsupported
}

type failingFingerprintLogManager struct {
	*snapshotLogManager
	err error
}

func (m *failingFingerprintLogManager) UsageLogFingerprint(context.Context) (logstore.UsageLogFingerprint, error) {
	return logstore.UsageLogFingerprint{}, m.err
}

func TestSyncUsageCoalescesConcurrentReconciliation(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	reader := &blockingUsageReader{started: make(chan struct{}), release: make(chan struct{})}
	h := NewHandler(store, &snapshotLogManager{UsageLogReader: reader})

	firstDone := make(chan error, 1)
	go func() { firstDone <- h.syncUsage(context.Background(), nil, nil, false) }()
	<-reader.started

	secondDone := make(chan error, 1)
	go func() { secondDone <- h.syncUsage(context.Background(), nil, nil, false) }()
	// The second request must wait for the in-flight source scan rather than
	// opening a second full reconciliation.
	time.Sleep(20 * time.Millisecond)
	require.EqualValues(t, 1, reader.calls.Load())
	close(reader.release)
	require.NoError(t, <-firstDone)
	require.NoError(t, <-secondDone)
	require.EqualValues(t, 1, reader.calls.Load())

	// A follow-up read inside the reuse window should not rescan the source.
	require.NoError(t, h.syncUsage(context.Background(), nil, nil, false))
	require.EqualValues(t, 1, reader.calls.Load())
}

func TestSyncUsageWaitersDoNotFingerprintWhileOwnerIsRunning(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	manager := &blockingFingerprintUsageManager{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	h := NewHandler(store, manager)

	firstDone := make(chan error, 1)
	go func() { firstDone <- h.syncUsage(context.Background(), nil, nil, false) }()
	<-manager.started
	require.EqualValues(t, 1, manager.fingerprintCalls.Load(), "only the owner should read the initial fingerprint")

	secondDone := make(chan error, 1)
	go func() { secondDone <- h.syncUsage(context.Background(), nil, nil, false) }()
	time.Sleep(20 * time.Millisecond)
	require.EqualValues(t, 1, manager.fingerprintCalls.Load(), "waiters must not scan the source fingerprint while a run is active")

	close(manager.release)
	require.NoError(t, <-firstDone)
	require.NoError(t, <-secondDone)
	require.EqualValues(t, 1, manager.scans.Load(), "the stable fingerprint should let the waiter reuse the completed projection")
}

func TestSyncUsageHealthyWaiterRetriesAfterOwnerCancellation(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	reader := &cancelableUsageReader{started: make(chan struct{})}
	h := NewHandler(store, &snapshotLogManager{UsageLogReader: reader})

	ownerCtx, cancelOwner := context.WithCancel(context.Background())
	ownerDone := make(chan error, 1)
	go func() { ownerDone <- h.syncUsage(ownerCtx, nil, nil, false) }()
	<-reader.started

	waiterDone := make(chan error, 1)
	go func() { waiterDone <- h.syncUsage(context.Background(), nil, nil, false) }()
	cancelOwner()

	require.ErrorIs(t, <-ownerDone, context.Canceled)
	require.NoError(t, <-waiterDone)
	require.EqualValues(t, 2, reader.calls.Load(), "a healthy waiter should take over after owner cancellation")
}

func TestSyncUsageForcedCallerRunsAfterCoalescedScan(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	reader := &forceAwareUsageReader{firstStarted: make(chan struct{}), firstRelease: make(chan struct{})}
	h := NewHandler(store, &snapshotLogManager{UsageLogReader: reader})

	firstDone := make(chan error, 1)
	go func() { firstDone <- h.syncUsage(context.Background(), nil, nil, false) }()
	<-reader.firstStarted

	forcedDone := make(chan error, 1)
	go func() { forcedDone <- h.syncUsage(context.Background(), nil, nil, true) }()
	time.Sleep(20 * time.Millisecond)
	require.EqualValues(t, 1, reader.calls.Load())
	close(reader.firstRelease)
	require.NoError(t, <-firstDone)
	require.NoError(t, <-forcedDone)
	require.EqualValues(t, 2, reader.calls.Load())
}

func TestSyncUsageRechecksFingerprintAfterCoalescedScan(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	manager := &coalescedFingerprintUsageManager{
		snapshotLogManager: &snapshotLogManager{},
		firstStarted:       make(chan struct{}),
		secondFingerprint:  make(chan struct{}),
		releaseFirst:       make(chan struct{}),
	}
	h := NewHandler(store, manager)

	firstDone := make(chan error, 1)
	go func() { firstDone <- h.syncUsage(context.Background(), nil, nil, false) }()
	<-manager.firstStarted

	secondDone := make(chan error, 1)
	go func() { secondDone <- h.syncUsage(context.Background(), nil, nil, false) }()
	close(manager.releaseFirst)
	// The owner records the changed post-scan fingerprint after the source scan
	// is released; the waiter then retries and performs the second projection.
	<-manager.secondFingerprint

	require.NoError(t, <-firstDone)
	require.NoError(t, <-secondDone)
	require.EqualValues(t, 2, manager.scans.Load())
}

func TestSyncUsageReconcilesAfterAggregateOnlyCoalescedScan(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	manager := &coalescedFingerprintUsageManager{
		snapshotLogManager: &snapshotLogManager{},
		aggregateOnly:      true,
		firstStarted:       make(chan struct{}),
		secondFingerprint:  make(chan struct{}),
		releaseFirst:       make(chan struct{}),
	}
	h := NewHandler(store, manager)

	firstDone := make(chan error, 1)
	go func() { firstDone <- h.syncUsage(context.Background(), nil, nil, false) }()
	<-manager.firstStarted

	secondDone := make(chan error, 1)
	go func() { secondDone <- h.syncUsage(context.Background(), nil, nil, false) }()
	close(manager.releaseFirst)
	<-manager.secondFingerprint

	require.NoError(t, <-firstDone)
	require.NoError(t, <-secondDone)
	require.EqualValues(t, 2, manager.scans.Load())
}

func TestSyncUsageFallsBackWhenFingerprintsAreUnsupported(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	reader := &countingUsageReader{}
	manager := &unsupportedFingerprintLogManager{snapshotLogManager: &snapshotLogManager{UsageLogReader: reader}}
	h := NewHandler(store, manager)

	require.NoError(t, h.syncUsage(context.Background(), nil, nil, false))
	require.NoError(t, h.syncUsage(context.Background(), nil, nil, false))
	require.EqualValues(t, 1, reader.calls.Load())

	// The no-fingerprint fallback is a checkpoint TTL, not a permanent cache.
	// Once the checkpoint is stale, the next read must reconcile again.
	stale := time.Now().UTC().Add(-(usageReconcileMinInterval + time.Second))
	require.NoError(t, store.db(context.Background()).Model(&UsageLedgerCheckpoint{}).
		Where("id = 1").Update("updated_at", stale).Error)
	require.NoError(t, h.syncUsage(context.Background(), nil, nil, false))
	require.EqualValues(t, 2, reader.calls.Load())
}

func TestSyncUsageDoesNotCacheAggregateOnlyFingerprints(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	reader := &countingUsageReader{}
	manager := &fingerprintSnapshotLogManager{
		UsageLogReader:            reader,
		UsageLogFingerprintReader: aggregateOnlyFingerprintReader{},
	}
	h := NewHandler(store, manager)

	require.NoError(t, h.syncUsage(context.Background(), nil, nil, false))
	require.NoError(t, h.syncUsage(context.Background(), nil, nil, false))
	require.EqualValues(t, 2, reader.calls.Load())
}

func TestSyncUsageSurfacesFingerprintStoreErrors(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	reader := &countingUsageReader{}
	expected := errors.New("fingerprint store unavailable")
	manager := &failingFingerprintLogManager{
		snapshotLogManager: &snapshotLogManager{UsageLogReader: reader},
		err:                expected,
	}
	h := NewHandler(store, manager)

	require.ErrorIs(t, h.syncUsage(context.Background(), nil, nil, false), expected)
	require.Zero(t, reader.calls.Load())
}

func TestSyncUsageSurfacesPostScanFingerprintErrors(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	reader := &countingUsageReader{}
	expected := errors.New("post-scan fingerprint store unavailable")
	manager := &postScanFailFingerprintLogManager{
		snapshotLogManager: &snapshotLogManager{UsageLogReader: reader},
		err:                expected,
	}
	h := NewHandler(store, manager)

	require.ErrorIs(t, h.syncUsage(context.Background(), nil, nil, false), expected)
	require.EqualValues(t, 1, reader.calls.Load())
}
