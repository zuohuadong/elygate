package schemas

import "testing"

func TestClassifyMCPToolRisk(t *testing.T) {
	yes, no := true, false
	tests := []struct {
		name        string
		annotations *MCPToolAnnotations
		want        MCPToolRiskLevel
	}{
		{name: "missing", want: MCPToolRiskUnknown},
		{name: "title only", annotations: &MCPToolAnnotations{Title: "lookup"}, want: MCPToolRiskUnknown},
		{name: "read only", annotations: &MCPToolAnnotations{ReadOnlyHint: &yes}, want: MCPToolRiskLow},
		{name: "explicit non destructive", annotations: &MCPToolAnnotations{DestructiveHint: &no}, want: MCPToolRiskMedium},
		{name: "non read only", annotations: &MCPToolAnnotations{ReadOnlyHint: &no}, want: MCPToolRiskMedium},
		{name: "destructive", annotations: &MCPToolAnnotations{DestructiveHint: &yes}, want: MCPToolRiskHigh},
		{name: "conflicting hints", annotations: &MCPToolAnnotations{ReadOnlyHint: &yes, DestructiveHint: &yes}, want: MCPToolRiskHigh},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyMCPToolRisk(tt.annotations); got != tt.want {
				t.Fatalf("ClassifyMCPToolRisk() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestMCPToolExecutionMetadataIsCoreOwnedDuringRestrictedWrites(t *testing.T) {
	ctx := NewBifrostContext(nil, NoDeadline)
	ctx.BlockRestrictedWrites()
	defer ctx.UnblockRestrictedWrites()
	ctx.SetValue(BifrostContextKeyMCPToolExecutionMetadata, &MCPToolExecutionMetadata{
		RiskLevel: MCPToolRiskLow,
	})
	if got := ctx.Value(BifrostContextKeyMCPToolExecutionMetadata); got != nil {
		t.Fatalf("public restricted write unexpectedly installed metadata: %#v", got)
	}

	metadata := &MCPToolExecutionMetadata{RiskLevel: MCPToolRiskHigh}
	ctx.SetMCPToolExecutionMetadata(metadata)
	if got := ctx.Value(BifrostContextKeyMCPToolExecutionMetadata); got != metadata {
		t.Fatalf("core metadata write = %#v, want %#v", got, metadata)
	}
	ctx.ClearMCPToolExecutionMetadata()
	if got := ctx.Value(BifrostContextKeyMCPToolExecutionMetadata); got != nil {
		t.Fatalf("core metadata clear left %#v", got)
	}
}
