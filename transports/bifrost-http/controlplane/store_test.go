package controlplane

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/stretchr/testify/require"
)

func testControlPlaneStore(t *testing.T) (*Store, configstore.ConfigStore) {
	t.Helper()
	ctx := context.Background()
	config := &configstore.Config{Enabled: true, Type: configstore.ConfigStoreTypeSQLite, Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "control-plane.db")}}
	if socket := os.Getenv("ELYGATE_TEST_POSTGRES_SOCKET"); socket != "" {
		config = testPostgresControlPlaneConfig(t, socket)
	}
	cs, err := configstore.NewConfigStore(ctx, config, bifrost.NewDefaultLogger(schemas.LogLevelError))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, cs.Close(ctx)) })
	require.Equal(t, string(config.Type), cs.DB().Dialector.Name())
	t.Logf("control-plane test backend: %s", config.Type)
	store, err := NewStore(ctx, cs)
	require.NoError(t, err)
	return store, cs
}

func TestControlPlaneProjectApplicationBindingAndLedgerAreIdempotent(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	active := true
	require.NoError(t, cs.CreateVirtualKey(context.Background(), &configtables.TableVirtualKey{ID: "vk-cp", Name: "vk-cp", Value: *schemas.NewSecretVar("sk-cp"), IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now()}))
	project := &Project{Name: "Platform"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "Docs", Environment: "staging"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	created, err := store.BindVirtualKey(context.Background(), app.ID, "vk-cp", nil)
	require.NoError(t, err)
	require.Equal(t, app.ID, created.ApplicationID)
	occurred := time.Now().UTC().Add(time.Second)
	cost := 0.42
	logs := []logstore.Log{{ID: "log-cp-1", Timestamp: occurred, Provider: "openai", Model: "gpt-4o-mini", Status: "success", VirtualKeyID: ptr("vk-cp"), PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15, Cost: &cost}}
	count, err := store.ProjectLogs(context.Background(), logs)
	require.NoError(t, err)
	require.Equal(t, 1, count)
	count, err = store.ProjectLogs(context.Background(), logs)
	require.NoError(t, err)
	require.Equal(t, 0, count)
	rows, total, err := store.ListUsage(context.Background(), UsageQuery{ProjectID: project.ID})
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, rows, 1)
	require.Equal(t, app.ID, rows[0].ApplicationID)
	require.InDelta(t, cost, rows[0].Cost, 0.000001)
}

func TestProjectLogsCopiesSessionTreeAndListUsageFilters(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	active := true
	require.NoError(t, cs.CreateVirtualKey(context.Background(), &configtables.TableVirtualKey{ID: "vk-tree", Name: "vk-tree", Value: *schemas.NewSecretVar("sk-tree"), IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now()}))
	project := &Project{Name: "Session tree"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "Agents"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	_, err := store.BindVirtualKey(context.Background(), app.ID, "vk-tree", nil)
	require.NoError(t, err)

	sessionID, parentID, agent := "child-1", "parent-1", "reviewer"
	cost := 0.12
	logs := []logstore.Log{{
		ID: "log-tree-1", Timestamp: time.Now().UTC().Add(time.Second), Provider: "openai", Model: "gpt-4o-mini",
		Status: "success", VirtualKeyID: ptr("vk-tree"), SessionID: &sessionID, ParentSessionID: &parentID,
		AgentName: &agent, IsSubagent: true, PromptTokens: 4, CompletionTokens: 6, TotalTokens: 10, Cost: &cost,
	}}
	count, err := store.ProjectLogs(context.Background(), logs)
	require.NoError(t, err)
	require.Equal(t, 1, count)

	rows, total, err := store.ListUsage(context.Background(), UsageQuery{SessionID: "child-1", IsSubagent: ptr(true)})
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, rows, 1)
	require.Equal(t, "child-1", optionalStringValue(rows[0].SessionID))
	require.Equal(t, "parent-1", optionalStringValue(rows[0].ParentSessionID))
	require.Equal(t, "reviewer", optionalStringValue(rows[0].AgentName))
	require.True(t, rows[0].IsSubagent)

	_, total, err = store.ListUsage(context.Background(), UsageQuery{TreeSessionID: "parent-1"})
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	_, total, err = store.ListUsage(context.Background(), UsageQuery{AgentName: "reviewer", IsFork: ptr(true)})
	require.NoError(t, err)
	require.Zero(t, total)
}

func TestSummarizeUsageHonorsFilters(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	require.NoError(t, store.db(ctx).Create(&UsageLedgerEntry{
		ID: "summary-success", SourceLogID: "summary-success", OccurredAt: now,
		ProjectID: "project-summary", ApplicationID: "app-summary", Provider: "openai", Model: "gpt-4o-mini",
		Status: "success", PromptTokens: 10, OutputTokens: 5, TotalTokens: 15, Cost: 0.42,
	}).Error)
	require.NoError(t, store.db(ctx).Create(&UsageLedgerEntry{
		ID: "summary-failed", SourceLogID: "summary-failed", OccurredAt: now.Add(time.Second),
		ProjectID: "project-summary", ApplicationID: "other-app", Provider: "openai", Model: "gpt-4o-mini",
		Status: "error", PromptTokens: 20, OutputTokens: 2, TotalTokens: 22, Cost: 0.18,
	}).Error)

	summary, err := store.SummarizeUsage(ctx, UsageQuery{ApplicationID: "app-summary"})
	require.NoError(t, err)
	require.EqualValues(t, 1, summary.Requests)
	require.EqualValues(t, 1, summary.SuccessfulRequests)
	require.Zero(t, summary.FailedRequests)
	require.EqualValues(t, 10, summary.PromptTokens)
	require.EqualValues(t, 5, summary.OutputTokens)
	require.EqualValues(t, 15, summary.TotalTokens)
	require.InDelta(t, 0.42, summary.Cost, 0.000001)
}

func TestSummarizeUsageMatchesLedgerAcrossFilters(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	start := time.Date(2026, 9, 13, 0, 0, 0, 0, time.UTC)
	end := start.Add(2 * time.Second)
	require.NoError(t, store.db(ctx).Create(&[]UsageLedgerEntry{
		{ID: "summary-root", SourceLogID: "summary-root", OccurredAt: start, ProjectID: "project-1", ApplicationID: "app-1", SessionID: ptr("root"), AgentName: ptr("main"), Status: "success", TotalTokens: 10, Cost: 1},
		{ID: "summary-child", SourceLogID: "summary-child", OccurredAt: start.Add(time.Second), ProjectID: "project-1", ApplicationID: "app-1", SessionID: ptr("child"), ParentSessionID: ptr("root"), AgentName: ptr("reviewer"), IsSubagent: true, IsFork: true, Status: "error", TotalTokens: 20, Cost: 2},
		{ID: "summary-other-app", SourceLogID: "summary-other-app", OccurredAt: end, ProjectID: "project-1", ApplicationID: "app-2", IsSubagent: true, Status: "cancelled", TotalTokens: 30, Cost: 3},
		{ID: "summary-other-project", SourceLogID: "summary-other-project", OccurredAt: end.Add(time.Second), ProjectID: "project-2", ApplicationID: "app-3", Status: "success", TotalTokens: 40, Cost: 4},
		{ID: "summary-late", SourceLogID: "summary-late", OccurredAt: end.Add(time.Hour), ProjectID: "project-1", ApplicationID: "app-1", Status: "success", TotalTokens: 50, Cost: 5},
	}).Error)

	// Empty, single and combined filters share [start, end) bounds; paging never limits totals.
	for _, tc := range []struct {
		name  string
		query UsageQuery
		count int64
	}{
		{"all", UsageQuery{}, 5},
		{"project", UsageQuery{ProjectID: "project-1"}, 4},
		{"application", UsageQuery{ApplicationID: "app-1"}, 3},
		{"session", UsageQuery{SessionID: "child"}, 1},
		{"parent", UsageQuery{ParentSessionID: "root"}, 1},
		{"agent", UsageQuery{AgentName: "reviewer"}, 1},
		{"tree", UsageQuery{TreeSessionID: "root"}, 2},
		{"subagent", UsageQuery{IsSubagent: ptr(true)}, 2},
		{"not-subagent", UsageQuery{IsSubagent: ptr(false)}, 3},
		{"fork", UsageQuery{IsFork: ptr(true)}, 1},
		{"not-fork", UsageQuery{IsFork: ptr(false)}, 4},
		{"window", UsageQuery{StartTime: &start, EndTime: &end}, 2},
		{"empty", UsageQuery{EndTime: &start}, 0},
		{"combined", UsageQuery{ProjectID: "project-1", ApplicationID: "app-1", TreeSessionID: "root", AgentName: "reviewer", IsSubagent: ptr(true), IsFork: ptr(true), StartTime: &start, EndTime: &end}, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			listQuery := tc.query
			listQuery.Limit, listQuery.Offset, listQuery.Export = 0, 0, false
			rows, total, err := store.ListUsage(ctx, listQuery)
			require.NoError(t, err)
			require.Equal(t, tc.count, total)
			tc.query.Limit, tc.query.Offset, tc.query.Export = 1, 1000, true
			summary, err := store.SummarizeUsage(ctx, tc.query)
			require.NoError(t, err)
			require.Equal(t, total, summary.Requests)
			var cost float64
			var tokens, successes, failures, cancellations int64
			for _, row := range rows {
				cost += row.Cost
				tokens += int64(row.TotalTokens)
				if row.Status == "success" {
					successes++
				} else if row.Status == "error" {
					failures++
				} else if row.Status == "cancelled" {
					cancellations++
				}
			}
			require.Equal(t, successes, summary.SuccessfulRequests)
			require.Equal(t, failures, summary.FailedRequests)
			require.Equal(t, cancellations, summary.CancelledRequests)
			require.Equal(t, tokens, summary.TotalTokens)
			require.InDelta(t, cost, summary.Cost, 0.000001)
			if tc.count == 0 {
				require.Equal(t, UsageSummary{}, summary)
			}
		})
	}
}

func TestListApplicationsReturnsRows(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	project := &Project{Name: "Applications"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "Gateway"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	rows, err := store.ListApplications(context.Background(), project.ID)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, app.ID, rows[0].ID)
}

func TestControlPlaneBindingRevocationStopsProjection(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	active := true
	require.NoError(t, cs.CreateVirtualKey(context.Background(), &configtables.TableVirtualKey{ID: "vk-revoke", Name: "vk-revoke", Value: *schemas.NewSecretVar("sk-revoke"), IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now()}))
	project := &Project{Name: "Security"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "Scanner"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	_, err := store.BindVirtualKey(context.Background(), app.ID, "vk-revoke", nil)
	require.NoError(t, err)
	require.NoError(t, store.RevokeBinding(context.Background(), app.ID))
	_, err = store.ActiveBindingByVirtualKey(context.Background(), "vk-revoke")
	require.Error(t, err)
}

func TestProjectLogsCheckpointNeverMovesBackwards(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	active := true
	require.NoError(t, cs.CreateVirtualKey(context.Background(), &configtables.TableVirtualKey{ID: "vk-watermark", Name: "vk-watermark", Value: *schemas.NewSecretVar("sk-watermark"), IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now()}))
	project := &Project{Name: "Ledger"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "API"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	_, err := store.BindVirtualKey(context.Background(), app.ID, "vk-watermark", nil)
	require.NoError(t, err)

	newer := time.Now().UTC().Add(2 * time.Minute)
	older := newer.Add(-time.Minute)
	for _, log := range []logstore.Log{
		{ID: "log-newer", Timestamp: newer, VirtualKeyID: ptr("vk-watermark")},
		{ID: "log-older", Timestamp: older, VirtualKeyID: ptr("vk-watermark")},
	} {
		_, err := store.ProjectLogs(context.Background(), []logstore.Log{log})
		require.NoError(t, err)
	}
	checkpoint, err := store.Checkpoint(context.Background())
	require.NoError(t, err)
	require.Equal(t, "log-newer", checkpoint.LastLogID)
	require.WithinDuration(t, newer, checkpoint.Watermark, time.Second)
}

func TestBackfillProjectionDoesNotAdvanceCheckpoint(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	active := true
	require.NoError(t, cs.CreateVirtualKey(context.Background(), &configtables.TableVirtualKey{ID: "vk-backfill", Name: "vk-backfill", Value: *schemas.NewSecretVar("sk-backfill"), IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now()}))
	project := &Project{Name: "Backfill"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "Importer"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	_, err := store.BindVirtualKey(context.Background(), app.ID, "vk-backfill", nil)
	require.NoError(t, err)
	occurred := time.Now().UTC().Add(time.Minute)
	_, err = store.projectLogs(context.Background(), []logstore.Log{{ID: "log-backfill", Timestamp: occurred, VirtualKeyID: ptr("vk-backfill")}}, false)
	require.NoError(t, err)
	checkpoint, err := store.Checkpoint(context.Background())
	require.NoError(t, err)
	require.True(t, checkpoint.Watermark.IsZero())
}

type partialUsageReader struct{}

func (partialUsageReader) ScanUsageLogs(_ context.Context, visit func([]logstore.Log) error) error {
	return visit(nil)
}

func TestReconcileUsageDoesNotDeleteLedgerForPartialReader(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Partial reader"}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{ProjectID: project.ID, Name: "Partial"}
	require.NoError(t, store.CreateApplication(ctx, app))
	key, err := store.CreateApplicationKey(ctx, app.ID, "partial-key", "", nil, "test")
	require.NoError(t, err)
	_, err = store.ProjectLogs(ctx, []logstore.Log{{
		ID: "partial-source", Timestamp: time.Now().UTC(), VirtualKeyID: ptr(key.VirtualKeyID), Status: "success",
	}})
	require.NoError(t, err)

	require.NoError(t, store.ReconcileUsage(ctx, partialUsageReader{}))
	_, total, err := store.ListUsage(ctx, UsageQuery{ApplicationID: app.ID})
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
}

// completeSnapshotReader reports a complete source snapshot, so the reconciler
// is allowed to delete ledger rows whose source log disappeared.
type completeSnapshotReader struct {
	logs []logstore.Log
}

func (r completeSnapshotReader) ScanUsageLogs(_ context.Context, visit func([]logstore.Log) error) error {
	return visit(r.logs)
}

func (completeSnapshotReader) UsageLogSnapshotComplete() bool { return true }

// TestReconcileUsageKeepsUnboundRowsUnderCompleteSnapshot pins the billing
// contract for unbound traffic: a terminal log without a virtual key is
// projected under the default application and must survive the stale-entry
// cleanup that a complete snapshot enables. Deleting it silently drops
// unassigned usage from the ledger, which is the production regression the
// audit.3 release deliberately fixed by keeping "Unassigned" attribution.
func TestReconcileUsageKeepsUnboundRowsUnderCompleteSnapshot(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	active := true
	require.NoError(t, cs.CreateVirtualKey(ctx, &configtables.TableVirtualKey{ID: "vk-complete", Name: "vk-complete", Value: *schemas.NewSecretVar("sk-complete"), IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now()}))
	project := &Project{Name: "Complete snapshot"}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &Application{ProjectID: project.ID, Name: "Worker"}
	require.NoError(t, store.CreateApplication(ctx, app))
	_, err := store.BindVirtualKey(ctx, app.ID, "vk-complete", nil)
	require.NoError(t, err)

	now := time.Now().UTC()
	require.NoError(t, store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{
		{ID: "log-bound", Timestamp: now, Status: "success", VirtualKeyID: ptr("vk-complete"), PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2},
		{ID: "log-unbound", Timestamp: now.Add(time.Second), Status: "success", PromptTokens: 3, CompletionTokens: 4, TotalTokens: 7},
	}}))

	boundRows, boundTotal, err := store.ListUsage(ctx, UsageQuery{ApplicationID: app.ID})
	require.NoError(t, err)
	require.EqualValues(t, 1, boundTotal)
	require.Equal(t, "log-bound", boundRows[0].SourceLogID)

	unboundRows, unboundTotal, err := store.ListUsage(ctx, UsageQuery{ApplicationID: "default"})
	require.NoError(t, err)
	require.EqualValues(t, 1, unboundTotal, "unbound terminal usage must stay billable under the default application")
	require.Equal(t, "log-unbound", unboundRows[0].SourceLogID)
	require.Empty(t, unboundRows[0].VirtualKeyID)

	// A source row that is gone from the complete snapshot must be dropped.
	require.NoError(t, store.ReconcileUsage(ctx, completeSnapshotReader{logs: []logstore.Log{
		{ID: "log-bound", Timestamp: now, Status: "success", VirtualKeyID: ptr("vk-complete"), PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2},
	}}))
	_, unboundTotal, err = store.ListUsage(ctx, UsageQuery{ApplicationID: "default"})
	require.NoError(t, err)
	require.Zero(t, unboundTotal, "a source row that left the snapshot is stale and must be deleted")
}

func TestProjectLogsAdvancesCheckpointForUnboundLogs(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	occurred := time.Now().UTC().Add(time.Minute)
	count, err := store.ProjectLogs(context.Background(), []logstore.Log{{ID: "unbound-log", Timestamp: occurred}})
	require.NoError(t, err)
	require.Zero(t, count)
	checkpoint, err := store.Checkpoint(context.Background())
	require.NoError(t, err)
	require.Equal(t, "unbound-log", checkpoint.LastLogID)
	require.WithinDuration(t, occurred, checkpoint.Watermark, time.Second)
	rows, total, err := store.ListUsage(context.Background(), UsageQuery{ApplicationID: "default"})
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, rows, 1)
	require.Empty(t, rows[0].VirtualKeyID)
}

func TestExpiredBindingRejectsVirtualKeyValue(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	active := true
	require.NoError(t, cs.CreateVirtualKey(context.Background(), &configtables.TableVirtualKey{ID: "vk-expired", Name: "vk-expired", Value: *schemas.NewSecretVar("sk-expired"), IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now()}))
	project := &Project{Name: "Expiry"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "Worker"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	expires := time.Now().UTC().Add(-time.Minute)
	_, err := store.BindVirtualKey(context.Background(), app.ID, "vk-expired", &expires)
	require.NoError(t, err)
	require.Error(t, store.CheckVirtualKeyValueAccess(context.Background(), "sk-expired"))
}

func TestApplicationKeyLifecycleCreatesRotatesAndRevokes(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	project := &Project{Name: "Lifecycle"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "Worker"}
	require.NoError(t, store.CreateApplication(context.Background(), app))

	created, err := store.CreateApplicationKey(context.Background(), app.ID, "worker-key", "", nil, "admin")
	require.NoError(t, err)
	require.NotEmpty(t, created.Value)
	require.NoError(t, store.CheckVirtualKeyValueAccess(context.Background(), created.Value))

	rotated, err := store.RotateApplicationKey(context.Background(), app.ID, created.VirtualKeyID, "admin")
	require.NoError(t, err)
	require.NotEqual(t, created.Value, rotated.Value)
	require.Error(t, store.CheckVirtualKeyValueAccess(context.Background(), created.Value))
	require.NoError(t, store.CheckVirtualKeyValueAccess(context.Background(), rotated.Value))

	require.NoError(t, store.RevokeApplicationKey(context.Background(), app.ID, rotated.VirtualKeyID, "admin"))
	require.Error(t, store.CheckVirtualKeyValueAccess(context.Background(), rotated.Value))
	vk, err := cs.GetVirtualKey(context.Background(), rotated.VirtualKeyID)
	require.NoError(t, err)
	require.False(t, vk.IsActiveValue())

	audit, err := store.ListAudit(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, audit, 3)
	require.Equal(t, "application.key_revoke", audit[0].Action)
}

func TestRebindingLeavesOneActiveBindingAndAuditsMutation(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	active := true
	require.NoError(t, cs.CreateVirtualKey(context.Background(), &configtables.TableVirtualKey{ID: "vk-rebind", Name: "vk-rebind", Value: *schemas.NewSecretVar("sk-rebind"), IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now()}))
	project := &Project{Name: "Platform"}
	require.NoError(t, store.CreateProjectWithAudit(context.Background(), project, "admin-1"))
	first := &Application{ProjectID: project.ID, Name: "First"}
	second := &Application{ProjectID: project.ID, Name: "Second"}
	require.NoError(t, store.CreateApplicationWithAudit(context.Background(), first, "admin-1"))
	require.NoError(t, store.CreateApplicationWithAudit(context.Background(), second, "admin-1"))
	_, err := store.BindVirtualKeyWithAudit(context.Background(), first.ID, "vk-rebind", nil, "admin-1")
	require.NoError(t, err)
	_, err = store.BindVirtualKeyWithAudit(context.Background(), second.ID, "vk-rebind", nil, "admin-1")
	require.NoError(t, err)

	var activeCount int64
	require.NoError(t, store.db(context.Background()).Model(&ApplicationVirtualKeyBinding{}).Where("virtual_key_id = ? AND revoked_at IS NULL", "vk-rebind").Count(&activeCount).Error)
	require.EqualValues(t, 1, activeCount)
	binding, err := store.ActiveBindingByVirtualKey(context.Background(), "vk-rebind")
	require.NoError(t, err)
	require.Equal(t, second.ID, binding.ApplicationID)

	audit, err := store.ListAudit(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, audit, 5)
	require.Equal(t, "application.virtual_key_bind", audit[0].Action)
	require.Equal(t, "admin-1", audit[0].ActorID)
}

func TestDatabaseRejectsOverlappingActiveBindings(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	active := true
	require.NoError(t, cs.CreateVirtualKey(context.Background(), &configtables.TableVirtualKey{ID: "vk-unique", Name: "vk-unique", Value: *schemas.NewSecretVar("sk-unique"), IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now()}))
	project := &Project{Name: "Uniqueness"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	first := &Application{ProjectID: project.ID, Name: "First"}
	second := &Application{ProjectID: project.ID, Name: "Second"}
	require.NoError(t, store.CreateApplication(context.Background(), first))
	require.NoError(t, store.CreateApplication(context.Background(), second))
	now := time.Now().UTC()
	require.NoError(t, store.db(context.Background()).Create(&ApplicationVirtualKeyBinding{ID: "binding-first", ApplicationID: first.ID, VirtualKeyID: "vk-unique", CreatedAt: now, UpdatedAt: now}).Error)
	err := store.db(context.Background()).Create(&ApplicationVirtualKeyBinding{ID: "binding-second", ApplicationID: second.ID, VirtualKeyID: "vk-unique", CreatedAt: now, UpdatedAt: now}).Error
	require.Error(t, err)
}

func TestControlPlaneMigrationIsIdempotent(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	second, err := NewStore(context.Background(), cs)
	require.NoError(t, err)
	require.NotNil(t, second)

	checkpoint, err := store.Checkpoint(context.Background())
	require.NoError(t, err)
	require.EqualValues(t, 1, checkpoint.ID)
}

func ptr[T any](v T) *T { return &v }
