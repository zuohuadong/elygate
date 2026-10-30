package rules

import (
	"context"
	"errors"
	"fmt"

	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
)

// ErrPolicyConflict means a prepared policy no longer has the current generation
// as its base. Callers must revalidate their publication preconditions before
// re-preparing; a conflict is not authorization to overwrite concurrent edits.
var ErrPolicyConflict = errors.New("routing policy generation changed")

var ErrPolicyAdmissionClosed = errors.New("routing policy admission is closed")
var ErrPolicyManaged = errors.New("routing policy is managed by complete releases")

// PreparedPolicy owns an unpublished complete policy. It is bound to one store
// and base generation; retaining it also retains that base until it is released.
type PreparedPolicy struct {
	owner *LocalStore
	base  *ruleGeneration
	next  *ruleGeneration
}

func (generation *ruleGeneration) ChainMaxDepth() int {
	return generation.chainMaxDepth
}

// UpdateChainMaxDepth publishes a depth-only generation without rebuilding rules
// or programs. Positive depth opts this store into snapshot-managed depth.
func (rs *LocalStore) UpdateChainMaxDepth(depth int) error {
	if depth <= 0 {
		return fmt.Errorf("chainMaxDepth must be greater than 0")
	}
	rs.writer.Lock()
	defer rs.writer.Unlock()
	if !rs.admissionOpen {
		return ErrPolicyAdmissionClosed
	}
	current := rs.current.Load()
	if current.chainMaxDepth == depth {
		return nil
	}
	if rs.policyManaged {
		return ErrPolicyManaged
	}
	next := *current
	next.chainMaxDepth = depth
	rs.current.Store(&next)
	return nil
}

// PreparePolicy clones and compiles a complete policy without changing live
// routing or holding the writer lock. Invalid CEL keeps the upstream skip behavior.
func (rs *LocalStore) PreparePolicy(ctx context.Context, rules []*configstoreTables.TableRoutingRule, depth int) (*PreparedPolicy, error) {
	if depth <= 0 {
		return nil, fmt.Errorf("chainMaxDepth must be greater than 0")
	}
	base := rs.current.Load()
	owned, err := cloneRoutingPolicy(ctx, rules)
	if err != nil {
		return nil, err
	}
	next := rs.buildGeneration(owned, base)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	next.chainMaxDepth = depth
	return &PreparedPolicy{owner: rs, base: base, next: next}, nil
}

// InstallPreparedPolicy swaps all rules, programs and depth once. It performs no
// database writes, durable acknowledgement or re-compilation.
func (rs *LocalStore) InstallPreparedPolicy(ctx context.Context, prepared *PreparedPolicy) error {
	if prepared == nil || prepared.owner != rs || prepared.next == nil {
		return fmt.Errorf("prepared routing policy does not belong to this store")
	}
	rs.writer.Lock()
	defer rs.writer.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if rs.current.Load() != prepared.base {
		return ErrPolicyConflict
	}
	rs.adHoc.Clear()
	rs.current.Store(prepared.next)
	return nil
}

func cloneRoutingPolicy(ctx context.Context, rules []*configstoreTables.TableRoutingRule) ([]*configstoreTables.TableRoutingRule, error) {
	owned := make([]*configstoreTables.TableRoutingRule, 0, len(rules))
	ids := make(map[string]struct{}, len(rules))
	for _, rule := range rules {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if rule == nil {
			return nil, fmt.Errorf("routing rule cannot be nil")
		}
		if _, duplicate := ids[rule.ID]; duplicate {
			return nil, fmt.Errorf("duplicate routing rule ID %q", rule.ID)
		}
		ids[rule.ID] = struct{}{}
		ownedRule, err := cloneRoutingRule(rule)
		if err != nil {
			return nil, err
		}
		owned = append(owned, ownedRule)
	}
	return owned, nil
}
