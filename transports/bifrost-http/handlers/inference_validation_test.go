package handlers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/modelcatalog"
	"github.com/maximhq/bifrost/framework/modelcatalog/datasheet"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

func maxTokenValidationConfig(t *testing.T) *lib.Config {
	t.Helper()
	pricingPath := filepath.Join(t.TempDir(), "pricing.json")
	requirePricing := []byte(`{
		"gpt-4o":{"provider":"openai","mode":"chat","max_output_tokens":65536},
		"gpt-low":{"provider":"openai","mode":"chat","max_output_tokens":4096}
	}`)
	if err := os.WriteFile(pricingPath, requirePricing, 0o600); err != nil {
		t.Fatalf("write pricing fixture: %v", err)
	}
	datasheetStore := datasheet.New(nil, nil, datasheet.Config{URL: "file://" + pricingPath})
	if err := datasheetStore.LoadFromURLIntoMemory(t.Context()); err != nil {
		t.Fatalf("load pricing fixture: %v", err)
	}
	catalog := modelcatalog.NewTestCatalogWithDatasheet(datasheetStore)
	catalog.SetKeyConfigForProvider(schemas.OpenAI, []schemas.Key{{
		ID:     "openai-test-key",
		Models: schemas.WhiteList{"*"},
		Aliases: schemas.KeyAliases{
			"production-chat": {ModelID: "gpt-4o"},
			"small-chat":      {ModelID: "gpt-low"},
		},
	}})
	return &lib.Config{ModelCatalog: catalog}
}

func TestPrepareChatCompletionRequestValidatesLegacyMaxTokens(t *testing.T) {
	config := maxTokenValidationConfig(t)
	tests := []struct {
		name       string
		model      string
		value      string
		wantError  string
		wantTokens *int
	}{
		{name: "zero", value: "0", wantError: "greater than or equal to 1"},
		{name: "negative", value: "-1", wantError: "greater than or equal to 1"},
		{name: "negative fraction", value: "-0.5", wantError: "greater than or equal to 1"},
		{name: "fraction", value: "1.5", wantError: "greater than or equal to 1"},
		{name: "string", value: `"10"`, wantError: "greater than or equal to 1"},
		{name: "boolean", value: "true", wantError: "greater than or equal to 1"},
		{name: "too large", value: "999999999", wantError: "less than or equal to 65536"},
		{name: "too large unqualified model", model: "gpt-4o", value: "999999999", wantError: "less than or equal to 65536"},
		{name: "too large provider alias", model: "openai/production-chat", value: "999999999", wantError: "less than or equal to 65536"},
		{name: "above lower model limit", model: "openai/gpt-low", value: "4097", wantError: "less than or equal to 4096"},
		{name: "above lower alias limit", model: "openai/small-chat", value: "4097", wantError: "less than or equal to 4096"},
		{name: "too large without catalog limit", model: "Agnes-AI/agnes-2.0-flash", value: "65537", wantError: "less than or equal to 65536"},
		{name: "null", value: "null"},
		{name: "at lower model limit", model: "openai/gpt-low", value: "4096", wantTokens: func() *int { value := 4096; return &value }()},
		{name: "at gateway limit", model: "Agnes-AI/agnes-2.0-flash", value: "65536", wantTokens: func() *int { value := 65536; return &value }()},
		{name: "valid", value: "10", wantTokens: func() *int { value := 10; return &value }()},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := &fasthttp.RequestCtx{}
			model := test.model
			if model == "" {
				model = "openai/gpt-4o"
			}
			ctx.Request.SetBodyString(`{"model":"` + model + `","messages":[{"role":"user","content":"hi"}],"max_tokens":` + test.value + `}`)
			_, request, err := prepareChatCompletionRequest(ctx, config)
			if test.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantError) {
					t.Fatalf("error = %v, want %q", err, test.wantError)
				}
				return
			}
			if err != nil {
				t.Fatalf("prepareChatCompletionRequest: %v", err)
			}
			if test.wantTokens == nil {
				if request.Params.MaxCompletionTokens != nil {
					t.Fatalf("MaxCompletionTokens = %v, want nil", *request.Params.MaxCompletionTokens)
				}
				return
			}
			if request.Params.MaxCompletionTokens == nil || *request.Params.MaxCompletionTokens != *test.wantTokens {
				t.Fatalf("MaxCompletionTokens = %v, want %d", request.Params.MaxCompletionTokens, *test.wantTokens)
			}
		})
	}
}
