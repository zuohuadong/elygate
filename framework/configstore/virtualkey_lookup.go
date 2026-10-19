package configstore

import (
	"context"

	"github.com/maximhq/bifrost/framework/configstore/tables"
)

// virtualKeyByValueStore is the narrow read the lookup needs. Implemented by
// RDBConfigStore; kept as an interface so stores that cannot resolve a
// presented value fail closed instead of panicking.
type virtualKeyByValueStore interface {
	GetVirtualKeyByValue(ctx context.Context, value string) (*tables.TableVirtualKey, error)
}

// LookupVirtualKeyID resolves a presented virtual-key value to the owning key's
// ID. It is used by revocation/binding checks that only hold the opaque value.
func LookupVirtualKeyID(ctx context.Context, store ConfigStore, value string) (string, error) {
	if store == nil {
		return "", ErrNotFound
	}
	lookup, ok := store.(virtualKeyByValueStore)
	if !ok {
		return "", ErrNotFound
	}
	vk, err := lookup.GetVirtualKeyByValue(ctx, value)
	if err != nil {
		return "", err
	}
	if vk == nil {
		return "", ErrNotFound
	}
	return vk.ID, nil
}