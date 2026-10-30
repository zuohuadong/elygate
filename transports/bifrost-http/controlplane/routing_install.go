package controlplane

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

var (
	ErrRoutingPolicyNotReady                = errors.New("routing release is pending or live policy has drifted")
	ErrRoutingPolicyManaged                 = errors.New("routing rules and chain depth are owned by routing releases")
	ErrRoutingInstallationUncertain         = errors.New("routing release installation commit result is uncertain")
	ErrRoutingInstallationNestedTransaction = errors.New("routing release installation requires a root transaction")
)

// RoutingReleaseInstallation is the policy view proven by the
// installation transaction. Callers may use Policy for an in-memory swap only
// after InstallAcceptedRoutingRelease returns without an error. It does not
// establish current-process readiness or fence other processes. Nested rule
// pointers are read-only; runtime installation must pass Policy through
// rules.LocalStore.PreparePolicy, which owns the deep copy.
type RoutingReleaseInstallation struct {
	Head   RoutingReleaseHead
	Policy configstore.RoutingPolicySnapshot
}

// RoutingPolicyCompiler must compile only the supplied immutable version. It
// must not access another database connection or install a serving generation.
// Returned rules belong to the caller and must not be mutated by the compiler.
type RoutingPolicyCompiler func(context.Context, RoutingPolicyVersion) ([]*tables.TableRoutingRule, error)

// InstallAcceptedRoutingRelease is a durable installation primitive, not a live
// publication API. Call only before serving; a running process additionally
// needs a fenced runtime generation swap and fail-closed handling after commit.
func (s *Store) InstallAcceptedRoutingRelease(ctx context.Context, epoch int64, compile RoutingPolicyCompiler, actor string) (*RoutingReleaseInstallation, error) {
	if epoch <= 0 || compile == nil {
		return nil, ErrRoutingReleaseRequest
	}
	if s.tx != nil {
		return nil, ErrRoutingInstallationNestedTransaction
	}
	db := s.db(ctx)
	if _, nested := db.Statement.ConnPool.(gorm.TxCommitter); nested {
		return nil, ErrRoutingInstallationNestedTransaction
	}
	return installRoutingReleaseRootTransaction(db, epoch, compile, actor)
}

func installRoutingReleaseRootTransaction(db *gorm.DB, epoch int64, compile RoutingPolicyCompiler, actor string) (*RoutingReleaseInstallation, error) {
	tx := db.Begin()
	if tx.Error != nil {
		return nil, tx.Error
	}
	workCompleted := false
	defer func() {
		if !workCompleted {
			_ = rollbackRoutingInstallationTransaction(tx)
		}
	}()
	installation, callbackErr := installRoutingReleaseTx(tx, epoch, compile, actor)
	workCompleted = true
	if callbackErr != nil {
		if rollbackErr := rollbackRoutingInstallationTransaction(tx); rollbackErr != nil {
			return nil, errors.Join(
				ErrRoutingInstallationUncertain,
				fmt.Errorf("callback failed: %w", callbackErr),
				fmt.Errorf("rollback failed: %w", rollbackErr),
			)
		}
		return nil, callbackErr
	}
	if commitErr := tx.Commit().Error; commitErr != nil {
		// Commit errors do not prove that the database rejected the write.
		// Never expose the candidate policy to a serving runtime.
		return nil, errors.Join(ErrRoutingInstallationUncertain, commitErr)
	}
	return installation, nil
}

func rollbackRoutingInstallationTransaction(tx *gorm.DB) error {
	committer, ok := tx.Statement.ConnPool.(gorm.TxCommitter)
	if !ok {
		return errors.New("routing release transaction cannot roll back")
	}
	err := committer.Rollback()
	// Before any commit attempt, database/sql may already have rolled back a
	// canceled transaction. ErrTxDone here is not an ambiguous commit receipt.
	if errors.Is(err, sql.ErrTxDone) && tx.Statement.Context.Err() != nil {
		return nil
	}
	return err
}

func installRoutingReleaseTx(tx *gorm.DB, epoch int64, compile RoutingPolicyCompiler, actor string) (*RoutingReleaseInstallation, error) {
	if err := configstore.LockRoutingPolicyWrite(tx); err != nil {
		return nil, err
	}
	head, err := lockRoutingReleaseHead(tx)
	if err != nil {
		return nil, err
	}
	if head.Epoch != epoch {
		return nil, ErrRoutingReleaseConflict
	}
	policy, err := desiredRoutingPolicy(tx.Statement.Context, tx, head, compile)
	if err != nil {
		return nil, err
	}
	if head.IsApplied() {
		if err := checkRoutingReleaseApplication(tx, *head, *policy); err != nil {
			return nil, err
		}
		if err := compareLiveRoutingPolicy(tx, *policy); err != nil {
			return nil, err
		}
	} else if err := persistRoutingInstallation(tx, head, *policy, actor); err != nil {
		return nil, err
	}
	if err := tx.Statement.Context.Err(); err != nil {
		return nil, err
	}
	return &RoutingReleaseInstallation{Head: *head, Policy: *policy}, nil
}

func persistRoutingInstallation(tx *gorm.DB, head *RoutingReleaseHead, policy configstore.RoutingPolicySnapshot, actor string) error {
	if head.State != "pending" {
		return ErrRoutingPolicyNotReady
	}
	if err := configstore.ReplaceRoutingPolicy(tx, policy); err != nil {
		return err
	}
	if err := compareLiveRoutingPolicy(tx, policy); err != nil {
		return err
	}
	if err := acknowledgeRoutingInstallation(tx, head); err != nil {
		return err
	}
	attempt, err := routingReleaseAttemptForHead(tx, *head)
	if err != nil {
		return err
	}
	if err := recordRoutingReleaseApplication(tx, *attempt, policy); err != nil {
		return err
	}
	return appendAuditTx(tx, actor, "routing-release.apply", "routing-release", attempt.ID)
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

func recordRoutingReleaseApplication(tx *gorm.DB, attempt RoutingReleaseAttempt, policy configstore.RoutingPolicySnapshot) error {
	fingerprint, err := configstore.RoutingPolicyFingerprint(policy)
	if err != nil {
		return err
	}
	application := &RoutingReleaseApplication{
		AttemptID: attempt.ID, Epoch: attempt.Epoch, VersionID: attempt.VersionID,
		Fingerprint: attempt.Fingerprint, PolicyFingerprint: fingerprint,
		RecordedAt: time.Now().UTC().Truncate(time.Microsecond),
	}
	return tx.Create(application).Error
}

func desiredRoutingPolicy(ctx context.Context, tx *gorm.DB, head *RoutingReleaseHead, compile RoutingPolicyCompiler) (*configstore.RoutingPolicySnapshot, error) {
	attempt, err := routingReleaseAttemptForHead(tx, *head)
	if err != nil {
		return nil, err
	}
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
	if attempt.Operation == string(RoutingReleaseRollback) {
		if err := checkRollbackRoutingPolicy(tx, *attempt, *policy); err != nil {
			return nil, err
		}
	}
	return policy, ctx.Err()
}

func checkRollbackRoutingPolicy(tx *gorm.DB, attempt RoutingReleaseAttempt, policy configstore.RoutingPolicySnapshot) error {
	target, err := rollbackRoutingReleaseTarget(tx, attempt.RollbackOfEpoch)
	if err != nil {
		return err
	}
	if target.AttemptID != attempt.RollbackOfAttempt || target.VersionID != attempt.VersionID ||
		target.Fingerprint != attempt.Fingerprint {
		return ErrRoutingPolicyNotReady
	}
	return compareRoutingApplicationPolicy(*target, policy)
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
func CheckRoutingPolicyStartup(ctx context.Context, cs configstore.ConfigStore, compile RoutingPolicyCompiler) (configstore.RoutingPolicyStartupState, error) {
	if cs == nil {
		return configstore.RoutingPolicyStartupState{}, nil
	}
	if compile == nil {
		return configstore.RoutingPolicyStartupState{}, ErrRoutingReleaseRequest
	}
	store, err := NewStore(ctx, cs)
	if err != nil {
		return configstore.RoutingPolicyStartupState{}, err
	}
	state := configstore.RoutingPolicyStartupState{}
	err = cs.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		if err := configstore.LockRoutingPolicyWrite(tx); err != nil {
			return err
		}
		head, err := lockRoutingReleaseHead(tx)
		if err != nil {
			return err
		}
		state.Managed = head.Epoch > 0
		if !state.Managed {
			return nil
		}
		if !head.IsApplied() {
			return ErrRoutingPolicyNotReady
		}
		desired, err := desiredRoutingPolicy(ctx, tx, head, compile)
		if err != nil {
			return err
		}
		if err := checkRoutingReleaseApplication(tx, *head, *desired); err != nil {
			return err
		}
		if err := compareLiveRoutingPolicy(tx, *desired); err != nil {
			return err
		}
		state.Policy = desired
		return nil
	})
	if err != nil {
		return configstore.RoutingPolicyStartupState{}, err
	}
	setter, ok := cs.(interface {
		SetRoutingPolicyWriteGuard(configstore.RoutingPolicyWriteGuard)
	})
	if !ok {
		return configstore.RoutingPolicyStartupState{}, errors.New("config store does not support routing write protection")
	}
	setter.SetRoutingPolicyWriteGuard(store.guardRoutingPolicyWrite)
	return state, nil
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
