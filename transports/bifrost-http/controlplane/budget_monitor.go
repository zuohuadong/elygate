package controlplane

import (
	"context"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

// BudgetMonitor keeps control-plane state that gates spend current without a
// request having to trigger the work. Today that means sweeping expired
// application-key bindings; an expired binding must stop authorizing inference
// even if no one calls the revoke endpoint.
type BudgetMonitor struct {
	ctx      context.Context
	store    *Store
	logger   schemas.Logger
	interval time.Duration
	cancel   context.CancelFunc
	done     chan struct{}
}

// NewBudgetMonitor returns a monitor bound to the handler's store. A nil
// handler or store yields a monitor whose Start is a no-op, which keeps
// deployments without a control plane working.
func NewBudgetMonitor(ctx context.Context, handler *Handler, logger schemas.Logger) *BudgetMonitor {
	m := &BudgetMonitor{ctx: ctx, logger: logger, interval: time.Minute, done: make(chan struct{})}
	if handler != nil {
		m.store = handler.store
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
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := m.store.RevokeExpiredBindings(ctx); err != nil && m.logger != nil {
					m.logger.Warn("control-plane binding sweep failed: %v", err)
				}
			}
		}
	}()
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
