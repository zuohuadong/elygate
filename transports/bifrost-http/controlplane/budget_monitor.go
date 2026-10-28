package controlplane

import (
	"context"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

// BudgetMonitor refreshes usage and budget alerts without requiring panel reads.
// Expired bindings are swept independently even when the log store is unavailable.
type BudgetMonitor struct {
	ctx      context.Context
	store    *Store
	handler  *Handler
	logger   schemas.Logger
	interval time.Duration
	cancel   context.CancelFunc
	done     chan struct{}
	publish  BudgetNotificationPublisher
}

// NewBudgetMonitor returns a monitor bound to the handler's store. A nil
// handler or store yields a monitor whose Start is a no-op, which keeps
// deployments without a control plane working.
func NewBudgetMonitor(ctx context.Context, handler *Handler, logger schemas.Logger) *BudgetMonitor {
	m := &BudgetMonitor{ctx: ctx, logger: logger, interval: time.Minute, done: make(chan struct{})}
	if handler != nil {
		m.store = handler.store
		m.handler = handler
	}
	return m
}

// Start launches the sweep loop. It is safe to call once.
func (m *BudgetMonitor) Start() {
	if m == nil || m.store == nil {
		return
	}
	ctx, cancel := context.WithCancel(m.ctx)
	m.cancel = cancel
	go func() {
		defer close(m.done)
		ticker := time.NewTicker(m.interval)
		defer ticker.Stop()
		m.sweep(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.sweep(ctx)
			}
		}
	}()
}

func (m *BudgetMonitor) sweep(ctx context.Context) {
	receiptCtx, cancelReceipts := context.WithTimeout(ctx, 10*time.Second)
	if err := m.store.pruneExpiredNotificationReceipts(receiptCtx); err != nil && m.logger != nil {
		m.logger.Warn("control-plane notification receipt cleanup failed: %v", err)
	}
	cancelReceipts()
	opCtx, cancel := context.WithTimeout(ctx, time.Minute)
	if _, err := m.store.RevokeExpiredBindings(opCtx); err != nil && m.logger != nil {
		m.logger.Warn("control-plane binding sweep failed: %v", err)
	}
	if err := m.handler.refreshBudgetAlerts(opCtx); err != nil && m.logger != nil {
		m.logger.Warn("control-plane budget alert refresh failed: %v", err)
	}
	cancel()
	// An unavailable usage source must not starve already committed deliveries.
	deliveryCtx, cancelDelivery := context.WithTimeout(ctx, 30*time.Second)
	defer cancelDelivery()
	if err := m.deliverBudgetNotifications(deliveryCtx); err != nil && m.logger != nil {
		m.logger.Warn("control-plane budget notification delivery failed: %v", err)
	}
}

// Stop terminates the sweep loop and waits for it to exit.
func (m *BudgetMonitor) Stop() {
	if m == nil || m.cancel == nil {
		return
	}
	m.cancel()
	<-m.done
	m.cancel = nil
}
