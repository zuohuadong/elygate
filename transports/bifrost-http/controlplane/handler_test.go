package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

type recordingVirtualKeyLifecycle struct {
	reloaded  []string
	removed   []string
	reloadErr error
	removeErr error
}

func (r *recordingVirtualKeyLifecycle) ReloadVirtualKey(_ context.Context, id string) (*configtables.TableVirtualKey, error) {
	r.reloaded = append(r.reloaded, id)
	return nil, r.reloadErr
}

func (r *recordingVirtualKeyLifecycle) RemoveVirtualKey(_ context.Context, id string) error {
	r.removed = append(r.removed, id)
	return r.removeErr
}

func TestAdminAccessMiddlewareRequiresAuthenticatedAdmin(t *testing.T) {
	h := &Handler{}
	called := false
	middleware := h.AdminAccessMiddleware()(func(ctx *fasthttp.RequestCtx) {
		called = true
		ctx.SetStatusCode(fasthttp.StatusNoContent)
	})

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodPost)
	ctx.Request.Header.SetContentType("application/json")
	ctx.SetUserValue(schemas.BifrostContextKeyAuthBypassed, true)
	middleware(ctx)

	require.False(t, called)
	require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode())
}

func TestAdminAccessMiddlewareRejectsCrossOriginAndNonJSONWrites(t *testing.T) {
	h := &Handler{}
	middleware := h.AdminAccessMiddleware()(func(ctx *fasthttp.RequestCtx) {
		ctx.SetStatusCode(fasthttp.StatusNoContent)
	})

	nonJSON := &fasthttp.RequestCtx{}
	nonJSON.Request.Header.SetMethod(fasthttp.MethodPost)
	nonJSON.Request.Header.SetContentType("text/plain")
	nonJSON.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(nonJSON)
	require.Equal(t, fasthttp.StatusUnsupportedMediaType, nonJSON.Response.StatusCode())

	crossOrigin := &fasthttp.RequestCtx{}
	crossOrigin.Request.Header.SetMethod(fasthttp.MethodPost)
	crossOrigin.Request.Header.SetContentType("application/json")
	crossOrigin.Request.SetHost("admin.example.test")
	crossOrigin.Request.Header.Set("Origin", "https://attacker.example.test")
	crossOrigin.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(crossOrigin)
	require.Equal(t, fasthttp.StatusForbidden, crossOrigin.Response.StatusCode())

	spoofedForwardedHost := &fasthttp.RequestCtx{}
	spoofedForwardedHost.Request.Header.SetMethod(fasthttp.MethodPost)
	spoofedForwardedHost.Request.Header.SetContentType("application/json")
	spoofedForwardedHost.Request.SetHost("admin.example.test")
	spoofedForwardedHost.Request.Header.Set("Origin", "https://attacker.example.test")
	spoofedForwardedHost.Request.Header.Set("X-Forwarded-Host", "attacker.example.test")
	spoofedForwardedHost.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(spoofedForwardedHost)
	require.Equal(t, fasthttp.StatusForbidden, spoofedForwardedHost.Response.StatusCode())

	sameOrigin := &fasthttp.RequestCtx{}
	sameOrigin.Request.Header.SetMethod(fasthttp.MethodPost)
	sameOrigin.Request.Header.SetContentType("application/json")
	sameOrigin.Request.SetHost("admin.example.test")
	sameOrigin.Request.Header.Set("Origin", "https://admin.example.test")
	sameOrigin.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(sameOrigin)
	require.Equal(t, fasthttp.StatusNoContent, sameOrigin.Response.StatusCode())
}

func TestUsageQueryReturnsEffectivePagination(t *testing.T) {
	h := &Handler{}
	ctx := &fasthttp.RequestCtx{}
	ctx.QueryArgs().Set("limit", "0")
	ctx.QueryArgs().Set("offset", "-3")

	query, err := h.usageQuery(ctx)
	require.NoError(t, err)
	require.Equal(t, 100, query.Limit)
	require.Zero(t, query.Offset)
}

func TestCheckVirtualKeyAccessHonorsApplicationBindingLifecycle(t *testing.T) {
	store, cs := testControlPlaneStore(t)
	active := true
	require.NoError(t, cs.CreateVirtualKey(context.Background(), &configtables.TableVirtualKey{ID: "vk-handler", Name: "vk-handler", Value: *schemas.NewSecretVar("sk-handler"), IsActive: &active, CreatedAt: time.Now(), UpdatedAt: time.Now()}))
	h := NewHandler(store, nil)

	// Unbound keys remain compatible with the existing OSS behavior.
	require.NoError(t, h.CheckVirtualKeyAccess(context.Background(), "vk-handler"))

	project := &Project{Name: "Gateway"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "Worker"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	_, err := store.BindVirtualKey(context.Background(), app.ID, "vk-handler", nil)
	require.NoError(t, err)
	require.NoError(t, h.CheckVirtualKeyAccess(context.Background(), "vk-handler"))
	require.NoError(t, store.RevokeBinding(context.Background(), app.ID))
	require.EqualError(t, h.CheckVirtualKeyAccess(context.Background(), "vk-handler"), "application credential binding is revoked or expired")

	expires := time.Now().UTC().Add(-time.Minute)
	_, err = store.BindVirtualKey(context.Background(), app.ID, "vk-handler", &expires)
	require.NoError(t, err)
	require.EqualError(t, h.CheckVirtualKeyValueAccess(context.Background(), "sk-handler"), "application credential binding is revoked or expired")
}

func TestApplicationKeyHandlersCreateRotateAndRevoke(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	project := &Project{Name: "Handlers"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "API"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	lifecycle := &recordingVirtualKeyLifecycle{}
	h := NewHandler(store, nil, lifecycle)

	createCtx := &fasthttp.RequestCtx{}
	createCtx.SetUserValue("application_id", app.ID)
	createCtx.Request.SetBodyString(`{"name":"api-key"}`)
	h.createApplicationKey(createCtx)
	require.Equal(t, fasthttp.StatusCreated, createCtx.Response.StatusCode())
	var created ApplicationKey
	require.NoError(t, json.Unmarshal(createCtx.Response.Body(), &created))
	require.NotEmpty(t, created.Value)
	require.Equal(t, []string{created.VirtualKeyID}, lifecycle.reloaded)

	rotateCtx := &fasthttp.RequestCtx{}
	rotateCtx.SetUserValue("application_id", app.ID)
	rotateCtx.SetUserValue("virtual_key_id", created.VirtualKeyID)
	h.rotateApplicationKey(rotateCtx)
	require.Equal(t, fasthttp.StatusOK, rotateCtx.Response.StatusCode())
	var rotated ApplicationKey
	require.NoError(t, json.Unmarshal(rotateCtx.Response.Body(), &rotated))
	require.NotEqual(t, created.Value, rotated.Value)

	revokeCtx := &fasthttp.RequestCtx{}
	revokeCtx.SetUserValue("application_id", app.ID)
	revokeCtx.SetUserValue("virtual_key_id", created.VirtualKeyID)
	h.revokeApplicationKey(revokeCtx)
	require.Equal(t, fasthttp.StatusNoContent, revokeCtx.Response.StatusCode())
	require.Equal(t, []string{created.VirtualKeyID, created.VirtualKeyID, created.VirtualKeyID}, lifecycle.reloaded)
}

func TestSyncVirtualKeyRemovesStaleInMemoryKeyAfterReloadFailure(t *testing.T) {
	lifecycle := &recordingVirtualKeyLifecycle{reloadErr: errors.New("reload failed")}
	h := NewHandler(nil, nil, lifecycle)
	err := h.syncVirtualKey(context.Background(), "vk-stale")
	require.EqualError(t, err, "reload failed")
	require.Equal(t, []string{"vk-stale"}, lifecycle.removed)
}

func TestRotationTombstoneRejectsOldValueWhenMemorySyncFails(t *testing.T) {
	store, _ := testControlPlaneStore(t)
	project := &Project{Name: "Fail closed"}
	require.NoError(t, store.CreateProject(context.Background(), project))
	app := &Application{ProjectID: project.ID, Name: "API"}
	require.NoError(t, store.CreateApplication(context.Background(), app))
	created, err := store.CreateApplicationKey(context.Background(), app.ID, "api-key-fail-closed", "", nil, "admin")
	require.NoError(t, err)

	lifecycle := &recordingVirtualKeyLifecycle{reloadErr: errors.New("reload failed"), removeErr: errors.New("remove failed")}
	h := NewHandler(store, nil, lifecycle)
	rotateCtx := &fasthttp.RequestCtx{}
	rotateCtx.SetUserValue("application_id", app.ID)
	rotateCtx.SetUserValue("virtual_key_id", created.VirtualKeyID)
	h.rotateApplicationKey(rotateCtx)
	require.Equal(t, fasthttp.StatusInternalServerError, rotateCtx.Response.StatusCode())
	require.EqualError(t, store.CheckVirtualKeyValueAccess(context.Background(), created.Value), "virtual key has been revoked or rotated")
}
