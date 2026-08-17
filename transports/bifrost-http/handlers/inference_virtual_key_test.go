package handlers

import (
	"context"
	"errors"
	"testing"

	"github.com/fasthttp/router"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

type virtualKeyHTTPTestAccount struct {
	providerKeyLookups int
}

func (a *virtualKeyHTTPTestAccount) GetConfiguredProviders() ([]schemas.ModelProvider, error) {
	return nil, nil
}

func (a *virtualKeyHTTPTestAccount) GetKeysForProvider(context.Context, schemas.ModelProvider) ([]schemas.Key, error) {
	a.providerKeyLookups++
	return nil, errors.New("provider keys must not be selected for a rejected virtual key")
}

func (a *virtualKeyHTTPTestAccount) GetConfigForProvider(schemas.ModelProvider) (*schemas.ProviderConfig, error) {
	return nil, errors.New("provider config must not be selected for a rejected virtual key")
}

func TestChatCompletionRejectsForgedVirtualKeyBeforeProviderSelection(t *testing.T) {
	account := &virtualKeyHTTPTestAccount{}
	logger := governance.NewMockLogger()
	store, err := governance.NewLocalGovernanceStore(
		t.Context(),
		logger,
		nil,
		&configstore.GovernanceConfig{},
		nil,
	)
	require.NoError(t, err)
	vkMandatory := false
	plugin, err := governance.InitFromStore(
		t.Context(),
		&governance.Config{IsVkMandatory: &vkMandatory},
		logger,
		store,
		nil,
		nil,
		nil,
		nil,
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, plugin.Cleanup()) })

	client, err := bifrost.Init(t.Context(), schemas.BifrostConfig{
		Account:    account,
		LLMPlugins: []schemas.LLMPlugin{plugin},
		Logger:     bifrost.NewNoOpLogger(),
	})
	require.NoError(t, err)
	t.Cleanup(client.Shutdown)

	cases := []struct {
		name   string
		setKey func(*fasthttp.RequestCtx)
	}{
		{name: "x-bf-vk", setKey: func(ctx *fasthttp.RequestCtx) { ctx.Request.Header.Set("x-bf-vk", "sk-bf-forged") }},
		{name: "bearer", setKey: func(ctx *fasthttp.RequestCtx) { ctx.Request.Header.Set("Authorization", "Bearer sk-bf-forged") }},
		{name: "x-api-key", setKey: func(ctx *fasthttp.RequestCtx) { ctx.Request.Header.Set("x-api-key", "sk-bf-forged") }},
		{name: "x-goog-api-key", setKey: func(ctx *fasthttp.RequestCtx) { ctx.Request.Header.Set("x-goog-api-key", "sk-bf-forged") }},
		{name: "api-key", setKey: func(ctx *fasthttp.RequestCtx) { ctx.Request.Header.Set("api-key", "sk-bf-forged") }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := router.New()
			config := &lib.Config{ClientConfig: &configstore.ClientConfig{AllowDirectKeys: true}}
			NewInferenceHandler(client, config).RegisterRoutes(r, VirtualKeyValidationMiddleware(store))

			ctx := &fasthttp.RequestCtx{}
			ctx.Request.Header.SetMethod(fasthttp.MethodPost)
			ctx.Request.SetRequestURI("/v1/chat/completions")
			ctx.Request.Header.Set("x-bf-direct-key", "true")
			tc.setKey(ctx)
			ctx.Request.SetBodyString(`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"hi"}]}`)
			r.Handler(ctx)

			require.Equalf(t, fasthttp.StatusUnauthorized, ctx.Response.StatusCode(), "response body: %s", ctx.Response.Body())
			require.Contains(t, string(ctx.Response.Body()), "virtual key not found")
		})
	}
	require.Zero(t, account.providerKeyLookups, "forged virtual keys must be rejected before provider key selection")
}
