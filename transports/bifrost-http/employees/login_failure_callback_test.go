package employees

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func TestEmployeeLoginAdmissionLimitsAuditAndQueries(t *testing.T) {
	store, cs := passwordTestStore(t)
	h, err := NewHandler(t.Context(), cs, nil)
	require.NoError(t, err)
	audits, queries := 0, 0
	h.SetLoginFailureAuditor(func(context.Context) error {
		audits++
		return nil
	})
	require.NoError(t, cs.DB().Callback().Query().Before("gorm:query").Register("login-admission-query", func(*gorm.DB) {
		queries++
	}))
	t.Cleanup(func() { cs.DB().Callback().Query().Remove("login-admission-query") })
	for attempt := range 7 {
		request := loginAdmissionRequest(10, fmt.Sprintf(`{"username":"unknown-%d"}`, attempt))
		h.login(request)
		status := fasthttp.StatusUnauthorized
		if attempt >= 5 {
			status = fasthttp.StatusTooManyRequests
		}
		require.Equal(t, status, request.Response.StatusCode())
		require.Equal(t, min(attempt+1, 5), queries)
		require.Equal(t, queries, audits)
		require.Empty(t, request.Response.Header.Peek(lib.HeaderAuditStatus))
	}
	cs.DB().Callback().Query().Remove("login-admission-query")
	require.Empty(t, sessionRows(t, store))
}

func TestEmployeeLoginFailureCallbackMatrix(t *testing.T) {
	// Credential rejections, audit errors, and non-credential failures must
	// remain distinct, including a counter failure before audit.
	for _, scenario := range []string{
		"unknown", "password", "hash_error", "missing_callback", "audit_error",
		"malformed", "limited", "inactive", "locked", "lookup_error", "counter_error",
		"success", "session_error",
	} {
		t.Run(scenario, func(t *testing.T) {
			store, cs := passwordTestStore(t)
			employee, _ := sessionLoginFixture(t, store)
			h := &Handler{store: store, configStore: cs, dummyHash: employee.PasswordHash,
				loginLimiter: &passwordAttemptRecorder{denied: scenario == "limited"}}
			fail := false
			audited := auditedTestStore(t, store, &fail)
			h.SetSelfServiceAuditAppenderFactory(func(*fasthttp.RequestCtx, string) EmployeeAuditAppender {
				return audited.auditAppender
			})
			auditCalls := 0
			if scenario != "missing_callback" {
				h.SetLoginFailureAuditor(func(ctx context.Context) error {
					auditCalls++
					deadline, ok := ctx.Deadline()
					require.True(t, ok)
					require.WithinDuration(t, time.Now().Add(30*time.Second), deadline, time.Second)
					require.Nil(t, ctx.Value(schemas.BifrostContextKeyUserID))
					if scenario == "audit_error" {
						return errors.New("private signing database diagnostic")
					}
					return nil
				})
			}
			body := `{"username":"session.fixture","password":"wrong-password"}`
			status, calls := fasthttp.StatusUnauthorized, 1
			switch scenario {
			case "unknown":
				body = `{"username":"unknown-employee-secret","password":"password-secret"}`
			case "hash_error":
				require.NoError(t, store.db(t.Context()).Model(employee).Update("password_hash", "invalid-hash-secret").Error)
			case "missing_callback":
				calls = 0
			case "malformed":
				body, status, calls = "{", fasthttp.StatusBadRequest, 0
			case "limited", "locked":
				status, calls = fasthttp.StatusTooManyRequests, 0
				if scenario == "locked" {
					require.NoError(t, store.db(t.Context()).Model(employee).Update("locked_until", time.Now().Add(time.Hour)).Error)
				}
			case "inactive":
				status, calls = fasthttp.StatusForbidden, 0
				require.NoError(t, store.db(t.Context()).Model(employee).Update("is_active", false).Error)
			case "lookup_error":
				status, calls = fasthttp.StatusInternalServerError, 0
				require.NoError(t, store.db(t.Context()).Callback().Query().Before("gorm:query").Register("login-audit-query", func(tx *gorm.DB) {
					tx.AddError(errors.New("private login query diagnostic"))
				}))
			case "counter_error":
				status, calls = fasthttp.StatusInternalServerError, 0
				require.NoError(t, store.db(t.Context()).Callback().Update().Before("gorm:update").Register("login-audit-counter", func(tx *gorm.DB) {
					tx.AddError(errors.New("private counter diagnostic"))
				}))
				t.Cleanup(func() {
					require.NoError(t, store.db(context.Background()).Callback().Update().Remove("login-audit-counter"))
				})
			case "success", "session_error":
				body, status, calls = `{"username":"session.fixture","password":"OriginalPassword!123"}`, fasthttp.StatusOK, 0
				if scenario == "session_error" {
					status = fasthttp.StatusInternalServerError
					require.NoError(t, store.db(t.Context()).Callback().Create().Before("gorm:create").Register("login-audit-session", func(tx *gorm.DB) {
						if tx.Statement.Table == (EmployeeSession{}).TableName() {
							tx.AddError(errors.New("private session diagnostic"))
						}
					}))
					t.Cleanup(func() {
						require.NoError(t, store.db(context.Background()).Callback().Create().Remove("login-audit-session"))
					})
				}
			}
			r := router.New()
			h.RegisterRoutes(r)
			request := employeeLoginRequest(body)
			request.SetUserValue(schemas.BifrostContextKeyUserID, "forged-admin-secret")
			r.Handler(request)
			require.Equal(t, status, request.Response.StatusCode(), string(request.Response.Body()))
			require.Equal(t, calls, auditCalls)
			require.NotContains(t, string(request.Response.Body()), "private")
			if status == fasthttp.StatusUnauthorized {
				expected := &fasthttp.RequestCtx{}
				sendError(expected, status, "用户名或密码错误")
				require.Equal(t, string(expected.Response.Body()), string(request.Response.Body()))
			}
			if scenario == "missing_callback" || scenario == "audit_error" {
				require.Equal(t, "failed", string(request.Response.Header.Peek(lib.HeaderAuditStatus)))
				require.Equal(t, true, request.UserValue(lib.FastHTTPUserValueAuditPersistenceFailed))
			} else {
				require.Empty(t, request.Response.Header.Peek(lib.HeaderAuditStatus))
			}
			if scenario == "lookup_error" {
				require.NoError(t, store.db(context.Background()).Callback().Query().Remove("login-audit-query"))
			}
			current, err := store.Get(t.Context(), employee.ID)
			require.NoError(t, err)
			count := 0
			switch scenario {
			case "password", "hash_error", "missing_callback", "audit_error":
				count = 1
			}
			require.Equal(t, count, current.FailedLoginCount)
			if scenario != "success" {
				require.Empty(t, request.Response.Header.Peek("Set-Cookie"))
				require.Empty(t, sessionRows(t, store))
			}
		})
	}
}

func TestEmployeeLoginFailureAuditDoesNotUndoAccountLockout(t *testing.T) {
	store, cs := passwordTestStore(t)
	employee, _ := sessionLoginFixture(t, store)
	h, err := NewHandler(t.Context(), cs, nil)
	require.NoError(t, err)
	calls := 0
	h.SetLoginFailureAuditor(func(context.Context) error {
		calls++
		return errors.New("private audit failure")
	})
	for range 5 {
		request := employeeLoginRequest(`{"username":"session.fixture","password":"wrong"}`)
		h.login(request)
		require.Equal(t, fasthttp.StatusUnauthorized, request.Response.StatusCode())
		require.Equal(t, "failed", string(request.Response.Header.Peek(lib.HeaderAuditStatus)))
	}
	current, err := store.Get(t.Context(), employee.ID)
	require.NoError(t, err)
	require.Zero(t, current.FailedLoginCount)
	require.NotNil(t, current.LockedUntil)
	require.True(t, current.LockedUntil.After(time.Now()))
	otherSource := loginAdmissionRequest(99, `{"username":"session.fixture","password":"OriginalPassword!123"}`)
	h.login(otherSource)
	require.Equal(t, fasthttp.StatusTooManyRequests, otherSource.Response.StatusCode())
	require.Equal(t, 5, calls)
	require.Empty(t, sessionRows(t, store))
}
