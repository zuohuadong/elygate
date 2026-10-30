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
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func rollbackTestCompiler(_ context.Context, version RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
	var compiled []*tables.TableRoutingRule
	err := json.Unmarshal([]byte(version.RulesJSON), &compiled)
	return compiled, err
}

func appliedRollbackFixture(t *testing.T, store *Store, name string, depth int) *RoutingReleaseAttempt {
	t.Helper()
	rulesJSON := "[]"
	if name != "" {
		encoded, err := json.Marshal([]tables.TableRoutingRule{{
			ID: uuid.NewString(), Name: name, Scope: "global", CelExpression: "true", Enabled: new(true),
			Targets: []tables.TableRoutingTarget{{Provider: new("openai"), Model: new(name), Weight: 1}},
		}})
		require.NoError(t, err)
		rulesJSON = string(encoded)
	}
	draft, err := store.CreateRoutingDraft(t.Context(), RoutingDraftContent{
		Name: "Rollback fixture", RulesJSON: rulesJSON, ChainMaxDepth: depth,
	})
	require.NoError(t, err)
	version, err := store.CreateRoutingPolicyVersion(t.Context(), draft.ID, 1, "author")
	require.NoError(t, err)
	head, err := store.GetRoutingReleaseHead(t.Context())
	require.NoError(t, err)
	attempt, err := store.AcceptRoutingRelease(t.Context(), RoutingReleaseRequest{
		VersionID: version.ID, ExpectedEpoch: head.Epoch, IdempotencyKey: uuid.NewString(),
	})
	require.NoError(t, err)
	_, err = store.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, rollbackTestCompiler, "installer")
	require.NoError(t, err)
	return attempt
}

func rollbackRequest(target, current *RoutingReleaseAttempt) RoutingReleaseRequest {
	return RoutingReleaseRequest{
		Operation: RoutingReleaseRollback, RollbackOfEpoch: target.Epoch,
		ExpectedEpoch: current.Epoch, IdempotencyKey: uuid.NewString(), ActorID: "rollback-admin",
	}
}

func routingApplications(t *testing.T, store *Store) []RoutingReleaseApplication {
	t.Helper()
	var applications []RoutingReleaseApplication
	require.NoError(t, store.db(t.Context()).Order("epoch").Find(&applications).Error)
	for index := range applications {
		applications[index].RecordedAt = applications[index].RecordedAt.UTC()
	}
	return applications
}

func routingLiveFingerprint(t *testing.T, cs configstore.ConfigStore) string {
	t.Helper()
	var fingerprint string
	require.NoError(t, cs.ExecuteTransaction(t.Context(), func(tx *gorm.DB) error {
		policy, err := configstore.SnapshotRoutingPolicy(tx)
		if err != nil {
			return err
		}
		fingerprint, err = configstore.RoutingPolicyFingerprint(*policy)
		return err
	}))
	return fingerprint
}

func TestRoutingRollbackNewReleaseAndHistoricalReplay(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 9}))
	first := appliedRollbackFixture(t, store, "original", 2)
	firstFingerprint := routingLiveFingerprint(t, cs)
	second := appliedRollbackFixture(t, store, "", 5)
	secondFingerprint := routingLiveFingerprint(t, cs)
	before := routingApplications(t, store)
	request := rollbackRequest(first, second)
	accepted, err := store.AcceptRoutingRelease(t.Context(), request)
	require.NoError(t, err)
	require.NotEqual(t, first.ID, accepted.ID)
	require.EqualValues(t, 3, accepted.Epoch)
	require.Equal(t, first.VersionID, accepted.VersionID)
	require.Equal(t, first.Fingerprint, accepted.Fingerprint)
	require.Equal(t, first.Epoch, accepted.RollbackOfEpoch)
	require.Equal(t, first.ID, accepted.RollbackOfAttempt)
	require.Equal(t, string(RoutingReleaseRollback), accepted.Operation)
	requirePendingRoutingHead(t, store, accepted)
	require.Equal(t, secondFingerprint, routingLiveFingerprint(t, cs), "acceptance must not change the live policy")
	require.Equal(t, before, routingApplications(t, store), "pending rollback has no application receipt")
	request.ActorID = "retry-admin"
	replayed, err := store.AcceptRoutingRelease(t.Context(), request)
	require.NoError(t, err)
	require.Equal(t, *accepted, *replayed)

	installed, err := store.InstallAcceptedRoutingRelease(t.Context(), accepted.Epoch, rollbackTestCompiler, "installer")
	require.NoError(t, err)
	require.True(t, installed.Head.IsApplied())
	require.Equal(t, 2, installed.Policy.ChainMaxDepth)
	require.Equal(t, firstFingerprint, routingLiveFingerprint(t, cs))
	applications := routingApplications(t, store)
	require.Len(t, applications, 3)
	require.Equal(t, before, applications[:2], "earlier application receipts are immutable")
	require.Equal(t, accepted.ID, applications[2].AttemptID)
	require.Equal(t, applications[0].PolicyFingerprint, applications[2].PolicyFingerprint)
	_, err = store.InstallAcceptedRoutingRelease(t.Context(), accepted.Epoch, rollbackTestCompiler, "retry")
	require.NoError(t, err)
	require.Equal(t, applications, routingApplications(t, store))
	audits := routingReleaseAudits(t, store)
	require.Len(t, audits, 6)
	for _, audit := range audits {
		if audit.Action == "routing-release.rollback" {
			require.Equal(t, accepted.ID, audit.ResourceID)
			require.Equal(t, "rollback-admin", audit.ActorID)
		}
		if audit.Action == "routing-release.apply" {
			require.Contains(t, []string{first.ID, second.ID, accepted.ID}, audit.ResourceID)
		}
	}
	require.Equal(t, "routing-release.rollback", audits[4].Action)
	_, err = CheckRoutingPolicyStartup(t.Context(), cs, rollbackTestCompiler)
	require.NoError(t, err)

	next := appliedRollbackFixture(t, store, "latest", 4)
	replayed, err = store.AcceptRoutingRelease(t.Context(), request)
	require.NoError(t, err)
	require.Equal(t, *accepted, *replayed)
	compilerCalls := 0
	rejected, err := store.InstallAcceptedRoutingRelease(t.Context(), replayed.Epoch,
		func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
			compilerCalls++
			return nil, nil
		}, "stale-installer")
	require.ErrorIs(t, err, ErrRoutingReleaseConflict)
	require.Nil(t, rejected)
	require.Zero(t, compilerCalls, "historical replay cannot reach the compiler or runtime swap")
	head, err := store.GetRoutingReleaseHead(t.Context())
	require.NoError(t, err)
	require.Equal(t, next.Epoch, head.Epoch)
	require.Len(t, routingApplications(t, store), 4)
}

func TestRoutingRollbackValidationAndOperationKeyConflicts(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 9}))
	first := appliedRollbackFixture(t, store, "first", 2)
	second := appliedRollbackFixture(t, store, "second", 3)
	original := rollbackRequest(first, second)
	// Empty/current/future/negative targets, supplied version, unknown operation and epoch overflow are invalid.
	for _, mutate := range []func(*RoutingReleaseRequest){
		func(request *RoutingReleaseRequest) { request.RollbackOfEpoch = 0 },
		func(request *RoutingReleaseRequest) { request.RollbackOfEpoch = -1 },
		func(request *RoutingReleaseRequest) { request.RollbackOfEpoch = second.Epoch },
		func(request *RoutingReleaseRequest) { request.RollbackOfEpoch = second.Epoch + 1 },
		func(request *RoutingReleaseRequest) { request.VersionID = first.VersionID },
		func(request *RoutingReleaseRequest) { request.Operation = "unknown" },
		func(request *RoutingReleaseRequest) { request.ExpectedEpoch = math.MaxInt64 },
		func(request *RoutingReleaseRequest) { request.IdempotencyKey = strings.Repeat("k", 129) },
		func(request *RoutingReleaseRequest) { request.IdempotencyKey = " \n" },
	} {
		request := original
		mutate(&request)
		rejected, err := store.AcceptRoutingRelease(t.Context(), request)
		require.ErrorIs(t, err, ErrRoutingReleaseRequest)
		require.Nil(t, rejected)
	}
	accepted, err := store.AcceptRoutingRelease(t.Context(), original)
	require.NoError(t, err)
	_, err = store.AcceptRoutingRelease(t.Context(), RoutingReleaseRequest{
		VersionID: first.VersionID, ExpectedEpoch: original.ExpectedEpoch, IdempotencyKey: original.IdempotencyKey,
	})
	require.ErrorIs(t, err, ErrRoutingReleaseKeyConflict, "publish cannot replay a rollback key")
	changed := original
	changed.ExpectedEpoch++
	_, err = store.AcceptRoutingRelease(t.Context(), changed)
	require.ErrorIs(t, err, ErrRoutingReleaseKeyConflict)
	requirePendingRoutingHead(t, store, accepted)
	_, err = store.InstallAcceptedRoutingRelease(t.Context(), accepted.Epoch, rollbackTestCompiler, "installer")
	require.NoError(t, err)
	reverse := rollbackRequest(first, accepted)
	reverse.IdempotencyKey = second.IdempotencyKey
	_, err = store.AcceptRoutingRelease(t.Context(), reverse)
	require.ErrorIs(t, err, ErrRoutingReleaseKeyConflict, "rollback cannot replay a publish key")
	originalTarget := rollbackRequest(first, accepted)
	_, err = store.AcceptRoutingRelease(t.Context(), originalTarget)
	require.NoError(t, err)
	otherTarget := originalTarget
	otherTarget.RollbackOfEpoch = second.Epoch
	_, err = store.AcceptRoutingRelease(t.Context(), otherTarget)
	require.ErrorIs(t, err, ErrRoutingReleaseKeyConflict, "different applied targets cannot share a rollback key")
}

func TestRoutingRollbackRejectsUnappliedAndCorruptTargets(t *testing.T) {
	for _, corrupt := range []string{"pending-only", "missing-application", "application-attempt", "application-version", "version-hash", "missing-attempt"} {
		t.Run(corrupt, func(t *testing.T) {
			store, cs := testControlPlaneStore(t)
			require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 9}))
			var first *RoutingReleaseAttempt
			if corrupt == "pending-only" {
				version := routingReleaseVersion(t, store)
				var err error
				first, err = store.AcceptRoutingRelease(t.Context(), RoutingReleaseRequest{
					VersionID: version.ID, IdempotencyKey: uuid.NewString(),
				})
				require.NoError(t, err)
			} else {
				first = appliedRollbackFixture(t, store, "first", 2)
			}
			second := appliedRollbackFixture(t, store, "second", 3)
			db := cs.DB()
			switch corrupt {
			case "missing-application":
				require.NoError(t, db.Where("epoch = ?", first.Epoch).Delete(&RoutingReleaseApplication{}).Error)
			case "application-attempt":
				require.NoError(t, db.Model(&RoutingReleaseApplication{}).Where("epoch = ?", first.Epoch).
					UpdateColumn("attempt_id", uuid.NewString()).Error)
			case "application-version":
				require.NoError(t, db.Model(&RoutingReleaseApplication{}).Where("epoch = ?", first.Epoch).
					UpdateColumn("version_id", second.VersionID).Error)
			case "version-hash":
				require.NoError(t, db.Model(&RoutingPolicyVersion{}).Where("id = ?", first.VersionID).
					UpdateColumn("name", "out-of-band change").Error)
			case "missing-attempt":
				require.NoError(t, db.Where("id = ?", first.ID).Delete(&RoutingReleaseAttempt{}).Error)
			}
			head, err := store.GetRoutingReleaseHead(t.Context())
			require.NoError(t, err)
			audits := routingReleaseAudits(t, store)
			before := routingApplications(t, store)
			fingerprint := routingLiveFingerprint(t, cs)
			rejected, err := store.AcceptRoutingRelease(t.Context(), rollbackRequest(first, second))
			require.Error(t, err)
			require.Nil(t, rejected)
			after, err := store.GetRoutingReleaseHead(t.Context())
			require.NoError(t, err)
			require.Equal(t, *head, *after)
			require.Equal(t, before, routingApplications(t, store))
			require.Equal(t, audits, routingReleaseAudits(t, store))
			require.Equal(t, fingerprint, routingLiveFingerprint(t, cs))
		})
	}
}

func TestRoutingRollbackInstallationRevalidatesPolicy(t *testing.T) {
	for _, failure := range []string{"compiler", "scope", "policy-fingerprint", "target-disappeared", "audit", "application"} {
		t.Run(failure, func(t *testing.T) {
			store, cs := testControlPlaneStore(t)
			require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 9}))
			first := appliedRollbackFixture(t, store, "first", 2)
			second := appliedRollbackFixture(t, store, "second", 3)
			accepted, err := store.AcceptRoutingRelease(t.Context(), rollbackRequest(first, second))
			require.NoError(t, err)
			fingerprint := routingLiveFingerprint(t, cs)
			audits := routingReleaseAudits(t, store)
			compile := rollbackTestCompiler
			switch failure {
			case "compiler":
				compile = func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
					return nil, errors.New("compiler refused rollback")
				}
			case "scope":
				compile = func(ctx context.Context, version RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
					compiled, err := rollbackTestCompiler(ctx, version)
					compiled[0].Scope, compiled[0].ScopeID = "virtual_key", new("no-longer-existing")
					return compiled, err
				}
			case "policy-fingerprint":
				require.NoError(t, cs.DB().Model(&RoutingReleaseApplication{}).Where("epoch = ?", first.Epoch).
					UpdateColumn("policy_fingerprint", strings.Repeat("f", 64)).Error)
			case "target-disappeared":
				require.NoError(t, cs.DB().Where("epoch = ?", first.Epoch).Delete(&RoutingReleaseApplication{}).Error)
			case "audit", "application":
				table := (AuditEvent{}).TableName()
				if failure == "application" {
					table = (RoutingReleaseApplication{}).TableName()
				}
				const callback = "test:rollback-install-failure"
				require.NoError(t, cs.DB().Callback().Create().After("gorm:create").Register(callback, func(tx *gorm.DB) {
					if tx.Statement.Table == table {
						tx.AddError(errors.New("receipt or audit rejected"))
					}
				}))
				t.Cleanup(func() { cs.DB().Callback().Create().Remove(callback) })
			}
			applications := routingApplications(t, store)
			rejected, err := store.InstallAcceptedRoutingRelease(t.Context(), accepted.Epoch, compile, "installer")
			require.Error(t, err)
			require.Nil(t, rejected)
			requirePendingRoutingHead(t, store, accepted)
			require.Equal(t, fingerprint, routingLiveFingerprint(t, cs))
			require.Equal(t, applications, routingApplications(t, store))
			require.Equal(t, audits, routingReleaseAudits(t, store))
		})
	}
}

func TestRoutingRollbackConcurrentAcceptance(t *testing.T) {
	// Distinct keys have one winner; an identical request returns one immutable receipt to all four writers.
	for _, sharedKey := range []bool{false, true} {
		t.Run(map[bool]string{false: "distinct", true: "shared"}[sharedKey], func(t *testing.T) {
			store, cs := testControlPlaneStore(t)
			require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 9}))
			first := appliedRollbackFixture(t, store, "first", 2)
			second := appliedRollbackFixture(t, store, "second", 3)
			other, err := NewStore(t.Context(), cs)
			require.NoError(t, err)
			type outcome struct {
				attempt *RoutingReleaseAttempt
				err     error
			}
			outcomes := make(chan outcome, 4)
			start := make(chan struct{})
			var writers sync.WaitGroup
			original := rollbackRequest(first, second)
			for index := range 4 {
				request := original
				if !sharedKey {
					request.IdempotencyKey = uuid.NewString()
				}
				owner := []*Store{store, other}[index%2]
				writers.Go(func() {
					<-start
					attempt, err := owner.AcceptRoutingRelease(t.Context(), request)
					outcomes <- outcome{attempt, err}
				})
			}
			close(start)
			writers.Wait()
			close(outcomes)
			successes := 0
			var accepted *RoutingReleaseAttempt
			for outcome := range outcomes {
				if outcome.err != nil {
					require.False(t, sharedKey)
					require.ErrorIs(t, outcome.err, ErrRoutingReleaseConflict)
					require.Nil(t, outcome.attempt)
					continue
				}
				successes++
				if accepted == nil {
					accepted = outcome.attempt
				}
				require.Equal(t, *accepted, *outcome.attempt)
			}
			require.Equal(t, map[bool]int{false: 1, true: 4}[sharedKey], successes)
			requirePendingRoutingHead(t, store, accepted)
			require.Len(t, routingApplications(t, store), 2)
			require.Len(t, routingReleaseAudits(t, store), 5)
		})
	}
}

func TestRoutingRollbackMigrationDoesNotInventApplicationHistory(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 9}))
	applied := appliedRollbackFixture(t, store, "applied", 2)
	before := routingApplications(t, store)
	require.NoError(t, migrateRoutingReleaseApplications(cs.DB()))
	require.Equal(t, before, routingApplications(t, store), "replayed migration cannot replace a receipt")
	require.NoError(t, cs.DB().Migrator().DropTable(&RoutingReleaseApplication{}))
	for _, column := range []string{"operation", "rollback_of_epoch", "rollback_of_attempt"} {
		require.NoError(t, cs.DB().Migrator().DropColumn(&RoutingReleaseAttempt{}, column))
		require.False(t, cs.DB().Migrator().HasColumn(&RoutingReleaseAttempt{}, column))
	}
	require.NoError(t, cs.DB().Exec("DELETE FROM migrations WHERE id = ?",
		"elygate_control_plane_v15_routing_release_applications").Error)
	reopened, err := NewStore(t.Context(), cs)
	require.NoError(t, err)
	var preserved RoutingReleaseAttempt
	require.NoError(t, cs.DB().Where("id = ?", applied.ID).Take(&preserved).Error)
	preserved.CreatedAt = preserved.CreatedAt.UTC()
	require.Equal(t, *applied, preserved, "v14 attempt data and default publish provenance survive physical upgrade")
	require.Empty(t, routingApplications(t, reopened))
	rejected, err := reopened.InstallAcceptedRoutingRelease(t.Context(), applied.Epoch, rollbackTestCompiler, "retry")
	require.ErrorIs(t, err, ErrRoutingReleaseNotApplied)
	require.Nil(t, rejected)
	_, err = CheckRoutingPolicyStartup(t.Context(), cs, rollbackTestCompiler)
	require.ErrorIs(t, err, ErrRoutingReleaseNotApplied)
	require.Error(t, routingReleaseRollback(cs.DB()), "schema rollback cannot delete release evidence")
	require.Empty(t, routingApplications(t, reopened), "failed verification must not manufacture a missing receipt")
}

func TestRoutingRollbackSurvivesDatabaseReopen(t *testing.T) {
	config := &configstore.Config{Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "rollback.db")}}
	if socket := os.Getenv("ELYGATE_TEST_POSTGRES_SOCKET"); socket != "" {
		config = testPostgresControlPlaneConfig(t, socket)
	}
	var cs configstore.ConfigStore
	t.Cleanup(func() {
		if cs != nil {
			require.NoError(t, cs.Close(context.Background()))
		}
	})
	open := func() *Store {
		t.Helper()
		var err error
		cs, err = configstore.NewConfigStore(t.Context(), config, bifrost.NewDefaultLogger(schemas.LogLevelError))
		require.NoError(t, err)
		store, err := NewStore(t.Context(), cs)
		require.NoError(t, err)
		return store
	}
	store := open()
	require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 9}))
	first := appliedRollbackFixture(t, store, "first", 2)
	second := appliedRollbackFixture(t, store, "second", 3)
	request := rollbackRequest(first, second)
	accepted, err := store.AcceptRoutingRelease(t.Context(), request)
	require.NoError(t, err)
	require.NoError(t, cs.Close(t.Context()))
	cs = nil
	store = open()
	replayed, err := store.AcceptRoutingRelease(t.Context(), request)
	require.NoError(t, err)
	require.Equal(t, *accepted, *replayed)
	state, err := CheckRoutingPolicyStartup(t.Context(), cs, rollbackTestCompiler)
	require.ErrorIs(t, err, ErrRoutingPolicyNotReady)
	require.Nil(t, state.Policy, "pending rollback cannot boot as an active policy")
	_, err = store.InstallAcceptedRoutingRelease(t.Context(), accepted.Epoch, rollbackTestCompiler, "installer")
	require.NoError(t, err)
	expected := routingLiveFingerprint(t, cs)
	applications := routingApplications(t, store)
	audits := routingReleaseAudits(t, store)
	require.NoError(t, cs.Close(t.Context()))
	cs = nil
	store = open()
	state, err = CheckRoutingPolicyStartup(t.Context(), cs, rollbackTestCompiler)
	require.NoError(t, err)
	require.True(t, state.Managed)
	require.Equal(t, 2, state.Policy.ChainMaxDepth)
	require.Equal(t, expected, routingLiveFingerprint(t, cs))
	replayed, err = store.AcceptRoutingRelease(t.Context(), request)
	require.NoError(t, err)
	require.Equal(t, *accepted, *replayed)
	_, err = store.InstallAcceptedRoutingRelease(t.Context(), accepted.Epoch, rollbackTestCompiler, "retry")
	require.NoError(t, err)
	require.Equal(t, applications, routingApplications(t, store))
	require.Equal(t, audits, routingReleaseAudits(t, store))
}

func TestRoutingRollbackAcceptanceAuditFailureAndCancellation(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 9}))
	first := appliedRollbackFixture(t, store, "first", 2)
	second := appliedRollbackFixture(t, store, "second", 3)
	request := rollbackRequest(first, second)
	before, err := store.GetRoutingReleaseHead(t.Context())
	require.NoError(t, err)
	applications := routingApplications(t, store)
	audits := routingReleaseAudits(t, store)
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	rejected, err := store.AcceptRoutingRelease(cancelled, request)
	require.ErrorIs(t, err, context.Canceled)
	require.Nil(t, rejected)
	const callback = "test:rollback-accept-audit"
	require.NoError(t, cs.DB().Callback().Create().After("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			tx.AddError(errors.New("rollback audit rejected"))
		}
	}))
	t.Cleanup(func() { cs.DB().Callback().Create().Remove(callback) })
	rejected, err = store.AcceptRoutingRelease(t.Context(), request)
	require.ErrorContains(t, err, "rollback audit rejected")
	require.Nil(t, rejected)
	require.NoError(t, cs.DB().Callback().Create().Remove(callback))
	after, err := store.GetRoutingReleaseHead(t.Context())
	require.NoError(t, err)
	require.Equal(t, *before, *after)
	require.Equal(t, applications, routingApplications(t, store))
	require.Equal(t, audits, routingReleaseAudits(t, store))
	accepted, err := store.AcceptRoutingRelease(t.Context(), request)
	require.NoError(t, err, "confirmed rollback releases the key and epoch")
	requirePendingRoutingHead(t, store, accepted)
}

func TestRoutingRollbackCommitReceiptUncertain(t *testing.T) {
	// The same lost receipt can hide either a real commit or a real rollback.
	for _, commitWrites := range []bool{false, true} {
		t.Run(map[bool]string{false: "rolled-back", true: "committed"}[commitWrites], func(t *testing.T) {
			store, cs := testControlPlaneStore(t)
			require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 9}))
			first := appliedRollbackFixture(t, store, "first", 2)
			targetFingerprint := routingLiveFingerprint(t, cs)
			second := appliedRollbackFixture(t, store, "second", 3)
			previousFingerprint := routingLiveFingerprint(t, cs)
			accepted, err := store.AcceptRoutingRelease(t.Context(), rollbackRequest(first, second))
			require.NoError(t, err)
			sqlDB, err := cs.DB().DB()
			require.NoError(t, err)
			receiptErr := errors.New("rollback commit receipt lost")
			pool := &routingInstallationFaultPool{DB: sqlDB, commitWrites: commitWrites, commitErr: receiptErr}
			injected := routingInstallationWithPool(t, store, pool)
			installed, err := injected.InstallAcceptedRoutingRelease(t.Context(), accepted.Epoch, rollbackTestCompiler, "installer")
			require.ErrorIs(t, err, ErrRoutingInstallationUncertain)
			require.ErrorIs(t, err, receiptErr)
			require.Nil(t, installed, "an ambiguous outcome cannot be handed to a serving generation")
			require.Equal(t, 1, pool.commitAttempts)
			require.Zero(t, pool.rollbacks, "never guess a failed commit outcome by issuing rollback")
			if commitWrites {
				require.Equal(t, targetFingerprint, routingLiveFingerprint(t, cs))
				require.Len(t, routingApplications(t, store), 3)
				require.Len(t, routingReleaseAudits(t, store), 6)
			} else {
				require.Equal(t, previousFingerprint, routingLiveFingerprint(t, cs))
				requirePendingRoutingHead(t, store, accepted)
				require.Len(t, routingApplications(t, store), 2)
				require.Len(t, routingReleaseAudits(t, store), 5)
			}
			replayed, err := store.InstallAcceptedRoutingRelease(t.Context(), accepted.Epoch, rollbackTestCompiler, "recovery")
			require.NoError(t, err)
			require.True(t, replayed.Head.IsApplied())
			require.Equal(t, targetFingerprint, routingLiveFingerprint(t, cs))
			require.Len(t, routingApplications(t, store), 3)
			require.Len(t, routingReleaseAudits(t, store), 6)
		})
	}
}
