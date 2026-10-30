package employees

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"golang.org/x/crypto/bcrypt"
)

func BenchmarkEmployeeLoginFailureRequest(b *testing.B) {
	for _, variant := range []string{"unknown", "password", "hash_error", "success", "limited"} {
		b.Run(variant, func(b *testing.B) {
			store, cs := testStore(b)
			employee, _ := sessionLoginFixture(b, store)
			hash, err := bcrypt.GenerateFromPassword([]byte("benchmark-password"), bcrypt.MinCost)
			require.NoError(b, err)
			passwordHash := string(hash)
			if variant == "hash_error" {
				passwordHash = "invalid-test-hash"
			}
			require.NoError(b, store.db(context.Background()).Model(employee).Update("password_hash", passwordHash).Error)
			h := &Handler{store: store, configStore: cs, dummyHash: string(hash),
				loginLimiter: lib.NewBoundedPasswordLimiter(5, 15*time.Minute, 4096)}
			h.SetLoginFailureAuditor(func(context.Context) error { return nil })
			fail := false
			audited := auditedTestStore(b, store, &fail)
			h.SetSelfServiceAuditAppenderFactory(func(*fasthttp.RequestCtx, string) EmployeeAuditAppender {
				return audited.auditAppender
			})
			body := `{"username":"session.fixture","password":"wrong-password"}`
			if variant == "unknown" {
				body = `{"username":"unknown","password":"wrong-password"}`
			} else if variant == "success" {
				body = `{"username":"session.fixture","password":"benchmark-password"}`
			}
			request := employeeLoginRequest(body)
			status := fasthttp.StatusUnauthorized
			if variant == "success" {
				status = fasthttp.StatusOK
			} else if variant == "limited" {
				status = fasthttp.StatusTooManyRequests
			}
			b.ReportAllocs()
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				b.StopTimer()
				if variant == "limited" {
					h.loginLimiter = lib.NewBoundedPasswordLimiter(1, 15*time.Minute, 4096)
					finish, allowed := h.loginLimiter.Begin(request.RemoteIP().String(), "")
					require.True(b, allowed)
					finish(false)
					finish, allowed = h.loginLimiter.Begin(request.RemoteIP().String(), "session.fixture")
					require.True(b, allowed)
					finish(false)
				} else if index%5 == 0 {
					h.loginLimiter = lib.NewBoundedPasswordLimiter(5, 15*time.Minute, 4096)
				}
				require.NoError(b, store.db(context.Background()).Model(employee).
					Updates(map[string]any{"failed_login_count": 0, "locked_until": nil}).Error)
				request.ResetUserValues()
				request.Response.Reset()
				b.StartTimer()
				h.login(request)
				if request.Response.StatusCode() != status {
					b.Fatalf("%s: unexpected response %d", variant, request.Response.StatusCode())
				}
			}
		})
	}
}
