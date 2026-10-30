package configstore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
)

// RoutingPolicySnapshot includes the complete persisted policy, not client settings.
type RoutingPolicySnapshot struct {
	Rules         []tables.TableRoutingRule
	ChainMaxDepth int
}

// RoutingPolicyStartupState is the coherent policy view proven by one startup
// transaction. Managed callers must initialize runtime state from this snapshot
// instead of reading the live tables again after the transaction releases.
type RoutingPolicyStartupState struct {
	Managed bool
	Policy  *RoutingPolicySnapshot
}

// RoutingPolicyWriteGuard runs after the shared transaction lock. A nil depth
// denotes a rule mutation; otherwise it is the requested client-config depth.
// It must use tx exclusively, never another connection or external I/O.
type RoutingPolicyWriteGuard func(tx *gorm.DB, depth *int) error

func (s *RDBConfigStore) SetRoutingPolicyWriteGuard(guard RoutingPolicyWriteGuard) {
	if guard == nil {
		s.routingPolicyWriteGuard.Store(nil)
		return
	}
	s.routingPolicyWriteGuard.Store(&guard)
}

func (s *RDBConfigStore) checkRoutingPolicyWrite(tx *gorm.DB, depth *int) error {
	if guard := s.routingPolicyWriteGuard.Load(); guard != nil {
		return (*guard)(tx, depth)
	}
	return nil
}

func orderedRoutingRules(db *gorm.DB) *gorm.DB {
	return db.Preload("Targets", func(db *gorm.DB) *gorm.DB {
		return db.Order("CASE WHEN position IS NULL THEN 1 ELSE 0 END ASC").
			Order("position ASC").Order("weight DESC").
			Order("COALESCE(provider, '') ASC").Order("COALESCE(model, '') ASC").
			Order("COALESCE(key_id, '') ASC")
	}).Order("priority ASC, created_at DESC, id ASC")
}

// SnapshotRoutingPolicy requires a caller-owned transaction. Taking the shared
// lock before reading prevents a mixed rules/depth snapshot on PostgreSQL too.
func SnapshotRoutingPolicy(tx *gorm.DB) (*RoutingPolicySnapshot, error) {
	if err := LockRoutingPolicyWrite(tx); err != nil {
		return nil, err
	}
	var client tables.TableClientConfig
	if err := tx.Select("routing_chain_max_depth").First(&client).Error; err != nil {
		return nil, err
	}
	snapshot := &RoutingPolicySnapshot{ChainMaxDepth: client.RoutingChainMaxDepth}
	if err := orderedRoutingRules(tx).Find(&snapshot.Rules).Error; err != nil {
		return nil, err
	}
	return snapshot, nil
}

// ReplaceRoutingPolicy writes only policy-owned tables/columns. Errors must be
// propagated to roll back the caller's transaction; this function never commits.
// Ordinary CRUD guards are deliberately not bypassed through a context flag.
func ReplaceRoutingPolicy(tx *gorm.DB, policy RoutingPolicySnapshot) error {
	if err := LockRoutingPolicyWrite(tx); err != nil {
		return err
	}
	if err := validateRoutingPolicy(policy); err != nil {
		return err
	}
	var client tables.TableClientConfig
	if err := tx.Select("id").First(&client).Error; err != nil {
		// Client defaults belong to the transport's startup reconciliation.
		// Creating a zero-valued row here would bypass those defaults.
		return fmt.Errorf("routing policy requires initialized client config: %w", err)
	}
	for _, model := range []any{&tables.TableRoutingTarget{}, &tables.TableRoutingRule{}} {
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(model).Error; err != nil {
			return err
		}
	}
	for _, source := range policy.Rules {
		rule := source
		if err := tx.Omit("Targets").Create(&rule).Error; err != nil {
			return err
		}
		for _, target := range source.Targets {
			// Map insertion preserves explicit zero weights instead of applying
			// GORM's default:1 to a zero-valued struct field.
			if err := tx.Model(&tables.TableRoutingTarget{}).Create(map[string]any{
				"rule_id": rule.ID, "provider": target.Provider, "model": target.Model,
				"key_id": target.KeyID, "position": target.Position, "weight": target.Weight,
				"ttft_timeout_ms": target.TTFTTimeoutMs,
			}).Error; err != nil {
				return err
			}
		}
	}
	return tx.Model(&tables.TableClientConfig{}).Where("id = ?", client.ID).
		UpdateColumn("routing_chain_max_depth", policy.ChainMaxDepth).Error
}

func validateRoutingPolicy(policy RoutingPolicySnapshot) error {
	if policy.ChainMaxDepth <= 0 {
		return errors.New("routing chain depth must be positive")
	}
	ids, names, priorities := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, rule := range policy.Rules {
		scope := rule.Scope
		if rule.ScopeID != nil {
			scope += "\x00" + *rule.ScopeID
		}
		name, priority := scope+"\x00"+rule.Name, fmt.Sprintf("%s\x00%d", scope, rule.Priority)
		if rule.ID == "" || ids[rule.ID] || names[name] || priorities[priority] {
			return errors.New("routing policy requires distinct IDs, scoped names and priorities")
		}
		if rule.Scope != "" && rule.Scope != "global" && (rule.ScopeID == nil || strings.TrimSpace(*rule.ScopeID) == "") {
			return errors.New("routing policy requires nonempty scoped IDs")
		}
		if err := validateRoutingTargetPositions(rule.Targets); err != nil {
			return err
		}
		ids[rule.ID], names[name], priorities[priority] = true, true, true
	}
	return nil
}

// RoutingPolicyFingerprint covers every routing field and target order, but not
// file-sync hashes or timestamps. Scoped priority uniqueness makes timestamp
// tie-breaking irrelevant. It is computed on management/startup paths only.
func RoutingPolicyFingerprint(policy RoutingPolicySnapshot) (string, error) {
	type fingerprintRule struct {
		Rule      tables.TableRoutingRule `json:"rule"`
		Positions []*int                  `json:"positions"`
	}
	ordered := slices.Clone(policy.Rules)
	slices.SortFunc(ordered, func(a, b tables.TableRoutingRule) int { return strings.Compare(a.ID, b.ID) })
	canonical := make([]fingerprintRule, 0, len(ordered))
	for _, source := range ordered {
		rule := source
		rule.ConfigHash, rule.CreatedAt, rule.UpdatedAt = "", time.Time{}, time.Time{}
		enabled := rule.EnabledValue()
		rule.Enabled = &enabled
		positions := make([]*int, 0, len(rule.Targets))
		for _, target := range rule.Targets {
			positions = append(positions, target.Position)
		}
		canonical = append(canonical, fingerprintRule{Rule: rule, Positions: positions})
	}
	payload, err := json.Marshal(struct {
		Rules []fingerprintRule `json:"rules"`
		Depth int               `json:"depth"`
	}{canonical, policy.ChainMaxDepth})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}
