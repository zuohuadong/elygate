package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func seedDashboardFlushSessions(t testing.TB, cs configstore.ConfigStore, count int) {
	t.Helper()
	for index := range count {
		// Include both active and expired rows; bulk invalidation covers both.
		expiry := time.Now().Add(time.Duration(index*2-1) * time.Hour)
		require.NoError(t, cs.CreateSession(context.Background(), &configtables.SessionsTable{
			Token: fmt.Sprintf("flush-sensitive-token-%d", index), ExpiresAt: expiry,
		}))
	}
}

func dashboardSessionCount(t testing.TB, cs configstore.ConfigStore) int64 {
	t.Helper()
	var count int64
	require.NoError(t, cs.DB().Model(&configtables.SessionsTable{}).Count(&count).Error)
	return count
}

func TestDashboardSessionFlushAuditEmptyAndRepeated(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	// Cases: empty, one, many, expired; repeated deletion adds no second event.
	for index, count := range []int{0, 1, 4} {
		seedDashboardFlushSessions(t, cs, count)
		request := &fasthttp.RequestCtx{}
		require.NoError(t, store.FlushDashboardSessions(request))
		require.Zero(t, dashboardSessionCount(t, cs))
		require.NoError(t, store.FlushDashboardSessions(request))
		events := dashboardSessionAudits(t, store)
		require.Len(t, events, index)
		for _, event := range events {
			require.Equal(t, "dashboard_sessions.flushed", event.Action)
			require.Equal(t, "dashboard_session", event.ResourceType)
			require.Equal(t, "all", event.ResourceID)
			require.Equal(t, "anonymous", event.ActorID)
		}
	}
}

func TestDashboardSessionFlushAuditTrustedIdentity(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	for index, tc := range []struct {
		name, actor string
		markers     map[any]any
	}{
		{"basic", "local-admin:old-admin", map[any]any{
			lib.FastHTTPUserValueManagementAuditActor: "local-admin:old-admin",
			schemas.IsLocalAdminContextKey:            true,
		}},
		{"session", "local-admin", map[any]any{
			schemas.IsLocalAdminContextKey:        true,
			schemas.BifrostContextKeySessionToken: "flush-sensitive-token-0",
		}},
		{"anonymous", "anonymous", nil},
		{"bypassed", "anonymous", map[any]any{
			schemas.BifrostContextKeyAuthBypassed:     true,
			lib.FastHTTPUserValueManagementAuditActor: "local-admin:ignored",
			schemas.IsLocalAdminContextKey:            true,
			schemas.BifrostContextKeyUserID:           "ignored-user",
		}},
		{"setup", "anonymous", map[any]any{
			schemas.BifrostContextKeySetupTokenAuthenticated: true,
			schemas.IsLocalAdminContextKey:                   true,
			schemas.BifrostContextKeyUserID:                  "ignored-setup-user",
			lib.FastHTTPUserValueManagementAuditActor:        "local-admin:ignored-setup-actor",
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			seedDashboardFlushSessions(t, cs, 1)
			request := &fasthttp.RequestCtx{}
			request.Request.Header.Set("X-User-ID", "forged-header-admin")
			for key, marker := range tc.markers {
				request.SetUserValue(key, marker)
			}
			require.NoError(t, store.FlushDashboardSessions(request))
			events := dashboardSessionAudits(t, store)
			require.Len(t, events, index+1)
			require.Equal(t, tc.actor, events[index].ActorID)
			encoded, err := json.Marshal(events)
			require.NoError(t, err)
			require.NotContains(t, string(encoded), "flush-sensitive-token")
			require.NotContains(t, string(encoded), "forged-header-admin")
		})
	}
}

func TestDashboardSessionFlushAuditUsesBoundedStorageContext(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	seedDashboardFlushSessions(t, cs, 1)
	observed := false
	require.NoError(t, cs.DB().Callback().Delete().Before("gorm:delete").Register("test:flush-context", func(tx *gorm.DB) {
		if tx.Statement.Table != "sessions" {
			return
		}
		observed = true
		_, requestContext := tx.Statement.Context.(*fasthttp.RequestCtx)
		require.False(t, requestContext)
		deadline, bounded := tx.Statement.Context.Deadline()
		require.True(t, bounded)
		require.WithinDuration(t, time.Now().Add(30*time.Second), deadline, 2*time.Second)
		require.Nil(t, tx.Statement.Context.Value(schemas.BifrostContextKeySessionToken))
	}))
	t.Cleanup(func() { cs.DB().Callback().Delete().Remove("test:flush-context") })
	request := &fasthttp.RequestCtx{}
	request.SetUserValue(schemas.BifrostContextKeySessionToken, "request-only-sensitive-token")
	require.NoError(t, store.FlushDashboardSessions(request))
	require.True(t, observed)
}

func TestDashboardSessionFlushAuditDoesNotReadCredentials(t *testing.T) {
	testLogger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	encrypt.Init("isolated-dashboard-flush-test-key", testLogger)
	t.Cleanup(func() { encrypt.Init("", testLogger) })
	store, cs := testControlPlaneStore(t)
	seedDashboardFlushSessions(t, cs, 2)
	now := time.Now()
	// A bulk delete must not depend on successful token decryption, even for corrupt rows.
	require.NoError(t, cs.DB().Exec(
		"INSERT INTO sessions (token, expires_at, created_at, updated_at, encryption_status) VALUES (?, ?, ?, ?, ?)",
		"unreadable-ciphertext", now, now, now, configtables.EncryptionStatusEncrypted).Error)
	require.NoError(t, cs.DB().Callback().Query().Before("gorm:query").Register("test:flush-no-token-read", func(tx *gorm.DB) {
		if tx.Statement.Table == "sessions" {
			tx.AddError(errors.New("bulk flush must not load session contents"))
		}
	}))
	t.Cleanup(func() { cs.DB().Callback().Query().Remove("test:flush-no-token-read") })
	require.NoError(t, store.FlushDashboardSessions(&fasthttp.RequestCtx{}))
	require.Len(t, dashboardSessionAudits(t, store), 1)
	require.NoError(t, cs.DB().Callback().Query().Remove("test:flush-no-token-read"))
	require.Zero(t, dashboardSessionCount(t, cs))
}

func TestDashboardSessionFlushAuditRollback(t *testing.T) {
	for _, failure := range []string{"delete", "audit"} {
		t.Run(failure, func(t *testing.T) {
			store, cs := testControlPlaneStore(t)
			seedDashboardFlushSessions(t, cs, 3)
			cause := errors.New("sensitive-database-diagnostic-flush-token")
			inject := func(tx *gorm.DB) {
				if tx.Statement.Table == "sessions" || tx.Statement.Table == (AuditEvent{}).TableName() {
					tx.AddError(cause)
				}
			}
			if failure == "delete" {
				require.NoError(t, cs.DB().Callback().Delete().Before("gorm:delete").Register("test:flush-failure", inject))
				t.Cleanup(func() { cs.DB().Callback().Delete().Remove("test:flush-failure") })
			} else {
				require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:flush-failure", inject))
				t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:flush-failure") })
			}
			err := store.FlushDashboardSessions(&fasthttp.RequestCtx{})
			require.ErrorIs(t, err, cause)
			require.EqualError(t, err, "dashboard session persistence failed")
			require.EqualValues(t, 3, dashboardSessionCount(t, cs))
			require.Empty(t, dashboardSessionAudits(t, store))
		})
	}
}

func TestDashboardSessionFlushAuditCancellation(t *testing.T) {
	for _, stage := range []string{"before transaction", "after deletion", "after audit"} {
		t.Run(stage, func(t *testing.T) {
			store, cs := testControlPlaneStore(t)
			seedDashboardFlushSessions(t, cs, 2)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			observed := false
			if stage == "before transaction" {
				cancel()
			} else if stage == "after deletion" {
				require.NoError(t, cs.DB().Callback().Delete().After("gorm:delete").Register("test:flush-cancel", func(tx *gorm.DB) {
					if tx.Statement.Table == "sessions" {
						observed = true
						cancel()
					}
				}))
				t.Cleanup(func() { cs.DB().Callback().Delete().Remove("test:flush-cancel") })
			} else {
				require.NoError(t, cs.DB().Callback().Create().After("gorm:create").Register("test:flush-cancel", func(tx *gorm.DB) {
					if tx.Statement.Table == (AuditEvent{}).TableName() {
						observed = true
						cancel()
					}
				}))
				t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:flush-cancel") })
			}
			require.EqualError(t, store.flushDashboardSessions(ctx, "local-admin"), "dashboard session persistence failed")
			if stage != "before transaction" {
				require.True(t, observed, "cancellation must run at the requested transaction boundary")
			}
			require.EqualValues(t, 2, dashboardSessionCount(t, cs))
			require.Empty(t, dashboardSessionAudits(t, store))
		})
	}
}

func TestDashboardSessionFlushAuditConcurrentFlushAndLogout(t *testing.T) {
	for _, scenario := range []string{"flushes", "flush and logout"} {
		t.Run(scenario, func(t *testing.T) {
			store, cs := testControlPlaneStore(t)
			seedDashboardFlushSessions(t, cs, 4)
			other, err := NewStore(context.Background(), cs)
			require.NoError(t, err)
			writers := []*Store{store, other}
			start := make(chan struct{})
			failures := make(chan error, 12)
			var group sync.WaitGroup
			for index := range 12 {
				group.Go(func() {
					<-start
					writer := writers[index%2]
					if scenario == "flush and logout" && index%2 == 1 {
						failures <- writer.ConfigStoreWithSessionAudit().DeleteSession(context.Background(), "flush-sensitive-token-1")
						return
					}
					failures <- writer.FlushDashboardSessions(&fasthttp.RequestCtx{})
				})
			}
			close(start)
			group.Wait()
			close(failures)
			for err := range failures {
				require.NoError(t, err)
			}
			require.Zero(t, dashboardSessionCount(t, cs))
			var flushed, deleted int
			for _, event := range dashboardSessionAudits(t, store) {
				switch event.Action {
				case "dashboard_sessions.flushed":
					flushed++
				case "dashboard_session.deleted":
					deleted++
				default:
					t.Fatalf("unexpected event %q", event.Action)
				}
			}
			require.Equal(t, 1, flushed)
			require.LessOrEqual(t, deleted, 1)
			if scenario == "flushes" {
				require.Zero(t, deleted)
			}
		})
	}
}

func TestDashboardSessionFlushAuditPersistsAfterReopen(t *testing.T) {
	ctx := context.Background()
	config := &configstore.Config{Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "session-flush.db")}}
	if socket := os.Getenv("ELYGATE_TEST_POSTGRES_SOCKET"); socket != "" {
		config = testPostgresControlPlaneConfig(t, socket)
	}
	cs, err := configstore.NewConfigStore(ctx, config, bifrost.NewDefaultLogger(schemas.LogLevelError))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, cs.Close(ctx)) })
	store, err := NewStore(ctx, cs)
	require.NoError(t, err)
	seedDashboardFlushSessions(t, cs, 3)
	require.NoError(t, store.FlushDashboardSessions(&fasthttp.RequestCtx{}))
	expected := dashboardSessionAudits(t, store)
	require.Len(t, expected, 1)
	require.NoError(t, cs.Close(ctx))
	cs, err = configstore.NewConfigStore(ctx, config, bifrost.NewDefaultLogger(schemas.LogLevelError))
	require.NoError(t, err)
	reopened, err := NewStore(ctx, cs)
	require.NoError(t, err)
	require.Zero(t, dashboardSessionCount(t, cs))
	require.Equal(t, expected, dashboardSessionAudits(t, reopened))
}

func BenchmarkDashboardSessionFlushAudit(b *testing.B) {
	for _, variant := range []string{"upstream", "audited"} {
		for _, count := range []int{0, 1, 16} {
			b.Run(fmt.Sprintf("%s/%d", variant, count), func(b *testing.B) {
				ctx := context.Background()
				cs, err := configstore.NewConfigStore(ctx, &configstore.Config{
					Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
					Config: &configstore.SQLiteConfig{Path: filepath.Join(b.TempDir(), "flush-bench.db")},
				}, bifrost.NewDefaultLogger(schemas.LogLevelError))
				require.NoError(b, err)
				b.Cleanup(func() { require.NoError(b, cs.Close(ctx)) })
				store, err := NewStore(ctx, cs)
				require.NoError(b, err)
				request := &fasthttp.RequestCtx{}
				b.ReportAllocs()
				b.ResetTimer()
				for range b.N {
					b.StopTimer()
					seedDashboardFlushSessions(b, cs, count)
					b.StartTimer()
					if variant == "audited" {
						err = store.FlushDashboardSessions(request)
					} else {
						err = cs.FlushSessions(ctx)
					}
					if err != nil {
						b.Fatal(err)
					}
				}
			})
		}
	}
}
