package handlers

import (
	"strings"
	"testing"

	"github.com/valyala/fasthttp"
)

func TestPrepareChatCompletionRequestRejectsNegativeMaxTokens(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetBodyString(`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"hi"}],"max_tokens":-1}`)

	_, _, err := prepareChatCompletionRequest(ctx, nil)
	if err == nil || !strings.Contains(err.Error(), "max_tokens must be greater than or equal to 0") {
		t.Fatalf("error = %v, want negative max_tokens validation", err)
	}
}
