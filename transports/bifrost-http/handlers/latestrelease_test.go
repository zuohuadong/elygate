package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestGetLatestReleaseNormalizesAndBoundsTheFeed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodGet, r.Method)
		require.Equal(t, "application/json", r.Header.Get("Accept"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag":"v1.2.3","changelog_url":"https://example.com/changes"}`))
	}))
	t.Cleanup(server.Close)
	previous := latestReleaseEndpoint
	latestReleaseEndpoint = server.URL
	t.Cleanup(func() { latestReleaseEndpoint = previous })

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodGet)
	ctx.Request.SetRequestURI("/api/latest-release")
	(&ConfigHandler{}).getLatestRelease(ctx)

	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
	require.JSONEq(t, `{"name":"v1.2.3","changelogUrl":"https://example.com/changes"}`, string(ctx.Response.Body()))
}

func TestGetLatestReleaseRejectsUpstreamFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "nope", http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)
	previous := latestReleaseEndpoint
	latestReleaseEndpoint = server.URL
	t.Cleanup(func() { latestReleaseEndpoint = previous })

	ctx := &fasthttp.RequestCtx{}
	(&ConfigHandler{}).getLatestRelease(ctx)
	require.Equal(t, fasthttp.StatusBadGateway, ctx.Response.StatusCode())
}
