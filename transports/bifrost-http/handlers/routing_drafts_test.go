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
