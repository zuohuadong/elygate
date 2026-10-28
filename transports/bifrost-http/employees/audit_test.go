package employees

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type employeeTestAudit struct {
	ID         uint `gorm:"primaryKey"`
	Action     string
	ResourceID string
	Snapshot   string
}

func auditedTestStore(t testing.TB, store *Store, fail *bool) *Store {
	t.Helper()
	require.NoError(t, store.db(context.Background()).AutoMigrate(&employeeTestAudit{}))
	return &Store{configStore: store.configStore, auditAppender: func(ctx context.Context, tx *gorm.DB, event EmployeeAuditEvent) error {
		snapshot, err := json.Marshal(event)
		if err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Create(&employeeTestAudit{
			Action: event.Action, ResourceID: event.ResourceID, Snapshot: string(snapshot),
		}).Error; err != nil {
			return err
		}
		if *fail {
			return errors.New("forced audit failure after insert")
		}
		return nil
	}}
}

func employeeAuditRows(t testing.TB, store *Store) []employeeTestAudit {
	t.Helper()
	var rows []employeeTestAudit
	require.NoError(t, store.db(context.Background()).Order("id").Find(&rows).Error)
	return rows
}

func TestEmployeePasswordChangeAuditIsAtomic(t *testing.T) {
	store, _ := passwordTestStore(t)
	ctx := context.Background()
	employee := &Employee{Username: "change.audit", Name: "Change", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
	lockedUntil := time.Now().Add(time.Hour)
	require.NoError(t, store.db(ctx).Model(employee).Updates(map[string]any{
		"failed_login_count": 3, "locked_until": lockedUntil,
	}).Error)
	for _, token := range []string{"change-retained", "change-other"} {
		require.NoError(t, store.CreateSession(ctx, employee.ID, token, "change-csrf-hash", time.Now().Add(time.Hour)))
	}
	fail := true
	audited := auditedTestStore(t, store, &fail)
	change := PasswordChange{
		EmployeeID: employee.ID, VerifiedPasswordHash: employee.PasswordHash,
		NewPassword: "ReplacementPassword!123", KeepTokenHash: "change-retained",
	}
	require.ErrorIs(t, audited.ChangePassword(ctx, change), ErrEmployeeAudit)
	current, err := store.Get(ctx, employee.ID)
	require.NoError(t, err)
	require.Equal(t, employee.PasswordHash, current.PasswordHash)
	require.True(t, current.MustChangePassword)
	require.Equal(t, 3, current.FailedLoginCount)
	require.NotNil(t, current.LockedUntil)
	for _, token := range []string{"change-retained", "change-other"} {
		_, _, err := store.Session(ctx, token)
		require.NoError(t, err)
	}
	require.Empty(t, employeeAuditRows(t, store))

	fail = false
	require.NoError(t, audited.ChangePassword(ctx, change))
	current, err = store.Get(ctx, employee.ID)
	require.NoError(t, err)
	matched, err := encrypt.CompareHash(current.PasswordHash, change.NewPassword)
	require.NoError(t, err)
	require.True(t, matched)
	require.False(t, current.MustChangePassword)
	require.Zero(t, current.FailedLoginCount)
	require.Nil(t, current.LockedUntil)
	_, _, err = store.Session(ctx, change.KeepTokenHash)
	require.NoError(t, err)
	_, _, err = store.Session(ctx, "change-other")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	rows := employeeAuditRows(t, store)
	require.Len(t, rows, 1)
	require.Equal(t, "employee.password_changed", rows[0].Action)
	require.Equal(t, employee.ID, rows[0].ResourceID)
	for _, secret := range []string{"OriginalPassword!123", change.NewPassword, employee.PasswordHash, current.PasswordHash, change.KeepTokenHash, "change-csrf-hash"} {
		require.NotContains(t, rows[0].Snapshot, secret)
	}
}

func TestEmployeePasswordChangeRejectsStaleState(t *testing.T) {
	// Cases cover stale/empty hashes, missing/inactive employees and missing,
	// empty, expired, revoked or foreign retained sessions.
	for _, scenario := range []string{"stale_hash", "empty_hash", "missing_employee", "inactive_employee", "missing_session", "empty_session", "expired_session", "expired_west_offset", "expired_east_offset", "expired_utc_offset", "revoked_session", "foreign_session"} {
		t.Run(scenario, func(t *testing.T) {
			store, _ := passwordTestStore(t)
			ctx := context.Background()
			employee := &Employee{Username: "change.stale", Name: "Stale", IsActive: true}
			require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
			for _, token := range []string{"stale-retained", "stale-other"} {
				require.NoError(t, store.CreateSession(ctx, employee.ID, token, "stale-csrf", time.Now().Add(time.Hour)))
			}
			change := PasswordChange{
				EmployeeID: employee.ID, VerifiedPasswordHash: employee.PasswordHash,
				NewPassword: "ReplacementPassword!123", KeepTokenHash: "stale-retained",
			}
			switch scenario {
			case "stale_hash":
				change.VerifiedPasswordHash = "no-longer-the-verified-hash"
			case "empty_hash":
				change.VerifiedPasswordHash = ""
			case "missing_employee":
				change.EmployeeID = "missing-employee"
			case "inactive_employee":
				require.NoError(t, store.db(ctx).Model(employee).Update("is_active", false).Error)
			case "missing_session":
				change.KeepTokenHash = "missing-session"
			case "empty_session":
				change.KeepTokenHash = ""
			case "expired_session":
				require.NoError(t, store.db(ctx).Model(&EmployeeSession{}).Where("token_hash = ?", change.KeepTokenHash).Update("expires_at", time.Now().Add(-time.Second)).Error)
			case "expired_west_offset", "expired_east_offset", "expired_utc_offset":
				expired := time.Now().Add(-time.Hour)
				switch scenario {
				case "expired_west_offset":
					expired = expired.In(time.FixedZone("west", -12*60*60))
				case "expired_east_offset":
					expired = expired.In(time.FixedZone("east", 14*60*60))
				default:
					expired = expired.UTC()
				}
				require.NoError(t, store.db(ctx).Model(&EmployeeSession{}).Where("token_hash = ?", change.KeepTokenHash).Update("expires_at", expired).Error)
			case "revoked_session":
				require.NoError(t, store.DeleteSession(ctx, change.KeepTokenHash))
			case "foreign_session":
				other := &Employee{Username: "change.foreign", Name: "Foreign", IsActive: true}
				require.NoError(t, store.Create(ctx, other, "UnrelatedPassword!123", nil))
				require.NoError(t, store.CreateSession(ctx, other.ID, "foreign-session", "foreign-csrf", time.Now().Add(time.Hour)))
				change.KeepTokenHash = "foreign-session"
			}
			fail := false
			audited := auditedTestStore(t, store, &fail)
			require.ErrorIs(t, audited.ChangePassword(ctx, change), ErrEmployeeCredentialsChanged)
			current, err := store.Get(ctx, employee.ID)
			require.NoError(t, err)
			require.Equal(t, employee.PasswordHash, current.PasswordHash)
			require.True(t, current.MustChangePassword)
			require.Empty(t, employeeAuditRows(t, store))
			_, _, err = store.Session(ctx, "stale-other")
			require.NoError(t, err, "rejected change must not revoke another session")
		})
	}
}

func TestEmployeePasswordChangeAcceptsFutureRetainedSessionOffsets(t *testing.T) {
	for _, zone := range []*time.Location{
		time.Local,
		time.UTC,
		time.FixedZone("east", 14*60*60),
		time.FixedZone("west", -12*60*60),
	} {
		t.Run(zone.String(), func(t *testing.T) {
			store, _ := passwordTestStore(t)
			ctx := context.Background()
			employee := &Employee{Username: "change.future", Name: "Future", IsActive: true}
			require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
			future := time.Now().Add(time.Hour).In(zone)
			require.NoError(t, store.CreateSession(ctx, employee.ID, "future-retained", "future-csrf", future))
			require.NoError(t, store.CreateSession(ctx, employee.ID, "future-other", "future-csrf", future))
			fail := false
			audited := auditedTestStore(t, store, &fail)
			require.NoError(t, audited.ChangePassword(ctx, PasswordChange{
				EmployeeID: employee.ID, VerifiedPasswordHash: employee.PasswordHash,
				NewPassword: "ReplacementPassword!123", KeepTokenHash: "future-retained",
			}))
			_, _, err := store.Session(ctx, "future-retained")
			require.NoError(t, err)
			_, _, err = store.Session(ctx, "future-other")
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
			require.Len(t, employeeAuditRows(t, store), 1)
		})
	}
}

func TestEmployeePasswordExpirySQLTextComparisonRegression(t *testing.T) {
	// Fixed instants reproduce both old-predicate errors without changing
	// process-global time.Local or relying on the host's timezone.
	store, _ := testStore(t)
	ctx := context.Background()
	employee := &Employee{Username: "change.offset", Name: "Offset", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
	now := time.Date(2026, time.October, 27, 12, 0, 0, 0, time.UTC)
	for _, scenario := range []struct {
		name    string
		expires time.Time
		valid   bool
	}{
		{"future_west", now.Add(time.Hour).In(time.FixedZone("west", -12*60*60)), true},
		{"expired_east", now.Add(-time.Hour).In(time.FixedZone("east", 14*60*60)), false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			require.NoError(t, store.CreateSession(ctx, employee.ID, scenario.name, "offset-csrf", scenario.expires))
			var session EmployeeSession
			require.NoError(t, store.db(ctx).First(&session, "token_hash = ?", scenario.name).Error)
			require.Equal(t, scenario.valid, session.ExpiresAt.After(now))
			var oldMatches int64
			require.NoError(t, store.db(ctx).Model(&EmployeeSession{}).
				Where("employee_id = ? AND token_hash = ? AND expires_at > ?", employee.ID, scenario.name, now).
				Count(&oldMatches).Error)
			require.NotEqual(t, scenario.valid, oldMatches == 1, "the former SQL predicate must reproduce the instant mismatch")
		})
	}
}

func TestEmployeePasswordChangeConcurrentRequestsHaveOneWinner(t *testing.T) {
	store, _ := passwordTestStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	employee := &Employee{Username: "change.concurrent", Name: "Concurrent", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
	for _, token := range []string{"concurrent-one", "concurrent-two"} {
		require.NoError(t, store.CreateSession(ctx, employee.ID, token, "concurrent-csrf", time.Now().Add(time.Hour)))
	}
	fail := false
	audited := auditedTestStore(t, store, &fail)
	type attempt struct {
		change PasswordChange
		err    error
	}
	attempts := make(chan attempt, 2)
	start := make(chan struct{})
	for _, token := range []string{"concurrent-one", "concurrent-two"} {
		go func(token string) {
			<-start
			change := PasswordChange{
				EmployeeID: employee.ID, VerifiedPasswordHash: employee.PasswordHash,
				NewPassword: "ReplacementPassword!" + token, KeepTokenHash: token,
			}
			attempts <- attempt{change: change, err: audited.ChangePassword(ctx, change)}
		}(token)
	}
	close(start)
	var winner PasswordChange
	for range 2 {
		outcome := <-attempts
		if outcome.err == nil {
			require.Empty(t, winner.EmployeeID, "only one change may commit using a verified hash")
			winner = outcome.change
		} else {
			require.ErrorIs(t, outcome.err, ErrEmployeeCredentialsChanged)
		}
	}
	require.NotEmpty(t, winner.EmployeeID)
	current, err := store.Get(ctx, employee.ID)
	require.NoError(t, err)
	matched, err := encrypt.CompareHash(current.PasswordHash, winner.NewPassword)
	require.NoError(t, err)
	require.True(t, matched)
	var sessions []EmployeeSession
	require.NoError(t, store.db(ctx).Where("employee_id = ?", employee.ID).Find(&sessions).Error)
	require.Len(t, sessions, 1)
	require.Equal(t, winner.KeepTokenHash, sessions[0].TokenHash)
	require.Len(t, employeeAuditRows(t, store), 1)
}

func TestEmployeePasswordChangeCommitFailureRollsBack(t *testing.T) {
	store, _ := passwordTestStore(t)
	ctx := context.Background()
	employee := &Employee{Username: "change.commit", Name: "Commit", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
	for _, token := range []string{"commit-retained", "commit-other"} {
		require.NoError(t, store.CreateSession(ctx, employee.ID, token, "commit-csrf", time.Now().Add(time.Hour)))
	}
	fail := false
	audited := auditedTestStore(t, store, &fail)
	mutationCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	appendAudit := audited.auditAppender
	appended := false
	audited.auditAppender = func(ctx context.Context, tx *gorm.DB, event EmployeeAuditEvent) error {
		if err := appendAudit(ctx, tx, event); err != nil {
			return err
		}
		appended = true
		// Return nil after cancellation so the error comes from the real Commit,
		// not from the mutation/appender callback's error path.
		cancel()
		return nil
	}
	err := audited.ChangePassword(mutationCtx, PasswordChange{
		EmployeeID: employee.ID, VerifiedPasswordHash: employee.PasswordHash,
		NewPassword: "ReplacementPassword!123", KeepTokenHash: "commit-retained",
	})
	require.True(t, appended)
	require.Error(t, err)
	require.True(t, errors.Is(err, context.Canceled) || errors.Is(err, sql.ErrTxDone), "commit must fail after context cancellation")
	assertPasswordAndSessionsUnchanged(t, store, employee, []string{"commit-retained", "commit-other"})
}

func assertPasswordAndSessionsUnchanged(t *testing.T, store *Store, employee *Employee, tokens []string) {
	t.Helper()
	ctx := context.Background()
	current, err := store.Get(ctx, employee.ID)
	require.NoError(t, err)
	require.Equal(t, employee.PasswordHash, current.PasswordHash)
	require.True(t, current.MustChangePassword)
	for _, token := range tokens {
		_, _, err := store.Session(ctx, token)
		require.NoError(t, err)
	}
	require.Empty(t, employeeAuditRows(t, store))
}

func TestEmployeePasswordChangeRollbackAndSuccessSurviveReopen(t *testing.T) {
	ctx := context.Background()
	cfg := &configstore.Config{
		Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "password-reopen.db")},
	}
	openStore := func() *Store {
		cs, err := configstore.NewConfigStore(ctx, cfg, bifrost.NewDefaultLogger(schemas.LogLevelError))
		require.NoError(t, err)
		store, err := NewStore(ctx, cs)
		require.NoError(t, err)
		return store
	}
	store := openStore()
	t.Cleanup(func() { require.NoError(t, store.configStore.Close(ctx)) })
	employee := &Employee{Username: "change.reopen", Name: "Reopen", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
	for _, token := range []string{"reopen-retained", "reopen-other"} {
		require.NoError(t, store.CreateSession(ctx, employee.ID, token, "reopen-csrf", time.Now().Add(time.Hour)))
	}
	fail := false
	audited := auditedTestStore(t, store, &fail)
	mutationCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	appendAudit := audited.auditAppender
	audited.auditAppender = func(ctx context.Context, tx *gorm.DB, event EmployeeAuditEvent) error {
		if err := appendAudit(ctx, tx, event); err != nil {
			return err
		}
		cancel()
		return nil
	}
	change := PasswordChange{
		EmployeeID: employee.ID, VerifiedPasswordHash: employee.PasswordHash,
		NewPassword: "ReplacementPassword!123", KeepTokenHash: "reopen-retained",
	}
	require.Error(t, audited.ChangePassword(mutationCtx, change))
	require.NoError(t, store.configStore.Close(ctx))
	store = openStore()
	assertPasswordAndSessionsUnchanged(t, store, employee, []string{"reopen-retained", "reopen-other"})

	audited = auditedTestStore(t, store, &fail)
	require.NoError(t, audited.ChangePassword(ctx, change))
	require.NoError(t, store.configStore.Close(ctx))
	store = openStore()
	current, err := store.Get(ctx, employee.ID)
	require.NoError(t, err)
	matched, err := encrypt.CompareHash(current.PasswordHash, change.NewPassword)
	require.NoError(t, err)
	require.True(t, matched)
	require.False(t, current.MustChangePassword)
	_, _, err = store.Session(ctx, change.KeepTokenHash)
	require.NoError(t, err)
	_, _, err = store.Session(ctx, "reopen-other")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	require.Len(t, employeeAuditRows(t, store), 1)
}

func BenchmarkEmployeePasswordChange(b *testing.B) {
	for _, mode := range []string{"previous_split_no_audit", "transactional_audited"} {
		b.Run(mode, func(b *testing.B) {
			store, _ := testStore(b)
			ctx := context.Background()
			employee := &Employee{Username: "change.benchmark", Name: "Benchmark", IsActive: true}
			require.NoError(b, store.Create(ctx, employee, "OriginalPassword!123", nil))
			require.NoError(b, store.CreateSession(ctx, employee.ID, "benchmark-retained", "benchmark-csrf", time.Now().Add(time.Hour)))
			fail := false
			audited := auditedTestStore(b, store, &fail)
			change := PasswordChange{
				EmployeeID: employee.ID, NewPassword: "ReplacementPassword!123", KeepTokenHash: "benchmark-retained",
			}
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				b.StopTimer()
				current, err := store.Get(ctx, employee.ID)
				require.NoError(b, err)
				change.VerifiedPasswordHash = current.PasswordHash
				require.NoError(b, store.CreateSession(ctx, employee.ID, "benchmark-other", "benchmark-csrf", time.Now().Add(time.Hour)))
				b.StartTimer()
				if mode == "transactional_audited" {
					require.NoError(b, audited.ChangePassword(ctx, change))
				} else {
					require.NoError(b, previousSplitPasswordChange(ctx, store, change))
				}
			}
		})
	}
}

// Reproduce the previous two independent writes for the cost comparison only.
// Both benchmarks include new-password hashing; HTTP/current-password checks,
// fixture insertion, migrations and setup reads are outside the timer.
func previousSplitPasswordChange(ctx context.Context, store *Store, change PasswordChange) error {
	hash, err := encrypt.Hash(change.NewPassword)
	if err != nil {
		return err
	}
	if err := store.db(ctx).Model(&Employee{}).Where("id = ?", change.EmployeeID).Updates(map[string]any{
		"password_hash": hash, "must_change_password": false,
		"failed_login_count": 0, "locked_until": nil,
	}).Error; err != nil {
		return err
	}
	return store.db(ctx).Where("employee_id = ? AND token_hash <> ?", change.EmployeeID, change.KeepTokenHash).Delete(&EmployeeSession{}).Error
}

func TestEmployeeAuditCreateRollsBackEmployeeAndAssignment(t *testing.T) {
	store, configStore := testStore(t)
	seedVirtualKey(t, configStore, "vk-audit-create", "sk-bf-audit-create-secret")
	fail := true
	audited := auditedTestStore(t, store, &fail)
	ctx := context.Background()
	employee := &Employee{Username: "audit.create", Name: "Created", IsActive: true}
	const password = "StrongPassword!123"
	err := audited.Create(ctx, employee, password, []string{"vk-audit-create"})
	require.ErrorIs(t, err, ErrEmployeeAudit)
	_, err = store.Get(ctx, employee.ID)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	assignments, err := store.AssignmentIDs(ctx, employee.ID)
	require.NoError(t, err)
	require.Empty(t, assignments)
	require.Empty(t, employeeAuditRows(t, store))

	fail = false
	require.NoError(t, audited.Create(ctx, employee, password, []string{"vk-audit-create"}))
	rows := employeeAuditRows(t, store)
	require.Len(t, rows, 1)
	require.Equal(t, "employee.create", rows[0].Action)
	require.Equal(t, employee.ID, rows[0].ResourceID)
	require.NotContains(t, rows[0].Snapshot, password)
	require.NotContains(t, rows[0].Snapshot, employee.PasswordHash)
	require.NotContains(t, rows[0].Snapshot, "sk-bf-audit-create-secret")
}

func TestEmployeeAuditUpdateAndResetRollBackSessionsAndCredentials(t *testing.T) {
	for _, action := range []string{"update", "password_reset"} {
		t.Run(action, func(t *testing.T) {
			store, configStore := testStore(t)
			seedVirtualKey(t, configStore, "vk-audit-update", "sk-bf-audit-update")
			ctx := context.Background()
			employee := &Employee{Username: "audit.update", Name: "Before", IsActive: true}
			require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", []string{"vk-audit-update"}))
			originalHash := employee.PasswordHash
			require.NoError(t, store.CreateSession(ctx, employee.ID, "audit-token", "audit-csrf", time.Now().Add(time.Hour)))
			fail := true
			audited := auditedTestStore(t, store, &fail)
			mutate := func() error {
				if action == "password_reset" {
					return audited.ResetPassword(ctx, employee.ID, "ReplacementPassword!123")
				}
				changed := *employee
				changed.Name, changed.IsActive = "After", false
				return audited.Update(ctx, &changed, []string{"vk-audit-update"})
			}
			require.ErrorIs(t, mutate(), ErrEmployeeAudit)
			current, err := store.Get(ctx, employee.ID)
			require.NoError(t, err)
			require.Equal(t, "Before", current.Name)
			require.True(t, current.IsActive)
			require.Equal(t, originalHash, current.PasswordHash)
			_, _, err = store.Session(ctx, "audit-token")
			require.NoError(t, err, "audit failure must restore revoked sessions")
			require.Empty(t, employeeAuditRows(t, store))

			fail = false
			require.NoError(t, mutate())
			_, _, err = store.Session(ctx, "audit-token")
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
			rows := employeeAuditRows(t, store)
			require.Len(t, rows, 1)
			require.Equal(t, "employee."+action, rows[0].Action)
			require.NotContains(t, rows[0].Snapshot, originalHash)
			require.NotContains(t, rows[0].Snapshot, "ReplacementPassword!123")
			current, err = store.Get(ctx, employee.ID)
			require.NoError(t, err)
			if action == "update" {
				require.False(t, current.IsActive)
				require.Contains(t, rows[0].Snapshot, `"Before":{"is_active":true,"name":"Before"`)
				require.Contains(t, rows[0].Snapshot, `"After":{"is_active":false,"name":"After"`)
			} else {
				matched, err := encrypt.CompareHash(current.PasswordHash, "ReplacementPassword!123")
				require.NoError(t, err)
				require.True(t, matched)
			}
		})
	}
}

func TestEmployeeAuditImportAndRollbackAreAtomicAndIdempotent(t *testing.T) {
	store, configStore := testStore(t)
	seedVirtualKey(t, configStore, "vk-audit-import", "sk-bf-audit-import")
	ctx := context.Background()
	entry := BulkCreateEntry{
		Employee: &Employee{Username: "audit.import", Name: "Import", IsActive: true},
		Password: "StrongPassword!123", VirtualKeyIDs: []string{"vk-audit-import"},
	}
	fail := true
	audited := auditedTestStore(t, store, &fail)
	const batchID = "batch-audit-import"
	_, err := audited.BulkCreateImport(ctx, batchID, "digest", []BulkCreateEntry{entry})
	require.ErrorIs(t, err, ErrEmployeeAudit)
	var batch EmployeeImportBatch
	require.ErrorIs(t, store.db(ctx).First(&batch, "id = ?", batchID).Error, gorm.ErrRecordNotFound)
	employees, err := store.List(ctx)
	require.NoError(t, err)
	require.Empty(t, employees)
	require.Empty(t, employeeAuditRows(t, store))

	fail = false
	already, err := audited.BulkCreateImport(ctx, batchID, "digest", []BulkCreateEntry{entry})
	require.NoError(t, err)
	require.False(t, already)
	require.NoError(t, store.CreateSession(ctx, entry.Employee.ID, "import-token", "import-csrf", time.Now().Add(time.Hour)))
	fail = true
	already, err = audited.BulkCreateImport(ctx, batchID, "digest", []BulkCreateEntry{entry})
	require.NoError(t, err, "replay must not attempt another audit write")
	require.True(t, already)
	require.Len(t, employeeAuditRows(t, store), 1)

	_, err = audited.RollbackImport(ctx, batchID)
	require.ErrorIs(t, err, ErrEmployeeAudit)
	require.NoError(t, store.db(ctx).First(&batch, "id = ?", batchID).Error)
	require.Nil(t, batch.RolledBackAt)
	current, err := store.Get(ctx, entry.Employee.ID)
	require.NoError(t, err)
	require.True(t, current.IsActive)
	_, _, err = store.Session(ctx, "import-token")
	require.NoError(t, err)
	require.Len(t, employeeAuditRows(t, store), 1)

	fail = false
	disabled, err := audited.RollbackImport(ctx, batchID)
	require.NoError(t, err)
	require.EqualValues(t, 1, disabled)
	_, _, err = store.Session(ctx, "import-token")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	fail = true
	disabled, err = audited.RollbackImport(ctx, batchID)
	require.NoError(t, err)
	require.Zero(t, disabled)
	rows := employeeAuditRows(t, store)
	require.Len(t, rows, 2)
	require.Equal(t, "employee.import", rows[0].Action)
	require.Equal(t, "employee.import_rollback", rows[1].Action)
}
