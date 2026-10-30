package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func routingVersionAudits(t *testing.T, store *Store) []AuditEvent {
	t.Helper()
	var events []AuditEvent
	require.NoError(t, store.db(context.Background()).Where("resource_type = ?", "routing-version").
		Order("created_at, id").Find(&events).Error)
	return events
}

func requireRoutingVersionEqual(t *testing.T, expected, actual *RoutingPolicyVersion) {
	t.Helper()
	require.Equal(t, *expected, *actual)
}

func TestRoutingVersionImmutableLifecycle(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	content := RoutingDraftContent{Name: "Original", RulesJSON: "[]", ChainMaxDepth: 10}
	draft, err := store.CreateRoutingDraft(ctx, content)
	require.NoError(t, err)
	version, err := store.CreateRoutingPolicyVersion(ctx, draft.ID, 1, "snapshot-admin")
	require.NoError(t, err)
	require.NoError(t, uuid.Validate(version.ID))
	require.EqualValues(t, 1, version.DraftRevision)
	require.Equal(t, draft.ID, version.DraftID)
	require.Equal(t, content.Name, version.Name)
	require.Equal(t, content.RulesJSON, version.RulesJSON)
	require.Len(t, version.ContentSHA256, 64)
	expectedHash, err := routingVersionContentHash(*draft)
	require.NoError(t, err)
	require.Equal(t, expectedHash, version.ContentSHA256)
	require.Error(t, routingPolicyVersionRollback(store.db(ctx)))

	content.Name, content.ChainMaxDepth = "Changed", 7
	_, err = store.UpdateRoutingDraft(ctx, draft.ID, RoutingDraftUpdate{content, 1})
	require.NoError(t, err)
	replayed, err := store.CreateRoutingPolicyVersion(ctx, draft.ID, 1, "different-admin")
	require.NoError(t, err)
	requireRoutingVersionEqual(t, version, replayed)
	newVersion, err := store.CreateRoutingPolicyVersion(ctx, draft.ID, 2, "snapshot-admin")
	require.NoError(t, err)
	require.NotEqual(t, version.ID, newVersion.ID)
	require.NotEqual(t, version.ContentSHA256, newVersion.ContentSHA256)
	require.NoError(t, store.DeleteRoutingDraft(ctx, draft.ID, 2, "snapshot-admin"))
	replayed, err = store.CreateRoutingPolicyVersion(ctx, draft.ID, 1, "different-admin")
	require.NoError(t, err)
	requireRoutingVersionEqual(t, version, replayed)

	restarted, err := NewStore(ctx, cs)
	require.NoError(t, err)
	persisted, err := restarted.GetRoutingPolicyVersion(ctx, version.ID)
	require.NoError(t, err)
	requireRoutingVersionEqual(t, version, persisted)
	versions, err := restarted.ListRoutingPolicyVersions(ctx, 1, 0)
	require.NoError(t, err)
	require.Len(t, versions, 1)
	require.Equal(t, time.UTC, versions[0].CreatedAt.Location())
	require.Empty(t, versions[0].RulesJSON, "list must not load snapshot payloads")
	encoded, err := json.Marshal(versions[0])
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "rules")
	remaining, err := restarted.ListRoutingPolicyVersions(ctx, 1, 1)
	require.NoError(t, err)
	require.Len(t, remaining, 1)
	require.NotEqual(t, versions[0].ID, remaining[0].ID)
	events := routingVersionAudits(t, restarted)
	require.Len(t, events, 2, "idempotent replay does not duplicate audit events")
	for _, event := range events {
		require.Equal(t, "routing-version.create", event.Action)
		require.Equal(t, "snapshot-admin", event.ActorID)
	}
	active, err := cs.GetRoutingRules(ctx)
	require.NoError(t, err)
	require.Empty(t, active, "immutable capture must never activate routing")
}

func TestRoutingVersionConcurrentCaptureIsIdempotent(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	draft, err := store.CreateRoutingDraft(ctx, RoutingDraftContent{Name: "Candidate", RulesJSON: "[]", ChainMaxDepth: 10})
	require.NoError(t, err)
	start := make(chan struct{})
	type outcome struct {
		version *RoutingPolicyVersion
		err     error
	}
	outcomes := make(chan outcome, 4)
	var writers sync.WaitGroup
	for range 4 {
		writers.Go(func() {
			<-start
			version, err := store.CreateRoutingPolicyVersion(ctx, draft.ID, 1, "admin")
			outcomes <- outcome{version, err}
		})
	}
	close(start)
	writers.Wait()
	close(outcomes)
	var first *RoutingPolicyVersion
	for captured := range outcomes {
		require.NoError(t, captured.err)
		if first == nil {
			first = captured.version
		}
		requireRoutingVersionEqual(t, first, captured.version)
	}
	require.Len(t, routingVersionAudits(t, store), 1)
}

func TestRoutingVersionRejectionAndAuditRollback(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	draft, err := store.CreateRoutingDraft(ctx, RoutingDraftContent{Name: "Candidate", RulesJSON: "[]", ChainMaxDepth: 10})
	require.NoError(t, err)
	_, err = store.CreateRoutingPolicyVersion(ctx, draft.ID, 2, "admin")
	require.ErrorIs(t, err, ErrRoutingDraftConflict)
	_, err = store.CreateRoutingPolicyVersion(ctx, uuid.NewString(), 1, "admin")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	db := store.db(ctx)
	const callback = "test:routing-version-audit"
	require.NoError(t, db.Callback().Create().After("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			tx.AddError(errors.New("version audit rejected"))
		}
	}))
	_, err = store.CreateRoutingPolicyVersion(ctx, draft.ID, 1, "admin")
	require.ErrorContains(t, err, "version audit rejected")
	require.NoError(t, db.Callback().Create().Remove(callback))
	versions, err := store.ListRoutingPolicyVersions(ctx, 100, 0)
	require.NoError(t, err)
	require.Empty(t, versions)
	require.Empty(t, routingVersionAudits(t, store))
	saved, err := store.GetRoutingDraft(ctx, draft.ID)
	require.NoError(t, err)
	requireRoutingDraftEqual(t, draft, saved)
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	_, err = store.CreateRoutingPolicyVersion(cancelled, draft.ID, 1, "admin")
	require.Error(t, err)
	_, err = store.CreateRoutingPolicyVersion(ctx, draft.ID, 1, "admin")
	require.NoError(t, err, "rollback must not leave a uniqueness reservation behind")
}

func TestRoutingVersionMigrationPreservesDrafts(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	draft, err := store.CreateRoutingDraft(ctx, RoutingDraftContent{Name: "Existing", RulesJSON: "[]", ChainMaxDepth: 10})
	require.NoError(t, err)
	before := routingDraftAudits(t, store)
	require.NoError(t, store.db(ctx).Migrator().DropTable(&RoutingPolicyVersion{}))
	require.NoError(t, store.db(ctx).Exec("DELETE FROM migrations WHERE id = ?", "elygate_control_plane_v13_routing_versions").Error)
	upgraded, err := NewStore(ctx, cs)
	require.NoError(t, err)
	retained, err := upgraded.GetRoutingDraft(ctx, draft.ID)
	require.NoError(t, err)
	requireRoutingDraftEqual(t, draft, retained)
	require.Equal(t, before, routingDraftAudits(t, upgraded))
	_, err = upgraded.CreateRoutingPolicyVersion(ctx, draft.ID, 1, "admin")
	require.NoError(t, err)
}
