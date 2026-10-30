package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/fasthttp/router"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/employees"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

type employeeLoginAuditLogger struct {
	schemas.Logger
	messages []string
}

func (l *employeeLoginAuditLogger) Error(message string, args ...any) {
	l.messages = append(l.messages, fmt.Sprintf(message, args...))
}

type employeeLoginAuditFailureStore struct {
	configstore.ConfigStore
}

func (s employeeLoginAuditFailureStore) ExecuteTransaction(ctx context.Context, appendAudit func(*gorm.DB) error) error {
	return s.ConfigStore.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		if err := appendAudit(tx); err != nil {
			return err
		}
		return errors.New("private diagnostic after audit insert")
	})
}

func employeeRejectedLoginRequest(source byte, body string) *fasthttp.RequestCtx {
	request := &fasthttp.RequestCtx{}
	request.Init(&fasthttp.Request{}, &net.TCPAddr{IP: net.IPv4(192, 0, 2, source)}, nil)
	request.Request.SetRequestURI("/employee/api/session/login")
	request.Request.Header.SetMethod(fasthttp.MethodPost)
	request.Request.Header.SetContentType("application/json")
	request.Request.Header.Set("X-User-ID", "forged-header-secret")
	request.Request.Header.Set("X-Request-ID", "forged-correlation-secret")
	request.Request.Header.SetCookie("employee_token", "forged-cookie-secret")
	request.Request.SetBodyString(body)
	request.SetUserValue(schemas.IsLocalAdminContextKey, true)
	request.SetUserValue(schemas.BifrostContextKeyUserID, "forged-admin-secret")
	request.SetUserValue(lib.FastHTTPUserValueManagementAuditActor, "forged-audit-secret")
	return request
}

func TestEmployeeLoginFailureAuditPersistenceAndIdentity(t *testing.T) {
	for _, key := range []string{"", "employee-failure-test-only-signing-key"} {
		name := "compact"
		if key != "" {
			name = "signed"
		}
		t.Run(name, func(t *testing.T) {
			log := &employeeLoginAuditLogger{Logger: bifrost.NewDefaultLogger(schemas.LogLevelError)}
			encrypt.Init(key, log)
			t.Cleanup(func() { encrypt.Init("", log) })
			// The existing server fixture selects an owned SQLite or PostgreSQL database.
			cs := newRoutingTestConfigStore(t)
			cp, err := controlplane.NewStore(t.Context(), cs)
			require.NoError(t, err)
			store, err := employees.NewStore(t.Context(), cs)
			require.NoError(t, err)
			employee := &employees.Employee{Username: "failure.fixture", Name: "private-employee-name", IsActive: true}
			require.NoError(t, store.Create(t.Context(), employee, "OriginalPassword!123", nil))
			h, err := employees.NewHandler(t.Context(), cs, nil)
			require.NoError(t, err)
			h.SetLoginFailureAuditor(employeeLoginFailureAuditor(cs, log))
			r := router.New()
			h.RegisterRoutes(r)
			controlplane.NewHandler(cp, nil).RegisterRoutes(r)
			for index, variant := range []string{"unknown", "password", "hash_error", "rollback"} {
				body := `{"username":"failure.fixture","password":"wrong-password-secret","employee_id":"forged-employee-secret"}`
				if variant == "unknown" {
					body = `{"username":"unknown-employee-secret","password":"wrong-password-secret"}`
				}
				if variant == "hash_error" {
					require.NoError(t, cs.DB().Model(employee).Update("password_hash", "invalid-hash-secret").Error)
				}
				if variant == "rollback" {
					h.SetLoginFailureAuditor(employeeLoginFailureAuditor(employeeLoginAuditFailureStore{cs}, log))
				}
				request := employeeRejectedLoginRequest(byte(index+30), body)
				r.Handler(request)
				require.Equal(t, fasthttp.StatusUnauthorized, request.Response.StatusCode(), string(request.Response.Body()))
				require.JSONEq(t, `{"error":"用户名或密码错误"}`, string(request.Response.Body()))
				require.Empty(t, request.Response.Header.Peek("Set-Cookie"))
				require.Equal(t, true, request.UserValue(schemas.IsLocalAdminContextKey))
				require.Equal(t, "forged-admin-secret", request.UserValue(schemas.BifrostContextKeyUserID))
				if variant == "rollback" {
					require.Equal(t, "failed", string(request.Response.Header.Peek(lib.HeaderAuditStatus)))
					require.Equal(t, []string{"failed to persist employee login rejection audit"}, log.messages)
				} else {
					require.Empty(t, request.Response.Header.Peek(lib.HeaderAuditStatus))
				}
				rows, err := cp.ListAudit(t.Context(), 20)
				require.NoError(t, err)
				require.Len(t, rows, min(index+1, 3))
				for _, event := range rows {
					require.Equal(t, "anonymous", event.ActorID)
					require.Equal(t, "employee_session.login_failed", event.Action)
					require.Equal(t, "employee_session", event.ResourceType)
					require.Equal(t, "employee", event.ResourceID)
					require.Empty(t, event.RequestID)
					require.Empty(t, event.TraceID)
				}
			}
			var current employees.Employee
			require.NoError(t, cs.DB().First(&current, "id = ?", employee.ID).Error)
			require.Equal(t, 3, current.FailedLoginCount, "audit rollback cannot undo the committed counter")
			var sessions int64
			require.NoError(t, cs.DB().Model(&employees.EmployeeSession{}).Count(&sessions).Error)
			require.Zero(t, sessions)
			feed := &fasthttp.RequestCtx{}
			feed.Request.SetRequestURI("/api/control-plane/audit-events")
			feed.Request.Header.SetMethod(fasthttp.MethodGet)
			r.Handler(feed)
			require.Equal(t, fasthttp.StatusUnauthorized, feed.Response.StatusCode())
			feed.Response.Reset()
			feed.SetUserValue(schemas.IsLocalAdminContextKey, true)
			r.Handler(feed)
			require.Equal(t, fasthttp.StatusOK, feed.Response.StatusCode())
			var rawSigned []tables.TableGovernanceAuditEvent
			require.NoError(t, cs.DB().Order("sequence").Find(&rawSigned).Error)
			raw, err := json.Marshal(rawSigned)
			require.NoError(t, err)
			for _, secret := range []string{
				"forged", "failure.fixture", "unknown-employee-secret", "wrong-password-secret",
				"OriginalPassword!123", "invalid-hash-secret", "private", employee.PasswordHash, employee.ID,
			} {
				require.NotContains(t, string(feed.Response.Body()), secret)
				require.NotContains(t, string(raw), secret)
			}
			var compact int64
			require.NoError(t, cs.DB().Model(&controlplane.AuditEvent{}).Count(&compact).Error)
			if key == "" {
				require.Len(t, rawSigned, 0)
				require.EqualValues(t, 3, compact)
				return
			}
			require.Zero(t, compact)
			require.Len(t, rawSigned, 3)
			for index, event := range rawSigned {
				require.EqualValues(t, index+1, event.Sequence)
				require.Equal(t, "anonymous", event.ActorID)
				require.False(t, event.LocalAdmin)
				require.Empty(t, event.RoleID)
				require.Equal(t, "none", event.AuthMethod)
				require.Equal(t, "denied", event.Outcome)
				require.NotEmpty(t, event.Signature)
				require.Equal(t, "{}", event.BeforeJSON)
				require.Equal(t, "{}", event.AfterJSON)
				require.Equal(t, "{}", event.MetadataJSON)
			}
			// Chain verification never calls a governance mutation manager.
			manager := &struct{ handlers.GovernanceManager }{}
			governance, err := handlers.NewGovernanceHandler(manager, cs, nil, nil, nil, nil)
			require.NoError(t, err)
			governance.RegisterRoutes(r)
			verify := &fasthttp.RequestCtx{}
			verify.Request.SetRequestURI("/api/governance/audit-logs/verify")
			verify.Request.Header.SetMethod(fasthttp.MethodGet)
			verify.SetUserValue(schemas.IsLocalAdminContextKey, true)
			r.Handler(verify)
			require.Equal(t, fasthttp.StatusOK, verify.Response.StatusCode(), string(verify.Response.Body()))
			var verification struct {
				Valid        bool   `json:"valid"`
				HeadSequence uint64 `json:"head_sequence"`
			}
			require.NoError(t, json.Unmarshal(verify.Response.Body(), &verification))
			require.True(t, verification.Valid)
			require.EqualValues(t, 3, verification.HeadSequence)
		})
	}
}

func BenchmarkEmployeeLoginFailureAuditPersistence(b *testing.B) {
	for _, key := range []string{"", "employee-failure-bench-only-signing-key"} {
		name := "compact"
		if key != "" {
			name = "signed"
		}
		b.Run(name, func(b *testing.B) {
			log := bifrost.NewDefaultLogger(schemas.LogLevelError)
			encrypt.Init(key, log)
			b.Cleanup(func() { encrypt.Init("", log) })
			cs, err := configstore.NewConfigStore(context.Background(), &configstore.Config{
				Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
				Config: &configstore.SQLiteConfig{Path: b.TempDir() + "/failure-bench.db"},
			}, log)
			require.NoError(b, err)
			b.Cleanup(func() { require.NoError(b, cs.Close(context.Background())) })
			_, err = controlplane.NewStore(context.Background(), cs)
			require.NoError(b, err)
			audit := employeeLoginFailureAuditor(cs, log)
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				err := audit(ctx)
				cancel()
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
