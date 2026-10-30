package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/routing"
	"github.com/maximhq/bifrost/plugins/routing/rules"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func routingReleaseVersion(t *testing.T, store *Store) *RoutingPolicyVersion {
	return routingReleaseVersionWithRules(t, store, "[]")
}

func routingReleaseVersionWithRules(t *testing.T, store *Store, rulesJSON string) *RoutingPolicyVersion {
	t.Helper()
	ctx := context.Background()
	draft, err := store.CreateRoutingDraft(ctx, RoutingDraftContent{
		Name: "Release candidate", RulesJSON: rulesJSON, ChainMaxDepth: 3,
	})
	require.NoError(t, err)
	version, err := store.CreateRoutingPolicyVersion(ctx, draft.ID, 1, "sealing-admin")
	require.NoError(t, err)
	return version
}

func routingReleaseAudits(t *testing.T, store *Store) []AuditEvent {
	t.Helper()
	var events []AuditEvent
	require.NoError(t, store.db(context.Background()).Where("resource_type = ?", "routing-release").
		Order("created_at, id").Find(&events).Error)
	return events
}

func requirePendingRoutingHead(t *testing.T, store *Store, attempt *RoutingReleaseAttempt) {
	t.Helper()
	head, err := store.GetRoutingReleaseHead(context.Background())
	require.NoError(t, err)
	require.Equal(t, attempt.Epoch, head.Epoch)
	require.Equal(t, "pending", head.State)
	require.Equal(t, attempt.VersionID, head.DesiredVersionID)
	require.Equal(t, attempt.Fingerprint, head.DesiredFingerprint)
	require.Empty(t, head.AppliedVersionID)
	require.Empty(t, head.AppliedFingerprint)
	require.False(t, head.IsApplied(), "acceptance is not activation")
}

func TestRoutingReleaseAcceptanceAndHistoricalReplay(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	initial, err := store.GetRoutingReleaseHead(ctx)
	require.NoError(t, err)
	require.Equal(t, RoutingReleaseHead{ID: 1, State: "pending"}, *initial)
	require.False(t, initial.IsApplied())

	require.NoError(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{RoutingChainMaxDepth: 7}))
	require.NoError(t, cs.CreateRoutingRule(ctx, &configtables.TableRoutingRule{
		ID: "live-rule", Name: "Live", Scope: "global", CelExpression: "true",
		Enabled: new(true), Targets: []configtables.TableRoutingTarget{{Provider: ptr("openai"), Weight: 1}},
	}))
	liveRules, err := cs.GetRoutingRules(ctx)
	require.NoError(t, err)
	liveClient, err := cs.GetClientConfig(ctx)
	require.NoError(t, err)

	version := routingReleaseVersion(t, store)
	request := RoutingReleaseRequest{VersionID: version.ID, IdempotencyKey: uuid.NewString(), ActorID: "releasing-admin"}
	first, err := store.AcceptRoutingRelease(ctx, request)
	require.NoError(t, err)
	require.EqualValues(t, 0, first.ExpectedEpoch)
	require.EqualValues(t, 1, first.Epoch)
	require.Equal(t, version.ContentSHA256, first.Fingerprint)
	require.NoError(t, uuid.Validate(first.ID))
	requirePendingRoutingHead(t, store, first)
	encoded, err := json.Marshal(first)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), request.IdempotencyKey, "opaque replay keys stay out of receipts")

	_, err = store.UpdateRoutingDraft(ctx, version.DraftID, RoutingDraftUpdate{
		Content: RoutingDraftContent{Name: "Changed source", RulesJSON: "[]", ChainMaxDepth: 1}, ExpectedRevision: 1,
	})
	require.NoError(t, err)
	secondVersion, err := store.CreateRoutingPolicyVersion(ctx, version.DraftID, 2, "sealing-admin")
	require.NoError(t, err)
	secondRequest := RoutingReleaseRequest{VersionID: secondVersion.ID, ExpectedEpoch: 1, IdempotencyKey: uuid.NewString()}
	second, err := store.AcceptRoutingRelease(ctx, secondRequest)
	require.NoError(t, err)
	require.EqualValues(t, 2, second.Epoch)
	require.NotEqual(t, first.Fingerprint, second.Fingerprint)
	requirePendingRoutingHead(t, store, second)
	require.NoError(t, store.DeleteRoutingDraft(ctx, version.DraftID, 2, "admin"))

	request.ActorID = "retry-admin"
	replayed, err := store.AcceptRoutingRelease(ctx, request)
	require.NoError(t, err)
	require.Equal(t, *first, *replayed, "old keys return their original receipt, not the latest head")
	requirePendingRoutingHead(t, store, second)
	events := routingReleaseAudits(t, store)
	require.Len(t, events, 2)
	require.Equal(t, first.ID, events[0].ResourceID)
	require.Equal(t, "releasing-admin", events[0].ActorID)
	for _, event := range events {
		require.Equal(t, "routing-release.accept", event.Action)
	}
	afterRules, err := cs.GetRoutingRules(ctx)
	require.NoError(t, err)
	require.Equal(t, liveRules, afterRules)
	afterClient, err := cs.GetClientConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, liveClient, afterClient, "acceptance cannot change live chain depth or client configuration")
}

func TestRoutingReleaseConcurrentAcceptance(t *testing.T) {
	// Distinct keys at one epoch have one winner; a shared key has four equal receipts.
	for _, sharedKey := range []bool{false, true} {
		name := "distinct-keys"
		if sharedKey {
			name = "shared-key"
		}
		t.Run(name, func(t *testing.T) {
			store, cs := testControlPlaneStore(t)
			ctx := context.Background()
			otherStore, err := NewStore(ctx, cs)
			require.NoError(t, err)
			version := routingReleaseVersion(t, store)
			start := make(chan struct{})
			type outcome struct {
				attempt *RoutingReleaseAttempt
				err     error
			}
			outcomes := make(chan outcome, 4)
			key := uuid.NewString()
			var writers sync.WaitGroup
			for index := range 4 {
				request := RoutingReleaseRequest{VersionID: version.ID, IdempotencyKey: key}
				if !sharedKey {
					request.IdempotencyKey = uuid.NewString()
				}
				owner := []*Store{store, otherStore}[index%2]
				writers.Go(func() {
					<-start
					attempt, err := owner.AcceptRoutingRelease(ctx, request)
					outcomes <- outcome{attempt, err}
				})
			}
			close(start)
			writers.Wait()
			close(outcomes)
			var first *RoutingReleaseAttempt
			successes := 0
			for accepted := range outcomes {
				if accepted.err != nil {
					require.False(t, sharedKey)
					require.ErrorIs(t, accepted.err, ErrRoutingReleaseConflict)
					require.Nil(t, accepted.attempt)
					continue
				}
				successes++
				if first == nil {
					first = accepted.attempt
				}
				require.Equal(t, *first, *accepted.attempt)
			}
			expected := 1
			if sharedKey {
				expected = 4
			}
			require.Equal(t, expected, successes)
			requirePendingRoutingHead(t, store, first)
			require.Len(t, routingReleaseAudits(t, store), 1)
			var count int64
			require.NoError(t, store.db(ctx).Model(&RoutingReleaseAttempt{}).Count(&count).Error)
			require.EqualValues(t, 1, count)
		})
	}
}

func TestRoutingReleaseValidationAndConflicts(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	version := routingReleaseVersion(t, store)
	original, err := store.GetRoutingReleaseHead(ctx)
	require.NoError(t, err)
	request := RoutingReleaseRequest{VersionID: version.ID, IdempotencyKey: uuid.NewString()}
	// Invalid identifiers, empty/oversized keys and epoch boundaries cannot reserve a key.
	for _, invalid := range []RoutingReleaseRequest{
		{IdempotencyKey: uuid.NewString()},
		{VersionID: "not-a-version", IdempotencyKey: uuid.NewString()},
		{VersionID: version.ID},
		{VersionID: version.ID, IdempotencyKey: " \t\n"},
		{VersionID: version.ID, IdempotencyKey: strings.Repeat("x", 129)},
		{VersionID: version.ID, IdempotencyKey: request.IdempotencyKey, ExpectedEpoch: -1},
		{VersionID: version.ID, IdempotencyKey: request.IdempotencyKey, ExpectedEpoch: math.MaxInt64},
	} {
		attempt, err := store.AcceptRoutingRelease(ctx, invalid)
		require.ErrorIs(t, err, ErrRoutingReleaseRequest)
		require.Nil(t, attempt)
	}
	missing := request
	missing.VersionID = uuid.NewString()
	_, err = store.AcceptRoutingRelease(ctx, missing)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	stale := request
	stale.ExpectedEpoch = 1
	_, err = store.AcceptRoutingRelease(ctx, stale)
	require.ErrorIs(t, err, ErrRoutingReleaseConflict)
	unchanged, err := store.GetRoutingReleaseHead(ctx)
	require.NoError(t, err)
	require.Equal(t, *original, *unchanged)
	require.Empty(t, routingReleaseAudits(t, store))
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	cancelledAttempt, err := store.AcceptRoutingRelease(cancelled, request)
	require.ErrorIs(t, err, context.Canceled)
	require.Nil(t, cancelledAttempt)

	first, err := store.AcceptRoutingRelease(ctx, request)
	require.NoError(t, err)
	for _, changed := range []RoutingReleaseRequest{
		{VersionID: uuid.NewString(), IdempotencyKey: request.IdempotencyKey},
		{VersionID: version.ID, IdempotencyKey: request.IdempotencyKey, ExpectedEpoch: 1},
	} {
		attempt, err := store.AcceptRoutingRelease(ctx, changed)
		require.ErrorIs(t, err, ErrRoutingReleaseKeyConflict)
		require.Nil(t, attempt)
	}
	_, err = store.AcceptRoutingRelease(ctx, RoutingReleaseRequest{VersionID: version.ID, IdempotencyKey: uuid.NewString()})
	require.ErrorIs(t, err, ErrRoutingReleaseConflict)
	requirePendingRoutingHead(t, store, first)
	require.Len(t, routingReleaseAudits(t, store), 1)
	request.ExpectedEpoch, request.IdempotencyKey = 1, strings.Repeat("k", 128)
	second, err := store.AcceptRoutingRelease(ctx, request)
	require.NoError(t, err, "the same version may be accepted at another epoch with a new key")
	require.EqualValues(t, 2, second.Epoch)
}

func TestRoutingReleaseAuditAndHeadFailureRollback(t *testing.T) {
	for _, rejectedTable := range []string{(AuditEvent{}).TableName(), (RoutingReleaseHead{}).TableName()} {
		t.Run(rejectedTable, func(t *testing.T) {
			store, _ := testControlPlaneStore(t)
			ctx := context.Background()
			version := routingReleaseVersion(t, store)
			first, err := store.AcceptRoutingRelease(ctx, RoutingReleaseRequest{VersionID: version.ID, IdempotencyKey: uuid.NewString()})
			require.NoError(t, err)
			request := RoutingReleaseRequest{VersionID: version.ID, ExpectedEpoch: 1, IdempotencyKey: uuid.NewString()}
			db := store.db(ctx)
			reject := func(tx *gorm.DB) {
				if tx.Statement.Table != rejectedTable {
					return
				}
				if rejectedTable == (RoutingReleaseHead{}).TableName() {
					mutations, _ := tx.Statement.Dest.(map[string]any)
					if _, changesIntent := mutations["state"]; !changesIntent {
						return
					}
				}
				tx.AddError(errors.New("release transaction rejected"))
			}
			const callback = "test:routing-release-rollback"
			require.NoError(t, db.Callback().Create().After("gorm:create").Register(callback, reject))
			require.NoError(t, db.Callback().Update().After("gorm:update").Register(callback, reject))
			t.Cleanup(func() {
				db.Callback().Create().Remove(callback)
				db.Callback().Update().Remove(callback)
			})
			attempt, err := store.AcceptRoutingRelease(ctx, request)
			require.ErrorContains(t, err, "release transaction rejected")
			require.Nil(t, attempt, "a rolled-back receipt must not look committed")
			require.NoError(t, db.Callback().Create().Remove(callback))
			require.NoError(t, db.Callback().Update().Remove(callback))
			requirePendingRoutingHead(t, store, first)
			require.Len(t, routingReleaseAudits(t, store), 1)
			var count int64
			require.NoError(t, db.Model(&RoutingReleaseAttempt{}).Count(&count).Error)
			require.EqualValues(t, 1, count)
			retry, err := store.AcceptRoutingRelease(ctx, request)
			require.NoError(t, err, "rollback must release the key and epoch reservation")
			requirePendingRoutingHead(t, store, retry)
		})
	}
}

func TestRoutingReleaseRejectsInvalidVersionFingerprint(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	version := routingReleaseVersion(t, store)
	request := RoutingReleaseRequest{VersionID: version.ID, IdempotencyKey: uuid.NewString()}
	for _, invalid := range []string{"", "not-a-sha256", strings.Repeat("f", 62), strings.Repeat("g", 64)} {
		require.NoError(t, store.db(ctx).Model(&RoutingPolicyVersion{}).Where("id = ?", version.ID).
			UpdateColumn("content_sha256", invalid).Error)
		_, err := store.AcceptRoutingRelease(ctx, request)
		require.ErrorIs(t, err, ErrRoutingReleaseRequest)
	}
	require.Empty(t, routingReleaseAudits(t, store))
	require.NoError(t, store.db(ctx).Model(&RoutingPolicyVersion{}).Where("id = ?", version.ID).
		UpdateColumn("content_sha256", version.ContentSHA256).Error)
	attempt, err := store.AcceptRoutingRelease(ctx, request)
	require.NoError(t, err)
	require.Equal(t, version.ContentSHA256, attempt.Fingerprint)
}

func TestRoutingReleaseIsAppliedPredicate(t *testing.T) {
	matching := RoutingReleaseHead{Epoch: 1, State: "applied", DesiredVersionID: uuid.NewString(), DesiredFingerprint: strings.Repeat("f", 64)}
	matching.AppliedVersionID, matching.AppliedFingerprint = matching.DesiredVersionID, matching.DesiredFingerprint
	require.True(t, matching.IsApplied())
	for _, change := range []func(*RoutingReleaseHead){
		func(head *RoutingReleaseHead) { head.Epoch = 0 },
		func(head *RoutingReleaseHead) { head.State = "pending" },
		func(head *RoutingReleaseHead) { head.State = "failed" },
		func(head *RoutingReleaseHead) { head.DesiredVersionID, head.AppliedVersionID = "", "" },
		func(head *RoutingReleaseHead) { head.DesiredFingerprint, head.AppliedFingerprint = "", "" },
		func(head *RoutingReleaseHead) { head.AppliedVersionID = uuid.NewString() },
		func(head *RoutingReleaseHead) { head.AppliedFingerprint = strings.Repeat("e", 64) },
	} {
		head := matching
		change(&head)
		require.False(t, head.IsApplied())
	}
	require.False(t, (RoutingReleaseHead{}).IsApplied())
}

func TestRoutingReleaseSurvivesDatabaseCloseAndReopen(t *testing.T) {
	ctx := context.Background()
	config := &configstore.Config{Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "releases.db")}}
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
		store, err := NewStore(ctx, cs)
		require.NoError(t, err)
		return store
	}
	store := openStore()
	require.NoError(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{RoutingChainMaxDepth: 7}))
	require.NoError(t, cs.CreateRoutingRule(ctx, &configtables.TableRoutingRule{
		ID: "live-before-restart", Name: "Live before restart", Scope: "global",
		CelExpression: "model == 'live'", Enabled: new(true),
		Targets: []configtables.TableRoutingTarget{{Model: ptr("live-model"), Weight: 1}},
	}))
	version := routingReleaseVersionWithRules(t, store, `[{"id":"desired-only","name":"Desired only","cel_expression":"model == 'desired'","targets":[{"model":"desired-model","weight":1}]}]`)
	request := RoutingReleaseRequest{VersionID: version.ID, IdempotencyKey: uuid.NewString()}
	accepted, err := store.AcceptRoutingRelease(ctx, request)
	require.NoError(t, err)
	audits := routingReleaseAudits(t, store)
	require.NoError(t, cs.Close(ctx))
	cs = nil
	reopened := openStore()
	requirePendingRoutingHead(t, reopened, accepted)
	replayed, err := reopened.AcceptRoutingRelease(ctx, request)
	require.NoError(t, err)
	require.Equal(t, *accepted, *replayed)
	require.Equal(t, audits, routingReleaseAudits(t, reopened))
	liveRules, err := cs.GetRoutingRules(ctx)
	require.NoError(t, err)
	require.Len(t, liveRules, 1)
	require.Equal(t, "live-before-restart", liveRules[0].ID)
	clientConfig, err := cs.GetClientConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, 7, clientConfig.RoutingChainMaxDepth)
	plugin, err := routing.Init(ctx, &routing.Config{ChainMaxDepth: &clientConfig.RoutingChainMaxDepth},
		rules.NewMockLogger(), cs, routing.NewMockGovernance())
	require.NoError(t, err)
	defer func() { require.NoError(t, plugin.Cleanup()) }()
	runtimeStore := plugin.GetRuleStore().(*rules.LocalStore)
	runtimeRules := runtimeStore.GetAllRules(ctx)
	require.Len(t, runtimeRules, 1, "restart must load the durable live policy, not the pending desired version")
	require.Equal(t, "live-before-restart", runtimeRules[0].ID)
	require.Equal(t, 7, runtimeStore.Snapshot().(interface{ ChainMaxDepth() int }).ChainMaxDepth(),
		"pending desired depth must not enter the serving generation")
	engine, err := rules.NewEngine(runtimeStore, rules.NewMockGovernanceStore(), rules.NewMockLogger(), &clientConfig.RoutingChainMaxDepth)
	require.NoError(t, err)
	for _, model := range []string{"live", "desired"} {
		requestCtx, cancel := schemas.NewBifrostContextWithCancel(ctx)
		decision, err := engine.EvaluateRoutingRules(requestCtx, &rules.EvaluationContext{
			Provider: schemas.OpenAI, Model: model, RequestType: "chat_completion",
		})
		cancel()
		require.NoError(t, err)
		if model == "live" {
			require.NotNil(t, decision)
			require.Equal(t, "live-model", decision.Model)
		} else {
			require.Nil(t, decision, "pending candidate must not route traffic after restart")
		}
	}
}

func TestRoutingReleaseMigrationPreservesHistory(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	version := routingReleaseVersion(t, store)
	db := store.db(ctx)
	require.NoError(t, db.Migrator().DropTable(&RoutingReleaseAttempt{}, &RoutingReleaseHead{}))
	require.NoError(t, db.Exec("DELETE FROM migrations WHERE id = ?", "elygate_control_plane_v14_routing_release_intents").Error)
	upgraded, err := NewStore(ctx, cs)
	require.NoError(t, err)
	retained, err := upgraded.GetRoutingPolicyVersion(ctx, version.ID)
	require.NoError(t, err)
	requireRoutingVersionEqual(t, version, retained)
	request := RoutingReleaseRequest{VersionID: version.ID, IdempotencyKey: uuid.NewString()}
	accepted, err := upgraded.AcceptRoutingRelease(ctx, request)
	require.NoError(t, err)
	require.Error(t, routingReleaseRollback(upgraded.db(ctx)))
	require.NoError(t, migrateRoutingReleases(upgraded.db(ctx)))
	requirePendingRoutingHead(t, upgraded, accepted)
	require.Len(t, routingReleaseAudits(t, upgraded), 1)
	// A later installer may acknowledge application; migration replay must not
	// include the seed's pending state in the lookup or overwrite that state.
	require.NoError(t, upgraded.db(ctx).Model(&RoutingReleaseHead{}).Where("id = ?", 1).Updates(map[string]any{
		"state": "applied", "applied_version_id": accepted.VersionID, "applied_fingerprint": accepted.Fingerprint,
	}).Error)
	applied, err := upgraded.GetRoutingReleaseHead(ctx)
	require.NoError(t, err)
	require.True(t, applied.IsApplied())
	require.NoError(t, migrateRoutingReleases(upgraded.db(ctx)))
	preserved, err := upgraded.GetRoutingReleaseHead(ctx)
	require.NoError(t, err)
	require.Equal(t, *applied, *preserved)
	require.NoError(t, upgraded.db(ctx).Where("id = ?", 1).Delete(&RoutingReleaseHead{}).Error)
	attempt, err := upgraded.AcceptRoutingRelease(ctx, request)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound, "missing singleton must fail closed, not reseed epoch zero")
	require.Nil(t, attempt)
}
