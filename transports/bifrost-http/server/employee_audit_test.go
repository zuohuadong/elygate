package server

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

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
