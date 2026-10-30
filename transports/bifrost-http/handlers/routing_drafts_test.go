package handlers

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
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
			require.NoError(t, ValidateRoutingDraft(`[{"name":"Candidate","cel_expression":"true","targets":[{"weight":1}],"fallbacks":`+fallbacks+`}]`))
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

func TestCompileRoutingPolicyCanonicalizesWithoutCallerMutation(t *testing.T) {
	versionID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	createdAt := time.Date(2026, 10, 30, 12, 0, 0, 123456789, time.FixedZone("local", 8*60*60))
	rulesJSON := `[
		{"id":"caller-global","name":"Global","scope":"global","priority":9,"cel_expression":"true","targets":[{"provider":"openai","model":"global","weight":0.4},{"provider":"anthropic","model":"global","weight":0.6}]},
		{"id":"caller-vk","name":"Virtual key","scope":"virtual_key","scope_id":"vk-1","priority":1,"cel_expression":"model == 'in'","enabled":false,"chain_rule":true,"targets":[{"model":"first","weight":0.7},{"model":"second","weight":0.3}]}
	]`
	compiled, err := CompileRoutingPolicy(t.Context(), RoutingPolicyCandidate{
		VersionID: versionID, RulesJSON: rulesJSON, ChainMaxDepth: 3, CreatedAt: createdAt,
	})
	require.NoError(t, err)
	require.Len(t, compiled, 2)
	require.Equal(t, "virtual_key", compiled[0].Scope)
	require.Equal(t, "global", compiled[1].Scope)
	require.Equal(t, uuid.NewSHA1(uuid.NameSpaceOID, []byte(versionID.String()+"/0")).String(), compiled[0].ID)
	require.Equal(t, uuid.NewSHA1(uuid.NameSpaceOID, []byte(versionID.String()+"/1")).String(), compiled[1].ID)
	require.NotEqual(t, "caller-vk", compiled[0].ID)
	require.False(t, compiled[0].EnabledValue())
	require.True(t, compiled[0].ChainRule)
	require.Equal(t, createdAt.UTC().Truncate(time.Microsecond), compiled[0].CreatedAt)
	require.Equal(t, "first", *compiled[0].Targets[0].Model)
	require.Equal(t, "second", *compiled[0].Targets[1].Model)
	require.Equal(t, 0, *compiled[0].Targets[0].Position)
	require.Equal(t, 1, *compiled[0].Targets[1].Position)
	require.Equal(t, "openai", *compiled[1].Targets[0].Provider)
	require.Equal(t, "anthropic", *compiled[1].Targets[1].Provider)
}

func TestCompileRoutingPolicyRejectsUnsafeCandidate(t *testing.T) {
	for _, rulesJSON := range []string{
		`[{"name":"blank","targets":[{"weight":1}]}]`,
		`[{"name":"bad","cel_expression":"model ==","targets":[{"weight":1}]}]`,
		`[{"name":"alias","cel_expression":"true","targets":[{"weight":1}],"fallbacks":[{"provider":"openai","model":"mini","provider_key_name":"secret"}]}]`,
		`[{"name":"bad-weight","cel_expression":"true","targets":[{"weight":0}]}]`,
		`[{"name":"a","cel_expression":"true","priority":1,"targets":[{"weight":1}]},{"name":"b","cel_expression":"true","priority":1,"targets":[{"weight":1}]}]`,
	} {
		t.Run(rulesJSON, func(t *testing.T) {
			compiled, err := CompileRoutingPolicy(t.Context(), RoutingPolicyCandidate{
				VersionID: uuid.New(), RulesJSON: rulesJSON, ChainMaxDepth: 1,
			})
			require.Error(t, err)
			require.Nil(t, compiled)
		})
	}
}
