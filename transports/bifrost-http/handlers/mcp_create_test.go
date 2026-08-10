package handlers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

type recordingMCPManager struct {
	MCPManager
	addedConfig        *schemas.MCPClientConfig
	verifyHeadersCalls int
}

func (m *recordingMCPManager) AddMCPClient(_ context.Context, config *schemas.MCPClientConfig) error {
	m.addedConfig = config
	return nil
}

func (m *recordingMCPManager) VerifyHeadersConnection(_ context.Context, _ *schemas.MCPClientConfig, _ map[string]string) (map[string]schemas.ChatTool, map[string]string, error) {
	m.verifyHeadersCalls++
	return nil, nil, nil
}

func newDisabledMCPTestHandler(t *testing.T) (*MCPHandler, *recordingMCPManager, configstore.ConfigStore) {
	t.Helper()
	store := newTestConfigStore(t)
	manager := &recordingMCPManager{}
	runtimeConfig := &lib.Config{
		ConfigStore:  store,
		ClientConfig: &configstore.ClientConfig{},
	}
	return NewMCPHandler(manager, nil, nil, runtimeConfig, nil, nil), manager, store
}

func TestAddMCPClientPreservesDisabledStateWithoutConnecting(t *testing.T) {
	testCases := []struct {
		name              string
		authType          string
		perUserHeaderKeys []string
	}{
		{name: "no_auth", authType: "none"},
		{name: "per_user_headers", authType: string(schemas.MCPAuthTypePerUserHeaders), perUserHeaderKeys: []string{"Authorization"}},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			handler, manager, store := newDisabledMCPTestHandler(t)
			clientID := "disabled-" + testCase.name
			requestPayload := map[string]any{
				"client_id":            clientID,
				"name":                 "disabled_" + testCase.name,
				"connection_type":      "http",
				"connection_string":    map[string]string{"value": "http://127.0.0.1:1/"},
				"auth_type":            testCase.authType,
				"tools_to_execute":     []string{"*"},
				"per_user_header_keys": testCase.perUserHeaderKeys,
				"disabled":             true,
			}
			requestBody, err := json.Marshal(requestPayload)
			require.NoError(t, err)
			var request fasthttp.Request
			request.Header.SetMethod(fasthttp.MethodPost)
			request.SetBody(requestBody)
			ctx := &fasthttp.RequestCtx{}
			ctx.Init(&request, nil, nil)

			handler.addMCPClient(ctx)

			require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
			require.NotNil(t, manager.addedConfig)
			require.True(t, manager.addedConfig.Disabled)
			require.Zero(t, manager.verifyHeadersCalls)
			persisted, err := store.GetMCPClientConfigByID(ctx, clientID)
			require.NoError(t, err)
			require.True(t, persisted.Disabled)
			var response map[string]any
			require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
			require.Equal(t, clientID, response["mcp_client_id"])
			require.Equal(t, "MCP client registered in disabled state", response["message"])
		})
	}
}
