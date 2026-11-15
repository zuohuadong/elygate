package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/maximhq/bifrost/core/network"
	"github.com/valyala/fasthttp"
)

const (
	// latestReleaseTimeout bounds one upstream fetch. The feed is served by a
	// third party over the public internet, so a cold DNS + TLS handshake can
	// take over three seconds; a tighter bound turns a healthy-but-slow feed
	// into a 502 the dashboard reports as a release-check failure.
	latestReleaseTimeout     = 10 * time.Second
	latestReleaseMaxBodySize = 64 << 10
	// latestReleaseCacheTTL keeps the dashboard's periodic release check from
	// re-fetching a third-party feed on every page load.
	latestReleaseCacheTTL = 5 * time.Minute
)

// latestReleaseEndpoint is a variable so tests can point it at a local server.
var latestReleaseEndpoint = "https://getbifrost.ai/latest-release"

type latestReleaseResponse struct {
	Name         string `json:"name"`
	ChangelogURL string `json:"changelogUrl,omitempty"`
}

// latestReleaseCacheEntry is one endpoint's last successful fetch. Only
// successes are cached: a failure must stay visible (and be retried) rather
// than pinning a 502 in front of the operator.
type latestReleaseCacheEntry struct {
	response latestReleaseResponse
	expires  time.Time
}

var (
	latestReleaseCacheMu sync.Mutex
	latestReleaseCache   = map[string]latestReleaseCacheEntry{}
)

// cachedLatestRelease returns a still-fresh cached response for endpoint.
func cachedLatestRelease(endpoint string, now time.Time) (latestReleaseResponse, bool) {
	latestReleaseCacheMu.Lock()
	defer latestReleaseCacheMu.Unlock()
	entry, ok := latestReleaseCache[endpoint]
	if !ok || now.After(entry.expires) {
		return latestReleaseResponse{}, false
	}
	return entry.response, true
}

// storeLatestRelease caches a successful response for endpoint.
func storeLatestRelease(endpoint string, response latestReleaseResponse, now time.Time) {
	latestReleaseCacheMu.Lock()
	defer latestReleaseCacheMu.Unlock()
	latestReleaseCache[endpoint] = latestReleaseCacheEntry{response: response, expires: now.Add(latestReleaseCacheTTL)}
}

// resetLatestReleaseCache clears the cache; tests that swap latestReleaseEndpoint
// use it to keep handler runs independent.
func resetLatestReleaseCache() {
	latestReleaseCacheMu.Lock()
	defer latestReleaseCacheMu.Unlock()
	latestReleaseCache = map[string]latestReleaseCacheEntry{}
}

// getLatestRelease proxies the public release feed for the panel. The browser
// cannot call getbifrost.ai directly when the dashboard is mounted behind a
// restricted network (and CORS is not guaranteed), so the gateway fetches a
// fixed, operator-independent URL and returns a normalized payload.
func (h *ConfigHandler) getLatestRelease(ctx *fasthttp.RequestCtx) {
	endpoint := latestReleaseEndpoint
	if cached, ok := cachedLatestRelease(endpoint, time.Now()); ok {
		SendJSON(ctx, cached)
		return
	}
	requestCtx, cancel := context.WithTimeout(context.Background(), latestReleaseTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadGateway, "failed to build the release request")
		return
	}
	req.Header.Set("Accept", "application/json")
	resp, err := (&http.Client{Timeout: latestReleaseTimeout, Transport: network.DefaultTransport(network.ClientPurposeAPI)}).Do(req)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadGateway, "failed to fetch the latest release")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		SendError(ctx, fasthttp.StatusBadGateway, fmt.Sprintf("latest release feed returned HTTP %d", resp.StatusCode))
		return
	}
	var payload struct {
		Name              string `json:"name"`
		Tag               string `json:"tag"`
		Version           string `json:"version"`
		ChangelogURL      string `json:"changelogUrl"`
		ChangelogURLSnake string `json:"changelog_url"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, latestReleaseMaxBodySize)).Decode(&payload); err != nil {
		SendError(ctx, fasthttp.StatusBadGateway, "latest release feed returned invalid JSON")
		return
	}
	name := strings.TrimSpace(payload.Name)
	if name == "" {
		name = strings.TrimSpace(payload.Tag)
	}
	if name == "" {
		name = strings.TrimSpace(payload.Version)
	}
	if name == "" {
		SendError(ctx, fasthttp.StatusBadGateway, "latest release feed did not name a release")
		return
	}
	changelogURL := strings.TrimSpace(payload.ChangelogURL)
	if changelogURL == "" {
		changelogURL = strings.TrimSpace(payload.ChangelogURLSnake)
	}
	response := latestReleaseResponse{Name: name, ChangelogURL: changelogURL}
	storeLatestRelease(endpoint, response, time.Now())
	SendJSON(ctx, response)
}
