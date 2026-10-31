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

func issuanceAuditTickets(t *testing.T, mode string) *handlers.WSTicketStore {
	t.Helper()
	var tickets *handlers.WSTicketStore
	if mode == "signed" {
		tickets = handlers.NewSignedWSTicketStore([]byte("issuance-test-signing-key"))
	} else {
		tickets = handlers.NewWSTicketStore()
	}
	t.Cleanup(tickets.Stop)
	return tickets
}

func issuanceAuditRequest(r *router.Router, path string, headers map[string]string) *fasthttp.RequestCtx {
	request := &fasthttp.RequestCtx{}
	request.Init(&fasthttp.Request{}, nil, nil)
	request.Request.Header.SetMethod("POST")
	if path == "/api/control-plane/audit-events" {
		request.Request.Header.SetMethod("GET")
	}
	request.Request.SetRequestURI(path)
	request.Request.Header.Set("X-User-ID", "forged-issuance-actor")
	for name, value := range headers {
		request.Request.Header.Set(name, value)
	}
	r.Handler(request)
	return request
}

func consumeIssuanceAuditTicket(t *testing.T, response *fasthttp.RequestCtx, tickets *handlers.WSTicketStore, session string) string {
	t.Helper()
	require.Equal(t, 200, response.Response.StatusCode(), "%s", response.Response.Body())
	var payload struct {
		Ticket string `json:"ticket"`
	}
	require.NoError(t, json.Unmarshal(response.Response.Body(), &payload))
	require.NotEmpty(t, payload.Ticket)
	require.Equal(t, session, tickets.Consume(payload.Ticket))
	return payload.Ticket
}

func TestDashboardIssuanceAuditRegisteredRoutes(t *testing.T) {
	// Cases: both ticket modes, setup header/cookie, session bearer/cookie, Basic rejection, auth bypass.
	for _, mode := range []string{"memory", "signed"} {
		for _, identity := range []string{"setup", "session", "bypass"} {
			t.Run(mode+"/"+identity, func(t *testing.T) {
				store, cs := testControlPlaneStore(t)
				logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
				handlers.SetLogger(logger)
				hash, err := encrypt.Hash("issuance-test-password")
				require.NoError(t, err)
				require.NoError(t, cs.UpdateAuthConfig(context.Background(), &configstore.AuthConfig{
					IsEnabled: identity == "session", AdminUserName: schemas.NewSecretVar("issuance-admin"),
					AdminPassword: schemas.NewSecretVar(hash),
				}))
				tickets := issuanceAuditTickets(t, mode)
				auth, err := handlers.InitAuthMiddleware(cs, tickets, nil, "issuance-setup-token")
				require.NoError(t, err)
				audit := NewHandler(store, nil)
				routes := router.New()
				middlewares := []schemas.BifrostHTTPMiddleware{auth.APIMiddleware(), audit.ManagementAuditMiddleware(logger)}
				sessionHandler := handlers.NewSessionHandler(store.ConfigStoreWithSessionAudit(), tickets)
				if identity == "setup" {
					sessionHandler.SetSetupLock(auth)
					middlewares = append([]schemas.BifrostHTTPMiddleware{auth.SetupLockMiddleware()}, middlewares...)
				}
				sessionHandler.RegisterRoutes(routes, middlewares...)
				audit.RegisterRoutes(routes, middlewares...)
				headers := map[string]string{}
				session := "dummy-session"
				actor := "anonymous"
				expectedEvents := 2
				if identity == "setup" {
					rejected := issuanceAuditRequest(routes, "/api/session/setup", map[string]string{handlers.SetupTokenHeader: "wrong-token"})
					require.Equal(t, 403, rejected.Response.StatusCode())
					issued := issuanceAuditRequest(routes, "/api/session/setup", map[string]string{handlers.SetupTokenHeader: "issuance-setup-token"})
					require.Equal(t, 200, issued.Response.StatusCode())
					var cookie fasthttp.Cookie
					cookie.SetKey(handlers.SetupSessionCookie)
					require.True(t, issued.Response.Header.Cookie(&cookie))
					headers[handlers.SetupTokenHeader] = "issuance-setup-token"
					response := issuanceAuditRequest(routes, "/api/session/ws-ticket", headers)
					consumeIssuanceAuditTicket(t, response, tickets, session)
					require.Empty(t, response.Response.Header.Peek(lib.HeaderAuditStatus))
					headers = map[string]string{"Cookie": handlers.SetupSessionCookie + "=" + string(cookie.Value())}
					expectedEvents = 3
				}
				if identity == "session" {
					actor = "local-admin"
					session = "issuance-dashboard-session"
					require.NoError(t, cs.CreateSession(context.Background(), &configtables.SessionsTable{
						Token: session, ExpiresAt: time.Now().Add(time.Hour),
					}))
					basic := "Basic " + base64.StdEncoding.EncodeToString([]byte("issuance-admin:issuance-test-password"))
					for _, rejectedHeaders := range []map[string]string{nil, {"Authorization": basic}} {
						rejected := issuanceAuditRequest(routes, "/api/session/ws-ticket", rejectedHeaders)
						require.Equal(t, 401, rejected.Response.StatusCode())
					}
					events, err := store.ListAudit(context.Background(), 100)
					require.NoError(t, err)
					require.Empty(t, events)
					headers["Authorization"] = "Bearer " + session
					response := issuanceAuditRequest(routes, "/api/session/ws-ticket", headers)
					consumeIssuanceAuditTicket(t, response, tickets, session)
					require.Empty(t, response.Response.Header.Peek(lib.HeaderAuditStatus))
					headers = map[string]string{"Cookie": "token=" + session}
				}
				if identity == "bypass" {
					response := issuanceAuditRequest(routes, "/api/session/ws-ticket", headers)
					consumeIssuanceAuditTicket(t, response, tickets, session)
				}
				response := issuanceAuditRequest(routes, "/api/session/ws-ticket", headers)
				ticket := consumeIssuanceAuditTicket(t, response, tickets, session)
				require.Empty(t, response.Response.Header.Peek(lib.HeaderAuditStatus))
				events, err := store.ListAudit(context.Background(), 100)
				require.NoError(t, err)
				require.Len(t, events, expectedEvents)
				for _, event := range events {
					require.Equal(t, actor, event.ActorID)
					if event.Action == "dashboard_setup_session.created" {
						require.Equal(t, "dashboard_setup_session", event.ResourceType)
						require.Equal(t, "setup", event.ResourceID)
					} else {
						require.Equal(t, "dashboard_ws_ticket.created", event.Action)
						require.Equal(t, "dashboard_ws_ticket", event.ResourceType)
						require.Equal(t, "ws-ticket", event.ResourceID)
					}
				}
				feed := issuanceAuditRequest(routes, "/api/control-plane/audit-events", headers)
				if identity == "bypass" {
					require.NotEqual(t, 200, feed.Response.StatusCode())
				} else {
					require.Equal(t, 200, feed.Response.StatusCode(), "%s", feed.Response.Body())
					var payload struct {
						Data []AuditEvent `json:"data"`
					}
					require.NoError(t, json.Unmarshal(feed.Response.Body(), &payload))
					require.ElementsMatch(t, events, payload.Data)
				}
				encoded, err := json.Marshal(events)
				require.NoError(t, err)
				for _, secret := range []string{ticket, session, hash, "issuance-admin", "issuance-test-password", "issuance-setup-token", "forged-issuance-actor"} {
					require.NotContains(t, string(encoded), secret)
				}
			})
		}
	}
}

func TestDashboardWSTicketAuditFailurePreservesUsableTicket(t *testing.T) {
	// Cases: immediate persistence failure and bounded cancellation, in both ticket modes.
	for _, mode := range []string{"memory", "signed"} {
		for _, failure := range []string{"error", "timeout"} {
			t.Run(mode+"/"+failure, func(t *testing.T) {
				store, cs := testControlPlaneStore(t)
				logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
				handlers.SetLogger(logger)
				tickets := issuanceAuditTickets(t, mode)
				auth, err := handlers.InitAuthMiddleware(cs, tickets, nil, "")
				require.NoError(t, err)
				attempts := 0
				require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:issuance-audit", func(tx *gorm.DB) {
					if tx.Statement.Table != (AuditEvent{}).TableName() {
						return
					}
					attempts++
					if failure == "timeout" {
						deadline, ok := tx.Statement.Context.Deadline()
						require.True(t, ok)
						require.Less(t, time.Until(deadline), 3*time.Second)
						<-tx.Statement.Context.Done()
						tx.AddError(tx.Statement.Context.Err())
					} else {
						tx.AddError(errors.New("private-issuance-audit-error"))
					}
				}))
				t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:issuance-audit") })
				routes := router.New()
				handlers.NewSessionHandler(cs, tickets).RegisterRoutes(routes,
					auth.APIMiddleware(), NewHandler(store, nil).ManagementAuditMiddleware(logger))
				started := time.Now()
				response := issuanceAuditRequest(routes, "/api/session/ws-ticket", nil)
				require.Less(t, time.Since(started), 5*time.Second)
				consumeIssuanceAuditTicket(t, response, tickets, "dummy-session")
				require.Equal(t, 1, attempts)
				require.Equal(t, "failed", string(response.Response.Header.Peek(lib.HeaderAuditStatus)))
				require.NotContains(t, string(response.Response.Body()), "private-issuance-audit-error")
				changes, _ := response.UserValue(configstore.AuditChangesUserValueKey).([]configstore.AuditChange)
				require.Len(t, changes, 1)
				events, err := store.ListAudit(context.Background(), 100)
				require.NoError(t, err)
				require.Empty(t, events)
			})
		}
	}
}

func TestDashboardSetupIssuanceAuditMixedBatchIdentity(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	require.NoError(t, store.appendManagementAudit(context.Background(), "trusted-admin", []configstore.AuditChange{
		{EventName: "feature_flag.updated", TargetType: "feature_flag", TargetID: "before"},
		{EventName: "dashboard_setup_session.created", TargetType: "dashboard_setup_session", TargetID: "setup"},
		{EventName: "feature_flag.updated", TargetType: "feature_flag", TargetID: "after"},
	}))
	events, err := store.ListAudit(context.Background(), 100)
	require.NoError(t, err)
	require.Len(t, events, 3)
	for _, event := range events {
		actor := "trusted-admin"
		if event.Action == "dashboard_setup_session.created" {
			actor = "anonymous"
		}
		require.Equal(t, actor, event.ActorID)
	}
}

func TestDashboardSetupIssuanceAuditFailurePreservesCookie(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	handlers.SetLogger(logger)
	tickets := issuanceAuditTickets(t, "memory")
	auth, err := handlers.InitAuthMiddleware(cs, tickets, nil, "setup-failure-test-token")
	require.NoError(t, err)
	attempts := 0
	require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:setup-issuance-audit", func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			attempts++
			tx.AddError(errors.New("private-setup-audit-error"))
		}
	}))
	t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:setup-issuance-audit") })
	routes := router.New()
	sessionHandler := handlers.NewSessionHandler(cs, tickets)
	sessionHandler.SetSetupLock(auth)
	sessionHandler.RegisterRoutes(routes, auth.SetupLockMiddleware(), auth.APIMiddleware(),
		NewHandler(store, nil).ManagementAuditMiddleware(logger))
	response := issuanceAuditRequest(routes, "/api/session/setup",
		map[string]string{handlers.SetupTokenHeader: "setup-failure-test-token"})
	require.Equal(t, 200, response.Response.StatusCode())
	require.Equal(t, "failed", string(response.Response.Header.Peek(lib.HeaderAuditStatus)))
	require.NotContains(t, string(response.Response.Body()), "private-setup-audit-error")
	var cookie fasthttp.Cookie
	cookie.SetKey(handlers.SetupSessionCookie)
	require.True(t, response.Response.Header.Cookie(&cookie))
	require.NotEmpty(t, cookie.Value())
	require.Equal(t, 1, attempts)
	wsResponse := issuanceAuditRequest(routes, "/api/session/ws-ticket",
		map[string]string{"Cookie": handlers.SetupSessionCookie + "=" + string(cookie.Value())})
	consumeIssuanceAuditTicket(t, wsResponse, tickets, "dummy-session")
	require.Equal(t, 2, attempts)
}
