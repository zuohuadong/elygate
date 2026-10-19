package bedrock

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestInvokeBuildConfig_ExcludesInternalConverseFields(t *testing.T) {
	provider := &BedrockProvider{}
	config := provider.invokeBuildConfig("us.anthropic.claude-sonnet-4-6", false, false, nil)

	excluded := make(map[string]bool)
	for _, f := range config.ExcludeFields {
		excluded[f] = true
	}

	assert.True(t, excluded["guardrailConfig"], "guardrailConfig must be excluded")
	assert.True(t, excluded["additionalModelRequestFieldPaths"], "additionalModelRequestFieldPaths must be excluded")
	assert.True(t, excluded["additionalModelResponseFieldPaths"], "additionalModelResponseFieldPaths must be excluded")
}
