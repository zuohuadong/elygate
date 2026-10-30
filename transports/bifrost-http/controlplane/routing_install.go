package controlplane

import (
	"context"
	"errors"
	"fmt"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

var (
	ErrRoutingPolicyNotReady = errors.New("routing release is pending or live policy has drifted")
	ErrRoutingPolicyManaged  = errors.New("routing rules and chain depth are owned by routing releases")
)

// RoutingPolicyCompiler must compile only the supplied immutable version. It
// must not access another database connection or install a serving generation.
type RoutingPolicyCompiler func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error)

// InstallAcceptedRoutingRelease is a durable installation primitive, not a live
// publication API. Call only before serving; a running process additionally
// needs a fenced runtime generation swap and fail-closed handling after commit.
func (s *Store) InstallAcceptedRoutingRelease(ctx context.Context, epoch int64, compile RoutingPolicyCompiler, actor string) (*RoutingReleaseHead, error) {
	if epoch <= 0 || compile == nil {
		return nil, ErrRoutingReleaseRequest
	}
	var installed *RoutingReleaseHead
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := configstore.LockRoutingPolicyWrite(tx); err != nil {
			return err
		}
		head, err := lockRoutingReleaseHead(tx)
		if err != nil {
			return err
		}
		if head.Epoch != epoch {
			return ErrRoutingReleaseConflict
		}
		policy, err := desiredRoutingPolicy(ctx, tx, head, compile)
		if err != nil {
			return err
		}
		if head.IsApplied() {
			if err := compareLiveRoutingPolicy(tx, *policy); err != nil {
				return err
			}
			installed = head
			return nil
		}
		if head.State != "pending" {
			return ErrRoutingPolicyNotReady
		}
		if err := configstore.ReplaceRoutingPolicy(tx, *policy); err != nil {
			return err
		}
		if err := compareLiveRoutingPolicy(tx, *policy); err != nil {
			return err
		}
		if err := acknowledgeRoutingInstallation(tx, head); err != nil {
			return err
		}
		if err := appendAuditTx(tx, actor, "routing-release.apply", "routing-release", head.DesiredVersionID); err != nil {
			return err
		}
		installed = head
		return ctx.Err()
	})
	if err != nil {
		return nil, err
	}
	return installed, nil
}

func acknowledgeRoutingInstallation(tx *gorm.DB, head *RoutingReleaseHead) error {
	changed := tx.Model(&RoutingReleaseHead{}).
		Where("id = ? AND epoch = ? AND state = ?", 1, head.Epoch, "pending").
		Updates(map[string]any{
			"state": "applied", "applied_version_id": head.DesiredVersionID,
			"applied_fingerprint": head.DesiredFingerprint,
		})
	if changed.Error != nil {
		return changed.Error
	}
	if changed.RowsAffected != 1 {
		return ErrRoutingReleaseConflict
	}
	head.State, head.AppliedVersionID, head.AppliedFingerprint = "applied", head.DesiredVersionID, head.DesiredFingerprint
	return nil
}

func desiredRoutingPolicy(ctx context.Context, tx *gorm.DB, head *RoutingReleaseHead, compile RoutingPolicyCompiler) (*configstore.RoutingPolicySnapshot, error) {
	var version RoutingPolicyVersion
	if err := tx.Where("id = ?", head.DesiredVersionID).Take(&version).Error; err != nil {
		return nil, err
	}
	hash, err := routingVersionContentHash(RoutingDraft{
		Name: version.Name, RulesJSON: version.RulesJSON, ChainMaxDepth: version.ChainMaxDepth,
	})
	if err != nil {
		return nil, err
	}
	if hash != version.ContentSHA256 || hash != head.DesiredFingerprint {
		return nil, ErrRoutingPolicyNotReady
	}
	compiled, err := compile(ctx, version)
	if err != nil {
		return nil, err
	}
	policy := &configstore.RoutingPolicySnapshot{
		Rules: make([]tables.TableRoutingRule, 0, len(compiled)), ChainMaxDepth: version.ChainMaxDepth,
	}
	for _, rule := range compiled {
		if rule == nil {
			return nil, ErrRoutingReleaseRequest
		}
		if err := validateRoutingPolicyScope(tx, *rule); err != nil {
			return nil, err
		}
		policy.Rules = append(policy.Rules, *rule)
	}
	return policy, ctx.Err()
}

func compareLiveRoutingPolicy(tx *gorm.DB, desired configstore.RoutingPolicySnapshot) error {
	live, err := configstore.SnapshotRoutingPolicy(tx)
	if err != nil {
		return err
	}
	wanted, err := configstore.RoutingPolicyFingerprint(desired)
	if err != nil {
		return err
	}
	actual, err := configstore.RoutingPolicyFingerprint(*live)
	if err != nil {
		return err
	}
	if actual != wanted {
		return ErrRoutingPolicyNotReady
	}
	return nil
}

func validateRoutingPolicyScope(tx *gorm.DB, rule tables.TableRoutingRule) error {
	if rule.Scope == "global" && rule.ScopeID == nil {
		return nil
	}
	if rule.ScopeID == nil || *rule.ScopeID == "" {
		return ErrRoutingReleaseRequest
	}
	var model any
	switch rule.Scope {
	case "virtual_key":
		model = &tables.TableVirtualKey{}
	case "team":
		model = &tables.TableTeam{}
	case "customer":
		model = &tables.TableCustomer{}
	default:
		return fmt.Errorf("routing scope %q requires an installed scope validator", rule.Scope)
	}
	var count int64
	if err := tx.Model(model).Where("id = ?", *rule.ScopeID).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("routing scope %q does not resolve", rule.Scope)
	}
	return nil
}

// CheckRoutingPolicyStartup never installs or repairs. A pending or drifted
// policy fails before client/config reconciliation or plugin initialization.
func CheckRoutingPolicyStartup(ctx context.Context, cs configstore.ConfigStore, compile RoutingPolicyCompiler) (bool, error) {
	if cs == nil {
		return false, nil
	}
	if compile == nil {
		return false, ErrRoutingReleaseRequest
	}
	store, err := NewStore(ctx, cs)
	if err != nil {
		return false, err
	}
	var managed bool
	err = cs.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		if err := configstore.LockRoutingPolicyWrite(tx); err != nil {
			return err
		}
		head, err := lockRoutingReleaseHead(tx)
		if err != nil {
			return err
		}
		managed = head.Epoch > 0
		if !managed {
			return nil
		}
		if !head.IsApplied() {
			return ErrRoutingPolicyNotReady
		}
		desired, err := desiredRoutingPolicy(ctx, tx, head, compile)
		if err != nil {
			return err
		}
		return compareLiveRoutingPolicy(tx, *desired)
	})
	if err != nil {
		return false, err
	}
	setter, ok := cs.(interface {
		SetRoutingPolicyWriteGuard(configstore.RoutingPolicyWriteGuard)
	})
	if !ok {
		return false, errors.New("config store does not support routing write protection")
	}
	setter.SetRoutingPolicyWriteGuard(store.guardRoutingPolicyWrite)
	return managed, nil
}

func (s *Store) guardRoutingPolicyWrite(tx *gorm.DB, depth *int) error {
	var head RoutingReleaseHead
	if err := tx.Where("id = ?", 1).Take(&head).Error; err != nil {
		return err
	}
	if head.Epoch == 0 {
		return nil
	}
	if depth == nil {
		return ErrRoutingPolicyManaged
	}
	var client tables.TableClientConfig
	if err := tx.Select("routing_chain_max_depth").First(&client).Error; err != nil {
		return err
	}
	if *depth != client.RoutingChainMaxDepth {
		return ErrRoutingPolicyManaged
	}
	return nil
}
