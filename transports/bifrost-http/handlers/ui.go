package handlers

import (
	"fmt"
	"io/fs"
	"mime"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

const uiDevServerAddr = "localhost:3000"

// ShellRewriter may rewrite the pre-hydration HTML shell before it is served.
//
// It is the seam the enterprise build uses to point the shell's logo at a
// custom asset, so a branded deployment does not flash the Bifrost mark
// for the moment before the bundle boots. OSS leaves it nil and serves the
// embedded document exactly as bundled.
//
// It runs on the request path for every HTML document, so an implementation
// must be cheap and must return data unchanged when it has nothing to do.
type ShellRewriter func(ctx *fasthttp.RequestCtx, data []byte) []byte

// UIHandler handles UI routes.
type UIHandler struct {
	uiContent fs.ReadFileFS
	// uiDevClient proxies dashboard requests to the local Vite dev server.
	// It is only set when dev mode is enabled (see NewUIHandler); nil otherwise.
	uiDevClient *fasthttp.HostClient
	// shellRewriter rewrites the pre-hydration shell. nil disables the rewrite
	// entirely, which is the OSS path.
	shellRewriter ShellRewriter
}

// NewUIHandler creates a new UIHandler instance. The optional shell rewriter
// keeps the upstream fs.ReadFileFS contract intact for callers and tests.
func NewUIHandler(uiContent fs.ReadFileFS, shellRewriters ...ShellRewriter) *UIHandler {
	h := &UIHandler{
		uiContent: uiContent,
	}
	if len(shellRewriters) > 0 {
		h.shellRewriter = shellRewriters[0]
	}
	// Only wire the dev-server proxy client when running in dev mode. Timeouts
	// guard against the local Vite server hanging dashboard requests if it is
	// unresponsive, falling back to the embedded UI instead.
	if IsDevMode() {
		h.uiDevClient = &fasthttp.HostClient{
			Addr:         uiDevServerAddr,
			ReadTimeout:  5 * time.Second,
			WriteTimeout: 5 * time.Second,
		}
	}
	return h
}

// RegisterRoutes registers the UI routes with the provided router.
func (h *UIHandler) RegisterRoutes(router *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	router.GET("/", lib.ChainMiddlewares(h.serveDashboard, middlewares...))
	router.GET("/{filepath:*}", lib.ChainMiddlewares(h.serveDashboard, middlewares...))
}

// serveDashboard serves the dashboard UI.
func (h *UIHandler) serveDashboard(ctx *fasthttp.RequestCtx) {
	if IsDevMode() && h.serveDevDashboard(ctx) {
		return
	}

	// Get the request path
	requestPath := string(ctx.Path())
	if requestPath == "/api" || strings.HasPrefix(requestPath, "/api/") {
		SendError(ctx, fasthttp.StatusNotFound, "Route not found: "+requestPath)
		return
	}

	if IsDevMode() && h.serveDevDashboard(ctx) {
		return
	}

	// Clean the path to prevent directory traversal
	cleanPath := path.Clean(requestPath)

	// Handle .txt files - map from /{page}.txt to /{page}/index.txt
	if strings.HasSuffix(cleanPath, ".txt") {
		// Remove .txt extension and add /index.txt
		basePath := strings.TrimSuffix(cleanPath, ".txt")
		if basePath == "/" || basePath == "" {
			basePath = "/index"
		}
		cleanPath = basePath + "/index.txt"
	}

	// Remove leading slash and add ui prefix
	if cleanPath == "/" {
		cleanPath = "ui/index.html"
	} else {
		cleanPath = "ui" + cleanPath
	}

	// Block hidden directories and files (any path segment starting with .)
	segments := strings.Split(cleanPath, "/")
	for _, segment := range segments {
		if strings.HasPrefix(segment, ".") {
			ctx.SetStatusCode(fasthttp.StatusNotFound)
			ctx.SetBodyString("404 - Not found")
			return
		}
	}

	// Block sensitive files
	baseName := filepath.Base(cleanPath)
	sensitiveFiles := []string{"package.json", "package-lock.json"}
	for _, sensitive := range sensitiveFiles {
		if baseName == sensitive {
			ctx.SetStatusCode(fasthttp.StatusNotFound)
			ctx.SetBodyString("404 - Not found")
			return
		}
	}

	// Check if this is a static asset request (has file extension)
	hasExtension := strings.Contains(filepath.Base(cleanPath), ".")

	// Try to read the file from embedded filesystem
	data, err := h.uiContent.ReadFile(cleanPath)
	if err != nil {

		// If it's a static asset (has extension) and not found, return 404
		if hasExtension {
			ctx.SetStatusCode(fasthttp.StatusNotFound)
			ctx.SetBodyString("404 - Static asset not found: " + requestPath)
			return
		}

		// For routes without extensions (SPA routing), try {path}/index.html first
		if !hasExtension {
			indexPath := cleanPath + "/index.html"
			data, err = h.uiContent.ReadFile(indexPath)
			if err == nil {
				cleanPath = indexPath
			} else {
				// If that fails, serve root index.html as fallback
				data, err = h.uiContent.ReadFile("ui/index.html")
				if err != nil {
					ctx.SetStatusCode(fasthttp.StatusNotFound)
					ctx.SetBodyString("404 - File not found")
					return
				}
				cleanPath = "ui/index.html"
			}
		} else {
			ctx.SetStatusCode(fasthttp.StatusNotFound)
			ctx.SetBodyString("404 - File not found")
			return
		}
	}

	// Give the build a chance to rewrite the static skeleton before it goes out
	// — see ShellRewriter. nil on OSS, where the embedded bytes are served
	// untouched.
	if h.shellRewriter != nil && filepath.Ext(cleanPath) == ".html" {
		data = h.shellRewriter(ctx, data)
	}

	// Set content type based on file extension
	ext := filepath.Ext(cleanPath)
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	ctx.SetContentType(contentType)

	// Set cache headers for static assets
	if strings.HasPrefix(cleanPath, "ui/assets/") {
		ctx.Response.Header.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if ext == ".html" {
		ctx.Response.Header.Set("Cache-Control", "no-cache")
	} else {
		ctx.Response.Header.Set("Cache-Control", "public, max-age=3600")
	}

	if serveStaticByteRange(ctx, data) {
		return
	}
	ctx.Response.Header.Set("Accept-Ranges", "bytes")
	ctx.SetBody(data)
}

// serveStaticByteRange handles a single RFC 7233 byte range. Bundled MP4
// metadata and browser seeking depend on predictable partial responses.
func serveStaticByteRange(ctx *fasthttp.RequestCtx, data []byte) bool {
	header := strings.TrimSpace(string(ctx.Request.Header.Peek("Range")))
	if header == "" {
		return false
	}
	if !strings.HasPrefix(header, "bytes=") || strings.Contains(header, ",") {
		ctx.Response.Header.Set("Content-Range", fmt.Sprintf("bytes */%d", len(data)))
		ctx.SetStatusCode(fasthttp.StatusRequestedRangeNotSatisfiable)
		return true
	}
	parts := strings.SplitN(strings.TrimPrefix(header, "bytes="), "-", 2)
	if len(parts) != 2 {
		ctx.Response.Header.Set("Content-Range", fmt.Sprintf("bytes */%d", len(data)))
		ctx.SetStatusCode(fasthttp.StatusRequestedRangeNotSatisfiable)
		return true
	}
	start := 0
	end := len(data) - 1
	if parts[0] == "" {
		suffixLength, err := strconv.Atoi(parts[1])
		if err != nil || suffixLength <= 0 || len(data) == 0 {
			ctx.Response.Header.Set("Content-Range", fmt.Sprintf("bytes */%d", len(data)))
			ctx.SetStatusCode(fasthttp.StatusRequestedRangeNotSatisfiable)
			return true
		}
		if suffixLength < len(data) {
			start = len(data) - suffixLength
		}
	} else {
		parsedStart, err := strconv.Atoi(parts[0])
		if err != nil || parsedStart < 0 || parsedStart >= len(data) {
			ctx.Response.Header.Set("Content-Range", fmt.Sprintf("bytes */%d", len(data)))
			ctx.SetStatusCode(fasthttp.StatusRequestedRangeNotSatisfiable)
			return true
		}
		start = parsedStart
	}
	if parts[0] != "" && parts[1] != "" {
		requestedEnd, err := strconv.Atoi(parts[1])
		if err != nil || requestedEnd < start {
			ctx.Response.Header.Set("Content-Range", fmt.Sprintf("bytes */%d", len(data)))
			ctx.SetStatusCode(fasthttp.StatusRequestedRangeNotSatisfiable)
			return true
		}
		if requestedEnd < end {
			end = requestedEnd
		}
	}
	ctx.Response.Header.Set("Accept-Ranges", "bytes")
	ctx.Response.Header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(data)))
	ctx.SetStatusCode(fasthttp.StatusPartialContent)
	ctx.SetBody(data[start : end+1])
	return true
}

// serveDevDashboard proxies dashboard requests to the local Vite dev server.
// Restricted to loopback clients: if the dev server happens to be bound to a
// non-loopback address, a remote client must not be able to tunnel to
// Vite-internal endpoints (e.g. /@fs/) via this proxy.
func (h *UIHandler) serveDevDashboard(ctx *fasthttp.RequestCtx) bool {
	if h.uiDevClient == nil {
		return false
	}
	if !ctx.RemoteIP().IsLoopback() {
		return false
	}

	var req fasthttp.Request
	var resp fasthttp.Response
	ctx.Request.CopyTo(&req)
	req.URI().SetScheme("http")
	req.URI().SetHost(uiDevServerAddr)
	req.Header.SetHost(uiDevServerAddr)

	if err := h.uiDevClient.Do(&req, &resp); err != nil {
		// Dev server unreachable (e.g. Vite not running); fall back to the
		// embedded UI by signalling the caller to serve from uiContent.
		return false
	}

	resp.CopyTo(&ctx.Response)
	return true
}
