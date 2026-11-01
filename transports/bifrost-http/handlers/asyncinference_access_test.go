package handlers

import (
	"errors"
	"testing"

	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestSendSubmitJobErrorHidesVirtualKeyCheckerDetails(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	err := errors.Join(logstore.ErrVirtualKeyAccessDenied, errors.New("pq: secret database detail"))

	sendSubmitJobError(ctx, err)

	require.Equal(t, fasthttp.StatusUnauthorized, ctx.Response.StatusCode())
	require.Contains(t, string(ctx.Response.Body()), "virtual key access is no longer active")
	require.NotContains(t, string(ctx.Response.Body()), "secret database detail")
}
