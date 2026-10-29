package handlers

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"golang.org/x/crypto/bcrypt"
)

type loginLimitConfigStore struct {
	*loginAuditConfigStore
	reads atomic.Int64
}

func (s *loginLimitConfigStore) GetAuthConfig(ctx context.Context) (*configstore.AuthConfig, error) {
	s.reads.Add(1)
	return s.loginAuditConfigStore.GetAuthConfig(ctx)
}

func newLoginLimitStore(t *testing.T) *loginLimitConfigStore {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("test-password"), bcrypt.MinCost)
	require.NoError(t, err)
	return &loginLimitConfigStore{loginAuditConfigStore: &loginAuditConfigStore{
		auth: &configstore.AuthConfig{IsEnabled: true,
			AdminUserName: schemas.NewSecretVar("admin"), AdminPassword: schemas.NewSecretVar(string(hash))},
	}}
}

func loginLimitRequest(source, body string) *fasthttp.RequestCtx {
	request := &fasthttp.RequestCtx{}
	request.Init(&fasthttp.Request{}, &net.TCPAddr{IP: net.ParseIP(source), Port: 12000}, nil)
	request.Request.Header.SetMethod("POST")
	request.Request.SetRequestURI("/api/session/login")
	request.Request.SetBodyString(body)
	return request
}

func TestDashboardLoginLimitProductionConstructor(t *testing.T) {
	// Cases: first/fifth/sixth, username/header rotation, other real IP, fresh handler.
	store := newLoginLimitStore(t)
	handler := NewSessionHandler(store, nil)
	require.NotNil(t, handler.loginLimiter)
	for attempt := 0; attempt < 8; attempt++ {
		request := loginLimitRequest("192.0.2.10", fmt.Sprintf(`{"username":"rotated-%d"}`, attempt))
		request.Request.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", attempt))
		request.Request.Header.Set("X-Real-IP", fmt.Sprintf("203.0.113.%d", attempt))
		handler.login(request)
		if attempt < 5 {
			require.Equal(t, 401, request.Response.StatusCode())
			requireSingleAuditChange(t, request, "dashboard_session.login_failed")
		} else {
			require.Equal(t, 429, request.Response.StatusCode())
			require.Empty(t, auditChanges(t, request))
			require.Contains(t, string(request.Response.Body()), "Too many login attempts.")
		}
		require.EqualValues(t, min(attempt+1, 5), store.reads.Load())
		require.Empty(t, request.Response.Header.PeekCookie("token"))
	}
	require.Zero(t, store.sessionAdds)
	for _, fresh := range []struct {
		handler *SessionHandler
		source  string
	}{
		{handler, "192.0.2.11"},
		{NewSessionHandler(store, nil), "192.0.2.10"},
	} {
		request := loginLimitRequest(fresh.source, `{"username":"admin","password":"test-password"}`)
		fresh.handler.login(request)
		require.Equal(t, 200, request.Response.StatusCode())
		require.Empty(t, auditChanges(t, request))
		require.NotEmpty(t, request.Response.Header.PeekCookie("token"))
	}
	require.Equal(t, 2, store.sessionAdds)
}

func TestDashboardLoginLimitResponsePriority(t *testing.T) {
	// Cases: malformed, disabled/missing auth, read failure, write failure, success.
	for _, scenario := range []string{"malformed", "disabled", "missing-auth", "config-error", "session-error", "success"} {
		t.Run(scenario, func(t *testing.T) {
			store := newLoginLimitStore(t)
			body := `{"username":"admin","password":"test-password"}`
			status := 200
			switch scenario {
			case "malformed":
				body, status = `{`, 400
			case "disabled":
				store.auth.IsEnabled, status = false, 403
			case "missing-auth":
				store.auth, status = nil, 403
			case "config-error":
				store.authErr, status = errors.New("test config unavailable"), 500
			case "session-error":
				store.sessionErr, status = errors.New("test session unavailable"), 500
			}
			handler := NewSessionHandler(store, nil)
			for attempt := 0; attempt < 6; attempt++ {
				request := loginLimitRequest("192.0.2.10", body)
				handler.login(request)
				expected := status
				if attempt == 5 && scenario != "malformed" {
					expected = 429
				}
				require.Equal(t, expected, request.Response.StatusCode())
				require.Empty(t, auditChanges(t, request))
				if expected != 200 {
					require.Empty(t, request.Response.Header.PeekCookie("token"))
				}
			}
			if scenario == "malformed" {
				require.Zero(t, store.reads.Load())
				for range 5 {
					request := loginLimitRequest("192.0.2.10", `{}`)
					handler.login(request)
					require.Equal(t, 401, request.Response.StatusCode(), "malformed requests do not spend budget")
				}
			} else {
				require.EqualValues(t, 5, store.reads.Load())
				malformed := loginLimitRequest("192.0.2.10", `{`)
				handler.login(malformed)
				require.Equal(t, 400, malformed.Response.StatusCode(), "malformed remains 400 even after exhaustion")
			}
			expectedWrites := 0
			if scenario == "session-error" || scenario == "success" {
				expectedWrites = 5
			}
			require.Equal(t, expectedWrites, store.sessionAdds)
		})
	}
}

func TestDashboardLoginLimitConcurrentAttempts(t *testing.T) {
	store := newLoginLimitStore(t)
	handler := NewSessionHandler(store, nil)
	var workers sync.WaitGroup
	start := make(chan struct{})
	statuses := make(chan int, 32)
	events := make(chan int, 32)
	for range 32 {
		workers.Go(func() {
			<-start
			request := loginLimitRequest("192.0.2.10", `{"username":"unknown"}`)
			handler.login(request)
			statuses <- request.Response.StatusCode()
			changes, _ := request.UserValue(configstore.AuditChangesUserValueKey).([]configstore.AuditChange)
			events <- len(changes)
		})
	}
	close(start)
	workers.Wait()
	close(statuses)
	close(events)
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	require.Equal(t, map[int]int{401: 5, 429: 27}, counts)
	count := 0
	for changes := range events {
		count += changes
	}
	require.Equal(t, 5, count)
	require.EqualValues(t, 5, store.reads.Load())
	require.Zero(t, store.sessionAdds)
}

type dashboardLimitRecorder struct {
	key, username string
	finished      []bool
	begins        int
	denied        bool
}

func (l *dashboardLimitRecorder) Begin(key, username string) (func(bool), bool) {
	l.begins++
	l.key, l.username = key, username
	if l.denied {
		return nil, false
	}
	return func(success bool) { l.finished = append(l.finished, success) }, true
}

func TestDashboardLoginLimitFinishesAttempts(t *testing.T) {
	for _, scenario := range []string{"missing-store", "malformed", "denied", "disabled", "missing-auth", "config-error", "username", "password", "hash-error", "session-error", "success"} {
		t.Run(scenario, func(t *testing.T) {
			store := newLoginLimitStore(t)
			body := `{"username":"admin","password":"test-password"}`
			switch scenario {
			case "malformed":
				body = `{`
			case "disabled":
				store.auth.IsEnabled = false
			case "missing-auth":
				store.auth = nil
			case "config-error":
				store.authErr = errors.New("test config unavailable")
			case "username":
				body = `{"username":"unknown"}`
			case "password":
				body = `{"username":"admin","password":"wrong"}`
			case "hash-error":
				store.auth.AdminPassword = schemas.NewSecretVar("invalid")
			case "session-error":
				store.sessionErr = errors.New("test session unavailable")
			}
			recorder := &dashboardLimitRecorder{denied: scenario == "denied"}
			handler := NewSessionHandler(store, nil)
			handler.loginLimiter = recorder
			if scenario == "missing-store" {
				handler.configStore = nil
			}
			handler.login(loginLimitRequest("192.0.2.10", body))
			if scenario == "missing-store" || scenario == "malformed" {
				require.Zero(t, recorder.begins)
				require.Empty(t, recorder.finished)
				require.Zero(t, store.reads.Load())
				return
			}
			require.Equal(t, 1, recorder.begins)
			require.Equal(t, "192.0.2.10", recorder.key)
			require.Empty(t, recorder.username, "supplied username must not select the bucket")
			if scenario == "denied" {
				require.Empty(t, recorder.finished)
				require.Zero(t, store.reads.Load())
				return
			}
			require.Equal(t, []bool{scenario == "success"}, recorder.finished)
		})
	}
}

func TestDashboardLoginLimitDirectTestHandlerBypass(t *testing.T) {
	store := newLoginLimitStore(t)
	handler := &SessionHandler{configStore: store}
	for range 8 {
		request := loginLimitRequest("192.0.2.10", `{}`)
		handler.login(request)
		require.Equal(t, 401, request.Response.StatusCode())
		requireSingleAuditChange(t, request, "dashboard_session.login_failed")
	}
	require.EqualValues(t, 8, store.reads.Load())
}

func TestDashboardLoginLimitSourceCapacity(t *testing.T) {
	store := newLoginLimitStore(t)
	store.auth.IsEnabled = false
	handler := NewSessionHandler(store, nil)
	for source := range 4097 {
		ip := fmt.Sprintf("2001:db8::%x", source+1)
		request := loginLimitRequest(ip, `{}`)
		handler.login(request)
		expected := 403
		if source == 4096 {
			expected = 429
		}
		require.Equal(t, expected, request.Response.StatusCode())
	}
	require.EqualValues(t, 4096, store.reads.Load())
	request := loginLimitRequest("2001:db8::1", `{}`)
	handler.login(request)
	require.Equal(t, 403, request.Response.StatusCode(), "known source retains its remaining budget at capacity")
	require.EqualValues(t, 4097, store.reads.Load())
	require.Zero(t, store.sessionAdds)
}

func BenchmarkDashboardLoginRateLimit(b *testing.B) {
	hash, err := bcrypt.GenerateFromPassword([]byte("benchmark-password"), bcrypt.MinCost)
	require.NoError(b, err)
	for _, path := range []string{"wrong_username", "wrong_password", "hash_error", "success", "throttled"} {
		b.Run(path, func(b *testing.B) {
			store := &loginAuditConfigStore{auth: &configstore.AuthConfig{IsEnabled: true,
				AdminUserName: schemas.NewSecretVar("admin"), AdminPassword: schemas.NewSecretVar(string(hash))}}
			body := `{"username":"admin","password":"benchmark-password"}`
			switch path {
			case "wrong_username", "throttled":
				body = `{"username":"unknown","password":"benchmark-password"}`
			case "wrong_password":
				body = `{"username":"admin","password":"wrong"}`
			case "hash_error":
				store.auth.AdminPassword = schemas.NewSecretVar("invalid")
			}
			handler := NewSessionHandler(store, nil)
			request := loginLimitRequest("192.0.2.10", body)
			if path == "throttled" {
				for range 5 {
					handler.login(request)
				}
			}
			b.ReportAllocs()
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				// Refill outside timing; samples include cold-source work once per five attempts.
				if path != "throttled" && index%5 == 0 {
					b.StopTimer()
					handler.loginLimiter = lib.NewBoundedPasswordLimiter(5, 15*time.Minute, 4096)
					b.StartTimer()
				}
				request.ResetUserValues()
				request.Response.Reset()
				handler.login(request)
			}
		})
	}
}
