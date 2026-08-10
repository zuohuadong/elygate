package handlers

import (
	"encoding/json"
	"io/fs"
	"testing"
	"testing/fstest"

	"github.com/fasthttp/router"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestUIHandlerDoesNotServeSPAForUnknownAPIPaths(t *testing.T) {
	t.Parallel()

	r := router.New()
	NewUIHandler(readFileFS{FS: testUIContent()}).RegisterRoutes(r)

	for _, requestPath := range []string{"/api", "/api/not-a-real-endpoint"} {
		t.Run(requestPath, func(t *testing.T) {
			ctx := &fasthttp.RequestCtx{}
			ctx.Request.Header.SetMethod(fasthttp.MethodGet)
			ctx.Request.SetRequestURI(requestPath)
			r.Handler(ctx)

			require.Equal(t, fasthttp.StatusNotFound, ctx.Response.StatusCode())
			require.Equal(t, "application/json", string(ctx.Response.Header.ContentType()))
			var errorResponse struct {
				StatusCode int `json:"status_code"`
				Error      struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			require.NoError(t, json.Unmarshal(ctx.Response.Body(), &errorResponse))
			require.Equal(t, fasthttp.StatusNotFound, errorResponse.StatusCode)
			require.Equal(t, "Route not found: "+requestPath, errorResponse.Error.Message)
		})
	}
}

func TestUIHandlerKeepsRegisteredAPIRoutesAheadOfTheWildcard(t *testing.T) {
	t.Parallel()

	r := router.New()
	r.GET("/api/version", func(ctx *fasthttp.RequestCtx) { ctx.SetStatusCode(fasthttp.StatusNoContent) })
	NewUIHandler(readFileFS{FS: testUIContent()}).RegisterRoutes(r)
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodGet)
	ctx.Request.SetRequestURI("/api/version")
	r.Handler(ctx)

	require.Equal(t, fasthttp.StatusNoContent, ctx.Response.StatusCode())
}

func TestUIHandlerKeepsSPAFallbackForApplicationRoutes(t *testing.T) {
	t.Parallel()

	r := router.New()
	NewUIHandler(readFileFS{FS: testUIContent()}).RegisterRoutes(r)

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodGet)
	ctx.Request.SetRequestURI("/dashboard")
	r.Handler(ctx)

	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode())
	require.Equal(t, "text/html; charset=utf-8", string(ctx.Response.Header.ContentType()))
	require.Equal(t, "<html>panel</html>", string(ctx.Response.Body()))
}

func testUIContent() fstest.MapFS {
	return fstest.MapFS{
		"ui/index.html": &fstest.MapFile{Data: []byte("<html>panel</html>")},
	}
}

// Embedding fs.FS keeps the test fixture independent from production embed.FS.
type readFileFS struct {
	fs.FS
}

func (f readFileFS) ReadFile(name string) ([]byte, error) {
	return fs.ReadFile(f.FS, name)
}
