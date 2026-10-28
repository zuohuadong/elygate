package handlers

import (
	"context"
	"encoding/base64"
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/bytedance/sonic"
	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/framework/grant"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/maximhq/bifrost/framework/queryscope"
	"github.com/maximhq/bifrost/framework/sidekiq"
	"github.com/maximhq/bifrost/framework/vectorstore"
	"github.com/maximhq/bifrost/framework/warp"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

type recordingWarpStore struct {
	row      *tables.TableWarpConfig
	upserted []tables.TableWarpConfig
}

// handlerBackfillReader is the reader the job endpoint tests run through.
// topics is the log store Warp keeps its topics in; nil leaves the reader
// unable to offer one, which is how a deployment without a log store looks.
type handlerBackfillReader struct {
	warp.LogReader
	topics logstore.WarpTopicStore
}

func (r handlerBackfillReader) TopicStore() logstore.WarpTopicStore { return r.topics }

func (handlerBackfillReader) Search(_ context.Context, _ *logstore.SearchFilters, pagination *logstore.PaginationOptions) (*logstore.SearchResult, error) {
	return &logstore.SearchResult{Pagination: *pagination}, nil
}

func (handlerBackfillReader) GetLog(context.Context, string) (*logstore.Log, error) { return nil, nil }

type handlerVectorStore struct{}

func (handlerVectorStore) Ping(context.Context) error { return nil }
func (handlerVectorStore) CreateNamespace(context.Context, string, int, map[string]vectorstore.VectorStoreProperties) error {
	return nil
}
func (handlerVectorStore) DeleteNamespace(context.Context, string) error { return nil }
func (handlerVectorStore) ListNamespaces(context.Context, string) ([]string, error) {
	return nil, nil
}
func (handlerVectorStore) GetChunk(context.Context, string, string) (vectorstore.SearchResult, error) {
	return vectorstore.SearchResult{}, nil
}
func (handlerVectorStore) GetChunks(context.Context, string, []string) ([]vectorstore.SearchResult, error) {
	return nil, nil
}
func (handlerVectorStore) GetAll(context.Context, string, []vectorstore.Query, []string, *string, int64) ([]vectorstore.SearchResult, *string, error) {
	return nil, nil, nil
}
func (handlerVectorStore) GetNearest(context.Context, string, []float32, []vectorstore.Query, []string, float64, int64) ([]vectorstore.SearchResult, error) {
	return nil, nil
}
func (handlerVectorStore) RequiresVectors() bool { return true }
func (handlerVectorStore) Add(context.Context, string, string, []float32, map[string]interface{}) error {
	return nil
}
func (handlerVectorStore) Delete(context.Context, string, string) error { return nil }
func (handlerVectorStore) DeleteAll(context.Context, string, []vectorstore.Query) ([]vectorstore.DeleteResult, error) {
	return nil, nil
}
func (handlerVectorStore) Close(context.Context, string) error { return nil }

func newBackfillTestHandler(t *testing.T) (*WarpHandler, *fakeSidekiqStore, func()) {
	t.Helper()
	handler, jobs, _, cleanup := newTopicsTestHandler(t)
	return handler, jobs, cleanup
}

// newTopicsTestHandler is newBackfillTestHandler with the log store the
// topics live in, for a test that writes them.
func newTopicsTestHandler(t *testing.T) (*WarpHandler, *fakeSidekiqStore, logstore.LogStore, func()) {
	t.Helper()
	topics := handlerTopicStore(t)
	config := &recordingWarpStore{row: &tables.TableWarpConfig{
		ID: tables.WarpConfigRowID, Enabled: true, Provider: "openai", Model: "gpt-4o",
		EmbeddingProvider: "openai", EmbeddingModel: "embed", EmbeddingDimension: 2, LogVectorStoreNamespace: "WarpLogs",
	}}
	jobs := newFakeSidekiqStore()
	runner := sidekiq.New(jobs, &mockLogger{}, 1, "")
	service := warp.NewService(nil, warp.WithConfigStore(config), warp.WithLogReader(handlerBackfillReader{topics: topics}), warp.WithVectorStore(handlerVectorStore{}), warp.WithEmbeddingExecutor(func(_ *schemas.BifrostContext, _ *schemas.BifrostEmbeddingRequest) (*schemas.BifrostEmbeddingResponse, *schemas.BifrostError) {
		return &schemas.BifrostEmbeddingResponse{Data: []schemas.EmbeddingData{{Embedding: schemas.EmbeddingStruct{EmbeddingArray: []float64{0, 1}}}}}, nil
	}))
	service.RegisterBackfill(runner)
	handler := &WarpHandler{service: service, sidekiqRunner: runner, backfillStore: jobs}
	return handler, jobs, topics, func() { runner.Shutdown(); service.Shutdown() }
}

// handlerTopicStore is a real SQLite log store: topics are rows in it, and a
// job cannot be started on a deployment whose reader cannot reach one.
func handlerTopicStore(t *testing.T) logstore.LogStore {
	t.Helper()
	store, err := logstore.NewLogStore(context.Background(), &logstore.Config{
		Enabled: true, Type: logstore.LogStoreTypeSQLite,
		Config: &logstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "warp.db")},
	}, &mockLogger{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close(context.Background()) })
	return store
}

func (s *recordingWarpStore) GetWarpConfig(context.Context) (*tables.TableWarpConfig, error) {
	return s.row, nil
}

func (s *recordingWarpStore) UpsertWarpConfig(_ context.Context, config *tables.TableWarpConfig) error {
	s.upserted = append(s.upserted, *config)
	s.row = config
	return nil
}

func newTestWarpHandler(store *recordingWarpStore) *WarpHandler {
	return &WarpHandler{service: warp.NewService(nil, warp.WithConfigStore(store))}
}

const validWarpConfigJSON = `{"enabled":true,"provider":"openai","model":"gpt-4o","embedding_provider":"openai","embedding_model":"text-embedding-3-small","embedding_dimension":1536,"log_vector_store_namespace":"BifrostWarpLogs"}`

// adminCtx builds a request context that passes the local-admin gate.
// requestCtx is a request context with a server behind it, as fasthttp's
// handlers get one. A bare RequestCtx has no server, and its Done() - which
// the store's connection pool consults - dereferences nil; the panic then
// unwinds through the pool's own lock and the test's cleanup hangs on it.
func requestCtx() *fasthttp.RequestCtx {
	ctx := &fasthttp.RequestCtx{}
	ctx.Init(&fasthttp.Request{}, nil, nil)
	return ctx
}

func adminCtx(body string) *fasthttp.RequestCtx {
	ctx := requestCtx()
	ctx.SetUserValue(schemas.IsLocalAdminContextKey, true)
	ctx.Request.SetBodyString(body)
	return ctx
}

func TestWarpConfigPutRequiresLocalAdmin(t *testing.T) {
	handler := newTestWarpHandler(&recordingWarpStore{})
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetBodyString(validWarpConfigJSON)
	handler.putConfig(ctx)

	require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode())
}

func TestWarpConfigPutRejectsMalformedBody(t *testing.T) {
	store := &recordingWarpStore{}
	ctx := adminCtx(`{not json`)
	newTestWarpHandler(store).putConfig(ctx)

	require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode())
	require.Empty(t, store.upserted)
}

// Validation failures are the service's ErrInvalidConfig family; the handler
// maps them all to 400 and passes the reason through.
func TestWarpConfigPutMapsValidationTo400(t *testing.T) {
	store := &recordingWarpStore{}
	ctx := adminCtx(`{"enabled":true,"provider":"","model":"gpt-4o"}`)
	newTestWarpHandler(store).putConfig(ctx)

	require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode())
	require.Contains(t, string(ctx.Response.Body()), "provider is required")
	require.Empty(t, store.upserted)
}

// A store with no Warp support is a supported deployment: 503, not 500.
func TestWarpConfigWithoutStoreIs503(t *testing.T) {
	handler := &WarpHandler{service: warp.NewService(nil)}
	ctx := &fasthttp.RequestCtx{}
	handler.getConfig(ctx)
	require.Equal(t, fasthttp.StatusServiceUnavailable, ctx.Response.StatusCode())

	ctx = adminCtx(`{"enabled":false}`)
	handler.putConfig(ctx)
	require.Equal(t, fasthttp.StatusServiceUnavailable, ctx.Response.StatusCode())
}

func TestWarpConfigPutWithoutVectorStoreIs503(t *testing.T) {
	store := &recordingWarpStore{}
	ctx := adminCtx(validWarpConfigJSON)
	newTestWarpHandler(store).putConfig(ctx)
	require.Equal(t, fasthttp.StatusServiceUnavailable, ctx.Response.StatusCode())
	require.Contains(t, string(ctx.Response.Body()), string(schemas.WarpUnavailableNoVectorStore))
}

// The wire shape the settings page depends on: a key reference is a plain
// field, and defaults are resolved rather than sent as zero.
func TestWarpConfigGetBodyShape(t *testing.T) {
	handler := newTestWarpHandler(&recordingWarpStore{row: &tables.TableWarpConfig{
		ID: tables.WarpConfigRowID, Enabled: true, Provider: "openai", Model: "gpt-4o", APIKeyID: "key-abc",
		EmbeddingProvider: "openai", EmbeddingModel: "text-embedding-3-small", EmbeddingDimension: 1536,
		LogVectorStoreNamespace: schemas.WarpDefaultLogVectorStoreNamespace,
	}})
	ctx := &fasthttp.RequestCtx{}
	handler.getConfig(ctx)

	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
	var body map[string]any
	require.NoError(t, sonic.Unmarshal(ctx.Response.Body(), &body))
	require.Equal(t, true, body["configured"])
	require.Equal(t, "key-abc", body["api_key_id"])
	require.Equal(t, "text-embedding-3-small", body["embedding_model"])
	require.Equal(t, float64(schemas.WarpDefaultMaxIterations), body["max_iterations"])
	require.NotContains(t, body, "api_key")
}

func TestWarpBackfillAPIsRequireAdmin(t *testing.T) {
	handler, _, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	for _, call := range []func(*fasthttp.RequestCtx){handler.startBackfill, handler.backfillStatus, handler.cancelBackfill} {
		ctx := &fasthttp.RequestCtx{}
		call(ctx)
		require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode())
	}
}

func TestWarpStartBackfillEnqueuesDurableJob(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	ctx := adminCtx(`{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`)
	ctx.SetUserValue(schemas.BifrostContextKeyUserID, "admin-1")
	handler.startBackfill(ctx)
	require.Equal(t, fasthttp.StatusAccepted, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.Equal(t, 1, jobs.createdCount())
}

func TestWarpStartBackfillReturnsConflictForActiveJob(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	jobs.inFlight = &tables.TableSidekiqJob{ID: "running", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusRunning, Metadata: `{}`}
	ctx := adminCtx(`{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`)
	handler.startBackfill(ctx)
	require.Equal(t, fasthttp.StatusConflict, ctx.Response.StatusCode())
	require.Zero(t, jobs.createdCount())
}

func TestWarpBackfillStatusAndCancel(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	job := &tables.TableSidekiqJob{ID: "job-1", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusRunning, Metadata: `{"scanned":4,"indexed":3,"skipped":1}`}
	jobs.jobs[job.ID] = job
	jobs.inFlight = job

	statusCtx := adminCtx("")
	statusCtx.QueryArgs().Set("id", job.ID)
	handler.backfillStatus(statusCtx)
	require.Equal(t, fasthttp.StatusOK, statusCtx.Response.StatusCode())
	require.Contains(t, string(statusCtx.Response.Body()), `"indexed":3`)

	cancelCtx := adminCtx(`{"id":"job-1"}`)
	handler.cancelBackfill(cancelCtx)
	require.Equal(t, fasthttp.StatusOK, cancelCtx.Response.StatusCode())
	require.Contains(t, string(cancelCtx.Response.Body()), tables.SidekiqStatusCancelled)
}

// The tray shows whether semantic search is usable at a glance. This summary
// is readable by anyone who can chat, unlike the backfill controls, and folds
// the vector store connection and the latest indexing job into one state.
func TestWarpLogIndexStatusSummarisesState(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()

	ctx := adminCtx("")
	handler.logIndexStatus(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
	body := string(ctx.Response.Body())
	require.Contains(t, body, `"state":"ready"`)
	require.Contains(t, body, `"vector_store_connected":true`)
	// Live filing comes with a usable index: nothing built, nothing filed.
	require.Contains(t, body, `"topics":{"active_topics":0,"themes":0,"pooled":0,"requests_24h":0,"unmatched_24h":0,"unmatched_share_24h":0}`)
	// No topics yet, so whether there is anything to seed them from is asked.
	require.Contains(t, body, `"has_indexed_requests":false`)

	jobs.latest = &tables.TableSidekiqJob{ID: "job-f", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusFailed, LastError: "no keys found", Metadata: `{"scanned":100,"failed":100,"total":5000}`}
	ctx = adminCtx("")
	handler.logIndexStatus(ctx)
	body = string(ctx.Response.Body())
	require.Contains(t, body, `"state":"failed"`)
	require.Contains(t, body, "no keys found")

	jobs.inFlight = &tables.TableSidekiqJob{ID: "job-r", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusRunning, Metadata: `{"scanned":40,"total":100}`}
	ctx = adminCtx("")
	handler.logIndexStatus(ctx)
	body = string(ctx.Response.Body())
	require.Contains(t, body, `"state":"indexing"`)
	require.Contains(t, body, `"scanned":40`)
	require.Contains(t, body, `"total":100`)
}

// Topics are rows in the log store, so without one there is no run to start:
// the endpoint says the feature is unavailable rather than queueing a job
// that would fail on its first write.
func TestWarpTopicsStartNeedsALogStore(t *testing.T) {
	config := &recordingWarpStore{row: &tables.TableWarpConfig{
		ID: tables.WarpConfigRowID, Enabled: true, Provider: "openai", Model: "gpt-4o",
		EmbeddingProvider: "openai", EmbeddingModel: "embed", EmbeddingDimension: 2, LogVectorStoreNamespace: "WarpLogs",
	}}
	jobs := newFakeSidekiqStore()
	runner := sidekiq.New(jobs, &mockLogger{}, 1, "")
	defer runner.Shutdown()
	service := warp.NewService(nil, warp.WithConfigStore(config), warp.WithLogReader(handlerBackfillReader{}), warp.WithVectorStore(handlerVectorStore{}))
	defer service.Shutdown()
	handler := &WarpHandler{service: service, sidekiqRunner: runner, backfillStore: jobs}

	startCtx := adminCtx(`{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`)
	handler.startTopics(startCtx)
	require.Equal(t, fasthttp.StatusServiceUnavailable, startCtx.Response.StatusCode(), string(startCtx.Response.Body()))
	require.Zero(t, jobs.createdCount())
}

// Topic clustering rides on the same job endpoints as the backfill: start
// over a window, read status by id or latest, cancel.
func TestWarpTopicsJobEndpoints(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()

	startCtx := adminCtx(`{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`)
	handler.startTopics(startCtx)
	require.Equal(t, fasthttp.StatusAccepted, startCtx.Response.StatusCode(), string(startCtx.Response.Body()))
	require.Equal(t, 1, jobs.createdCount())
	var started struct {
		ID string `json:"id"`
	}
	require.NoError(t, sonic.Unmarshal(startCtx.Response.Body(), &started))
	require.NotEmpty(t, started.ID)
	created := jobs.jobs[started.ID]
	require.Equal(t, warp.TopicsJobKind, created.Kind)

	jobs.inFlight = created
	statusCtx := adminCtx("")
	handler.topicsStatus(statusCtx)
	require.Equal(t, fasthttp.StatusOK, statusCtx.Response.StatusCode())
	require.Contains(t, string(statusCtx.Response.Body()), `"id":"`+started.ID+`"`)

	cancelCtx := adminCtx(`{"id":"` + started.ID + `"}`)
	handler.cancelTopics(cancelCtx)
	require.Equal(t, fasthttp.StatusOK, cancelCtx.Response.StatusCode())

	// The two job kinds do not see each other's runs.
	backfillCtx := adminCtx("")
	handler.backfillStatus(backfillCtx)
	require.Contains(t, string(backfillCtx.Response.Body()), `"status":"idle"`)
	require.NotContains(t, string(backfillCtx.Response.Body()), `merge_threshold`, "a backfill has no clustering to report")

	// A finished run reports how it clustered, not only how much it read.
	threshold := 0.87
	finished, err := sonic.Marshal(warp.BackfillJobMeta{
		Scanned: 12, Indexed: 2, Merged: 3, MergeThreshold: &threshold, Clustered: 8, Assigned: 3, Unassigned: 1,
		Topics: []warp.TopicSummary{{Label: "Refund requests", Size: 9, Cohesion: 0.91}, {Label: "Password resets", Size: 3, Cohesion: 0.84}},
	})
	require.NoError(t, err)
	jobs.inFlight = nil
	jobs.latest = &tables.TableSidekiqJob{ID: "job-done", Kind: warp.TopicsJobKind, Status: tables.SidekiqStatusCompleted, Metadata: string(finished)}
	doneCtx := adminCtx("")
	handler.topicsStatus(doneCtx)
	require.Equal(t, fasthttp.StatusOK, doneCtx.Response.StatusCode())
	body := string(doneCtx.Response.Body())
	require.Contains(t, body, `"merged":3`)
	require.Contains(t, body, `"clustered":8`)
	require.Contains(t, body, `"assigned":3`)
	require.Contains(t, body, `"unassigned":1`)
	require.Contains(t, body, `"merge_threshold":0.87`)
	require.Contains(t, body, `"topics":[{"label":"Refund requests","size":9,"cohesion":0.91},{"label":"Password resets","size":3,"cohesion":0.84}]`)
}

func TestWarpJobAuditMatchesJobKind(t *testing.T) {
	// 边界：两种任务；普通/重启入队；显式/隐式取消；提交后读取失败；重复取消。
	for _, tc := range []struct {
		name      string
		path      string
		kind      string
		auditType string
	}{
		{name: "backfill", path: "backfill", kind: warp.BackfillJobKind, auditType: "warp_backfill"},
		{name: "topics", path: "topics", kind: warp.TopicsJobKind, auditType: "warp_topics"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, restart := range []bool{false, true} {
				name := "start"
				if restart {
					name = "restart"
				}
				t.Run(name, func(t *testing.T) {
					handler, jobs, cleanup := newBackfillTestHandler(t)
					defer cleanup()
					r := router.New()
					handler.RegisterRoutes(r)
					request := warpBackfillRequest{
						StartTime: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC),
						EndTime:   time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC),
						Restart:   restart,
					}
					body, err := sonic.Marshal(request)
					require.NoError(t, err)
					ctx := adminCtx(string(body))
					ctx.Request.Header.SetMethod("POST")
					ctx.Request.SetRequestURI("/api/warp/log-index/" + tc.path)
					ctx.SetUserValue(schemas.BifrostContextKeyUserID, "audit-admin")
					r.Handler(ctx)

					require.Equal(t, fasthttp.StatusAccepted, ctx.Response.StatusCode(), "%s", ctx.Response.Body())
					var status warpBackfillStatus
					require.NoError(t, sonic.Unmarshal(ctx.Response.Body(), &status))
					require.NotEmpty(t, status.ID)
					created, err := jobs.GetSidekiqJob(context.Background(), status.ID)
					require.NoError(t, err)
					require.NotNil(t, created)
					require.Equal(t, tc.kind, created.Kind)
					require.Equal(t, "audit-admin", *created.CreatedByUserID)
					change := requireSingleAuditChange(t, ctx, tc.auditType+".started")
					require.Equal(t, tc.auditType, change.TargetType)
					require.Equal(t, status.ID, change.TargetID)
					require.Equal(t, status.ID, change.TargetName)
					require.Empty(t, change.Before)
					wantAfter, err := sonic.Marshal(map[string]any{
						"job_id": status.ID, "start_time": request.StartTime,
						"end_time": request.EndTime, "restart": restart,
					})
					require.NoError(t, err)
					require.JSONEq(t, string(wantAfter), string(change.After))
				})
			}
			for _, cancel := range []struct {
				name       string
				body       string
				status     string
				failReread bool
			}{
				{name: "cancel explicit", body: `{"id":"audit-job"}`, status: tables.SidekiqStatusRunning},
				{name: "cancel implicit", status: tables.SidekiqStatusPending},
				{name: "cancel with failed reread", body: `{"id":"audit-job"}`, status: tables.SidekiqStatusRunning, failReread: true},
			} {
				t.Run(cancel.name, func(t *testing.T) {
					handler, jobs, cleanup := newBackfillTestHandler(t)
					defer cleanup()
					job := &tables.TableSidekiqJob{ID: "audit-job", Kind: tc.kind, Status: cancel.status, Metadata: `{}`}
					jobs.jobs[job.ID] = job
					jobs.inFlight = job
					jobs.failGetAfterCancel = cancel.failReread
					r := router.New()
					handler.RegisterRoutes(r)
					ctx := adminCtx(cancel.body)
					ctx.Request.Header.SetMethod("POST")
					ctx.Request.SetRequestURI("/api/warp/log-index/" + tc.path + "/cancel")
					r.Handler(ctx)

					require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), "%s", ctx.Response.Body())
					require.Contains(t, string(ctx.Response.Body()), `"status":"cancelled"`)
					change := requireSingleAuditChange(t, ctx, tc.auditType+".cancelled")
					require.Equal(t, tc.auditType, change.TargetType)
					require.Equal(t, job.ID, change.TargetID)
					require.Equal(t, job.ID, change.TargetName)
					require.JSONEq(t, `{"job_id":"audit-job","status":"`+cancel.status+`"}`, string(change.Before))
					require.JSONEq(t, `{"job_id":"audit-job","status":"cancelled"}`, string(change.After))

					jobs.failGetAfterCancel = false
					again := adminCtx(`{"id":"audit-job"}`)
					again.Request.Header.SetMethod("POST")
					again.Request.SetRequestURI("/api/warp/log-index/" + tc.path + "/cancel")
					r.Handler(again)
					require.Equal(t, fasthttp.StatusOK, again.Response.StatusCode())
					require.Empty(t, auditChanges(t, again), "repeated cancellation must not claim another transition")
				})
			}
		})
	}
}

type warpAuditJobStore struct {
	*fakeSidekiqStore
	writeErr  error
	readErr   error
	lookupErr error
}

func (s *warpAuditJobStore) CreateSidekiqJob(ctx context.Context, job *tables.TableSidekiqJob) error {
	if s.writeErr != nil {
		return s.writeErr
	}
	return s.fakeSidekiqStore.CreateSidekiqJob(ctx, job)
}

func (s *warpAuditJobStore) CancelSidekiqJob(ctx context.Context, id string) (bool, error) {
	if s.writeErr != nil {
		return false, s.writeErr
	}
	return s.fakeSidekiqStore.CancelSidekiqJob(ctx, id)
}

func (s *warpAuditJobStore) GetSidekiqJob(ctx context.Context, id string) (*tables.TableSidekiqJob, error) {
	if s.readErr != nil {
		return nil, s.readErr
	}
	return s.fakeSidekiqStore.GetSidekiqJob(ctx, id)
}

func (s *warpAuditJobStore) GetInFlightSidekiqJobByKind(ctx context.Context, kind string) (*tables.TableSidekiqJob, error) {
	if s.lookupErr != nil {
		return nil, s.lookupErr
	}
	return s.fakeSidekiqStore.GetInFlightSidekiqJobByKind(ctx, kind)
}

func newWarpAuditTestHandler(t *testing.T) (*WarpHandler, *warpAuditJobStore) {
	t.Helper()
	handler, jobs, cleanup := newBackfillTestHandler(t)
	t.Cleanup(cleanup)
	store := &warpAuditJobStore{fakeSidekiqStore: jobs}
	runner := sidekiq.New(store, &mockLogger{}, 1, "")
	handler.service.RegisterBackfill(runner)
	t.Cleanup(runner.Shutdown)
	handler.sidekiqRunner = runner
	handler.backfillStore = store
	return handler, store
}

func TestWarpJobAuditStartSurvivesFailedReread(t *testing.T) {
	for _, path := range []string{"backfill", "topics"} {
		t.Run(path, func(t *testing.T) {
			handler, jobs := newWarpAuditTestHandler(t)
			jobs.readErr = errors.New("response reread failed")
			ctx := adminCtx(`{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`)
			r := router.New()
			handler.RegisterRoutes(r)
			ctx.Request.Header.SetMethod("POST")
			ctx.Request.SetRequestURI("/api/warp/log-index/" + path)
			r.Handler(ctx)

			require.Equal(t, fasthttp.StatusAccepted, ctx.Response.StatusCode(), "%s", ctx.Response.Body())
			var status warpBackfillStatus
			require.NoError(t, sonic.Unmarshal(ctx.Response.Body(), &status))
			require.NotEmpty(t, status.ID)
			require.Equal(t, tables.SidekiqStatusPending, status.Status)
			require.Equal(t, 1, jobs.createdCount())
			auditType := "warp_" + path
			change := requireSingleAuditChange(t, ctx, auditType+".started")
			require.Equal(t, auditType, change.TargetType)
			require.Equal(t, status.ID, change.TargetID)
		})
	}
}

func TestWarpJobAuditDoesNotRecordUncommittedChanges(t *testing.T) {
	// 边界：拒绝、非法输入、依赖不可用、读写失败、冲突、异类任务、终态及只读查询。
	const window = `{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`
	for _, jobType := range []struct {
		path string
		kind string
	}{
		{path: "backfill", kind: warp.BackfillJobKind},
		{path: "topics", kind: warp.TopicsJobKind},
	} {
		t.Run(jobType.path, func(t *testing.T) {
			for _, tc := range []struct {
				name      string
				suffix    string
				body      string
				status    int
				anonymous bool
				configure func(*WarpHandler, *warpAuditJobStore)
			}{
				{name: "start forbidden", body: window, status: 403, anonymous: true},
				{name: "start malformed", body: `{`, status: 400},
				{name: "start without window", body: `{}`, status: 400},
				{name: "start empty window", body: `{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-01T00:00:00Z"}`, status: 400},
				{name: "start inverted window", body: `{"start_time":"2026-09-02T00:00:00Z","end_time":"2026-09-01T00:00:00Z"}`, status: 400},
				{name: "start disabled", body: window, status: 404, configure: func(h *WarpHandler, _ *warpAuditJobStore) { h.enabled = func() bool { return false } }},
				{name: "start missing runner", body: window, status: 503, configure: func(h *WarpHandler, _ *warpAuditJobStore) { h.sidekiqRunner = nil }},
				{name: "start missing store", body: window, status: 503, configure: func(h *WarpHandler, _ *warpAuditJobStore) { h.backfillStore = nil }},
				{name: "start lookup failed", body: window, status: 500, configure: func(_ *WarpHandler, s *warpAuditJobStore) { s.lookupErr = errors.New("lookup failed") }},
				{name: "start enqueue failed", body: window, status: 500, configure: func(_ *WarpHandler, s *warpAuditJobStore) { s.writeErr = errors.New("enqueue failed") }},
				{name: "start conflict", body: window, status: 409, configure: func(_ *WarpHandler, s *warpAuditJobStore) {
					s.inFlight = &tables.TableSidekiqJob{ID: "already-running", Kind: jobType.kind, Status: tables.SidekiqStatusRunning}
				}},
				{name: "cancel forbidden", suffix: "/cancel", body: `{"id":"audit-job"}`, status: 403, anonymous: true},
				{name: "cancel malformed", suffix: "/cancel", body: `{`, status: 400},
				{name: "cancel unknown", suffix: "/cancel", body: `{"id":"missing"}`, status: 404},
				{name: "cancel no active job", suffix: "/cancel", status: 404},
				{name: "cancel read failed", suffix: "/cancel", body: `{"id":"audit-job"}`, status: 500, configure: func(_ *WarpHandler, s *warpAuditJobStore) { s.readErr = errors.New("read failed") }},
				{name: "cancel lookup failed", suffix: "/cancel", status: 500, configure: func(_ *WarpHandler, s *warpAuditJobStore) { s.lookupErr = errors.New("lookup failed") }},
				{name: "cancel write failed", suffix: "/cancel", body: `{"id":"audit-job"}`, status: 500, configure: func(_ *WarpHandler, s *warpAuditJobStore) { s.writeErr = errors.New("cancel failed") }},
				{name: "cancel foreign job", suffix: "/cancel", body: `{"id":"audit-job"}`, status: 404, configure: func(_ *WarpHandler, s *warpAuditJobStore) { s.jobs["audit-job"].Kind = "pricing_sync" }},
				{name: "cancel completed", suffix: "/cancel", body: `{"id":"audit-job"}`, status: 200, configure: func(_ *WarpHandler, s *warpAuditJobStore) { s.jobs["audit-job"].Status = tables.SidekiqStatusCompleted }},
				{name: "cancel failed", suffix: "/cancel", body: `{"id":"audit-job"}`, status: 200, configure: func(_ *WarpHandler, s *warpAuditJobStore) { s.jobs["audit-job"].Status = tables.SidekiqStatusFailed }},
				{name: "cancel already cancelled", suffix: "/cancel", body: `{"id":"audit-job"}`, status: 200, configure: func(_ *WarpHandler, s *warpAuditJobStore) { s.jobs["audit-job"].Status = tables.SidekiqStatusCancelled }},
				{name: "status read only", suffix: "/status", status: 200},
			} {
				t.Run(tc.name, func(t *testing.T) {
					handler, jobs := newWarpAuditTestHandler(t)
					if tc.suffix == "/cancel" {
						jobs.jobs["audit-job"] = &tables.TableSidekiqJob{ID: "audit-job", Kind: jobType.kind, Status: tables.SidekiqStatusRunning}
					}
					if tc.configure != nil {
						tc.configure(handler, jobs)
					}
					r := router.New()
					handler.RegisterRoutes(r)
					ctx := adminCtx(tc.body)
					if tc.anonymous {
						ctx.ResetUserValues()
					}
					ctx.Request.Header.SetMethod("POST")
					if tc.suffix == "/status" {
						ctx.Request.Header.SetMethod("GET")
					}
					ctx.Request.SetRequestURI("/api/warp/log-index/" + jobType.path + tc.suffix)
					r.Handler(ctx)

					require.Equal(t, tc.status, ctx.Response.StatusCode(), "%s", ctx.Response.Body())
					require.Empty(t, auditChanges(t, ctx), "a rejected write, terminal no-op or read cannot claim a mutation")
					require.Zero(t, jobs.createdCount())
					require.False(t, jobs.cancelled)
				})
			}
		})
	}
}

func TestWarpJobAuditPersistsThroughManagementRoutes(t *testing.T) {
	const password = "Warp-Audit-Route-Password-123!"
	hash, err := encrypt.Hash(password)
	require.NoError(t, err)
	for _, path := range []string{"backfill", "topics"} {
		t.Run(path, func(t *testing.T) {
			SetLogger(&mockLogger{})
			ctx := context.Background()
			storeConfig := &configstore.Config{
				Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
				Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "warp-audit.db")},
			}
			cs, err := configstore.NewConfigStore(ctx, storeConfig, &mockLogger{})
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, cs.Close(ctx)) })
			store, err := controlplane.NewStore(ctx, cs)
			require.NoError(t, err)
			audit := controlplane.NewHandler(store, nil)
			auth := &AuthMiddleware{}
			auth.UpdateAuthConfig(&configstore.AuthConfig{
				IsEnabled: true, AdminUserName: schemas.NewSecretVar("warp-admin"), AdminPassword: schemas.NewSecretVar(hash),
			})
			handler, _, cleanup := newBackfillTestHandler(t)
			defer cleanup()
			r := router.New()
			handler.RegisterRoutes(r, auth.APIMiddleware(), audit.ManagementAuditMiddleware(&mockLogger{}))
			audit.RegisterRoutes(r, auth.APIMiddleware())
			authorization := "Basic " + base64.StdEncoding.EncodeToString([]byte("warp-admin:"+password))
			call := func(method, route, body, credential string) *fasthttp.RequestCtx {
				request := requestCtx()
				request.Request.Header.SetMethod(method)
				request.Request.SetRequestURI(route)
				request.Request.Header.SetContentType("application/json")
				request.Request.Header.Set("Authorization", credential)
				request.Request.Header.Set("X-User-ID", "forged-actor")
				request.Request.SetBodyString(body)
				r.Handler(request)
				return request
			}
			route := "/api/warp/log-index/" + path
			body := `{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`
			denied := call("POST", route, body, "")
			require.Equal(t, fasthttp.StatusUnauthorized, denied.Response.StatusCode())
			started := call("POST", route, body, authorization)
			require.Equal(t, fasthttp.StatusAccepted, started.Response.StatusCode(), "%s", started.Response.Body())
			require.Empty(t, started.Response.Header.Peek(lib.HeaderAuditStatus))
			var status warpBackfillStatus
			require.NoError(t, sonic.Unmarshal(started.Response.Body(), &status))
			require.NotEmpty(t, status.ID)
			cancelBody, err := sonic.Marshal(warpBackfillCancelRequest{ID: status.ID})
			require.NoError(t, err)
			for range 2 {
				cancelled := call("POST", route+"/cancel", string(cancelBody), authorization)
				require.Equal(t, fasthttp.StatusOK, cancelled.Response.StatusCode(), "%s", cancelled.Response.Body())
				require.Empty(t, cancelled.Response.Header.Peek(lib.HeaderAuditStatus))
			}
			feed := call("GET", "/api/control-plane/audit-events", "", authorization)
			require.Equal(t, fasthttp.StatusOK, feed.Response.StatusCode(), "%s", feed.Response.Body())
			var events struct {
				Data []controlplane.AuditEvent `json:"data"`
			}
			require.NoError(t, sonic.Unmarshal(feed.Response.Body(), &events))
			require.Len(t, events.Data, 2, "anonymous rejection, repeated cancel and feed reads must not add events")
			auditType := "warp_" + path
			actions := make([]string, 0, 2)
			for _, event := range events.Data {
				actions = append(actions, event.Action)
				require.Equal(t, auditType, event.ResourceType)
				require.Equal(t, status.ID, event.ResourceID)
				require.Equal(t, "local-admin:warp-admin", event.ActorID)
			}
			require.ElementsMatch(t, []string{auditType + ".started", auditType + ".cancelled"}, actions)
			require.NoError(t, cs.Close(ctx))
			cs, err = configstore.NewConfigStore(ctx, storeConfig, &mockLogger{})
			require.NoError(t, err)
			reopened, err := controlplane.NewStore(ctx, cs)
			require.NoError(t, err)
			reloaded, err := reopened.ListAudit(ctx, 10)
			require.NoError(t, err)
			require.Equal(t, events.Data, reloaded, "correct job identities must survive SQLite reopen")
		})
	}
}

func BenchmarkWarpJobAuditRecord(b *testing.B) {
	at := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	b.Run("fixed_identity_baseline", func(b *testing.B) {
		ctx := requestCtx()
		b.ReportAllocs()
		for b.Loop() {
			ctx.ResetUserValues()
			lib.RecordAuditChange(ctx, "warp_backfill.started", "warp_backfill", "job-1", "job-1", nil,
				map[string]any{"job_id": "job-1", "start_time": at, "end_time": at.Add(time.Hour), "restart": false})
		}
	})
	b.Run("job_spec_identity", func(b *testing.B) {
		ctx := requestCtx()
		spec := warpJobSpec{auditType: "warp_backfill"}
		b.ReportAllocs()
		for b.Loop() {
			ctx.ResetUserValues()
			lib.RecordAuditChange(ctx, spec.auditType+".started", spec.auditType, "job-1", "job-1", nil,
				map[string]any{"job_id": "job-1", "start_time": at, "end_time": at.Add(time.Hour), "restart": false})
		}
	})
}

type warpConversationAuditStore struct {
	logstore.LogStore
	deleteErr error
}

func (s *warpConversationAuditStore) DeleteWarpConversation(ctx context.Context, ownerID, id string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	return s.LogStore.DeleteWarpConversation(ctx, ownerID, id)
}

func newWarpConversationAuditHandler(t *testing.T) (*WarpHandler, *warpConversationAuditStore) {
	t.Helper()
	store := &warpConversationAuditStore{LogStore: handlerTopicStore(t)}
	service := warp.NewService(nil, warp.WithConversationStore(store))
	t.Cleanup(service.Shutdown)
	return &WarpHandler{service: service}, store
}

func seedWarpAuditConversation(t *testing.T, store logstore.WarpConversationStore, ownerID, id string) {
	t.Helper()
	ctx := context.Background()
	require.NoError(t, store.CreateWarpConversation(ctx, &logstore.WarpConversation{
		ID: id, OwnerID: ownerID, Title: "private-conversation-title",
	}))
	require.NoError(t, store.AppendWarpMessages(ctx, ownerID, id, []logstore.WarpMessage{
		{ID: id + "-user", Role: "user", Content: "private-user-prompt"},
		{
			ID: id + "-answer", Role: "assistant", Content: "private-assistant-answer",
			ToolCallsJSON: `[{"name":"private-tool","arguments":{"token":"private-tool-token"}}]`,
			QuestionJSON:  `{"prompt":"private-clarification"}`, Error: "private-model-error",
		},
	}))
}

func TestWarpConversationDeleteRecordsOnlyCommittedIdentity(t *testing.T) {
	// 边界：本人/共享/不透明用户；缺失/异主/重放；存储不可用/失败；伪造归属字段。
	for _, tc := range []struct {
		name        string
		userID      string
		ownerID     string
		requestID   string
		unavailable bool
		deleteErr   error
		status      int
		wantEvent   bool
	}{
		{name: "owner", userID: "user-1", ownerID: schemas.WarpOwnerID("user-1"), requestID: "thread-1", status: 204, wantEvent: true},
		{name: "shared", ownerID: schemas.WarpOwnerID(""), requestID: "thread-1", status: 204, wantEvent: true},
		{name: "opaque subject", userID: " user-1 ", ownerID: schemas.WarpOwnerID(" user-1 "), requestID: "thread-1", status: 204, wantEvent: true},
		{name: "foreign owner", userID: "user-1", ownerID: schemas.WarpOwnerID("user-2"), requestID: "thread-1", status: 404},
		{name: "no shared owner fallback", userID: "user-1", ownerID: schemas.WarpOwnerID(""), requestID: "thread-1", status: 404},
		{name: "opaque subject is not trimmed", userID: "user-1", ownerID: schemas.WarpOwnerID(" user-1 "), requestID: "thread-1", status: 404},
		{name: "missing thread", userID: "user-1", ownerID: schemas.WarpOwnerID("user-1"), requestID: "missing", status: 404},
		{name: "missing ID", userID: "user-1", ownerID: schemas.WarpOwnerID("user-1"), status: 400},
		{name: "unavailable", ownerID: schemas.WarpOwnerID(""), requestID: "thread-1", unavailable: true, status: 503},
		{name: "failed delete", ownerID: schemas.WarpOwnerID(""), requestID: "thread-1", deleteErr: errors.New("delete failed"), status: 500},
	} {
		t.Run(tc.name, func(t *testing.T) {
			SetLogger(&mockLogger{})
			handler, store := newWarpConversationAuditHandler(t)
			seedWarpAuditConversation(t, store, tc.ownerID, "thread-1")
			store.deleteErr = tc.deleteErr
			if tc.unavailable {
				handler.service = warp.NewService(nil)
				t.Cleanup(handler.service.Shutdown)
			}
			ctx := requestCtx()
			ctx.SetUserValue("id", tc.requestID)
			ctx.SetUserValue(schemas.BifrostContextKeyUserID, tc.userID)
			ctx.Request.Header.Set("X-User-ID", "user-2")
			ctx.QueryArgs().Set("owner_id", tc.ownerID)
			ctx.Request.SetBodyString(`{"owner_id":"` + tc.ownerID + `"}`)
			handler.deleteConversation(ctx)
			require.Equal(t, tc.status, ctx.Response.StatusCode(), "%s", ctx.Response.Body())

			if !tc.wantEvent {
				require.Empty(t, auditChanges(t, ctx))
				retained, err := store.GetWarpConversation(context.Background(), tc.ownerID, "thread-1")
				require.NoError(t, err)
				require.Len(t, retained.Messages, 2, "rejected or failed deletion must preserve the transcript")
				require.NotContains(t, string(ctx.Response.Body()), "private-")
				return
			}
			change := requireSingleAuditChange(t, ctx, "warp_conversation.deleted")
			require.Equal(t, "warp_conversation", change.TargetType)
			require.Equal(t, "thread-1", change.TargetID)
			require.Empty(t, change.TargetName)
			require.JSONEq(t, `{"id":"thread-1"}`, string(change.Before))
			require.Empty(t, change.After)
			for _, secret := range []string{"private-conversation-title", "private-user-prompt", "private-assistant-answer", "private-tool", "private-tool-token", "private-clarification", "private-model-error", tc.ownerID} {
				requireNoSecret(t, change, secret)
			}
			_, err := store.GetWarpConversation(context.Background(), tc.ownerID, "thread-1")
			require.ErrorIs(t, err, logstore.ErrWarpConversationNotFound)
			counts, err := store.CountWarpMessages(context.Background(), []string{"thread-1"})
			require.NoError(t, err)
			require.Zero(t, counts["thread-1"], "successful deletion must remove the transcript as well")

			again := requestCtx()
			again.SetUserValue("id", "thread-1")
			again.SetUserValue(schemas.BifrostContextKeyUserID, tc.userID)
			handler.deleteConversation(again)
			require.Equal(t, fasthttp.StatusNotFound, again.Response.StatusCode())
			require.Empty(t, auditChanges(t, again), "a repeated deletion must not record another event")
		})
	}
}

func TestWarpConversationReadsAndDisabledDeletesDoNotAudit(t *testing.T) {
	handler, store := newWarpConversationAuditHandler(t)
	seedWarpAuditConversation(t, store, schemas.WarpOwnerID(""), "thread-1")
	r := router.New()
	handler.RegisterRoutes(r)
	for _, route := range []string{"/api/warp/conversations", "/api/warp/conversations/thread-1"} {
		ctx := requestCtx()
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI(route)
		r.Handler(ctx)
		require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), "%s", ctx.Response.Body())
		require.Empty(t, auditChanges(t, ctx))
	}
	handler.enabled = func() bool { return false }
	disabled := requestCtx()
	disabled.Request.Header.SetMethod("DELETE")
	disabled.Request.SetRequestURI("/api/warp/conversations/thread-1")
	r.Handler(disabled)
	require.Equal(t, fasthttp.StatusNotFound, disabled.Response.StatusCode())
	require.Empty(t, auditChanges(t, disabled))
	_, err := store.GetWarpConversation(context.Background(), schemas.WarpOwnerID(""), "thread-1")
	require.NoError(t, err)
}

func TestWarpConversationDeleteAuditThroughManagementRoutes(t *testing.T) {
	const password = "Warp-History-Route-Password-123!"
	hash, err := encrypt.Hash(password)
	require.NoError(t, err)
	// 边界：Basic 管理员、未启用认证的共享归属、删除提交后审计存储失败。
	for _, tc := range []struct {
		name        string
		authEnabled bool
		failAudit   bool
		wantActor   string
	}{
		{name: "basic", authEnabled: true, wantActor: "local-admin:history-admin"},
		{name: "auth disabled", wantActor: "anonymous"},
		{name: "audit write failed", authEnabled: true, failAudit: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			SetLogger(&mockLogger{})
			ctx := context.Background()
			storeConfig := &configstore.Config{
				Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
				Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "history-audit.db")},
			}
			cs, err := configstore.NewConfigStore(ctx, storeConfig, &mockLogger{})
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, cs.Close(ctx)) })
			auditStore, err := controlplane.NewStore(ctx, cs)
			require.NoError(t, err)
			audit := controlplane.NewHandler(auditStore, nil)
			auth := &AuthMiddleware{}
			auth.UpdateAuthConfig(&configstore.AuthConfig{
				IsEnabled: tc.authEnabled, AdminUserName: schemas.NewSecretVar("history-admin"), AdminPassword: schemas.NewSecretVar(hash),
			})
			handler, history := newWarpConversationAuditHandler(t)
			seedWarpAuditConversation(t, history, schemas.WarpOwnerID(""), "shared-thread")
			seedWarpAuditConversation(t, history, schemas.WarpOwnerID("foreign-owner"), "foreign-thread")
			r := router.New()
			handler.RegisterRoutes(r, auth.APIMiddleware(), audit.ManagementAuditMiddleware(&mockLogger{}))
			audit.RegisterRoutes(r, auth.APIMiddleware())
			authorization := ""
			if tc.authEnabled {
				authorization = "Basic " + base64.StdEncoding.EncodeToString([]byte("history-admin:"+password))
				denied := requestCtx()
				denied.Request.Header.SetMethod("DELETE")
				denied.Request.SetRequestURI("/api/warp/conversations/shared-thread")
				r.Handler(denied)
				require.Equal(t, fasthttp.StatusUnauthorized, denied.Response.StatusCode())
			}
			call := func(method, route string) *fasthttp.RequestCtx {
				request := requestCtx()
				request.Request.Header.SetMethod(method)
				request.Request.SetRequestURI(route)
				request.Request.Header.Set("Authorization", authorization)
				request.Request.Header.Set("X-User-ID", "foreign-owner")
				request.QueryArgs().Set("owner_id", schemas.WarpOwnerID("foreign-owner"))
				if method == "DELETE" {
					request.Request.SetBodyString(`{"owner_id":"user:foreign-owner","id":"foreign-thread"}`)
				}
				r.Handler(request)
				return request
			}
			foreign := call("DELETE", "/api/warp/conversations/foreign-thread")
			missing := call("DELETE", "/api/warp/conversations/missing-thread")
			require.Equal(t, fasthttp.StatusNotFound, foreign.Response.StatusCode())
			require.Equal(t, fasthttp.StatusNotFound, missing.Response.StatusCode())
			require.Equal(t, string(missing.Response.Body()), string(foreign.Response.Body()), "foreign existence must not be disclosed")
			events, err := auditStore.ListAudit(ctx, 10)
			require.NoError(t, err)
			require.Empty(t, events)
			if tc.failAudit {
				require.NoError(t, cs.DB().Migrator().DropTable(&controlplane.AuditEvent{}))
			}
			deleted := call("DELETE", "/api/warp/conversations/shared-thread")
			require.Equal(t, fasthttp.StatusNoContent, deleted.Response.StatusCode(), "%s", deleted.Response.Body())
			require.Empty(t, deleted.Response.Body())
			_, err = history.GetWarpConversation(ctx, schemas.WarpOwnerID(""), "shared-thread")
			require.ErrorIs(t, err, logstore.ErrWarpConversationNotFound)
			counts, err := history.CountWarpMessages(ctx, []string{"shared-thread"})
			require.NoError(t, err)
			require.Zero(t, counts["shared-thread"])
			retained, err := history.GetWarpConversation(ctx, schemas.WarpOwnerID("foreign-owner"), "foreign-thread")
			require.NoError(t, err)
			require.Len(t, retained.Messages, 2)
			repeated := call("DELETE", "/api/warp/conversations/shared-thread")
			require.Equal(t, fasthttp.StatusNotFound, repeated.Response.StatusCode())
			require.Empty(t, repeated.Response.Header.Peek(lib.HeaderAuditStatus))
			if tc.failAudit {
				require.Equal(t, "failed", string(deleted.Response.Header.Peek(lib.HeaderAuditStatus)))
				requireSingleAuditChange(t, deleted, "warp_conversation.deleted")
				_, err := auditStore.ListAudit(ctx, 10)
				require.Error(t, err, "failure must remain observable, not claim successful audit persistence")
				return
			}
			require.Empty(t, deleted.Response.Header.Peek(lib.HeaderAuditStatus))
			persisted, err := auditStore.ListAudit(ctx, 10)
			require.NoError(t, err)
			require.Len(t, persisted, 1)
			event := persisted[0]
			require.Equal(t, tc.wantActor, event.ActorID)
			require.Equal(t, "warp_conversation.deleted", event.Action)
			require.Equal(t, "warp_conversation", event.ResourceType)
			require.Equal(t, "shared-thread", event.ResourceID)
			feed := call("GET", "/api/control-plane/audit-events")
			if tc.authEnabled {
				require.Equal(t, fasthttp.StatusOK, feed.Response.StatusCode(), "%s", feed.Response.Body())
				var response struct {
					Data []controlplane.AuditEvent `json:"data"`
				}
				require.NoError(t, sonic.Unmarshal(feed.Response.Body(), &response))
				require.Equal(t, persisted, response.Data)
			} else {
				require.Equal(t, fasthttp.StatusForbidden, feed.Response.StatusCode(), "anonymous mutation auditing must not open the admin feed")
			}
			require.NotContains(t, string(feed.Response.Body()), "private-")
			require.NotContains(t, string(feed.Response.Body()), password)
			require.NoError(t, cs.Close(ctx))
			cs, err = configstore.NewConfigStore(ctx, storeConfig, &mockLogger{})
			require.NoError(t, err)
			reopened, err := controlplane.NewStore(ctx, cs)
			require.NoError(t, err)
			reloaded, err := reopened.ListAudit(ctx, 10)
			require.NoError(t, err)
			require.Equal(t, persisted, reloaded, "the compact deletion event must survive SQLite reopen")
		})
	}
}

func BenchmarkWarpConversationDeleteAuditRecord(b *testing.B) {
	ctx := requestCtx()
	const id = "11111111-2222-4333-8444-555555555555"
	b.ReportAllocs()
	for b.Loop() {
		ctx.ResetUserValues()
		lib.RecordAuditChange(ctx, "warp_conversation.deleted", "warp_conversation", id, "", map[string]any{"id": id}, nil)
	}
}

// A topics run is refused before anything is queued when the request cannot
// be one: no window, a body that is not JSON, a window that ends before it
// starts, a caller who is not an administrator. And a second run is not
// started beside one in flight - the caller is handed the one that is running.
func TestWarpTopicsStartRefusesWhatItCannotRun(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()

	for name, body := range map[string]string{
		"no window":         `{}`,
		"not JSON":          `{`,
		"an inverted range": `{"start_time":"2026-09-02T00:00:00Z","end_time":"2026-09-01T00:00:00Z"}`,
		"an empty range":    `{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-01T00:00:00Z"}`,
	} {
		ctx := adminCtx(body)
		handler.startTopics(ctx)
		require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode(), "%s: %s", name, ctx.Response.Body())
	}
	require.Zero(t, jobs.createdCount(), "nothing was queued")

	stranger := &fasthttp.RequestCtx{}
	stranger.Request.SetBodyString(`{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`)
	handler.startTopics(stranger)
	require.Equal(t, fasthttp.StatusForbidden, stranger.Response.StatusCode())
	require.Zero(t, jobs.createdCount())

	jobs.inFlight = &tables.TableSidekiqJob{ID: "job-running", Kind: warp.TopicsJobKind, Status: tables.SidekiqStatusRunning}
	again := adminCtx(`{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`)
	handler.startTopics(again)
	require.Equal(t, fasthttp.StatusConflict, again.Response.StatusCode())
	require.Contains(t, string(again.Response.Body()), `"id":"job-running"`)
	require.Zero(t, jobs.createdCount())

	// A discovery writes topics in the same partition, so it holds a seed run
	// back the same way.
	jobs.inFlight = &tables.TableSidekiqJob{ID: "job-discovering", Kind: warp.TopicDiscoveryJobKind, Status: tables.SidekiqStatusPending}
	beside := adminCtx(`{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`)
	handler.startTopics(beside)
	require.Equal(t, fasthttp.StatusConflict, beside.Response.StatusCode(), string(beside.Response.Body()))
	require.Contains(t, string(beside.Response.Body()), `"id":"job-discovering"`)
	require.Zero(t, jobs.createdCount())
}

// racingJobStore lets two starts' in-flight lookups overlap: each waits a
// moment for the other before it answers, and any job created of the kind
// counts as in flight. Starts admitted one at a time cannot overlap, so the
// second sees the job the first queued.
type racingJobStore struct {
	*fakeSidekiqStore
	arrived atomic.Int32
	both    chan struct{}
}

func (s *racingJobStore) GetInFlightSidekiqJobByKind(_ context.Context, kind string) (*tables.TableSidekiqJob, error) {
	if s.arrived.Add(1) == 2 {
		close(s.both)
	}
	select {
	case <-s.both:
	case <-time.After(200 * time.Millisecond):
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, job := range s.jobs {
		if job.Kind == kind {
			copy := *job
			return &copy, nil
		}
	}
	return nil, nil
}

// Two seed runs started at once queue one job, not two: the lookup and the
// enqueue are admitted together, and the partition alone would only run the
// second after the first.
func TestWarpTopicsStartAdmitsOneOfTwoConcurrentRuns(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	handler.backfillStore = &racingJobStore{fakeSidekiqStore: jobs, both: make(chan struct{})}

	var wg sync.WaitGroup
	codes := make([]int, 2)
	for index := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx := adminCtx(`{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`)
			handler.startTopics(ctx)
			codes[index] = ctx.Response.StatusCode()
		}()
	}
	wg.Wait()
	require.ElementsMatch(t, []int{fasthttp.StatusAccepted, fasthttp.StatusConflict}, codes)
	require.Equal(t, 1, jobs.createdCount())
}

// A page reload has no job id in memory and asks for "whatever is current".
// Once a job finishes, nothing is in flight, so without a fallback the last
// outcome, including a failure and its cause, vanishes from the settings page.
func TestWarpBackfillStatusWithoutIDFallsBackToLatestJob(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	jobs.latest = &tables.TableSidekiqJob{
		ID: "job-old", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusFailed,
		LastError: "Warp backfill stopped after 100 consecutive failures: no keys found that support model: openai/embed",
		Metadata:  `{"scanned":100,"failed":100}`,
	}

	statusCtx := adminCtx("")
	handler.backfillStatus(statusCtx)
	require.Equal(t, fasthttp.StatusOK, statusCtx.Response.StatusCode())
	body := string(statusCtx.Response.Body())
	require.Contains(t, body, `"id":"job-old"`)
	require.Contains(t, body, `"status":"failed"`)
	require.Contains(t, body, `"failed":100`)
	require.Contains(t, body, "no keys found")

	// An in-flight job still takes priority over the historical one.
	jobs.inFlight = &tables.TableSidekiqJob{ID: "job-new", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusRunning, Metadata: `{}`}
	statusCtx = adminCtx("")
	handler.backfillStatus(statusCtx)
	require.Equal(t, fasthttp.StatusOK, statusCtx.Response.StatusCode())
	require.Contains(t, string(statusCtx.Response.Body()), `"id":"job-new"`)
}

// A finished backfill describes the embedding space it ran under. After the
// embedding model was changed and saved, the settings page still showed the
// old run as "Completed" over a full progress bar, beside a space nothing has
// been indexed into - and the Start button stayed disabled for that window as
// "already fully indexed". A job frozen against another space is not the
// current state of this one, so the id-less read answers idle instead. A job
// that is still running is shown regardless: it needs its cancel action.
func TestWarpBackfillStatusHidesJobFromAnotherEmbeddingSpace(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	jobs.latest = &tables.TableSidekiqJob{
		ID: "job-old-space", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusCompleted,
		Metadata: `{"config_signature":"6:openai|17:text-embedding-ada|4:1536|8:WarpLogs|","scanned":100,"total":100,"indexed":100}`,
	}
	statusCtx := adminCtx("")
	handler.backfillStatus(statusCtx)
	require.Equal(t, fasthttp.StatusOK, statusCtx.Response.StatusCode())
	require.Contains(t, string(statusCtx.Response.Body()), `"status":"idle"`)
	require.NotContains(t, string(statusCtx.Response.Body()), "job-old-space")

	// The same job under the space the deployment is configured with now.
	metadata, err := handler.service.BuildBackfillJobMeta(context.Background(), time.Unix(1, 0), time.Unix(2, 0), false)
	require.NoError(t, err)
	jobs.latest.Metadata = metadata
	statusCtx = adminCtx("")
	handler.backfillStatus(statusCtx)
	require.Contains(t, string(statusCtx.Response.Body()), `"id":"job-old-space"`)

	// A running job from another space is still the current job.
	jobs.inFlight = &tables.TableSidekiqJob{
		ID: "job-running", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusRunning,
		Metadata: `{"config_signature":"6:openai|17:text-embedding-ada|4:1536|8:WarpLogs|"}`,
	}
	statusCtx = adminCtx("")
	handler.backfillStatus(statusCtx)
	require.Contains(t, string(statusCtx.Response.Body()), `"id":"job-running"`)
}

// The topics panel shows how the last run ended only when that run built
// topics for the embedding model in use. A run under a model since replaced
// said "95 topics written" beside "0 active topics", because its topics belong
// to an embedding space nothing reads any more.
func TestWarpTopicsStatusHidesRunFromAnotherEmbeddingSpace(t *testing.T) {
	handler, jobs, _, cleanup := newTopicsTestHandler(t)
	defer cleanup()
	jobs.latest = &tables.TableSidekiqJob{
		ID: "run-old-space", Kind: warp.TopicsJobKind, Status: tables.SidekiqStatusCompleted,
		Metadata: `{"config_signature":"6:openai|22:text-embedding-3-small|4:1536|15:BifrostWarpLogs|","scanned":7015,"indexed":95}`,
	}
	statusCtx := adminCtx("")
	handler.topicsStatus(statusCtx)
	require.Equal(t, fasthttp.StatusOK, statusCtx.Response.StatusCode())
	require.Contains(t, string(statusCtx.Response.Body()), `"status":"idle"`)

	metadata, err := handler.service.BuildTopicsJobMeta(context.Background(), time.Unix(1, 0), time.Unix(2, 0))
	require.NoError(t, err)
	jobs.latest.Metadata = metadata
	statusCtx = adminCtx("")
	handler.topicsStatus(statusCtx)
	require.Contains(t, string(statusCtx.Response.Body()), `"id":"run-old-space"`)
}

// A seed run for an embedding model that has topics already is refused with
// 409 and says why, rather than replacing topics that keep themselves current.
func TestWarpTopicsStartRefusesASecondSeedRun(t *testing.T) {
	handler, _, topics, cleanup := newTopicsTestHandler(t)
	defer cleanup()
	metadata, err := handler.service.BuildTopicsJobMeta(context.Background(), time.Unix(1, 0), time.Unix(2, 0))
	require.NoError(t, err)
	var meta struct {
		ConfigSignature string `json:"config_signature"`
	}
	require.NoError(t, sonic.UnmarshalString(metadata, &meta))
	require.NoError(t, topics.UpsertWarpTopics(context.Background(), []logstore.WarpTopic{{ID: "seeded", Label: "Refunds", EmbeddingSignature: meta.ConfigSignature}}))

	ctx := adminCtx(`{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`)
	handler.startTopics(ctx)
	require.Equal(t, fasthttp.StatusConflict, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.Contains(t, string(ctx.Response.Body()), "already built")

	// Seeded, the index status stops asking whether there is anything to seed
	// from: the vector store read is only paid while it matters.
	statusCtx := adminCtx("")
	handler.logIndexStatus(statusCtx)
	require.NotContains(t, string(statusCtx.Response.Body()), "has_indexed_requests")
}

func TestWarpBackfillStatusWithoutAnyJobIsIdle(t *testing.T) {
	handler, _, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	statusCtx := adminCtx("")
	handler.backfillStatus(statusCtx)
	require.Equal(t, fasthttp.StatusOK, statusCtx.Response.StatusCode())
	require.Contains(t, string(statusCtx.Response.Body()), `"status":"idle"`)
}

// The agent runs after the handler returns and fasthttp has recycled the
// request. A snapshot that drops the query scope silently widens every tool to
// the whole deployment, so the copy is asserted rather than assumed.
func TestWarpSnapshotCarriesQueryScope(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	applied := false
	scope := queryscope.QueryScope(func(db *gorm.DB) *gorm.DB { applied = true; return db })
	ctx.SetUserValue(schemas.BifrostContextKeyQueryScope, scope)
	ctx.SetUserValue(schemas.BifrostContextKeyUserID, "u-1")

	snapshot, cancel, err := snapshotWarpContext(ctx, time.Second)
	require.NoError(t, err)
	defer cancel()
	carried := queryscope.FromContext(snapshot)
	require.NotNil(t, carried)
	carried(nil)
	require.True(t, applied, "the snapshot must carry the request's own scope, not a fresh one")
	require.Equal(t, "u-1", snapshot.Value(schemas.BifrostContextKeyUserID))
}

// Warp's model calls go through the gateway client in-process, so no HTTP
// transport settles who they are - and governance refuses a request that
// carries no grant. The snapshot must carry a grant settled from the dashboard
// request, attributed to the user who asked, or every chat fails with "request
// carries no grant".
func TestWarpSnapshotCarriesSettledGrant(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.SetUserValue(schemas.BifrostContextKeyUserID, "u-1")
	ctx.SetUserValue(schemas.BifrostContextKeyUserEmail, "u1@example.com")

	snapshot, cancel, err := snapshotWarpContext(ctx, time.Second)
	require.NoError(t, err)
	defer cancel()
	g := warp.NewGrantFromContext(snapshot)
	require.NotNil(t, g, "a turn without a grant is refused by governance on its first model call")
	require.NotNil(t, g.Identity(), "the grant's identity must be settled, not left open")
	require.NotNil(t, g.Identity().User())
	require.Equal(t, "u-1", g.Identity().User().ID)

	// A deployment with no auth still settles an identity - "nobody" - which is
	// distinct from never having been settled.
	anonymous, cancelAnonymous, err := snapshotWarpContext(&fasthttp.RequestCtx{}, time.Second)
	require.NoError(t, err)
	defer cancelAnonymous()
	require.NotNil(t, warp.NewGrantFromContext(anonymous))
	require.NotNil(t, warp.NewGrantFromContext(anonymous).Identity())
}

// Governance stamps the caller's name, teams and customer only while resolving
// a grant, once per grant. Each of Warp's model calls must therefore settle its
// own grant, still attributed to the user who asked, even after fasthttp has
// recycled the request the values came from.
func TestWarpSnapshotSettlesAFreshGrantPerCall(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.SetUserValue(schemas.BifrostContextKeyUserID, "u-1")
	ctx.SetUserValue(schemas.BifrostContextKeyUserName, "Suresh")

	snapshot, cancel, err := snapshotWarpContext(ctx, time.Second)
	require.NoError(t, err)
	defer cancel()
	ctx.ResetUserValues()

	first, second := warp.NewGrantFromContext(snapshot), warp.NewGrantFromContext(snapshot)
	require.NotSame(t, first, second, "a shared grant is resolved on the first call only")
	for _, g := range []schemas.Grant{first, second} {
		require.Equal(t, "u-1", g.Identity().User().ID)
		require.Equal(t, "Suresh", g.Identity().User().Name)
	}
}

// A virtual key arrives as a request header, never as a user value, so the
// grant must read it from the headers the way lib.ConvertToBifrostContext does
// - otherwise a dashboard request that presents a key settles as the session
// alone and governance never sees the key.
func TestWarpSnapshotGrantCarriesHeaderVirtualKey(t *testing.T) {
	for name, set := range map[string]func(*fasthttp.RequestHeader){
		"x-bf-vk":              func(h *fasthttp.RequestHeader) { h.Set("x-bf-vk", "sk-bf-abc") },
		"authorization bearer": func(h *fasthttp.RequestHeader) { h.Set("Authorization", "Bearer sk-bf-abc") },
		"x-api-key":            func(h *fasthttp.RequestHeader) { h.Set("x-api-key", "sk-bf-abc") },
	} {
		t.Run(name, func(t *testing.T) {
			ctx := &fasthttp.RequestCtx{}
			set(&ctx.Request.Header)
			ctx.SetUserValue(schemas.BifrostContextKeyUserID, "u-1")

			snapshot, cancel, err := snapshotWarpContext(ctx, time.Second)
			require.NoError(t, err)
			defer cancel()
			identity := warp.NewGrantFromContext(snapshot).Identity()
			require.NotNil(t, identity)
			require.Equal(t, "sk-bf-abc", identity.Credential().Value)
			require.Equal(t, "u-1", identity.User().ID, "the session's user is kept alongside the key")
		})
	}

	// A bearer that is not a virtual key (a dashboard session token) is not one.
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Authorization", "Bearer session-token")
	snapshot, cancel, err := snapshotWarpContext(ctx, time.Second)
	require.NoError(t, err)
	defer cancel()
	require.Empty(t, warp.NewGrantFromContext(snapshot).Identity().Credential().Value)
}

// The grant the snapshot settles and the admission Warp asks for only matter
// together: governance admits a user nothing grants access to because Warp's
// context asks it to, and only for the identity the dashboard request settled.
// So the whole path is driven here - the dashboard request's snapshot, Warp's
// own model-call context, and the governance pre-hook the gateway client would
// run on it - rather than each half against a hand-built stand-in for the other.
// A grant the snapshot drops, settles without its user, or settles past a
// presented key breaks the chat or widens it, and either shows up here.
func TestWarpChatGovernsTheDashboardCallerEndToEnd(t *testing.T) {
	store, err := governance.NewLocalGovernanceStore(context.Background(), &mockLogger{}, nil, &configstore.GovernanceConfig{}, nil, nil)
	require.NoError(t, err)
	isVkMandatory := false
	plugin, err := governance.InitFromStore(context.Background(), &governance.Config{IsVkMandatory: &isVkMandatory},
		&mockLogger{}, store, nil, nil, nil, nil)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, plugin.Cleanup()) })

	// govern is the gateway client as far as governance is concerned: it runs
	// the pre-hook on the context it is handed and stops at a refusal.
	govern := func(ctx *schemas.BifrostContext, req *schemas.BifrostResponsesRequest) (*schemas.BifrostResponsesResponse, *schemas.BifrostError) {
		_, shortCircuit, err := plugin.PreLLMHook(ctx, &schemas.BifrostRequest{RequestType: schemas.ResponsesRequest, ResponsesRequest: req})
		require.NoError(t, err)
		if shortCircuit != nil {
			return nil, shortCircuit.Error
		}
		return &schemas.BifrostResponsesResponse{}, nil
	}
	chat := func(t *testing.T, ctx *fasthttp.RequestCtx) (*schemas.BifrostResponsesResponse, *schemas.BifrostError) {
		t.Helper()
		snapshot, cancel, err := snapshotWarpContext(ctx, time.Second)
		require.NoError(t, err)
		defer cancel()
		// The agent runs after the handler returns, so the request is gone by
		// the time the model is called.
		ctx.ResetUserValues()
		ctx.Request.Reset()
		return warp.NewChat(govern, &schemas.WarpConfig{}, "conv-1")(snapshot,
			&schemas.BifrostResponsesRequest{Provider: schemas.OpenAI, Model: "gpt-4o"})
	}
	signedIn := func() *fasthttp.RequestCtx {
		ctx := &fasthttp.RequestCtx{}
		ctx.SetUserValue(schemas.BifrostContextKeyUserID, "u-1")
		ctx.SetUserValue(schemas.BifrostContextKeyAuthCredential, grant.NewCredential(grant.CredentialSessionToken, "session-token"))
		return ctx
	}
	requireAccessNotFound := func(t *testing.T, bifrostErr *schemas.BifrostError) {
		t.Helper()
		require.NotNil(t, bifrostErr)
		require.NotNil(t, bifrostErr.StatusCode)
		require.Equal(t, 401, *bifrostErr.StatusCode)
		require.Contains(t, bifrostErr.Error.Message, "access not found")
	}

	t.Run("a signed-in user with no access profile is served", func(t *testing.T) {
		response, bifrostErr := chat(t, signedIn())

		require.Nil(t, bifrostErr, "a profile-less user must not be refused: %+v", bifrostErr)
		require.NotNil(t, response)
	})

	t.Run("the same grant is refused off Warp's path", func(t *testing.T) {
		// The control: it is Warp's model-call context that admits the user, not
		// the grant, so the same settled grant on any other request is still
		// held to an access it does not have.
		snapshot, cancel, err := snapshotWarpContext(signedIn(), time.Second)
		require.NoError(t, err)
		defer cancel()
		ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
		defer ctx.Cancel()
		ctx.SetGrant(warp.NewGrantFromContext(snapshot))

		_, bifrostErr := govern(ctx, &schemas.BifrostResponsesRequest{Provider: schemas.OpenAI, Model: "gpt-4o"})

		requireAccessNotFound(t, bifrostErr)
	})

	t.Run("a presented virtual key that resolves to nothing is still refused", func(t *testing.T) {
		ctx := signedIn()
		ctx.Request.Header.Set("x-bf-vk", "sk-bf-nobody")

		_, bifrostErr := chat(t, ctx)

		requireAccessNotFound(t, bifrostErr)
	})

	t.Run("an anonymous dashboard request is served as a key-less one", func(t *testing.T) {
		// No auth on the deployment: nothing was presented, so there is nothing
		// to admit and nothing to refuse.
		response, bifrostErr := chat(t, &fasthttp.RequestCtx{})

		require.Nil(t, bifrostErr, "%+v", bifrostErr)
		require.NotNil(t, response)
	})
}

// A scope that was set on the request but cannot be carried over is the
// dangerous case: queryscope.FromContext reads a missing scope as "no
// restriction", so the agent would run unscoped over every tenant's prompts and
// costs with no error and no log line. That must fail closed.
//
// An absent scope is different and must keep working: the key is set by the
// enterprise wrapper, so an OSS deployment legitimately has none, and failing
// closed there would disable Warp entirely.
func TestWarpSnapshotFailsClosedOnUnusableScope(t *testing.T) {
	t.Run("absent scope is allowed", func(t *testing.T) {
		ctx := &fasthttp.RequestCtx{}
		snapshot, cancel, err := snapshotWarpContext(ctx, time.Second)
		require.NoError(t, err, "an OSS deployment has no scope wrapper and must still work")
		defer cancel()
		require.Nil(t, queryscope.FromContext(snapshot))
	})

	t.Run("wrong type fails closed", func(t *testing.T) {
		ctx := &fasthttp.RequestCtx{}
		ctx.SetUserValue(schemas.BifrostContextKeyQueryScope, "not-a-scope")
		_, cancel, err := snapshotWarpContext(ctx, time.Second)
		if cancel != nil {
			defer cancel()
		}
		require.Error(t, err, "a scope that cannot be carried must not degrade to unrestricted")
	})

	t.Run("nil scope of the right type fails closed", func(t *testing.T) {
		ctx := &fasthttp.RequestCtx{}
		ctx.SetUserValue(schemas.BifrostContextKeyQueryScope, queryscope.QueryScope(nil))
		_, cancel, err := snapshotWarpContext(ctx, time.Second)
		if cancel != nil {
			defer cancel()
		}
		require.Error(t, err)
	})
}

// The chat route must exist whether or not Warp can currently answer.
//
// RegisterRoutes runs once, at startup. Gating the route on CanChat() meant a
// deployment that enabled logging afterwards - through /api/plugins, which
// reloads plugins without re-registering routes - kept returning 405 for the
// rest of the process's life, with nothing to indicate the feature had become
// available. A registered route that answers 503 carries a machine-readable
// reason the dashboard already branches on, so "present but unusable" and
// "absent" stay distinguishable without making the state permanent.
func TestWarpChatRouteIsRegisteredWithoutALogReader(t *testing.T) {
	handler := newTestWarpHandler(&recordingWarpStore{})
	require.False(t, handler.service.CanChat(), "precondition: no log reader, so Warp cannot answer")

	router := router.New()
	handler.RegisterRoutes(router)

	ctx := adminCtx(`{"messages":[{"role":"user","content":"how much did we spend?"}]}`)
	ctx.Request.Header.SetMethod("POST")
	ctx.Request.SetRequestURI("/api/warp/chat")
	router.Handler(ctx)

	require.Equal(t, fasthttp.StatusServiceUnavailable, ctx.Response.StatusCode(),
		"the route must answer 503, not 405")

	var body schemas.WarpUnavailableResponse
	require.NoError(t, sonic.Unmarshal(ctx.Response.Body(), &body))
	require.Equal(t, schemas.WarpUnavailableNoLogStore, body.Reason,
		"the dashboard hides the launcher on this reason, so it must be reported accurately")
}

// A heartbeat has to be a complete SSE block, not a bare comment line.
//
// SendEvent terminates every Warp frame with "\n\n", and the browser splitter
// looks for exactly that boundary. A heartbeat ending in a single "\n" has no
// boundary, so the client holds it in its carry buffer until the next real
// event arrives - on an idle turn the keep-alive that exists to prove the
// connection is alive is the one thing the reader cannot see.
func TestWarpHeartbeatIsADelimitedSSEBlock(t *testing.T) {
	reader := lib.NewSSEStreamReader()
	go func() {
		warpHeartbeat(reader)()
		reader.Done()
	}()

	buf := make([]byte, 4096)
	n, err := reader.Read(buf)
	require.NoError(t, err)
	require.Equal(t, ": heartbeat\n\n", string(buf[:n]),
		"the heartbeat must carry its own frame boundary")
}

// Both endpoints take an explicit job id and looked it up without checking what
// kind of job came back. The Warp cancel endpoint could therefore cancel any
// pending or running sidekiq job in the deployment - a pricing sync, a
// governance reset - and the status endpoint would hand back that job's
// metadata to a caller asking about a backfill.
func TestWarpBackfillEndpointsRejectForeignJobs(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()

	foreign := &tables.TableSidekiqJob{
		ID: "pricing-sync-1", Kind: "pricing_sync",
		Status: tables.SidekiqStatusRunning, Metadata: `{"scanned":99,"indexed":98}`,
	}
	jobs.jobs[foreign.ID] = foreign

	statusCtx := adminCtx("")
	statusCtx.QueryArgs().Set("id", foreign.ID)
	handler.backfillStatus(statusCtx)
	require.Equal(t, fasthttp.StatusNotFound, statusCtx.Response.StatusCode(),
		"a job of another kind is not a Warp backfill and must not be described as one")
	require.NotContains(t, string(statusCtx.Response.Body()), `"indexed":98`,
		"another job's metadata must not leak through this endpoint")

	cancelCtx := adminCtx(`{"id":"pricing-sync-1"}`)
	handler.cancelBackfill(cancelCtx)
	require.Equal(t, fasthttp.StatusNotFound, cancelCtx.Response.StatusCode(),
		"the Warp endpoint must not be able to cancel an unrelated job")
	require.Equal(t, tables.SidekiqStatusRunning, jobs.jobs[foreign.ID].Status,
		"the foreign job must still be running")
}

// Cancel writes the terminal status itself, so once it succeeds the job is
// cancelled whatever the re-read does. Returning the pre-cancel row when that
// read fails reports "running" for a job that has already been stopped.
func TestWarpCancelBackfillReportsCancelledWhenRereadFails(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	job := &tables.TableSidekiqJob{ID: "job-1", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusRunning, Metadata: `{}`}
	jobs.jobs[job.ID] = job
	jobs.inFlight = job
	jobs.failGetAfterCancel = true

	ctx := adminCtx(`{"id":"job-1"}`)
	handler.cancelBackfill(ctx)

	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
	body := string(ctx.Response.Body())
	require.Contains(t, body, tables.SidekiqStatusCancelled,
		"the cancel succeeded, so the response must not say the job is still running")
	require.NotContains(t, body, `"status":"running"`)
}

// Runner.Cancel returns false for a job that had already finished. Reporting
// "cancelled" there claims an outcome this request did not produce - the job may
// well have completed successfully - so the fallback must be conditional on
// having actually cancelled something.
func TestWarpCancelBackfillDoesNotClaimCancellingATerminalJob(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	job := &tables.TableSidekiqJob{ID: "job-1", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusCompleted, Metadata: `{}`}
	jobs.jobs[job.ID] = job
	// The re-read fails as well, which is the only way the fallback is reached.
	jobs.failGetAfterCancel = true

	ctx := adminCtx(`{"id":"job-1"}`)
	handler.cancelBackfill(ctx)

	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
	body := string(ctx.Response.Body())
	require.NotContains(t, body, tables.SidekiqStatusCancelled,
		"nothing was cancelled, so the response must not say it was")
	require.Contains(t, body, tables.SidekiqStatusCompleted,
		"the row we already hold is the most honest thing available")
}

// An absent timestamp must be absent from the JSON, not sent as year 1.
//
// omitempty does not omit a zero time.Time - it is a struct, never "empty" to
// the encoder - so the idle and pending responses shipped 0001-01-01 for
// start_time, end_time and created_at. Those are optional properties in the
// schema, and a client reading them gets a date that looks real and is not.
func TestWarpBackfillStatusOmitsAbsentTimestamps(t *testing.T) {
	for name, status := range map[string]warpBackfillStatus{
		"idle":    {Status: "idle"},
		"pending": {ID: "job-1", Status: tables.SidekiqStatusPending},
	} {
		encoded, err := sonic.Marshal(status)
		require.NoError(t, err)

		var shape map[string]any
		require.NoError(t, sonic.Unmarshal(encoded, &shape))
		for _, field := range []string{"start_time", "end_time", "created_at"} {
			require.NotContains(t, shape, field, "%s: %s has no value and must not be sent", name, field)
		}
		require.NotContains(t, string(encoded), "0001-01-01", name)
	}
}

// A real timestamp still has to travel.
func TestWarpBackfillStatusKeepsRealTimestamps(t *testing.T) {
	at := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	encoded, err := sonic.Marshal(warpBackfillStatus{
		ID: "job-1", Status: "running", StartTime: &at, EndTime: &at, CreatedAt: &at,
	})
	require.NoError(t, err)
	var shape map[string]any
	require.NoError(t, sonic.Unmarshal(encoded, &shape))
	for _, field := range []string{"start_time", "end_time", "created_at"} {
		require.Contains(t, shape, field)
	}
}

// The job's embedding spend travels from its checkpoint to the status payload
// the backfill panel renders; a cost the deployment cannot price stays absent
// rather than arriving as 0, which would read as free.
func TestWarpBackfillStatusCarriesEmbeddingSpend(t *testing.T) {
	priced := warpBackfillStatusFromRow(&tables.TableSidekiqJob{
		ID: "job-1", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusRunning,
		Metadata: `{"total":10,"scanned":4,"embedding_tokens":1200,"embedding_cost":0.000024}`,
	})
	require.Equal(t, int64(1200), priced.EmbeddingTokens)
	require.NotNil(t, priced.EmbeddingCost)
	require.InDelta(t, 0.000024, *priced.EmbeddingCost, 1e-12)

	unpriced := warpBackfillStatusFromRow(&tables.TableSidekiqJob{
		ID: "job-2", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusRunning,
		Metadata: `{"total":10,"scanned":4,"embedding_tokens":1200}`,
	})
	encoded, err := sonic.Marshal(unpriced)
	require.NoError(t, err)
	var shape map[string]any
	require.NoError(t, sonic.Unmarshal(encoded, &shape))
	require.Equal(t, float64(1200), shape["embedding_tokens"])
	require.NotContains(t, shape, "embedding_cost")
}

// A malformed time range is a bad request whether or not a job is running.
//
// startBackfill checked for an active job before BuildBackfillJobMeta, which is
// what rejects start >= end - so with a backfill in flight an inverted range
// came back 409 with the running job's status. The caller then debugs a
// conflict it does not have instead of the range it got wrong.
func TestWarpStartBackfillValidatesRangeBeforeConflict(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()

	running := &tables.TableSidekiqJob{
		ID: "warp-backfill-1", Kind: warp.BackfillJobKind,
		Status: tables.SidekiqStatusRunning, Metadata: `{}`,
	}
	jobs.jobs[running.ID] = running
	// The conflict check reads inFlight, not the map.
	jobs.inFlight = running

	// end before start, with that job in flight.
	ctx := adminCtx(`{"start_time":"2026-09-02T00:00:00Z","end_time":"2026-09-01T00:00:00Z"}`)
	handler.startBackfill(ctx)
	require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode(),
		"the range is wrong regardless of what else is running")

	// With no job running the same range must still be rejected the same way.
	jobs.inFlight = nil
	delete(jobs.jobs, running.ID)
	ctx = adminCtx(`{"start_time":"2026-09-02T00:00:00Z","end_time":"2026-09-01T00:00:00Z"}`)
	handler.startBackfill(ctx)
	require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode())
}

// The tray's index status has no admin gate, unlike the backfill endpoints, and
// LastError carries whatever the provider or vector store said - endpoints,
// model names, internal detail. An administrator debugging a stalled index
// needs that text; everyone else needs the state and the counts.
func TestWarpLogIndexStatusHidesProviderErrorFromNonAdmins(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	jobs.latest = &tables.TableSidekiqJob{
		ID: "job-f", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusFailed,
		LastError: "dial tcp 10.0.3.7:6333: connect: connection refused",
		Metadata:  `{"scanned":100,"failed":100,"total":5000}`,
	}

	// No local-admin marker on the context.
	ctx := requestCtx()
	handler.logIndexStatus(ctx)
	body := string(ctx.Response.Body())
	require.Contains(t, body, `"state":"failed"`, "the state itself is not sensitive")
	require.Contains(t, body, `"failed":100`, "nor are the counts")
	require.NotContains(t, body, "10.0.3.7", "the provider's own error text must not reach a non-admin")
	require.NotContains(t, body, "connection refused")

	// An administrator still gets it, which is the point of keeping it at all.
	adminRequest := adminCtx("")
	handler.logIndexStatus(adminRequest)
	require.Contains(t, string(adminRequest.Response.Body()), "connection refused")
}

// rbacAdminCtx builds a request context the way enterprise's RBAC middleware
// leaves it for an SSO caller it authorized: a user and role ID, and no
// local-admin marker.
func rbacAdminCtx(body string) *fasthttp.RequestCtx {
	ctx := requestCtx()
	ctx.SetUserValue(schemas.BifrostContextKeyUserID, "sso-admin")
	ctx.SetUserValue(schemas.BifrostContextKeyUserRoleID, uint(1))
	ctx.Request.SetBodyString(body)
	return ctx
}

// An SSO admin never carries the local-admin marker, because enterprise turns the
// password login off once SSO is on. Enterprise RBAC has already checked the
// Warp permission by the time these handlers run, so its role ID has to be
// enough, or no SSO user can ever configure Warp or run a backfill.
func TestWarpAdminRoutesAdmitRBACAuthorizedCaller(t *testing.T) {
	store := &recordingWarpStore{}
	putCtx := rbacAdminCtx(validWarpConfigJSON)
	(&WarpHandler{service: warp.NewService(nil, warp.WithConfigStore(store), warp.WithVectorStore(handlerVectorStore{}))}).putConfig(putCtx)
	require.NotEqual(t, fasthttp.StatusForbidden, putCtx.Response.StatusCode(), string(putCtx.Response.Body()))

	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()

	startCtx := rbacAdminCtx(`{"start_time":"2026-09-01T00:00:00Z","end_time":"2026-09-02T00:00:00Z"}`)
	handler.startBackfill(startCtx)
	require.Equal(t, fasthttp.StatusAccepted, startCtx.Response.StatusCode(), string(startCtx.Response.Body()))
	require.Equal(t, 1, jobs.createdCount())

	job := &tables.TableSidekiqJob{ID: "job-1", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusRunning, Metadata: `{}`}
	jobs.jobs[job.ID] = job
	jobs.inFlight = job

	statusCtx := rbacAdminCtx("")
	statusCtx.QueryArgs().Set("id", job.ID)
	handler.backfillStatus(statusCtx)
	require.Equal(t, fasthttp.StatusOK, statusCtx.Response.StatusCode(), string(statusCtx.Response.Body()))

	cancelCtx := rbacAdminCtx(`{"id":"job-1"}`)
	handler.cancelBackfill(cancelCtx)
	require.Equal(t, fasthttp.StatusOK, cancelCtx.Response.StatusCode(), string(cancelCtx.Response.Body()))
}

// A zero role ID is what an unhydrated context carries. It must not count as
// authorization.
func TestWarpAdminRoutesRejectZeroRoleID(t *testing.T) {
	handler, _, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	calls := []func(*fasthttp.RequestCtx){handler.startBackfill, handler.backfillStatus, handler.cancelBackfill, newTestWarpHandler(&recordingWarpStore{}).putConfig}
	for _, call := range calls {
		ctx := &fasthttp.RequestCtx{}
		ctx.SetUserValue(schemas.BifrostContextKeyUserID, "someone")
		ctx.SetUserValue(schemas.BifrostContextKeyUserRoleID, uint(0))
		call(ctx)
		require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode())
	}
}

// The index summary only needs Warp View in enterprise, so a role ID on its
// context says nothing about admin. The provider's error text stays local-admin
// only there.
func TestWarpLogIndexStatusHidesProviderErrorFromRBACCaller(t *testing.T) {
	handler, jobs, cleanup := newBackfillTestHandler(t)
	defer cleanup()
	jobs.latest = &tables.TableSidekiqJob{
		ID: "job-f", Kind: warp.BackfillJobKind, Status: tables.SidekiqStatusFailed,
		LastError: "dial tcp 10.0.3.7:6333: connect: connection refused",
		Metadata:  `{"scanned":100,"failed":100,"total":5000}`,
	}
	ctx := rbacAdminCtx("")
	handler.logIndexStatus(ctx)
	require.NotContains(t, string(ctx.Response.Body()), "connection refused")
}

func TestWarpJobMatchesNamespace(t *testing.T) {
	job := func(metadata string) *tables.TableSidekiqJob {
		return &tables.TableSidekiqJob{Metadata: metadata}
	}
	require.True(t, warpJobMatchesNamespace(job(`{"namespace":"warp-logs"}`), "warp-logs"))
	require.False(t, warpJobMatchesNamespace(job(`{"namespace":"warp-logs"}`), "warp-logs-v2"),
		"a run against the previous embedding space says nothing about the current one")
	// Pre-upgrade jobs carry no namespace at all. Blanking the tray for an index
	// that was legitimately built is worse than trusting them.
	require.True(t, warpJobMatchesNamespace(job(`{}`), "warp-logs"))
	require.True(t, warpJobMatchesNamespace(job(`{"namespace":"  "}`), "warp-logs"))
	require.False(t, warpJobMatchesNamespace(job(`{ not json`), "warp-logs"),
		"metadata we cannot read is not evidence about the current index")
}

// While the Warp feature flag is off every route answers 404, and switching it
// on takes effect on the next request - routes are registered once at startup,
// so the flag has to be read per request rather than at registration.
func TestWarpRoutesAre404WhileFeatureFlagIsOff(t *testing.T) {
	handler := newTestWarpHandler(&recordingWarpStore{})
	enabled := false
	handler.enabled = func() bool { return enabled }

	r := router.New()
	handler.RegisterRoutes(r)

	serve := func(method, uri, body string) *fasthttp.RequestCtx {
		ctx := adminCtx(body)
		ctx.Request.Header.SetMethod(method)
		ctx.Request.SetRequestURI(uri)
		r.Handler(ctx)
		return ctx
	}

	for _, route := range []struct{ method, uri, body string }{
		{"GET", "/api/warp/config", ""},
		{"PUT", "/api/warp/config", validWarpConfigJSON},
		{"POST", "/api/warp/chat", `{"messages":[{"role":"user","content":"hi"}]}`},
		{"GET", "/api/warp/log-index/status", ""},
		{"POST", "/api/warp/log-index/backfill", `{}`},
		{"GET", "/api/warp/log-index/backfill/status", ""},
		{"POST", "/api/warp/log-index/backfill/cancel", `{}`},
	} {
		ctx := serve(route.method, route.uri, route.body)
		require.Equal(t, fasthttp.StatusNotFound, ctx.Response.StatusCode(), "%s %s must be hidden while the flag is off", route.method, route.uri)
	}

	enabled = true
	ctx := serve("POST", "/api/warp/chat", `{"messages":[{"role":"user","content":"hi"}]}`)
	require.Equal(t, fasthttp.StatusServiceUnavailable, ctx.Response.StatusCode(),
		"with the flag on the request must reach the handler, which reports the missing log store")
}

type fakeVKModelConfigReader struct{ configs []tables.TableModelConfig }

func (f fakeVKModelConfigReader) GetModelConfigsByScopeAndScopeIDs(context.Context, string, []string, ...*gorm.DB) ([]tables.TableModelConfig, error) {
	return f.configs, nil
}

// The decorator Warp is handed is the same set of overlays the dashboard's key
// pages apply: the external budget resolver for a managed key, then the
// assignee. Its output names what governs the key so the answer can say
// "access profile admin" rather than presenting the profile's budget as the
// key's own, and it fails rather than serving a bare row when a resolver does.
func TestWarpVirtualKeyDecoratorOverlaysTheDashboardResolvers(t *testing.T) {
	external := func(_ context.Context, vk *tables.TableVirtualKey) (*ExternalQuotaBudgetResult, error) {
		if vk.ID != "vk-managed" {
			return nil, nil
		}
		return &ExternalQuotaBudgetResult{
			Managed:     true,
			UsageUserID: "u-vrinda",
			Budgets: []SourcedBudget{
				{TableBudget: tables.TableBudget{ID: "b-global", MaxLimit: 450}, SourceRef: tables.SourceRef{SourceType: "access_profile", SourceName: "admin"}},
				{TableBudget: tables.TableBudget{ID: "b-provider", MaxLimit: 20}, SourceRef: tables.SourceRef{SourceType: "access_profile", SourceName: "admin"}},
			},
			RateLimit: &tables.TableRateLimit{ID: "rl-global", RequestMaxLimit: int64Ptr(1000)},
		}, nil
	}
	assignees := func(_ context.Context, ids []string) (map[string]*tables.AssignedUser, error) {
		return map[string]*tables.AssignedUser{"vk-managed": {ID: "u-vrinda", Name: "Vrinda", Email: "vrinda@example.com"}}, nil
	}
	decorate := warpVirtualKeyDecorator(fakeVKModelConfigReader{}, WarpResolvers{ExternalQuotaBudgets: external, VirtualKeyAssignees: assignees})

	managed := &tables.TableVirtualKey{ID: "vk-managed"}
	governedBy, err := decorate(context.Background(), managed)
	require.NoError(t, err)
	require.Equal(t, []string{"access profile admin"}, governedBy, "one source named once, however many budgets it contributed")
	require.True(t, managed.IsAccessProfileManaged)
	require.Len(t, managed.Budgets, 2)
	require.NotNil(t, managed.RateLimit)
	require.Equal(t, "Vrinda", managed.AssignedUser.Name)

	// A key the resolver has nothing on keeps its own rows and names no source.
	standalone := &tables.TableVirtualKey{ID: "vk-own", Budgets: []tables.TableBudget{{ID: "b-own", MaxLimit: 10}}}
	governedBy, err = decorate(context.Background(), standalone)
	require.NoError(t, err)
	require.Empty(t, governedBy)
	require.False(t, standalone.IsAccessProfileManaged)
	require.Len(t, standalone.Budgets, 1)

	// No resolvers at all is the OSS build: the row is read as is.
	governedBy, err = warpVirtualKeyDecorator(fakeVKModelConfigReader{}, WarpResolvers{})(context.Background(), &tables.TableVirtualKey{ID: "vk-own"})
	require.NoError(t, err)
	require.Empty(t, governedBy)

	// A failing resolver is an error, not a silently bare key.
	broken := func(context.Context, *tables.TableVirtualKey) (*ExternalQuotaBudgetResult, error) {
		return nil, errors.New("governance store down")
	}
	_, err = warpVirtualKeyDecorator(fakeVKModelConfigReader{}, WarpResolvers{ExternalQuotaBudgets: broken})(context.Background(), &tables.TableVirtualKey{ID: "vk-managed"})
	require.ErrorContains(t, err, "governance store down")
}

func int64Ptr(v int64) *int64 { return &v }

// warpModelsHandler serves chat over a config that exposes one model beside the
// default, and records where each model call was addressed.
func warpModelsHandler(calls *[]schemas.BifrostResponsesRequest) *WarpHandler {
	additional := `[{"provider":"anthropic","model":"claude-sonnet-5","api_key_id":"key-anthropic"}]`
	store := &recordingWarpStore{row: &tables.TableWarpConfig{
		ID: tables.WarpConfigRowID, Enabled: true, Provider: "openai", Model: "gpt-4o", AdditionalModels: &additional,
		EmbeddingProvider: "openai", EmbeddingModel: "text-embedding-3-small", EmbeddingDimension: 1536,
		LogVectorStoreNamespace: schemas.WarpDefaultLogVectorStoreNamespace,
	}}
	chat := func(_ context.Context, request *schemas.BifrostResponsesRequest) (*schemas.BifrostResponsesResponse, *schemas.BifrostError) {
		*calls = append(*calls, *request)
		// The turn ends on this error; the test only needs to see the address.
		return nil, &schemas.BifrostError{Error: &schemas.ErrorField{Message: "scripted stop"}}
	}
	return &WarpHandler{service: warp.NewService(nil, warp.WithConfigStore(store), warp.WithLogReader(handlerBackfillReader{}), warp.WithChatFunc(chat))}
}

// The models an operator exposes are part of the config wire shape in both
// directions: the panel's switcher is built from the read, and the settings
// page writes the list back whole.
func TestWarpConfigRoundTripsAdditionalModels(t *testing.T) {
	store := &recordingWarpStore{}
	handler := &WarpHandler{service: warp.NewService(nil, warp.WithConfigStore(store), warp.WithVectorStore(handlerVectorStore{}))}
	ctx := adminCtx(`{"enabled":true,"provider":"openai","model":"gpt-4o","additional_models":[{"provider":"anthropic","model":"claude-sonnet-5","api_key_id":"key-anthropic"},{"provider":"openai","model":"gpt-4o-mini"}],"embedding_provider":"openai","embedding_model":"text-embedding-3-small","embedding_dimension":1536,"log_vector_store_namespace":"BifrostWarpLogs"}`)
	handler.putConfig(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))

	ctx = &fasthttp.RequestCtx{}
	handler.getConfig(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
	var body struct {
		Provider         string              `json:"provider"`
		Model            string              `json:"model"`
		AdditionalModels []schemas.WarpModel `json:"additional_models"`
	}
	require.NoError(t, sonic.Unmarshal(ctx.Response.Body(), &body))
	require.Equal(t, "gpt-4o", body.Model)
	require.Equal(t, []schemas.WarpModel{
		{Provider: schemas.Anthropic, Model: "claude-sonnet-5", APIKeyID: "key-anthropic"},
		{Provider: schemas.OpenAI, Model: "gpt-4o-mini"},
	}, body.AdditionalModels)

	// A repeated pair is a validation failure like any other: 400, nothing stored.
	ctx = adminCtx(`{"enabled":true,"provider":"openai","model":"gpt-4o","additional_models":[{"provider":"openai","model":"gpt-4o"}],"embedding_provider":"openai","embedding_model":"text-embedding-3-small","embedding_dimension":1536,"log_vector_store_namespace":"BifrostWarpLogs"}`)
	handler.putConfig(ctx)
	require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode())
	require.Contains(t, string(ctx.Response.Body()), "already listed")
	require.Len(t, store.upserted, 1)
}

// Adding or removing an exposed model is a config write, so it sits behind the
// same admin gate as the rest: a caller with neither local admin nor an RBAC
// role cannot change which models Warp offers.
func TestWarpConfigPutRefusesModelChangesFromNonAdmins(t *testing.T) {
	store := &recordingWarpStore{}
	handler := &WarpHandler{service: warp.NewService(nil, warp.WithConfigStore(store), warp.WithVectorStore(handlerVectorStore{}))}
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetBodyString(`{"enabled":true,"provider":"openai","model":"gpt-4o","additional_models":[{"provider":"anthropic","model":"claude-sonnet-5"}],"embedding_provider":"openai","embedding_model":"text-embedding-3-small","embedding_dimension":1536,"log_vector_store_namespace":"BifrostWarpLogs"}`)
	handler.putConfig(ctx)
	require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode())
	require.Empty(t, store.upserted)
}

// The chat body names the model to run on, and the handler addresses the turn
// to it - or to the default when the body names none.
func TestWarpChatRunsOnTheRequestedModel(t *testing.T) {
	for name, test := range map[string]struct {
		body         string
		wantProvider schemas.ModelProvider
		wantModel    string
	}{
		"default":    {`{"messages":[{"role":"user","content":"hi"}],"stream":false}`, schemas.OpenAI, "gpt-4o"},
		"additional": {`{"messages":[{"role":"user","content":"hi"}],"provider":"anthropic","model":"claude-sonnet-5","stream":false}`, schemas.Anthropic, "claude-sonnet-5"},
	} {
		t.Run(name, func(t *testing.T) {
			var calls []schemas.BifrostResponsesRequest
			ctx := &fasthttp.RequestCtx{}
			ctx.Request.SetBodyString(test.body)
			warpModelsHandler(&calls).chat(ctx)
			require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
			require.NotEmpty(t, calls)
			require.Equal(t, test.wantProvider, calls[0].Provider)
			require.Equal(t, test.wantModel, calls[0].Model)
		})
	}
}

// The model in a chat body is client-sent. One the operator did not expose is
// a 400 that reaches no model - the caller is not an admin here, which is the
// point: using Warp never widens what it may run on.
func TestWarpChatRefusesAModelThatIsNotExposed(t *testing.T) {
	var calls []schemas.BifrostResponsesRequest
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetBodyString(`{"messages":[{"role":"user","content":"hi"}],"provider":"openai","model":"gpt-5","stream":false}`)
	warpModelsHandler(&calls).chat(ctx)
	require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode())
	require.Contains(t, string(ctx.Response.Body()), "model is not available for warp")
	require.Empty(t, calls)
}
