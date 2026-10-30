package controlplane

import (
	"context"
	"encoding/hex"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrRoutingReleaseRequest     = errors.New("invalid routing release request")
	ErrRoutingReleaseConflict    = errors.New("routing release head changed")
	ErrRoutingReleaseKeyConflict = errors.New("routing release idempotency key belongs to a different request")
	ErrRoutingReleaseNotApplied  = errors.New("routing release target was never durably applied")
)

type RoutingReleaseOperation string

const (
	RoutingReleasePublish  RoutingReleaseOperation = "publish"
	RoutingReleaseRollback RoutingReleaseOperation = "rollback"
)

// RoutingReleaseHead tracks intent independently of immutable versions and live
// upstream configuration. A pending intent must never be treated as activation.
type RoutingReleaseHead struct {
	ID                 int    `gorm:"primaryKey;autoIncrement:false;check:chk_routing_head_singleton,id = 1" json:"-"`
	Epoch              int64  `gorm:"not null" json:"epoch"`
	State              string `gorm:"type:varchar(16);not null" json:"state"`
	DesiredVersionID   string `gorm:"type:varchar(36);not null" json:"desired_version_id"`
	DesiredFingerprint string `gorm:"type:varchar(64);not null" json:"desired_fingerprint"`
	AppliedVersionID   string `gorm:"type:varchar(36);not null" json:"applied_version_id"`
	AppliedFingerprint string `gorm:"type:varchar(64);not null" json:"applied_fingerprint"`
}

func (RoutingReleaseHead) TableName() string { return "elygate_control_routing_release_head" }

// IsApplied reports only matching durable acknowledgements, not process-local
// readiness or freedom from upstream configuration drift.
func (head RoutingReleaseHead) IsApplied() bool {
	return head.Epoch > 0 && head.State == "applied" &&
		head.DesiredVersionID != "" && head.DesiredVersionID == head.AppliedVersionID &&
		head.DesiredFingerprint != "" && head.DesiredFingerprint == head.AppliedFingerprint
}

// RoutingReleaseAttempt is an immutable acceptance receipt. Replaying its key
// returns this receipt even if a subsequent intent has replaced the head.
type RoutingReleaseAttempt struct {
	ID                string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	IdempotencyKey    string    `gorm:"type:varchar(128);not null;uniqueIndex" json:"-"`
	Operation         string    `gorm:"type:varchar(16);not null;default:publish" json:"operation"`
	ExpectedEpoch     int64     `gorm:"not null" json:"expected_epoch"`
	Epoch             int64     `gorm:"not null;uniqueIndex" json:"epoch"`
	VersionID         string    `gorm:"type:varchar(36);not null" json:"version_id"`
	Fingerprint       string    `gorm:"type:varchar(64);not null" json:"fingerprint"`
	RollbackOfEpoch   int64     `gorm:"not null;default:0" json:"rollback_of_epoch,omitempty"`
	RollbackOfAttempt string    `gorm:"type:varchar(36);not null;default:''" json:"rollback_of_attempt_id,omitempty"`
	CreatedAt         time.Time `gorm:"not null" json:"created_at"`
}

func (RoutingReleaseAttempt) TableName() string { return "elygate_control_routing_release_attempts" }

type RoutingReleaseRequest struct {
	VersionID       string
	ExpectedEpoch   int64
	IdempotencyKey  string
	ActorID         string
	Operation       RoutingReleaseOperation
	RollbackOfEpoch int64
}

func (request RoutingReleaseRequest) operation() RoutingReleaseOperation {
	if request.Operation == "" {
		return RoutingReleasePublish
	}
	return request.Operation
}

func (request RoutingReleaseRequest) validate() error {
	if strings.TrimSpace(request.IdempotencyKey) == "" || len(request.IdempotencyKey) > 128 ||
		request.ExpectedEpoch < 0 || request.ExpectedEpoch == math.MaxInt64 {
		return ErrRoutingReleaseRequest
	}
	switch request.operation() {
	case RoutingReleasePublish:
		if uuid.Validate(request.VersionID) != nil || len(request.VersionID) != 36 || request.RollbackOfEpoch != 0 {
			return ErrRoutingReleaseRequest
		}
	case RoutingReleaseRollback:
		if request.VersionID != "" || request.ExpectedEpoch <= 0 ||
			request.RollbackOfEpoch <= 0 || request.RollbackOfEpoch >= request.ExpectedEpoch {
			return ErrRoutingReleaseRequest
		}
	default:
		return ErrRoutingReleaseRequest
	}
	return nil
}

func migrateRoutingReleases(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&RoutingReleaseHead{}, &RoutingReleaseAttempt{}); err != nil {
		return err
	}
	return tx.Where("id = ?", 1).Attrs(RoutingReleaseHead{State: "pending"}).
		FirstOrCreate(&RoutingReleaseHead{ID: 1}).Error
}

func routingReleaseRollback(*gorm.DB) error {
	return errors.New("routing releases are non-rollbackable: dropping them loses pending intent, application receipts and replay history")
}

func (s *Store) GetRoutingReleaseHead(ctx context.Context) (*RoutingReleaseHead, error) {
	var head RoutingReleaseHead
	err := s.db(ctx).Where("id = ?", 1).Take(&head).Error
	if err != nil {
		return nil, err
	}
	return &head, nil
}

// AcceptRoutingRelease does not install rules, change depth or acknowledge
// application. There is deliberately no HTTP entry point until installation
// and recovery can make those changes coherently.
func (s *Store) AcceptRoutingRelease(ctx context.Context, request RoutingReleaseRequest) (*RoutingReleaseAttempt, error) {
	if err := request.validate(); err != nil {
		return nil, err
	}
	var attempt *RoutingReleaseAttempt
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := configstore.LockRoutingPolicyWrite(tx); err != nil {
			return err
		}
		head, err := lockRoutingReleaseHead(tx)
		if err != nil {
			return err
		}
		attempt, err = acceptRoutingReleaseTx(tx, head, request)
		return err
	})
	if err != nil {
		return nil, err
	}
	attempt.CreatedAt = attempt.CreatedAt.UTC()
	return attempt, nil
}

func lockRoutingReleaseHead(tx *gorm.DB) (*RoutingReleaseHead, error) {
	// Reserve SQLite's writer before any reads; read-then-write can fail a
	// lock upgrade instead of serializing two simultaneous acceptances.
	if tx.Dialector.Name() == "sqlite" {
		if err := tx.Model(&RoutingReleaseHead{}).Where("id = ?", 1).
			UpdateColumn("epoch", gorm.Expr("epoch")).Error; err != nil {
			return nil, err
		}
	}
	var head RoutingReleaseHead
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", 1).Take(&head).Error
	return &head, err
}

func acceptRoutingReleaseTx(tx *gorm.DB, head *RoutingReleaseHead, request RoutingReleaseRequest) (*RoutingReleaseAttempt, error) {
	var prior RoutingReleaseAttempt
	if err := tx.Where("idempotency_key = ?", request.IdempotencyKey).Take(&prior).Error; err == nil {
		if prior.Operation != string(request.operation()) ||
			(request.operation() == RoutingReleasePublish && prior.VersionID != request.VersionID) ||
			prior.ExpectedEpoch != request.ExpectedEpoch ||
			prior.RollbackOfEpoch != request.RollbackOfEpoch {
			return nil, ErrRoutingReleaseKeyConflict
		}
		return &prior, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if head.Epoch != request.ExpectedEpoch {
		return nil, ErrRoutingReleaseConflict
	}
	if request.operation() == RoutingReleaseRollback {
		if !head.IsApplied() {
			return nil, ErrRoutingReleaseNotApplied
		}
		if _, err := routingReleaseAttemptForHead(tx, *head); err != nil {
			return nil, err
		}
		live, err := configstore.SnapshotRoutingPolicy(tx)
		if err != nil {
			return nil, err
		}
		if err := checkRoutingReleaseApplication(tx, *head, *live); err != nil {
			return nil, err
		}
	}
	attempt, err := newRoutingReleaseAttempt(tx, request)
	if err != nil {
		return nil, err
	}
	if err := persistRoutingReleaseIntent(tx, attempt); err != nil {
		return nil, err
	}
	action := "routing-release.accept"
	if attempt.Operation == string(RoutingReleaseRollback) {
		action = "routing-release.rollback"
	}
	return attempt, appendAuditTx(tx, request.ActorID, action, "routing-release", attempt.ID)
}

func newRoutingReleaseAttempt(tx *gorm.DB, request RoutingReleaseRequest) (*RoutingReleaseAttempt, error) {
	attempt := &RoutingReleaseAttempt{
		ID: uuid.NewString(), IdempotencyKey: request.IdempotencyKey,
		Operation: string(request.operation()), ExpectedEpoch: request.ExpectedEpoch,
		Epoch: request.ExpectedEpoch + 1, CreatedAt: time.Now().UTC().Truncate(time.Microsecond),
	}
	if request.operation() == RoutingReleaseRollback {
		target, err := rollbackRoutingReleaseTarget(tx, request.RollbackOfEpoch)
		if err != nil {
			return nil, err
		}
		attempt.VersionID, attempt.Fingerprint = target.VersionID, target.Fingerprint
		attempt.RollbackOfEpoch, attempt.RollbackOfAttempt = target.Epoch, target.AttemptID
		return attempt, nil
	}
	var version RoutingPolicyVersion
	if err := tx.Select("id", "content_sha256").Where("id = ?", request.VersionID).Take(&version).Error; err != nil {
		return nil, err
	}
	if fingerprint, err := hex.DecodeString(version.ContentSHA256); err != nil || len(fingerprint) != 32 {
		return nil, ErrRoutingReleaseRequest
	}
	attempt.VersionID, attempt.Fingerprint = version.ID, version.ContentSHA256
	return attempt, nil
}

func persistRoutingReleaseIntent(tx *gorm.DB, attempt *RoutingReleaseAttempt) error {
	if err := tx.Create(attempt).Error; err != nil {
		return err
	}
	changed := tx.Model(&RoutingReleaseHead{}).Where("id = ? AND epoch = ?", 1, attempt.ExpectedEpoch).
		Updates(map[string]any{
			"epoch": attempt.Epoch, "state": "pending",
			"desired_version_id": attempt.VersionID, "desired_fingerprint": attempt.Fingerprint,
			"applied_version_id": "", "applied_fingerprint": "",
		})
	if changed.Error != nil {
		return changed.Error
	}
	if changed.RowsAffected != 1 {
		return ErrRoutingReleaseConflict
	}
	return nil
}

func rollbackRoutingReleaseTarget(tx *gorm.DB, epoch int64) (*RoutingReleaseApplication, error) {
	application, err := routingReleaseApplicationForEpoch(tx, epoch)
	if err != nil {
		return nil, err
	}
	source, err := routingReleaseAttemptForHead(tx, RoutingReleaseHead{
		Epoch: epoch, DesiredVersionID: application.VersionID, DesiredFingerprint: application.Fingerprint,
	})
	if err != nil {
		return nil, err
	}
	if err := validateRoutingReleaseVersion(tx, *source); err != nil {
		return nil, err
	}
	return application, nil
}
