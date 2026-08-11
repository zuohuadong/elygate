package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"sync"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/plugins"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

type PluginsLoader interface {
	GetPluginStatus(ctx context.Context) map[string]schemas.PluginStatus
	GetLoadedPluginNames() []string
	ReloadPlugin(ctx context.Context, name string, path *string, pluginConfig any, placement *schemas.PluginPlacement, order *int) error
	RemovePlugin(ctx context.Context, name string) error
	// NormalizePluginConfig converts a raw config map to DB-storage format using
	// the loaded plugin instance if it implements ConfigMarshallerPlugin.
	// Returns nil when the plugin is not loaded or does not implement the interface.
	NormalizePluginConfig(name string, config map[string]any) (map[string]any, error)
	// ExpandPluginConfigForAPI converts a stored config map to API-response format
	// using the loaded plugin instance if it implements ConfigMarshallerPlugin.
	// Returns nil, nil when the plugin is not loaded or does not implement the interface.
	ExpandPluginConfigForAPI(name string, config map[string]any) (map[string]any, error)
}

// PluginsHandler is the handler for the plugins API
type PluginsHandler struct {
	configStore   configstore.ConfigStore
	pluginsLoader PluginsLoader
	mutationMu    sync.Mutex
}

// PluginConfigurationError marks activation failures caused while constructing a
// plugin from administrator-supplied configuration. Runtime synchronization errors
// deliberately remain untyped and are reported as server failures after rollback.
type PluginConfigurationError struct {
	Err error
}

func (e *PluginConfigurationError) Error() string { return e.Err.Error() }
func (e *PluginConfigurationError) Unwrap() error { return e.Err }

type bestEffortPluginsStore interface {
	GetPluginsBestEffort(ctx context.Context) ([]*configstoreTables.TablePlugin, map[string]error, error)
}

type directPluginDeleteStore interface {
	DeletePluginDirect(ctx context.Context, name string) error
}

type directPluginRecordStore interface {
	PluginRecordExistsDirect(ctx context.Context, name string) (bool, error)
}

// NewPluginsHandler creates a new PluginsHandler
func NewPluginsHandler(pluginsLoader PluginsLoader, configStore configstore.ConfigStore) *PluginsHandler {
	return &PluginsHandler{
		pluginsLoader: pluginsLoader,
		configStore:   configStore,
	}
}

// CreatePluginRequest is the request body for creating a plugin
type CreatePluginRequest struct {
	Name      string                   `json:"name"`
	Enabled   bool                     `json:"enabled"`
	Config    map[string]any           `json:"config"`
	Path      *string                  `json:"path"`
	Placement *schemas.PluginPlacement `json:"placement,omitempty"`
	Order     *int                     `json:"order,omitempty"`
}

// UpdatePluginRequest is the request body for updating a plugin
type UpdatePluginRequest struct {
	Enabled   bool                     `json:"enabled"`
	Path      *string                  `json:"path"`
	Config    map[string]any           `json:"config"`
	Placement *schemas.PluginPlacement `json:"placement,omitempty"`
	Order     *int                     `json:"order,omitempty"`
}

// normalizePluginConfig calls the loaded plugin's MarshalConfigForStorage if it
// implements ConfigMarshallerPlugin. Returns config unchanged if the plugin is not
// loaded or does not implement the interface. Returns an error if marshalling fails.
func (h *PluginsHandler) normalizePluginConfig(name string, config map[string]any) (map[string]any, error) {
	out, err := h.pluginsLoader.NormalizePluginConfig(name, config)
	if err != nil {
		return nil, err
	}
	if out != nil {
		return out, nil
	}
	return config, nil
}

// expandPluginConfigForAPI calls the loaded plugin's RedactConfig if it implements
// ConfigMarshallerPlugin. Returns config unchanged if the plugin is not loaded or
// does not implement the interface. Returns an error if redaction fails.
func (h *PluginsHandler) expandPluginConfigForAPI(name string, config map[string]any) (result map[string]any, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			result = nil
			err = fmt.Errorf("plugin config redaction panicked")
		}
	}()

	out, err := h.pluginsLoader.ExpandPluginConfigForAPI(name, config)
	if err != nil {
		return nil, err
	}
	result = config
	if out != nil {
		result = out
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf("plugin config redaction returned invalid JSON: %w", err)
	}
	// Decode the validated bytes back to plain JSON values. A custom json.Marshaler
	// supplied by a plugin must not run a second time inside SendJSON.
	var safeResult map[string]any
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	if err := decoder.Decode(&safeResult); err != nil {
		return nil, fmt.Errorf("plugin config redaction returned invalid JSON: %w", err)
	}
	return safeResult, nil
}

func (h *PluginsHandler) pluginRecordExists(ctx context.Context, name string) (bool, error) {
	if store, ok := h.configStore.(directPluginRecordStore); ok {
		return store.PluginRecordExistsDirect(ctx, name)
	}
	if _, err := h.configStore.GetPlugin(ctx, name); err != nil {
		if errors.Is(err, configstore.ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (h *PluginsHandler) deletePluginRecord(ctx context.Context, name string) error {
	if store, ok := h.configStore.(directPluginDeleteStore); ok {
		return store.DeletePluginDirect(ctx, name)
	}
	return h.configStore.DeletePlugin(ctx, name)
}

func (h *PluginsHandler) removePluginRuntime(ctx context.Context, name string) error {
	if err := h.pluginsLoader.RemovePlugin(ctx, name); err != nil && !errors.Is(err, plugins.ErrPluginNotFound) {
		return err
	}
	return nil
}

func (h *PluginsHandler) rollbackPluginChange(ctx *fasthttp.RequestCtx, name string, previous *configstoreTables.TablePlugin) error {
	var rollbackErrors []error
	if previous == nil {
		if err := h.removePluginRuntime(ctx, name); err != nil {
			// Keep the persisted row so a later DELETE can retry runtime cleanup.
			return fmt.Errorf("remove candidate runtime: %w", err)
		}
		if err := h.deletePluginRecord(ctx, name); err != nil && !errors.Is(err, configstore.ErrNotFound) {
			rollbackErrors = append(rollbackErrors, fmt.Errorf("delete candidate config: %w", err))
		}
		return errors.Join(rollbackErrors...)
	}

	if err := h.configStore.UpdatePlugin(ctx, previous); err != nil {
		rollbackErrors = append(rollbackErrors, fmt.Errorf("restore previous config: %w", err))
	}
	if previous.Enabled {
		if err := h.pluginsLoader.ReloadPlugin(ctx, previous.Name, previous.Path, previous.Config, previous.Placement, previous.Order); err != nil {
			rollbackErrors = append(rollbackErrors, fmt.Errorf("restore previous runtime: %w", err))
		}
	} else {
		ctx.SetUserValue(PluginDisabledKey, true)
		if err := h.removePluginRuntime(ctx, previous.Name); err != nil {
			rollbackErrors = append(rollbackErrors, fmt.Errorf("restore disabled runtime: %w", err))
		}
	}
	return errors.Join(rollbackErrors...)
}

// RegisterRoutes registers the routes for the PluginsHandler
func (h *PluginsHandler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	r.GET("/api/plugins", lib.ChainMiddlewares(h.getPlugins, middlewares...))
	r.GET("/api/plugins/builtins", lib.ChainMiddlewares(h.getBuiltinPlugins, middlewares...))
	r.GET("/api/plugins/loaded", lib.ChainMiddlewares(h.getLoadedPlugins, middlewares...))
	r.GET("/api/plugins/{name}", lib.ChainMiddlewares(h.getPlugin, middlewares...))
	r.POST("/api/plugins", lib.ChainMiddlewares(h.createPlugin, middlewares...))
	r.PUT("/api/plugins/{name}", lib.ChainMiddlewares(h.updatePlugin, middlewares...))
	r.DELETE("/api/plugins/{name}", lib.ChainMiddlewares(h.deletePlugin, middlewares...))
}

type PluginResponse struct {
	Name          string                   `json:"name"`
	ActualName    string                   `json:"actualName"`
	Enabled       bool                     `json:"enabled"`
	Config        any                      `json:"config"`
	IsCustom      bool                     `json:"isCustom"`
	Path          *string                  `json:"path"`
	Placement     *schemas.PluginPlacement `json:"placement,omitempty"`
	Order         *int                     `json:"order,omitempty"`
	Description   string                   `json:"description,omitempty"`
	DescriptionZh string                   `json:"descriptionZh,omitempty"`
	Features      []string                 `json:"features,omitempty"`
	Status        schemas.PluginStatus     `json:"status"`
}

func pluginMetadataForResponse(actualName string, status schemas.PluginStatus) schemas.PluginMetadata {
	for _, name := range []string{actualName, status.Name} {
		metadata := lib.GetBuiltinPluginMetadata(name)
		if metadata.Description != "" || metadata.DescriptionZh != "" || len(metadata.Features) > 0 {
			return metadata
		}
	}
	return schemas.PluginMetadata{
		Description:   status.Description,
		DescriptionZh: status.DescriptionZh,
		Features:      slices.Clone(status.Features),
	}
}

// buildRuntimePluginResponse constructs a response for plugins that are known to
// the running server but do not have a persisted config-store row.
func buildRuntimePluginResponse(actualName string, status schemas.PluginStatus) PluginResponse {
	name := status.Name
	if name == "" {
		name = actualName
	}
	metadata := pluginMetadataForResponse(actualName, status)
	return PluginResponse{
		Name:          name,
		ActualName:    actualName,
		Enabled:       status.Status != schemas.PluginStatusDisabled,
		Config:        map[string]any{},
		IsCustom:      !lib.IsBuiltinPlugin(actualName),
		Path:          nil,
		Description:   metadata.Description,
		DescriptionZh: metadata.DescriptionZh,
		Features:      slices.Clone(metadata.Features),
		Status:        status,
	}
}

// buildPluginResponse constructs a PluginResponse, fetching plugin statuses once.
func (h *PluginsHandler) buildPluginResponse(ctx context.Context, plugin *configstoreTables.TablePlugin) PluginResponse {
	return h.buildPluginResponseWithStatuses(plugin, h.pluginsLoader.GetPluginStatus(ctx))
}

// buildPluginResponseWithStatuses constructs a PluginResponse using pre-fetched statuses.
// Use this in list endpoints to avoid calling GetPluginStatus once per plugin.
func (h *PluginsHandler) buildPluginResponseWithStatuses(plugin *configstoreTables.TablePlugin, pluginStatuses map[string]schemas.PluginStatus) PluginResponse {
	pluginStatus := schemas.PluginStatus{
		Name:   plugin.Name,
		Status: schemas.PluginStatusUninitialized,
		Logs:   []string{},
	}
	actualName := plugin.Name
	for candidateActualName, status := range pluginStatuses {
		if plugin.Name == status.Name || plugin.Name == candidateActualName {
			actualName = candidateActualName
			pluginStatus = status
			break
		}
	}
	if !plugin.Enabled {
		pluginStatus.Status = schemas.PluginStatusDisabled
	}
	config := plugin.Config
	if configMap, ok := plugin.Config.(map[string]any); ok {
		redacted, err := h.expandPluginConfigForAPI(plugin.Name, configMap)
		if err != nil {
			logger.Warn("failed to redact config for plugin %s: %v", plugin.Name, err)
			config = map[string]any{}
		} else {
			config = redacted
		}
	}
	metadata := pluginMetadataForResponse(actualName, pluginStatus)
	return PluginResponse{
		Name:          plugin.Name,
		ActualName:    actualName,
		Enabled:       plugin.Enabled,
		Config:        config,
		IsCustom:      plugin.IsCustom,
		Path:          plugin.Path,
		Placement:     plugin.Placement,
		Order:         plugin.Order,
		Description:   metadata.Description,
		DescriptionZh: metadata.DescriptionZh,
		Features:      slices.Clone(metadata.Features),
		Status:        pluginStatus,
	}
}

// getBuiltinPlugins returns the canonical list of built-in plugin names.
func (h *PluginsHandler) getBuiltinPlugins(ctx *fasthttp.RequestCtx) {
	SendJSON(ctx, map[string]any{
		"plugins": lib.GetBuiltinPluginNames(),
	})
}

// getLoadedPlugins returns the names of all plugins currently loaded at runtime, whose
// spans an observability connector can filter.
func (h *PluginsHandler) getLoadedPlugins(ctx *fasthttp.RequestCtx) {
	SendJSON(ctx, map[string]any{
		"plugins": h.pluginsLoader.GetLoadedPluginNames(),
	})
}

// getPlugins gets all plugins
func (h *PluginsHandler) getPlugins(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		pluginStatus := h.pluginsLoader.GetPluginStatus(ctx)
		finalPlugins := []PluginResponse{}
		names := make([]string, 0, len(pluginStatus))
		for name := range pluginStatus {
			names = append(names, name)
		}
		slices.Sort(names)
		for _, name := range names {
			finalPlugins = append(finalPlugins, buildRuntimePluginResponse(name, pluginStatus[name]))
		}
		SendJSON(ctx, map[string]any{
			"plugins": finalPlugins,
			"count":   len(finalPlugins),
		})
		return
	}
	plugins, diagnostics, err := func() ([]*configstoreTables.TablePlugin, map[string]error, error) {
		if store, ok := h.configStore.(bestEffortPluginsStore); ok {
			return store.GetPluginsBestEffort(ctx)
		}
		plugins, err := h.configStore.GetPlugins(ctx)
		return plugins, nil, err
	}()
	if err != nil {
		logger.Error("failed to get plugins: %v", err)
		SendError(ctx, 500, "Failed to retrieve plugins")
		return
	}
	pluginStatuses := h.pluginsLoader.GetPluginStatus(ctx)
	finalPlugins := []PluginResponse{}
	seen := map[string]struct{}{}
	for _, plugin := range plugins {
		response := h.buildPluginResponseWithStatuses(plugin, pluginStatuses)
		if diagnostics[plugin.Name] != nil {
			response.Config = map[string]any{}
			response.Status.Status = schemas.PluginStatusError
			response.Status.Logs = append(response.Status.Logs, "Stored plugin configuration is unreadable. Delete and recreate this plugin configuration.")
		}
		finalPlugins = append(finalPlugins, response)
		seen[plugin.Name] = struct{}{}
	}
	statusNames := make([]string, 0, len(pluginStatuses))
	for actualName, pluginStatus := range pluginStatuses {
		displayName := pluginStatus.Name
		if displayName == "" {
			displayName = actualName
		}
		if _, ok := seen[displayName]; ok {
			continue
		}
		if _, ok := seen[actualName]; ok {
			continue
		}
		statusNames = append(statusNames, actualName)
	}
	slices.Sort(statusNames)
	for _, actualName := range statusNames {
		finalPlugins = append(finalPlugins, buildRuntimePluginResponse(actualName, pluginStatuses[actualName]))
	}
	// Creating ephemeral struct
	SendJSON(ctx, map[string]any{
		"plugins": finalPlugins,
		"count":   len(finalPlugins),
	})
}

// getPlugin gets a plugin by name
func (h *PluginsHandler) getPlugin(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		pluginStatus := h.pluginsLoader.GetPluginStatus(ctx)
		pluginInfo := PluginResponse{}
		for actualName, status := range pluginStatus {
			if status.Name == ctx.UserValue("name") || actualName == ctx.UserValue("name") {
				pluginInfo = buildRuntimePluginResponse(actualName, status)
				break
			}
		}
		SendJSON(ctx, pluginInfo)
		return
	}
	// Safely validate the "name" parameter
	nameValue := ctx.UserValue("name")
	if nameValue == nil {
		logger.Warn("missing required 'name' parameter in request")
		SendError(ctx, 400, "Missing required 'name' parameter")
		return
	}

	name, ok := nameValue.(string)
	if !ok {
		logger.Warn("invalid 'name' parameter type, expected string but got %T", nameValue)
		SendError(ctx, 400, "Invalid 'name' parameter type, expected string")
		return
	}

	if name == "" {
		logger.Warn("empty 'name' parameter provided")
		SendError(ctx, 400, "Empty 'name' parameter not allowed")
		return
	}

	plugin, err := h.configStore.GetPlugin(ctx, name)
	if err != nil {
		if errors.Is(err, configstore.ErrNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Plugin not found")
			return
		}
		logger.Error("failed to get plugin: %v", err)
		SendError(ctx, 500, "Failed to retrieve plugin")
		return
	}
	// Return the same shape as list/create/update — with runtime status
	// merged in — so the UI doesn't see an empty status when refetching a
	// single plugin via useGetPluginQuery.
	SendJSON(ctx, h.buildPluginResponse(ctx, plugin))
}

// createPlugin creates a new plugin
func (h *PluginsHandler) createPlugin(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, 400, "Plugins creation is  not supported when configstore is disabled")
		return
	}
	h.mutationMu.Lock()
	defer h.mutationMu.Unlock()
	var request CreatePluginRequest
	if err := json.Unmarshal(ctx.PostBody(), &request); err != nil {
		logger.Error("failed to unmarshal create plugin request: %v", err)
		SendError(ctx, 400, "Invalid request body")
		return
	}
	// Validate required fields
	if request.Name == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Plugin name is required")
		return
	}
	// Validate placement value
	if request.Placement != nil && *request.Placement != "" &&
		*request.Placement != schemas.PluginPlacementPreBuiltin &&
		*request.Placement != schemas.PluginPlacementPostBuiltin {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid placement value. Must be 'pre_builtin' or 'post_builtin'")
		return
	}
	if request.Placement != nil && *request.Placement == "" {
		request.Placement = nil
	}
	// Normalize empty path to nil (treat empty string as built-in plugin)
	if request.Path != nil && *request.Path == "" {
		request.Path = nil
	}
	// Check if plugin already exists
	existingPlugin, err := h.configStore.GetPlugin(ctx, request.Name)
	if err == nil && existingPlugin != nil {
		SendError(ctx, fasthttp.StatusConflict, "Plugin already exists")
		return
	}
	// Determine if this is a built-in or custom plugin
	isBuiltin := lib.IsBuiltinPlugin(request.Name)
	// Built-in plugins should not have a path
	if isBuiltin && request.Path != nil {
		request.Path = nil
	}
	// A custom plugin path is native code (.so) that gets dlopen()'d, running its init()
	// in-process - that's intentional admin functionality, but only for a caller who
	// actually authenticated, never for a request let through because dashboard auth is
	// unconfigured/disabled. Refuse before any DB write so an unauthenticated caller can't
	// even persist an attacker-controlled path for a later authenticated action to load.
	if !isBuiltin && request.Path != nil {
		if bypassed, _ := ctx.UserValue(schemas.BifrostContextKeyAuthBypassed).(bool); bypassed {
			SendError(ctx, fasthttp.StatusForbidden, "Creating a custom plugin with a path requires genuine admin authentication; dashboard auth is currently disabled or unconfigured. Enable dashboard authentication first.")
			return
		}
	}
	// Normalize before DB write so SecretVar fields are stored as plain strings.
	normalizedConfig, err := h.normalizePluginConfig(request.Name, request.Config)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("Invalid plugin configuration: %v", err))
		return
	}
	// Create DB entry first to avoid orphaned in-memory state if DB write fails
	if err := h.configStore.CreatePlugin(ctx, &configstoreTables.TablePlugin{
		Name:      request.Name,
		Enabled:   request.Enabled,
		Config:    normalizedConfig,
		Path:      request.Path,
		IsCustom:  !isBuiltin,
		Placement: request.Placement,
		Order:     request.Order,
	}); err != nil {
		logger.Error("failed to create plugin: %v", err)
		SendError(ctx, 500, "Failed to create plugin")
		return
	}

	// Reload the plugin into memory if it's enabled
	if request.Enabled {
		if err := h.pluginsLoader.ReloadPlugin(ctx, request.Name, request.Path, normalizedConfig, request.Placement, request.Order); err != nil {
			logger.Error("failed to load plugin: %v", err)
			if rollbackErr := h.rollbackPluginChange(ctx, request.Name, nil); rollbackErr != nil {
				logger.Error("failed to rollback plugin creation after load error %v: %v", err, rollbackErr)
				SendError(ctx, fasthttp.StatusInternalServerError, "Plugin initialization failed and automatic rollback was incomplete; inspect the plugin status before retrying")
				return
			}
			var configurationError *PluginConfigurationError
			if errors.As(err, &configurationError) {
				SendError(ctx, fasthttp.StatusUnprocessableEntity, fmt.Sprintf("Invalid plugin configuration; no changes were applied: %v", err))
			} else {
				SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Plugin activation failed; the candidate was rolled back: %v", err))
			}
			return
		}
	}

	plugin, err := h.configStore.GetPlugin(ctx, request.Name)
	if err != nil {
		logger.Error("failed to get plugin: %v", err)
		SendError(ctx, 500, "Failed to retrieve plugin")
		return
	}

	ctx.SetStatusCode(fasthttp.StatusCreated)
	SendJSON(ctx, map[string]any{
		"message": "Plugin created successfully",
		"plugin":  h.buildPluginResponse(ctx, plugin),
	})
}

// updatePlugin updates an existing plugin
func (h *PluginsHandler) updatePlugin(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, 400, "Plugins update is not supported when configstore is disabled")
		return
	}
	h.mutationMu.Lock()
	defer h.mutationMu.Unlock()
	// Safely validate the "name" parameter
	nameValue := ctx.UserValue("name")
	if nameValue == nil {
		logger.Warn("missing required 'name' parameter in update plugin request")
		SendError(ctx, 400, "Missing required 'name' parameter")
		return
	}

	name, ok := nameValue.(string)
	if !ok {
		logger.Warn("invalid 'name' parameter type in update plugin request, expected string but got %T", nameValue)
		SendError(ctx, 400, "Invalid 'name' parameter type, expected string")
		return
	}

	if name == "" {
		logger.Warn("empty 'name' parameter provided in update plugin request")
		SendError(ctx, 400, "Empty 'name' parameter not allowed")
		return
	}
	// Unmarshalling the request body
	var request UpdatePluginRequest
	if err := json.Unmarshal(ctx.PostBody(), &request); err != nil {
		logger.Error("failed to unmarshal update plugin request: %v", err)
		SendError(ctx, 400, "Invalid request body")
		return
	}
	// Validate placement value
	if request.Placement != nil && *request.Placement != "" &&
		*request.Placement != schemas.PluginPlacementPreBuiltin &&
		*request.Placement != schemas.PluginPlacementPostBuiltin {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid placement value. Must be 'pre_builtin' or 'post_builtin'")
		return
	}
	if request.Placement != nil && *request.Placement == "" {
		request.Placement = nil
	}
	// Normalize empty path to nil (treat empty string as built-in plugin)
	if request.Path != nil && *request.Path == "" {
		request.Path = nil
	}
	// Determine if this is a built-in plugin
	isBuiltin := lib.IsBuiltinPlugin(name)
	// Built-in plugins should not have a path
	if isBuiltin && request.Path != nil {
		request.Path = nil
	}
	// See the matching check in createPlugin: a custom plugin path is native code that
	// gets dlopen()'d in-process, so setting or changing one requires genuine
	// authentication even while the rest of the management API stays open.
	if !isBuiltin && request.Path != nil {
		if bypassed, _ := ctx.UserValue(schemas.BifrostContextKeyAuthBypassed).(bool); bypassed {
			SendError(ctx, fasthttp.StatusForbidden, "Setting a custom plugin path requires genuine admin authentication; dashboard auth is currently disabled or unconfigured. Enable dashboard authentication first.")
			return
		}
	}

	// Fetch the previous row only after the complete request has been parsed and
	// validated. UpdatePlugin already supports an absent row, so a rejected request
	// must never leave an empty placeholder behind.
	existingPlugin, err := h.configStore.GetPlugin(ctx, name)
	if err != nil {
		if errors.Is(err, configstore.ErrNotFound) {
			existingPlugin = nil
		} else {
			logger.Error("failed to get plugin: %v", err)
			SendError(ctx, fasthttp.StatusInternalServerError, "Failed to update plugin")
			return
		}
	}
	// Merge incoming config over the existing DB config so fields unknown to the
	// calling form (e.g. plugin_span_filter set by a separate UI sheet) are not wiped.
	mergedConfig := request.Config
	if existingPlugin != nil {
		if existingCfg, ok := existingPlugin.Config.(map[string]any); ok && len(existingCfg) > 0 {
			mergedConfig = make(map[string]any, len(existingCfg)+len(request.Config))
			maps.Copy(mergedConfig, existingCfg)
			// Before overwriting, substitute any redacted SecretVar placeholders in the
			// incoming config with the existing stored value so credentials are not
			// replaced by "***" or similar client-side redaction markers.
			incoming := restoreRedactedFromExisting(request.Config, existingCfg)
			maps.Copy(mergedConfig, incoming)
		}
	}
	// Normalize through the typed plugin config so custom MarshalJSON (e.g. SecretVar → string) runs.
	mergedConfig, err = h.normalizePluginConfig(name, mergedConfig)
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("Invalid plugin configuration: %v", err))
		return
	}
	candidate := &configstoreTables.TablePlugin{
		Name:      name,
		Enabled:   request.Enabled,
		Config:    mergedConfig,
		Path:      request.Path,
		IsCustom:  !isBuiltin,
		Placement: request.Placement,
		Order:     request.Order,
	}
	if err := h.configStore.UpdatePlugin(ctx, candidate); err != nil {
		logger.Error("failed to update plugin: %v", err)
		SendError(ctx, 500, "Failed to update plugin")
		return
	}

	// Activate only after persistence succeeds. Any activation failure restores both
	// the previous row and the previous runtime so a bad candidate cannot poison the
	// next list, edit, disable, or delete operation.
	var runtimeErr error
	if request.Enabled {
		runtimeErr = h.pluginsLoader.ReloadPlugin(ctx, name, request.Path, mergedConfig, request.Placement, request.Order)
	} else {
		ctx.SetUserValue(PluginDisabledKey, true)
		runtimeErr = h.removePluginRuntime(ctx, name)
	}
	if runtimeErr != nil {
		logger.Error("failed to apply plugin runtime change: %v", runtimeErr)
		if rollbackErr := h.rollbackPluginChange(ctx, name, existingPlugin); rollbackErr != nil {
			logger.Error("failed to rollback plugin update after runtime error %v: %v", runtimeErr, rollbackErr)
			SendError(ctx, fasthttp.StatusInternalServerError, "Plugin initialization failed and automatic rollback was incomplete; inspect the plugin status before retrying")
			return
		}
		var configurationError *PluginConfigurationError
		if errors.As(runtimeErr, &configurationError) {
			SendError(ctx, fasthttp.StatusUnprocessableEntity, fmt.Sprintf("Invalid plugin configuration; previous configuration was restored: %v", runtimeErr))
		} else {
			SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Plugin activation failed; previous configuration was restored: %v", runtimeErr))
		}
		return
	}

	SendJSON(ctx, map[string]interface{}{
		"message": "Plugin updated successfully",
		"plugin":  h.buildPluginResponse(ctx, candidate),
	})
}

// deletePlugin deletes an existing plugin
func (h *PluginsHandler) deletePlugin(ctx *fasthttp.RequestCtx) {
	if h.configStore == nil {
		SendError(ctx, 400, "Plugins deletion is not supported when configstore is disabled")
		return
	}
	h.mutationMu.Lock()
	defer h.mutationMu.Unlock()
	// Safely validate the "name" parameter
	nameValue := ctx.UserValue("name")
	if nameValue == nil {
		logger.Warn("missing required 'name' parameter in delete plugin request")
		SendError(ctx, 400, "Missing required 'name' parameter")
		return
	}

	name, ok := nameValue.(string)
	if !ok {
		logger.Warn("invalid 'name' parameter type in delete plugin request, expected string but got %T", nameValue)
		SendError(ctx, 400, "Invalid 'name' parameter type, expected string")
		return
	}

	if name == "" {
		logger.Warn("empty 'name' parameter provided in delete plugin request")
		SendError(ctx, 400, "Empty 'name' parameter not allowed")
		return
	}

	exists, err := h.pluginRecordExists(ctx, name)
	if err != nil {
		logger.Error("failed to inspect plugin before delete: %v", err)
		SendError(ctx, fasthttp.StatusInternalServerError, "Failed to inspect stored plugin configuration")
		return
	}
	if !exists {
		SendError(ctx, fasthttp.StatusNotFound, "Plugin not found")
		return
	}

	if err := h.removePluginRuntime(ctx, name); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Plugin runtime could not be stopped; no stored configuration was deleted: %v", err))
		return
	}
	if err := h.deletePluginRecord(ctx, name); err != nil && !errors.Is(err, configstore.ErrNotFound) {
		logger.Error("failed to delete plugin after stopping runtime: %v", err)
		SendError(ctx, 500, "Plugin runtime was stopped but its stored configuration could not be deleted; retry the delete operation")
		return
	}
	SendJSON(ctx, map[string]interface{}{
		"message": "Plugin deleted successfully",
	})
}

// restoreRedactedFromExisting walks the incoming config map and, for any field whose
// value is a redacted placeholder (a masked EnvVar object, or a masked plain string),
// replaces it with the corresponding value from the existing DB
// config so client-side redaction never overwrites real credentials. It descends into
// nested maps AND slices (e.g. the OTEL `profiles` array), and handles header values that
// are stored as plain strings rather than EnvVar objects. Mirrors the mergeUpdatedKey
// pattern used by provider keys.
func restoreRedactedFromExisting(incoming, existing map[string]any) map[string]any {
	if len(incoming) == 0 {
		return incoming
	}
	result := make(map[string]any, len(incoming))
	for k, v := range incoming {
		result[k] = restoreRedactedValue(v, existing[k])
	}
	return result
}

// restoreRedactedValue restores a single incoming value against its corresponding existing
// value. It recurses through maps and slices, and treats both EnvVar-shaped objects and
// plain redacted strings as placeholders to swap back to the stored original. Returns the
// incoming value unchanged when it is not a redaction placeholder or has no stored match.
func restoreRedactedValue(incoming, existing any) any {
	switch val := incoming.(type) {
	case map[string]any:
		if isSecretVarObject(val) {
			if schemas.NewSecretVar(marshalSecretVarObject(val)).ShouldPreserveStored() && existing != nil {
				return existing
			}
			return val
		}
		if existingNested, ok := existing.(map[string]any); ok {
			return restoreRedactedFromExisting(val, existingNested)
		}
		return val
	case []any:
		// Restore element-by-element against the existing slice (index-aligned). New
		// elements beyond the existing length carry user-supplied values, so keep them.
		existingSlice, ok := existing.([]any)
		if !ok {
			return val
		}
		out := make([]any, len(val))
		for i, item := range val {
			if i < len(existingSlice) {
				out[i] = restoreRedactedValue(item, existingSlice[i])
			} else {
				out[i] = item
			}
		}
		return out
	case string:
		// Plain-string secrets (e.g. OTEL headers): restore only when the incoming string
		// is a redaction artifact and not an intentional env reference. Empty strings are
		// left as-is so clearing a value works.
		if existingStr, ok := existing.(string); ok {
			secretVal := schemas.NewSecretVar(val)
			if !secretVal.IsFromSecret() && secretVal.IsRedacted() {
				return existingStr
			}
		}
		return val
	default:
		return incoming
	}
}

// isSecretVarObject returns true if m has the shape of a serialised SecretVar: a string
// "value" plus, optionally, only SecretVar keys. Plain-text SecretVars marshal as
// {"value": "..."} alone (ref/type are omitempty), so value-only objects must match too —
// e.g. the Kafka SASL credentials round-tripped by the UI after a redacted GET.
func isSecretVarObject(m map[string]any) bool {
	if _, ok := m["value"].(string); !ok {
		return false
	}
	for k := range m {
		switch k {
		// "env_var"/"from_env" are shipped backward compat for "ref"/"type".
		case "value", "ref", "type", "env_var", "from_env":
		default:
			return false
		}
	}
	return true
}

// marshalSecretVarObject serialises a SecretVar-shaped map back to the JSON string that
// schemas.NewSecretVar expects so we can call ShouldPreserveStored on it.
func marshalSecretVarObject(m map[string]any) string {
	value, _ := m["value"].(string)
	if secretRef, ok := m["ref"].(string); ok {
		secretType, _ := m["type"].(string)
		if secretType != "" {
			return fmt.Sprintf(`{"value":%q,"ref":%q,"type":%q}`, value, secretRef, secretType)
		}
		return fmt.Sprintf(`{"value":%q}`, value)
	}
	// backward compat: old env_var/from_env format
	secretVar, _ := m["env_var"].(string)
	fromEnv, _ := m["from_env"].(bool)
	if fromEnv {
		return fmt.Sprintf(`{"value":%q,"env_var":%q,"from_env":true}`, value, secretVar)
	}
	return fmt.Sprintf(`{"value":%q,"env_var":%q,"from_env":false}`, value, secretVar)
}
