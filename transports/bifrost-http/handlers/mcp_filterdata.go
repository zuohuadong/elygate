package handlers

import (
	"context"
	"sort"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/valyala/fasthttp"
)

type mcpClientFilterDataStore interface {
	GetMCPClientFilterData(ctx context.Context) (*configstore.MCPClientFilterData, error)
}

type mcpClientFilterData struct {
	ConnectionTypes []string `json:"connection_types"`
	AuthTypes       []string `json:"auth_types"`
	States          []string `json:"states"`
}

// buildMCPClientFilterData derives facets from the complete stored client set,
// never from a paginated response. State values intentionally match the two
// groups accepted by GET /api/mcp/clients: healthy and unstable.
func buildMCPClientFilterData(stored *configstore.MCPClientFilterData, runtimeClients []schemas.MCPClient) mcpClientFilterData {
	healthyIDs := make(map[string]struct{}, len(runtimeClients))
	for _, client := range runtimeClients {
		if client.Config != nil && client.State == schemas.MCPConnectionStateHealthy {
			healthyIDs[client.Config.ID] = struct{}{}
		}
	}

	result := mcpClientFilterData{
		ConnectionTypes: make([]string, 0),
		AuthTypes:       make([]string, 0),
		States:          make([]string, 0, 2),
	}
	if stored == nil {
		return result
	}
	result.ConnectionTypes = append(result.ConnectionTypes, stored.ConnectionTypes...)
	result.AuthTypes = append(result.AuthTypes, stored.AuthTypes...)
	hasHealthy, hasUnstable := false, false
	for _, clientID := range stored.ClientIDs {
		if _, healthy := healthyIDs[clientID]; healthy {
			hasHealthy = true
		} else {
			hasUnstable = true
		}
	}
	if hasHealthy {
		result.States = append(result.States, "healthy")
	}
	if hasUnstable {
		result.States = append(result.States, "unstable")
	}
	return result
}

func (h *MCPHandler) getMCPClientFilterData(ctx *fasthttp.RequestCtx) {
	if h.store == nil || h.store.ConfigStore == nil || h.client == nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "MCP client filters are unavailable")
		return
	}
	var stored *configstore.MCPClientFilterData
	var err error
	if narrowStore, ok := h.store.ConfigStore.(mcpClientFilterDataStore); ok {
		stored, err = narrowStore.GetMCPClientFilterData(ctx)
	} else {
		// Third-party ConfigStore implementations are not forced to add a downstream
		// method. Keep them source-compatible with a functional, less efficient fallback.
		var config *schemas.MCPConfig
		config, err = h.store.ConfigStore.GetMCPConfig(ctx)
		stored = mcpClientFilterDataFromConfig(config)
	}
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to retrieve MCP client filters")
		return
	}
	runtimeClients, err := h.client.GetMCPClients()
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to retrieve MCP client states")
		return
	}
	SendJSON(ctx, buildMCPClientFilterData(stored, runtimeClients))
}

func mcpClientFilterDataFromConfig(config *schemas.MCPConfig) *configstore.MCPClientFilterData {
	result := &configstore.MCPClientFilterData{}
	if config == nil {
		return result
	}
	clientIDs := make(map[string]struct{})
	connectionTypes := make(map[string]struct{})
	authTypes := make(map[string]struct{})
	for _, client := range config.ClientConfigs {
		if client == nil {
			continue
		}
		if client.ID != "" {
			clientIDs[client.ID] = struct{}{}
		}
		if client.ConnectionType != "" {
			connectionTypes[string(client.ConnectionType)] = struct{}{}
		}
		if client.AuthType != "" {
			authTypes[string(client.AuthType)] = struct{}{}
		}
	}
	for value := range clientIDs {
		result.ClientIDs = append(result.ClientIDs, value)
	}
	for value := range connectionTypes {
		result.ConnectionTypes = append(result.ConnectionTypes, value)
	}
	for value := range authTypes {
		result.AuthTypes = append(result.AuthTypes, value)
	}
	sort.Strings(result.ClientIDs)
	sort.Strings(result.ConnectionTypes)
	sort.Strings(result.AuthTypes)
	return result
}
