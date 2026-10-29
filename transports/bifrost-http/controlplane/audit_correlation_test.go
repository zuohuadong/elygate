package controlplane

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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

func TestAuditCorrelationManagementBridge(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	request := &fasthttp.RequestCtx{}
	request.Request.Header.Set("x-request-id", "audit-request-1")
	request.SetUserValue(schemas.BifrostContextKeyExportTraceID, "0123456789abcdef0123456789abcdef")
	request.SetUserValue(schemas.BifrostContextKeyTraceID, "private-trace-store-handle")
	NewHandler(store, nil).ManagementAuditMiddleware(bifrost.NewDefaultLogger(schemas.LogLevelError))(func(request *fasthttp.RequestCtx) {
		lib.RecordAuditChange(request, "feature_flag.updated", "feature_flag", "audit-correlation", "", nil, nil)
	})(request)
	events, err := store.ListAudit(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, events, 1)
	encoded, err := json.Marshal(events[0])
	require.NoError(t, err)
	var event map[string]any
	require.NoError(t, json.Unmarshal(encoded, &event))
	require.Equal(t, "audit-request-1", event["request_id"])
	require.Equal(t, "0123456789abcdef0123456789abcdef", event["trace_id"])
	require.NotContains(t, string(encoded), "private-trace-store-handle")
}

func TestAuditCorrelationSignedFeedProjection(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	require.NoError(t, cs.DB().Create(&configtables.TableGovernanceAuditEvent{
		ID: "signed-correlation-event", Sequence: 1, ActorID: "local-admin",
		Action: "virtual_key.update", Resource: "virtual_key", ResourceID: "vk-correlation",
		RequestID: "signed-request-1", TraceID: "fedcba9876543210fedcba9876543210",
	}).Error)
	events, err := store.ListAudit(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, events, 1)
	encoded, err := json.Marshal(events[0])
	require.NoError(t, err)
	var event map[string]any
	require.NoError(t, json.Unmarshal(encoded, &event))
	require.Equal(t, "signed-request-1", event["request_id"])
	require.Equal(t, "fedcba9876543210fedcba9876543210", event["trace_id"])
}

func TestAuditCorrelationValidation(t *testing.T) {
	// Cases: absent, one/128/129 bytes, permitted punctuation, whitespace/control/Unicode,
	// valid lowercase W3C ID, zero/short/long/uppercase/non-hex trace IDs.
	for _, tc := range []struct {
		name, requestID, traceID, wantRequest, wantTrace string
	}{
		{"absent", "", "", "", ""},
		{"one", "a", "", "a", ""},
		{"max", strings.Repeat("x", 128), "", strings.Repeat("x", 128), ""},
		{"long", strings.Repeat("x", 129), "", "", ""},
		{"punctuation", "Req_1.2:part-3", "", "Req_1.2:part-3", ""},
		{"space", "request secret", "", "", ""},
		{"control", "request\nsecret", "", "", ""},
		{"unicode", "request-\u4e2d", "", "", ""},
		{"markup", "<script>alert(1)</script>", "", "", ""},
		{"trace", "", "0123456789abcdef0123456789abcdef", "", "0123456789abcdef0123456789abcdef"},
		{"zero trace", "", strings.Repeat("0", 32), "", ""},
		{"short trace", "", strings.Repeat("1", 31), "", ""},
		{"long trace", "", strings.Repeat("1", 33), "", ""},
		{"uppercase trace", "", strings.Repeat("A", 32), "", ""},
		{"nonhex trace", "", strings.Repeat("g", 32), "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizedAuditCorrelation(tc.requestID, tc.traceID)
			require.Equal(t, auditCorrelation{tc.wantRequest, tc.wantTrace}, got)
		})
	}
}

func TestAuditCorrelationRequestSources(t *testing.T) {
	request := &fasthttp.RequestCtx{}
	request.Request.Header.Set(lib.HeaderRequestID, "header-request")
	request.Request.Header.Set(lib.HeaderBifrostTraceID, strings.Repeat("a", 32))
	request.Request.Header.Set("traceparent", "00-"+strings.Repeat("b", 32)+"-"+strings.Repeat("c", 16)+"-01")
	request.SetUserValue(schemas.BifrostContextKeyTraceID, strings.Repeat("d", 32))
	require.Equal(t, auditCorrelation{"header-request", ""}, auditCorrelationFromRequest(request))
	request.Response.Header.Set(lib.HeaderBifrostRequestID, "gateway-request")
	request.Response.Header.Set(lib.HeaderBifrostTraceID, strings.Repeat("e", 32))
	require.Equal(t, auditCorrelation{"gateway-request", strings.Repeat("e", 32)}, auditCorrelationFromRequest(request))
	request.SetUserValue(schemas.BifrostContextKeyRequestID, "context-request")
	request.SetUserValue(schemas.BifrostContextKeyExportTraceID, strings.Repeat("f", 32))
	require.Equal(t, auditCorrelation{"context-request", strings.Repeat("f", 32)}, auditCorrelationFromRequest(request))
	request.SetUserValue(schemas.BifrostContextKeyRequestID, "invalid value")
	request.SetUserValue(schemas.BifrostContextKeyExportTraceID, "private-internal-handle")
	require.Equal(t, auditCorrelation{}, auditCorrelationFromRequest(request), "invalid selected values do not fall back to a different correlation")
	background := context.Background()
	require.Equal(t, background, withAuditCorrelation(background, auditCorrelation{}))
}

func TestAuditCorrelationBridgeFreezesBatchBeforePanic(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	request := &fasthttp.RequestCtx{}
	request.Request.Header.Set(lib.HeaderRequestID, "before-panic")
	request.SetUserValue(schemas.BifrostContextKeyExportTraceID, strings.Repeat("a", 32))
	route := NewHandler(store, nil).ManagementAuditMiddleware(bifrost.NewDefaultLogger(schemas.LogLevelError))(func(request *fasthttp.RequestCtx) {
		request.Request.Header.Set(lib.HeaderRequestID, "after-entry")
		request.SetUserValue(schemas.BifrostContextKeyExportTraceID, strings.Repeat("b", 32))
		for index := range 101 {
			lib.RecordAuditChange(request, "feature_flag.updated", "feature_flag", fmt.Sprint(index), "", nil, nil)
		}
		panic("reload failed")
	})
	require.PanicsWithValue(t, "reload failed", func() { route(request) })
	events, err := store.ListAudit(context.Background(), 200)
	require.NoError(t, err)
	require.Len(t, events, 101)
	for _, event := range events {
		require.Equal(t, "before-panic", event.RequestID)
		require.Equal(t, strings.Repeat("a", 32), event.TraceID)
	}
}

func TestAuditCorrelationMigrationPreservesV10Events(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	db := cs.DB()
	require.NoError(t, store.AppendAudit(context.Background(), "admin", "before-upgrade", "config", "dashboard"))
	for _, column := range []string{"request_id", "trace_id"} {
		require.NoError(t, db.Migrator().DropColumn(&AuditEvent{}, column))
	}
	require.NoError(t, db.Exec("DELETE FROM migrations WHERE id = ?", "elygate_control_plane_v11_audit_correlation").Error)
	upgraded, err := NewStore(context.Background(), cs)
	require.NoError(t, err)
	events, err := upgraded.ListAudit(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, events, 1)
	require.Equal(t, "before-upgrade", events[0].Action)
	require.Empty(t, events[0].RequestID)
	require.Empty(t, events[0].TraceID)
	encoded, err := json.Marshal(events[0])
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "request_id")
	require.NotContains(t, string(encoded), "trace_id")
	ctx := withAuditCorrelation(context.Background(), normalizedAuditCorrelation("after-upgrade", strings.Repeat("a", 32)))
	require.NoError(t, upgraded.AppendAudit(ctx, "admin", "after-upgrade", "config", "dashboard"))
	reopened, err := NewStore(context.Background(), cs)
	require.NoError(t, err)
	events, err = reopened.ListAudit(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, events, 2)
	require.Equal(t, "after-upgrade", events[0].RequestID)
	require.Equal(t, strings.Repeat("a", 32), events[0].TraceID)
	require.Error(t, auditCorrelationRollback(db), "rollback cannot destroy recorded correlation")
}

func TestAuditCorrelationNativeMutationRoutes(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	testLogger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	handlers.SetLogger(testLogger)
	hash, err := encrypt.Hash("audit-correlation-test-password")
	require.NoError(t, err)
	auth, err := handlers.InitAuthMiddleware(cs, nil, nil, "")
	require.NoError(t, err)
	auth.UpdateAuthConfig(&configstore.AuthConfig{
		IsEnabled: true, AdminUserName: schemas.NewSecretVar("admin"), AdminPassword: schemas.NewSecretVar(hash),
	})
	routes := router.New()
	NewHandler(store, nil).RegisterRoutes(routes, auth.APIMiddleware())
	sequence := 0
	send := func(method, path, body string) *fasthttp.RequestCtx {
		sequence++
		request := &fasthttp.RequestCtx{}
		request.Init(&fasthttp.Request{}, nil, nil)
		request.Request.Header.SetMethod(method)
		request.Request.SetRequestURI(path)
		request.Request.Header.SetContentType("application/json")
		request.Request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("admin:audit-correlation-test-password")))
		request.Request.Header.Set(lib.HeaderRequestID, fmt.Sprintf("mutation-%d", sequence))
		request.SetUserValue(schemas.BifrostContextKeyExportTraceID, strings.Repeat("a", 32))
		request.Request.SetBodyString(body)
		routes.Handler(request)
		require.Less(t, request.Response.StatusCode(), 300, "%s %s: %s", method, path, request.Response.Body())
		var events []AuditEvent
		require.NoError(t, cs.DB().Where("request_id = ?", fmt.Sprintf("mutation-%d", sequence)).Find(&events).Error)
		require.NotEmpty(t, events, "each mutation must retain its own request identity")
		for _, event := range events {
			require.Equal(t, strings.Repeat("a", 32), event.TraceID)
		}
		return request
	}
	var project Project
	require.NoError(t, json.Unmarshal(send("POST", "/api/control-plane/projects", `{"name":"Correlation"}`).Response.Body(), &project))
	var application Application
	require.NoError(t, json.Unmarshal(send("POST", "/api/control-plane/projects/"+project.ID+"/applications", `{"name":"App"}`).Response.Body(), &application))
	var key ApplicationKey
	keyPath := "/api/control-plane/applications/" + application.ID + "/keys"
	require.NoError(t, json.Unmarshal(send("POST", keyPath, `{"name":"Key"}`).Response.Body(), &key))
	var rotatedKey ApplicationKey
	require.NoError(t, json.Unmarshal(send("POST", keyPath+"/"+key.VirtualKeyID+"/rotate", "").Response.Body(), &rotatedKey))
	send("PUT", "/api/control-plane/projects/"+project.ID+"/budgets", `{"daily_budget":10}`)
	send("PUT", "/api/control-plane/applications/"+application.ID+"/budgets", `{"monthly_budget":20}`)
	bindingPath := "/api/control-plane/applications/" + application.ID + "/virtual-key-binding"
	send("POST", bindingPath, `{"virtual_key_id":"`+rotatedKey.VirtualKeyID+`"}`)
	send("DELETE", bindingPath, "")
	send("POST", bindingPath, `{"virtual_key_id":"`+rotatedKey.VirtualKeyID+`"}`)
	send("DELETE", keyPath+"/"+rotatedKey.VirtualKeyID, "")
	alertID := seedBudgetNotifications(t, store, 8)[0].AlertID
	send("PUT", "/api/control-plane/budget-alerts/"+alertID+"/acknowledgement", `{"acknowledged":true}`)
	send("PUT", "/api/control-plane/budget-alerts/"+alertID+"/resolution", `{"resolved":true}`)
	send("PUT", "/api/control-plane/notification-receipts/"+createReceiptNotification(t, store), `{"read":true}`)
}

func TestAuditCorrelationNativeAuditFailureRollsBack(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:correlation-audit-failure", func(tx *gorm.DB) {
		if tx.Statement.Table == (AuditEvent{}).TableName() {
			tx.AddError(errors.New("correlation test audit unavailable"))
		}
	}))
	t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:correlation-audit-failure") })
	request := &fasthttp.RequestCtx{}
	request.Request.Header.Set(lib.HeaderRequestID, "rolled-back")
	ctx, cancel := controlPlaneAuditContext(request)
	defer cancel()
	require.Error(t, store.CreateProjectWithAudit(ctx, &Project{Name: "Must roll back"}, "admin"))
	projects, err := store.ListProjects(context.Background())
	require.NoError(t, err)
	require.Empty(t, projects)
	events, err := store.ListAudit(context.Background(), 10)
	require.NoError(t, err)
	require.Empty(t, events)
}

func TestAuditCorrelationDashboardSessionLifecycle(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	audited := store.ConfigStoreWithSessionAudit()
	request := &fasthttp.RequestCtx{}
	request.Init(&fasthttp.Request{}, nil, nil)
	request.Request.Header.Set(lib.HeaderRequestID, "session-created")
	request.SetUserValue(schemas.BifrostContextKeyExportTraceID, strings.Repeat("a", 32))
	const token = "correlation-test-session-token"
	require.NoError(t, audited.CreateSession(request, &configtables.SessionsTable{Token: token, ExpiresAt: time.Now().Add(time.Hour)}))
	request.Request.Header.Set(lib.HeaderRequestID, "session-deleted")
	require.NoError(t, audited.DeleteSession(request, token))
	require.NoError(t, cs.CreateSession(context.Background(), &configtables.SessionsTable{Token: token, ExpiresAt: time.Now().Add(time.Hour)}))
	request.Request.Header.Set(lib.HeaderRequestID, "sessions-flushed")
	require.NoError(t, store.FlushDashboardSessions(request))
	events := dashboardSessionAudits(t, store)
	require.Len(t, events, 3)
	for index, id := range []string{"session-created", "session-deleted", "sessions-flushed"} {
		require.Equal(t, id, events[index].RequestID)
		require.Equal(t, strings.Repeat("a", 32), events[index].TraceID)
	}
}

func BenchmarkAuditCorrelation(b *testing.B) {
	for _, variant := range []string{"absent", "present", "invalid"} {
		b.Run(variant, func(b *testing.B) {
			request := &fasthttp.RequestCtx{}
			if variant != "absent" {
				request.Request.Header.Set(lib.HeaderRequestID, "request-id")
				request.SetUserValue(schemas.BifrostContextKeyExportTraceID, strings.Repeat("a", 32))
			}
			if variant == "invalid" {
				request.Request.Header.Set(lib.HeaderRequestID, strings.Repeat("x", 129))
				request.SetUserValue(schemas.BifrostContextKeyExportTraceID, "private-internal-handle")
			}
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				correlation := auditCorrelationFromRequest(request)
				ctx := withAuditCorrelation(context.Background(), correlation)
				if got := auditCorrelationFromContext(ctx); got != correlation {
					b.Fatal("correlation changed")
				}
			}
		})
	}
}
