package controlplane

import (
	"context"
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
	cs, err := configstore.NewConfigStore(ctx, &configstore.Config{Enabled: true, Type: configstore.ConfigStoreTypeSQLite, Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "control-plane.db")}}, bifrost.NewDefaultLogger(schemas.LogLevelError))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, cs.Close(ctx)) })
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
