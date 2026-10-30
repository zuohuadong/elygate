package controlplane

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type routingInstallationDBStore struct {
	configstore.ConfigStore
	db *gorm.DB
}

func (store routingInstallationDBStore) DB() *gorm.DB { return store.db }

// Both commit outcomes use real transactions; only the receipt is injected.
type routingInstallationFaultPool struct {
	*sql.DB
	beginErr        error
	commitErr       error
	rollbackErr     error
	commitWrites    bool
	afterCommit     func() error
	commitAttempts  int
	rollbacks       int
	rollbackReceipt error
}

func (pool *routingInstallationFaultPool) BeginTx(ctx context.Context, options *sql.TxOptions) (gorm.ConnPool, error) {
	if pool.beginErr != nil {
		return nil, pool.beginErr
	}
	tx, err := pool.DB.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	return &routingInstallationFaultTx{Tx: tx, pool: pool}, nil
}

type routingInstallationFaultTx struct {
	*sql.Tx
	pool *routingInstallationFaultPool
}

func (tx *routingInstallationFaultTx) Rollback() error {
	tx.pool.rollbacks++
	if err := tx.Tx.Rollback(); err != nil {
		tx.pool.rollbackReceipt = err
		return err
	}
	tx.pool.rollbackReceipt = tx.pool.rollbackErr
	return tx.pool.rollbackErr
}

func (tx *routingInstallationFaultTx) Commit() error {
	tx.pool.commitAttempts++
	if !tx.pool.commitWrites {
		if err := tx.Tx.Rollback(); err != nil {
			return err
		}
		return tx.pool.commitErr
	}
	if err := tx.Tx.Commit(); err != nil {
		return err
	}
	if tx.pool.afterCommit != nil {
		if err := tx.pool.afterCommit(); err != nil {
			return err
		}
	}
	return tx.pool.commitErr
}

func routingInstallationWithPool(t *testing.T, store *Store, pool gorm.ConnPool) *Store {
	t.Helper()
	db := store.configStore.DB().Session(&gorm.Session{NewDB: true}).WithContext(t.Context())
	db.Statement.ConnPool = pool
	return &Store{configStore: routingInstallationDBStore{ConfigStore: store.configStore, db: db}}
}

func pendingRoutingInstallation(t *testing.T) (*Store, configstore.ConfigStore, *RoutingReleaseAttempt) {
	t.Helper()
	store, cs := testControlPlaneStore(t)
	require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{RoutingChainMaxDepth: 7}))
	require.NoError(t, cs.CreateRoutingRule(t.Context(), &tables.TableRoutingRule{
		ID: "old-rule", Name: "Old", Scope: "global", CelExpression: "true", Enabled: new(true),
	}))
	version := routingReleaseVersion(t, store)
	attempt, err := store.AcceptRoutingRelease(t.Context(), RoutingReleaseRequest{
		VersionID: version.ID, IdempotencyKey: uuid.NewString(),
	})
	require.NoError(t, err)
	return store, cs, attempt
}

func TestRoutingInstallationTransactionOutcomes(t *testing.T) {
	rejected := errors.New("injected transaction failure")
	// Boundary matrix: Begin failure, work failure/cancellation, and both real
	// commit outcomes behind identical errors. Empty success remains a policy.
	for _, test := range []struct {
		name           string
		beginErr       error
		compilerErr    error
		commitErr      error
		cancelCompiler bool
		commitWrites   bool
		wantErr        error
		uncertain      bool
	}{
		{name: "begin failure", beginErr: rejected, wantErr: rejected},
		{name: "compiler failure", compilerErr: rejected, wantErr: rejected},
		{name: "compiler cancellation", cancelCompiler: true, wantErr: context.Canceled},
		{name: "committed lost receipt", commitWrites: true, commitErr: rejected, wantErr: rejected, uncertain: true},
		{name: "rolled back lost receipt", commitErr: rejected, wantErr: rejected, uncertain: true},
		{name: "committed cancellation receipt", commitWrites: true, commitErr: context.Canceled, wantErr: context.Canceled, uncertain: true},
		{name: "empty success", commitWrites: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, cs, attempt := pendingRoutingInstallation(t)
			sqlDB, err := cs.DB().DB()
			require.NoError(t, err)
			pool := &routingInstallationFaultPool{
				DB: sqlDB, beginErr: test.beginErr, commitErr: test.commitErr, commitWrites: test.commitWrites,
			}
			injected := routingInstallationWithPool(t, store, pool)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			compilerCalls := 0
			installed, err := injected.InstallAcceptedRoutingRelease(ctx, attempt.Epoch, func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
				compilerCalls++
				if test.cancelCompiler {
					cancel()
				}
				return nil, test.compilerErr
			}, "installer")
			if test.wantErr != nil {
				require.ErrorIs(t, err, test.wantErr)
				require.Nil(t, installed, "failed receipt cannot expose a runtime-installable policy")
			} else {
				require.NoError(t, err)
				require.True(t, installed.Head.IsApplied())
				require.NotNil(t, installed.Policy.Rules)
				require.Empty(t, installed.Policy.Rules)
				require.Positive(t, installed.Policy.ChainMaxDepth)
			}
			wantUncertain := test.uncertain
			if test.cancelCompiler {
				// Cancellation may win database/sql's automatic rollback race,
				// or pgx may return a failed rollback receipt using the canceled context.
				require.Equal(t, 1, pool.rollbacks)
				wantUncertain = pool.rollbackReceipt != nil && !errors.Is(pool.rollbackReceipt, sql.ErrTxDone)
				if wantUncertain {
					require.ErrorIs(t, err, pool.rollbackReceipt)
				}
			}
			require.Equal(t, wantUncertain, errors.Is(err, ErrRoutingInstallationUncertain), "transaction receipt: %v", err)
			if test.beginErr != nil {
				require.Zero(t, compilerCalls)
			} else {
				require.Equal(t, 1, compilerCalls)
			}
			if test.beginErr != nil || test.compilerErr != nil || test.cancelCompiler {
				require.Zero(t, pool.commitAttempts, "work errors must never attempt commit")
			} else {
				require.Equal(t, 1, pool.commitAttempts)
				require.Zero(t, pool.rollbacks, "a failed commit receipt must not be reinterpreted by rollback")
			}
			head, err := store.GetRoutingReleaseHead(t.Context())
			require.NoError(t, err)
			live, err := cs.GetRoutingRules(t.Context())
			require.NoError(t, err)
			if test.commitWrites {
				require.True(t, head.IsApplied(), "commit may have succeeded even when its receipt is an error")
				require.Empty(t, live)
				require.Len(t, routingReleaseAudits(t, store), 2)
			} else {
				requirePendingRoutingHead(t, store, attempt)
				require.Len(t, live, 1)
				require.Equal(t, "old-rule", live[0].ID)
				require.Len(t, routingReleaseAudits(t, store), 1)
			}
		})
	}
}

func TestRoutingInstallationRollbackReceiptFailure(t *testing.T) {
	store, cs, attempt := pendingRoutingInstallation(t)
	sqlDB, err := cs.DB().DB()
	require.NoError(t, err)
	workErr, rollbackErr := errors.New("compilation failed"), errors.New("rollback receipt unavailable")
	pool := &routingInstallationFaultPool{DB: sqlDB, rollbackErr: rollbackErr}
	injected := routingInstallationWithPool(t, store, pool)
	installed, err := injected.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
		return nil, workErr
	}, "installer")
	require.ErrorIs(t, err, ErrRoutingInstallationUncertain)
	require.ErrorIs(t, err, workErr)
	require.ErrorIs(t, err, rollbackErr)
	require.Nil(t, installed)
	require.Zero(t, pool.commitAttempts)
	require.Equal(t, 1, pool.rollbacks)
	requirePendingRoutingHead(t, store, attempt)
	require.Len(t, routingReleaseAudits(t, store), 1)
}

func TestRoutingInstallationRollbackIgnoresGORMStickyError(t *testing.T) {
	_, cs := testControlPlaneStore(t)
	tx := cs.DB().Begin()
	require.NoError(t, tx.Error)
	t.Cleanup(func() { _ = tx.Rollback() })
	rejected := errors.New("earlier query failed")
	tx.AddError(rejected)
	require.NoError(t, rollbackRoutingInstallationTransaction(tx), "only the SQL rollback receipt determines rollback success")
	require.ErrorIs(t, tx.Error, rejected, "GORM still retains its earlier error after successful rollback")
}

func TestRoutingInstallationRejectsNestedTransactions(t *testing.T) {
	store, cs, attempt := pendingRoutingInstallation(t)
	tx := cs.DB().Begin()
	require.NoError(t, tx.Error)
	t.Cleanup(func() { _ = tx.Rollback() })
	compile := func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
		t.Fatal("nested installation must fail before compiling or changing live state")
		return nil, nil
	}
	for name, nested := range map[string]*Store{
		"transaction-bound store":         {configStore: cs, tx: tx},
		"transaction-backed config store": {configStore: routingInstallationDBStore{ConfigStore: cs, db: tx}},
	} {
		t.Run(name, func(t *testing.T) {
			installed, err := nested.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, compile, "installer")
			require.ErrorIs(t, err, ErrRoutingInstallationNestedTransaction)
			require.NotErrorIs(t, err, ErrRoutingInstallationUncertain)
			require.Nil(t, installed)
		})
	}
	requirePendingRoutingHead(t, store, attempt)
	require.Len(t, routingReleaseAudits(t, store), 1)
}

func TestRoutingInstallationCompilerPanicReleasesTransaction(t *testing.T) {
	store, cs, attempt := pendingRoutingInstallation(t)
	sqlDB, err := cs.DB().DB()
	require.NoError(t, err)
	pool := &routingInstallationFaultPool{DB: sqlDB, commitWrites: true}
	injected := routingInstallationWithPool(t, store, pool)
	require.PanicsWithValue(t, "compiler panic", func() {
		_, _ = injected.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
			panic("compiler panic")
		}, "installer")
	})
	require.Zero(t, pool.commitAttempts)
	require.Equal(t, 1, pool.rollbacks, "panic must release the root transaction and routing lock")
	requirePendingRoutingHead(t, store, attempt)
	installed, err := injected.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
		return nil, nil
	}, "retry")
	require.NoError(t, err)
	require.True(t, installed.Head.IsApplied())
	require.Len(t, routingReleaseAudits(t, store), 2)
}

func TestRoutingInstallationAppliedReplayCommitUncertain(t *testing.T) {
	store, cs, attempt := pendingRoutingInstallation(t)
	compile := func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
		return nil, nil
	}
	installed, err := store.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, compile, "installer")
	require.NoError(t, err)
	require.True(t, installed.Head.IsApplied())
	sqlDB, err := cs.DB().DB()
	require.NoError(t, err)
	receiptErr := errors.New("replay receipt unavailable")
	for _, commitWrites := range []bool{false, true} {
		pool := &routingInstallationFaultPool{DB: sqlDB, commitWrites: commitWrites, commitErr: receiptErr}
		injected := routingInstallationWithPool(t, store, pool)
		replayed, err := injected.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, compile, "retry")
		require.ErrorIs(t, err, ErrRoutingInstallationUncertain)
		require.ErrorIs(t, err, receiptErr)
		require.Nil(t, replayed)
		require.Equal(t, 1, pool.commitAttempts)
		head, err := store.GetRoutingReleaseHead(t.Context())
		require.NoError(t, err)
		require.Equal(t, installed.Head, *head)
		require.Len(t, routingReleaseAudits(t, store), 2, "uncertain replays cannot append another apply audit")
	}
}

func TestRoutingInstallationReturnsComparedPolicyWithoutPostCommitRead(t *testing.T) {
	store, cs, attempt := pendingRoutingInstallation(t)
	sqlDB, err := cs.DB().DB()
	require.NoError(t, err)
	pool := &routingInstallationFaultPool{
		DB: sqlDB, commitWrites: true,
		afterCommit: func() error {
			return cs.DB().Model(&tables.TableClientConfig{}).Where("1 = 1").
				UpdateColumn("routing_chain_max_depth", 99).Error
		},
	}
	compilerCalls := 0
	compile := func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
		compilerCalls++
		return nil, nil
	}
	injected := routingInstallationWithPool(t, store, pool)
	installed, err := injected.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, compile, "installer")
	require.NoError(t, err)
	require.True(t, installed.Head.IsApplied())
	require.NotEqual(t, 99, installed.Policy.ChainMaxDepth, "handoff must not re-read after commit")
	require.Empty(t, installed.Policy.Rules)
	client, err := cs.GetClientConfig(t.Context())
	require.NoError(t, err)
	require.Equal(t, 99, client.RoutingChainMaxDepth, "fixture changed the database after commit")
	replayed, err := store.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, compile, "retry")
	require.ErrorIs(t, err, ErrRoutingPolicyNotReady, "a later replay still rejects that drift")
	require.Nil(t, replayed)
	require.Equal(t, 2, compilerCalls)
	require.Len(t, routingReleaseAudits(t, store), 2)
}
