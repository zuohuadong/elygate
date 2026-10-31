package controlplane

import (
	"errors"

	"github.com/fasthttp/router"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
)

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
