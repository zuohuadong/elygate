package employees

import (
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func loginAdmissionRequest(source byte, body string) *fasthttp.RequestCtx {
	request := &fasthttp.RequestCtx{}
	request.Init(&fasthttp.Request{}, &net.TCPAddr{IP: net.IPv4(192, 0, 2, source)}, nil)
	request.Request.SetRequestURI("/employee/api/session/login")
	request.Request.Header.SetMethod(fasthttp.MethodPost)
	request.Request.Header.SetContentType("application/json")
	request.Request.SetBodyString(body)
	return request
}

func TestEmployeeLoginAdmissionCannotRotateUsernamesOrForwardedHeaders(t *testing.T) {
	store, cs := testStore(t)
	h, err := NewHandler(t.Context(), cs, nil)
	require.NoError(t, err)
	r := router.New()
	h.RegisterRoutes(r)
	// Cases: first through fifth, sixth with unknown or valid-looking input,
	// malformed before admission, other source, and handler recreation.
	for attempt := range 7 {
		body := fmt.Sprintf(`{"username":"unknown-%d","password":"wrong"}`, attempt)
		request := loginAdmissionRequest(10, body)
		request.Request.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", attempt))
		request.Request.Header.Set("X-Real-IP", fmt.Sprintf("203.0.113.%d", attempt))
		if attempt == 6 {
			request.Request.SetBodyString(`{"username":"valid-looking","password":"correct-looking"}`)
		}
		r.Handler(request)
		status := fasthttp.StatusUnauthorized
		if attempt >= 5 {
			status = fasthttp.StatusTooManyRequests
		}
		require.Equal(t, status, request.Response.StatusCode())
		require.Empty(t, request.Response.Header.Peek("Set-Cookie"))
	}
	malformed := loginAdmissionRequest(10, "{")
	r.Handler(malformed)
	require.Equal(t, fasthttp.StatusBadRequest, malformed.Response.StatusCode())
	other := loginAdmissionRequest(11, `{"username":"unknown"}`)
	r.Handler(other)
	require.Equal(t, fasthttp.StatusUnauthorized, other.Response.StatusCode())
	fresh, err := NewHandler(t.Context(), cs, nil)
	require.NoError(t, err)
	request := loginAdmissionRequest(10, `{"username":"unknown"}`)
	fresh.login(request)
	require.Equal(t, fasthttp.StatusUnauthorized, request.Response.StatusCode())
	require.Empty(t, sessionRows(t, store))
}

func TestEmployeeLoginAdmissionCapacityStopsBeforeStoreLookup(t *testing.T) {
	// A nil store makes any admitted lookup fail loudly.
	h := &Handler{loginLimiter: lib.NewBoundedPasswordLimiter(5, time.Minute, 1)}
	finish, allowed := h.loginLimiter.Begin("192.0.2.1", "")
	require.True(t, allowed)
	finish(false)
	request := loginAdmissionRequest(2, `{"username":"unknown"}`)
	h.login(request)
	require.Equal(t, fasthttp.StatusTooManyRequests, request.Response.StatusCode())
	require.Empty(t, request.Response.Header.Peek(lib.HeaderAuditStatus))
	require.Empty(t, request.Response.Header.Peek("Set-Cookie"))
}

func TestEmployeeLoginAdmissionProductionCapacity(t *testing.T) {
	_, cs := testStore(t)
	h, err := NewHandler(t.Context(), cs, nil)
	require.NoError(t, err)
	for index := range 4096 {
		finish, allowed := h.loginLimiter.Begin(fmt.Sprintf("source-%d", index), "")
		require.True(t, allowed)
		finish(false)
	}
	_, allowed := h.loginLimiter.Begin("overflow", "")
	require.False(t, allowed)
	_, allowed = h.loginLimiter.Begin("source-0", "")
	require.True(t, allowed, "capacity cannot discard an existing source's remaining budget")
}

func TestEmployeeLoginAdmissionConcurrentDeniedBeforeStoreLookup(t *testing.T) {
	h := &Handler{loginLimiter: lib.NewBoundedPasswordLimiter(5, time.Minute, 4096)}
	for range 5 {
		finish, allowed := h.loginLimiter.Begin("192.0.2.10", "")
		require.True(t, allowed)
		finish(false)
	}
	var denied atomic.Int32
	var requests sync.WaitGroup
	for attempt := range 32 {
		requests.Go(func() {
			request := loginAdmissionRequest(10, fmt.Sprintf(`{"username":"rotated-%d"}`, attempt))
			h.login(request)
			if request.Response.StatusCode() == fasthttp.StatusTooManyRequests {
				denied.Add(1)
			}
		})
	}
	requests.Wait()
	require.EqualValues(t, 32, denied.Load())
}
