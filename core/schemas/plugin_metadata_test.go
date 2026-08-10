package schemas

import "testing"

func TestGetBuiltinPluginMetadataReturnsFeatureCopy(t *testing.T) {
	metadata := GetBuiltinPluginMetadata("governance")
	metadata.Features[0] = "mutated"

	fresh := GetBuiltinPluginMetadata("governance")
	if len(fresh.Features) != 1 || fresh.Features[0] != "adaptive-routing" {
		t.Fatalf("builtin metadata was mutated through a caller: %v", fresh.Features)
	}
}
