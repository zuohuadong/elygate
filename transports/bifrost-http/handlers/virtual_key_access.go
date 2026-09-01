package handlers

import "context"

// VirtualKeyAccessChecker applies deployment-specific access policy after a
// virtual key credential has been resolved to its stable database identity.
type VirtualKeyAccessChecker interface {
	CheckVirtualKeyAccess(ctx context.Context, virtualKeyID string) error
	CheckVirtualKeyValueAccess(ctx context.Context, virtualKeyValue string) error
}

type compositeVirtualKeyAccessChecker struct {
	checkers []VirtualKeyAccessChecker
}

// NewCompositeVirtualKeyAccessChecker combines independent access policies.
// Every checker must allow the key; the first denial or infrastructure error
// stops evaluation.
func NewCompositeVirtualKeyAccessChecker(checkers ...VirtualKeyAccessChecker) VirtualKeyAccessChecker {
	filtered := make([]VirtualKeyAccessChecker, 0, len(checkers))
	for _, checker := range checkers {
		if checker != nil {
			filtered = append(filtered, checker)
		}
	}
	if len(filtered) == 0 {
		return nil
	}
	return &compositeVirtualKeyAccessChecker{checkers: filtered}
}

func (c *compositeVirtualKeyAccessChecker) CheckVirtualKeyAccess(ctx context.Context, virtualKeyID string) error {
	for _, checker := range c.checkers {
		if err := checker.CheckVirtualKeyAccess(ctx, virtualKeyID); err != nil {
			return err
		}
	}
	return nil
}

func (c *compositeVirtualKeyAccessChecker) CheckVirtualKeyValueAccess(ctx context.Context, virtualKeyValue string) error {
	for _, checker := range c.checkers {
		if err := checker.CheckVirtualKeyValueAccess(ctx, virtualKeyValue); err != nil {
			return err
		}
	}
	return nil
}
