package server

import (
	"testing"
)

type pluginWithoutMetadata struct{}

func (pluginWithoutMetadata) GetName() string { return "without-metadata" }
func (pluginWithoutMetadata) Cleanup() error  { return nil }

func TestPluginMetadataRemainsOptional(t *testing.T) {
	metadata := pluginMetadata(pluginWithoutMetadata{})
	if metadata.Description != "" || metadata.DescriptionZh != "" || len(metadata.Features) != 0 {
		t.Fatalf("plugin without metadata should return empty optional metadata: %+v", metadata)
	}
}
