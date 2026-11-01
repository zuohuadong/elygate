package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// RoutingReleaseActivator closes admission, installs the durable release and
// opens the new process-local generation. The control-plane handler owns the
// durable intent; the server owns the serving-process swap.
type RoutingReleaseActivator interface {
	ActivateRoutingRelease(context.Context, *Store, int64, string) error
}

const maxRoutingReleaseRequestBytes = 16 * 1024

type routingReleaseMutationPayload struct {
	VersionID       string `json:"version_id,omitempty"`
	ExpectedEpoch   *int64 `json:"expected_epoch"`
	IdempotencyKey  string `json:"idempotency_key"`
	RollbackOfEpoch *int64 `json:"rollback_of_epoch,omitempty"`
}

type routingReleaseMutationResponse struct {
	Release         *RoutingReleaseAttempt `json:"release"`
	Head            *RoutingReleaseHead    `json:"head"`
	ActivationState string                 `json:"activation_state"`
}

func (h *Handler) RegisterRoutingReleaseReadRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	guarded := append(append([]schemas.BifrostHTTPMiddleware{}, middlewares...), h.AdminAccessMiddleware())
	wrap := func(fn fasthttp.RequestHandler) fasthttp.RequestHandler {
		next := lib.ChainMiddlewares(fn, guarded...)
		return func(ctx *fasthttp.RequestCtx) {
			ctx.Response.Header.Set("Cache-Control", "no-store")
			next(ctx)
		}
	}
	r.GET("/api/control-plane/routing/releases/head", wrap(h.getRoutingReleaseHead))
	r.GET("/api/control-plane/routing/releases", wrap(h.listRoutingReleases))
}

func (h *Handler) RegisterRoutingReleaseWriteRoutes(r *router.Router, middlewares ...schemas.BifrostHTTPMiddleware) {
	guarded := append(append([]schemas.BifrostHTTPMiddleware{}, middlewares...), h.AdminAccessMiddleware())
	wrap := func(fn fasthttp.RequestHandler) fasthttp.RequestHandler {
		next := lib.ChainMiddlewares(fn, guarded...)
		return func(ctx *fasthttp.RequestCtx) {
			ctx.Response.Header.Set("Cache-Control", "no-store")
			next(ctx)
		}
	}
	r.POST("/api/control-plane/routing/releases/publish", wrap(func(ctx *fasthttp.RequestCtx) {
		h.mutateRoutingRelease(ctx, RoutingReleasePublish)
	}))
	r.POST("/api/control-plane/routing/releases/rollback", wrap(func(ctx *fasthttp.RequestCtx) {
		h.mutateRoutingRelease(ctx, RoutingReleaseRollback)
	}))
}

func (h *Handler) mutateRoutingRelease(ctx *fasthttp.RequestCtx, operation RoutingReleaseOperation) {
	if h.releases == nil {
		writeError(ctx, fasthttp.StatusServiceUnavailable, errors.New("routing release activation is unavailable"))
		return
	}
	var payload routingReleaseMutationPayload
	if !decodeRoutingReleaseJSON(ctx, &payload) {
		return
	}
	request, err := routingReleaseRequest(payload, operation, auditActor(ctx))
	if err != nil {
		writeError(ctx, fasthttp.StatusBadRequest, err)
		return
	}
	opCtx, cancel := controlPlaneAuditContext(ctx)
	defer cancel()
	attempt, err := h.store.AcceptRoutingRelease(opCtx, request)
	if err != nil {
		sendRoutingReleaseMutationError(ctx, err)
		return
	}
	activationErr := h.releases.ActivateRoutingRelease(opCtx, h.store, attempt.Epoch, auditActor(ctx))
	head, headErr := h.store.GetRoutingReleaseHead(opCtx)
	if headErr != nil {
		writeError(ctx, fasthttp.StatusInternalServerError, errors.New("routing release state could not be read"))
		return
	}
	if activationErr != nil {
		// The durable intent remains pending and the same idempotency key can
		// safely retry activation after a transient process/runtime failure.
		writeJSON(ctx, fasthttp.StatusServiceUnavailable, routingReleaseMutationResponse{
			Release: attempt, Head: head, ActivationState: "pending",
		})
		return
	}
	writeJSON(ctx, fasthttp.StatusOK, routingReleaseMutationResponse{
		Release: attempt, Head: head, ActivationState: "applied",
	})
}

func decodeRoutingReleaseJSON(ctx *fasthttp.RequestCtx, target any) bool {
	if len(ctx.PostBody()) == 0 || len(ctx.PostBody()) > maxRoutingReleaseRequestBytes {
		writeError(ctx, fasthttp.StatusBadRequest, errors.New("invalid routing release JSON"))
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(ctx.PostBody()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(ctx, fasthttp.StatusBadRequest, errors.New("invalid routing release JSON"))
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		writeError(ctx, fasthttp.StatusBadRequest, errors.New("invalid routing release JSON"))
		return false
	}
	return true
}

func routingReleaseRequest(payload routingReleaseMutationPayload, operation RoutingReleaseOperation, actor string) (RoutingReleaseRequest, error) {
	if payload.ExpectedEpoch == nil || strings.TrimSpace(payload.IdempotencyKey) == "" ||
		len(payload.IdempotencyKey) > 128 {
		return RoutingReleaseRequest{}, errors.New("expected_epoch and idempotency_key are required")
	}
	request := RoutingReleaseRequest{
		VersionID: payload.VersionID, ExpectedEpoch: *payload.ExpectedEpoch,
		IdempotencyKey: payload.IdempotencyKey, ActorID: actor, Operation: operation,
	}
	switch operation {
	case RoutingReleasePublish:
		if payload.RollbackOfEpoch != nil || payload.VersionID == "" {
			return RoutingReleaseRequest{}, errors.New("publish requires version_id and does not accept rollback_of_epoch")
		}
	case RoutingReleaseRollback:
		if payload.VersionID != "" || payload.RollbackOfEpoch == nil {
			return RoutingReleaseRequest{}, errors.New("rollback requires rollback_of_epoch and does not accept version_id")
		}
		request.RollbackOfEpoch = *payload.RollbackOfEpoch
	default:
		return RoutingReleaseRequest{}, ErrRoutingReleaseRequest
	}
	return request, nil
}

func sendRoutingReleaseMutationError(ctx *fasthttp.RequestCtx, err error) {
	switch {
	case errors.Is(err, ErrRoutingReleaseRequest):
		writeError(ctx, fasthttp.StatusBadRequest, ErrRoutingReleaseRequest)
	case errors.Is(err, ErrRoutingReleaseConflict), errors.Is(err, ErrRoutingReleaseKeyConflict),
		errors.Is(err, ErrRoutingReleaseNotApplied):
		writeError(ctx, fasthttp.StatusConflict, err)
	case errors.Is(err, gorm.ErrRecordNotFound):
		writeError(ctx, fasthttp.StatusNotFound, errors.New("routing policy version does not exist"))
	default:
		writeError(ctx, fasthttp.StatusInternalServerError, errors.New("routing release storage operation failed"))
	}
}

func (h *Handler) getRoutingReleaseHead(ctx *fasthttp.RequestCtx) {
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	page, err := h.store.ReadRoutingReleasePage(opCtx, 1, 0)
	if err != nil {
		writeError(ctx, 500, errors.New("routing release storage operation failed"))
		return
	}
	writeJSON(ctx, 200, page.Head)
}

func (h *Handler) listRoutingReleases(ctx *fasthttp.RequestCtx) {
	limit, limitErr := routingDraftPageNumber(ctx.QueryArgs(), "limit", 25)
	offset, offsetErr := routingDraftPageNumber(ctx.QueryArgs(), "offset", 0)
	if limitErr != nil || offsetErr != nil || limit < 1 || limit > 100 {
		writeError(ctx, 400, errors.New("routing release pagination requires limit 1..100 and nonnegative offset"))
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	page, err := h.store.ReadRoutingReleasePage(opCtx, limit, offset)
	if err != nil {
		writeError(ctx, 500, errors.New("routing release storage operation failed"))
		return
	}
	writeJSON(ctx, 200, page)
}
