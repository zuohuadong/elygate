package logstore

import (
	"context"
	"errors"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/migrator"
	"gorm.io/gorm"
)

func migrationAddWebhookDeliveryResourceEventColumns(ctx context.Context, db *gorm.DB, logger schemas.Logger) error {
	return migrator.New(db, migrator.DefaultOptions, []*migrator.Migration{{
		ID: "webhook_deliveries_add_resource_event_columns",
		Migrate: func(tx *gorm.DB) error {
			for _, column := range []string{"resource_id", "payload_json"} {
				if err := addColumnIfNotExists(tx.WithContext(ctx), logger, &WebhookDelivery{}, column); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(*gorm.DB) error {
			return errors.New("resource webhook history columns are non-rollbackable: dropping them loses redelivery data")
		},
	}}).Migrate()
}
