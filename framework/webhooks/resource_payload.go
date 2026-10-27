package webhooks

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/maximhq/bifrost/framework/configstore/tables"
)

func renderResourcePayload(job tables.TableWebhookJob) ([]byte, error) {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
		return nil, err
	}
	if payload == nil {
		return nil, errors.New("webhook resource payload must be a JSON object")
	}
	return json.Marshal(struct {
		Event     tables.WebhookEvent `json:"event"`
		CreatedAt time.Time           `json:"created_at"`
		Data      json.RawMessage     `json:"data"`
	}{job.Event, job.CreatedAt.UTC(), json.RawMessage(job.PayloadJSON)})
}
