package controlplane

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const budgetAcknowledgementTable = "elygate_control_budget_acknowledgements"
const budgetAcknowledgementActor = "local-admin"

type budgetAcknowledgement struct {
	AlertID        string `gorm:"primaryKey"`
	AcknowledgedAt time.Time
	AcknowledgedBy string
}

func (budgetAcknowledgement) TableName() string { return budgetAcknowledgementTable }

type BudgetAlertView struct {
	BudgetAlert
	Acknowledged   bool       `gorm:"-" json:"acknowledged"`
	AcknowledgedAt *time.Time `json:"acknowledged_at"`
	AcknowledgedBy *string    `json:"acknowledged_by"`
}

type budgetAcknowledgementMutation struct {
	AlertID      string
	Acknowledged bool
}

func (view *BudgetAlertView) normalizeAcknowledgement() {
	view.Acknowledged = view.AcknowledgedAt != nil
	if view.AcknowledgedAt != nil {
		utc := view.AcknowledgedAt.UTC()
		view.AcknowledgedAt = &utc
	}
}

func migrateBudgetAcknowledgements(tx *gorm.DB) error {
	timestampType := "timestamp"
	if tx.Dialector.Name() == "postgres" {
		timestampType = "timestamptz"
	}
	return tx.Exec(`CREATE TABLE IF NOT EXISTS elygate_control_budget_acknowledgements (
		alert_id varchar(36) NOT NULL PRIMARY KEY REFERENCES elygate_control_budget_alerts(id) ON DELETE CASCADE,
		acknowledged_at ` + timestampType + ` NOT NULL,
		acknowledged_by varchar(64) NOT NULL
	)`).Error
}

func (s *Store) SetBudgetAcknowledgement(ctx context.Context, mutation budgetAcknowledgementMutation) (*BudgetAlertView, error) {
	var view BudgetAlertView
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		alert, err := lockBudgetAcknowledgementAlert(tx, mutation.AlertID)
		if err != nil {
			return err
		}
		view.BudgetAlert = *alert
		if !mutation.Acknowledged {
			return deleteBudgetAcknowledgement(tx, alert.ID)
		}
		ack := budgetAcknowledgement{AlertID: alert.ID, AcknowledgedAt: time.Now().UTC().Truncate(time.Microsecond), AcknowledgedBy: budgetAcknowledgementActor}
		if err := insertBudgetAcknowledgement(tx, &ack); err != nil {
			return err
		}
		view.AcknowledgedAt, view.AcknowledgedBy = &ack.AcknowledgedAt, &ack.AcknowledgedBy
		return nil
	})
	view.normalizeAcknowledgement()
	return &view, err
}

func lockBudgetAcknowledgementAlert(tx *gorm.DB, id string) (*BudgetAlert, error) {
	// Acquire the SQLite write lock before a snapshot; PostgreSQL serializes
	// independent processes on the same immutable alert row.
	locked := tx.Model(&BudgetAlert{}).Where("id = ?", id).UpdateColumn("id", gorm.Expr("id"))
	if locked.Error != nil {
		return nil, locked.Error
	}
	if locked.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	var alert BudgetAlert
	err := tx.First(&alert, "id = ?", id).Error
	return &alert, err
}

func insertBudgetAcknowledgement(tx *gorm.DB, ack *budgetAcknowledgement) error {
	inserted := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(ack)
	if inserted.Error != nil {
		return inserted.Error
	}
	if inserted.RowsAffected == 0 {
		return tx.First(ack, "alert_id = ?", ack.AlertID).Error
	}
	return appendAuditTx(tx, budgetAcknowledgementActor, "budget-alert.acknowledge", "budget-alert", ack.AlertID)
}

func deleteBudgetAcknowledgement(tx *gorm.DB, id string) error {
	deleted := tx.Where("alert_id = ?", id).Delete(&budgetAcknowledgement{})
	if deleted.Error != nil || deleted.RowsAffected == 0 {
		return deleted.Error
	}
	return appendAuditTx(tx, budgetAcknowledgementActor, "budget-alert.unacknowledge", "budget-alert", id)
}

func budgetAcknowledgementRollback(*gorm.DB) error {
	return errors.New("budget acknowledgements are non-rollbackable: dropping them loses administrator actions; older binaries ignore this additive table")
}
