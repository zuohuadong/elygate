package handlers

import "context"

// VirtualKeyAccessChecker applies deployment-specific access policy after a
// virtual key credential has been resolved to its stable database identity.
type VirtualKeyAccessChecker interface {
	CheckVirtualKeyAccess(ctx context.Context, virtualKeyID string) error
	CheckVirtualKeyValueAccess(ctx context.Context, virtualKeyValue string) error
}
