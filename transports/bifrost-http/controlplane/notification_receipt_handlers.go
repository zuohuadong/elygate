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

func (h *Handler) notificationReadStates(ctx *fasthttp.RequestCtx) {
	rawIDs := ctx.QueryArgs().PeekMulti("notification_id")
	ids := make([]string, 0, len(rawIDs))
	for _, id := range rawIDs {
		ids = append(ids, string(id))
	}
	if err := validateReceiptNotificationIDs(ids); err != nil {
		writeError(ctx, 400, err)
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	states, err := h.store.NotificationReadStates(opCtx, ids)
	if err != nil {
		writeNotificationReceiptError(ctx, err)
		return
	}
	writeJSON(ctx, 200, map[string]any{"data": states})
}

func validateReceiptNotificationIDs(ids []string) error {
	if len(ids) == 0 || len(ids) > 50 {
		return errors.New("supply 1 to 50 unique notification_id parameters")
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		parsed, err := uuid.Parse(id)
		if err != nil || parsed.String() != id || seen[id] {
			return errors.New("notification IDs must be unique canonical UUIDs")
		}
		seen[id] = true
	}
	return nil
}

func (h *Handler) setNotificationReadState(ctx *fasthttp.RequestCtx) {
	id := routeParam(ctx, "notification_id")
	if err := validateReceiptNotificationIDs([]string{id}); err != nil {
		writeError(ctx, 400, err)
		return
	}
	read, err := decodeNotificationReadMutation(ctx.PostBody())
	if err != nil {
		writeError(ctx, 400, err)
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	state, err := h.store.SetNotificationReadState(opCtx, notificationReadMutation{NotificationID: id, Read: read})
	if err != nil {
		writeNotificationReceiptError(ctx, err)
		return
	}
	writeJSON(ctx, 200, state)
}

func decodeNotificationReadMutation(body []byte) (bool, error) {
	var request struct {
		Read *bool `json:"read"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return false, errors.New("request must contain only a required read boolean")
	}
	if request.Read == nil || decoder.Decode(new(any)) != io.EOF {
		return false, errors.New("request must contain only a required read boolean")
	}
	return *request.Read, nil
}

func writeNotificationReceiptError(ctx *fasthttp.RequestCtx, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeError(ctx, 404, errors.New("notification is missing or expired"))
		return
	}
	writeError(ctx, 500, errors.New("notification read state could not be persisted or loaded"))
}
