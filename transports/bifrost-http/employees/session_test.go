package employees

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func sessionLoginFixture(t testing.TB, store *Store) (*Employee, SessionLogin) {
	t.Helper()
	employee := &Employee{Username: "session.fixture", Name: "Session", IsActive: true}
	require.NoError(t, store.Create(context.Background(), employee, "OriginalPassword!123", nil))
	return employee, SessionLogin{
		EmployeeID: employee.ID, VerifiedPasswordHash: employee.PasswordHash,
		TokenHash: "session-token-hash", CSRFTokenHash: "session-csrf-hash", ExpiresAt: time.Now().Add(time.Hour),
	}
}

func sessionRows(t testing.TB, store *Store) []EmployeeSession {
	t.Helper()
	var sessions []EmployeeSession
	require.NoError(t, store.db(context.Background()).Order("id").Find(&sessions).Error)
	return sessions
}

func TestEmployeeSessionLoginAtomicFailuresAndSuccess(t *testing.T) {
	for _, scenario := range []string{"audit", "state_query", "metadata", "insert", "commit", "success", "expired_utc"} {
		t.Run(scenario, func(t *testing.T) {
			store, _ := passwordTestStore(t)
			ctx := context.Background()
			employee, login := sessionLoginFixture(t, store)
			expiredLock := time.Now().Add(-time.Hour)
			if scenario == "expired_utc" {
				expiredLock = expiredLock.UTC()
			}
			require.NoError(t, store.db(ctx).Model(employee).Updates(map[string]any{
				"failed_login_count": 3, "locked_until": expiredLock,
			}).Error)
			before, err := store.Get(ctx, employee.ID)
			require.NoError(t, err)
			fail := scenario == "audit"
			audited := auditedTestStore(t, store, &fail)
			mutationCtx, cancel := context.WithCancel(ctx)
			defer cancel()
			auditReached := false
			appendAudit := audited.auditAppender
			audited.auditAppender = func(ctx context.Context, tx *gorm.DB, event EmployeeAuditEvent) error {
				auditReached = true
				if err := appendAudit(ctx, tx, event); err != nil {
					return err
				}
				if scenario == "commit" {
					cancel()
				}
				return nil
			}
			if scenario == "state_query" {
				require.NoError(t, store.db(ctx).Callback().Query().Before("gorm:query").Register("session-state-error", func(tx *gorm.DB) {
					if len(tx.Statement.Selects) == 1 && tx.Statement.Selects[0] == "locked_until" {
						tx.AddError(errors.New("private state_query diagnostic"))
					}
				}))
				t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Query().Remove("session-state-error")) })
			}
			if scenario == "metadata" {
				require.NoError(t, store.db(ctx).Callback().Update().Before("gorm:update").Register("session-metadata-error", func(tx *gorm.DB) {
					updates, ok := tx.Statement.Dest.(map[string]any)
					if _, metadata := updates["last_login_at"]; ok && tx.Statement.Table == (Employee{}).TableName() && metadata {
						tx.AddError(errors.New("private metadata diagnostic"))
					}
				}))
				t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Update().Remove("session-metadata-error")) })
			}
			if scenario == "insert" {
				require.NoError(t, store.db(ctx).Callback().Create().Before("gorm:create").Register("session-insert-error", func(tx *gorm.DB) {
					if tx.Statement.Table == (EmployeeSession{}).TableName() {
						tx.AddError(errors.New("private insert diagnostic"))
					}
				}))
				t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Create().Remove("session-insert-error")) })
			}
			err = audited.LoginSession(mutationCtx, login)
			current, readErr := store.Get(ctx, employee.ID)
			require.NoError(t, readErr)
			if scenario != "success" && scenario != "expired_utc" {
				require.Error(t, err)
				require.Equal(t, before.PasswordHash, current.PasswordHash)
				require.Equal(t, before.LastLoginAt, current.LastLoginAt)
				require.Equal(t, before.UpdatedAt, current.UpdatedAt)
				require.Equal(t, before.FailedLoginCount, current.FailedLoginCount)
				require.Equal(t, before.LockedUntil, current.LockedUntil)
				require.Empty(t, sessionRows(t, store))
				require.Empty(t, employeeAuditRows(t, store))
				if scenario == "audit" {
					require.ErrorIs(t, err, ErrEmployeeAudit)
				}
				if scenario == "state_query" || scenario == "metadata" || scenario == "insert" {
					require.ErrorContains(t, err, "private "+scenario+" diagnostic")
				}
				if scenario == "commit" {
					require.True(t, auditReached)
					require.True(t, errors.Is(err, context.Canceled) || errors.Is(err, sql.ErrTxDone))
				}
				return
			}
			require.NoError(t, err)
			require.NotNil(t, current.LastLoginAt)
			require.Zero(t, current.FailedLoginCount)
			require.Nil(t, current.LockedUntil)
			sessions := sessionRows(t, store)
			require.Len(t, sessions, 1)
			require.Equal(t, login.TokenHash, sessions[0].TokenHash)
			rows := employeeAuditRows(t, store)
			require.Len(t, rows, 1)
			require.Equal(t, "employee_session.created", rows[0].Action)
			require.Equal(t, sessions[0].ID, rows[0].ResourceID)
			require.Contains(t, rows[0].Snapshot, "employee-password")
			for _, secret := range []string{"OriginalPassword!123", employee.PasswordHash, login.TokenHash, login.CSRFTokenHash} {
				require.NotContains(t, rows[0].Snapshot, secret)
			}
		})
	}
}

func TestEmployeeSessionLoginRejectsChangedCredentialsAndState(t *testing.T) {
	// Empty/stale hash, missing employee, inactive and currently locked accounts
	// must all leave metadata, sessions and audit untouched.
	for _, scenario := range []string{"stale_hash", "empty_hash", "missing_employee", "inactive", "locked", "locked_utc"} {
		t.Run(scenario, func(t *testing.T) {
			store, _ := passwordTestStore(t)
			ctx := context.Background()
			employee, login := sessionLoginFixture(t, store)
			switch scenario {
			case "stale_hash":
				login.VerifiedPasswordHash = "stale-hash"
			case "empty_hash":
				login.VerifiedPasswordHash = ""
			case "missing_employee":
				login.EmployeeID = "missing"
			case "inactive":
				require.NoError(t, store.db(ctx).Model(employee).Update("is_active", false).Error)
			case "locked":
				require.NoError(t, store.db(ctx).Model(employee).Update("locked_until", time.Now().Add(time.Hour)).Error)
			case "locked_utc":
				require.NoError(t, store.db(ctx).Model(employee).Update("locked_until", time.Now().UTC().Add(time.Hour)).Error)
			}
			before, err := store.Get(ctx, employee.ID)
			require.NoError(t, err)
			fail := false
			audited := auditedTestStore(t, store, &fail)
			require.ErrorIs(t, audited.LoginSession(ctx, login), ErrEmployeeCredentialsChanged)
			current, err := store.Get(ctx, employee.ID)
			require.NoError(t, err)
			require.Equal(t, before, current)
			require.Empty(t, sessionRows(t, store))
			require.Empty(t, employeeAuditRows(t, store))
		})
	}
}

func TestEmployeeSessionLogoutAtomicFailuresAndSuccess(t *testing.T) {
	for _, scenario := range []string{"audit", "employee_lock", "query", "delete", "commit", "success"} {
		t.Run(scenario, func(t *testing.T) {
			store, _ := passwordTestStore(t)
			ctx := context.Background()
			employee, login := sessionLoginFixture(t, store)
			require.NoError(t, store.CreateSession(ctx, employee.ID, login.TokenHash, login.CSRFTokenHash, login.ExpiresAt))
			require.NoError(t, store.CreateSession(ctx, employee.ID, "other-token", "other-csrf", login.ExpiresAt))
			snapshot, _, err := store.Session(ctx, login.TokenHash)
			require.NoError(t, err)
			before, err := store.Get(ctx, employee.ID)
			require.NoError(t, err)
			fail := scenario == "audit"
			audited := auditedTestStore(t, store, &fail)
			mutationCtx, cancel := context.WithCancel(ctx)
			defer cancel()
			appended := false
			appendAudit := audited.auditAppender
			audited.auditAppender = func(ctx context.Context, tx *gorm.DB, event EmployeeAuditEvent) error {
				if err := appendAudit(ctx, tx, event); err != nil {
					return err
				}
				appended = true
				if scenario == "commit" {
					cancel()
				}
				return nil
			}
			if scenario == "employee_lock" {
				require.NoError(t, store.db(ctx).Callback().Update().Before("gorm:update").Register("logout-lock-error", func(tx *gorm.DB) {
					if tx.Statement.Table == (Employee{}).TableName() {
						tx.AddError(errors.New("private lock diagnostic"))
					}
				}))
				t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Update().Remove("logout-lock-error")) })
			}
			if scenario == "query" {
				require.NoError(t, store.db(ctx).Callback().Query().Before("gorm:query").Register("logout-query-error", func(tx *gorm.DB) {
					if tx.Statement.Table == (EmployeeSession{}).TableName() {
						tx.AddError(errors.New("private query diagnostic"))
					}
				}))
				t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Query().Remove("logout-query-error")) })
			}
			if scenario == "delete" {
				require.NoError(t, store.db(ctx).Callback().Delete().Before("gorm:delete").Register("logout-delete-error", func(tx *gorm.DB) {
					tx.AddError(errors.New("private delete diagnostic"))
				}))
				t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Delete().Remove("logout-delete-error")) })
			}
			err = audited.LogoutSession(mutationCtx, *snapshot)
			if scenario == "query" {
				require.NoError(t, store.db(ctx).Callback().Query().Remove("logout-query-error"))
			}
			current, readErr := store.Get(ctx, employee.ID)
			require.NoError(t, readErr)
			require.Equal(t, before, current, "logout must not change employee timestamps or metadata")
			if scenario != "success" {
				require.Error(t, err)
				require.Len(t, sessionRows(t, store), 2)
				require.Empty(t, employeeAuditRows(t, store))
				if scenario == "commit" {
					require.True(t, appended)
					require.True(t, errors.Is(err, context.Canceled) || errors.Is(err, sql.ErrTxDone))
				}
				return
			}
			require.NoError(t, err)
			sessions := sessionRows(t, store)
			require.Len(t, sessions, 1)
			require.Equal(t, "other-token", sessions[0].TokenHash)
			require.NoError(t, audited.LogoutSession(ctx, *snapshot), "repeated authenticated snapshot is idempotent")
			rows := employeeAuditRows(t, store)
			require.Len(t, rows, 1)
			require.Equal(t, "employee_session.deleted", rows[0].Action)
			require.Equal(t, snapshot.ID, rows[0].ResourceID)
			for _, secret := range []string{login.TokenHash, login.CSRFTokenHash, employee.PasswordHash, "other-token"} {
				require.NotContains(t, rows[0].Snapshot, secret)
			}
		})
	}
}

func TestEmployeeSessionLogoutSnapshotMatchingAndExpiry(t *testing.T) {
	// Only an exact authenticated snapshot deletes a row. Expiry after earlier
	// authentication is allowed; a mismatched ID, employee or token is a no-op.
	for _, scenario := range []string{"id", "employee", "token", "expired_after_auth"} {
		t.Run(scenario, func(t *testing.T) {
			store, _ := passwordTestStore(t)
			ctx := context.Background()
			employee, login := sessionLoginFixture(t, store)
			require.NoError(t, store.CreateSession(ctx, employee.ID, login.TokenHash, login.CSRFTokenHash, login.ExpiresAt))
			snapshot, _, err := store.Session(ctx, login.TokenHash)
			require.NoError(t, err)
			switch scenario {
			case "id":
				snapshot.ID = "another-id"
			case "employee":
				snapshot.EmployeeID = "another-employee"
			case "token":
				snapshot.TokenHash = "another-token"
			case "expired_after_auth":
				require.NoError(t, store.db(ctx).Model(&EmployeeSession{}).Where("id = ?", snapshot.ID).Update("expires_at", time.Now().Add(-time.Second)).Error)
			}
			fail := false
			audited := auditedTestStore(t, store, &fail)
			require.NoError(t, audited.LogoutSession(ctx, *snapshot))
			if scenario == "expired_after_auth" {
				require.Empty(t, sessionRows(t, store))
				require.Len(t, employeeAuditRows(t, store), 1)
			} else {
				require.Len(t, sessionRows(t, store), 1)
				require.Empty(t, employeeAuditRows(t, store))
			}
		})
	}
}

func TestEmployeeSessionConcurrentLogoutAuditsOnce(t *testing.T) {
	store, _ := passwordTestStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	employee, login := sessionLoginFixture(t, store)
	require.NoError(t, store.CreateSession(ctx, employee.ID, login.TokenHash, login.CSRFTokenHash, login.ExpiresAt))
	snapshot, _, err := store.Session(ctx, login.TokenHash)
	require.NoError(t, err)
	fail := false
	audited := auditedTestStore(t, store, &fail)
	start := make(chan struct{})
	outcomes := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			outcomes <- audited.LogoutSession(ctx, *snapshot)
		}()
	}
	close(start)
	for range 2 {
		require.NoError(t, <-outcomes)
	}
	require.Empty(t, sessionRows(t, store))
	require.Len(t, employeeAuditRows(t, store), 1)
}

func TestEmployeeSessionLoginSerializesWithCredentialMutations(t *testing.T) {
	for _, mutation := range []string{"reset", "change", "disable"} {
		for _, first := range []string{"login", "mutation"} {
			t.Run(mutation+"/"+first+"_first", func(t *testing.T) {
				store, _ := passwordTestStore(t)
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				employee, login := sessionLoginFixture(t, store)
				require.NoError(t, store.CreateSession(ctx, employee.ID, "retained-token", "retained-csrf", login.ExpiresAt))
				fail := false
				audited := auditedTestStore(t, store, &fail)
				mutationAction := map[string]string{
					"reset": "employee.password_reset", "change": "employee.password_changed", "disable": "employee.update",
				}[mutation]
				firstAction := mutationAction
				if first == "login" {
					firstAction = "employee_session.created"
				}
				held, release := make(chan struct{}), make(chan struct{})
				var releaseOnce sync.Once
				unblock := func() { releaseOnce.Do(func() { close(release) }) }
				defer unblock()
				appendAudit := audited.auditAppender
				audited.auditAppender = func(ctx context.Context, tx *gorm.DB, event EmployeeAuditEvent) error {
					if err := appendAudit(ctx, tx, event); err != nil {
						return err
					}
					if event.Action == firstAction {
						close(held)
						select {
						case <-release:
						case <-ctx.Done():
							return ctx.Err()
						}
					}
					return nil
				}
				loginAttempt := func() error { return audited.LoginSession(ctx, login) }
				mutate := func() error {
					switch mutation {
					case "reset":
						return audited.ResetPassword(ctx, employee.ID, "ReplacementPassword!123")
					case "change":
						return audited.ChangePassword(ctx, PasswordChange{
							EmployeeID: employee.ID, VerifiedPasswordHash: employee.PasswordHash,
							NewPassword: "ReplacementPassword!123", KeepTokenHash: "retained-token",
						})
					default:
						disabled := *employee
						disabled.IsActive = false
						return audited.Update(ctx, &disabled, nil)
					}
				}
				firstAttempt, secondAttempt := mutate, loginAttempt
				if first == "login" {
					firstAttempt, secondAttempt = loginAttempt, mutate
				}
				firstDone, secondDone := make(chan error, 1), make(chan error, 1)
				go func() { firstDone <- firstAttempt() }()
				select {
				case <-held:
				case <-ctx.Done():
					t.Fatal("first transaction did not reach audit while holding its write lock")
				}
				secondStarted := make(chan struct{})
				sqlDB, err := store.db(ctx).DB()
				require.NoError(t, err)
				go func() {
					close(secondStarted)
					secondDone <- secondAttempt()
				}()
				<-secondStarted
				require.Eventually(t, func() bool { return sqlDB.Stats().InUse >= 2 }, 10*time.Second, 10*time.Millisecond,
					"both operations must reach the database before releasing the first transaction")
				// SQLite may block at BEGIN IMMEDIATE, PostgreSQL at the row
				// lock. Release independently of the second UPDATE callback.
				select {
				case err := <-secondDone:
					t.Fatalf("second transaction escaped the held employee lock: %v", err)
				case <-time.After(75 * time.Millisecond):
				}
				unblock()
				require.NoError(t, <-firstDone)
				secondErr := <-secondDone
				if first == "login" {
					require.NoError(t, secondErr)
				} else {
					require.ErrorIs(t, secondErr, ErrEmployeeCredentialsChanged)
				}
				_, _, err = store.Session(ctx, login.TokenHash)
				require.ErrorIs(t, err, gorm.ErrRecordNotFound, "no old-password session survives either lock ordering")
				wantEvents := 1
				if first == "login" {
					wantEvents = 2
				}
				require.Len(t, employeeAuditRows(t, store), wantEvents)
			})
		}
	}
}

func TestEmployeeSessionCommitAndRollbackSurviveReopen(t *testing.T) {
	ctx := context.Background()
	cfg := &configstore.Config{
		Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "session-reopen.db")},
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
	_, login := sessionLoginFixture(t, store)
	fail := true
	audited := auditedTestStore(t, store, &fail)
	require.ErrorIs(t, audited.LoginSession(ctx, login), ErrEmployeeAudit)
	require.NoError(t, store.configStore.Close(ctx))
	store = openStore()
	require.Empty(t, sessionRows(t, store))
	require.Empty(t, employeeAuditRows(t, store))
	fail = false
	audited = auditedTestStore(t, store, &fail)
	loginCtx, cancelLogin := context.WithCancel(ctx)
	defer cancelLogin()
	appendLoginAudit := audited.auditAppender
	audited.auditAppender = func(ctx context.Context, tx *gorm.DB, event EmployeeAuditEvent) error {
		if err := appendLoginAudit(ctx, tx, event); err != nil {
			return err
		}
		cancelLogin()
		return nil
	}
	require.Error(t, audited.LoginSession(loginCtx, login))
	require.NoError(t, store.configStore.Close(ctx))
	store = openStore()
	require.Empty(t, sessionRows(t, store))
	require.Empty(t, employeeAuditRows(t, store))
	current, err := store.Get(ctx, login.EmployeeID)
	require.NoError(t, err)
	require.Nil(t, current.LastLoginAt)
	audited = auditedTestStore(t, store, &fail)
	require.NoError(t, audited.LoginSession(ctx, login))
	require.NoError(t, store.configStore.Close(ctx))
	store = openStore()
	snapshot, _, err := store.Session(ctx, login.TokenHash)
	require.NoError(t, err)
	require.Len(t, employeeAuditRows(t, store), 1)
	fail = true
	audited = auditedTestStore(t, store, &fail)
	require.ErrorIs(t, audited.LogoutSession(ctx, *snapshot), ErrEmployeeAudit)
	require.NoError(t, store.configStore.Close(ctx))
	store = openStore()
	require.Len(t, sessionRows(t, store), 1)
	require.Len(t, employeeAuditRows(t, store), 1)
	fail = false
	audited = auditedTestStore(t, store, &fail)
	logoutCtx, cancelLogout := context.WithCancel(ctx)
	defer cancelLogout()
	appendLogoutAudit := audited.auditAppender
	audited.auditAppender = func(ctx context.Context, tx *gorm.DB, event EmployeeAuditEvent) error {
		if err := appendLogoutAudit(ctx, tx, event); err != nil {
			return err
		}
		cancelLogout()
		return nil
	}
	require.Error(t, audited.LogoutSession(logoutCtx, *snapshot))
	require.NoError(t, store.configStore.Close(ctx))
	store = openStore()
	require.Len(t, sessionRows(t, store), 1)
	require.Len(t, employeeAuditRows(t, store), 1)
	audited = auditedTestStore(t, store, &fail)
	require.NoError(t, audited.LogoutSession(ctx, *snapshot))
	require.NoError(t, store.configStore.Close(ctx))
	store = openStore()
	require.Empty(t, sessionRows(t, store))
	require.Len(t, employeeAuditRows(t, store), 2)
}

func BenchmarkEmployeeSessionLifecycle(b *testing.B) {
	for _, mode := range []string{"previous_split_no_audit", "transactional_audited"} {
		b.Run(mode, func(b *testing.B) {
			store, _ := testStore(b)
			ctx := context.Background()
			_, login := sessionLoginFixture(b, store)
			fail := false
			audited := auditedTestStore(b, store, &fail)
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				if mode == "previous_split_no_audit" {
					require.NoError(b, previousSplitSessionLogin(ctx, store, login))
					_, _, err := store.Session(ctx, login.TokenHash)
					require.NoError(b, err)
					require.NoError(b, store.DeleteSession(ctx, login.TokenHash))
				} else {
					require.NoError(b, audited.LoginSession(ctx, login))
					snapshot, _, err := store.Session(ctx, login.TokenHash)
					require.NoError(b, err)
					require.NoError(b, audited.LogoutSession(ctx, *snapshot))
				}
			}
		})
	}
}

func BenchmarkEmployeeSessionLogout(b *testing.B) {
	for _, mode := range []string{"previous_delete_no_audit", "transactional_audited"} {
		b.Run(mode, func(b *testing.B) {
			store, _ := testStore(b)
			ctx := context.Background()
			_, login := sessionLoginFixture(b, store)
			fail := false
			audited := auditedTestStore(b, store, &fail)
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				b.StopTimer()
				require.NoError(b, store.CreateSession(ctx, login.EmployeeID, login.TokenHash, login.CSRFTokenHash, login.ExpiresAt))
				snapshot, _, err := store.Session(ctx, login.TokenHash)
				require.NoError(b, err)
				b.StartTimer()
				if mode == "previous_delete_no_audit" {
					require.NoError(b, store.DeleteSession(ctx, login.TokenHash))
				} else {
					require.NoError(b, audited.LogoutSession(ctx, *snapshot))
				}
			}
		})
	}
}

// Reproduce the former independent session/metadata writes only for cost
// comparison. Hash verification and HTTP are outside this store benchmark;
// the request benchmark includes bcrypt. Audited modes use the test SQL appender,
// not production signing, so neither benchmark is a deployment SLA.
func previousSplitSessionLogin(ctx context.Context, store *Store, login SessionLogin) error {
	if err := store.CreateSession(ctx, login.EmployeeID, login.TokenHash, login.CSRFTokenHash, login.ExpiresAt); err != nil {
		return err
	}
	return store.db(ctx).Model(&Employee{}).Where("id = ?", login.EmployeeID).Updates(map[string]any{
		"last_login_at": time.Now(), "failed_login_count": 0, "locked_until": nil,
	}).Error
}
