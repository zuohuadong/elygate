package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/framework/modelcatalog"
	"github.com/maximhq/bifrost/framework/modelcatalog/datasheet"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

type catalogAuditTestStore struct {
	configstore.ConfigStore
	refreshErr error
	writeErr   error
}

func (s *catalogAuditTestStore) GetModelPrices(ctx context.Context) ([]tables.TableModelPricing, error) {
	if s.refreshErr != nil {
		return nil, s.refreshErr
	}
	return s.ConfigStore.GetModelPrices(ctx)
}

func (s *catalogAuditTestStore) UpsertModelPricingAttributes(ctx context.Context, model, provider string, attrs map[string]string, tx ...*gorm.DB) (int64, error) {
	if model == "gpt-other" && s.writeErr != nil {
		return 0, s.writeErr
	}
	return s.ConfigStore.UpsertModelPricingAttributes(ctx, model, provider, attrs, tx...)
}

func catalogAuditRequest(routes *router.Router, method, path, authorization, body string) *fasthttp.RequestCtx {
	var httpRequest fasthttp.Request
	httpRequest.Header.SetMethod(method)
	httpRequest.SetRequestURI("http://catalog.local" + path)
	httpRequest.Header.SetContentType("application/json")
	httpRequest.Header.Set("Authorization", authorization)
	httpRequest.Header.Set("X-User-ID", "forged-catalog-actor")
	httpRequest.SetBodyString(body)

	var requestCtx fasthttp.RequestCtx
	requestCtx.Init(&httpRequest, nil, nil)
	routes.Handler(&requestCtx)
	return &requestCtx
}

func TestModelCatalogAuditThroughManagementRoute(t *testing.T) {
	// Successful update/clear, failed reload/audit, rejected writes and a bad
	// later batch entry must agree on what actually committed.
	for _, tc := range []struct {
		name         string
		refreshFails bool
		writeFails   bool
		auditFails   bool
		missingRow   bool
		unauthorized bool
		clear        bool
		status       int
		committed    bool
	}{
		{name: "success", status: 204, committed: true},
		{name: "clear", clear: true, status: 204, committed: true},
		{name: "committed refresh failure", refreshFails: true, status: 500, committed: true},
		{name: "committed refresh and audit failure", refreshFails: true, auditFails: true, status: 500, committed: true},
		{name: "success with audit failure", auditFails: true, status: 204, committed: true},
		{name: "later write failure rolls back batch", writeFails: true, status: 500},
		{name: "missing later row rolls back batch", missingRow: true, status: 500},
		{name: "unauthorized", unauthorized: true, status: 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := t.Context()
			cs := newRoutingTestConfigStore(t)
			rows := []tables.TableModelPricing{
				{Model: "gpt-test", Provider: "openai", Mode: "chat"},
				{Model: "gpt-test", Provider: "openai", Mode: "responses"},
				{Model: "gpt-other", Provider: "openai", Mode: "chat"},
			}
			for i := range rows {
				require.NoError(t, cs.UpsertModelPrices(ctx, &rows[i]))
			}
			for _, model := range []string{"gpt-test", "gpt-other"} {
				_, err := cs.UpsertModelPricingAttributes(ctx, model, "openai", map[string]string{"description": "before"})
				require.NoError(t, err)
			}
			auditStore, err := controlplane.NewStore(ctx, cs)
			require.NoError(t, err)
			wrapped := &catalogAuditTestStore{ConfigStore: cs}
			catalog := modelcatalog.NewTestCatalogWithDatasheet(datasheet.New(wrapped, noopTestLogger{}, datasheet.Config{}))
			require.NoError(t, catalog.ReloadPricing(ctx))
			if tc.refreshFails {
				wrapped.refreshErr = errors.New("catalog reload unavailable")
			}
			if tc.writeFails {
				wrapped.writeErr = errors.New("catalog mutation rejected")
			}
			if tc.auditFails {
				require.NoError(t, cs.DB().Callback().Create().Before("gorm:create").Register("test:catalog-audit", func(tx *gorm.DB) {
					if tx.Statement.Table == (controlplane.AuditEvent{}).TableName() {
						tx.AddError(errors.New("catalog audit unavailable"))
					}
				}))
				t.Cleanup(func() { cs.DB().Callback().Create().Remove("test:catalog-audit") })
			}

			cfg := &lib.Config{ConfigStore: wrapped, ModelCatalog: catalog, ClientConfig: &configstore.ClientConfig{}}
			server := &BifrostHTTPServer{Config: cfg}
			hash, err := encrypt.Hash("catalog-test-password")
			require.NoError(t, err)
			auth := &handlers.AuthMiddleware{}
			auth.UpdateAuthConfig(&configstore.AuthConfig{
				IsEnabled: true, AdminUserName: schemas.NewSecretVar("catalog-admin"),
				AdminPassword: schemas.NewSecretVar(hash),
			})
			audit := controlplane.NewHandler(auditStore, nil)
			routes := router.New()
			audit.RegisterRoutes(routes, auth.APIMiddleware())
			handlers.NewProviderHandler(server, cfg, nil).RegisterRoutes(routes,
				handlers.RecoveryMiddleware(handlers.NewCorsMiddleware(cfg)), auth.APIMiddleware(),
				audit.ManagementAuditMiddleware(noopTestLogger{}))
			batch := []handlers.ModelPricingAttributesEntry{
				{Model: "gpt-test", Provider: "openai", AdditionalAttributes: map[string]string{"description": "private-description", "__proto__": "retained", "constructor": ""}},
				{Model: "gpt-other", Provider: "openai", AdditionalAttributes: map[string]string{"region": "private-region"}},
			}
			if tc.clear {
				batch[0].AdditionalAttributes = nil
				batch[1].AdditionalAttributes = map[string]string{}
			}
			if tc.missingRow {
				batch[1].Model = "missing-row"
			}
			body, err := json.Marshal(batch)
			require.NoError(t, err)
			authorization := "Basic " + base64.StdEncoding.EncodeToString([]byte("catalog-admin:catalog-test-password"))
			if tc.unauthorized {
				authorization = ""
			}
			response := catalogAuditRequest(routes, "PUT", "/api/models/catalog", authorization, string(body))
			require.Equal(t, tc.status, response.Response.StatusCode(), "body=%s", response.Response.Body())
			if tc.auditFails {
				require.Equal(t, "failed", string(response.Response.Header.Peek(lib.HeaderAuditStatus)))
			} else {
				require.Empty(t, response.Response.Header.Peek(lib.HeaderAuditStatus))
			}

			persisted, err := cs.GetModelPrices(ctx)
			require.NoError(t, err)
			require.Len(t, persisted, 3)
			for _, row := range persisted {
				expected := map[string]string{"description": "before"}
				if tc.committed {
					expected = batch[1].AdditionalAttributes
					if row.Model == "gpt-test" {
						expected = batch[0].AdditionalAttributes
					}
				}
				if tc.committed && tc.clear {
					require.Empty(t, row.AdditionalAttributes)
				} else {
					require.Equal(t, expected, row.AdditionalAttributes)
				}
			}
			info := catalog.GetModelInfo(schemas.OpenAI, "gpt-test")
			require.NotNil(t, info)
			if tc.committed && !tc.refreshFails {
				if tc.clear {
					require.Empty(t, info.AdditionalAttributes)
				} else {
					require.Equal(t, batch[0].AdditionalAttributes, info.AdditionalAttributes)
				}
			} else {
				require.Equal(t, map[string]string{"description": "before"}, info.AdditionalAttributes)
			}
			events, err := auditStore.ListAudit(ctx, 10)
			require.NoError(t, err)
			if tc.committed && !tc.auditFails {
				require.Len(t, events, 1)
				require.Equal(t, "model_catalog.updated", events[0].Action)
				require.Equal(t, "model_catalog", events[0].ResourceType)
				require.Equal(t, "model_catalog", events[0].ResourceID)
				require.Equal(t, "local-admin:catalog-admin", events[0].ActorID)
			} else {
				require.Empty(t, events)
			}
			feed := catalogAuditRequest(routes, "GET", "/api/control-plane/audit-events", "Basic "+base64.StdEncoding.EncodeToString([]byte("catalog-admin:catalog-test-password")), "")
			require.Equal(t, 200, feed.Response.StatusCode())
			require.NotContains(t, string(feed.Response.Body()), "private-description")
			require.NotContains(t, string(feed.Response.Body()), "private-region")
			require.NotContains(t, string(feed.Response.Body()), "forged-catalog-actor")
			denied := catalogAuditRequest(routes, "GET", "/api/control-plane/audit-events", "", "")
			require.Equal(t, 401, denied.Response.StatusCode())
		})
	}
}
