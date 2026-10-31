package controlplane

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
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

// Only the config/auth publication callbacks used by these requests are supplied.
// Unexpected framework/runtime callback use fails rather than silently succeeding.
type dashboardFlushConfigManager struct {
	handlers.ConfigManager
	config  *lib.Config
	auth    *handlers.AuthMiddleware
	saveErr error
}

func (m dashboardFlushConfigManager) ReloadClientConfigFromConfigStore(ctx context.Context) error {
	persisted, err := m.config.ConfigStore.GetClientConfig(ctx)
	if err == nil {
		*m.config.ClientConfig = *persisted
	}
	return err
}

func (m dashboardFlushConfigManager) UpdateAuthConfig(ctx context.Context, auth *configstore.AuthConfig) error {
	if m.saveErr != nil {
		return m.saveErr
	}
	if err := m.config.ConfigStore.UpdateAuthConfig(ctx, auth); err != nil {
		return err
	}
	m.auth.UpdateAuthConfig(auth)
	m.auth.ClearBootstrapToken()
	return nil
}

func (m dashboardFlushConfigManager) ValidateSetupToken(token string) bool {
	return m.auth.CheckBootstrapToken(token)
}

func (m dashboardFlushConfigManager) ValidateConfiguredSetupToken(token string) bool {
	return m.auth.CheckConfiguredSetupToken(token)
}

func TestDashboardSessionFlushAuditConfigRoutes(t *testing.T) {
	const (
		password   = "Route-Flush-Password-123!"
		setupToken = "test-only-flush-setup-token"
		token      = "flush-route-bearer-sensitive-token"
	)
	hash, err := encrypt.Hash(password)
	require.NoError(t, err)
	for _, tc := range []struct {
		name, state, credential, authJSON, failure string
		wantStatus, wantFlusherCalls               int
		wantActor                                  string
	}{
		{"basic username", "enabled", "basic", `{"is_enabled":true,"admin_username":"replacement-admin"}`, "", 200, 1, "local-admin:old-admin"},
		{"basic disable", "enabled", "basic", `{"is_enabled":false}`, "", 200, 1, "local-admin:old-admin"},
		{"bearer username", "enabled", "bearer", `{"is_enabled":true,"admin_username":"replacement-admin"}`, "", 200, 1, "local-admin"},
		{"cookie disable", "enabled", "cookie", `{"is_enabled":false}`, "", 200, 1, "local-admin"},
		{"unchanged", "enabled", "basic", `{"is_enabled":true,"admin_username":"old-admin","admin_password":"********"}`, "", 200, 0, ""},
		{"auth omitted", "enabled", "basic", "", "", 200, 0, ""},
		{"unauthorized", "enabled", "", `{"is_enabled":false}`, "", 401, 0, ""},
		{"bypass enable", "disabled", "", `{"is_enabled":true,"admin_username":"old-admin","current_password":"` + password + `"}`, "", 200, 1, "anonymous"},
		{"bypass rejected", "disabled", "", `{"is_enabled":true,"admin_username":"old-admin"}`, "", 403, 0, ""},
		{"disabled setup enable", "disabled", "setup", `{"is_enabled":true,"admin_username":"old-admin"}`, "", 200, 1, "anonymous"},
		{"first setup", "unset", "setup", `{"is_enabled":true,"admin_username":"new-admin","admin_password":"` + password + `"}`, "", 200, 1, "anonymous"},
		{"setup rejected", "unset", "", `{"is_enabled":true,"admin_username":"new-admin","admin_password":"` + password + `"}`, "", 401, 0, ""},
		{"failed save", "enabled", "basic", `{"is_enabled":false}`, "save", 500, 0, ""},
		{"delete failure", "enabled", "basic", `{"is_enabled":false}`, "delete", 500, 1, ""},
		{"audit failure", "enabled", "basic", `{"is_enabled":false}`, "audit", 500, 1, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store, cs := testControlPlaneStore(t)
			ctx := context.Background()
			testLogger := bifrost.NewDefaultLogger(schemas.LogLevelError)
			handlers.SetLogger(testLogger)
			if tc.state != "unset" {
				require.NoError(t, cs.UpdateAuthConfig(ctx, &configstore.AuthConfig{
					IsEnabled: tc.state == "enabled", AdminUserName: schemas.NewSecretVar("old-admin"), AdminPassword: schemas.NewSecretVar(hash),
				}))
			}
			require.NoError(t, cs.CreateSession(ctx, &configtables.SessionsTable{Token: token, ExpiresAt: time.Now().Add(time.Hour)}))
			auth, err := handlers.InitAuthMiddleware(cs, nil, nil, setupToken)
			require.NoError(t, err)
			// Keep unrelated client settings identical to the request's decoded defaults.
			var initialClient configstore.ClientConfig
			require.NoError(t, json.Unmarshal([]byte(`{"log_retention_days":7}`), &initialClient))
			require.NoError(t, cs.UpdateClientConfig(ctx, &initialClient))
			client, err := cs.GetClientConfig(ctx)
			require.NoError(t, err)
			cfg := &lib.Config{ConfigStore: cs, ClientConfig: client}
			manager := dashboardFlushConfigManager{config: cfg, auth: auth}
			if tc.failure == "save" {
				manager.saveErr = errors.New("auth save failed")
			}
			injectDashboardFlushFailure(t, cs, tc.failure)
			handler := handlers.NewConfigHandler(manager, cfg)
			flusherCalls := 0
			handler.SetSessionFlusher(func(request *fasthttp.RequestCtx) error {
				flusherCalls++
				return store.FlushDashboardSessions(request)
			})
			r := router.New()
			audit := NewHandler(store, nil)
			middlewares := []schemas.BifrostHTTPMiddleware{auth.APIMiddleware(), audit.ManagementAuditMiddleware(testLogger)}
			// OSS uses the setup gate; enterprise can intentionally expose the auth-off API.
			if tc.state != "disabled" || tc.credential == "setup" {
				middlewares = append([]schemas.BifrostHTTPMiddleware{auth.SetupLockMiddleware()}, middlewares...)
			}
			handler.RegisterRoutes(r, middlewares...)
			audit.RegisterRoutes(r, auth.APIMiddleware())
			var httpRequest fasthttp.Request
			request := &fasthttp.RequestCtx{}
			request.Init(&httpRequest, nil, nil)
			request.Request.Header.SetMethod("PUT")
			request.Request.Header.SetContentType("application/json")
			request.Request.Header.Set("X-User-ID", "forged-route-actor")
			request.Request.SetRequestURI("/api/config")
			switch tc.credential {
			case "basic":
				request.Request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("old-admin:"+password)))
			case "bearer":
				request.Request.Header.Set("Authorization", "Bearer "+token)
			case "cookie":
				request.Request.Header.SetCookie("token", token)
			case "setup":
				request.Request.Header.Set(handlers.SetupTokenHeader, setupToken)
			}
			body := `{"client_config":{"log_retention_days":7}`
			if tc.authJSON != "" {
				body += `,"auth_config":` + tc.authJSON
			}
			request.Request.SetBodyString(body + `}`)
			r.Handler(request)
			require.Equal(t, tc.wantStatus, request.Response.StatusCode(), "body=%s", request.Response.Body())
			require.Equal(t, tc.wantFlusherCalls, flusherCalls)
			if tc.credential == "setup" {
				require.Equal(t, true, request.UserValue(schemas.BifrostContextKeySetupTokenAuthenticated))
				require.Equal(t, true, request.UserValue(schemas.IsLocalAdminContextKey))
				require.NotEqual(t, true, request.UserValue(schemas.BifrostContextKeyAuthBypassed))
			}
			if tc.state == "disabled" && tc.credential == "" {
				require.Equal(t, true, request.UserValue(schemas.BifrostContextKeyAuthBypassed))
			}
			require.Empty(t, request.Response.Header.Peek(lib.HeaderAuditStatus), "flush and bridge failures are distinct")
			events := dashboardSessionAudits(t, store)
			if tc.wantActor == "" {
				require.Empty(t, events)
				require.EqualValues(t, 1, dashboardSessionCount(t, cs))
			} else {
				require.Len(t, events, 1)
				require.Equal(t, tc.wantActor, events[0].ActorID)
				require.Equal(t, "dashboard_sessions.flushed", events[0].Action)
				require.Equal(t, "all", events[0].ResourceID)
				require.Zero(t, dashboardSessionCount(t, cs))
			}
			allEvents, err := store.ListAudit(ctx, 100)
			require.NoError(t, err)
			authEvents := 0
			for _, event := range allEvents {
				if event.Action == "auth_config.updated" {
					authEvents++
					if tc.credential == "setup" {
						require.Equal(t, "anonymous", event.ActorID, "setup credentials do not identify an administrator")
					}
				}
			}
			if tc.wantFlusherCalls == 1 || tc.name == "unchanged" {
				require.Equal(t, 1, authEvents, "flush failure must not erase the saved-config audit")
			} else {
				require.Zero(t, authEvents)
			}
			encoded, err := json.Marshal(allEvents)
			require.NoError(t, err)
			for _, secret := range []string{password, hash, token, setupToken, "replacement-admin", "forged-route-actor", "sensitive-flush-database-diagnostic"} {
				require.NotContains(t, string(encoded), secret)
				require.NotContains(t, string(request.Response.Body()), secret)
			}
			if tc.failure == "delete" || tc.failure == "audit" {
				persisted, err := cs.GetAuthConfig(ctx)
				require.NoError(t, err)
				require.False(t, persisted.IsEnabled, "successful config save is not part of flush rollback")
				require.Contains(t, string(request.Response.Body()), "dashboard session persistence failed")
			}
			// A revoked bearer no longer grants access to the audit feed while auth stays enabled.
			if tc.name == "bearer username" {
				var feedRequest fasthttp.Request
				feed := &fasthttp.RequestCtx{}
				feed.Init(&feedRequest, nil, nil)
				feed.Request.Header.SetMethod("GET")
				feed.Request.SetRequestURI("/api/control-plane/audit-events")
				feed.Request.Header.Set("Authorization", "Bearer "+token)
				r.Handler(feed)
				require.Equal(t, 401, feed.Response.StatusCode())
			}
		})
	}
}

func injectDashboardFlushFailure(t *testing.T, cs configstore.ConfigStore, failure string) {
	t.Helper()
	if failure == "delete" {
		require.NoError(t, cs.DB().Callback().Delete().Before("gorm:delete").Register("test:flush-route-delete", func(tx *gorm.DB) {
			if tx.Statement.Table == "sessions" {
				tx.AddError(errors.New("sensitive-flush-database-diagnostic"))
			}
		}))
		t.Cleanup(func() { cs.DB().Callback().Delete().Remove("test:flush-route-delete") })
	}
	if failure == "audit" {
		require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:flush-route-audit", func(tx *gorm.DB) {
			event, ok := tx.Statement.Dest.(*AuditEvent)
			if ok && event.Action == "dashboard_sessions.flushed" {
				tx.AddError(errors.New("sensitive-flush-database-diagnostic"))
			}
		}))
		t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:flush-route-audit") })
	}
}
