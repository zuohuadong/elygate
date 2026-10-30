package configstore

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestLockRoutingPolicyWriteRequiresTransaction(t *testing.T) {
	store := setupRDBTestStore(t)
	require.Error(t, LockRoutingPolicyWrite(store.DB()))

	require.NoError(t, store.DB().WithContext(context.Background()).Transaction(func(tx *gorm.DB) error {
		return LockRoutingPolicyWrite(tx)
	}))
}
