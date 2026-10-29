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
