package mcp

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
)

func TestMCPToolExecutionMetadataUsesDiscoveredAnnotations(t *testing.T) {
	destructive := true
	m := &MCPManager{
		clientMap: map[string]*schemas.MCPClientState{
			"client-1": {
				Name: "local",
				ToolMap: map[string]schemas.ChatTool{
					"local-delete": {
						Annotations: &schemas.MCPToolAnnotations{DestructiveHint: &destructive},
					},
				},
			},
		},
	}
	name := "local-delete"
	metadata := m.mcpToolExecutionMetadata(&schemas.BifrostMCPRequest{
		ClientName: "local",
		ChatAssistantMessageToolCall: &schemas.ChatAssistantMessageToolCall{
			Function: schemas.ChatAssistantMessageToolCallFunction{Name: &name},
		},
	})

	require.Equal(t, schemas.MCPToolRiskHigh, metadata.RiskLevel)
	require.NotNil(t, metadata.DestructiveHint)
	*metadata.DestructiveHint = false
	require.True(t, *m.clientMap["client-1"].ToolMap["local-delete"].Annotations.DestructiveHint,
		"hook metadata must not alias the discovered tool annotation")
}
