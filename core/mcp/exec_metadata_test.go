package mcp

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
)

func TestMCPToolExecutionMetadataUsesDiscoveredAnnotations(t *testing.T) {
	destructive := true
	config := &schemas.MCPClientConfig{Name: "local"}
	discovery := &schemas.MCPDiscovery{Tools: map[string]schemas.ChatTool{
		"local-delete": {
			Annotations: &schemas.MCPToolAnnotations{DestructiveHint: &destructive},
		},
	}}
	m := &MCPManager{
		clientMap: map[string]*schemas.MCPClientState{
			"client-1": {Name: "local", ExecutionConfig: config},
		},
		discoveryStore: NewDiscoveryStore(nil, nil),
	}
	require.NoError(t, m.discoveryStore.SetDiscovery(context.Background(), config, discovery))
	name := "local-delete"
	metadata := m.mcpToolExecutionMetadata(context.Background(), &schemas.BifrostMCPRequest{
		ClientName: "local",
		ChatAssistantMessageToolCall: &schemas.ChatAssistantMessageToolCall{
			Function: schemas.ChatAssistantMessageToolCallFunction{Name: &name},
		},
	})

	require.Equal(t, schemas.MCPToolRiskHigh, metadata.RiskLevel)
	require.NotNil(t, metadata.DestructiveHint)
	*metadata.DestructiveHint = false
	require.True(t, *discovery.Tools["local-delete"].Annotations.DestructiveHint,
		"hook metadata must not alias the discovered tool annotation")
}
