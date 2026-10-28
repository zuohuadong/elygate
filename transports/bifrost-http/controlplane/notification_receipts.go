package controlplane

import (
	"context"
	"errors"
	"time"

	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const notificationReceiptTable = "elygate_control_notification_receipts"
const localAdminReceiptPrincipal = "local-admin"

type notificationReceipt struct {
	PrincipalID    string `gorm:"primaryKey"`
	NotificationID string `gorm:"primaryKey"`
	ReadAt         time.Time
	ExpiresAt      time.Time
}

func (notificationReceipt) TableName() string { return notificationReceiptTable }

type NotificationReadState struct {
	NotificationID string     `json:"notification_id"`
	Read           bool       `json:"read"`
	ReadAt         *time.Time `json:"read_at,omitempty"`
}

type notificationReadMutation struct {
	NotificationID string
	Read           bool
}

func migrateNotificationReceipts(tx *gorm.DB) error {
	timestampType := "timestamp"
	if tx.Dialector.Name() == "postgres" {
		timestampType = "timestamptz"
	}
	// Create only the owned table: AutoMigrate on a belongs-to association
	// would also migrate the upstream notifications schema.
	if err := tx.Exec(`CREATE TABLE IF NOT EXISTS elygate_control_notification_receipts (
		principal_id varchar(64) NOT NULL,
		notification_id varchar(36) NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
		read_at ` + timestampType + ` NOT NULL,
		expires_at ` + timestampType + ` NOT NULL,
		PRIMARY KEY (principal_id, notification_id)
	)`).Error; err != nil {
		return err
	}
	return tx.Exec("CREATE INDEX IF NOT EXISTS idx_cp_notification_receipt_expiry ON elygate_control_notification_receipts (expires_at)").Error
}

func (s *Store) NotificationReadStates(ctx context.Context, ids []string) ([]NotificationReadState, error) {
	var states []NotificationReadState
	err := s.db(ctx).Table("notifications AS n").
		Select("n.id AS notification_id, r.read_at").
		Joins("LEFT JOIN "+notificationReceiptTable+" AS r ON r.notification_id = n.id AND r.principal_id = ?", localAdminReceiptPrincipal).
		Where("n.id IN ? AND n.expires_at > ?", ids, time.Now().UTC()).Scan(&states).Error
	if err != nil {
		return nil, err
	}
	if len(states) != len(ids) {
		return nil, gorm.ErrRecordNotFound
	}
	byID := make(map[string]NotificationReadState, len(states))
	for _, state := range states {
		state.Read = state.ReadAt != nil
		byID[state.NotificationID] = state
	}
	for index, id := range ids {
		states[index] = byID[id]
	}
	return states, nil
}

func (s *Store) SetNotificationReadState(ctx context.Context, mutation notificationReadMutation) (*NotificationReadState, error) {
	var state NotificationReadState
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		notification, err := lockActiveReceiptNotification(tx, mutation.NotificationID)
		if err != nil {
			return err
		}
		state.NotificationID = notification.ID
		if !mutation.Read {
			return deleteNotificationReceipt(tx, notification.ID)
		}
		receipt := notificationReceipt{
			PrincipalID: localAdminReceiptPrincipal, NotificationID: notification.ID,
			ReadAt: time.Now().UTC(), ExpiresAt: notification.ExpiresAt,
		}
		if err := insertNotificationReceipt(tx, &receipt); err != nil {
			return err
		}
		state.Read, state.ReadAt = true, &receipt.ReadAt
		return nil
	})
	return &state, err
}

func lockActiveReceiptNotification(tx *gorm.DB, id string) (*configtables.TableNotification, error) {
	// Acquire a write lock before the snapshot on SQLite, and serialize receipt
	// changes/deletion on the notification row across PostgreSQL processes.
	locked := tx.Model(&configtables.TableNotification{}).Where("id = ? AND expires_at > ?", id, time.Now().UTC()).
		UpdateColumn("id", gorm.Expr("id"))
	if locked.Error != nil {
		return nil, locked.Error
	}
	if locked.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	var notification configtables.TableNotification
	err := tx.Where("id = ? AND expires_at > ?", id, time.Now().UTC()).First(&notification).Error
	return &notification, err
}

func insertNotificationReceipt(tx *gorm.DB, receipt *notificationReceipt) error {
	inserted := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(receipt)
	if inserted.Error != nil {
		return inserted.Error
	}
	if inserted.RowsAffected == 0 {
		return tx.First(receipt, "principal_id = ? AND notification_id = ?", receipt.PrincipalID, receipt.NotificationID).Error
	}
	return appendAuditTx(tx, receipt.PrincipalID, "notification.read", "notification", receipt.NotificationID)
}

func deleteNotificationReceipt(tx *gorm.DB, id string) error {
	deleted := tx.Where("principal_id = ? AND notification_id = ?", localAdminReceiptPrincipal, id).Delete(&notificationReceipt{})
	if deleted.Error != nil || deleted.RowsAffected == 0 {
		return deleted.Error
	}
	return appendAuditTx(tx, localAdminReceiptPrincipal, "notification.unread", "notification", id)
}

func (s *Store) pruneExpiredNotificationReceipts(ctx context.Context) error {
	return s.db(ctx).Where("expires_at <= ?", time.Now().UTC()).Delete(&notificationReceipt{}).Error
}

func notificationReceiptRollback(*gorm.DB) error {
	return errors.New("notification receipts are non-rollbackable: dropping them loses administrator read state; older binaries ignore this additive table")
}
