package lib

import (
	"slices"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func TestPluginMetadataSurvivesStatusAndDisplayNameUpdates(t *testing.T) {
	config := &Config{}
	config.UpdatePluginOverallStatus(
		"custom-guardrails",
		"Guardrails",
		schemas.PluginStatusActive,
		nil,
		[]schemas.PluginType{schemas.PluginTypeLLM},
	)
	config.UpdatePluginMetadata("custom-guardrails", schemas.PluginMetadata{
		Description:   "Custom guardrails provider",
		DescriptionZh: "自定义护栏提供方",
		Features:      []string{"guardrails-config", "guardrails-providers"},
	})

	config.UpdatePluginOverallStatus(
		"custom-guardrails",
		"Guardrails",
		schemas.PluginStatusActive,
		[]string{"reloaded"},
		[]schemas.PluginType{schemas.PluginTypeLLM},
	)
	if err := config.UpdatePluginDisplayName("custom-guardrails", "Guardrails Enterprise"); err != nil {
		t.Fatalf("update plugin display name: %v", err)
	}

	status := config.GetPluginStatus()["custom-guardrails"]
	if status.Description != "Custom guardrails provider" {
		t.Fatalf("description = %q", status.Description)
	}
	if status.DescriptionZh != "自定义护栏提供方" {
		t.Fatalf("description_zh = %q", status.DescriptionZh)
	}
	wantFeatures := []string{"guardrails-config", "guardrails-providers"}
	if !slices.Equal(status.Features, wantFeatures) {
		t.Fatalf("features = %v, want %v", status.Features, wantFeatures)
	}
}
