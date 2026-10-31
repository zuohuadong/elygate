package controlplane

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/fasthttp/router"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type webhookAuditRouteManager struct {
	config *lib.Config
	fault  string
}

func (m webhookAuditRouteManager) ReloadWebhookEndpoint(ctx context.Context, id string) error {
	switch m.fault {
	case "panic":
		panic("test-only-webhook-reload-diagnostic")
	case "error":
		return errors.New("test-only-webhook-reload-diagnostic")
	case "missing":
		m.config.RemoveWebhookEndpoint(id)
		return nil
	}
	endpoint, err := m.config.ConfigStore.GetWebhookEndpointByID(ctx, id)
	if err == nil {
		m.config.SetWebhookEndpoint(endpoint)
	}
	return err
}

func (m webhookAuditRouteManager) RemoveWebhookEndpoint(_ context.Context, id string) error {
	switch m.fault {
	case "panic":
		panic("test-only-webhook-remove-diagnostic")
	case "error":
		return errors.New("test-only-webhook-remove-diagnostic")
	}
	m.config.RemoveWebhookEndpoint(id)
	return nil
}

type failingWebhookAuditWriteStore struct{ configstore.ConfigStore }

func (failingWebhookAuditWriteStore) CreateWebhookEndpoint(context.Context, *configtables.TableWebhookEndpoint) error {
	return errors.New("test-only-webhook-write-diagnostic")
}

func (failingWebhookAuditWriteStore) UpdateWebhookEndpoint(context.Context, *configtables.TableWebhookEndpoint) error {
	return errors.New("test-only-webhook-write-diagnostic")
}

func (failingWebhookAuditWriteStore) DeleteWebhookEndpoint(context.Context, string) error {
	return errors.New("test-only-webhook-write-diagnostic")
}

func (failingWebhookAuditWriteStore) RotateWebhookEndpointSecret(context.Context, string) (*configtables.TableWebhookEndpoint, error) {
	return nil, errors.New("test-only-webhook-write-diagnostic")
}

func TestManagementWebhookAuditAfterPersistence(t *testing.T) {
	logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	handlers.SetLogger(logger)
	hash, err := encrypt.Hash("test-only-webhook-password")
	require.NoError(t, err)
	auth := &handlers.AuthMiddleware{}
	auth.UpdateAuthConfig(&configstore.AuthConfig{
		IsEnabled: true, AdminUserName: schemas.NewSecretVar("webhook-admin"),
		AdminPassword: schemas.NewSecretVar(hash),
	})
	authorization := "Basic " + base64.StdEncoding.EncodeToString([]byte("webhook-admin:test-only-webhook-password"))
	const body = `{"name":"updated-webhook","url":"https://93.184.216.34/hook","events":["async_job.completed"],"headers":{"Authorization":"test-only-webhook-updated-header"}}`
	// Each operation must distinguish rejection, failed writes, and post-commit reconciliation failure.
	for _, mutation := range []struct {
		name, method, path, body, action string
	}{
		{"create", "POST", "/api/webhooks", body, "webhook.created"},
		{"update", "PUT", "/api/webhooks/audited-webhook", body, "webhook.updated"},
		{"rotate", "POST", "/api/webhooks/audited-webhook/rotate-secret", "", "webhook.secret_rotated"},
		{"delete", "DELETE", "/api/webhooks/audited-webhook", "", "webhook.deleted"},
	} {
		for _, fault := range []string{"success", "error", "missing", "panic", "write failure", "unauthorized", "not found", "invalid request", "audit failure"} {
			if mutation.name == "create" && fault == "not found" {
				continue
			}
			if fault == "invalid request" && mutation.name != "create" && mutation.name != "update" {
				continue
			}
			t.Run(mutation.name+"/"+fault, func(t *testing.T) {
				ctx := t.Context()
				store, cs := testControlPlaneStore(t)
				endpoint := &configtables.TableWebhookEndpoint{
					ID: "audited-webhook", Name: "original-webhook", URL: "https://93.184.216.34/hook",
					Events: []configtables.WebhookEvent{configtables.WebhookEventAsyncJobCompleted},
					Secret: schemas.NewSecretVar("test-only-webhook-signing-secret"),
					Headers: map[string]schemas.SecretVar{
						"Authorization": *schemas.NewSecretVar("test-only-webhook-original-header"),
					},
				}
				require.NoError(t, cs.CreateWebhookEndpoint(ctx, endpoint))
				cfg := &lib.Config{ConfigStore: cs}
				cfg.SetWebhookEndpoint(endpoint)
				if fault == "write failure" {
					cfg.ConfigStore = failingWebhookAuditWriteStore{cs}
				}
				if fault == "audit failure" {
					require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:webhook-audit", func(tx *gorm.DB) {
						if tx.Statement.Table == (AuditEvent{}).TableName() {
							tx.AddError(errors.New("test-only-webhook-audit-diagnostic"))
						}
					}))
					t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:webhook-audit") })
				}
				if fault == "not found" {
					require.NoError(t, cs.DeleteWebhookEndpoint(ctx, endpoint.ID))
					cfg.RemoveWebhookEndpoint(endpoint.ID)
				}
				audit := NewHandler(store, nil)
				routes := router.New()
				audit.RegisterRoutes(routes, auth.APIMiddleware())
				handlers.NewWebhookHandler(webhookAuditRouteManager{cfg, fault}, cfg, nil).RegisterRoutes(routes,
					handlers.RecoveryMiddleware(handlers.NewCorsMiddleware(&lib.Config{})),
					auth.APIMiddleware(), audit.ManagementAuditMiddleware(logger))
				mutationAuth := authorization
				if fault == "unauthorized" {
					mutationAuth = ""
				}
				requestBody := mutation.body
				if fault == "invalid request" {
					requestBody = `{`
				}
				response := relayAuditRequest(routes, relayAuditHTTPRequest{mutation.method, mutation.path, mutationAuth, requestBody})
				wantStatus := 200
				switch {
				case fault == "unauthorized":
					wantStatus = 401
				case fault == "not found":
					wantStatus = 404
				case fault == "invalid request":
					wantStatus = 400
				case fault == "write failure", fault == "panic",
					fault == "error" && mutation.name != "delete",
					fault == "missing" && mutation.name == "update":
					wantStatus = 500
				case mutation.name == "create":
					wantStatus = 201
				}
				require.Equal(t, wantStatus, response.Response.StatusCode(), "body=%s", response.Response.Body())
				committed := fault != "write failure" && fault != "unauthorized" && fault != "not found" && fault != "invalid request"
				changes, _ := response.UserValue(configstore.AuditChangesUserValueKey).([]configstore.AuditChange)
				if committed {
					require.Len(t, changes, 1)
					require.Equal(t, mutation.action, changes[0].EventName)
				} else {
					require.Empty(t, changes)
				}
				events, err := store.ListAudit(ctx, 10)
				require.NoError(t, err)
				if committed && fault != "audit failure" {
					require.Len(t, events, 1)
					require.Equal(t, mutation.action, events[0].Action)
					require.Equal(t, "webhook", events[0].ResourceType)
					require.Equal(t, "local-admin:webhook-admin", events[0].ActorID)
					require.Equal(t, "relay-audit-request", events[0].RequestID)
				} else {
					require.Empty(t, events)
				}
				if fault == "audit failure" {
					require.Equal(t, "failed", string(response.Response.Header.Peek(lib.HeaderAuditStatus)))
				} else {
					require.Empty(t, response.Response.Header.Peek(lib.HeaderAuditStatus))
				}
				stored, findErr := cs.GetWebhookEndpointByID(ctx, endpoint.ID)
				if mutation.name == "create" {
					created, count, listErr := cs.GetWebhookEndpointsPaginated(ctx, configstore.WebhookEndpointsQueryParams{
						Search: "updated-webhook",
						Limit:  10,
					})
					require.NoError(t, listErr)
					if committed {
						require.EqualValues(t, 1, count)
						require.Len(t, created, 1)
						require.Equal(t, created[0].ID, changes[0].TargetID)
					} else {
						require.Empty(t, created)
						require.Zero(t, count)
					}
				}
				if fault == "not found" || committed && mutation.name == "delete" {
					require.ErrorIs(t, findErr, configstore.ErrNotFound)
				} else {
					require.NoError(t, findErr)
					if committed && mutation.name == "update" {
						require.Equal(t, "updated-webhook", stored.Name)
					} else {
						require.Equal(t, "original-webhook", stored.Name)
					}
					if committed && mutation.name == "rotate" {
						require.True(t, stored.Secret.GetValue() != "test-only-webhook-signing-secret")
					}
				}
				feed := relayAuditRequest(routes, relayAuditHTTPRequest{"GET", "/api/control-plane/audit-events", authorization, ""})
				require.Equal(t, 200, feed.Response.StatusCode())
				serialized, err := json.Marshal(struct {
					Events  []AuditEvent
					Changes []configstore.AuditChange
				}{events, changes})
				require.NoError(t, err)
				for _, secret := range []string{
					"test-only-webhook-signing-secret", "test-only-webhook-original-header", "test-only-webhook-updated-header",
					"test-only-webhook-password", "forged-relay-actor",
				} {
					require.NotContains(t, string(serialized), secret)
					require.NotContains(t, string(feed.Response.Body()), secret)
					require.NotContains(t, string(response.Response.Body()), secret)
				}
				if mutation.name == "create" || mutation.name == "rotate" {
					if wantStatus < 300 {
						var responsePayload struct {
							Secret string `json:"secret"`
						}
						require.NoError(t, json.Unmarshal(response.Response.Body(), &responsePayload))
						require.True(t, strings.HasPrefix(responsePayload.Secret, "whsec_"))
						require.NotContains(t, string(serialized), responsePayload.Secret)
						require.NotContains(t, string(feed.Response.Body()), responsePayload.Secret)
						require.Contains(t, string(response.Response.Body()), responsePayload.Secret)
					} else {
						require.NotContains(t, string(response.Response.Body()), "whsec_")
					}
				}
			})
		}
	}
}
