package controlplane

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"

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

func decodeBudgetAcknowledgement(body []byte) (bool, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	invalid := errors.New("request must contain only a required acknowledged boolean")
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return false, invalid
	}
	key, err := decoder.Token()
	if err != nil || key != "acknowledged" {
		return false, invalid
	}
	var acknowledged *bool
	if err := decoder.Decode(&acknowledged); err != nil || acknowledged == nil {
		return false, invalid
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') || decoder.Decode(new(any)) != io.EOF {
		return false, invalid
	}
	return *acknowledged, nil
}

func writeBudgetAcknowledgementError(ctx *fasthttp.RequestCtx, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeError(ctx, 404, errors.New("budget alert does not exist"))
		return
	}
	writeError(ctx, 500, errors.New("budget alert acknowledgement could not be persisted"))
}
