package server

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/fasthttp/router"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/relay"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestRelayRoutesHonorApplicationBindingRevocation(t *testing.T) {
	ctx := context.Background()
	SetLogger(noopTestLogger{})
	handlers.SetLogger(noopTestLogger{})
	cs, err := configstore.NewConfigStore(ctx, &configstore.Config{
		Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "relay-access.db")},
	}, noopTestLogger{})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, cs.Close(ctx)) })
	store, err := controlplane.NewStoreWithBindingMode(ctx, cs, controlplane.ApplicationBindingRequired)
	require.NoError(t, err)
	project := &controlplane.Project{Name: "relay-project"}
	require.NoError(t, store.CreateProject(ctx, project))
	app := &controlplane.Application{ProjectID: project.ID, Name: "relay-app"}
	require.NoError(t, store.CreateApplication(ctx, app))
	key, err := store.CreateApplicationKey(ctx, app.ID, "relay-key", "", nil, "test")
	require.NoError(t, err)

	wsConfig := &schemas.WebSocketConfig{}
	wsConfig.CheckAndSetDefaults()
	cfg := &lib.Config{
		ConfigStore: cs, ClientConfig: &configstore.ClientConfig{},
		WebSocketConfig: wsConfig,
	}
	client, err := bifrost.Init(ctx, schemas.BifrostConfig{Account: lib.NewBaseAccount(cfg), Logger: noopTestLogger{}})
	require.NoError(t, err)
	t.Cleanup(client.Shutdown)
	s := &BifrostHTTPServer{
		Config: cfg, Client: client, Router: router.New(),
		Ctx:                 schemas.NewBifrostContext(ctx, schemas.NoDeadline),
		ControlPlaneHandler: controlplane.NewHandler(store, nil),
		relays:              relay.NewManager(nil, nil),
	}
	require.NoError(t, s.RegisterInferenceRoutes(ctx))
	t.Cleanup(s.wsPool.Close)

	// An active binding reaches the endpoint lookup; a revoked one must stop before it.
	for _, revoked := range []bool{false, true} {
		if revoked {
			require.NoError(t, store.RevokeBinding(ctx, app.ID))
		}
		for _, method := range []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"} {
			var requestCtx fasthttp.RequestCtx
			requestCtx.Request.SetRequestURI("/relay/missing/path")
			requestCtx.Request.Header.SetMethod(method)
			requestCtx.Request.Header.Set("x-bf-vk", key.Value)
			s.Router.Handler(&requestCtx)
			wantStatus := fasthttp.StatusNotFound
			if revoked {
				wantStatus = fasthttp.StatusUnauthorized
			}
			require.Equal(t, wantStatus, requestCtx.Response.StatusCode(), "%s revoked=%t body=%s", method, revoked, requestCtx.Response.Body())
		}
	}
}
