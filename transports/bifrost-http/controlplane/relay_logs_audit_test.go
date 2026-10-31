package controlplane

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/fasthttp/router"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/relay"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

type failingRelayDeletionStore struct{ logstore.LogStore }

type relayAuditHTTPRequest struct {
	method, path, authorization, body string
}

func (s failingRelayDeletionStore) DeleteRelayLogs(context.Context, []string) error {
	return errors.New("private-relay-delete-diagnostic")
}

func relayAuditRequest(routes *router.Router, spec relayAuditHTTPRequest) *fasthttp.RequestCtx {
	var httpRequest fasthttp.Request
	var request fasthttp.RequestCtx
	request.Init(&httpRequest, nil, nil)
	request.Request.Header.SetMethod(spec.method)
	request.Request.SetRequestURI(spec.path)
	request.Request.Header.SetContentType("application/json")
	request.Request.Header.Set("Authorization", spec.authorization)
	request.Request.Header.Set("X-User-ID", "forged-relay-actor")
	request.Request.Header.Set(lib.HeaderRequestID, "relay-audit-request")
	request.Request.SetBodyString(spec.body)
	routes.Handler(&request)
	return &request
}

func TestRelayLogsDeletionAuditThroughManagementRoute(t *testing.T) {
	// Rejected commands, committed deletes and lost audit writes have different outcomes.
	for _, tc := range []struct {
		name         string
		body         string
		status       int
		deleteFails  bool
		auditFails   bool
		unauthorized bool
	}{
		{name: "success", body: `{"ids":["private-relay-id"],"secret":"private-body"}`, status: 200},
		{name: "audit failure preserves deletion", body: `{"ids":["private-relay-id"]}`, auditFails: true, status: 200},
		{name: "deletion failure", body: `{"ids":["private-relay-id"]}`, deleteFails: true, status: 500},
		{name: "malformed request", body: `{`, status: 400},
		{name: "empty IDs", body: `{"ids":[]}`, status: 400},
		{name: "unauthorized", body: `{"ids":["private-relay-id"]}`, unauthorized: true, status: 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := t.Context()
			store, cs := testControlPlaneStore(t)
			logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
			logs, err := logstore.NewLogStore(ctx, &logstore.Config{
				Enabled: true, Type: logstore.LogStoreTypeSQLite,
				Config: &logstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "relay-logs.db")},
			}, logger)
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, logs.Close(context.Background())) })
			_, err = logs.BatchCreateRelayLogsIfNotExists(ctx, []*logstore.RelayLog{{
				ID: "private-relay-id", Timestamp: time.Now().UTC(), RelayName: "private-relay",
				RequestID: "private-original-request", Status: logstore.RelayLogStatusSuccess,
				RequestBody: ptr("private-log-content"),
			}})
			require.NoError(t, err)
			cfg := &lib.Config{ConfigStore: cs, LogsStore: logs}
			if tc.deleteFails {
				cfg.LogsStore = failingRelayDeletionStore{logs}
			}
			if tc.auditFails {
				require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:relay-audit-failure", func(tx *gorm.DB) {
					if tx.Statement.Table == (AuditEvent{}).TableName() {
						tx.AddError(errors.New("private-relay-audit-diagnostic"))
					}
				}))
				t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:relay-audit-failure") })
			}

			hash, err := encrypt.Hash("relay-test-password")
			require.NoError(t, err)
			auth := &handlers.AuthMiddleware{}
			auth.UpdateAuthConfig(&configstore.AuthConfig{
				IsEnabled: true, AdminUserName: schemas.NewSecretVar("relay-admin"),
				AdminPassword: schemas.NewSecretVar(hash),
			})
			audit := NewHandler(store, nil)
			routes := router.New()
			audit.RegisterRoutes(routes, auth.APIMiddleware())
			handlers.NewRelaysHandler(relay.NewManager(cs, nil), nil, cfg, nil).RegisterRoutes(
				routes, auth.APIMiddleware(), audit.ManagementAuditMiddleware(logger))
			authorization := "Basic " + base64.StdEncoding.EncodeToString([]byte("relay-admin:relay-test-password"))
			mutationAuth := authorization
			if tc.unauthorized {
				mutationAuth = ""
			}
			response := relayAuditRequest(routes, relayAuditHTTPRequest{"DELETE", "/api/relay-logs", mutationAuth, tc.body})
			require.Equal(t, tc.status, response.Response.StatusCode(), "body=%s", response.Response.Body())
			if tc.auditFails {
				require.Equal(t, "failed", string(response.Response.Header.Peek(lib.HeaderAuditStatus)))
			} else {
				require.Empty(t, response.Response.Header.Peek(lib.HeaderAuditStatus))
			}
			row, findErr := logs.FindRelayLog(ctx, "private-relay-id")
			if tc.status == 200 {
				require.ErrorIs(t, findErr, logstore.ErrNotFound)
				require.Nil(t, row)
				require.JSONEq(t, `{"deleted":1}`, string(response.Response.Body()))
			} else {
				require.NoError(t, findErr)
				require.NotNil(t, row)
			}
			events, err := store.ListAudit(ctx, 10)
			require.NoError(t, err)
			if tc.status == 200 && !tc.auditFails {
				require.Len(t, events, 1)
				require.Equal(t, "relay_logs.deleted", events[0].Action)
				require.Equal(t, "relay_logs", events[0].ResourceType)
				require.Equal(t, "relay_logs", events[0].ResourceID)
				require.Equal(t, "local-admin:relay-admin", events[0].ActorID)
				require.Equal(t, "relay-audit-request", events[0].RequestID)
			} else {
				require.Empty(t, events)
			}
			feed := relayAuditRequest(routes, relayAuditHTTPRequest{"GET", "/api/control-plane/audit-events", authorization, ""})
			require.Equal(t, 200, feed.Response.StatusCode())
			serialized, err := json.Marshal(events)
			require.NoError(t, err)
			for _, secret := range []string{"private-relay-id", "private-relay", "private-body", "private-log-content", "forged-relay-actor", "relay-test-password", "private-relay-delete-diagnostic", "private-relay-audit-diagnostic"} {
				require.NotContains(t, string(serialized), secret)
				require.NotContains(t, string(feed.Response.Body()), secret)
				require.NotContains(t, string(response.Response.Body()), secret)
			}
			denied := relayAuditRequest(routes, relayAuditHTTPRequest{"GET", "/api/control-plane/audit-events", "", ""})
			require.Equal(t, 401, denied.Response.StatusCode())
		})
	}
}
