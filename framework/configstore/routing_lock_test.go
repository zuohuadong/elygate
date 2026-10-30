package configstore

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestLockRoutingPolicyWriteRequiresTransaction(t *testing.T) {
	store := setupRDBTestStore(t)
	require.Error(t, LockRoutingPolicyWrite(nil))
	require.Error(t, LockRoutingPolicyWrite(store.DB()))
	tx := store.DB().Begin()
	require.NoError(t, tx.Error)
	config := *tx.Config
	tx.Config = &config
	tx.Dialector = unknownRoutingLockDialector{Dialector: tx.Dialector}
	require.ErrorContains(t, LockRoutingPolicyWrite(tx), "unsupported for database dialect")
	require.NoError(t, tx.Rollback().Error)

	require.NoError(t, store.DB().WithContext(context.Background()).Transaction(func(tx *gorm.DB) error {
		return LockRoutingPolicyWrite(tx)
	}))
}

type unknownRoutingLockDialector struct {
	gorm.Dialector
}

func (unknownRoutingLockDialector) Name() string { return "routing-lock-test" }

func routingLockStores(t *testing.T, backend string) (*RDBConfigStore, *RDBConfigStore) {
	t.Helper()
	var dialector gorm.Dialector
	if backend == "postgres" {
		dialector = routingLockPostgresDialector(t)
	} else {
		path := filepath.Join(t.TempDir(), "routing-lock.db")
		// Deferred transactions exercise the no-op write itself, not just BEGIN IMMEDIATE.
		mode := strings.TrimPrefix(backend, "sqlite-")
		dialector = sqlite.Open(fmt.Sprintf("%s?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=1&_txlock=%s", path, mode))
	}
	first := openRoutingLockStore(t, dialector)
	require.NoError(t, first.DB().AutoMigrate(&tables.TableRoutingRule{}, &tables.TableRoutingTarget{}, &tables.TableClientConfig{}))
	second := openRoutingLockStore(t, dialector)
	return first, second
}

func openRoutingLockStore(t *testing.T, dialector gorm.Dialector) *RDBConfigStore {
	t.Helper()
	db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		require.NoError(t, sqlDB.Close())
	})
	store := &RDBConfigStore{}
	store.db.Store(db)
	return store
}

func routingLockPostgresDialector(t *testing.T) gorm.Dialector {
	t.Helper()
	socket := os.Getenv("ELYGATE_TEST_POSTGRES_SOCKET")
	if socket == "" {
		t.Skip("requires a private PostgreSQL cluster via ELYGATE_TEST_POSTGRES_SOCKET")
	}
	require.True(t, filepath.IsAbs(socket))
	require.DirExists(t, socket)
	query := url.Values{"host": {socket}, "sslmode": {"disable"}, "connect_timeout": {"5"}}
	address := url.URL{Scheme: "postgres", User: url.User("elygate_controlplane_test"), Host: "localhost:5432", Path: "/postgres", RawQuery: query.Encode()}
	admin := openRoutingLockStore(t, postgres.Open(address.String()))
	schema := "routing_lock_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	require.NoError(t, admin.DB().Exec("CREATE SCHEMA "+schema).Error)
	t.Cleanup(func() {
		require.NoError(t, admin.DB().Exec("DROP SCHEMA "+schema+" CASCADE").Error)
	})
	query.Set("search_path", schema)
	address.RawQuery = query.Encode()
	return postgres.Open(address.String())
}

func forRoutingLockBackends(t *testing.T, run func(*testing.T, *RDBConfigStore, *RDBConfigStore)) {
	t.Helper()
	for _, backend := range []string{"sqlite-deferred", "sqlite-immediate", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			first, second := routingLockStores(t, backend)
			run(t, first, second)
		})
	}
}

func routingWriterResult(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(10 * time.Second):
		t.Fatal("routing writer did not finish")
		return nil
	}
}

func requireRoutingWriterBlocked(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		t.Fatalf("routing writer finished before the lock was released: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
}

func routingWriterPID(t *testing.T, db *gorm.DB) int {
	t.Helper()
	if db.Dialector.Name() != "postgres" {
		return 0
	}
	var pid int
	require.NoError(t, db.Raw("SELECT pg_backend_pid()").Scan(&pid).Error)
	return pid
}

func requireRoutingAdvisoryWait(t *testing.T, holder *gorm.DB, pid int) {
	t.Helper()
	if pid == 0 {
		return
	}
	require.Eventually(t, func() bool {
		var waiting bool
		require.NoError(t, holder.Raw(
			"SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = ? AND locktype = 'advisory' AND objid = ? AND NOT granted)",
			pid, RoutingPolicyWriteLockKey).Scan(&waiting).Error)
		return waiting
	}, 5*time.Second, 5*time.Millisecond, "the other connection must actually wait for the shared advisory lock")
}

func TestRoutingPolicyWriteLockTransactionLifetime(t *testing.T) {
	for _, finish := range []string{"commit", "rollback", "cancel-waiter"} {
		t.Run(finish, func(t *testing.T) {
			forRoutingLockBackends(t, func(t *testing.T, first, second *RDBConfigStore) {
				ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
				defer cancel()
				holderCtx, cancelHolder := context.WithCancel(ctx)
				defer cancelHolder()
				holder := first.DB().WithContext(holderCtx).Begin()
				require.NoError(t, holder.Error)
				defer holder.Rollback()
				require.NoError(t, LockRoutingPolicyWrite(holder))
				// Reentrant acquisition inside a savepoint must not release the outer lock.
				require.NoError(t, holder.Transaction(func(tx *gorm.DB) error { return LockRoutingPolicyWrite(tx) }))

				waiterCtx, cancelWaiter := context.WithCancel(ctx)
				defer cancelWaiter()
				waiterPID := routingWriterPID(t, second.DB())
				done := make(chan error, 1)
				started := make(chan struct{})
				callbackEntered := make(chan struct{})
				go func() {
					close(started)
					done <- second.DB().WithContext(waiterCtx).Transaction(func(tx *gorm.DB) error {
						close(callbackEntered)
						if err := LockRoutingPolicyWrite(tx); err != nil {
							return err
						}
						return second.CreateRoutingRule(waiterCtx, routingRuleFixture("waiting", 1, "openai"), tx)
					})
				}()
				<-started
				select {
				case <-callbackEntered:
				case <-time.After(100 * time.Millisecond):
				}
				requireRoutingAdvisoryWait(t, holder, waiterPID)
				requireRoutingWriterBlocked(t, done)
				switch finish {
				case "commit":
					require.NoError(t, holder.Commit().Error)
				case "rollback":
					require.NoError(t, holder.Rollback().Error)
				case "cancel-waiter":
					cancelWaiter()
					require.NoError(t, holder.Rollback().Error)
				}
				err := routingWriterResult(t, done)
				if finish == "cancel-waiter" {
					require.ErrorIs(t, err, context.Canceled)
					var count int64
					require.NoError(t, second.DB().Model(&tables.TableRoutingRule{}).Count(&count).Error)
					require.Zero(t, count)
					require.NoError(t, second.CreateRoutingRule(ctx, routingRuleFixture("after-cancel", 1, "openai")))
				} else {
					require.NoError(t, err)
					stored, err := second.GetRoutingRule(ctx, "waiting")
					require.NoError(t, err)
					require.Equal(t, "waiting", stored.ID)
				}
			})
		})
	}
}

func TestRoutingPolicyWriteLockSavepointRollbackKeepsOuterLock(t *testing.T) {
	forRoutingLockBackends(t, func(t *testing.T, first, second *RDBConfigStore) {
		ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
		defer cancel()
		holder := first.DB().WithContext(ctx).Begin()
		require.NoError(t, holder.Error)
		defer holder.Rollback()
		require.NoError(t, LockRoutingPolicyWrite(holder))
		require.Error(t, holder.Transaction(func(tx *gorm.DB) error {
			require.NoError(t, LockRoutingPolicyWrite(tx))
			return errors.New("rollback savepoint")
		}))

		if first.DB().Dialector.Name() == "sqlite" {
			require.NoError(t, second.DB().Exec("PRAGMA busy_timeout = 25").Error)
			err := second.DB().Transaction(LockRoutingPolicyWrite)
			require.ErrorContains(t, err, "database is locked")
			require.NoError(t, holder.Rollback().Error)
			require.NoError(t, second.DB().Transaction(LockRoutingPolicyWrite))
			return
		}

		done := make(chan error, 1)
		waiterPID := routingWriterPID(t, second.DB())
		go func() {
			done <- second.DB().WithContext(ctx).Transaction(LockRoutingPolicyWrite)
		}()
		requireRoutingAdvisoryWait(t, holder, waiterPID)
		requireRoutingWriterBlocked(t, done)
		require.NoError(t, holder.Rollback().Error)
		require.NoError(t, routingWriterResult(t, done))
	})
}

func TestRoutingPolicyWriteLockSerializesClientConfig(t *testing.T) {
	forRoutingLockBackends(t, func(t *testing.T, first, second *RDBConfigStore) {
		ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
		defer cancel()
		holder := first.DB().WithContext(ctx).Begin()
		require.NoError(t, holder.Error)
		defer holder.Rollback()
		require.NoError(t, LockRoutingPolicyWrite(holder))
		done := make(chan error, 1)
		started := make(chan struct{})
		waiterPID := routingWriterPID(t, second.DB())
		go func() {
			close(started)
			done <- second.UpdateClientConfig(ctx, &ClientConfig{RoutingChainMaxDepth: 7})
		}()
		<-started
		requireRoutingAdvisoryWait(t, holder, waiterPID)
		requireRoutingWriterBlocked(t, done)
		require.NoError(t, holder.Rollback().Error)
		require.NoError(t, routingWriterResult(t, done))
		config, err := second.GetClientConfig(ctx)
		require.NoError(t, err)
		require.Equal(t, 7, config.RoutingChainMaxDepth)
	})
}

func TestRoutingPolicyWriteLockNegativeControls(t *testing.T) {
	for _, backend := range []string{"sqlite-deferred", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			first, second := routingLockStores(t, backend)
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			holder := first.DB().WithContext(ctx).Begin()
			require.NoError(t, holder.Error)
			defer holder.Rollback()
			if backend == "postgres" {
				require.NoError(t, LockRoutingPolicyWrite(holder))
			}
			done := make(chan error, 1)
			go func() {
				// A deferred SQLite BEGIN alone has no writer lock. PostgreSQL's
				// advisory lock must not block a writer that does not acquire it.
				done <- second.DB().WithContext(ctx).Exec("UPDATE routing_rules SET id = id WHERE 1 = 0").Error
			}()
			require.NoError(t, routingWriterResult(t, done), "the control writer must complete while the holder is still open")
			require.NoError(t, holder.Rollback().Error)
		})
	}
}

func TestSQLiteRoutingPolicyWriteLockBusyTimeout(t *testing.T) {
	for _, backend := range []string{"sqlite-deferred", "sqlite-immediate"} {
		t.Run(backend, func(t *testing.T) {
			first, second := routingLockStores(t, backend)
			require.NoError(t, second.DB().Exec("PRAGMA busy_timeout = 25").Error)
			holder := first.DB().Begin()
			require.NoError(t, holder.Error)
			defer holder.Rollback()
			require.NoError(t, LockRoutingPolicyWrite(holder))
			// The SQL call itself must reach SQLite and exhaust its busy handler.
			// This assertion cannot pass merely because a goroutine was not scheduled.
			err := second.DB().Transaction(LockRoutingPolicyWrite)
			require.ErrorContains(t, err, "database is locked")
			require.NoError(t, holder.Rollback().Error)
			require.NoError(t, second.DB().Transaction(LockRoutingPolicyWrite))
		})
	}
}

func TestRoutingPolicyWriteLockSerializesRuleMutations(t *testing.T) {
	forRoutingLockBackends(t, func(t *testing.T, first, second *RDBConfigStore) {
		for _, operation := range []string{"create", "update", "delete", "sync"} {
			t.Run(operation, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
				defer cancel()
				id := "mutation-" + operation
				if operation != "create" {
					require.NoError(t, first.CreateRoutingRule(ctx, routingRuleFixture(id, 1, "openai")))
				}
				holder := first.DB().WithContext(ctx).Begin()
				require.NoError(t, holder.Error)
				defer holder.Rollback()
				require.NoError(t, LockRoutingPolicyWrite(holder))
				pid := routingWriterPID(t, second.DB())
				done := make(chan error, 1)
				go func() {
					rule := routingRuleFixture(id, 1, "anthropic")
					switch operation {
					case "create":
						done <- second.CreateRoutingRule(ctx, rule)
					case "update":
						done <- second.UpdateRoutingRule(ctx, rule)
					case "delete":
						done <- second.DeleteRoutingRule(ctx, id)
					case "sync":
						done <- second.SyncRoutingRules(ctx, nil, []tables.TableRoutingRule{*rule})
					}
				}()
				requireRoutingAdvisoryWait(t, holder, pid)
				requireRoutingWriterBlocked(t, done)
				require.NoError(t, holder.Rollback().Error)
				require.NoError(t, routingWriterResult(t, done))
				if operation != "delete" {
					stored, err := second.GetRoutingRule(ctx, id)
					require.NoError(t, err)
					require.Equal(t, "anthropic", *stored.Targets[0].Provider)
					require.NoError(t, second.DeleteRoutingRule(ctx, id))
				}
			})
		}
	})
}

func TestPostgresRoutingPolicyWriteLockCancellationDoesNotNeedHolderRelease(t *testing.T) {
	first, second := routingLockStores(t, "postgres")
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	holder := first.DB().WithContext(ctx).Begin()
	require.NoError(t, holder.Error)
	defer holder.Rollback()
	require.NoError(t, LockRoutingPolicyWrite(holder))
	waiterCtx, cancelWaiter := context.WithCancel(ctx)
	defer cancelWaiter()
	pid := routingWriterPID(t, second.DB())
	done := make(chan error, 1)
	go func() {
		done <- second.CreateRoutingRule(waiterCtx, routingRuleFixture("cancelled", 1, "openai"))
	}()
	requireRoutingAdvisoryWait(t, holder, pid)
	cancelWaiter()
	require.ErrorIs(t, routingWriterResult(t, done), context.Canceled)
	var count int64
	require.NoError(t, second.DB().Model(&tables.TableRoutingRule{}).Count(&count).Error)
	require.Zero(t, count, "cancelled writer must not insert anything")
	require.NoError(t, holder.Rollback().Error)
	require.NoError(t, second.CreateRoutingRule(ctx, routingRuleFixture("after-cancel", 1, "openai")))
}

func TestRoutingPolicyWriteLockConcurrentCreatesHaveOneWinner(t *testing.T) {
	forRoutingLockBackends(t, func(t *testing.T, first, second *RDBConfigStore) {
		for _, scope := range []string{"", "global", "virtual_key"} {
			t.Run("scope="+scope, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
				defer cancel()
				start := make(chan struct{})
				results := make(chan error, 2)
				for i, store := range []*RDBConfigStore{first, second} {
					rule := routingRuleFixture(fmt.Sprintf("priority-%s-%d", scope, i), 17, "openai")
					rule.Scope = scope
					if scope == "virtual_key" {
						id := "test-vk"
						rule.ScopeID = &id
					}
					go func() {
						<-start
						results <- store.CreateRoutingRule(ctx, rule)
					}()
				}
				close(start)
				a, b := routingWriterResult(t, results), routingWriterResult(t, results)
				if a != nil {
					a, b = b, a
				}
				require.NoError(t, a)
				require.ErrorIs(t, b, ErrRoutingRulePriorityTaken)
				var count int64
				require.NoError(t, first.DB().Model(&tables.TableRoutingRule{}).Where("scope = ?", scope).Count(&count).Error)
				require.EqualValues(t, 1, count)
			})
		}
	})
}

func TestRoutingPolicyWriteLockPriorityScopeIsolation(t *testing.T) {
	forRoutingLockBackends(t, func(t *testing.T, first, _ *RDBConfigStore) {
		ctx := context.Background()
		require.NoError(t, first.CreateRoutingRule(ctx, routingRuleFixture("global-priority", 17, "openai")))
		virtualKey := "test-vk"
		scoped := routingRuleFixture("scoped-priority", 17, "openai")
		scoped.Scope = "virtual_key"
		scoped.ScopeID = &virtualKey
		require.NoError(t, first.CreateRoutingRule(ctx, scoped))
		differentScopeID := "other-vk"
		scopedOther := routingRuleFixture("other-scope-priority", 17, "openai")
		scopedOther.Scope = "virtual_key"
		scopedOther.ScopeID = &differentScopeID
		require.NoError(t, first.CreateRoutingRule(ctx, scopedOther))
		require.NoError(t, first.CreateRoutingRule(ctx, routingRuleFixture("next-priority", 18, "openai")))
	})
}
