package controlplane

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var ErrRoutingDraftConflict = errors.New("routing draft changed; reload before saving or deleting")

// RoutingDraft is an editable candidate, never an active routing configuration.
type RoutingDraft struct {
	ID            string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	Name          string    `gorm:"type:varchar(128);not null" json:"name"`
	Revision      int64     `gorm:"not null" json:"revision"`
	RulesJSON     string    `gorm:"type:text;not null" json:"-"`
	ChainMaxDepth int       `gorm:"not null" json:"chain_max_depth"`
	CreatedAt     time.Time `gorm:"not null;index" json:"created_at"`
	UpdatedAt     time.Time `gorm:"not null;index" json:"updated_at"`
}

func (RoutingDraft) TableName() string { return "elygate_control_routing_drafts" }

// RoutingDraftContent must be validated and compiled by the routing handler
// before entering storage; no simulation samples or credentials are persisted.
type RoutingDraftContent struct {
	Name          string
	RulesJSON     string
	ChainMaxDepth int
	ActorID       string
}

type RoutingDraftUpdate struct {
	Content          RoutingDraftContent
	ExpectedRevision int64
}

func migrateRoutingDrafts(tx *gorm.DB) error {
	return tx.AutoMigrate(&RoutingDraft{})
}

func routingDraftRollback(*gorm.DB) error {
	return errors.New("routing drafts are non-rollbackable: dropping them loses administrator candidates")
}

func (s *Store) CreateRoutingDraft(ctx context.Context, content RoutingDraftContent) (*RoutingDraft, error) {
	now := time.Now().UTC().Truncate(time.Microsecond)
	draft := &RoutingDraft{ID: uuid.NewString(), Name: content.Name, Revision: 1, RulesJSON: content.RulesJSON,
		ChainMaxDepth: content.ChainMaxDepth, CreatedAt: now, UpdatedAt: now}
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(draft).Error; err != nil {
			return err
		}
		return appendAuditTx(tx, content.ActorID, "routing-draft.create", "routing-draft", draft.ID)
	})
	return draft, err
}

func (s *Store) GetRoutingDraft(ctx context.Context, id string) (*RoutingDraft, error) {
	var draft RoutingDraft
	err := s.db(ctx).Where("id = ?", id).Take(&draft).Error
	return &draft, err
}

func (s *Store) ListRoutingDrafts(ctx context.Context, limit, offset int) ([]RoutingDraft, error) {
	drafts := make([]RoutingDraft, 0)
	err := s.db(ctx).Omit("rules_json").Order("updated_at DESC, id ASC").Limit(limit).Offset(offset).Find(&drafts).Error
	return drafts, err
}

func (s *Store) UpdateRoutingDraft(ctx context.Context, id string, update RoutingDraftUpdate) (*RoutingDraft, error) {
	var draft RoutingDraft
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		changed := tx.Model(&RoutingDraft{}).Where("id = ? AND revision = ?", id, update.ExpectedRevision).
			Updates(map[string]any{"name": update.Content.Name, "rules_json": update.Content.RulesJSON,
				"chain_max_depth": update.Content.ChainMaxDepth, "revision": gorm.Expr("revision + 1"),
				"updated_at": time.Now().UTC().Truncate(time.Microsecond)})
		if err := routingDraftMutationResult(tx, id, changed); err != nil {
			return err
		}
		if err := appendAuditTx(tx, update.Content.ActorID, "routing-draft.update", "routing-draft", id); err != nil {
			return err
		}
		return tx.Where("id = ?", id).Take(&draft).Error
	})
	return &draft, err
}

func (s *Store) DeleteRoutingDraft(ctx context.Context, id string, expectedRevision int64, actorID string) error {
	return s.db(ctx).Transaction(func(tx *gorm.DB) error {
		deleted := tx.Where("id = ? AND revision = ?", id, expectedRevision).Delete(&RoutingDraft{})
		if err := routingDraftMutationResult(tx, id, deleted); err != nil {
			return err
		}
		return appendAuditTx(tx, actorID, "routing-draft.delete", "routing-draft", id)
	})
}

func routingDraftMutationResult(tx *gorm.DB, id string, mutation *gorm.DB) error {
	if mutation.Error != nil {
		return mutation.Error
	}
	if mutation.RowsAffected == 1 {
		return nil
	}
	var draft RoutingDraft
	if err := tx.Select("id").Where("id = ?", id).Take(&draft).Error; err != nil {
		return err
	}
	return ErrRoutingDraftConflict
}
