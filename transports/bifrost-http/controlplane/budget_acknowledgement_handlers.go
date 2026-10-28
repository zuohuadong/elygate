package controlplane

import (
	"errors"

	"github.com/google/uuid"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func (h *Handler) setBudgetAcknowledgement(ctx *fasthttp.RequestCtx) {
	id := routeParam(ctx, "alert_id")
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id {
		writeError(ctx, 400, errors.New("alert ID must be a canonical UUID"))
		return
	}
	acknowledged, err := decodeBudgetAcknowledgement(ctx.PostBody())
	if err != nil {
		writeError(ctx, 400, err)
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	alert, err := h.store.SetBudgetAcknowledgement(opCtx, budgetAcknowledgementMutation{id, acknowledged})
	if err != nil {
		writeBudgetAcknowledgementError(ctx, err)
		return
	}
	writeJSON(ctx, 200, alert)
}

func writeBudgetAcknowledgementError(ctx *fasthttp.RequestCtx, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeError(ctx, 404, errors.New("budget alert does not exist"))
		return
	}
	writeError(ctx, 500, errors.New("budget alert acknowledgement could not be persisted"))
}
