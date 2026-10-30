package handlers

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateRoutingDraftUsesUpstreamCompiler(t *testing.T) {
	valid, err := json.Marshal(simulationFixture().Rules)
	require.NoError(t, err)
	for _, rulesJSON := range []string{"[]", string(valid)} {
		require.NoError(t, ValidateRoutingDraft(rulesJSON))
	}
	for _, rulesJSON := range []string{
		"", "null", "{}", "[null]", "[] []",
		`[{"name":"candidate","targets":[{"weight":1}],"unrecognized":"discarded?"}]`,
		`[{"name":"candidate","targets":[{"weight":1,"secret":"must not persist"}]}]`,
		`[{"name":"candidate","targets":[{"weight":1}],"fallbacks":[{"provider":"openai","model":"mini","api_key":"must-not-persist"}]}]`,
		`[{"name":"candidate","targets":[{"weight":1}],"fallbacks":[{"provider":"openai","model":"mini","key_id":"key-1","credentials":{"value":"must-not-persist"}}]}]`,
		`[{"name":"candidate","cel_expression":"model ==","targets":[{"weight":1}]}]`,
		`[{"id":"duplicate","name":"a","targets":[{"weight":1}]},{"id":"duplicate","name":"b","priority":1,"targets":[{"weight":1}]}]`,
		`[{"name":"a","targets":[{"weight":1}]},{"name":"b","targets":[{"weight":1}]}]`,
		`[{"name":"candidate","scope":"team","targets":[{"weight":1}]}]`,
	} {
		t.Run(rulesJSON, func(t *testing.T) {
			require.Error(t, ValidateRoutingDraft(rulesJSON))
		})
	}
}

func TestValidateRoutingDraftRetainsUpstreamFallbackForms(t *testing.T) {
	for _, fallbacks := range []string{
		`["openai/mini"]`,
		`[{"provider":"openai","model":"mini"}]`,
		`[{"provider":"openai","model":"mini","key_id":"key-1"}]`,
		`[{"provider":"openai","model":"mini","key_id":"key-1","provider_key_name":""}]`,
		`[{"provider":"openai","model":"mini","key_id":"key-1","provider_key_name":" "}]`,
		`["openai/mini",{"provider":"openai","model":"other","key_id":"key-1"}]`,
	} {
		t.Run(fallbacks, func(t *testing.T) {
			require.NoError(t, ValidateRoutingDraft(`[{"name":"Candidate","targets":[{"weight":1}],"fallbacks":`+fallbacks+`}]`))
		})
	}
}

func BenchmarkValidateRoutingDraft(b *testing.B) {
	const candidate = `[{"name":"Candidate","cel_expression":"model == 'input'","targets":[{"model":"target","weight":1}],"fallbacks":["openai/mini",{"provider":"openai","model":"other","key_id":"key-1"}]}]`
	b.ReportAllocs()
	for b.Loop() {
		if err := ValidateRoutingDraft(candidate); err != nil {
			b.Fatal(err)
		}
	}
}
