package controlplane

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/maximhq/bifrost/plugins/logging"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

type Handler struct {
	store      *Store
	logManager logging.LogManager
	lifecycle  VirtualKeyLifecycle
}

// VirtualKeyLifecycle keeps control-plane key changes synchronized with the
// gateway's in-memory governance state. It is optional for isolated store tests.
type VirtualKeyLifecycle interface {
	ReloadVirtualKey(context.Context, string) (*configtables.TableVirtualKey, error)
	RemoveVirtualKey(context.Context, string) error
}

// fasthttp.RequestCtx is request-scoped but its Done channel is only closed at
// request completion. Passing it into database/sql can therefore block an
// operation when a handler is exercised directly (and is unnecessary for the
// short control-plane mutations). Use a bounded standard context for storage.
func controlPlaneContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}

func NewHandler(store *Store, logManager logging.LogManager, lifecycle ...VirtualKeyLifecycle) *Handler {
	h := &Handler{store: store, logManager: logManager}
	if len(lifecycle) > 0 {
		h.lifecycle = lifecycle[0]
	}
	return h
}

func (h *Handler) syncVirtualKey(ctx context.Context, virtualKeyID string) error {
	if h.lifecycle == nil {
		return nil
	}
	if _, err := h.lifecycle.ReloadVirtualKey(ctx, virtualKeyID); err != nil {
		if removeErr := h.lifecycle.RemoveVirtualKey(ctx, virtualKeyID); removeErr != nil {
			return fmt.Errorf("reload failed: %v; stale key removal failed: %w", err, removeErr)
		}
		return err
	}
	return nil
}

func (h *Handler) RegisterRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	guard := h.AdminAccessMiddleware()
	wrap := func(fn fasthttp.RequestHandler) fasthttp.RequestHandler {
		return lib.ChainMiddlewares(fn, append(middlewares, guard)...)
	}
	r.GET("/api/control-plane/projects", wrap(h.listProjects))
	r.POST("/api/control-plane/projects", wrap(h.createProject))
	r.GET("/api/control-plane/projects/{project_id}/applications", wrap(h.listApplications))
	r.POST("/api/control-plane/projects/{project_id}/applications", wrap(h.createApplication))
	r.GET("/api/control-plane/applications/{application_id}/keys", wrap(h.listApplicationKeys))
	r.POST("/api/control-plane/applications/{application_id}/keys", wrap(h.createApplicationKey))
	r.POST("/api/control-plane/applications/{application_id}/keys/{virtual_key_id}/rotate", wrap(h.rotateApplicationKey))
	r.DELETE("/api/control-plane/applications/{application_id}/keys/{virtual_key_id}", wrap(h.revokeApplicationKey))
	r.POST("/api/control-plane/applications/{application_id}/virtual-key-binding", wrap(h.bindVirtualKey))
	r.DELETE("/api/control-plane/applications/{application_id}/virtual-key-binding", wrap(h.revokeBinding))
	r.GET("/api/control-plane/usage", wrap(h.listUsage))
	r.GET("/api/control-plane/usage/export", wrap(h.exportUsage))
	r.GET("/api/control-plane/usage/status", wrap(h.usageStatus))
	r.GET("/api/control-plane/audit-events", wrap(h.listAudit))
}

func (h *Handler) InferenceAccessMiddleware() schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			value := governance.ParseVirtualKeyFromFastHTTPRequest(ctx)
			if value != nil {
				opCtx, cancel := controlPlaneContext()
				err := h.store.CheckVirtualKeyValueAccess(opCtx, *value)
				cancel()
				if err != nil {
					writeError(ctx, fasthttp.StatusUnauthorized, err)
					return
				}
			}
			next(ctx)
		}
	}
}

func (h *Handler) CheckVirtualKeyAccess(ctx context.Context, virtualKeyID string) error {
	hasBinding, err := h.store.HasBinding(ctx, virtualKeyID)
	if err != nil || !hasBinding {
		return err
	}
	_, err = h.store.ActiveBindingByVirtualKey(ctx, virtualKeyID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errors.New("application credential binding is revoked or expired")
	}
	return err
}

func (h *Handler) CheckVirtualKeyValueAccess(ctx context.Context, virtualKeyValue string) error {
	return h.store.CheckVirtualKeyValueAccess(ctx, virtualKeyValue)
}

func (h *Handler) AdminAccessMiddleware() schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(ctx *fasthttp.RequestCtx) {
			if bypassed, _ := ctx.UserValue(schemas.BifrostContextKeyAuthBypassed).(bool); bypassed {
				writeError(ctx, fasthttp.StatusForbidden, errors.New("control plane requires administrator authentication"))
				return
			}
			if isAdmin, _ := ctx.UserValue(schemas.IsLocalAdminContextKey).(bool); !isAdmin {
				writeError(ctx, fasthttp.StatusUnauthorized, errors.New("control plane requires administrator identity"))
				return
			}
			if !ctx.IsGet() && !ctx.IsHead() {
				mediaType, _, err := mime.ParseMediaType(string(ctx.Request.Header.ContentType()))
				if err != nil || mediaType != "application/json" {
					writeError(ctx, fasthttp.StatusUnsupportedMediaType, errors.New("control plane write requests must use application/json"))
					return
				}
				if !sameOriginAdminRequest(ctx) {
					writeError(ctx, fasthttp.StatusForbidden, errors.New("control plane write request origin is invalid"))
					return
				}
			}
			next(ctx)
		}
	}
}

func sameOriginAdminRequest(ctx *fasthttp.RequestCtx) bool {
	origin := strings.TrimSpace(string(ctx.Request.Header.Peek("Origin")))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	// Use the request Host as the trust anchor. X-Forwarded-Host is
	// client-controlled unless the deployment explicitly strips and rewrites it.
	host := string(ctx.Host())
	return strings.EqualFold(parsed.Host, host)
}

func writeJSON(ctx *fasthttp.RequestCtx, status int, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		writeError(ctx, 500, err)
		return
	}
	ctx.SetStatusCode(status)
	ctx.Response.Header.SetContentType("application/json; charset=utf-8")
	ctx.SetBody(data)
}
func writeError(ctx *fasthttp.RequestCtx, status int, err error) {
	writeJSON(ctx, status, map[string]string{"error": err.Error()})
}
func decodeJSON(ctx *fasthttp.RequestCtx, value any) error {
	if len(ctx.PostBody()) == 0 {
		return errors.New("request body is required")
	}
	return json.Unmarshal(ctx.PostBody(), value)
}

func (h *Handler) listProjects(ctx *fasthttp.RequestCtx) {
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	out, err := h.store.ListProjects(opCtx)
	if err != nil {
		writeError(ctx, 500, err)
		return
	}
	writeJSON(ctx, 200, map[string]any{"data": out})
}
func (h *Handler) createProject(ctx *fasthttp.RequestCtx) {
	var req struct {
		OrganizationID string `json:"organization_id"`
		Name           string `json:"name"`
	}
	if err := decodeJSON(ctx, &req); err != nil {
		writeError(ctx, 400, err)
		return
	}
	p := &Project{OrganizationID: req.OrganizationID, Name: req.Name}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	if err := h.store.CreateProjectWithAudit(opCtx, p, auditActor(ctx)); err != nil {
		writeError(ctx, 400, err)
		return
	}
	writeJSON(ctx, 201, p)
}
func auditActor(ctx *fasthttp.RequestCtx) string {
	actor, _ := ctx.UserValue(schemas.BifrostContextKeyUserID).(string)
	return actor
}
func routeParam(ctx *fasthttp.RequestCtx, key string) string { return fmt.Sprint(ctx.UserValue(key)) }
func (h *Handler) listApplications(ctx *fasthttp.RequestCtx) {
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	out, err := h.store.ListApplications(opCtx, routeParam(ctx, "project_id"))
	if err != nil {
		writeError(ctx, 500, err)
		return
	}
	writeJSON(ctx, 200, map[string]any{"data": out})
}
func (h *Handler) createApplication(ctx *fasthttp.RequestCtx) {
	var req struct {
		Name        string `json:"name"`
		Environment string `json:"environment"`
	}
	if err := decodeJSON(ctx, &req); err != nil {
		writeError(ctx, 400, err)
		return
	}
	app := &Application{ProjectID: routeParam(ctx, "project_id"), Name: req.Name, Environment: req.Environment}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	if err := h.store.CreateApplicationWithAudit(opCtx, app, auditActor(ctx)); err != nil {
		writeError(ctx, 400, err)
		return
	}
	writeJSON(ctx, 201, app)
}

func (h *Handler) createApplicationKey(ctx *fasthttp.RequestCtx) {
	var req struct {
		Name        string     `json:"name"`
		Description string     `json:"description,omitempty"`
		ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	}
	if err := decodeJSON(ctx, &req); err != nil {
		writeError(ctx, http.StatusBadRequest, err)
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	key, err := h.store.CreateApplicationKey(opCtx, routeParam(ctx, "application_id"), req.Name, req.Description, req.ExpiresAt, auditActor(ctx))
	if err != nil {
		writeError(ctx, http.StatusBadRequest, err)
		return
	}
	if err := h.syncVirtualKey(opCtx, key.VirtualKeyID); err != nil {
		writeError(ctx, http.StatusInternalServerError, fmt.Errorf("application key persisted but reload failed: %w", err))
		return
	}
	writeJSON(ctx, http.StatusCreated, key)
}

func (h *Handler) listApplicationKeys(ctx *fasthttp.RequestCtx) {
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	bindings, err := h.store.ListBindings(opCtx, routeParam(ctx, "application_id"))
	if err != nil {
		writeError(ctx, http.StatusInternalServerError, err)
		return
	}
	writeJSON(ctx, http.StatusOK, map[string]any{"data": bindings})
}

func (h *Handler) rotateApplicationKey(ctx *fasthttp.RequestCtx) {
	applicationID := routeParam(ctx, "application_id")
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	key, err := h.store.RotateApplicationKey(opCtx, applicationID, routeParam(ctx, "virtual_key_id"), auditActor(ctx))
	if err != nil {
		writeError(ctx, http.StatusBadRequest, err)
		return
	}
	if err := h.syncVirtualKey(opCtx, key.VirtualKeyID); err != nil {
		writeError(ctx, http.StatusInternalServerError, fmt.Errorf("application key rotated but reload failed: %w", err))
		return
	}
	writeJSON(ctx, http.StatusOK, key)
}

func (h *Handler) revokeApplicationKey(ctx *fasthttp.RequestCtx) {
	applicationID := routeParam(ctx, "application_id")
	virtualKeyID := routeParam(ctx, "virtual_key_id")
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	if err := h.store.RevokeApplicationKey(opCtx, applicationID, virtualKeyID, auditActor(ctx)); err != nil {
		writeError(ctx, http.StatusNotFound, err)
		return
	}
	// Reload the last known VK when possible. The store has already revoked the
	// binding, so the DB-backed access checker rejects the old value immediately.
	if err := h.syncVirtualKey(opCtx, virtualKeyID); err != nil {
		writeError(ctx, http.StatusInternalServerError, fmt.Errorf("application key revoked but reload failed: %w", err))
		return
	}
	ctx.SetStatusCode(http.StatusNoContent)
}

func (h *Handler) bindVirtualKey(ctx *fasthttp.RequestCtx) {
	var req struct {
		VirtualKeyID string     `json:"virtual_key_id"`
		ExpiresAt    *time.Time `json:"expires_at"`
	}
	if err := decodeJSON(ctx, &req); err != nil {
		writeError(ctx, 400, err)
		return
	}
	appID := routeParam(ctx, "application_id")
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	binding, err := h.store.BindVirtualKeyWithAudit(opCtx, appID, req.VirtualKeyID, req.ExpiresAt, auditActor(ctx))
	if err != nil {
		writeError(ctx, 400, err)
		return
	}
	writeJSON(ctx, 201, binding)
}
func (h *Handler) revokeBinding(ctx *fasthttp.RequestCtx) {
	appID := routeParam(ctx, "application_id")
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	if err := h.store.RevokeBindingWithAudit(opCtx, appID, auditActor(ctx)); err != nil {
		writeError(ctx, 404, err)
		return
	}
	ctx.SetStatusCode(http.StatusNoContent)
}

func parseTimeParam(ctx *fasthttp.RequestCtx, key string) (*time.Time, error) {
	raw := strings.TrimSpace(string(ctx.QueryArgs().Peek(key)))
	if raw == "" {
		return nil, nil
	}
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, fmt.Errorf("%s must be RFC3339", key)
	}
	value = value.UTC()
	return &value, nil
}
func (h *Handler) syncUsage(ctx context.Context, requestedStart, end *time.Time) error {
	if h.logManager == nil {
		return nil
	}
	checkpoint, err := h.store.Checkpoint(ctx)
	if err != nil {
		return err
	}
	// Freeze the incremental scan boundary so new logs arriving during paging
	// cannot shift later pages and create an unbounded sync window.
	if end == nil {
		value := time.Now().UTC()
		end = &value
	}
	var start *time.Time
	if !checkpoint.Watermark.IsZero() {
		value := checkpoint.Watermark
		start = &value
	}
	// Explicit time-bounded queries are backfills and must never move the
	// global projector watermark; only the default incremental sync advances it.
	advanceCheckpoint := requestedStart == nil
	if requestedStart != nil && (start == nil || requestedStart.Before(*start)) {
		value := requestedStart.UTC()
		start = &value
	}
	for offset := 0; ; offset += 500 {
		result, searchErr := h.logManager.Search(ctx, &logstore.SearchFilters{StartTime: start, EndTime: end}, &logstore.PaginationOptions{Limit: 500, Offset: offset, SortBy: "timestamp", Order: "asc"})
		if searchErr != nil {
			return searchErr
		}
		if _, projectErr := h.store.projectLogs(ctx, result.Logs, advanceCheckpoint); projectErr != nil {
			return projectErr
		}
		if len(result.Logs) < 500 {
			return nil
		}
	}
}
func (h *Handler) usageQuery(ctx *fasthttp.RequestCtx) (UsageQuery, error) {
	start, err := parseTimeParam(ctx, "start_time")
	if err != nil {
		return UsageQuery{}, err
	}
	end, err := parseTimeParam(ctx, "end_time")
	if err != nil {
		return UsageQuery{}, err
	}
	limit, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("limit")))
	offset, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("offset")))
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return UsageQuery{ProjectID: string(ctx.QueryArgs().Peek("project_id")), ApplicationID: string(ctx.QueryArgs().Peek("application_id")), StartTime: start, EndTime: end, Limit: limit, Offset: offset}, nil
}
func (h *Handler) listUsage(ctx *fasthttp.RequestCtx) {
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	q, err := h.usageQuery(ctx)
	if err != nil {
		writeError(ctx, 400, err)
		return
	}
	if err := h.syncUsage(opCtx, q.StartTime, q.EndTime); err != nil {
		writeError(ctx, 500, err)
		return
	}
	rows, total, err := h.store.ListUsage(opCtx, q)
	if err != nil {
		writeError(ctx, 500, err)
		return
	}
	writeJSON(ctx, 200, map[string]any{"data": rows, "pagination": map[string]any{"limit": q.Limit, "offset": q.Offset, "total": total}})
}
func (h *Handler) exportUsage(ctx *fasthttp.RequestCtx) {
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	q, err := h.usageQuery(ctx)
	if err != nil {
		writeError(ctx, 400, err)
		return
	}
	q.Limit = 100000
	q.Export = true
	if err := h.syncUsage(opCtx, q.StartTime, q.EndTime); err != nil {
		writeError(ctx, 500, err)
		return
	}
	rows, _, err := h.store.ListUsage(opCtx, q)
	if err != nil {
		writeError(ctx, 500, err)
		return
	}
	var b strings.Builder
	w := csv.NewWriter(&b)
	_ = w.Write([]string{"occurred_at", "project_id", "application_id", "virtual_key_id", "provider", "model", "status", "prompt_tokens", "output_tokens", "total_tokens", "cost"})
	for _, row := range rows {
		_ = w.Write([]string{row.OccurredAt.Format(time.RFC3339), row.ProjectID, row.ApplicationID, row.VirtualKeyID, row.Provider, row.Model, row.Status, strconv.Itoa(row.PromptTokens), strconv.Itoa(row.OutputTokens), strconv.Itoa(row.TotalTokens), strconv.FormatFloat(row.Cost, 'f', 8, 64)})
	}
	w.Flush()
	ctx.SetStatusCode(200)
	ctx.Response.Header.SetContentType("text/csv; charset=utf-8")
	ctx.Response.Header.Set("Content-Disposition", `attachment; filename="elygate-usage.csv"`)
	ctx.SetBodyString(b.String())
}
func (h *Handler) usageStatus(ctx *fasthttp.RequestCtx) {
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	checkpoint, err := h.store.Checkpoint(opCtx)
	if err != nil {
		writeError(ctx, 500, err)
		return
	}
	lag := time.Since(checkpoint.Watermark)
	if checkpoint.Watermark.IsZero() {
		lag = 0
	}
	writeJSON(ctx, 200, map[string]any{"watermark": checkpoint.Watermark, "last_log_id": checkpoint.LastLogID, "lag_seconds": int64(lag.Seconds())})
}

func (h *Handler) listAudit(ctx *fasthttp.RequestCtx) {
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	limit, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("limit")))
	rows, err := h.store.ListAudit(opCtx, limit)
	if err != nil {
		writeError(ctx, 500, err)
		return
	}
	writeJSON(ctx, 200, map[string]any{"data": rows})
}
