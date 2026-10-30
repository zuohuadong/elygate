package controlplane

import (
	"encoding/json"
	"errors"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

type routingVersionPayload struct {
	ExpectedRevision *int64 `json:"expected_revision"`
}

type routingVersionResponse struct {
	*RoutingPolicyVersion
	Rules json.RawMessage `json:"rules"`
}

func (h *Handler) RegisterRoutingPolicyVersionRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	guarded := append(append([]schemas.BifrostHTTPMiddleware{}, middlewares...), h.AdminAccessMiddleware())
	wrap := func(fn fasthttp.RequestHandler) fasthttp.RequestHandler {
		next := lib.ChainMiddlewares(fn, guarded...)
		return func(ctx *fasthttp.RequestCtx) {
			ctx.Response.Header.Set("Cache-Control", "no-store")
			next(ctx)
		}
	}
	r.GET("/api/control-plane/routing/versions", wrap(h.listRoutingPolicyVersions))
	r.GET("/api/control-plane/routing/versions/{version_id}", wrap(h.getRoutingPolicyVersion))
	r.POST("/api/control-plane/routing/drafts/{draft_id}/versions", wrap(h.createRoutingPolicyVersion))
}

func (h *Handler) createRoutingPolicyVersion(ctx *fasthttp.RequestCtx) {
	draftID, ok := canonicalRoutingID(ctx, "draft_id", "draft ID")
	if !ok {
		return
	}
	var payload routingVersionPayload
	if !decodeRoutingDraftJSON(ctx, &payload) || !validRoutingDraftRevision(ctx, payload.ExpectedRevision) {
		return
	}
	opCtx, cancel := controlPlaneAuditContext(ctx)
	defer cancel()
	version, err := h.store.CreateRoutingPolicyVersion(opCtx, draftID, *payload.ExpectedRevision, auditActor(ctx))
	if err != nil {
		sendRoutingVersionError(ctx, err)
		return
	}
	writeJSON(ctx, 201, routingVersionResponse{version, json.RawMessage(version.RulesJSON)})
}

func (h *Handler) getRoutingPolicyVersion(ctx *fasthttp.RequestCtx) {
	versionID, ok := canonicalRoutingID(ctx, "version_id", "version ID")
	if !ok {
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	version, err := h.store.GetRoutingPolicyVersion(opCtx, versionID)
	if err != nil {
		sendRoutingVersionError(ctx, err)
		return
	}
	writeJSON(ctx, 200, routingVersionResponse{version, json.RawMessage(version.RulesJSON)})
}

func (h *Handler) listRoutingPolicyVersions(ctx *fasthttp.RequestCtx) {
	limit, err := routingDraftPageNumber(ctx.QueryArgs(), "limit", 25)
	offset, offsetErr := routingDraftPageNumber(ctx.QueryArgs(), "offset", 0)
	if err != nil || offsetErr != nil || limit < 1 || limit > 100 {
		writeError(ctx, 400, errors.New("routing version pagination requires limit 1..100 and nonnegative offset"))
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	versions, err := h.store.ListRoutingPolicyVersions(opCtx, limit, offset)
	if err != nil {
		sendRoutingVersionError(ctx, err)
		return
	}
	writeJSON(ctx, 200, map[string]any{"versions": versions, "limit": limit, "offset": offset})
}

func canonicalRoutingID(ctx *fasthttp.RequestCtx, parameter, label string) (string, bool) {
	raw := routeParam(ctx, parameter)
	parsed, err := uuid.Parse(raw)
	if err != nil || parsed.String() != raw {
		writeError(ctx, 400, errors.New(label+" must be a canonical UUID"))
		return "", false
	}
	return raw, true
}

func sendRoutingVersionError(ctx *fasthttp.RequestCtx, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		writeError(ctx, 404, errors.New("routing policy version does not exist"))
	case errors.Is(err, ErrRoutingDraftConflict):
		writeError(ctx, 409, ErrRoutingDraftConflict)
	default:
		writeError(ctx, 500, errors.New("routing policy version storage operation failed"))
	}
}
