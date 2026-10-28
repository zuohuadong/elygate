package server

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"path/filepath"
	"testing"
	"time"

	"github.com/fasthttp/router"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/employees"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func TestEmployeeAuditAppenderUsesCallerTransactionAndTrustedIdentity(t *testing.T) {
	for _, key := range []string{"", "employee-audit-test-key-not-a-production-secret"} {
		name := "compact"
		if key != "" {
			name = "signed"
		}
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
			encrypt.Init(key, logger)
			t.Cleanup(func() { encrypt.Init("", logger) })
			store, err := configstore.NewConfigStore(ctx, &configstore.Config{
				Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
				Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "employee-audit.db")},
			}, logger)
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, store.Close(ctx)) })
			controlStore, err := controlplane.NewStoreWithBindingMode(ctx, store, controlplane.ApplicationBindingRequired)
			require.NoError(t, err)
			request := &fasthttp.RequestCtx{}
			request.SetUserValue(schemas.IsLocalAdminContextKey, true)
			request.SetUserValue(lib.FastHTTPUserValueManagementAuditActor, "local-admin:operator")
			request.Request.Header.Set("X-User-ID", "forged-user")
			appender := employeeAuditAppender(store, request)
			request.SetUserValue(lib.FastHTTPUserValueManagementAuditActor, "changed-after-capture")
			event := employees.EmployeeAuditEvent{
				Action: "employee.password_reset", Resource: "employee", ResourceID: "employee-1",
			}
			forced := errors.New("rollback after audit")
			require.ErrorIs(t, store.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
				if err := appender(ctx, tx, event); err != nil {
					return err
				}
				return forced
			}), forced)
			rows, err := controlStore.ListAudit(ctx, 10)
			require.NoError(t, err)
			require.Empty(t, rows, "the audit must roll back with the caller's transaction")

			require.NoError(t, store.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
				return appender(ctx, tx, event)
			}))
			rows, err = controlStore.ListAudit(ctx, 10)
			require.NoError(t, err)
			require.Len(t, rows, 1, "only one representation belongs in the control-plane feed")
			require.Equal(t, "local-admin:operator", rows[0].ActorID)
			require.Equal(t, event.Action, rows[0].Action)
			var compactCount, signedCount int64
			require.NoError(t, store.DB().Model(&controlplane.AuditEvent{}).Count(&compactCount).Error)
			require.NoError(t, store.DB().Model(&configtables.TableGovernanceAuditEvent{}).Count(&signedCount).Error)
			if key == "" {
				require.EqualValues(t, 1, compactCount)
				require.Zero(t, signedCount)
			} else {
				require.Zero(t, compactCount)
				require.EqualValues(t, 1, signedCount)
				var signed configtables.TableGovernanceAuditEvent
				require.NoError(t, store.DB().First(&signed).Error)
				require.NotEmpty(t, signed.Signature)
			}
			encoded, err := json.Marshal(rows)
			require.NoError(t, err)
			require.NotContains(t, string(encoded), "forged-user")
		})
	}
}

func TestEmployeeSelfServicePasswordAuditUsesEmployeeIdentityAndCallerTransaction(t *testing.T) {
	for _, key := range []string{"", "employee-self-service-test-key-not-a-production-secret"} {
		name := "compact"
		if key != "" {
			name = "signed"
		}
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
			encrypt.Init(key, logger)
			t.Cleanup(func() { encrypt.Init("", logger) })
			store, err := configstore.NewConfigStore(ctx, &configstore.Config{
				Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
				Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "self-service-audit.db")},
			}, logger)
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, store.Close(ctx)) })
			controlStore, err := controlplane.NewStoreWithBindingMode(ctx, store, controlplane.ApplicationBindingRequired)
			require.NoError(t, err)
			employeeStore, err := employees.NewStore(ctx, store)
			require.NoError(t, err)
			employee := &employees.Employee{Username: "self.service", Name: "Private employee name", IsActive: true}
			require.NoError(t, employeeStore.Create(ctx, employee, "OriginalPassword!123", nil))
			for _, token := range []string{"self-retained", "self-other"} {
				require.NoError(t, employeeStore.CreateSession(ctx, employee.ID, encrypt.HashSHA256(token), encrypt.HashSHA256("self-csrf"), time.Now().Add(time.Hour)))
			}
			handler, err := employees.NewHandler(ctx, store, nil)
			require.NoError(t, err)
			fail := true
			handler.SetSelfServiceAuditAppenderFactory(func(request *fasthttp.RequestCtx, employeeID string) employees.EmployeeAuditAppender {
				appender := employeeSelfServiceAuditAppender(store, request, employeeID)
				// Later middleware values must not change the captured audit actor.
				request.SetUserValue(lib.FastHTTPUserValueManagementAuditActor, "changed-after-capture")
				return func(ctx context.Context, tx *gorm.DB, event employees.EmployeeAuditEvent) error {
					if err := appender(ctx, tx, event); err != nil {
						return err
					}
					if fail {
						return errors.New("private signing/database diagnostic after insert")
					}
					return nil
				}
			})
			r := router.New()
			handler.RegisterRoutes(r)
			for _, expectedStatus := range []int{fasthttp.StatusInternalServerError, fasthttp.StatusOK} {
				request := &fasthttp.RequestCtx{}
				request.Init(&fasthttp.Request{}, &net.TCPAddr{IP: net.ParseIP("192.0.2.30"), Port: 12003}, nil)
				request.Request.SetRequestURI("/employee/api/me/password")
				request.Request.Header.SetMethod(fasthttp.MethodPost)
				request.Request.Header.SetContentType("application/json")
				request.Request.Header.SetCookie("employee_token", "self-retained")
				request.Request.Header.Set("X-CSRF-Token", "self-csrf")
				request.Request.Header.Set("X-User-ID", "forged-user")
				request.SetUserValue(schemas.IsLocalAdminContextKey, true)
				request.SetUserValue(schemas.BifrostContextKeyUserID, "forged-admin")
				request.SetUserValue(lib.FastHTTPUserValueManagementAuditActor, "forged-management-actor")
				request.Request.SetBodyString(`{"current_password":"OriginalPassword!123","new_password":"ReplacementPassword!123","employee_id":"forged-employee"}`)
				r.Handler(request)
				require.Equal(t, expectedStatus, request.Response.StatusCode(), string(request.Response.Body()))
				require.NotContains(t, string(request.Response.Body()), "private")
				rows, err := controlStore.ListAudit(ctx, 10)
				require.NoError(t, err)
				current, err := employeeStore.Get(ctx, employee.ID)
				require.NoError(t, err)
				if fail {
					require.Empty(t, rows)
					require.Equal(t, employee.PasswordHash, current.PasswordHash)
					for _, token := range []string{"self-retained", "self-other"} {
						_, _, err := employeeStore.Session(ctx, encrypt.HashSHA256(token))
						require.NoError(t, err)
					}
					fail = false
					continue
				}
				require.Len(t, rows, 1)
				require.Equal(t, "employee:"+employee.ID, rows[0].ActorID)
				require.Equal(t, "employee.password_changed", rows[0].Action)
				require.Equal(t, employee.ID, rows[0].ResourceID)
				encoded, err := json.Marshal(rows)
				require.NoError(t, err)
				for _, secret := range []string{"forged", "changed-after-capture", employee.Name, employee.Username, "OriginalPassword!123", "ReplacementPassword!123", employee.PasswordHash, current.PasswordHash, "self-retained", "self-csrf"} {
					require.NotContains(t, string(encoded), secret)
				}
				if key != "" {
					var signed configtables.TableGovernanceAuditEvent
					require.NoError(t, store.DB().First(&signed).Error)
					require.False(t, signed.LocalAdmin)
					require.Empty(t, signed.RoleID)
					require.Equal(t, "employee-session", signed.AuthMethod)
					require.NotEmpty(t, signed.Signature)
					raw, err := json.Marshal(signed)
					require.NoError(t, err)
					require.NotContains(t, string(raw), "OriginalPassword!123")
					require.NotContains(t, string(raw), "self-retained")
				}
			}
		})
	}
}

func TestEmployeeSessionRoutesUseTransactionalTrustedAudit(t *testing.T) {
	for _, key := range []string{"", "employee-session-test-key-not-a-production-secret"} {
		name := "compact"
		if key != "" {
			name = "signed"
		}
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
			encrypt.Init(key, logger)
			t.Cleanup(func() { encrypt.Init("", logger) })
			store, err := configstore.NewConfigStore(ctx, &configstore.Config{
				Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
				Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "session-audit.db")},
			}, logger)
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, store.Close(ctx)) })
			controlStore, err := controlplane.NewStoreWithBindingMode(ctx, store, controlplane.ApplicationBindingRequired)
			require.NoError(t, err)
			employeeStore, err := employees.NewStore(ctx, store)
			require.NoError(t, err)
			employee := &employees.Employee{Username: "session.identity", Name: "Private Session Employee", IsActive: true}
			require.NoError(t, employeeStore.Create(ctx, employee, "OriginalPassword!123", nil))
			handler, err := employees.NewHandler(ctx, store, nil)
			require.NoError(t, err)
			failAudit := true
			handler.SetSelfServiceAuditAppenderFactory(func(request *fasthttp.RequestCtx, employeeID string) employees.EmployeeAuditAppender {
				require.Equal(t, employee.ID, employeeID)
				appender := employeeSelfServiceAuditAppender(store, request, employeeID)
				request.SetUserValue(lib.FastHTTPUserValueManagementAuditActor, "changed-after-capture")
				return func(ctx context.Context, tx *gorm.DB, event employees.EmployeeAuditEvent) error {
					if err := appender(ctx, tx, event); err != nil {
						return err
					}
					if failAudit {
						return errors.New("private session audit diagnostic")
					}
					return nil
				}
			})
			r := router.New()
			handler.RegisterRoutes(r)
			controlplane.NewHandler(controlStore, nil).RegisterRoutes(r)
			token, csrf := "", ""
			for _, step := range []struct {
				name   string
				path   string
				fail   bool
				status int
				events int
			}{
				{"login_rollback", "/employee/api/session/login", true, 500, 0},
				{"login_commit", "/employee/api/session/login", false, 200, 1},
				{"logout_rollback", "/employee/api/session/logout", true, 500, 1},
				{"logout_commit", "/employee/api/session/logout", false, 204, 2},
				{"repeated_logout", "/employee/api/session/logout", false, 401, 2},
			} {
				t.Run(step.name, func(t *testing.T) {
					failAudit = step.fail
					request := &fasthttp.RequestCtx{}
					request.Init(&fasthttp.Request{}, &net.TCPAddr{IP: net.ParseIP("192.0.2.31"), Port: 12005}, nil)
					request.Request.SetRequestURI(step.path)
					request.Request.Header.SetMethod(fasthttp.MethodPost)
					request.Request.Header.SetContentType("application/json")
					request.Request.Header.Set("X-User-ID", "forged-user")
					request.SetUserValue(schemas.IsLocalAdminContextKey, true)
					request.SetUserValue(schemas.BifrostContextKeyUserID, "forged-admin")
					request.SetUserValue(lib.FastHTTPUserValueManagementAuditActor, "forged-management")
					request.Request.SetBodyString(`{"username":"session.identity","password":"OriginalPassword!123","employee_id":"forged-employee","auth_method":"forged-method"}`)
					if step.path == "/employee/api/session/logout" {
						request.Request.Header.SetCookie("employee_token", token)
						request.Request.Header.Set("X-CSRF-Token", csrf)
					}
					r.Handler(request)
					require.Equal(t, step.status, request.Response.StatusCode(), string(request.Response.Body()))
					require.NotContains(t, string(request.Response.Body()), "private session audit diagnostic")
					require.Equal(t, true, request.UserValue(schemas.IsLocalAdminContextKey))
					require.Equal(t, "forged-admin", request.UserValue(schemas.BifrostContextKeyUserID), "audit identity must not overwrite authorization")
					if step.fail {
						require.Empty(t, request.Response.Header.Peek("Set-Cookie"))
					}
					if step.name == "login_commit" {
						var tokenCookie, csrfCookie fasthttp.Cookie
						tokenCookie.SetKey("employee_token")
						csrfCookie.SetKey("employee_csrf")
						require.True(t, request.Response.Header.Cookie(&tokenCookie))
						require.True(t, request.Response.Header.Cookie(&csrfCookie))
						token, csrf = string(tokenCookie.Value()), string(csrfCookie.Value())
						require.NotEmpty(t, token)
						require.NotEmpty(t, csrf)
					}
					var sessionCount int64
					require.NoError(t, store.DB().Model(&employees.EmployeeSession{}).Count(&sessionCount).Error)
					wantSessions := int64(0)
					if step.name == "login_commit" || step.name == "logout_rollback" {
						wantSessions = 1
					}
					require.Equal(t, wantSessions, sessionCount)
					feed := &fasthttp.RequestCtx{}
					feed.Request.SetRequestURI("/api/control-plane/audit-events")
					feed.Request.Header.SetMethod(fasthttp.MethodGet)
					r.Handler(feed)
					require.Equal(t, fasthttp.StatusUnauthorized, feed.Response.StatusCode())
					feed.Response.Reset()
					feed.SetUserValue(schemas.IsLocalAdminContextKey, true)
					r.Handler(feed)
					require.Equal(t, fasthttp.StatusOK, feed.Response.StatusCode(), string(feed.Response.Body()))
					var payload struct {
						Events []controlplane.AuditEvent `json:"data"`
					}
					require.NoError(t, json.Unmarshal(feed.Response.Body(), &payload))
					require.Len(t, payload.Events, step.events, string(feed.Response.Body()))
					for _, event := range payload.Events {
						require.Equal(t, "employee:"+employee.ID, event.ActorID)
						require.Equal(t, "employee_session", event.ResourceType)
						require.NotEmpty(t, event.ResourceID)
						require.NotEqual(t, employee.ID, event.ResourceID)
					}
					for _, secret := range []string{"forged", "changed-after-capture", employee.Name, employee.Username, employee.PasswordHash, "OriginalPassword!123"} {
						require.NotContains(t, string(feed.Response.Body()), secret)
					}
					if token != "" {
						for _, secret := range []string{token, csrf, encrypt.HashSHA256(token), encrypt.HashSHA256(csrf)} {
							require.NotContains(t, string(feed.Response.Body()), secret)
						}
					}
				})
			}
			var compactCount, signedCount int64
			require.NoError(t, store.DB().Model(&controlplane.AuditEvent{}).Count(&compactCount).Error)
			require.NoError(t, store.DB().Model(&configtables.TableGovernanceAuditEvent{}).Count(&signedCount).Error)
			if key == "" {
				require.EqualValues(t, 2, compactCount)
				require.Zero(t, signedCount)
			} else {
				require.Zero(t, compactCount)
				require.EqualValues(t, 2, signedCount)
				var events []configtables.TableGovernanceAuditEvent
				require.NoError(t, store.DB().Order("sequence").Find(&events).Error)
				require.Equal(t, events[0].ResourceID, events[1].ResourceID)
				for index, event := range events {
					require.False(t, event.LocalAdmin)
					require.Empty(t, event.RoleID)
					require.NotEmpty(t, event.Signature)
					require.Equal(t, []string{"employee-password", "employee-session"}[index], event.AuthMethod)
					raw, err := json.Marshal(event)
					require.NoError(t, err)
					for _, secret := range []string{token, csrf, encrypt.HashSHA256(token), encrypt.HashSHA256(csrf), employee.PasswordHash, "OriginalPassword!123", "forged", employee.Name} {
						require.NotContains(t, string(raw), secret)
					}
				}
			}
		})
	}
}
