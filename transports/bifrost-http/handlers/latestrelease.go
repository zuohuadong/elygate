package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/network"
	"github.com/valyala/fasthttp"
)

const (
	latestReleaseTimeout     = 3 * time.Second
	latestReleaseMaxBodySize = 64 << 10
)

// latestReleaseEndpoint is a variable so tests can point it at a local server.
var latestReleaseEndpoint = "https://getbifrost.ai/latest-release"

type latestReleaseResponse struct {
	Name         string `json:"name"`
	ChangelogURL string `json:"changelogUrl,omitempty"`
}

// getLatestRelease proxies the public release feed for the panel. The browser
// cannot call getbifrost.ai directly when the dashboard is mounted behind a
// restricted network (and CORS is not guaranteed), so the gateway fetches a
// fixed, operator-independent URL and returns a normalized payload.
func (h *ConfigHandler) getLatestRelease(ctx *fasthttp.RequestCtx) {
	requestCtx, cancel := context.WithTimeout(context.Background(), latestReleaseTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, latestReleaseEndpoint, nil)
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
	SendJSON(ctx, latestReleaseResponse{Name: name, ChangelogURL: changelogURL})
}
