package controlplane

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"

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
