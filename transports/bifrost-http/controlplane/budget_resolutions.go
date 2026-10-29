package controlplane

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const budgetResolutionTable = "elygate_control_budget_resolutions"
const budgetResolutionActor = "local-admin"

type budgetResolution struct {
	AlertID    string `gorm:"primaryKey"`
	ResolvedAt time.Time
	ResolvedBy string
}

func (budgetResolution) TableName() string { return budgetResolutionTable }

type budgetResolutionMutation struct {
	AlertID  string
	Resolved bool
}

func migrateBudgetResolutions(tx *gorm.DB) error {
	timestampType := "timestamp"
	if tx.Dialector.Name() == "postgres" {
		timestampType = "timestamptz"
	}
	return tx.Exec(`CREATE TABLE IF NOT EXISTS elygate_control_budget_resolutions (
		alert_id varchar(36) NOT NULL PRIMARY KEY REFERENCES elygate_control_budget_alerts(id) ON DELETE CASCADE,
		resolved_at ` + timestampType + ` NOT NULL,
		resolved_by varchar(64) NOT NULL
	)`).Error
}

func (s *Store) SetBudgetResolution(ctx context.Context, mutation budgetResolutionMutation) (*BudgetAlertView, error) {
	var view BudgetAlertView
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockBudgetAlert(tx, mutation.AlertID); err != nil {
			return err
		}
		if mutation.Resolved {
			resolution := budgetResolution{AlertID: mutation.AlertID,
				ResolvedAt: time.Now().UTC().Truncate(time.Microsecond), ResolvedBy: budgetResolutionActor}
			if err := insertBudgetResolution(tx, &resolution); err != nil {
				return err
			}
		} else if err := deleteBudgetResolution(tx, mutation.AlertID); err != nil {
			return err
		}
		return budgetAlertViews(tx).Where("a.id = ?", mutation.AlertID).Take(&view).Error
	})
	view.normalizeState()
	return &view, err
}

func insertBudgetResolution(tx *gorm.DB, resolution *budgetResolution) error {
	inserted := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(resolution)
	if inserted.Error != nil || inserted.RowsAffected == 0 {
		return inserted.Error
	}
	return appendAuditTx(tx, budgetResolutionActor, "budget-alert.resolve", "budget-alert", resolution.AlertID)
}

func deleteBudgetResolution(tx *gorm.DB, id string) error {
	deleted := tx.Where("alert_id = ?", id).Delete(&budgetResolution{})
	if deleted.Error != nil || deleted.RowsAffected == 0 {
		return deleted.Error
	}
	return appendAuditTx(tx, budgetResolutionActor, "budget-alert.reopen", "budget-alert", id)
}

func budgetResolutionRollback(*gorm.DB) error {
	return errors.New("budget resolutions are non-rollbackable: dropping them loses administrator actions")
}
