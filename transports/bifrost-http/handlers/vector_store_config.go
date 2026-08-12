package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/vectorstore"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

type vectorStoreConfigResponse struct {
	Enabled           bool                        `json:"enabled"`
	Type              vectorstore.VectorStoreType `json:"type"`
	Config            any                         `json:"config"`
	Supported         bool                        `json:"supported"`
	RuntimeConnected  bool                        `json:"runtime_connected"`
	RestartRequired   bool                        `json:"restart_required"`
	RestartReason     string                      `json:"restart_reason,omitempty"`
	Editable          bool                        `json:"editable"`
	ManagedBy         string                      `json:"managed_by"`
	ManagementMessage string                      `json:"management_message,omitempty"`
}

const vectorStoreConfigJSONManagementMessage = "Vector store configuration is managed by the vector_store section in config.json. Edit config.json and restart Elygate to apply changes."
const vectorStoreUnsupportedManagementMessage = "This vector store type remains active but is read-only in the Elygate panel. Manage it through its existing deployment configuration."

func vectorStoreManagementMetadata(config *lib.Config) (bool, string, string) {
	if config != nil && config.VectorStoreConfigManagedByConfigJSON {
		return false, lib.SourceOfTruthConfigJSON, vectorStoreConfigJSONManagementMessage
	}
	return true, "database", ""
}

func pgvectorConfigValue(config any) (vectorstore.PgvectorConfig, bool) {
	switch configured := config.(type) {
	case vectorstore.PgvectorConfig:
		return configured, true
	case *vectorstore.PgvectorConfig:
		if configured != nil {
			return *configured, true
		}
	}
	return vectorstore.PgvectorConfig{}, false
}

func (h *ConfigHandler) updateVectorStoreRestartMarker(ctx context.Context, restartRequired bool) {
	current, err := h.store.ConfigStore.GetRestartRequiredConfig(ctx)
	if err != nil {
		logger.Warn("failed to get restart required config: %v", err)
		current = nil
	}
	if restartRequired {
		reason := lib.VectorStoreRestartReason
		if current != nil && current.Required && current.Reason != "" && !strings.Contains(current.Reason, lib.VectorStoreRestartReason) {
			reason = current.Reason + " " + lib.VectorStoreRestartReason
		}
		if err := h.store.ConfigStore.SetRestartRequiredConfig(ctx, &configstoreTables.RestartRequiredConfig{Required: true, Reason: reason}); err != nil {
			logger.Warn("failed to set restart required config: %v", err)
		}
		return
	}
	if current == nil || !current.Required || !strings.Contains(current.Reason, lib.VectorStoreRestartReason) {
		return
	}
	remaining := strings.TrimSpace(strings.ReplaceAll(current.Reason, lib.VectorStoreRestartReason, ""))
	if remaining == "" {
		if err := h.store.ConfigStore.ClearRestartRequiredConfig(ctx); err != nil {
			logger.Warn("failed to clear restart required config: %v", err)
		}
		return
	}
	if err := h.store.ConfigStore.SetRestartRequiredConfig(ctx, &configstoreTables.RestartRequiredConfig{Required: true, Reason: remaining}); err != nil {
		logger.Warn("failed to preserve restart required config: %v", err)
	}
}

func (h *ConfigHandler) getVectorStoreConfig(ctx *fasthttp.RequestCtx) {
	if h.store.ConfigStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "config store not available")
		return
	}
	rawConfig, err := h.store.ConfigStore.GetVectorStoreConfig(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("failed to get vector store config: %v", err))
		return
	}
	if rawConfig != nil && rawConfig.Type != vectorstore.VectorStoreTypePgvector {
		restartRequired := !lib.VectorStoreConfigMatchesRuntime(rawConfig, h.store.VectorStoreConfig)
		restartReason := ""
		if restartRequired {
			restartReason = lib.VectorStoreRestartReason
		}
		_, managedBy, message := vectorStoreManagementMetadata(h.store)
		if message == "" {
			message = vectorStoreUnsupportedManagementMessage
		}
		SendJSON(ctx, vectorStoreConfigResponse{
			Enabled: rawConfig.Enabled, Type: rawConfig.Type, Config: map[string]any{}, Supported: false,
			RuntimeConnected: h.store.VectorStore != nil, RestartRequired: restartRequired, RestartReason: restartReason,
			Editable: false, ManagedBy: managedBy, ManagementMessage: message,
		})
		return
	}
	config, err := h.store.GetVectorStoreConfigRedacted(ctx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("failed to get vector store config: %v", err))
		return
	}
	if config == nil {
		config = &vectorstore.Config{Enabled: false, Type: vectorstore.VectorStoreTypePgvector, Config: vectorstore.PgvectorConfig{
			ConnectionString: *schemas.NewSecretVar(""), Schema: "bifrost_vectors",
		}}
	}
	h.sendVectorStoreConfig(ctx, config, rawConfig)
}

func (h *ConfigHandler) sendVectorStoreConfig(ctx *fasthttp.RequestCtx, responseConfig, desired *vectorstore.Config) {
	restartRequired := !lib.VectorStoreConfigMatchesRuntime(desired, h.store.VectorStoreConfig)
	restartReason := ""
	if restartRequired {
		restartReason = lib.VectorStoreRestartReason
	}
	editable, managedBy, message := vectorStoreManagementMetadata(h.store)
	SendJSON(ctx, vectorStoreConfigResponse{
		Enabled: responseConfig.Enabled, Type: responseConfig.Type, Config: responseConfig.Config, Supported: true,
		RuntimeConnected: h.store.VectorStore != nil, RestartRequired: restartRequired, RestartReason: restartReason,
		Editable: editable, ManagedBy: managedBy, ManagementMessage: message,
	})
}

func (h *ConfigHandler) updateVectorStoreConfig(ctx *fasthttp.RequestCtx) {
	h.vectorStoreMutationMu.Lock()
	defer h.vectorStoreMutationMu.Unlock()
	if h.store.ConfigStore == nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "config store not available")
		return
	}
	if h.store.VectorStoreConfigManagedByConfigJSON {
		SendError(ctx, fasthttp.StatusForbidden, vectorStoreConfigJSONManagementMessage)
		return
	}
	mutationLock, err := lib.NewVectorStoreMutationLock(h.store.ConfigStore, logger)
	if err != nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "vector store configuration is temporarily unavailable")
		return
	}
	lockCtx, cancelLock := context.WithTimeout(ctx, 10*time.Second)
	defer cancelLock()
	if err := mutationLock.Lock(lockCtx); err != nil {
		SendError(ctx, fasthttp.StatusServiceUnavailable, "vector store configuration is being updated by another server; retry shortly")
		return
	}
	defer func() {
		unlockCtx, cancelUnlock := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelUnlock()
		if err := mutationLock.Unlock(unlockCtx); err != nil {
			logger.Warn("failed to release vector store configuration lock: %v", err)
		}
	}()
	mutationCtx, cancelMutation := context.WithTimeout(ctx, lib.VectorStoreMutationTimeout)
	defer cancelMutation()
	var requested vectorstore.Config
	if err := json.Unmarshal(ctx.PostBody(), &requested); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid request payload")
		return
	}
	if requested.Type != vectorstore.VectorStoreTypePgvector {
		SendError(ctx, fasthttp.StatusBadRequest, "vector store type must be pgvector")
		return
	}
	pgvectorConfig, ok := pgvectorConfigValue(requested.Config)
	if !ok {
		SendError(ctx, fasthttp.StatusBadRequest, "invalid pgvector configuration")
		return
	}
	existing, err := h.store.ConfigStore.GetVectorStoreConfig(mutationCtx)
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("failed to get vector store config: %v", err))
		return
	}
	if pgvectorConfig.ConnectionString.ShouldPreserveStored() {
		var existingPgvectorConfig vectorstore.PgvectorConfig
		var exists bool
		if existing != nil && existing.Type == vectorstore.VectorStoreTypePgvector {
			existingPgvectorConfig, exists = pgvectorConfigValue(existing.Config)
		}
		if exists {
			pgvectorConfig.ConnectionString = existingPgvectorConfig.ConnectionString
		} else {
			pgvectorConfig.ConnectionString = *schemas.NewSecretVar("")
		}
	}
	if pgvectorConfig.Schema == "" {
		pgvectorConfig.Schema = "bifrost_vectors"
	}
	if err := vectorstore.ValidatePgvectorConfig(&pgvectorConfig, requested.Enabled); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	requested.Config = pgvectorConfig
	if err := h.store.ConfigStore.UpdateVectorStoreConfig(mutationCtx, &requested); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("failed to update vector store config: %v", err))
		return
	}
	restartRequired := !lib.VectorStoreConfigMatchesRuntime(&requested, h.store.VectorStoreConfig)
	h.updateVectorStoreRestartMarker(mutationCtx, restartRequired)
	redacted := pgvectorConfig
	redacted.ConnectionString = *pgvectorConfig.ConnectionString.FullyRedacted()
	responseConfig := requested
	responseConfig.Config = redacted
	h.sendVectorStoreConfig(ctx, &responseConfig, &requested)
}
