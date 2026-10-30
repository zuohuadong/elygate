package controlplane

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RoutingPolicyVersion is an immutable snapshot of one saved draft revision.
// It is not active routing configuration until a future publish operation uses
// the snapshot explicitly.
type RoutingPolicyVersion struct {
	ID            string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	DraftID       string    `gorm:"type:varchar(36);not null;index:idx_routing_version_draft_revision,unique,priority:1" json:"draft_id"`
	DraftRevision int64     `gorm:"not null;index:idx_routing_version_draft_revision,unique,priority:2" json:"draft_revision"`
	Name          string    `gorm:"type:varchar(128);not null" json:"name"`
	RulesJSON     string    `gorm:"type:text;not null" json:"-"`
	ChainMaxDepth int       `gorm:"not null" json:"chain_max_depth"`
	ContentSHA256 string    `gorm:"type:char(64);not null;index" json:"content_sha256"`
	CreatedAt     time.Time `gorm:"not null;index" json:"created_at"`
}

func (RoutingPolicyVersion) TableName() string { return "elygate_control_routing_versions" }

type routingVersionSnapshot struct {
	Name          string          `json:"name"`
	Rules         json.RawMessage `json:"rules"`
	ChainMaxDepth int             `json:"chain_max_depth"`
}

func migrateRoutingPolicyVersions(tx *gorm.DB) error {
	return tx.AutoMigrate(&RoutingPolicyVersion{})
}

func routingPolicyVersionRollback(*gorm.DB) error {
	return errors.New("routing policy versions are non-rollbackable: dropping them loses immutable governance history")
}

func (s *Store) CreateRoutingPolicyVersion(ctx context.Context, draftID string, expectedRevision int64, actorID string) (*RoutingPolicyVersion, error) {
	var version RoutingPolicyVersion
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		// SQLite needs the writer reservation before reading, otherwise two
		// simultaneous seals can both read and then fail their lock upgrade.
		if tx.Dialector.Name() == "sqlite" {
			if err := tx.Model(&RoutingDraft{}).Where("id = ?", draftID).
				UpdateColumn("revision", gorm.Expr("revision")).Error; err != nil {
				return err
			}
		}
		var draft RoutingDraft
		draftErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", draftID).Take(&draft).Error
		// A retry refers to the original revision, even after its draft has
		// moved on or been deleted. It must not create another audit event.
		var existing RoutingPolicyVersion
		if err := tx.Where("draft_id = ? AND draft_revision = ?", draftID, expectedRevision).Take(&existing).Error; err == nil {
			version = existing
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if draftErr != nil {
			return draftErr
		}
		if draft.Revision != expectedRevision {
			return ErrRoutingDraftConflict
		}
		contentHash, err := routingVersionContentHash(draft)
		if err != nil {
			return err
		}
		version = RoutingPolicyVersion{
			ID: uuid.NewString(), DraftID: draft.ID, DraftRevision: draft.Revision,
			Name: draft.Name, RulesJSON: draft.RulesJSON, ChainMaxDepth: draft.ChainMaxDepth,
			ContentSHA256: contentHash, CreatedAt: time.Now().UTC().Truncate(time.Microsecond),
		}
		if err := tx.Create(&version).Error; err != nil {
			return err
		}
		return appendAuditTx(tx, actorID, "routing-version.create", "routing-version", version.ID)
	})
	version.CreatedAt = version.CreatedAt.UTC()
	return &version, err
}

func (s *Store) GetRoutingPolicyVersion(ctx context.Context, id string) (*RoutingPolicyVersion, error) {
	var version RoutingPolicyVersion
	err := s.db(ctx).Where("id = ?", id).Take(&version).Error
	version.CreatedAt = version.CreatedAt.UTC()
	return &version, err
}

func (s *Store) ListRoutingPolicyVersions(ctx context.Context, limit, offset int) ([]RoutingPolicyVersion, error) {
	versions := make([]RoutingPolicyVersion, 0)
	err := s.db(ctx).Omit("rules_json").Order("created_at DESC, id ASC").Limit(limit).Offset(offset).Find(&versions).Error
	for index := range versions {
		versions[index].CreatedAt = versions[index].CreatedAt.UTC()
	}
	return versions, err
}

func routingVersionContentHash(draft RoutingDraft) (string, error) {
	snapshot, err := json.Marshal(routingVersionSnapshot{
		Name: draft.Name, Rules: json.RawMessage(draft.RulesJSON), ChainMaxDepth: draft.ChainMaxDepth,
	})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(snapshot)
	return hex.EncodeToString(sum[:]), nil
}
