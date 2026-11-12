package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/maximhq/bifrost/core/network"
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

// TestGetLatestReleaseUsesTheConfiguredGlobalProxy: the release feed is an
// outbound API call, so a deployment that can only reach the internet through
// enable_for_api must route it through that proxy too.
func TestGetLatestReleaseUsesTheConfiguredGlobalProxy(t *testing.T) {
	proxied := make(chan struct{}, 1)
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "release.invalid", r.URL.Host)
		proxied <- struct{}{}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"name":"v9.9.9"}`))
	}))
	t.Cleanup(proxy.Close)
	network.SetDefaultHTTPClientFactory(network.NewHTTPClientFactory(&network.GlobalProxyConfig{
		Enabled: true, Type: network.GlobalProxyTypeHTTP, URL: proxy.URL, EnableForAPI: true,
	}, nil))
	t.Cleanup(func() { network.SetDefaultHTTPClientFactory(nil) })
	previous := latestReleaseEndpoint
	latestReleaseEndpoint = "http://release.invalid/latest-release"
	t.Cleanup(func() { latestReleaseEndpoint = previous })

	ctx := &fasthttp.RequestCtx{}
	(&ConfigHandler{}).getLatestRelease(ctx)

	select {
	case <-proxied:
	default:
		t.Fatal("release request did not go through the configured global proxy")
	}
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
	require.JSONEq(t, `{"name":"v9.9.9"}`, string(ctx.Response.Body()))
}
