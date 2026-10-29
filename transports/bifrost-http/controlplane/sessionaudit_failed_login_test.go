package controlplane

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/fasthttp/router"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

type failedLoginAuditLogger struct {
	schemas.Logger
	errors []string
}

func (l *failedLoginAuditLogger) Error(message string, args ...any) {
	l.errors = append(l.errors, fmt.Sprintf(message, args...))
}

func TestDashboardFailedLoginAuditRegisteredRoutes(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	ctx := context.Background()
	testLogger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	handlers.SetLogger(testLogger)
	hash, err := encrypt.Hash("failed-login-password-secret")
	require.NoError(t, err)
	authConfig := &configstore.AuthConfig{IsEnabled: true,
		AdminUserName: schemas.NewSecretVar("failed-login-admin-secret"), AdminPassword: schemas.NewSecretVar(hash)}
	require.NoError(t, cs.UpdateAuthConfig(ctx, authConfig))
	auth, err := handlers.InitAuthMiddleware(cs, nil, nil, "")
	require.NoError(t, err)
	audit := NewHandler(store, nil)
	r := router.New()
	audit.RegisterRoutes(r, auth.APIMiddleware())
	handlers.NewSessionHandler(store.ConfigStoreWithSessionAudit(), nil).RegisterRoutes(r,
		auth.APIMiddleware(), audit.ManagementAuditMiddleware(testLogger))

	// Cases: repeated rejection, valid Basic/cookie headers, API-key bypass, corrupt hash.
	for _, variant := range []string{"username", "password", "repeat", "basic", "cookie", "api-key", "hash-error"} {
		t.Run(variant, func(t *testing.T) {
			var httpRequest fasthttp.Request
			request := &fasthttp.RequestCtx{}
			request.Init(&httpRequest, nil, nil)
			request.Request.Header.SetMethod("POST")
			request.Request.SetRequestURI("/api/session/login")
			request.Request.Header.Set("X-User-ID", "forged-actor-secret")
			request.Request.Header.SetCookie("token", "cookie-secret")
			body := `{"username":"failed-login-admin-secret","password":"wrong-password-secret"}`
			message := "Invalid username or password"
			if variant == "username" {
				body = `{"username":"unverified-username-secret","password":"failed-login-password-secret"}`
			}
			if variant == "basic" {
				request.Request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("failed-login-admin-secret:failed-login-password-secret")))
			}
			if variant == "api-key" {
				request.SetUserValue(schemas.IsAPIKeyAuthContextKey, true)
				request.SetUserValue(schemas.IsLocalAdminContextKey, true)
				request.SetUserValue(schemas.BifrostContextKeyUserID, "trusted-actor-secret")
				request.SetUserValue(lib.FastHTTPUserValueManagementAuditActor, "verified-basic-actor-secret")
			}
			if variant == "hash-error" {
				authConfig.AdminPassword = schemas.NewSecretVar("corrupt-password-hash-secret")
				require.NoError(t, cs.UpdateAuthConfig(ctx, authConfig))
				message = "Unauthorized"
			}
			request.Request.SetBodyString(body)
			before := dashboardSessionAudits(t, store)
			r.Handler(request)
			require.Equal(t, 401, request.Response.StatusCode())
			require.Contains(t, string(request.Response.Body()), message)
			require.Empty(t, request.Response.Header.PeekCookie("token"))
			require.Empty(t, request.Response.Header.Peek(lib.HeaderAuditStatus))
			after := dashboardSessionAudits(t, store)
			require.Len(t, after, len(before)+1)
			event := after[len(after)-1]
			require.Equal(t, "dashboard_session.login_failed", event.Action)
			require.Equal(t, "anonymous", event.ActorID)
			require.Equal(t, "dashboard_session", event.ResourceType)
			require.Equal(t, "dashboard", event.ResourceID)
		})
	}
	var sessions int64
	require.NoError(t, cs.DB().Table("sessions").Count(&sessions).Error)
	require.Zero(t, sessions)
	authConfig.AdminPassword = schemas.NewSecretVar(hash)
	require.NoError(t, cs.UpdateAuthConfig(ctx, authConfig))
	for _, authorized := range []bool{false, true} {
		var httpRequest fasthttp.Request
		request := &fasthttp.RequestCtx{}
		request.Init(&httpRequest, nil, nil)
		request.Request.SetRequestURI("/api/control-plane/audit-events?limit=100")
		request.Request.Header.SetMethod("GET")
		if authorized {
			request.Request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("failed-login-admin-secret:failed-login-password-secret")))
		}
		r.Handler(request)
		if !authorized {
			require.Equal(t, 401, request.Response.StatusCode())
			continue
		}
		require.Equal(t, 200, request.Response.StatusCode())
		var payload struct {
			Data []AuditEvent `json:"data"`
		}
		require.NoError(t, json.Unmarshal(request.Response.Body(), &payload))
		require.ElementsMatch(t, dashboardSessionAudits(t, store), payload.Data)
		for _, secret := range []string{hash, "failed-login-admin-secret", "failed-login-password-secret", "unverified-username-secret", "wrong-password-secret", "cookie-secret", "forged-actor-secret", "trusted-actor-secret", "verified-basic-actor-secret", "corrupt-password-hash-secret"} {
			require.NotContains(t, string(request.Response.Body()), secret)
		}
	}
}

func TestDashboardFailedLoginAuditFailurePreservesUnauthorized(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	testLogger := &failedLoginAuditLogger{Logger: bifrost.NewDefaultLogger(schemas.LogLevelError)}
	handlers.SetLogger(testLogger)
	hash, err := encrypt.Hash("failure-test-password")
	require.NoError(t, err)
	const secret = "private-audit-database-diagnostic"
	authConfig := &configstore.AuthConfig{IsEnabled: true,
		AdminUserName: schemas.NewSecretVar("admin"), AdminPassword: schemas.NewSecretVar(hash)}
	require.NoError(t, cs.UpdateAuthConfig(context.Background(), authConfig))
	auth, err := handlers.InitAuthMiddleware(cs, nil, nil, "")
	require.NoError(t, err)
	failures := 0
	require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:failed-login-audit", func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			failures++
			tx.AddError(errors.New(secret))
		}
	}))
	t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:failed-login-audit") })
	audit := NewHandler(store, nil)
	r := router.New()
	handlers.NewSessionHandler(store.ConfigStoreWithSessionAudit(), nil).RegisterRoutes(r,
		auth.APIMiddleware(), audit.ManagementAuditMiddleware(testLogger))
	for index, body := range []string{`{"username":"unknown"}`, `{"username":"admin","password":"secret-password"}`, `{"username":"admin"}`} {
		message := "Invalid username or password"
		if index == 2 {
			authConfig.AdminPassword = schemas.NewSecretVar("invalid-hash")
			require.NoError(t, cs.UpdateAuthConfig(context.Background(), authConfig))
			message = "Unauthorized"
		}
		request := dashboardSessionRequest(r, "/api/session/login", body, "")
		require.Equal(t, 401, request.Response.StatusCode())
		expected := &fasthttp.RequestCtx{}
		handlers.SendError(expected, 401, message)
		require.Equal(t, string(expected.Response.Body()), string(request.Response.Body()))
		require.Equal(t, "failed", string(request.Response.Header.Peek(lib.HeaderAuditStatus)))
		require.NotContains(t, string(request.Response.Body()), secret)
		require.Empty(t, request.Response.Header.PeekCookie("token"))
	}
	require.Equal(t, 3, failures)
	require.Len(t, testLogger.errors, 3)
	for _, message := range testLogger.errors {
		require.Equal(t, "failed to persist management audit events; prior administrative changes may already be committed", message)
	}
	require.Empty(t, dashboardSessionAudits(t, store))
}

func BenchmarkDashboardFailedLoginAuditPersistence(b *testing.B) {
	for _, variant := range []string{"producer_only", "bridge_persisted"} {
		b.Run(variant, func(b *testing.B) {
			ctx := context.Background()
			cs, err := configstore.NewConfigStore(ctx, &configstore.Config{
				Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
				Config: &configstore.SQLiteConfig{Path: filepath.Join(b.TempDir(), "failed-login-bench.db")},
			}, bifrost.NewDefaultLogger(schemas.LogLevelError))
			require.NoError(b, err)
			b.Cleanup(func() { require.NoError(b, cs.Close(ctx)) })
			store, err := NewStore(ctx, cs)
			require.NoError(b, err)
			request := &fasthttp.RequestCtx{}
			route := fasthttp.RequestHandler(func(request *fasthttp.RequestCtx) {
				lib.RecordAuditChange(request, "dashboard_session.login_failed", "dashboard_session", "dashboard", "", nil, nil)
				request.SetStatusCode(401)
			})
			if variant == "bridge_persisted" {
				route = NewHandler(store, nil).ManagementAuditMiddleware(bifrost.NewDefaultLogger(schemas.LogLevelError))(route)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				request.ResetUserValues()
				route(request)
				if len(request.Response.Header.Peek(lib.HeaderAuditStatus)) != 0 {
					b.Fatal("audit persistence failed")
				}
			}
		})
	}
}

func TestDashboardFailedLoginAuditMixedBatchIdentity(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	require.NoError(t, store.appendManagementAudit(context.Background(), "trusted-admin", []configstore.AuditChange{
		{EventName: "feature_flag.updated", TargetType: "feature_flag", TargetID: "before"},
		{EventName: "dashboard_session.login_failed", TargetType: "dashboard_session", TargetID: "dashboard"},
		{EventName: "feature_flag.updated", TargetType: "feature_flag", TargetID: "after"},
	}))
	events, err := store.ListAudit(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, events, 3)
	for _, event := range events {
		if event.Action == "dashboard_session.login_failed" {
			require.Equal(t, "anonymous", event.ActorID)
		} else {
			require.Equal(t, "trusted-admin", event.ActorID)
		}
	}
}
