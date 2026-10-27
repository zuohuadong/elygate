package controlplane

import (
	"encoding/json"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

// Fan-out shares the alert transaction, so a crash cannot acknowledge an
// alert before all subscribed endpoint deliveries have durable queue rows.
func enqueueBudgetWebhooks(tx *gorm.DB, alert BudgetAlert) error {
	payload, err := json.Marshal(alert)
	if err != nil {
		return err
	}
	var endpoints []tables.TableWebhookEndpoint
	return tx.Model(&tables.TableWebhookEndpoint{}).Select("id", "events_json").
		Where("disabled = ?", false).FindInBatches(&endpoints, 100, func(_ *gorm.DB, _ int) error {
		for _, endpoint := range endpoints {
			for _, event := range endpoint.Events {
				if event != tables.WebhookEventBudgetThresholdReached {
					continue
				}
				job := tables.TableWebhookJob{
					ID:         uuid.NewSHA1(uuid.NameSpaceURL, []byte("elygate:budget-webhook:"+alert.ID+":"+endpoint.ID)).String(),
					EndpointID: endpoint.ID, Event: event, ResourceID: alert.ID, PayloadJSON: string(payload),
					CreatedAt: alert.TriggeredAt.UTC(), NextAttemptAt: alert.TriggeredAt.UTC(),
				}
				if err := tx.Create(&job).Error; err != nil {
					return err
				}
			}
		}
		return nil
	}).Error
}
