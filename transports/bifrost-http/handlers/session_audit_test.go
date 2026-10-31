package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

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

func TestDashboardSetupSessionIssuanceAuditProducer(t *testing.T) {
	const setupToken = "setup-issuance-test-token"
	// Cases: successful issuance, wrong/missing token, missing gate, and inactive gate.
	for _, state := range []string{"success", "wrong token", "missing token", "missing gate", "inactive gate"} {
		t.Run(state, func(t *testing.T) {
			auth := &AuthMiddleware{}
			configuredToken := setupToken
			auth.setupToken.Store(&configuredToken)
			handler := &SessionHandler{setupLock: auth}
			request := &fasthttp.RequestCtx{}
			request.Request.Header.Set(SetupTokenHeader, setupToken)
			status := fasthttp.StatusOK
			switch state {
			case "wrong token":
				request.Request.Header.Set(SetupTokenHeader, "wrong-test-token")
				status = fasthttp.StatusForbidden
			case "missing token":
				request.Request.Header.Del(SetupTokenHeader)
				status = fasthttp.StatusForbidden
			case "missing gate":
				handler.setupLock = nil
				status = fasthttp.StatusConflict
			case "inactive gate":
				auth.UpdateAuthConfig(&configstore.AuthConfig{IsEnabled: true})
				status = fasthttp.StatusConflict
			}
			handler.startSetupSession(request)
			require.Equal(t, status, request.Response.StatusCode())
			if state != "success" {
				require.Empty(t, auditChanges(t, request))
				require.Empty(t, request.Response.Header.PeekCookie(SetupSessionCookie))
				return
			}
			require.Equal(t, []configstore.AuditChange{{
				EventName: "dashboard_setup_session.created", TargetType: "dashboard_setup_session", TargetID: "setup",
			}}, auditChanges(t, request))
			cookie := fasthttp.Cookie{}
			cookie.SetKey(SetupSessionCookie)
			require.True(t, request.Response.Header.Cookie(&cookie))
			require.True(t, auth.validSetupSession(string(cookie.Value()), time.Now()))
			requireNoSecret(t, auditChanges(t, request)[0], string(cookie.Value()))
			requireNoSecret(t, auditChanges(t, request)[0], setupToken)
		})
	}
}

func TestDashboardWSTicketIssuanceAuditProducer(t *testing.T) {
	// Cases: memory/signed issuance, auth-off dummy session, missing identity/store.
	for _, state := range []string{"memory", "signed", "auth disabled", "missing identity", "missing store"} {
		t.Run(state, func(t *testing.T) {
			tickets := NewWSTicketStore()
			t.Cleanup(tickets.Stop)
			if state == "signed" {
				tickets = NewSignedWSTicketStore([]byte("session-audit-test-signing-key"))
				t.Cleanup(tickets.Stop)
			}
			handler := &SessionHandler{wsTicketStore: tickets}
			request := &fasthttp.RequestCtx{}
			sessionToken := "ws-issuance-test-session"
			request.SetUserValue(schemas.BifrostContextKeySessionToken, sessionToken)
			status := fasthttp.StatusOK
			switch state {
			case "auth disabled":
				sessionToken = "dummy-session"
				request.SetUserValue(schemas.BifrostContextKeySessionToken, "")
			case "missing identity":
				request.RemoveUserValue(schemas.BifrostContextKeySessionToken)
				status = fasthttp.StatusUnauthorized
			case "missing store":
				handler.wsTicketStore = nil
				status = fasthttp.StatusServiceUnavailable
			}
			handler.issueWSTicket(request)
			require.Equal(t, status, request.Response.StatusCode())
			if status != fasthttp.StatusOK {
				require.Empty(t, auditChanges(t, request))
				return
			}
			require.Equal(t, []configstore.AuditChange{{
				EventName: "dashboard_ws_ticket.created", TargetType: "dashboard_ws_ticket", TargetID: "ws-ticket",
			}}, auditChanges(t, request))
			var response struct {
				Ticket string `json:"ticket"`
			}
			require.NoError(t, json.Unmarshal(request.Response.Body(), &response))
			require.NotEmpty(t, response.Ticket)
			require.Equal(t, sessionToken, tickets.Consume(response.Ticket))
			requireNoSecret(t, auditChanges(t, request)[0], response.Ticket)
			requireNoSecret(t, auditChanges(t, request)[0], sessionToken)
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

func BenchmarkDashboardIssuanceAudit(b *testing.B) {
	for _, variant := range []string{"setup", "ws-memory", "ws-signed"} {
		b.Run(variant, func(b *testing.B) {
			setupToken := "benchmark-setup-token"
			auth := &AuthMiddleware{}
			auth.setupToken.Store(&setupToken)
			tickets := NewWSTicketStore()
			b.Cleanup(tickets.Stop)
			if variant == "ws-signed" {
				tickets = NewSignedWSTicketStore([]byte("benchmark-ticket-signing-key"))
				b.Cleanup(tickets.Stop)
			}
			handler := &SessionHandler{setupLock: auth, wsTicketStore: tickets}
			request := &fasthttp.RequestCtx{}
			request.Request.Header.Set(SetupTokenHeader, setupToken)
			b.ReportAllocs()
			for b.Loop() {
				request.ResetUserValues()
				request.Response.Reset()
				if variant == "setup" {
					handler.startSetupSession(request)
				} else {
					request.SetUserValue(schemas.BifrostContextKeySessionToken, "benchmark-session")
					handler.issueWSTicket(request)
					var payload struct {
						Ticket string `json:"ticket"`
					}
					if err := json.Unmarshal(request.Response.Body(), &payload); err != nil {
						b.Fatal(err)
					}
					if tickets.Consume(payload.Ticket) != "benchmark-session" {
						b.Fatal("issued ticket is not usable")
					}
				}
			}
		})
	}
}
