package controlplane

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"gorm.io/gorm"
)

const budgetNotificationBatchSize = 32

type BudgetNotificationPublisher func(context.Context, string, schemas.NotificationInput) (*schemas.Notification, error)

var errBudgetNotificationClaimLost = errors.New("budget notification claim is no longer owned")

func backfillBudgetNotifications(tx *gorm.DB) error {
	var alerts []BudgetAlert
	return tx.FindInBatches(&alerts, 100, func(batch *gorm.DB, _ int) error {
		for _, alert := range alerts {
			if err := enqueueBudgetNotification(batch, alert); err != nil {
				return err
			}
		}
		return nil
	}).Error
}

func (s *Store) dueBudgetNotifications(ctx context.Context, now time.Time) ([]BudgetNotificationOutbox, error) {
	var pending []BudgetNotificationOutbox
	err := s.db(ctx).Where("status = ? AND next_attempt_at <= ? AND (claimed_until IS NULL OR claimed_until <= ?)",
		BudgetNotificationPending, now.UTC(), now.UTC()).
		Order("next_attempt_at ASC, id ASC").Limit(budgetNotificationBatchSize).Find(&pending).Error
	return pending, err
}

func (s *Store) claimBudgetNotification(ctx context.Context, id string, now time.Time) (*BudgetNotificationOutbox, error) {
	token := uuid.NewString()
	until := now.UTC().Add(time.Minute).Truncate(time.Microsecond)
	claimed := s.db(ctx).Model(&BudgetNotificationOutbox{}).
		Where("id = ? AND status = ? AND next_attempt_at <= ? AND (claimed_until IS NULL OR claimed_until <= ?)",
			id, BudgetNotificationPending, now.UTC(), now.UTC()).
		Updates(map[string]any{"claimed_by": token, "claimed_until": until,
			"attempts": gorm.Expr("attempts + 1"), "updated_at": now.UTC()})
	if claimed.Error != nil || claimed.RowsAffected == 0 {
		return nil, claimed.Error
	}
	var delivery BudgetNotificationOutbox
	err := s.db(ctx).Where("id = ? AND claimed_by = ?", id, token).First(&delivery).Error
	return &delivery, err
}

func (s *Store) finishBudgetNotification(ctx context.Context, delivery *BudgetNotificationOutbox, publishErr error, now time.Time) error {
	update := map[string]any{"status": BudgetNotificationDelivered, "last_error": "",
		"claimed_by": "", "claimed_until": nil, "updated_at": now.UTC()}
	if publishErr != nil {
		update["status"] = BudgetNotificationPending
		update["last_error"] = "notification publishing failed"
		update["next_attempt_at"] = now.UTC().Add(budgetNotificationRetryDelay(delivery.Attempts))
	}
	finished := s.db(ctx).Model(&BudgetNotificationOutbox{}).
		Where("id = ? AND status = ? AND claimed_by = ?", delivery.ID, BudgetNotificationPending, delivery.ClaimedBy).
		Updates(update)
	if finished.Error != nil {
		return finished.Error
	}
	if finished.RowsAffected == 0 {
		return errBudgetNotificationClaimLost
	}
	return nil
}

func budgetNotificationRetryDelay(attempts int) time.Duration {
	return min(time.Hour, time.Minute*time.Duration(1<<min(max(attempts-1, 0), 6)))
}

func budgetNotificationInput(delivery BudgetNotificationOutbox) schemas.NotificationInput {
	severity := schemas.NotificationSeverityWarning
	if delivery.Threshold >= 1 {
		severity = schemas.NotificationSeverityError
	}
	return schemas.NotificationInput{
		Audience: schemas.NotificationAudienceAdmin, Severity: severity,
		Title: fmt.Sprintf("%s %s budget reached %.0f%%", delivery.ScopeType, delivery.Window, delivery.Threshold*100),
		Message: fmt.Sprintf("%s %s used USD %g of USD %g in the UTC %s period starting %s.",
			delivery.ScopeType, delivery.ScopeID, delivery.Usage, delivery.Limit, delivery.Window, delivery.PeriodStart.UTC().Format(time.DateOnly)),
		ActionLabel: "View budgets", ActionPath: "/#/control-plane-projects",
	}
}

func (m *BudgetMonitor) SetNotificationPublisher(publish BudgetNotificationPublisher) {
	m.publish = publish
}

func (m *BudgetMonitor) deliverBudgetNotifications(ctx context.Context) error {
	if m.publish == nil {
		return errors.New("budget notification publisher is unavailable")
	}
	pending, err := m.store.dueBudgetNotifications(ctx, time.Now().UTC())
	if err != nil {
		return err
	}
	var failures []error
	for _, delivery := range pending {
		if err := ctx.Err(); err != nil {
			return errors.Join(append(failures, err)...)
		}
		if err := m.deliverBudgetNotification(ctx, delivery.ID); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (m *BudgetMonitor) deliverBudgetNotification(ctx context.Context, id string) error {
	delivery, err := m.store.claimBudgetNotification(ctx, id, time.Now().UTC())
	if err != nil || delivery == nil {
		return err
	}
	attemptCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	notification, publishErr := m.publish(attemptCtx, delivery.ID, budgetNotificationInput(*delivery))
	cancel()
	if publishErr == nil && (notification == nil || notification.ID != delivery.ID) {
		publishErr = errors.New("budget notification publisher returned no matching receipt")
	}
	finishErr := m.store.finishBudgetNotification(ctx, delivery, publishErr, time.Now().UTC())
	return errors.Join(publishErr, finishErr)
}
