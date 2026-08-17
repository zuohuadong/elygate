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

func TestUIHandlerDoesNotServeSPAForUnknownOpenAIAPIPaths(t *testing.T) {
	t.Parallel()

	r := router.New()
	NewUIHandler(readFileFS{FS: testUIContent()}).RegisterRoutes(r)

	for _, requestPath := range []string{"/v1", "/v1/not-a-real-endpoint"} {
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
			require.Equal(t, "API endpoint not found", errorResponse.Error.Message)
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

func TestUIHandlerServesByteRangesForBundledMedia(t *testing.T) {
	t.Parallel()
	r := router.New()
	content := testUIContent()
	content["ui/assets/docs/demo.mp4"] = &fstest.MapFile{Data: []byte("0123456789")}
	NewUIHandler(readFileFS{FS: content}).RegisterRoutes(r)

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodGet)
	ctx.Request.Header.Set("Range", "bytes=2-5")
	ctx.Request.SetRequestURI("/assets/docs/demo.mp4")
	r.Handler(ctx)

	require.Equal(t, fasthttp.StatusPartialContent, ctx.Response.StatusCode())
	require.Equal(t, "2345", string(ctx.Response.Body()))
	require.Equal(t, "bytes 2-5/10", string(ctx.Response.Header.Peek("Content-Range")))
	require.Equal(t, "bytes", string(ctx.Response.Header.Peek("Accept-Ranges")))
	require.Equal(t, "video/mp4", string(ctx.Response.Header.ContentType()))
}

func TestUIHandlerRejectsUnsatisfiableByteRanges(t *testing.T) {
	t.Parallel()
	r := router.New()
	content := testUIContent()
	content["ui/assets/docs/demo.mp4"] = &fstest.MapFile{Data: []byte("0123456789")}
	NewUIHandler(readFileFS{FS: content}).RegisterRoutes(r)

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodGet)
	ctx.Request.Header.Set("Range", "bytes=20-30")
	ctx.Request.SetRequestURI("/assets/docs/demo.mp4")
	r.Handler(ctx)

	require.Equal(t, fasthttp.StatusRequestedRangeNotSatisfiable, ctx.Response.StatusCode())
	require.Equal(t, "bytes */10", string(ctx.Response.Header.Peek("Content-Range")))
}

func TestUIHandlerServesSuffixByteRangesForVideoMetadata(t *testing.T) {
	t.Parallel()
	r := router.New()
	content := testUIContent()
	content["ui/assets/docs/demo.mp4"] = &fstest.MapFile{Data: []byte("0123456789")}
	NewUIHandler(readFileFS{FS: content}).RegisterRoutes(r)

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodGet)
	ctx.Request.Header.Set("Range", "bytes=-4")
	ctx.Request.SetRequestURI("/assets/docs/demo.mp4")
	r.Handler(ctx)

	require.Equal(t, fasthttp.StatusPartialContent, ctx.Response.StatusCode())
	require.Equal(t, "6789", string(ctx.Response.Body()))
	require.Equal(t, "bytes 6-9/10", string(ctx.Response.Header.Peek("Content-Range")))
}

func TestUIHandlerServesOpenEndedByteRangesForVideoSeeking(t *testing.T) {
	t.Parallel()
	r := router.New()
	content := testUIContent()
	content["ui/assets/docs/demo.mp4"] = &fstest.MapFile{Data: []byte("0123456789")}
	NewUIHandler(readFileFS{FS: content}).RegisterRoutes(r)

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodGet)
	ctx.Request.Header.Set("Range", "bytes=6-")
	ctx.Request.SetRequestURI("/assets/docs/demo.mp4")
	r.Handler(ctx)

	require.Equal(t, fasthttp.StatusPartialContent, ctx.Response.StatusCode())
	require.Equal(t, "6789", string(ctx.Response.Body()))
	require.Equal(t, "bytes 6-9/10", string(ctx.Response.Header.Peek("Content-Range")))
	require.Equal(t, "bytes", string(ctx.Response.Header.Peek("Accept-Ranges")))
	require.Equal(t, "video/mp4", string(ctx.Response.Header.ContentType()))
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
