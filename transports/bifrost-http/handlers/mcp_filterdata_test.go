package handlers

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/stretchr/testify/require"
)

func TestBuildMCPClientFilterDataUsesOnlyActualDatasetValues(t *testing.T) {
	stored := &configstore.MCPClientFilterData{
		ClientIDs: []string{"github"}, ConnectionTypes: []string{"http"}, AuthTypes: []string{"none"},
	}
	runtimeClients := []schemas.MCPClient{{Config: &schemas.MCPClientConfig{ID: "github"}, State: schemas.MCPConnectionStateHealthy}}

	got := buildMCPClientFilterData(stored, runtimeClients)

	require.Equal(t, []string{"http"}, got.ConnectionTypes)
	require.Equal(t, []string{"none"}, got.AuthTypes)
	require.Equal(t, []string{"healthy"}, got.States)
}

func TestBuildMCPClientFilterDataGroupsEveryNonHealthyClientAsUnstable(t *testing.T) {
	stored := &configstore.MCPClientFilterData{
		ClientIDs: []string{"healthy", "disabled"}, ConnectionTypes: []string{"http", "sse"}, AuthTypes: []string{"headers", "none"},
	}
	runtimeClients := []schemas.MCPClient{
		{Config: &schemas.MCPClientConfig{ID: "healthy"}, State: schemas.MCPConnectionStateHealthy},
		{Config: &schemas.MCPClientConfig{ID: "disabled"}, State: schemas.MCPConnectionStateDisabled},
	}

	got := buildMCPClientFilterData(stored, runtimeClients)

	require.Equal(t, []string{"http", "sse"}, got.ConnectionTypes)
	require.Equal(t, []string{"headers", "none"}, got.AuthTypes)
	require.Equal(t, []string{"healthy", "unstable"}, got.States)
}

func TestBuildMCPClientFilterDataReturnsEmptyArrays(t *testing.T) {
	got := buildMCPClientFilterData(nil, nil)
	require.NotNil(t, got.ConnectionTypes)
	require.NotNil(t, got.AuthTypes)
	require.NotNil(t, got.States)
	require.Empty(t, got.ConnectionTypes)
	require.Empty(t, got.AuthTypes)
	require.Empty(t, got.States)
}

func TestMCPClientFilterDataFallbackKeepsThirdPartyStoresCompatible(t *testing.T) {
	config := &schemas.MCPConfig{ClientConfigs: []*schemas.MCPClientConfig{
		{ID: "zeta", ConnectionType: schemas.MCPConnectionTypeSSE, AuthType: schemas.MCPAuthTypeHeaders},
		{ID: "alpha", ConnectionType: schemas.MCPConnectionTypeHTTP, AuthType: schemas.MCPAuthTypeNone},
		{ID: "alpha", ConnectionType: schemas.MCPConnectionTypeHTTP, AuthType: schemas.MCPAuthTypeNone},
	}}

	got := mcpClientFilterDataFromConfig(config)

	require.Equal(t, []string{"alpha", "zeta"}, got.ClientIDs)
	require.Equal(t, []string{"http", "sse"}, got.ConnectionTypes)
	require.Equal(t, []string{"headers", "none"}, got.AuthTypes)
}
