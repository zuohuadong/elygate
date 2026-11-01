package controlplane

import (
	"context"
	"errors"
	"math"
	"strings"
	"sync/atomic"
	"time"

	"github.com/maximhq/bifrost/framework/configstore"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	// DefaultRoutingRuntimeFenceTTL bounds how long a crashed instance can
	// retain ownership before a replacement instance may take over.
	DefaultRoutingRuntimeFenceTTL = 30 * time.Second
	routingRuntimeFenceRowID      = 1
)

var (
	ErrRoutingRuntimeFenceOwned   = errors.New("routing runtime fence is owned by another instance")
	ErrRoutingRuntimeFenceLost    = errors.New("routing runtime fence was lost")
	ErrRoutingRuntimeFenceRequest = errors.New("invalid routing runtime fence request")
)

// RoutingRuntimeFence is the durable singleton that identifies the process
// currently allowed to publish a serving routing generation. Token changes on
// every takeover, so an old process cannot validate a stale publication.
//
// Expiry is only a crash-recovery escape hatch. A live process renews it and
// closes admission when renewal or validation fails; deployments that require
// strict stop-before-start should still stop the old process before takeover.
type RoutingRuntimeFence struct {
	ID         int        `gorm:"primaryKey;autoIncrement:false;check:chk_routing_runtime_fence_singleton,id = 1" json:"-"`
	Token      int64      `gorm:"not null" json:"token"`
	OwnerID    string     `gorm:"type:varchar(128);not null" json:"owner_id"`
	State      string     `gorm:"type:varchar(16);not null" json:"state"`
	AcquiredAt *time.Time `json:"acquired_at,omitempty"`
	ExpiresAt  *time.Time `gorm:"index" json:"expires_at,omitempty"`
	UpdatedAt  time.Time  `gorm:"not null" json:"updated_at"`
}

func (RoutingRuntimeFence) TableName() string {
	return "elygate_control_routing_runtime_fence"
}

// RoutingRuntimeFenceToken is the immutable credential passed through a
// publication attempt. It is intentionally separate from the mutable lease.
type RoutingRuntimeFenceToken struct {
	OwnerID string
	Token   int64
}

// RoutingRuntimeFenceLease renews one durable fence and reports loss without
// allowing callers to keep using the old token.
type RoutingRuntimeFenceLease struct {
	store   *Store
	ownerID string
	token   int64
	ttl     time.Duration
	valid   atomic.Bool
}

func migrateRoutingRuntimeFence(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&RoutingRuntimeFence{}); err != nil {
		return err
	}
	return tx.Where("id = ?", routingRuntimeFenceRowID).
		Attrs(RoutingRuntimeFence{ID: routingRuntimeFenceRowID, State: "released"}).
		FirstOrCreate(&RoutingRuntimeFence{ID: routingRuntimeFenceRowID}).Error
}

func routingRuntimeFenceRollback(*gorm.DB) error {
	return errors.New("routing runtime fencing is non-rollbackable: dropping it can let a stale process publish")
}

// Token returns the lease's immutable publication credential.
func (lease *RoutingRuntimeFenceLease) Token() RoutingRuntimeFenceToken {
	if lease == nil {
		return RoutingRuntimeFenceToken{}
	}
	return RoutingRuntimeFenceToken{OwnerID: lease.ownerID, Token: lease.token}
}

// Valid reports the local fast-path state. Publication paths must still call
// Validate for a durable database check.
func (lease *RoutingRuntimeFenceLease) Valid() bool {
	return lease != nil && lease.valid.Load()
}

// MarkLost lets a caller that observed a failed durable validation invalidate
// the local fast path immediately.
func (lease *RoutingRuntimeFenceLease) MarkLost() {
	if lease != nil {
		lease.valid.Store(false)
	}
}

func validateRoutingRuntimeFenceRequest(ownerID string, ttl time.Duration) error {
	if strings.TrimSpace(ownerID) == "" || len(ownerID) > 128 || ttl <= 0 {
		return ErrRoutingRuntimeFenceRequest
	}
	return nil
}

// AcquireRoutingRuntimeFence claims the singleton for ownerID. An unexpired
// owner blocks a second process; an expired owner can be taken over with a new
// monotonically increasing token.
func (s *Store) AcquireRoutingRuntimeFence(ctx context.Context, ownerID string, ttl time.Duration) (*RoutingRuntimeFenceLease, error) {
	if s == nil || s.configStore == nil {
		return nil, ErrRoutingRuntimeFenceRequest
	}
	if err := validateRoutingRuntimeFenceRequest(ownerID, ttl); err != nil {
		return nil, err
	}
	var lease *RoutingRuntimeFenceLease
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := configstore.LockRoutingPolicyWrite(tx); err != nil {
			return err
		}
		row, err := lockRoutingRuntimeFence(tx)
		if err != nil {
			return err
		}
		now := time.Now().UTC().Truncate(time.Microsecond)
		if row.State == "active" && row.ExpiresAt != nil && row.ExpiresAt.After(now) {
			return ErrRoutingRuntimeFenceOwned
		}
		if row.State == "active" && row.ExpiresAt == nil {
			return ErrRoutingRuntimeFenceOwned
		}
		if row.Token == math.MaxInt64 {
			return ErrRoutingRuntimeFenceRequest
		}
		expires := now.Add(ttl)
		changed := tx.Model(&RoutingRuntimeFence{}).Where("id = ?", routingRuntimeFenceRowID).
			Updates(map[string]any{
				"token": row.Token + 1, "owner_id": ownerID, "state": "active",
				"acquired_at": now, "expires_at": expires, "updated_at": now,
			})
		if changed.Error != nil {
			return changed.Error
		}
		if changed.RowsAffected != 1 {
			return ErrRoutingRuntimeFenceLost
		}
		lease = &RoutingRuntimeFenceLease{store: s, ownerID: ownerID, token: row.Token + 1, ttl: ttl}
		lease.valid.Store(true)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return lease, nil
}

// ValidateRoutingRuntimeFence checks the owner and token against durable
// state. It is deliberately separate from Valid so every publication phase
// can revalidate after an admission or database boundary.
func (s *Store) ValidateRoutingRuntimeFence(ctx context.Context, token RoutingRuntimeFenceToken) error {
	if s == nil || s.configStore == nil || validateRoutingRuntimeFenceRequest(token.OwnerID, time.Nanosecond) != nil || token.Token <= 0 {
		return ErrRoutingRuntimeFenceRequest
	}
	var row RoutingRuntimeFence
	if err := s.db(ctx).Where("id = ?", routingRuntimeFenceRowID).Take(&row).Error; err != nil {
		return err
	}
	now := time.Now().UTC()
	if row.State != "active" || row.OwnerID != token.OwnerID || row.Token != token.Token ||
		row.ExpiresAt == nil || !row.ExpiresAt.After(now) {
		return ErrRoutingRuntimeFenceLost
	}
	return nil
}

func validateRoutingRuntimeFenceTx(tx *gorm.DB, token RoutingRuntimeFenceToken) error {
	if token.Token <= 0 || strings.TrimSpace(token.OwnerID) == "" {
		return ErrRoutingRuntimeFenceRequest
	}
	var row RoutingRuntimeFence
	if err := tx.Where("id = ?", routingRuntimeFenceRowID).Take(&row).Error; err != nil {
		return err
	}
	now := time.Now().UTC()
	if row.State != "active" || row.OwnerID != token.OwnerID || row.Token != token.Token ||
		row.ExpiresAt == nil || !row.ExpiresAt.After(now) {
		return ErrRoutingRuntimeFenceLost
	}
	return nil
}

// RenewRoutingRuntimeFence extends the lease only if its exact token remains
// active. A zero-row update is definitive proof that another instance owns it.
func (s *Store) RenewRoutingRuntimeFence(ctx context.Context, token RoutingRuntimeFenceToken, ttl time.Duration) error {
	if s == nil || s.configStore == nil || validateRoutingRuntimeFenceRequest(token.OwnerID, ttl) != nil || token.Token <= 0 {
		return ErrRoutingRuntimeFenceRequest
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	expires := now.Add(ttl)
	changed := s.db(ctx).Model(&RoutingRuntimeFence{}).
		Where("id = ? AND state = ? AND owner_id = ? AND token = ? AND expires_at > ?",
			routingRuntimeFenceRowID, "active", token.OwnerID, token.Token, now).
		Updates(map[string]any{"expires_at": expires, "updated_at": now})
	if changed.Error != nil {
		return changed.Error
	}
	if changed.RowsAffected != 1 {
		return ErrRoutingRuntimeFenceLost
	}
	return nil
}

// ReleaseRoutingRuntimeFence releases only this exact owner/token. A lost
// lease is already fenced and is treated as a successful shutdown.
func (s *Store) ReleaseRoutingRuntimeFence(ctx context.Context, token RoutingRuntimeFenceToken) error {
	if s == nil || s.configStore == nil || token.Token <= 0 || strings.TrimSpace(token.OwnerID) == "" {
		return ErrRoutingRuntimeFenceRequest
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	changed := s.db(ctx).Model(&RoutingRuntimeFence{}).
		Where("id = ? AND state = ? AND owner_id = ? AND token = ?",
			routingRuntimeFenceRowID, "active", token.OwnerID, token.Token).
		Updates(map[string]any{
			"state": "released", "owner_id": "", "expires_at": nil, "updated_at": now,
		})
	if changed.Error != nil {
		return changed.Error
	}
	return nil
}

// StartRenewal renews the lease until stop is called, context cancellation
// occurs, or durable ownership is lost. The callback must fail closed.
func (lease *RoutingRuntimeFenceLease) StartRenewal(ctx context.Context, onLost func()) (stop func()) {
	if lease == nil || lease.store == nil {
		return func() {}
	}
	if ctx == nil {
		ctx = context.Background()
	}
	stopCh := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(maxRoutingFenceRenewInterval(lease.ttl))
		defer ticker.Stop()
		for {
			select {
			case <-stopCh:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			if err := lease.store.RenewRoutingRuntimeFence(context.WithoutCancel(ctx), lease.Token(), lease.ttl); err != nil {
				lease.valid.Store(false)
				if onLost != nil {
					onLost()
				}
				return
			}
		}
	}()
	var stopped atomic.Bool
	return func() {
		if stopped.CompareAndSwap(false, true) {
			close(stopCh)
			<-done
			_ = lease.store.ReleaseRoutingRuntimeFence(context.Background(), lease.Token())
			lease.valid.Store(false)
		}
	}
}

func maxRoutingFenceRenewInterval(ttl time.Duration) time.Duration {
	interval := ttl / 3
	if interval < time.Millisecond {
		return time.Millisecond
	}
	return interval
}

func lockRoutingRuntimeFence(tx *gorm.DB) (*RoutingRuntimeFence, error) {
	if tx.Dialector.Name() == "sqlite" {
		if err := tx.Model(&RoutingRuntimeFence{}).Where("id = ?", routingRuntimeFenceRowID).
			UpdateColumn("token", gorm.Expr("token")).Error; err != nil {
			return nil, err
		}
	}
	var row RoutingRuntimeFence
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", routingRuntimeFenceRowID).Take(&row).Error
	return &row, err
}
