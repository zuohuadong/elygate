package controlplane

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/fasthttp/router"
	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

const maxRoutingDraftBytes = 128 * 1024
const maxRoutingDraftRevision = 1<<53 - 1

type routingDraftPayload struct {
	Name             string          `json:"name"`
	Rules            json.RawMessage `json:"rules"`
	ChainMaxDepth    int             `json:"chain_max_depth"`
	ExpectedRevision *int64          `json:"expected_revision,omitempty"`
}

type routingDraftResponse struct {
	*RoutingDraft
	Rules json.RawMessage `json:"rules"`
}

// RegisterRoutingDraftRoutes reuses the same administrator boundary as simulation.
// The validator compiles candidates in isolation; it never updates the live plugin.
func (h *Handler) RegisterRoutingDraftRoutes(r *router.Router, validate func(string) error, middlewares ...schemas.BifrostHTTPMiddleware) {
	guarded := append(append([]schemas.BifrostHTTPMiddleware{}, middlewares...), h.AdminAccessMiddleware())
	wrap := func(fn fasthttp.RequestHandler) fasthttp.RequestHandler {
		next := lib.ChainMiddlewares(fn, guarded...)
		return func(ctx *fasthttp.RequestCtx) {
			ctx.Response.Header.Set("Cache-Control", "no-store")
			next(ctx)
		}
	}
	r.GET("/api/control-plane/routing/drafts", wrap(h.listRoutingDrafts))
	r.GET("/api/control-plane/routing/drafts/{draft_id}", wrap(h.getRoutingDraft))
	r.POST("/api/control-plane/routing/drafts", wrap(func(ctx *fasthttp.RequestCtx) { h.createRoutingDraft(ctx, validate) }))
	r.PUT("/api/control-plane/routing/drafts/{draft_id}", wrap(func(ctx *fasthttp.RequestCtx) { h.updateRoutingDraft(ctx, validate) }))
	r.DELETE("/api/control-plane/routing/drafts/{draft_id}", wrap(h.deleteRoutingDraft))
}

func decodeRoutingDraftJSON(ctx *fasthttp.RequestCtx, target any) bool {
	if len(ctx.PostBody()) > maxRoutingDraftBytes {
		writeError(ctx, 413, errors.New("routing draft exceeds 128 KiB"))
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(ctx.PostBody()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil || decoder.Decode(new(any)) != io.EOF {
		writeError(ctx, 400, errors.New("invalid routing draft JSON"))
		return false
	}
	return true
}

func routingDraftContent(payload routingDraftPayload) (RoutingDraftContent, error) {
	name := strings.TrimSpace(payload.Name)
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 128 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return RoutingDraftContent{}, errors.New("draft name must contain 1..128 characters without control characters")
	}
	if payload.ChainMaxDepth < 1 || payload.ChainMaxDepth > 20 {
		return RoutingDraftContent{}, errors.New("chain_max_depth must be between 1 and 20")
	}
	return RoutingDraftContent{Name: name, RulesJSON: string(payload.Rules), ChainMaxDepth: payload.ChainMaxDepth}, nil
}

func routingDraftID(ctx *fasthttp.RequestCtx) (string, bool) {
	id := routeParam(ctx, "draft_id")
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id {
		writeError(ctx, 400, errors.New("draft ID must be a canonical UUID"))
		return "", false
	}
	return id, true
}

func validRoutingDraftRevision(ctx *fasthttp.RequestCtx, revision *int64) bool {
	if revision == nil || *revision < 1 || *revision >= maxRoutingDraftRevision {
		writeError(ctx, 400, errors.New("expected_revision must be a positive safe integer below 9007199254740991"))
		return false
	}
	return true
}

func sendRoutingDraftError(ctx *fasthttp.RequestCtx, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		writeError(ctx, 404, errors.New("routing draft does not exist"))
	case errors.Is(err, ErrRoutingDraftConflict):
		writeError(ctx, 409, ErrRoutingDraftConflict)
	default:
		writeError(ctx, 500, errors.New("routing draft storage operation failed"))
	}
}

func (h *Handler) createRoutingDraft(ctx *fasthttp.RequestCtx, validate func(string) error) {
	var payload routingDraftPayload
	if !decodeRoutingDraftJSON(ctx, &payload) {
		return
	}
	if payload.ExpectedRevision != nil {
		writeError(ctx, 400, errors.New("expected_revision is not accepted when creating a draft"))
		return
	}
	content, err := routingDraftContent(payload)
	if err == nil {
		err = validate(content.RulesJSON)
	}
	if err != nil {
		writeError(ctx, 400, err)
		return
	}
	opCtx, cancel := controlPlaneAuditContext(ctx)
	defer cancel()
	content.ActorID = auditActor(ctx)
	draft, err := h.store.CreateRoutingDraft(opCtx, content)
	if err != nil {
		sendRoutingDraftError(ctx, err)
		return
	}
	writeJSON(ctx, 201, routingDraftResponse{draft, json.RawMessage(draft.RulesJSON)})
}

func (h *Handler) updateRoutingDraft(ctx *fasthttp.RequestCtx, validate func(string) error) {
	id, ok := routingDraftID(ctx)
	if !ok {
		return
	}
	var payload routingDraftPayload
	if !decodeRoutingDraftJSON(ctx, &payload) || !validRoutingDraftRevision(ctx, payload.ExpectedRevision) {
		return
	}
	content, err := routingDraftContent(payload)
	if err == nil {
		err = validate(content.RulesJSON)
	}
	if err != nil {
		writeError(ctx, 400, err)
		return
	}
	opCtx, cancel := controlPlaneAuditContext(ctx)
	defer cancel()
	content.ActorID = auditActor(ctx)
	draft, err := h.store.UpdateRoutingDraft(opCtx, id, RoutingDraftUpdate{content, *payload.ExpectedRevision})
	if err != nil {
		sendRoutingDraftError(ctx, err)
		return
	}
	writeJSON(ctx, 200, routingDraftResponse{draft, json.RawMessage(draft.RulesJSON)})
}

func (h *Handler) deleteRoutingDraft(ctx *fasthttp.RequestCtx) {
	id, ok := routingDraftID(ctx)
	if !ok {
		return
	}
	var payload struct {
		ExpectedRevision *int64 `json:"expected_revision"`
	}
	if !decodeRoutingDraftJSON(ctx, &payload) || !validRoutingDraftRevision(ctx, payload.ExpectedRevision) {
		return
	}
	opCtx, cancel := controlPlaneAuditContext(ctx)
	defer cancel()
	if err := h.store.DeleteRoutingDraft(opCtx, id, *payload.ExpectedRevision, auditActor(ctx)); err != nil {
		sendRoutingDraftError(ctx, err)
		return
	}
	ctx.SetStatusCode(204)
}

func (h *Handler) getRoutingDraft(ctx *fasthttp.RequestCtx) {
	id, ok := routingDraftID(ctx)
	if !ok {
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	draft, err := h.store.GetRoutingDraft(opCtx, id)
	if err != nil {
		sendRoutingDraftError(ctx, err)
		return
	}
	writeJSON(ctx, 200, routingDraftResponse{draft, json.RawMessage(draft.RulesJSON)})
}

func (h *Handler) listRoutingDrafts(ctx *fasthttp.RequestCtx) {
	limit, err := routingDraftPageNumber(ctx.QueryArgs(), "limit", 25)
	offset, offsetErr := routingDraftPageNumber(ctx.QueryArgs(), "offset", 0)
	if err != nil || offsetErr != nil || limit < 1 || limit > 100 {
		writeError(ctx, 400, errors.New("routing draft pagination requires limit 1..100 and nonnegative offset"))
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	drafts, err := h.store.ListRoutingDrafts(opCtx, limit, offset)
	if err != nil {
		sendRoutingDraftError(ctx, err)
		return
	}
	writeJSON(ctx, 200, map[string]any{"drafts": drafts, "limit": limit, "offset": offset})
}

func routingDraftPageNumber(args *fasthttp.Args, key string, fallback int) (int, error) {
	if !args.Has(key) {
		return fallback, nil
	}
	raw := string(args.Peek(key))
	if raw == "" || len(args.PeekMulti(key)) != 1 || strings.IndexFunc(raw, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
		return 0, errors.New("invalid pagination")
	}
	return strconv.Atoi(raw)
}
