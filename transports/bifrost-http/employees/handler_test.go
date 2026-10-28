package employees

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

type passwordAttemptRecorder struct {
	finished []bool
	denied   bool
}

func (r *passwordAttemptRecorder) Begin(string, string) (func(bool), bool) {
	if r.denied {
		return nil, false
	}
	return func(success bool) { r.finished = append(r.finished, success) }, true
}

func employeePasswordRequest(token, csrf, body string) *fasthttp.RequestCtx {
	request := &fasthttp.RequestCtx{}
	request.Init(&fasthttp.Request{}, &net.TCPAddr{IP: net.ParseIP("192.0.2.20"), Port: 12002}, nil)
	request.Request.SetRequestURI("/employee/api/me/password")
	request.Request.Header.SetMethod(fasthttp.MethodPost)
	request.Request.Header.SetContentType("application/json")
	request.Request.Header.SetCookie(employeeCookieName, token)
	request.Request.Header.Set("X-CSRF-Token", csrf)
	request.Request.SetBodyString(body)
	return request
}

func employeeLoginRequest(body string) *fasthttp.RequestCtx {
	request := &fasthttp.RequestCtx{}
	request.Init(&fasthttp.Request{}, &net.TCPAddr{IP: net.ParseIP("192.0.2.40"), Port: 12004}, nil)
	request.Request.SetRequestURI("/employee/api/session/login")
	request.Request.Header.SetMethod(fasthttp.MethodPost)
	request.Request.Header.SetContentType("application/json")
	request.Request.SetBodyString(body)
	return request
}

func TestEmployeeSessionLoginRejectsPasswordResetAfterCredentialRead(t *testing.T) {
	store, configStore := passwordTestStore(t)
	ctx := context.Background()
	employee := &Employee{Username: "session.stale", Name: "Stale", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
	reset := false
	require.NoError(t, store.db(ctx).Callback().Query().After("gorm:query").Register("reset-after-employee-read", func(tx *gorm.DB) {
		if reset || tx.Statement.Table != (Employee{}).TableName() {
			return
		}
		reset = true
		require.NoError(t, store.ResetPassword(ctx, employee.ID, "ReplacementPassword!123"))
	}))
	t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Query().Remove("reset-after-employee-read")) })
	fail := false
	audited := auditedTestStore(t, store, &fail)
	h := &Handler{store: store, configStore: configStore, loginLimiter: &passwordAttemptRecorder{}}
	h.SetSelfServiceAuditAppenderFactory(func(*fasthttp.RequestCtx, string) EmployeeAuditAppender { return audited.auditAppender })
	request := employeeLoginRequest(`{"username":"session.stale","password":"OriginalPassword!123"}`)
	h.login(request)
	require.True(t, reset)
	require.Equal(t, fasthttp.StatusUnauthorized, request.Response.StatusCode(), "stale password verification must not mint a session")
	require.Empty(t, request.Response.Header.Peek("Set-Cookie"))
	var sessionCount int64
	require.NoError(t, store.db(ctx).Model(&EmployeeSession{}).Count(&sessionCount).Error)
	require.Zero(t, sessionCount)
}

func TestEmployeeSessionLoginRollsBackWhenMetadataWriteFails(t *testing.T) {
	store, configStore := passwordTestStore(t)
	ctx := context.Background()
	employee := &Employee{Username: "session.metadata", Name: "Metadata", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
	require.NoError(t, store.db(ctx).Callback().Update().Before("gorm:update").Register("fail-login-metadata", func(tx *gorm.DB) {
		if tx.Statement.Table == (Employee{}).TableName() {
			tx.AddError(errors.New("private login metadata failure"))
		}
	}))
	t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Update().Remove("fail-login-metadata")) })
	recorder := &passwordAttemptRecorder{}
	h := &Handler{store: store, configStore: configStore, loginLimiter: recorder}
	request := employeeLoginRequest(`{"username":"session.metadata","password":"OriginalPassword!123"}`)
	h.login(request)
	require.Equal(t, fasthttp.StatusInternalServerError, request.Response.StatusCode())
	require.Equal(t, []bool{false}, recorder.finished)
	require.Empty(t, request.Response.Header.Peek("Set-Cookie"))
	var sessionCount int64
	require.NoError(t, store.db(ctx).Model(&EmployeeSession{}).Count(&sessionCount).Error)
	require.Zero(t, sessionCount)
}

func TestEmployeeSessionLogoutAuditFailurePreservesSession(t *testing.T) {
	store, configStore := passwordTestStore(t)
	ctx := context.Background()
	employee := &Employee{Username: "session.logout", Name: "Logout", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
	require.NoError(t, store.CreateSession(ctx, employee.ID, encrypt.HashSHA256("logout-token"), encrypt.HashSHA256("logout-csrf"), time.Now().Add(time.Hour)))
	fail := true
	audited := auditedTestStore(t, store, &fail)
	h := &Handler{store: store, configStore: configStore}
	h.SetSelfServiceAuditAppenderFactory(func(*fasthttp.RequestCtx, string) EmployeeAuditAppender { return audited.auditAppender })
	request := employeePasswordRequest("logout-token", "logout-csrf", "{}")
	request.Request.SetRequestURI("/employee/api/session/logout")
	h.logout(request)
	require.Equal(t, fasthttp.StatusInternalServerError, request.Response.StatusCode())
	require.Empty(t, request.Response.Header.Peek("Set-Cookie"))
	_, _, err := store.Session(ctx, encrypt.HashSHA256("logout-token"))
	require.NoError(t, err)
	require.Empty(t, employeeAuditRows(t, store))
}

func TestEmployeeSessionLoginRoutes(t *testing.T) {
	for _, scenario := range []string{
		"success", "missing_factory", "nil_appender", "audit_failure", "insert_failure",
		"invalid_json", "bad_password", "unknown", "inactive", "locked", "limited",
		"lookup_failure", "failed_login_write_failure", "locked_after_read", "disabled_after_read",
	} {
		t.Run(scenario, func(t *testing.T) {
			store, configStore := passwordTestStore(t)
			ctx := context.Background()
			employee, _ := sessionLoginFixture(t, store)
			fail := scenario == "audit_failure"
			audited := auditedTestStore(t, store, &fail)
			recorder := &passwordAttemptRecorder{denied: scenario == "limited"}
			h := &Handler{store: store, configStore: configStore, loginLimiter: recorder, dummyHash: employee.PasswordHash}
			factoryCalls := 0
			if scenario != "missing_factory" {
				h.SetSelfServiceAuditAppenderFactory(func(_ *fasthttp.RequestCtx, id string) EmployeeAuditAppender {
					require.Equal(t, employee.ID, id)
					factoryCalls++
					if scenario == "nil_appender" {
						return nil
					}
					return audited.auditAppender
				})
			}
			body := `{"username":"session.fixture","password":"OriginalPassword!123"}`
			expectedStatus := fasthttp.StatusInternalServerError
			switch scenario {
			case "success":
				expectedStatus = fasthttp.StatusOK
			case "invalid_json":
				body, expectedStatus = "{", fasthttp.StatusBadRequest
			case "bad_password", "failed_login_write_failure":
				body = `{"username":"session.fixture","password":"WrongPassword!123"}`
				if scenario == "bad_password" {
					expectedStatus = fasthttp.StatusUnauthorized
				} else {
					require.NoError(t, store.db(ctx).Callback().Update().Before("gorm:update").Register("route-failed-login-write", func(tx *gorm.DB) {
						tx.AddError(errors.New("private failed-login diagnostic"))
					}))
					t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Update().Remove("route-failed-login-write")) })
				}
			case "unknown":
				body, expectedStatus = `{"username":"missing","password":"OriginalPassword!123"}`, fasthttp.StatusUnauthorized
			case "inactive":
				require.NoError(t, store.db(ctx).Model(employee).Update("is_active", false).Error)
				expectedStatus = fasthttp.StatusForbidden
			case "locked", "limited":
				if scenario == "locked" {
					require.NoError(t, store.db(ctx).Model(employee).Update("locked_until", time.Now().Add(time.Hour)).Error)
				}
				expectedStatus = fasthttp.StatusTooManyRequests
			case "lookup_failure":
				require.NoError(t, store.db(ctx).Callback().Query().Before("gorm:query").Register("route-login-lookup", func(tx *gorm.DB) {
					tx.AddError(errors.New("private login lookup diagnostic"))
				}))
				t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Query().Remove("route-login-lookup")) })
			case "insert_failure":
				require.NoError(t, store.db(ctx).Callback().Create().Before("gorm:create").Register("route-login-insert", func(tx *gorm.DB) {
					if tx.Statement.Table == (EmployeeSession{}).TableName() {
						tx.AddError(errors.New("private login insert diagnostic"))
					}
				}))
				t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Create().Remove("route-login-insert")) })
			case "locked_after_read", "disabled_after_read":
				changed := false
				require.NoError(t, store.db(ctx).Callback().Query().After("gorm:query").Register("route-login-state-change", func(tx *gorm.DB) {
					if changed || tx.Statement.Table != (Employee{}).TableName() {
						return
					}
					changed = true
					if scenario == "locked_after_read" {
						require.NoError(t, store.db(ctx).Model(employee).Update("locked_until", time.Now().Add(time.Hour)).Error)
					} else {
						require.NoError(t, store.db(ctx).Model(employee).Update("is_active", false).Error)
					}
				}))
				t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Query().Remove("route-login-state-change")) })
				expectedStatus = fasthttp.StatusUnauthorized
			}
			r := router.New()
			h.RegisterRoutes(r)
			request := employeeLoginRequest(body)
			r.Handler(request)
			require.Equal(t, expectedStatus, request.Response.StatusCode(), string(request.Response.Body()))
			require.NotContains(t, string(request.Response.Body()), "private")
			if scenario == "lookup_failure" {
				require.NoError(t, store.db(ctx).Callback().Query().Remove("route-login-lookup"))
			}
			if scenario == "invalid_json" || scenario == "limited" {
				require.Empty(t, recorder.finished)
			} else {
				require.Equal(t, []bool{scenario == "success"}, recorder.finished)
			}
			current, err := store.Get(ctx, employee.ID)
			require.NoError(t, err)
			if scenario != "success" {
				require.Empty(t, request.Response.Header.Peek("Set-Cookie"))
				require.NotContains(t, string(request.Response.Body()), "csrf_token")
				require.Nil(t, current.LastLoginAt)
				require.Empty(t, sessionRows(t, store))
				require.Empty(t, employeeAuditRows(t, store))
				return
			}
			require.Equal(t, 1, factoryCalls)
			require.NotNil(t, current.LastLoginAt)
			var tokenCookie, csrfCookie fasthttp.Cookie
			tokenCookie.SetKey(employeeCookieName)
			csrfCookie.SetKey(employeeCSRFCookieName)
			require.True(t, request.Response.Header.Cookie(&tokenCookie))
			require.True(t, request.Response.Header.Cookie(&csrfCookie))
			require.NotEmpty(t, tokenCookie.Value())
			require.NotEmpty(t, csrfCookie.Value())
			require.True(t, tokenCookie.HTTPOnly())
			require.Equal(t, "/employee", string(tokenCookie.Path()))
			sessions := sessionRows(t, store)
			require.Len(t, sessions, 1)
			require.Equal(t, encrypt.HashSHA256(string(tokenCookie.Value())), sessions[0].TokenHash)
			require.Equal(t, encrypt.HashSHA256(string(csrfCookie.Value())), sessions[0].CSRFTokenHash)
			require.Len(t, employeeAuditRows(t, store), 1)
			require.NotContains(t, string(request.Response.Body()), employee.PasswordHash)
		})
	}
}

func TestEmployeeSessionLogoutRoutes(t *testing.T) {
	for _, scenario := range []string{
		"success", "missing_factory", "nil_appender", "audit_failure", "delete_failure",
		"session_lookup_failure", "employee_lookup_failure", "invalid_csrf", "missing_token",
		"expired", "revoked_after_auth", "expired_after_auth",
	} {
		t.Run(scenario, func(t *testing.T) {
			store, configStore := passwordTestStore(t)
			ctx := context.Background()
			employee, login := sessionLoginFixture(t, store)
			require.NoError(t, store.CreateSession(ctx, employee.ID, encrypt.HashSHA256("logout-route-token"), encrypt.HashSHA256("logout-route-csrf"), login.ExpiresAt))
			fail := scenario == "audit_failure"
			audited := auditedTestStore(t, store, &fail)
			h := &Handler{store: store, configStore: configStore}
			if scenario != "missing_factory" {
				h.SetSelfServiceAuditAppenderFactory(func(_ *fasthttp.RequestCtx, id string) EmployeeAuditAppender {
					require.Equal(t, employee.ID, id)
					switch scenario {
					case "nil_appender":
						return nil
					case "revoked_after_auth":
						require.NoError(t, store.DeleteSession(ctx, encrypt.HashSHA256("logout-route-token")))
					case "expired_after_auth":
						require.NoError(t, store.db(ctx).Model(&EmployeeSession{}).Where("employee_id = ?", id).Update("expires_at", time.Now().Add(-time.Second)).Error)
					}
					return audited.auditAppender
				})
			}
			expectedStatus := fasthttp.StatusInternalServerError
			switch scenario {
			case "success", "revoked_after_auth", "expired_after_auth":
				expectedStatus = fasthttp.StatusNoContent
			case "invalid_csrf":
				expectedStatus = fasthttp.StatusForbidden
			case "missing_token", "expired":
				expectedStatus = fasthttp.StatusUnauthorized
				if scenario == "expired" {
					require.NoError(t, store.db(ctx).Model(&EmployeeSession{}).Where("employee_id = ?", employee.ID).Update("expires_at", time.Now().Add(-time.Second)).Error)
				}
			case "session_lookup_failure", "employee_lookup_failure":
				table := (EmployeeSession{}).TableName()
				if scenario == "employee_lookup_failure" {
					table = (Employee{}).TableName()
				}
				require.NoError(t, store.db(ctx).Callback().Query().Before("gorm:query").Register("logout-auth-query", func(tx *gorm.DB) {
					if tx.Statement.Table == table {
						tx.AddError(errors.New("private authentication lookup diagnostic"))
					}
				}))
				t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Query().Remove("logout-auth-query")) })
			case "delete_failure":
				require.NoError(t, store.db(ctx).Callback().Delete().Before("gorm:delete").Register("logout-route-delete", func(tx *gorm.DB) {
					tx.AddError(errors.New("private deletion diagnostic"))
				}))
				t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Delete().Remove("logout-route-delete")) })
			}
			r := router.New()
			h.RegisterRoutes(r)
			request := employeePasswordRequest("logout-route-token", "logout-route-csrf", "{}")
			request.Request.SetRequestURI("/employee/api/session/logout")
			if scenario == "invalid_csrf" {
				request.Request.Header.Set("X-CSRF-Token", "wrong-csrf")
			}
			if scenario == "missing_token" {
				request.Request.Header.DelCookie(employeeCookieName)
			}
			r.Handler(request)
			require.Equal(t, expectedStatus, request.Response.StatusCode(), string(request.Response.Body()))
			require.NotContains(t, string(request.Response.Body()), "private")
			if scenario == "session_lookup_failure" || scenario == "employee_lookup_failure" {
				require.NoError(t, store.db(ctx).Callback().Query().Remove("logout-auth-query"))
			}
			if expectedStatus == fasthttp.StatusNoContent || scenario == "expired" {
				require.NotEmpty(t, request.Response.Header.Peek("Set-Cookie"))
				require.Empty(t, sessionRows(t, store))
			} else {
				require.Empty(t, request.Response.Header.Peek("Set-Cookie"), "failed logout must retain recovery credentials")
				require.Len(t, sessionRows(t, store), 1)
			}
			if scenario == "success" || scenario == "expired_after_auth" {
				require.Len(t, employeeAuditRows(t, store), 1)
			} else {
				require.Empty(t, employeeAuditRows(t, store))
			}
		})
	}
}

func BenchmarkEmployeeSessionLoginRequest(b *testing.B) {
	store, configStore := testStore(b)
	sessionLoginFixture(b, store)
	fail := false
	audited := auditedTestStore(b, store, &fail)
	h := &Handler{store: store, configStore: configStore, loginLimiter: &passwordAttemptRecorder{}}
	h.SetSelfServiceAuditAppenderFactory(func(*fasthttp.RequestCtx, string) EmployeeAuditAppender { return audited.auditAppender })
	r := router.New()
	h.RegisterRoutes(r)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		request := employeeLoginRequest(`{"username":"session.fixture","password":"OriginalPassword!123"}`)
		r.Handler(request)
		if request.Response.StatusCode() != fasthttp.StatusOK {
			b.Fatalf("login failed: %s", request.Response.Body())
		}
	}
}

func TestEmployeePasswordChangeRollsBackWhenSessionRevocationFails(t *testing.T) {
	store, configStore := passwordTestStore(t)
	ctx := context.Background()
	employee := &Employee{Username: "password.rollback", Name: "Rollback", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
	for _, token := range []string{"password-current-token", "password-other-token"} {
		require.NoError(t, store.CreateSession(ctx, employee.ID, encrypt.HashSHA256(token), encrypt.HashSHA256("password-csrf"), time.Now().Add(time.Hour)))
	}
	if store.db(ctx).Dialector.Name() == "postgres" {
		require.NoError(t, store.db(ctx).Exec(`CREATE FUNCTION reject_password_session_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private deletion diagnostic'; END $$`).Error)
		require.NoError(t, store.db(ctx).Exec(`CREATE TRIGGER block_password_session_delete BEFORE DELETE ON elygate_employee_sessions FOR EACH ROW EXECUTE FUNCTION reject_password_session_delete()`).Error)
	} else {
		require.NoError(t, store.db(ctx).Exec(`CREATE TRIGGER block_password_session_delete BEFORE DELETE ON elygate_employee_sessions BEGIN SELECT RAISE(ABORT, 'private deletion diagnostic'); END`).Error)
	}
	h := &Handler{store: store, configStore: configStore, loginLimiter: lib.NewPasswordLimiter(5, time.Minute)}
	auditAttempts := 0
	h.SetSelfServiceAuditAppenderFactory(func(*fasthttp.RequestCtx, string) EmployeeAuditAppender {
		return func(context.Context, *gorm.DB, EmployeeAuditEvent) error {
			auditAttempts++
			return nil
		}
	})
	r := router.New()
	h.RegisterRoutes(r)
	request := employeePasswordRequest("password-current-token", "password-csrf",
		`{"current_password":"OriginalPassword!123","new_password":"ReplacementPassword!123"}`)
	r.Handler(request)
	require.Equal(t, fasthttp.StatusInternalServerError, request.Response.StatusCode())
	current, err := store.Get(ctx, employee.ID)
	require.NoError(t, err)
	require.Equal(t, employee.PasswordHash, current.PasswordHash, "failed revocation must not commit the password")
	require.True(t, current.MustChangePassword)
	require.NotContains(t, string(request.Response.Body()), "private deletion diagnostic")
	require.Zero(t, auditAttempts, "session deletion must fail before audit, not due to missing wiring")
}

func TestEmployeePasswordAttemptAlwaysFinishes(t *testing.T) {
	store, configStore := testStore(t)
	ctx := context.Background()
	employee := &Employee{Username: "password.attempt", Name: "Attempts", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
	require.NoError(t, store.CreateSession(ctx, employee.ID, encrypt.HashSHA256("attempt-token"), encrypt.HashSHA256("attempt-csrf"), time.Now().Add(time.Hour)))
	recorder := &passwordAttemptRecorder{}
	h := &Handler{store: store, configStore: configStore, loginLimiter: recorder}
	request := employeePasswordRequest("attempt-token", "attempt-csrf",
		`{"current_password":"IncorrectPassword!123","new_password":"ReplacementPassword!123"}`)
	h.changePassword(request)
	require.Equal(t, fasthttp.StatusUnauthorized, request.Response.StatusCode())
	require.Equal(t, []bool{false}, recorder.finished)
}

func TestEmployeePasswordRouteAuditAndStaleState(t *testing.T) {
	for _, scenario := range []string{"success", "missing_factory", "nil_appender", "audit_failure", "write_failure", "query_failure", "revoked_after_auth", "inactive_after_auth", "changed_hash_after_auth", "expired_after_auth"} {
		t.Run(scenario, func(t *testing.T) {
			store, configStore := passwordTestStore(t)
			ctx := context.Background()
			employee := &Employee{Username: "password.route", Name: "Route", IsActive: true}
			require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
			for _, token := range []string{"route-retained", "route-other"} {
				require.NoError(t, store.CreateSession(ctx, employee.ID, encrypt.HashSHA256(token), encrypt.HashSHA256("route-csrf"), time.Now().Add(time.Hour)))
			}
			fail := scenario == "audit_failure"
			audited := auditedTestStore(t, store, &fail)
			recorder := &passwordAttemptRecorder{}
			h := &Handler{store: store, configStore: configStore, loginLimiter: recorder}
			if scenario != "missing_factory" {
				h.SetSelfServiceAuditAppenderFactory(func(request *fasthttp.RequestCtx, employeeID string) EmployeeAuditAppender {
					require.Equal(t, employee.ID, employeeID)
					switch scenario {
					case "nil_appender":
						return nil
					case "write_failure":
						require.NoError(t, store.db(ctx).Callback().Update().Before("gorm:update").Register("fail-password-write", func(tx *gorm.DB) {
							tx.AddError(errors.New("private password update diagnostic"))
						}))
						t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Update().Remove("fail-password-write")) })
					case "query_failure":
						queryFailed := false
						require.NoError(t, store.db(ctx).Callback().Query().Before("gorm:query").Register("fail-session-query", func(tx *gorm.DB) {
							if !queryFailed && tx.Statement.Table == (EmployeeSession{}).TableName() {
								queryFailed = true
								tx.AddError(errors.New("private session query diagnostic"))
							}
						}))
						t.Cleanup(func() { require.NoError(t, store.db(ctx).Callback().Query().Remove("fail-session-query")) })
					case "revoked_after_auth":
						require.NoError(t, store.DeleteSession(ctx, encrypt.HashSHA256("route-retained")))
					case "inactive_after_auth":
						require.NoError(t, store.db(ctx).Model(employee).Update("is_active", false).Error)
					case "changed_hash_after_auth":
						require.NoError(t, store.db(ctx).Model(employee).Update("password_hash", "hash-written-by-concurrent-reset").Error)
					case "expired_after_auth":
						require.NoError(t, store.db(ctx).Model(&EmployeeSession{}).Where("token_hash = ?", encrypt.HashSHA256("route-retained")).Update("expires_at", time.Now().Add(-time.Second)).Error)
					}
					return audited.auditAppender
				})
			}
			r := router.New()
			h.RegisterRoutes(r)
			request := employeePasswordRequest("route-retained", "route-csrf",
				`{"current_password":"OriginalPassword!123","new_password":"ReplacementPassword!123"}`)
			r.Handler(request)
			status := fasthttp.StatusInternalServerError
			if scenario == "success" {
				status = fasthttp.StatusOK
			} else if strings.HasSuffix(scenario, "_after_auth") {
				status = fasthttp.StatusUnauthorized
			}
			require.Equal(t, status, request.Response.StatusCode(), string(request.Response.Body()))
			require.Equal(t, []bool{scenario == "success"}, recorder.finished)
			require.Empty(t, request.Response.Header.Peek("Set-Cookie"), "write failures must not discard the retained session cookie")
			for _, secret := range []string{"private", employee.PasswordHash, "OriginalPassword!123", "ReplacementPassword!123", "route-retained", "route-csrf"} {
				require.NotContains(t, string(request.Response.Body()), secret)
			}
			current, err := store.Get(ctx, employee.ID)
			require.NoError(t, err)
			if scenario == "success" {
				matched, err := encrypt.CompareHash(current.PasswordHash, "ReplacementPassword!123")
				require.NoError(t, err)
				require.True(t, matched)
				require.Len(t, employeeAuditRows(t, store), 1)
				_, _, err = store.Session(ctx, encrypt.HashSHA256("route-retained"))
				require.NoError(t, err)
				_, _, err = store.Session(ctx, encrypt.HashSHA256("route-other"))
				require.ErrorIs(t, err, gorm.ErrRecordNotFound)
			} else {
				expectedHash := employee.PasswordHash
				if scenario == "changed_hash_after_auth" {
					expectedHash = "hash-written-by-concurrent-reset"
				}
				require.Equal(t, expectedHash, current.PasswordHash)
				require.Empty(t, employeeAuditRows(t, store))
				var sessionCount int64
				require.NoError(t, store.db(ctx).Model(&EmployeeSession{}).Where("token_hash = ?", encrypt.HashSHA256("route-other")).Count(&sessionCount).Error)
				require.EqualValues(t, 1, sessionCount)
			}
		})
	}
}

func TestEmployeePasswordRouteRejectsInvalidRequests(t *testing.T) {
	for _, scenario := range []string{"malformed", "short_password", "wrong_password", "hash_failure", "wrong_csrf", "missing_cookie", "unknown_cookie", "expired_cookie", "inactive", "throttled"} {
		t.Run(scenario, func(t *testing.T) {
			store, configStore := testStore(t)
			ctx := context.Background()
			employee := &Employee{Username: "password.invalid", Name: "Invalid", IsActive: true}
			require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", nil))
			expires := time.Now().Add(time.Hour)
			if scenario == "expired_cookie" {
				expires = time.Now().Add(-time.Second)
			}
			require.NoError(t, store.CreateSession(ctx, employee.ID, encrypt.HashSHA256("invalid-token"), encrypt.HashSHA256("invalid-csrf"), expires))
			recorder := &passwordAttemptRecorder{}
			h := &Handler{store: store, configStore: configStore, loginLimiter: recorder}
			auditAttempts := 0
			h.SetSelfServiceAuditAppenderFactory(func(*fasthttp.RequestCtx, string) EmployeeAuditAppender {
				return func(context.Context, *gorm.DB, EmployeeAuditEvent) error {
					auditAttempts++
					return nil
				}
			})
			body := `{"current_password":"OriginalPassword!123","new_password":"ReplacementPassword!123"}`
			status := fasthttp.StatusUnauthorized
			switch scenario {
			case "malformed":
				body, status = "{", fasthttp.StatusBadRequest
			case "short_password":
				body, status = `{"current_password":"OriginalPassword!123","new_password":"short"}`, fasthttp.StatusBadRequest
			case "wrong_password":
				body = `{"current_password":"WrongPassword!123","new_password":"ReplacementPassword!123"}`
			case "hash_failure":
				body, status = `{"current_password":"OriginalPassword!123","new_password":"`+strings.Repeat("a", 73)+`"}`, fasthttp.StatusInternalServerError
			case "wrong_csrf":
				status = fasthttp.StatusForbidden
			case "inactive":
				require.NoError(t, store.db(ctx).Model(employee).Update("is_active", false).Error)
			case "throttled":
				status = fasthttp.StatusTooManyRequests
				h.loginLimiter = lib.NewPasswordLimiter(1, time.Minute)
				finish, allowed := h.loginLimiter.Begin("192.0.2.20", employee.Username)
				require.True(t, allowed)
				finish(false)
			}
			request := employeePasswordRequest("invalid-token", "invalid-csrf", body)
			switch scenario {
			case "wrong_csrf":
				request.Request.Header.Set("X-CSRF-Token", "wrong-csrf")
			case "missing_cookie":
				request.Request.Header.DelCookie(employeeCookieName)
			case "unknown_cookie":
				request.Request.Header.SetCookie(employeeCookieName, "unknown-token")
			}
			h.changePassword(request)
			require.Equal(t, status, request.Response.StatusCode(), string(request.Response.Body()))
			require.Zero(t, auditAttempts)
			if scenario == "wrong_password" || scenario == "hash_failure" {
				require.Equal(t, []bool{false}, recorder.finished)
			} else {
				require.Empty(t, recorder.finished)
			}
			current, err := store.Get(ctx, employee.ID)
			require.NoError(t, err)
			require.Equal(t, employee.PasswordHash, current.PasswordHash)
		})
	}
}

func TestAdminAccessMiddlewareRequiresAuthenticatedAdmin(t *testing.T) {
	h := &Handler{}
	called := false
	next := func(ctx *fasthttp.RequestCtx) {
		called = true
		ctx.SetStatusCode(fasthttp.StatusNoContent)
	}
	middleware := h.AdminAccessMiddleware()(next)

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.SetMethod(fasthttp.MethodPost)
	ctx.Request.Header.SetContentType("application/json")
	ctx.Request.SetHost("admin.example.test")
	ctx.SetUserValue(schemas.BifrostContextKeyAuthBypassed, true)
	middleware(ctx)

	require.False(t, called)
	require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode())
}

func TestAdminAccessMiddlewareRejectsCrossOriginAndNonJSONWrites(t *testing.T) {
	h := &Handler{}
	next := func(ctx *fasthttp.RequestCtx) { ctx.SetStatusCode(fasthttp.StatusNoContent) }
	middleware := h.AdminAccessMiddleware()(next)

	nonJSON := &fasthttp.RequestCtx{}
	nonJSON.Request.Header.SetMethod(fasthttp.MethodPost)
	nonJSON.Request.Header.SetContentType("text/plain")
	nonJSON.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(nonJSON)
	require.Equal(t, fasthttp.StatusUnsupportedMediaType, nonJSON.Response.StatusCode())

	crossOrigin := &fasthttp.RequestCtx{}
	crossOrigin.Request.Header.SetMethod(fasthttp.MethodPost)
	crossOrigin.Request.Header.SetContentType("application/json")
	crossOrigin.Request.SetHost("admin.example.test")
	crossOrigin.Request.Header.Set("Origin", "https://attacker.example.test")
	crossOrigin.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(crossOrigin)
	require.Equal(t, fasthttp.StatusForbidden, crossOrigin.Response.StatusCode())

	spoofedForwardedHost := &fasthttp.RequestCtx{}
	spoofedForwardedHost.Request.Header.SetMethod(fasthttp.MethodPost)
	spoofedForwardedHost.Request.Header.SetContentType("application/json")
	spoofedForwardedHost.Request.SetHost("admin.example.test")
	spoofedForwardedHost.Request.Header.Set("Origin", "https://attacker.example.test")
	spoofedForwardedHost.Request.Header.Set("X-Forwarded-Host", "attacker.example.test")
	spoofedForwardedHost.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(spoofedForwardedHost)
	require.Equal(t, fasthttp.StatusForbidden, spoofedForwardedHost.Response.StatusCode())

	sameOrigin := &fasthttp.RequestCtx{}
	sameOrigin.Request.Header.SetMethod(fasthttp.MethodPost)
	sameOrigin.Request.Header.SetContentType("application/json")
	sameOrigin.Request.SetHost("admin.example.test")
	sameOrigin.Request.Header.Set("Origin", "https://admin.example.test")
	sameOrigin.SetUserValue(schemas.IsLocalAdminContextKey, true)
	middleware(sameOrigin)
	require.Equal(t, fasthttp.StatusNoContent, sameOrigin.Response.StatusCode())
}

func TestLogoutPreservesSessionCookieWhenDeletionFails(t *testing.T) {
	store, _ := testStore(t)
	ctx := context.Background()
	employee := &Employee{Username: "logout-user", Name: "Logout User", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "StrongPassword!123", nil))
	const token = "employee-session-token"
	const csrf = "employee-session-csrf"
	require.NoError(t, store.CreateSession(ctx, employee.ID, encrypt.HashSHA256(token), encrypt.HashSHA256(csrf), time.Now().Add(time.Hour)))
	require.NoError(t, store.db(ctx).Exec(`CREATE TRIGGER block_employee_session_delete BEFORE DELETE ON elygate_employee_sessions BEGIN SELECT RAISE(ABORT, 'delete blocked'); END`).Error)

	h := &Handler{store: store}
	req := &fasthttp.RequestCtx{}
	req.Init(&fasthttp.Request{}, &net.TCPAddr{IP: net.ParseIP("192.0.2.10"), Port: 12001}, nil)
	req.Request.Header.Set("Cookie", employeeCookieName+"="+token)
	req.Request.Header.Set("X-CSRF-Token", csrf)
	h.logout(req)

	require.Equal(t, fasthttp.StatusInternalServerError, req.Response.StatusCode())
	require.Empty(t, req.Response.Header.Peek("Set-Cookie"))
}

func TestEmployeeAdministrationBindsAuditToRequestAndFailsClosed(t *testing.T) {
	store, configStore := testStore(t)
	h := &Handler{store: store, configStore: configStore}
	for _, configured := range []bool{false, true} {
		t.Run(map[bool]string{false: "unconfigured", true: "failure"}[configured], func(t *testing.T) {
			request := &fasthttp.RequestCtx{}
			if configured {
				h.SetAuditAppenderFactory(func(captured *fasthttp.RequestCtx) EmployeeAuditAppender {
					require.Same(t, request, captured)
					return func(context.Context, *gorm.DB, EmployeeAuditEvent) error {
						return errors.New("signing failed")
					}
				})
			}
			employee := &Employee{Username: "audit.rollback", Name: "Rollback", IsActive: true}
			err := h.administrationStore(request).Create(context.Background(), employee, "StrongPassword!123", nil)
			require.ErrorIs(t, err, ErrEmployeeAudit)
			_, err = store.Get(context.Background(), employee.ID)
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
			require.True(t, sendAuditFailure(request, ErrEmployeeAudit))
			require.Equal(t, fasthttp.StatusInternalServerError, request.Response.StatusCode())
			require.NotContains(t, string(request.Response.Body()), "temporary_password")
		})
	}
}

func TestEmployeeMutationContextIsBounded(t *testing.T) {
	ctx, cancel := employeeMutationContext()
	defer cancel()
	deadline, ok := ctx.Deadline()
	require.True(t, ok)
	require.WithinDuration(t, time.Now().Add(30*time.Second), deadline, time.Second)
	select {
	case <-ctx.Done():
		t.Fatal("new mutation context must not already be cancelled")
	default:
	}
	cancel()
	require.ErrorIs(t, ctx.Err(), context.Canceled)
}

func TestEmployeeAdministrativeRoutesFailWithoutCommittingWhenAuditFails(t *testing.T) {
	store, configStore := testStore(t)
	ctx := context.Background()
	for _, id := range []string{"vk-route-existing", "vk-route-imported", "vk-route-create", "vk-route-import"} {
		seedVirtualKey(t, configStore, id, "sk-bf-"+id)
	}
	employee := &Employee{Username: "route.existing", Name: "Before", IsActive: true}
	require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", []string{"vk-route-existing"}))
	require.NoError(t, store.CreateSession(ctx, employee.ID, "route-token", "route-csrf", time.Now().Add(time.Hour)))
	imported := &Employee{Username: "route.imported", Name: "Imported", IsActive: true}
	_, err := store.BulkCreateImport(ctx, "batch-route-existing", "digest", []BulkCreateEntry{{
		Employee: imported, Password: "StrongPassword!123", VirtualKeyIDs: []string{"vk-route-imported"},
	}})
	require.NoError(t, err)
	h := &Handler{store: store, configStore: configStore}
	auditAttempts := 0
	h.SetAuditAppenderFactory(func(*fasthttp.RequestCtx) EmployeeAuditAppender {
		return func(context.Context, *gorm.DB, EmployeeAuditEvent) error {
			auditAttempts++
			return errors.New("audit unavailable")
		}
	})
	r := router.New()
	h.RegisterRoutes(r)
	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{fasthttp.MethodPost, "/api/employees", `{"username":"route.created","name":"Create","virtual_key_ids":["vk-route-create"]}`},
		{fasthttp.MethodPost, "/api/employees/import", `{"batch_id":"batch-route-new","employees":[{"username":"route.newimport","name":"New","virtual_key_ids":["vk-route-import"],"temporary_password":"ImportPassword!123"}]}`},
		{fasthttp.MethodPut, "/api/employees/" + employee.ID, `{"username":"route.existing","name":"After","is_active":false,"virtual_key_ids":["vk-route-existing"]}`},
		{fasthttp.MethodPost, "/api/employees/" + employee.ID + "/reset-password", `{}`},
		{fasthttp.MethodDelete, "/api/employees/import/batch-route-existing", `{}`},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			request := &fasthttp.RequestCtx{}
			request.Request.Header.SetMethod(tc.method)
			request.Request.Header.SetContentType("application/json")
			request.Request.SetRequestURI(tc.path)
			request.Request.SetBodyString(tc.body)
			request.SetUserValue(schemas.IsLocalAdminContextKey, true)
			r.Handler(request)
			require.Equal(t, fasthttp.StatusInternalServerError, request.Response.StatusCode(), string(request.Response.Body()))
			require.NotContains(t, string(request.Response.Body()), "temporary_password")
			require.NotContains(t, string(request.Response.Body()), "audit unavailable")
		})
	}
	require.Equal(t, 5, auditAttempts)
	current, err := store.Get(ctx, employee.ID)
	require.NoError(t, err)
	require.Equal(t, "Before", current.Name)
	require.True(t, current.IsActive)
	require.Equal(t, employee.PasswordHash, current.PasswordHash)
	current, err = store.Get(ctx, imported.ID)
	require.NoError(t, err)
	require.True(t, current.IsActive)
	_, _, err = store.Session(ctx, "route-token")
	require.NoError(t, err)
	employees, err := store.List(ctx)
	require.NoError(t, err)
	require.Len(t, employees, 2)
	var batch EmployeeImportBatch
	require.ErrorIs(t, store.db(ctx).First(&batch, "id = ?", "batch-route-new").Error, gorm.ErrRecordNotFound)

	request := &fasthttp.RequestCtx{}
	request.Request.Header.SetMethod(fasthttp.MethodPost)
	request.Request.Header.SetContentType("application/json")
	request.Request.SetRequestURI("/api/employees")
	r.Handler(request)
	require.Equal(t, fasthttp.StatusUnauthorized, request.Response.StatusCode())
	require.Equal(t, 5, auditAttempts, "authorization failure must not attempt a mutation or audit")
}
