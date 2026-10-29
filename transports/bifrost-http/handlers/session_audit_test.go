package handlers

import (
	"context"
	"errors"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"golang.org/x/crypto/bcrypt"
)

type loginAuditConfigStore struct {
	configstore.ConfigStore
	auth        *configstore.AuthConfig
	authErr     error
	sessionErr  error
	sessionAdds int
}

func (s *loginAuditConfigStore) GetAuthConfig(context.Context) (*configstore.AuthConfig, error) {
	return s.auth, s.authErr
}

func (s *loginAuditConfigStore) CreateSession(context.Context, *tables.SessionsTable) error {
	s.sessionAdds++
	return s.sessionErr
}

func TestDashboardLoginFailureAuditProducer(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("login-password-secret"), bcrypt.MinCost)
	require.NoError(t, err)
	// Cases: all three credential rejections, non-credential errors, and success.
	for _, tc := range []struct {
		name         string
		body         string
		disabled     bool
		missingAuth  bool
		missingStore bool
		badHash      bool
		authErr      error
		sessionErr   error
		status       int
		message      string
		event        bool
		sessionAdds  int
	}{
		{name: "wrong username", body: `{"username":"unverified-username","password":"login-password-secret"}`, status: 401, message: "Invalid username or password", event: true},
		{name: "wrong password", body: `{"username":"login-admin-secret","password":"wrong-password-secret"}`, status: 401, message: "Invalid username or password", event: true},
		{name: "hash error", body: `{"username":"login-admin-secret","password":"login-password-secret"}`, badHash: true, status: 401, message: "Unauthorized", event: true},
		{name: "malformed", body: `{`, status: 400, message: "Invalid request payload"},
		{name: "disabled", body: `{}`, disabled: true, status: 403, message: "Authentication is not enabled"},
		{name: "missing auth", body: `{}`, missingAuth: true, status: 403, message: "Authentication is not enabled"},
		{name: "missing store", body: `{}`, missingStore: true, status: 403, message: "Authentication is not enabled"},
		{name: "config read error", body: `{}`, authErr: errors.New("config unavailable"), status: 500, message: "Failed to get auth config"},
		{name: "session write error", body: `{"username":"login-admin-secret","password":"login-password-secret"}`, sessionErr: errors.New("session unavailable"), status: 500, message: "Failed to create session", sessionAdds: 1},
		{name: "success", body: `{"username":"login-admin-secret","password":"login-password-secret"}`, status: 200, message: "Login successful", sessionAdds: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &loginAuditConfigStore{
				auth: &configstore.AuthConfig{IsEnabled: !tc.disabled,
					AdminUserName: schemas.NewSecretVar("login-admin-secret"), AdminPassword: schemas.NewSecretVar(string(hash))},
				authErr: tc.authErr, sessionErr: tc.sessionErr,
			}
			if tc.badHash {
				store.auth.AdminPassword = schemas.NewSecretVar("invalid-hash-secret")
			}
			if tc.missingAuth {
				store.auth = nil
			}
			handler := &SessionHandler{configStore: store}
			if tc.missingStore {
				handler.configStore = nil
			}
			request := &fasthttp.RequestCtx{}
			request.Request.SetBodyString(tc.body)
			handler.login(request)
			require.Equal(t, tc.status, request.Response.StatusCode())
			require.Contains(t, string(request.Response.Body()), tc.message)
			require.Equal(t, tc.sessionAdds, store.sessionAdds)
			if !tc.event {
				require.Empty(t, auditChanges(t, request))
				return
			}
			change := requireSingleAuditChange(t, request, "dashboard_session.login_failed")
			expected := &fasthttp.RequestCtx{}
			SendError(expected, tc.status, tc.message)
			require.Equal(t, string(expected.Response.Body()), string(request.Response.Body()))
			require.Equal(t, configstore.AuditChange{
				EventName: "dashboard_session.login_failed", TargetType: "dashboard_session", TargetID: "dashboard",
			}, change)
			for _, secret := range []string{"login-admin-secret", "login-password-secret", "unverified-username", "wrong-password-secret", "invalid-hash-secret", string(hash)} {
				requireNoSecret(t, change, secret)
			}
			require.Empty(t, request.Response.Header.PeekCookie("token"))
		})
	}
}

func BenchmarkDashboardLoginAudit(b *testing.B) {
	hash, err := bcrypt.GenerateFromPassword([]byte("benchmark-password"), bcrypt.MinCost)
	require.NoError(b, err)
	for _, variant := range []string{"wrong_username", "wrong_password", "hash_error", "success"} {
		b.Run(variant, func(b *testing.B) {
			store := &loginAuditConfigStore{auth: &configstore.AuthConfig{IsEnabled: true,
				AdminUserName: schemas.NewSecretVar("admin"), AdminPassword: schemas.NewSecretVar(string(hash))}}
			body := `{"username":"admin","password":"benchmark-password"}`
			if variant == "wrong_username" {
				body = `{"username":"unknown","password":"benchmark-password"}`
			} else if variant == "wrong_password" {
				body = `{"username":"admin","password":"wrong"}`
			} else if variant == "hash_error" {
				store.auth.AdminPassword = schemas.NewSecretVar("invalid")
			}
			handler := &SessionHandler{configStore: store}
			request := &fasthttp.RequestCtx{}
			request.Request.SetBodyString(body)
			b.ReportAllocs()
			for b.Loop() {
				request.ResetUserValues()
				request.Response.Reset()
				handler.login(request)
			}
		})
	}
}
