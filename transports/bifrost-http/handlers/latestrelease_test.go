package handlers

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/network"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

// pointLatestReleaseAt repoints the release endpoint for one test and keeps the
// module-level success cache out of the way: the cache is keyed by endpoint, and
// a fixed endpoint reused across runs (-count=2) would otherwise serve the
// previous run's answer and never reach the fake upstream.
func pointLatestReleaseAt(t *testing.T, endpoint string) {
	t.Helper()
	previous := latestReleaseEndpoint
	latestReleaseEndpoint = endpoint
	resetLatestReleaseCache()
	t.Cleanup(func() {
		latestReleaseEndpoint = previous
		resetLatestReleaseCache()
	})
}

func TestGetLatestReleaseNormalizesAndBoundsTheFeed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodGet, r.Method)
		require.Equal(t, "application/json", r.Header.Get("Accept"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag":"v1.2.3","changelog_url":"https://example.com/changes"}`))
	}))
	t.Cleanup(server.Close)
	pointLatestReleaseAt(t, server.URL)

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
	pointLatestReleaseAt(t, server.URL)

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
	pointLatestReleaseAt(t, "http://release.invalid/latest-release")

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

// TestGetLatestReleaseToleratesSlowUpstream pins issue #198: the feed lives on a
// third party over the public internet and its cold DNS + TLS handshake takes
// over three seconds, so the old 3s bound turned a healthy feed into a 502.
func TestGetLatestReleaseToleratesSlowUpstream(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		<-release
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"name":"v2.5.1"}`))
	}))
	t.Cleanup(server.Close)
	pointLatestReleaseAt(t, server.URL)
	// Release the upstream response after the old 3s bound has elapsed but well
	// inside the current one.
	go func() {
		time.Sleep(3200 * time.Millisecond)
		close(release)
	}()

	ctx := &fasthttp.RequestCtx{}
	started := time.Now()
	(&ConfigHandler{}).getLatestRelease(ctx)
	elapsed := time.Since(started)

	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
	require.JSONEq(t, `{"name":"v2.5.1"}`, string(ctx.Response.Body()))
	require.GreaterOrEqual(t, elapsed, 3200*time.Millisecond, "handler returned before the upstream answered")
}

// TestGetLatestReleaseCachesSuccessfulFetch: the dashboard checks releases on
// every load, so one slow upstream answer must not be refetched each time.
func TestGetLatestReleaseCachesSuccessfulFetch(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"name":"v9.9.9","changelogUrl":"https://example.com/v9"}`))
	}))
	t.Cleanup(server.Close)
	pointLatestReleaseAt(t, server.URL)

	for i := 0; i < 3; i++ {
		ctx := &fasthttp.RequestCtx{}
		(&ConfigHandler{}).getLatestRelease(ctx)
		require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
		require.JSONEq(t, `{"name":"v9.9.9","changelogUrl":"https://example.com/v9"}`, string(ctx.Response.Body()))
	}
	require.EqualValues(t, 1, hits.Load(), "cached release responses must not refetch the upstream")
}

// TestGetLatestReleaseDoesNotCacheFailures: an upstream outage must be retried
// instead of being pinned in the cache as a 502 (or worse, as a success).
func TestGetLatestReleaseDoesNotCacheFailures(t *testing.T) {
	var hits atomic.Int32
	failing := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		if failing {
			http.Error(w, "nope", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"name":"v3.0.0"}`))
	}))
	t.Cleanup(server.Close)
	pointLatestReleaseAt(t, server.URL)

	ctx := &fasthttp.RequestCtx{}
	(&ConfigHandler{}).getLatestRelease(ctx)
	require.Equal(t, fasthttp.StatusBadGateway, ctx.Response.StatusCode())

	failing = false
	ctx = &fasthttp.RequestCtx{}
	(&ConfigHandler{}).getLatestRelease(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
	require.JSONEq(t, `{"name":"v3.0.0"}`, string(ctx.Response.Body()))
	require.EqualValues(t, 2, hits.Load())
}
