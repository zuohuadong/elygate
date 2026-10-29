package controlplane

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/fasthttp/router"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/plugins/routing/complexity"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func dashboardSessionAudits(t *testing.T, store *Store) []AuditEvent {
	t.Helper()
	var events []AuditEvent
	require.NoError(t, store.db(context.Background()).Where("resource_type = ?", "dashboard_session").Order("created_at, id").Find(&events).Error)
	return events
}

func dashboardSessionRequest(r *router.Router, path, body, token string) *fasthttp.RequestCtx {
	var httpRequest fasthttp.Request
	request := &fasthttp.RequestCtx{}
	request.Init(&httpRequest, nil, nil)
	request.Request.Header.SetMethod("POST")
	request.Request.SetRequestURI(path)
	request.Request.Header.SetContentType("application/json")
	request.Request.Header.Set("X-User-ID", "forged-session-actor")
	if token != "" {
		request.Request.Header.Set("Authorization", "Bearer "+token)
	}
	request.Request.SetBodyString(body)
	r.Handler(request)
	return request
}

func TestDashboardSessionAuditRegisteredLoginLogout(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	testLogger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	handlers.SetLogger(testLogger)
	hash, err := encrypt.Hash("dashboard-test-password")
	require.NoError(t, err)
	authConfig := &configstore.AuthConfig{IsEnabled: true,
		AdminUserName: schemas.NewSecretVar("dashboard-admin"), AdminPassword: schemas.NewSecretVar(hash)}
	require.NoError(t, cs.UpdateAuthConfig(ctx, authConfig))
	auth, err := handlers.InitAuthMiddleware(cs, nil, nil, "")
	require.NoError(t, err)
	r := router.New()
	audit := NewHandler(store, nil)
	audit.RegisterRoutes(r, auth.APIMiddleware())
	handlers.NewSessionHandler(store.ConfigStoreWithSessionAudit(), nil).RegisterRoutes(r,
		auth.APIMiddleware(), audit.ManagementAuditMiddleware(testLogger))
	for _, body := range []string{
		`{"username":"forged-session-actor","password":"dashboard-test-password"}`,
		`{"username":"dashboard-admin","password":"wrong"}`,
		`{`,
	} {
		response := dashboardSessionRequest(r, "/api/session/login", body, "")
		require.Contains(t, []int{400, 401}, response.Response.StatusCode())
		require.Empty(t, response.Response.Header.PeekCookie("token"))
	}
	failedLogins := dashboardSessionAudits(t, store)
	require.Len(t, failedLogins, 2)
	for _, event := range failedLogins {
		require.Equal(t, "dashboard_session.login_failed", event.Action)
		require.Equal(t, "anonymous", event.ActorID)
		require.Equal(t, "dashboard", event.ResourceID)
	}
	response := dashboardSessionRequest(r, "/api/session/login",
		`{"username":"dashboard-admin","password":"dashboard-test-password"}`, "")
	require.Equal(t, 200, response.Response.StatusCode())
	var cookie fasthttp.Cookie
	cookie.SetKey("token")
	require.True(t, response.Response.Header.Cookie(&cookie))
	token := string(cookie.Value())
	require.NotEmpty(t, token)
	require.True(t, cookie.HTTPOnly())
	require.Equal(t, fasthttp.CookieSameSiteLaxMode, cookie.SameSite())
	session, err := cs.GetSession(ctx, token)
	require.NoError(t, err)
	require.NotNil(t, session)
	readAudit := func(authorization string) *fasthttp.RequestCtx {
		var httpRequest fasthttp.Request
		request := &fasthttp.RequestCtx{}
		request.Init(&httpRequest, nil, nil)
		request.Request.Header.SetMethod("GET")
		request.Request.SetRequestURI("/api/control-plane/audit-events?limit=100")
		request.Request.Header.Set("Authorization", authorization)
		r.Handler(request)
		return request
	}
	require.Equal(t, 200, readAudit("Bearer "+token).Response.StatusCode())
	for _, logoutToken := range []string{"", "unknown"} {
		logout := dashboardSessionRequest(r, "/api/session/logout", "", logoutToken)
		require.Equal(t, 200, logout.Response.StatusCode())
	}
	var logoutRequest fasthttp.Request
	cookieLogout := &fasthttp.RequestCtx{}
	cookieLogout.Init(&logoutRequest, nil, nil)
	cookieLogout.Request.Header.SetMethod("POST")
	cookieLogout.Request.SetRequestURI("/api/session/logout")
	cookieLogout.Request.Header.SetCookie("token", token)
	r.Handler(cookieLogout)
	require.Equal(t, 200, cookieLogout.Response.StatusCode())
	require.True(t, cookieLogout.Response.Header.Cookie(&cookie))
	require.Empty(t, cookie.Value())
	require.Equal(t, 200, dashboardSessionRequest(r, "/api/session/logout", "", token).Response.StatusCode())
	session, err = cs.GetSession(ctx, token)
	require.NoError(t, err)
	require.Nil(t, session)
	events := dashboardSessionAudits(t, store)
	require.Len(t, events, 4)
	require.Equal(t, failedLogins, events[:2])
	require.Equal(t, "dashboard_session.created", events[2].Action)
	require.Equal(t, "dashboard_session.deleted", events[3].Action)
	for _, event := range events[2:] {
		require.Equal(t, "local-admin", event.ActorID)
		require.Equal(t, "sha256:"+encrypt.HashSHA256(token), event.ResourceID)
	}
	require.Equal(t, 401, readAudit("Bearer "+token).Response.StatusCode())
	feed := readAudit("Basic " + base64.StdEncoding.EncodeToString([]byte("dashboard-admin:dashboard-test-password")))
	require.Equal(t, 200, feed.Response.StatusCode())
	var payload struct {
		Data []AuditEvent `json:"data"`
	}
	require.NoError(t, json.Unmarshal(feed.Response.Body(), &payload))
	require.Len(t, payload.Data, 4)
	require.ElementsMatch(t, events, payload.Data)
	encoded, err := json.Marshal(events)
	require.NoError(t, err)
	for _, secret := range []string{token, hash, "dashboard-admin", "dashboard-test-password", "forged-session-actor"} {
		require.NotContains(t, string(encoded), secret)
	}
	authConfig.IsEnabled = false
	require.NoError(t, cs.UpdateAuthConfig(ctx, authConfig))
	auth.UpdateAuthConfig(authConfig)
	response = dashboardSessionRequest(r, "/api/session/login",
		`{"username":"dashboard-admin","password":"dashboard-test-password"}`, "")
	require.Equal(t, 403, response.Response.StatusCode())
	require.Equal(t, events, dashboardSessionAudits(t, store))
}

func TestDashboardSessionAuditRollbackAndSafeErrors(t *testing.T) {
	// Cases: create/audit failure, delete/audit failure, query failure, unknown/empty tokens.
	for _, failure := range []string{"create", "create audit", "delete", "delete audit", "query"} {
		t.Run(failure, func(t *testing.T) {
			store, cs := testControlPlaneStore(t)
			ctx := context.Background()
			const token = "session-rollback-sensitive-token"
			require.NoError(t, cs.CreateSession(ctx, &configtables.SessionsTable{Token: token, ExpiresAt: time.Now().Add(time.Hour)}))
			db := cs.DB()
			cause := errors.New("database diagnostic contains " + token)
			failWrites := true
			inject := func(tx *gorm.DB) {
				if failWrites && ((failure == "create" && tx.Statement.Table == "sessions") ||
					((failure == "create audit" || failure == "delete audit") && tx.Statement.Table == (AuditEvent{}).TableName()) ||
					((failure == "query" || failure == "delete") && tx.Statement.Table == "sessions")) {
					tx.AddError(cause)
				}
			}
			switch failure {
			case "create", "create audit", "delete audit":
				require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:session-failure", inject))
				t.Cleanup(func() { db.Callback().Create().Remove("test:session-failure") })
			case "delete":
				require.NoError(t, db.Callback().Delete().Before("gorm:delete").Register("test:session-failure", inject))
				t.Cleanup(func() { db.Callback().Delete().Remove("test:session-failure") })
			case "query":
				require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:session-failure", inject))
				t.Cleanup(func() { db.Callback().Query().Remove("test:session-failure") })
			}
			audited := store.ConfigStoreWithSessionAudit()
			var err error
			if failure == "create" || failure == "create audit" {
				err = audited.CreateSession(ctx, &configtables.SessionsTable{Token: "new-" + token, ExpiresAt: time.Now().Add(time.Hour)})
			} else {
				err = audited.DeleteSession(ctx, token)
			}
			require.ErrorIs(t, err, cause)
			require.EqualError(t, err, "dashboard session persistence failed")
			failWrites = false
			var count int64
			require.NoError(t, db.Table("sessions").Count(&count).Error)
			require.EqualValues(t, 1, count, "session mutation rolls back with the audit")
			original, err := cs.GetSession(ctx, token)
			require.NoError(t, err)
			require.NotNil(t, original)
			require.Empty(t, dashboardSessionAudits(t, store))
		})
	}
}

func TestDashboardSessionAuditLoginResponseOnAuditFailure(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	hash, err := encrypt.Hash("session-test-password")
	require.NoError(t, err)
	require.NoError(t, cs.UpdateAuthConfig(ctx, &configstore.AuthConfig{IsEnabled: true,
		AdminUserName: schemas.NewSecretVar("admin"), AdminPassword: schemas.NewSecretVar(hash)}))
	require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:session-response", func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			tx.AddError(errors.New("sensitive-internal-database-diagnostic"))
		}
	}))
	t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:session-response") })
	r := router.New()
	handlers.NewSessionHandler(store.ConfigStoreWithSessionAudit(), nil).RegisterRoutes(r)
	response := dashboardSessionRequest(r, "/api/session/login", `{"username":"admin","password":"session-test-password"}`, "")
	require.Equal(t, 500, response.Response.StatusCode())
	require.Empty(t, response.Response.Header.PeekCookie("token"))
	require.NotContains(t, string(response.Response.Body()), "sensitive-internal-database-diagnostic")
	require.Contains(t, string(response.Response.Body()), "dashboard session persistence failed")
	var count int64
	require.NoError(t, cs.DB().Table("sessions").Count(&count).Error)
	require.Zero(t, count)
	require.Empty(t, dashboardSessionAudits(t, store))
}

func TestDashboardSessionAuditConcurrentLogout(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	for _, expires := range []time.Time{time.Now().Add(time.Hour), time.Now().Add(-time.Hour)} {
		token := expires.String()
		require.NoError(t, cs.CreateSession(ctx, &configtables.SessionsTable{Token: token, ExpiresAt: expires}))
		other, err := NewStore(ctx, cs)
		require.NoError(t, err)
		writers := []configstore.ConfigStore{store.ConfigStoreWithSessionAudit(), other.ConfigStoreWithSessionAudit()}
		var group sync.WaitGroup
		failures := make(chan error, 12)
		for index := range 12 {
			group.Go(func() { failures <- writers[index%2].DeleteSession(ctx, token) })
		}
		group.Wait()
		close(failures)
		for err := range failures {
			require.NoError(t, err)
		}
		var events []AuditEvent
		require.NoError(t, cs.DB().Where("resource_id = ?", "sha256:"+encrypt.HashSHA256(token)).Find(&events).Error)
		require.Len(t, events, 1)
		require.Equal(t, "dashboard_session.deleted", events[0].Action)
		actor := "local-admin"
		if expires.Before(time.Now()) {
			actor = "anonymous"
		}
		require.Equal(t, actor, events[0].ActorID)
		session, err := cs.GetSession(ctx, token)
		require.NoError(t, err)
		require.Nil(t, session)
	}
}

func TestDashboardSessionAuditEncryptionAndFallback(t *testing.T) {
	testLogger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	encrypt.Init("isolated-dashboard-session-test-key", testLogger)
	t.Cleanup(func() { encrypt.Init("", testLogger) })
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	audited := store.ConfigStoreWithSessionAudit()
	const token = "plaintext-dashboard-session"
	session := &configtables.SessionsTable{Token: token, ExpiresAt: time.Now().Add(time.Hour)}
	require.NoError(t, audited.CreateSession(ctx, session))
	require.NotEqual(t, token, session.Token, "BeforeSave encrypts in place")
	ciphertext := session.Token
	require.NoError(t, audited.DeleteSession(ctx, ciphertext))
	require.Len(t, dashboardSessionAudits(t, store), 1, "ciphertext cannot act as a credential")
	require.NoError(t, audited.DeleteSession(ctx, token))
	events := dashboardSessionAudits(t, store)
	require.Len(t, events, 2)
	for _, event := range events {
		require.Equal(t, "sha256:"+encrypt.HashSHA256(token), event.ResourceID)
		require.NotContains(t, event.ResourceID, ciphertext)
	}
	for index, status := range []any{"plain_text", "", nil} {
		legacyToken := []string{"upstream-plain", "upstream-empty", "upstream-null"}[index]
		require.NoError(t, cs.DB().Exec("INSERT INTO sessions (token, expires_at, created_at, updated_at, encryption_status) VALUES (?, ?, ?, ?, ?)",
			legacyToken, time.Now().Add(time.Hour), time.Now(), time.Now(), status).Error)
		require.NoError(t, audited.DeleteSession(ctx, legacyToken))
		require.NoError(t, audited.DeleteSession(ctx, legacyToken))
	}
	require.Len(t, dashboardSessionAudits(t, store), 5)
	var count int64
	require.NoError(t, cs.DB().Table("sessions").Count(&count).Error)
	require.Zero(t, count)
}

func TestDashboardSessionAuditPersistsAfterReopen(t *testing.T) {
	ctx := context.Background()
	config := &configstore.Config{Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "session-audit.db")}}
	if socket := os.Getenv("ELYGATE_TEST_POSTGRES_SOCKET"); socket != "" {
		config = testPostgresControlPlaneConfig(t, socket)
	}
	cs, err := configstore.NewConfigStore(ctx, config, bifrost.NewDefaultLogger(schemas.LogLevelError))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, cs.Close(ctx)) })
	store, err := NewStore(ctx, cs)
	require.NoError(t, err)
	require.NoError(t, cs.UpdateAuthConfig(ctx, &configstore.AuthConfig{IsEnabled: true,
		AdminUserName: schemas.NewSecretVar("persistent-admin"), AdminPassword: schemas.NewSecretVar("invalid-hash")}))
	testLogger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	auth, err := handlers.InitAuthMiddleware(cs, nil, nil, "")
	require.NoError(t, err)
	r := router.New()
	handlers.NewSessionHandler(store.ConfigStoreWithSessionAudit(), nil).RegisterRoutes(r,
		auth.APIMiddleware(), NewHandler(store, nil).ManagementAuditMiddleware(testLogger))
	require.Equal(t, 401, dashboardSessionRequest(r, "/api/session/login", `{"username":"unknown"}`, "").Response.StatusCode())
	const token = "persistent-dashboard-session"
	require.NoError(t, store.ConfigStoreWithSessionAudit().CreateSession(ctx, &configtables.SessionsTable{
		Token: token, ExpiresAt: time.Now().Add(time.Hour)}))
	expected := dashboardSessionAudits(t, store)
	for _, deleted := range []bool{false, true} {
		require.NoError(t, cs.Close(ctx))
		cs, err = configstore.NewConfigStore(ctx, config, bifrost.NewDefaultLogger(schemas.LogLevelError))
		require.NoError(t, err)
		store, err = NewStore(ctx, cs)
		require.NoError(t, err)
		require.Equal(t, expected, dashboardSessionAudits(t, store))
		session, err := cs.GetSession(ctx, token)
		require.NoError(t, err)
		if deleted {
			require.Nil(t, session)
		} else {
			require.NotNil(t, session)
			require.NoError(t, store.ConfigStoreWithSessionAudit().DeleteSession(ctx, token))
			expected = dashboardSessionAudits(t, store)
			require.Len(t, expected, 3)
		}
	}
}

func BenchmarkDashboardSessionAuditLifecycle(b *testing.B) {
	for _, variant := range []string{"upstream", "audited"} {
		b.Run(variant, func(b *testing.B) {
			ctx := context.Background()
			cs, err := configstore.NewConfigStore(ctx, &configstore.Config{
				Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
				Config: &configstore.SQLiteConfig{Path: filepath.Join(b.TempDir(), "session-bench.db")},
			}, bifrost.NewDefaultLogger(schemas.LogLevelError))
			require.NoError(b, err)
			b.Cleanup(func() { require.NoError(b, cs.Close(ctx)) })
			store, err := NewStore(ctx, cs)
			require.NoError(b, err)
			writer := cs
			if variant == "audited" {
				writer = store.ConfigStoreWithSessionAudit()
			}
			b.ReportAllocs()
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				token := "benchmark-session-" + strconv.Itoa(index)
				err := writer.CreateSession(ctx, &configtables.SessionsTable{
					Token: token, ExpiresAt: time.Now().Add(time.Hour)})
				if err != nil {
					b.Fatal(err)
				}
				if err := writer.DeleteSession(ctx, token); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func TestManagementAuditPersistsRecordedChangesAfterFailedReload(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	h := NewHandler(store, nil)
	request := &fasthttp.RequestCtx{}
	request.SetUserValue(schemas.BifrostContextKeyUserID, "trusted-admin")
	request.Request.Header.Set("X-User-ID", "forged-admin")
	const secret = "one-time-provider-secret"
	h.ManagementAuditMiddleware(bifrost.NewDefaultLogger(schemas.LogLevelError))(func(ctx *fasthttp.RequestCtx) {
		lib.RecordAuditChange(ctx, "provider.created", "provider", "openai", secret, nil, map[string]string{"value": secret})
		lib.RecordAuditChange(ctx, "provider_key.created", "provider_key", "key-1", secret, nil, map[string]string{"value": secret})
		ctx.SetStatusCode(fasthttp.StatusInternalServerError)
		ctx.SetBodyString("runtime reload failed after commit")
	})(request)

	events, err := store.ListAudit(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, events, 2, "committed changes must not be lost because a later step failed")
	for _, event := range events {
		require.Equal(t, "trusted-admin", event.ActorID)
	}
	require.Equal(t, fasthttp.StatusInternalServerError, request.Response.StatusCode())
	encoded, err := json.Marshal(events)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), secret)
	require.Empty(t, request.Response.Header.Peek("X-Elygate-Audit-Status"))
}

func TestManagementAuditCapturesIdentityAndDoesNotMisattributeBypass(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	h := NewHandler(store, nil)
	for _, tc := range []struct {
		name   string
		local  bool
		bypass bool
		actor  string
		want   string
	}{
		{"local", true, false, "", "local-admin"},
		{"bypassed", true, true, "forged-user", "anonymous"},
		{"anonymous", false, false, "", "anonymous"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := &fasthttp.RequestCtx{}
			request.SetUserValue(schemas.IsLocalAdminContextKey, tc.local)
			request.SetUserValue(schemas.BifrostContextKeyAuthBypassed, tc.bypass)
			request.SetUserValue(schemas.BifrostContextKeyUserID, tc.actor)
			h.ManagementAuditMiddleware(bifrost.NewDefaultLogger(schemas.LogLevelError))(func(ctx *fasthttp.RequestCtx) {
				ctx.SetUserValue(schemas.BifrostContextKeyUserID, "changed-after-entry")
				lib.RecordAuditChange(ctx, "feature_flag.updated", "feature_flag", tc.name, "", nil, nil)
			})(request)
			var event AuditEvent
			require.NoError(t, store.db(context.Background()).First(&event, "resource_id = ?", tc.name).Error)
			require.Equal(t, tc.want, event.ActorID)
		})
	}
}

func TestManagementAuditFailurePreservesCommittedResponse(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	require.NoError(t, store.db(context.Background()).Migrator().DropTable(&AuditEvent{}))
	h := NewHandler(store, nil)
	request := &fasthttp.RequestCtx{}
	h.ManagementAuditMiddleware(bifrost.NewDefaultLogger(schemas.LogLevelError))(func(ctx *fasthttp.RequestCtx) {
		lib.RecordAuditChange(ctx, "provider_key.created", "provider_key", "key-1", "", nil, nil)
		ctx.SetStatusCode(fasthttp.StatusCreated)
		ctx.SetBodyString(`{"one_time_value":"keep-this-response"}`)
	})(request)
	require.Equal(t, fasthttp.StatusCreated, request.Response.StatusCode())
	require.JSONEq(t, `{"one_time_value":"keep-this-response"}`, string(request.Response.Body()))
	require.Equal(t, "failed", string(request.Response.Header.Peek("X-Elygate-Audit-Status")))

	request = &fasthttp.RequestCtx{}
	h.ManagementAuditMiddleware(bifrost.NewDefaultLogger(schemas.LogLevelError))(func(ctx *fasthttp.RequestCtx) {
		ctx.SetStatusCode(fasthttp.StatusBadRequest)
	})(request)
	require.Empty(t, request.Response.Header.Peek("X-Elygate-Audit-Status"), "rejected requests must not attempt persistence")
}

func TestManagementAuditSurvivesHandlerPanic(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	h := NewHandler(store, nil)
	request := &fasthttp.RequestCtx{}
	require.Panics(t, func() {
		h.ManagementAuditMiddleware(bifrost.NewDefaultLogger(schemas.LogLevelError))(func(ctx *fasthttp.RequestCtx) {
			lib.RecordAuditChange(ctx, "plugin.updated", "plugin", "governance", "", nil, nil)
			panic("runtime reload panic")
		})(request)
	})
	events, err := store.ListAudit(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, events, 1)
}

func TestManagementAuditBatchIsAtomicAndHashesCacheKeys(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	ctx := context.Background()
	changes := make([]configstore.AuditChange, 101)
	for i := range changes {
		changes[i] = configstore.AuditChange{EventName: "cache.cleared", TargetType: "cache", TargetID: "prompt-with-secret"}
	}
	require.NoError(t, store.appendManagementAudit(ctx, "admin", changes))
	var events []AuditEvent
	require.NoError(t, store.db(ctx).Find(&events).Error)
	require.Len(t, events, 101)
	for _, event := range events {
		require.Regexp(t, `^sha256:[0-9a-f]{64}$`, event.ResourceID)
		require.NotContains(t, event.ResourceID, "prompt-with-secret")
	}
	require.NoError(t, store.db(ctx).Where("1 = 1").Delete(&AuditEvent{}).Error)
	batches := 0
	db := store.db(ctx)
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:audit_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			batches++
			if batches == 2 {
				tx.AddError(errors.New("forced second audit batch failure"))
			}
		}
	}))
	t.Cleanup(func() { db.Callback().Create().Remove("test:audit_failure") })
	require.ErrorContains(t, store.appendManagementAudit(ctx, "admin", changes), "forced second audit batch failure")
	var count int64
	require.NoError(t, db.Model(&AuditEvent{}).Count(&count).Error)
	require.Zero(t, count, "the first batch must roll back when the second fails")
}

func TestManagementAuditUsesVerifiedBasicIdentity(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	h := NewHandler(store, nil)
	passwordHash, err := encrypt.Hash("test-admin-password")
	require.NoError(t, err)
	auth := &handlers.AuthMiddleware{}
	auth.UpdateAuthConfig(&configstore.AuthConfig{
		IsEnabled: true, AdminUserName: schemas.NewSecretVar("operator"), AdminPassword: schemas.NewSecretVar(passwordHash),
	})
	called := 0
	route := lib.ChainMiddlewares(func(ctx *fasthttp.RequestCtx) {
		called++
		lib.RecordAuditChange(ctx, "rss_feed.updated", "rss_feed", "feed-1", "", nil, nil)
	}, auth.APIMiddleware(), h.ManagementAuditMiddleware(bifrost.NewDefaultLogger(schemas.LogLevelError)))
	for _, password := range []string{"wrong-password", "test-admin-password"} {
		request := &fasthttp.RequestCtx{}
		request.Request.SetRequestURI("/api/rss/feeds/1")
		request.Request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("operator:"+password)))
		request.Request.Header.Set("X-User-ID", "forged-user")
		route(request)
	}
	require.Equal(t, 1, called, "invalid credentials must not reach the mutation")
	events, err := store.ListAudit(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, events, 1)
	require.Equal(t, "local-admin:operator", events[0].ActorID)
}

func TestManagementAuditFailureHeaderSurvivesPanicRecovery(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	require.NoError(t, store.db(context.Background()).Migrator().DropTable(&AuditEvent{}))
	h := NewHandler(store, nil)
	handlers.SetLogger(bifrost.NewDefaultLogger(schemas.LogLevelError))
	cors := handlers.NewCorsMiddleware(&lib.Config{})
	route := lib.ChainMiddlewares(func(ctx *fasthttp.RequestCtx) {
		lib.RecordAuditChange(ctx, "plugin.updated", "plugin", "governance", "", nil, nil)
		panic("runtime reload failed")
	}, handlers.RecoveryMiddleware(cors), h.ManagementAuditMiddleware(bifrost.NewDefaultLogger(schemas.LogLevelError)))
	request := &fasthttp.RequestCtx{}
	route(request)
	require.Equal(t, fasthttp.StatusInternalServerError, request.Response.StatusCode())
	require.Equal(t, "failed", string(request.Response.Header.Peek(lib.HeaderAuditStatus)))
}

type routingAuditTestStore struct {
	configstore.ConfigStore
	writeErr error
}

func (s routingAuditTestStore) CreateRoutingRule(ctx context.Context, rule *configtables.TableRoutingRule, tx ...*gorm.DB) error {
	if s.writeErr != nil {
		return s.writeErr
	}
	return s.ConfigStore.CreateRoutingRule(ctx, rule, tx...)
}

func (s routingAuditTestStore) UpdateRoutingRule(ctx context.Context, rule *configtables.TableRoutingRule, tx ...*gorm.DB) error {
	if s.writeErr != nil {
		return s.writeErr
	}
	return s.ConfigStore.UpdateRoutingRule(ctx, rule, tx...)
}

func (s routingAuditTestStore) UpdateComplexityAnalyzerConfig(ctx context.Context, cfg *configstore.ComplexityAnalyzerConfig, tx ...*gorm.DB) error {
	if s.writeErr != nil {
		return s.writeErr
	}
	return s.ConfigStore.UpdateComplexityAnalyzerConfig(ctx, cfg, tx...)
}

func (s routingAuditTestStore) ResetComplexityAnalyzerConfig(ctx context.Context, cfg *configstore.ComplexityAnalyzerConfig) (*configstore.ComplexityAnalyzerConfig, error) {
	if s.writeErr != nil {
		return nil, s.writeErr
	}
	return s.ConfigStore.ResetComplexityAnalyzerConfig(ctx, cfg)
}

type routingAuditTestManager struct {
	handlers.RoutingManager
	reloadErr   error
	panicReload bool
	reloadCalls int
}

func (*routingAuditTestManager) ValidateComplexityAnalyzerConfig(context.Context, *complexity.AnalyzerConfig) error {
	return nil
}

func (m *routingAuditTestManager) reload() error {
	m.reloadCalls++
	if m.panicReload {
		panic("routing test reload panic")
	}
	return m.reloadErr
}

func (m *routingAuditTestManager) ReloadRoutingRule(context.Context, string) error {
	return m.reload()
}

func (m *routingAuditTestManager) ReloadComplexityAnalyzerConfig(context.Context, *complexity.AnalyzerConfig) error {
	return m.reload()
}

func routingAuditStoredSnapshot(t *testing.T, cs configstore.ConfigStore) string {
	t.Helper()
	rules, err := cs.GetRoutingRules(context.Background())
	require.NoError(t, err)
	cfg, err := cs.GetComplexityAnalyzerConfig(context.Background())
	require.NoError(t, err)
	snapshot, err := json.Marshal(struct {
		Rules  []configtables.TableRoutingRule
		Config *configstore.ComplexityAnalyzerConfig
	}{rules, cfg})
	require.NoError(t, err)
	return string(snapshot)
}

func TestManagementRoutingAuditAfterPersistence(t *testing.T) {
	ctx := context.Background()
	testLogger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	handlers.SetLogger(testLogger)
	passwordHash, err := encrypt.Hash("routing-test-password")
	require.NoError(t, err)
	auth := &handlers.AuthMiddleware{}
	auth.UpdateAuthConfig(&configstore.AuthConfig{
		IsEnabled: true, AdminUserName: schemas.NewSecretVar("routing-admin"), AdminPassword: schemas.NewSecretVar(passwordHash),
	})
	authorization := "Basic " + base64.StdEncoding.EncodeToString([]byte("routing-admin:routing-test-password"))
	customConfig := complexity.DefaultAnalyzerConfig()
	customConfig.TierBoundaries.SimpleMedium = 0.12
	updateConfig := complexity.DefaultAnalyzerConfig()
	updateConfig.TierBoundaries.SimpleMedium = 0.21
	updateBody, err := json.Marshal(updateConfig)
	require.NoError(t, err)
	// Cases: success / reload error / reload panic / rejected persistence / failed audit persistence.
	for _, mutation := range []struct {
		name, method, path, body, action, resourceType string
	}{
		{"create", "POST", "/api/routing/rules", `{"name":"saved-rule","priority":1,"targets":[{"provider":"openai","weight":1}]}`, "routing_rule.created", "routing_rule"},
		{"update", "PUT", "/api/routing/rules/routing-audit", `{"description":"saved change"}`, "routing_rule.updated", "routing_rule"},
		{"complexity-update", "PUT", "/api/routing/complexity-analyzer-config", string(updateBody), "complexity_analyzer_config.updated", "complexity_analyzer_config"},
		{"complexity-reset", "POST", "/api/routing/complexity-analyzer-config/reset", `{}`, "complexity_analyzer_config.reset", "complexity_analyzer_config"},
	} {
		t.Run(mutation.name, func(t *testing.T) {
			for _, outcome := range []string{"success", "reload-error", "reload-panic", "write-error", "audit-error"} {
				t.Run(outcome, func(t *testing.T) {
					store, cs := testControlPlaneStore(t)
					require.NoError(t, cs.CreateRoutingRule(ctx, &configtables.TableRoutingRule{
						ID: "routing-audit", Name: "original-rule", Scope: "global", CelExpression: "true",
						Targets: []configtables.TableRoutingTarget{{Weight: 1}},
					}))
					require.NoError(t, cs.UpdateComplexityAnalyzerConfig(ctx, &customConfig))
					before := routingAuditStoredSnapshot(t, cs)
					manager := &routingAuditTestManager{}
					mutationStore := routingAuditTestStore{ConfigStore: cs}
					wantStatus := fasthttp.StatusOK
					switch outcome {
					case "reload-error", "audit-error":
						manager.reloadErr = errors.New("routing runtime unavailable")
						wantStatus = fasthttp.StatusInternalServerError
					case "reload-panic":
						manager.panicReload = true
						wantStatus = fasthttp.StatusInternalServerError
					case "write-error":
						mutationStore.writeErr = errors.New("routing write rejected")
						wantStatus = fasthttp.StatusInternalServerError
					}
					if outcome == "audit-error" {
						require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:routing-audit", func(tx *gorm.DB) {
							if tx.Statement.Table == (AuditEvent{}).TableName() {
								tx.AddError(errors.New("routing audit unavailable"))
							}
						}))
						t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:routing-audit") })
					}
					audit := NewHandler(store, nil)
					routingHandler, err := handlers.NewRoutingHandler(manager, mutationStore)
					require.NoError(t, err)
					routes := router.New()
					audit.RegisterRoutes(routes, auth.APIMiddleware())
					routingHandler.RegisterRoutes(routes, handlers.RecoveryMiddleware(handlers.NewCorsMiddleware(&lib.Config{})),
						auth.APIMiddleware(), audit.ManagementAuditMiddleware(testLogger))
					request := func(method, path, body, credentials string) *fasthttp.RequestCtx {
						var httpRequest fasthttp.Request
						response := &fasthttp.RequestCtx{}
						response.Init(&httpRequest, nil, nil)
						response.Request.Header.SetMethod(method)
						response.Request.SetRequestURI(path)
						response.Request.Header.SetContentType("application/json")
						response.Request.Header.Set("Authorization", credentials)
						response.Request.Header.Set("X-User-ID", "forged-routing-actor")
						response.Request.SetBodyString(body)
						routes.Handler(response)
						return response
					}
					require.Equal(t, fasthttp.StatusUnauthorized, request(mutation.method, mutation.path, mutation.body, "").Response.StatusCode())
					response := request(mutation.method, mutation.path, mutation.body, authorization)
					require.Equal(t, wantStatus, response.Response.StatusCode(), "%s", response.Response.Body())
					after := routingAuditStoredSnapshot(t, cs)
					if outcome == "write-error" {
						require.Equal(t, before, after)
						require.Zero(t, manager.reloadCalls)
					} else {
						require.NotEqual(t, before, after, "the mutation must remain committed even when runtime reload fails")
						require.Equal(t, 1, manager.reloadCalls)
					}
					require.Equal(t, fasthttp.StatusUnauthorized, request("GET", "/api/control-plane/audit-events", "", "").Response.StatusCode())
					feed := request("GET", "/api/control-plane/audit-events", "", authorization)
					require.Equal(t, fasthttp.StatusOK, feed.Response.StatusCode(), "%s", feed.Response.Body())
					var payload struct {
						Data []AuditEvent `json:"data"`
					}
					require.NoError(t, json.Unmarshal(feed.Response.Body(), &payload))
					switch outcome {
					case "write-error":
						require.Empty(t, payload.Data)
						require.Empty(t, response.UserValue(configstore.AuditChangesUserValueKey))
					case "audit-error":
						require.Empty(t, payload.Data)
						require.Equal(t, "failed", string(response.Response.Header.Peek(lib.HeaderAuditStatus)))
						require.Contains(t, string(response.Response.Body()), "restart bifrost")
					default:
						require.Len(t, payload.Data, 1)
						require.Equal(t, mutation.action, payload.Data[0].Action)
						require.Equal(t, mutation.resourceType, payload.Data[0].ResourceType)
						require.Equal(t, "local-admin:routing-admin", payload.Data[0].ActorID)
						changes, ok := response.UserValue(configstore.AuditChangesUserValueKey).([]configstore.AuditChange)
						require.True(t, ok)
						require.Len(t, changes, 1)
						require.Equal(t, changes[0].TargetID, payload.Data[0].ResourceID)
						require.Empty(t, response.Response.Header.Peek(lib.HeaderAuditStatus))
					}
					require.NotContains(t, string(feed.Response.Body()), "routing-test-password")
					require.NotContains(t, string(feed.Response.Body()), "saved change")
					require.NotContains(t, string(feed.Response.Body()), "forged-routing-actor")
				})
			}
		})
	}
}

type promptAuditReloader struct {
	calls       int
	panicReload bool
}

func (r *promptAuditReloader) ReloadPromptCache(context.Context) error {
	r.calls++
	if r.panicReload {
		panic("prompt audit reload unavailable")
	}
	return nil
}

type promptAuditMutation struct {
	name, method, path, body, action, resourceType, resourceID string
}

func promptAuditMutations(versionID, sessionID uint) []promptAuditMutation {
	version := strconv.FormatUint(uint64(versionID), 10)
	session := strconv.FormatUint(uint64(sessionID), 10)
	const messages = `,"messages":[{"role":"user","content":"private-prompt-content"}],"variables":{"token":"private-prompt-variable"}`
	return []promptAuditMutation{
		{"delete-folder", "DELETE", "/api/prompt-repo/folders/audit-folder", "", "prompt_folder.deleted", "prompt_folder", "audit-folder"},
		{"create-prompt", "POST", "/api/prompt-repo/prompts", `{"name":"new prompt"}`, "prompt.created", "prompt", ""},
		{"update-prompt", "PUT", "/api/prompt-repo/prompts/audit-prompt", `{"name":"updated prompt"}`, "prompt.updated", "prompt", "audit-prompt"},
		{"delete-prompt", "DELETE", "/api/prompt-repo/prompts/audit-prompt", "", "prompt.deleted", "prompt", "audit-prompt"},
		{"create-version", "POST", "/api/prompt-repo/prompts/audit-prompt/versions", `{"commit_message":"new version"` + messages + `}`, "prompt_version.created", "prompt_version", ""},
		{"delete-version", "DELETE", "/api/prompt-repo/versions/" + version, "", "prompt_version.deleted", "prompt_version", version},
		{"create-session", "POST", "/api/prompt-repo/prompts/audit-prompt/sessions", `{"name":"new session"` + messages + `}`, "prompt_session.created", "prompt_session", ""},
		{"update-session", "PUT", "/api/prompt-repo/sessions/" + session, `{"name":"updated session"` + messages + `}`, "prompt_session.updated", "prompt_session", session},
		{"delete-session", "DELETE", "/api/prompt-repo/sessions/" + session, "", "prompt_session.deleted", "prompt_session", session},
		{"rename-session", "PUT", "/api/prompt-repo/sessions/" + session + "/rename", `{"name":"renamed session"}`, "prompt_session.renamed", "prompt_session", session},
		{"commit-session", "POST", "/api/prompt-repo/sessions/" + session + "/commit", `{"commit_message":"published"}`, "prompt_session.committed", "prompt_session", session},
	}
}

func seedPromptAudit(t *testing.T, cs configstore.ConfigStore) (uint, uint) {
	t.Helper()
	ctx := context.Background()
	require.NoError(t, cs.CreateFolder(ctx, &configtables.TableFolder{ID: "audit-folder", Name: "original folder"}))
	folder := "audit-folder"
	require.NoError(t, cs.CreatePrompt(ctx, &configtables.TablePrompt{ID: "audit-prompt", Name: "original prompt", FolderID: &folder}))
	message := configtables.PromptMessage(`{"role":"user","content":"private-prompt-content"}`)
	version := &configtables.TablePromptVersion{PromptID: "audit-prompt", CommitMessage: "original",
		Variables: configtables.PromptVariables{"token": ""},
		Messages:  []configtables.TablePromptVersionMessage{{PromptID: "audit-prompt", Message: message}}}
	require.NoError(t, cs.CreatePromptVersion(ctx, version))
	session := &configtables.TablePromptSession{PromptID: "audit-prompt", Name: "original session", VersionID: &version.ID,
		Variables: configtables.PromptVariables{"token": "private-prompt-variable"},
		Messages:  []configtables.TablePromptSessionMessage{{PromptID: "audit-prompt", Message: message}}}
	require.NoError(t, cs.CreatePromptSession(ctx, session))
	return version.ID, session.ID
}

func promptAuditStoredSnapshot(t *testing.T, cs configstore.ConfigStore) string {
	t.Helper()
	var stored struct {
		Folders         []configtables.TableFolder
		Prompts         []configtables.TablePrompt
		Versions        []configtables.TablePromptVersion
		Sessions        []configtables.TablePromptSession
		VersionMessages []configtables.TablePromptVersionMessage
		SessionMessages []configtables.TablePromptSessionMessage
	}
	for _, rows := range []any{&stored.Folders, &stored.Prompts, &stored.Versions, &stored.Sessions, &stored.VersionMessages, &stored.SessionMessages} {
		require.NoError(t, cs.DB().Order("id").Find(rows).Error)
	}
	snapshot, err := json.Marshal(stored)
	require.NoError(t, err)
	return string(snapshot)
}

func promptAuditRequest(routes *router.Router, mutation promptAuditMutation, authorization string) *fasthttp.RequestCtx {
	var httpRequest fasthttp.Request
	request := &fasthttp.RequestCtx{}
	request.Init(&httpRequest, nil, nil)
	request.Request.Header.SetMethod(mutation.method)
	request.Request.SetRequestURI(mutation.path)
	request.Request.Header.SetContentType("application/json")
	request.Request.Header.Set("Authorization", authorization)
	request.Request.Header.Set("X-User-ID", "forged-prompt-actor")
	request.Request.SetBodyString(mutation.body)
	routes.Handler(request)
	return request
}

func failPromptAuditWrites(t *testing.T, cs configstore.ConfigStore, outcome string) {
	t.Helper()
	fail := func(tx *gorm.DB) {
		isAudit := tx.Statement.Table == (AuditEvent{}).TableName()
		if outcome == "write-error" && !isAudit || outcome == "audit-error-panic" && isAudit {
			tx.AddError(errors.New("prompt audit test write unavailable"))
		}
	}
	require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:prompt-audit", fail))
	require.NoError(t, cs.DB().Callback().Update().Before("gorm:update").Register("test:prompt-audit", fail))
	require.NoError(t, cs.DB().Callback().Delete().Before("gorm:delete").Register("test:prompt-audit", fail))
	t.Cleanup(func() {
		cs.DB().Callback().Create().Remove("test:prompt-audit")
		cs.DB().Callback().Update().Remove("test:prompt-audit")
		cs.DB().Callback().Delete().Remove("test:prompt-audit")
	})
}

func TestManagementPromptAuditAfterPersistence(t *testing.T) {
	testLogger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	handlers.SetLogger(testLogger)
	hash, err := encrypt.Hash("prompt-audit-test-password")
	require.NoError(t, err)
	auth := &handlers.AuthMiddleware{}
	auth.UpdateAuthConfig(&configstore.AuthConfig{
		IsEnabled: true, AdminUserName: schemas.NewSecretVar("prompt-admin"), AdminPassword: schemas.NewSecretVar(hash),
	})
	authorization := "Basic " + base64.StdEncoding.EncodeToString([]byte("prompt-admin:prompt-audit-test-password"))
	// Cases: all eleven reload-producing routes; committed success/panic, rejected writes, audit failure during panic.
	for index, spec := range promptAuditMutations(1, 1) {
		t.Run(spec.name, func(t *testing.T) {
			for _, outcome := range []string{"success", "reload-panic", "write-error", "audit-error-panic"} {
				t.Run(outcome, func(t *testing.T) {
					store, cs := testControlPlaneStore(t)
					version, session := seedPromptAudit(t, cs)
					mutation := promptAuditMutations(version, session)[index]
					before := promptAuditStoredSnapshot(t, cs)
					if outcome == "write-error" || outcome == "audit-error-panic" {
						failPromptAuditWrites(t, cs, outcome)
					}
					reloader := &promptAuditReloader{panicReload: outcome == "reload-panic" || outcome == "audit-error-panic"}
					audit := NewHandler(store, nil)
					routes := router.New()
					audit.RegisterRoutes(routes, auth.APIMiddleware())
					handlers.NewPromptsHandler(cs, reloader).RegisterRoutes(routes,
						handlers.RecoveryMiddleware(handlers.NewCorsMiddleware(&lib.Config{})),
						auth.APIMiddleware(), audit.ManagementAuditMiddleware(testLogger))
					require.Equal(t, 401, promptAuditRequest(routes, mutation, "").Response.StatusCode())
					require.Equal(t, before, promptAuditStoredSnapshot(t, cs))
					require.Zero(t, reloader.calls)
					response := promptAuditRequest(routes, mutation, authorization)
					status := 500
					if outcome == "success" {
						status = 200
					}
					require.Equal(t, status, response.Response.StatusCode(), "%s", response.Response.Body())
					if outcome == "write-error" {
						require.Equal(t, before, promptAuditStoredSnapshot(t, cs))
						require.Zero(t, reloader.calls)
					} else {
						require.NotEqual(t, before, promptAuditStoredSnapshot(t, cs))
						require.Equal(t, 1, reloader.calls)
					}
					assertPromptAuditFeed(t, routes, response, promptAuditExpectation{mutation, outcome, authorization})
				})
			}
		})
	}
}

type promptAuditExpectation struct {
	mutation               promptAuditMutation
	outcome, authorization string
}

func assertPromptAuditFeed(t *testing.T, routes *router.Router, response *fasthttp.RequestCtx, expected promptAuditExpectation) {
	t.Helper()
	feedRequest := promptAuditMutation{method: "GET", path: "/api/control-plane/audit-events"}
	require.Equal(t, 401, promptAuditRequest(routes, feedRequest, "").Response.StatusCode())
	feed := promptAuditRequest(routes, feedRequest, expected.authorization)
	require.Equal(t, 200, feed.Response.StatusCode(), "%s", feed.Response.Body())
	var payload struct {
		Data []AuditEvent `json:"data"`
	}
	require.NoError(t, json.Unmarshal(feed.Response.Body(), &payload))
	changes, _ := response.UserValue(configstore.AuditChangesUserValueKey).([]configstore.AuditChange)
	if expected.outcome == "write-error" {
		require.Empty(t, changes)
		require.Empty(t, payload.Data)
		return
	}
	require.Len(t, changes, 1)
	require.Equal(t, expected.mutation.action, changes[0].EventName)
	require.Equal(t, expected.mutation.resourceType, changes[0].TargetType)
	require.NotEmpty(t, changes[0].TargetID)
	if expected.mutation.resourceID != "" {
		require.Equal(t, expected.mutation.resourceID, changes[0].TargetID)
	}
	require.NotContains(t, string(changes[0].Before), "private-prompt-")
	require.NotContains(t, string(changes[0].After), "private-prompt-")
	if expected.outcome == "audit-error-panic" {
		require.Empty(t, payload.Data)
		require.Equal(t, "failed", string(response.Response.Header.Peek(lib.HeaderAuditStatus)))
	} else {
		require.Len(t, payload.Data, 1)
		require.Equal(t, expected.mutation.action, payload.Data[0].Action)
		require.Equal(t, expected.mutation.resourceType, payload.Data[0].ResourceType)
		require.Equal(t, changes[0].TargetID, payload.Data[0].ResourceID)
		require.Equal(t, "local-admin:prompt-admin", payload.Data[0].ActorID)
		require.Empty(t, response.Response.Header.Peek(lib.HeaderAuditStatus))
	}
	for _, forbidden := range []string{"private-prompt-", "prompt-audit-test-password", "forged-prompt-actor", "original session", "commit_message"} {
		require.NotContains(t, string(feed.Response.Body()), forbidden)
	}
}
