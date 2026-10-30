package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/google/uuid"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func routingDraftAudits(t *testing.T, store *Store) []AuditEvent {
	t.Helper()
	var events []AuditEvent
	require.NoError(t, store.db(context.Background()).Where("resource_type = ?", "routing-draft").
		Order("created_at, id").Find(&events).Error)
	return events
}

func requireRoutingDraftEqual(t *testing.T, expected, actual *RoutingDraft) {
	t.Helper()
	require.NotNil(t, expected)
	require.NotNil(t, actual)
	expectedUTC, actualUTC := *expected, *actual
	expectedUTC.CreatedAt, expectedUTC.UpdatedAt = expected.CreatedAt.UTC(), expected.UpdatedAt.UTC()
	actualUTC.CreatedAt, actualUTC.UpdatedAt = actual.CreatedAt.UTC(), actual.UpdatedAt.UTC()
	require.Equal(t, expectedUTC, actualUTC)
}

func TestRoutingDraftLifecycleAndRestart(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	content := RoutingDraftContent{Name: "Routing candidate", RulesJSON: "[]", ChainMaxDepth: 10}
	created, err := store.CreateRoutingDraft(ctx, content)
	require.NoError(t, err)
	require.EqualValues(t, 1, created.Revision)
	require.NoError(t, uuid.Validate(created.ID))
	require.Error(t, routingDraftRollback(store.db(ctx)))
	restarted, err := NewStore(ctx, cs)
	require.NoError(t, err)
	saved, err := restarted.GetRoutingDraft(ctx, created.ID)
	require.NoError(t, err)
	requireRoutingDraftEqual(t, created, saved)
	listed, err := restarted.ListRoutingDrafts(ctx, 1, 0)
	require.NoError(t, err)
	require.Len(t, listed, 1)
	require.Empty(t, listed[0].RulesJSON, "list does not load candidate payloads")
	require.Equal(t, created.ID, listed[0].ID)
	content.Name, content.ChainMaxDepth = "Updated candidate", 1
	updated, err := restarted.UpdateRoutingDraft(ctx, created.ID, RoutingDraftUpdate{content, 1})
	require.NoError(t, err)
	require.EqualValues(t, 2, updated.Revision)
	require.Equal(t, content.Name, updated.Name)
	require.Equal(t, content.ChainMaxDepth, updated.ChainMaxDepth)
	require.True(t, created.CreatedAt.Equal(updated.CreatedAt), "creation time must not change")
	_, err = restarted.UpdateRoutingDraft(ctx, created.ID, RoutingDraftUpdate{content, 1})
	require.ErrorIs(t, err, ErrRoutingDraftConflict)
	require.ErrorIs(t, restarted.DeleteRoutingDraft(ctx, created.ID, 1, ""), ErrRoutingDraftConflict)
	require.Len(t, routingDraftAudits(t, store), 2)
	require.NoError(t, restarted.DeleteRoutingDraft(ctx, created.ID, 2, ""))
	_, err = restarted.GetRoutingDraft(ctx, created.ID)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	require.ErrorIs(t, restarted.DeleteRoutingDraft(ctx, created.ID, 2, ""), gorm.ErrRecordNotFound)
	_, err = restarted.UpdateRoutingDraft(ctx, created.ID, RoutingDraftUpdate{content, 2})
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	events := routingDraftAudits(t, store)
	require.Len(t, events, 3)
	for index, action := range []string{"routing-draft.create", "routing-draft.update", "routing-draft.delete"} {
		require.Equal(t, action, events[index].Action)
		require.Equal(t, "local-admin", events[index].ActorID)
		require.Equal(t, created.ID, events[index].ResourceID)
	}
	live, err := cs.GetRoutingRules(ctx)
	require.NoError(t, err)
	require.Empty(t, live, "draft mutations do not publish routing rules")
}

func TestRoutingDraftAuditFailuresRollbackEveryMutation(t *testing.T) {
	for _, operation := range []string{"create", "update", "delete"} {
		t.Run(operation, func(t *testing.T) {
			store, _ := testControlPlaneStore(t)
			ctx := context.Background()
			content := RoutingDraftContent{Name: "Original", RulesJSON: "[]", ChainMaxDepth: 10}
			original, err := store.CreateRoutingDraft(ctx, content)
			require.NoError(t, err)
			before := routingDraftAudits(t, store)
			db := store.db(ctx)
			const callback = "test:routing-draft-audit"
			require.NoError(t, db.Callback().Create().After("gorm:create").Register(callback, func(tx *gorm.DB) {
				if tx.Statement.Table == (AuditEvent{}).TableName() {
					tx.AddError(errors.New("audit failure"))
				}
			}))
			content.Name = "Must not persist"
			switch operation {
			case "create":
				_, err = store.CreateRoutingDraft(ctx, content)
			case "update":
				_, err = store.UpdateRoutingDraft(ctx, original.ID, RoutingDraftUpdate{content, 1})
			case "delete":
				err = store.DeleteRoutingDraft(ctx, original.ID, 1, "")
			}
			require.ErrorContains(t, err, "audit failure")
			require.NoError(t, db.Callback().Create().Remove(callback))
			saved, err := store.GetRoutingDraft(ctx, original.ID)
			require.NoError(t, err)
			requireRoutingDraftEqual(t, original, saved)
			rows, err := store.ListRoutingDrafts(ctx, 100, 0)
			require.NoError(t, err)
			require.Len(t, rows, 1)
			require.Equal(t, before, routingDraftAudits(t, store))
		})
	}
}

func TestRoutingDraftConcurrentUpdateHasOneWinner(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	content := RoutingDraftContent{Name: "Original", RulesJSON: "[]", ChainMaxDepth: 10}
	original, err := store.CreateRoutingDraft(ctx, content)
	require.NoError(t, err)
	start := make(chan struct{})
	outcomes := make(chan error, 2)
	var writers sync.WaitGroup
	for _, name := range []string{"Candidate A", "Candidate B"} {
		writers.Add(1)
		go func(name string) {
			defer writers.Done()
			<-start
			replacement := content
			replacement.Name = name
			_, err := store.UpdateRoutingDraft(ctx, original.ID, RoutingDraftUpdate{replacement, 1})
			outcomes <- err
		}(name)
	}
	close(start)
	writers.Wait()
	close(outcomes)
	winners := 0
	for err := range outcomes {
		if err == nil {
			winners++
		} else {
			require.ErrorIs(t, err, ErrRoutingDraftConflict)
		}
	}
	require.Equal(t, 1, winners)
	saved, err := store.GetRoutingDraft(ctx, original.ID)
	require.NoError(t, err)
	require.EqualValues(t, 2, saved.Revision)
	require.Contains(t, []string{"Candidate A", "Candidate B"}, saved.Name)
	require.Len(t, routingDraftAudits(t, store), 2)
}

func TestRoutingDraftMigrationPreservesExistingControlPlane(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	project := &Project{Name: "Existing"}
	require.NoError(t, store.CreateProject(ctx, project))
	require.NoError(t, store.db(ctx).Where("id = ?", project.ID).Take(project).Error)
	before := acknowledgementAudits(t, store)
	db := store.db(ctx)
	require.NoError(t, db.Migrator().DropTable(&RoutingDraft{}))
	require.NoError(t, db.Exec("DELETE FROM migrations WHERE id = ?", "elygate_control_plane_v12_routing_drafts").Error)
	upgraded, err := NewStore(ctx, cs)
	require.NoError(t, err)
	var retained Project
	require.NoError(t, upgraded.db(ctx).Where("id = ?", project.ID).Take(&retained).Error)
	require.Equal(t, *project, retained)
	require.Equal(t, before, acknowledgementAudits(t, upgraded))
	draft, err := upgraded.CreateRoutingDraft(ctx, RoutingDraftContent{Name: "First candidate", RulesJSON: "[]", ChainMaxDepth: 10})
	require.NoError(t, err)
	restarted, err := NewStore(ctx, cs)
	require.NoError(t, err)
	saved, err := restarted.GetRoutingDraft(ctx, draft.ID)
	require.NoError(t, err)
	requireRoutingDraftEqual(t, draft, saved)
	encoded, err := json.Marshal(saved)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "rules_json")
}

func TestRoutingDraftSurvivesDatabaseCloseAndReopen(t *testing.T) {
	ctx := context.Background()
	config := &configstore.Config{
		Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "draft-reopen.db")},
	}
	if socket := os.Getenv("ELYGATE_TEST_POSTGRES_SOCKET"); socket != "" {
		config = testPostgresControlPlaneConfig(t, socket)
	}
	var cs configstore.ConfigStore
	t.Cleanup(func() {
		if cs != nil {
			require.NoError(t, cs.Close(ctx))
		}
	})
	openStore := func() *Store {
		t.Helper()
		var err error
		cs, err = configstore.NewConfigStore(ctx, config, bifrost.NewDefaultLogger(schemas.LogLevelError))
		require.NoError(t, err)
		require.Equal(t, string(config.Type), cs.DB().Dialector.Name())
		store, err := NewStore(ctx, cs)
		require.NoError(t, err)
		return store
	}
	store := openStore()
	content := RoutingDraftContent{Name: "Durable candidate", RulesJSON: "[]", ChainMaxDepth: 10}
	created, err := store.CreateRoutingDraft(ctx, content)
	require.NoError(t, err)
	content.Name = "Latest candidate"
	updated, err := store.UpdateRoutingDraft(ctx, created.ID, RoutingDraftUpdate{content, 1})
	require.NoError(t, err)
	audits := routingDraftAudits(t, store)
	require.NoError(t, cs.Close(ctx))
	cs = nil
	reopened := openStore()
	saved, err := reopened.GetRoutingDraft(ctx, created.ID)
	require.NoError(t, err)
	requireRoutingDraftEqual(t, updated, saved)
	require.Equal(t, audits, routingDraftAudits(t, reopened))
	require.ErrorIs(t, reopened.DeleteRoutingDraft(ctx, created.ID, 1, ""), ErrRoutingDraftConflict)
	require.NoError(t, reopened.DeleteRoutingDraft(ctx, created.ID, 2, ""))
}
