package controlplane

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const budgetRecalculationBatchSize = 64

type BudgetPolicyRevision struct {
	ID           uint64 `gorm:"primaryKey"`
	ScopeType    string `gorm:"type:varchar(16);not null;index:idx_cp_budget_revision,priority:1"`
	ScopeID      string `gorm:"type:varchar(36);not null;index:idx_cp_budget_revision,priority:2"`
	BudgetLimits `gorm:"embedded"`
	EffectiveAt  time.Time `gorm:"not null;index:idx_cp_budget_revision,priority:3"`
}

func (BudgetPolicyRevision) TableName() string { return "elygate_control_budget_policy_revisions" }

type BudgetPeriodRecalculation struct {
	ID          string    `gorm:"primaryKey;type:varchar(36)"`
	ScopeType   string    `gorm:"type:varchar(16);not null"`
	ScopeID     string    `gorm:"type:varchar(36);not null"`
	Window      string    `gorm:"type:varchar(16);not null"`
	PeriodStart time.Time `gorm:"not null"`
	PeriodEnd   time.Time `gorm:"not null;index"`
	UpdatedAt   time.Time `gorm:"not null"`
}

func (BudgetPeriodRecalculation) TableName() string { return "elygate_control_budget_recalculations" }

func createBudgetedResourceTx(tx *gorm.DB, resource any, scope budgetScope) error {
	if err := lockUsageProjection(tx); err != nil {
		return err
	}
	if err := tx.Create(resource).Error; err != nil {
		return err
	}
	if scope.Limits.DailyBudget == nil && scope.Limits.MonthlyBudget == nil {
		return nil
	}
	return appendBudgetPolicyRevision(tx, scope, time.Now().UTC())
}

func appendBudgetPolicyRevision(tx *gorm.DB, scope budgetScope, at time.Time) error {
	revision := BudgetPolicyRevision{ScopeType: scope.Type, ScopeID: scope.ID,
		BudgetLimits: scope.Limits, EffectiveAt: at.UTC().Truncate(time.Microsecond)}
	if err := tx.Create(&revision).Error; err != nil {
		return err
	}
	return queueBudgetPolicyPeriods(tx, scope.BudgetScope, at)
}

func seedBudgetPolicyHistory(tx *gorm.DB) error {
	if err := lockUsageProjection(tx); err != nil {
		return err
	}
	scopes, err := (&Store{tx: tx}).budgetScopes(tx.Statement.Context, UsageQuery{})
	if err != nil {
		return err
	}
	at := time.Now().UTC()
	for _, scope := range scopes {
		var count int64
		if err := tx.Model(&BudgetPolicyRevision{}).Where("scope_type = ? AND scope_id = ?", scope.Type, scope.ID).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			if err := appendBudgetPolicyRevision(tx, scope, at); err != nil {
				return err
			}
		}
	}
	return nil
}

func queueBudgetPolicyPeriods(tx *gorm.DB, scope BudgetScope, at time.Time) error {
	// Only presence matters here; period-end revision selection supplies the actual limit.
	var configured BudgetLimits
	if err := tx.Model(&BudgetPolicyRevision{}).
		Select("MAX(daily_budget) AS daily_budget, MAX(monthly_budget) AS monthly_budget").
		Where("scope_type = ? AND scope_id = ?", scope.Type, scope.ID).Scan(&configured).Error; err != nil {
		return err
	}
	for _, period := range budgetPeriods(budgetScope{BudgetScope: scope, Limits: configured}, at) {
		pending := BudgetPeriodRecalculation{
			ID:        uuid.NewSHA1(uuid.NameSpaceURL, []byte("elygate:budget-period:"+scope.Type+":"+scope.ID+":"+period.Window+":"+period.PeriodStart.Format(time.RFC3339))).String(),
			ScopeType: scope.Type, ScopeID: scope.ID, Window: period.Window,
			PeriodStart: period.PeriodStart, PeriodEnd: period.PeriodEnd, UpdatedAt: time.Now().UTC(),
		}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}},
			DoUpdates: clause.AssignmentColumns([]string{"updated_at"})}).Create(&pending).Error; err != nil {
			return err
		}
	}
	return nil
}

func queueUsageBudgetPeriods(tx *gorm.DB, entry UsageLedgerEntry) error {
	for _, scope := range []BudgetScope{{"project", entry.ProjectID}, {"application", entry.ApplicationID}} {
		if scope.ID == "" {
			continue
		}
		if err := queueBudgetPolicyPeriods(tx, scope, entry.OccurredAt); err != nil {
			return err
		}
	}
	return nil
}

func queueBudgetUsageCorrection(tx *gorm.DB, previous UsageLedgerEntry, occurredAt time.Time) error {
	if err := queueUsageBudgetPeriods(tx, previous); err != nil {
		return err
	}
	if !previous.OccurredAt.Equal(occurredAt) {
		previous.OccurredAt = occurredAt
		return queueUsageBudgetPeriods(tx, previous)
	}
	return nil
}

func deleteProcessingUsage(tx *gorm.DB) error {
	var processing []UsageLedgerEntry
	if err := tx.Select("project_id", "application_id", "occurred_at").Where("status = ?", "processing").Find(&processing).Error; err != nil {
		return err
	}
	for _, entry := range processing {
		if err := queueUsageBudgetPeriods(tx, entry); err != nil {
			return err
		}
	}
	return tx.Where("status = ?", "processing").Delete(&UsageLedgerEntry{}).Error
}

func (s *Store) hasBudgetPolicyHistory(ctx context.Context) (bool, error) {
	var count int64
	err := s.db(ctx).Model(&BudgetPolicyRevision{}).
		Where("daily_budget IS NOT NULL OR monthly_budget IS NOT NULL").Count(&count).Error
	return count > 0, err
}

func (s *Store) closedBudgetStatus(ctx context.Context, pending BudgetPeriodRecalculation) (*BudgetStatus, error) {
	var revision BudgetPolicyRevision
	err := s.db(ctx).Where("scope_type = ? AND scope_id = ? AND effective_at < ?",
		pending.ScopeType, pending.ScopeID, pending.PeriodEnd).
		Order("effective_at DESC, id DESC").First(&revision).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	scope := budgetScope{BudgetScope: BudgetScope{revision.ScopeType, revision.ScopeID}, Limits: revision.BudgetLimits}
	for _, status := range budgetPeriods(scope, pending.PeriodStart) {
		if status.Window == pending.Window {
			return &status, nil
		}
	}
	return nil, nil
}

func (s *Store) evaluateClosedBudgetPeriod(ctx context.Context, pending BudgetPeriodRecalculation, now time.Time) (int64, error) {
	status, err := s.closedBudgetStatus(ctx, pending)
	if err != nil || status == nil {
		return 0, err
	}
	filter := UsageQuery{StartTime: &status.PeriodStart, EndTime: &status.PeriodEnd}
	if status.ScopeType == "project" {
		filter.ProjectID = status.ScopeID
	} else {
		filter.ApplicationID = status.ScopeID
	}
	summary, err := s.SummarizeUsage(ctx, filter)
	if err != nil {
		return 0, err
	}
	status.Usage = summary.Cost
	return createBudgetAlerts(s.db(ctx), *status, now)
}

func (s *Store) evaluateClosedBudgetPeriods(ctx context.Context, now time.Time) (int64, error) {
	var pending []BudgetPeriodRecalculation
	if err := s.db(ctx).Where("period_end <= ?", now.UTC()).Order("period_end ASC, id ASC").
		Limit(budgetRecalculationBatchSize).Find(&pending).Error; err != nil {
		return 0, err
	}
	var created int64
	for _, period := range pending {
		count, err := s.evaluateClosedBudgetPeriod(ctx, period, now.UTC())
		if err != nil {
			return 0, err
		}
		if err := s.db(ctx).Delete(&period).Error; err != nil {
			return 0, err
		}
		created += count
	}
	return created, nil
}
