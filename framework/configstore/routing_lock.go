package configstore

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
)

// RoutingPolicyWriteLockKey is shared by routing CRUD, config reconciliation,
// release intents, and future whole-policy publication transactions.
const RoutingPolicyWriteLockKey int64 = 1000003

// LockRoutingPolicyWrite reserves the routing writer boundary for the current
// transaction. SQLite must reserve its writer before any reads; PostgreSQL
// uses a transaction-scoped advisory lock because row locks cannot block new
// routing-rule inserts.
func LockRoutingPolicyWrite(tx *gorm.DB) error {
	if tx == nil {
		return errors.New("routing policy write lock requires a transaction")
	}
	if _, ok := tx.Statement.ConnPool.(gorm.TxCommitter); !ok {
		return errors.New("routing policy write lock requires a transaction")
	}
	switch tx.Dialector.Name() {
	case "postgres":
		return tx.Exec("SELECT pg_advisory_xact_lock(?)", RoutingPolicyWriteLockKey).Error
	case "sqlite":
		return tx.Exec("UPDATE routing_rules SET id = id WHERE 1 = 0").Error
	default:
		return fmt.Errorf("routing policy write lock unsupported for database dialect %q", tx.Dialector.Name())
	}
}
