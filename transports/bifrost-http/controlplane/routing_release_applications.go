package controlplane

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore"
	"gorm.io/gorm"
)

// RoutingReleaseApplication is the durable receipt that proves a release was
// installed, not merely accepted. It is written in the same transaction as
// the live policy replacement and head acknowledgement.
type RoutingReleaseApplication struct {
	AttemptID         string    `gorm:"primaryKey;type:varchar(36)" json:"attempt_id"`
	Epoch             int64     `gorm:"not null;uniqueIndex" json:"epoch"`
	VersionID         string    `gorm:"type:varchar(36);not null" json:"version_id"`
	Fingerprint       string    `gorm:"type:varchar(64);not null" json:"fingerprint"`
	PolicyFingerprint string    `gorm:"type:varchar(64);not null" json:"policy_fingerprint"`
	RecordedAt        time.Time `gorm:"not null" json:"recorded_at"`
}

func (RoutingReleaseApplication) TableName() string {
	return "elygate_control_routing_release_applications"
}

func migrateRoutingReleaseApplications(tx *gorm.DB) error {
	// Schema alone cannot prove what an older process actually installed.
	// Missing application evidence must not be invented during migration.
	return tx.AutoMigrate(&RoutingReleaseAttempt{}, &RoutingReleaseApplication{})
}

func routingReleaseApplicationForEpoch(tx *gorm.DB, epoch int64) (*RoutingReleaseApplication, error) {
	var application RoutingReleaseApplication
	if err := tx.Where("epoch = ?", epoch).Take(&application).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRoutingReleaseNotApplied
		}
		return nil, err
	}
	var attempt RoutingReleaseAttempt
	if err := tx.Where("epoch = ?", epoch).Take(&attempt).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRoutingReleaseNotApplied
		}
		return nil, err
	}
	if application.AttemptID != attempt.ID || application.VersionID != attempt.VersionID ||
		application.Fingerprint != attempt.Fingerprint || application.RecordedAt.IsZero() {
		return nil, ErrRoutingReleaseNotApplied
	}
	return &application, nil
}

func routingReleaseAttemptForHead(tx *gorm.DB, head RoutingReleaseHead) (*RoutingReleaseAttempt, error) {
	var attempt RoutingReleaseAttempt
	if err := tx.Where("epoch = ?", head.Epoch).Take(&attempt).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRoutingPolicyNotReady
		}
		return nil, err
	}
	if attempt.VersionID != head.DesiredVersionID || attempt.Fingerprint != head.DesiredFingerprint ||
		attempt.Epoch <= 0 || attempt.ExpectedEpoch != attempt.Epoch-1 || uuid.Validate(attempt.ID) != nil {
		return nil, ErrRoutingPolicyNotReady
	}
	switch RoutingReleaseOperation(attempt.Operation) {
	case RoutingReleasePublish:
		if attempt.RollbackOfEpoch != 0 || attempt.RollbackOfAttempt != "" {
			return nil, ErrRoutingPolicyNotReady
		}
	case RoutingReleaseRollback:
		if attempt.RollbackOfEpoch <= 0 || attempt.RollbackOfEpoch >= attempt.ExpectedEpoch ||
			uuid.Validate(attempt.RollbackOfAttempt) != nil {
			return nil, ErrRoutingPolicyNotReady
		}
	default:
		return nil, ErrRoutingPolicyNotReady
	}
	return &attempt, nil
}

func checkRoutingReleaseApplication(tx *gorm.DB, head RoutingReleaseHead, policy configstore.RoutingPolicySnapshot) error {
	application, err := routingReleaseApplicationForEpoch(tx, head.Epoch)
	if err != nil {
		return err
	}
	if !head.IsApplied() || application.VersionID != head.AppliedVersionID ||
		application.Fingerprint != head.AppliedFingerprint {
		return ErrRoutingReleaseNotApplied
	}
	return compareRoutingApplicationPolicy(*application, policy)
}

func compareRoutingApplicationPolicy(application RoutingReleaseApplication, policy configstore.RoutingPolicySnapshot) error {
	fingerprint, err := configstore.RoutingPolicyFingerprint(policy)
	if err != nil {
		return err
	}
	if fingerprint != application.PolicyFingerprint {
		return ErrRoutingPolicyNotReady
	}
	return nil
}

func validateRoutingReleaseVersion(tx *gorm.DB, attempt RoutingReleaseAttempt) error {
	var version RoutingPolicyVersion
	if err := tx.Where("id = ?", attempt.VersionID).Take(&version).Error; err != nil {
		return err
	}
	hash, err := routingVersionContentHash(RoutingDraft{
		Name: version.Name, RulesJSON: version.RulesJSON, ChainMaxDepth: version.ChainMaxDepth,
	})
	if err != nil {
		return err
	}
	if hash != version.ContentSHA256 || hash != attempt.Fingerprint {
		return ErrRoutingPolicyNotReady
	}
	return nil
}
