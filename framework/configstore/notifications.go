package configstore

import (
	"context"
	"errors"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/migrator"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// NotificationStore is intentionally a narrow optional interface so adding
// notifications does not force every ConfigStore test double to grow methods.
type NotificationStore interface {
	CreateNotification(ctx context.Context, notification *tables.TableNotification) error
	ListNotifications(ctx context.Context, before time.Time, beforeID string, limit int) ([]tables.TableNotification, error)
	DeleteExpiredNotifications(ctx context.Context, now time.Time) (int64, error)
}

// IdempotentNotificationStore preserves the first payload and timestamps when
// an outbox replays the same notification after a crash before acknowledgement.
type IdempotentNotificationStore interface {
	CreateNotificationIfNotExists(ctx context.Context, notification *tables.TableNotification) (bool, error)
}

func (s *RDBConfigStore) CreateNotification(ctx context.Context, notification *tables.TableNotification) error {
	return s.DB().WithContext(ctx).Create(notification).Error
}

func (s *RDBConfigStore) CreateNotificationIfNotExists(ctx context.Context, notification *tables.TableNotification) (bool, error) {
	stored := *notification
	stored.RetainForReplay = true
	var created bool
	err := s.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inserted := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoNothing: true}).Create(&stored)
		if inserted.Error != nil {
			return inserted.Error
		}
		created = inserted.RowsAffected == 1
		return tx.First(&stored, "id = ?", notification.ID).Error
	})
	if err == nil {
		*notification = stored
	}
	return created, err
}

func (s *RDBConfigStore) ListNotifications(ctx context.Context, before time.Time, beforeID string, limit int) ([]tables.TableNotification, error) {
	if limit <= 0 {
		limit = 50
	}
	query := s.DB().WithContext(ctx).Where("expires_at > ?", time.Now().UTC())
	if !before.IsZero() {
		query = query.Where("created_at < ? OR (created_at = ? AND id < ?)", before, before, beforeID)
	}
	var notifications []tables.TableNotification
	err := query.Order("created_at DESC").Order("id DESC").Limit(limit).Find(&notifications).Error
	return notifications, err
}

func (s *RDBConfigStore) DeleteExpiredNotifications(ctx context.Context, now time.Time) (int64, error) {
	// Feed expiry must not erase a durable producer's replay receipt.
	result := s.DB().WithContext(ctx).
		Where("expires_at <= ? AND retain_for_replay = ?", now, false).
		Delete(&tables.TableNotification{})
	return result.RowsAffected, result.Error
}

func migrationAddNotificationReplayRetention(ctx context.Context, db *gorm.DB, logger schemas.Logger) error {
	return RunSingleMigration(ctx, nil, db, logger, &migrator.Migration{
		ID: "add_notification_replay_retention",
		Migrate: func(tx *gorm.DB) error {
			return addColumnIfNotExists(tx.WithContext(ctx), logger, &tables.TableNotification{}, "RetainForReplay")
		},
		Rollback: func(*gorm.DB) error {
			return errors.New("notification replay retention is non-rollbackable: removing it loses durable deduplication")
		},
	})
}
