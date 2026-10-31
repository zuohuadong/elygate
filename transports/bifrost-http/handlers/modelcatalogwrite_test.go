package handlers

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/valyala/fasthttp"
)

type catalogWriteTestManager struct {
	ModelsManager
	writeErr error
	entries  []ModelPricingAttributesEntry
}

func (m *catalogWriteTestManager) UpsertModelPricingAttributes(_ context.Context, entries []ModelPricingAttributesEntry) error {
	m.entries = entries
	return m.writeErr
}

func TestModelCatalogWriteAuditOutcome(t *testing.T) {
	cause := errors.New("pricing refresh unavailable")
	for _, tc := range []struct {
		name   string
		err    error
		status int
		events int
	}{
		{"success", nil, 204, 1},
		{"write rejected", cause, 500, 0},
		{"committed refresh failed", &ModelCatalogRefreshError{Err: cause}, 500, 1},
		{"wrapped committed refresh failed", fmt.Errorf("peer refresh: %w", &ModelCatalogRefreshError{Err: cause}), 500, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			manager := &catalogWriteTestManager{writeErr: tc.err}
			handler := &ProviderHandler{modelsManager: manager}
			request := &fasthttp.RequestCtx{}
			request.Request.SetBodyString(`[{"model":" gpt-test ","provider":" openai ","additional_attributes":{"__proto__":"retained","constructor":"","description":"private-description"}}]`)
			handler.upsertModelCatalogEntries(request)
			if request.Response.StatusCode() != tc.status {
				t.Fatalf("status = %d, want %d", request.Response.StatusCode(), tc.status)
			}
			if len(manager.entries) != 1 || manager.entries[0].Model != "gpt-test" || manager.entries[0].Provider != "openai" {
				t.Fatalf("unexpected normalized batch: %#v", manager.entries)
			}
			changes, _ := request.UserValue(configstore.AuditChangesUserValueKey).([]configstore.AuditChange)
			if len(changes) != tc.events {
				t.Fatalf("audit events = %d, want %d", len(changes), tc.events)
			}
			if tc.events == 1 {
				change := changes[0]
				if change.EventName != "model_catalog.updated" || change.TargetType != "model_catalog" || change.TargetID != "model_catalog" {
					t.Fatalf("unexpected audit identity: %#v", change)
				}
			}
		})
	}
}

func TestModelCatalogWriteRejectsInvalidBatchBeforeMutation(t *testing.T) {
	// Malformed JSON, missing model, missing provider, and a bad later entry.
	for _, body := range []string{
		`[`, `[{"provider":"openai"}]`, `[{"model":"gpt-test"}]`,
		`[{"model":"gpt-test","provider":"openai"},{"model":" ","provider":"openai"}]`,
	} {
		t.Run(body, func(t *testing.T) {
			manager := &catalogWriteTestManager{}
			request := &fasthttp.RequestCtx{}
			request.Request.SetBodyString(body)
			(&ProviderHandler{modelsManager: manager}).upsertModelCatalogEntries(request)
			if request.Response.StatusCode() != 400 || manager.entries != nil {
				t.Fatalf("invalid batch reached mutation: status=%d entries=%#v", request.Response.StatusCode(), manager.entries)
			}
			if request.UserValue(configstore.AuditChangesUserValueKey) != nil {
				t.Fatal("rejected batch recorded a successful audit event")
			}
		})
	}
}

func TestModelCatalogRefreshErrorUnwrap(t *testing.T) {
	cause := errors.New("refresh unavailable")
	if !errors.Is(&ModelCatalogRefreshError{Err: cause}, cause) {
		t.Fatal("refresh error lost its underlying cause")
	}
}

func BenchmarkModelCatalogWriteAudit(b *testing.B) {
	manager := &catalogWriteTestManager{}
	handler := &ProviderHandler{modelsManager: manager}
	request := &fasthttp.RequestCtx{}
	request.Request.SetBodyString(`[{"model":"gpt-test","provider":"openai","additional_attributes":{"description":"model"}}]`)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		request.ResetUserValues()
		request.Response.Reset()
		handler.upsertModelCatalogEntries(request)
	}
}
