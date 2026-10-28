package controlplane

import (
	"context"
	"time"

	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type sessionAuditStore struct {
	configstore.ConfigStore
	store *Store
}

// ConfigStoreWithSessionAudit is injected only into the password-verified dashboard handler.
func (s *Store) ConfigStoreWithSessionAudit() configstore.ConfigStore {
	return &sessionAuditStore{ConfigStore: s.configStore, store: s}
}

type sessionAuditError struct{ cause error }

func (e *sessionAuditError) Error() string { return "dashboard session persistence failed" }
func (e *sessionAuditError) Unwrap() error { return e.cause }

func (s *sessionAuditStore) CreateSession(ctx context.Context, session *configtables.SessionsTable) error {
	// BeforeSave encrypts Token in place, so capture its plaintext digest first.
	resourceID := "sha256:" + encrypt.HashSHA256(session.Token)
	err := s.store.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := configstore.CreateSession(ctx, tx, session); err != nil {
			return err
		}
		return appendAuditTx(tx, "local-admin", "dashboard_session.created", "dashboard_session", resourceID)
	})
	if err != nil {
		return &sessionAuditError{cause: err}
	}
	return nil
}

func (s *sessionAuditStore) DeleteSession(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	err := s.store.db(ctx).Transaction(func(tx *gorm.DB) error {
		session, err := lockDashboardSession(ctx, tx, token)
		if err != nil || session == nil {
			return err
		}
		if err := configstore.DeleteSession(ctx, tx, token); err != nil {
			return err
		}
		actor := "anonymous"
		if session.ExpiresAt.After(time.Now()) {
			actor = "local-admin"
		}
		return appendAuditTx(tx, actor, "dashboard_session.deleted", "dashboard_session", "sha256:"+encrypt.HashSHA256(token))
	})
	if err != nil {
		return &sessionAuditError{cause: err}
	}
	return nil
}

func lockDashboardSession(ctx context.Context, tx *gorm.DB, token string) (*configtables.SessionsTable, error) {
	if tx.Dialector.Name() == "sqlite" {
		// Take the writer lock before reading to avoid concurrent read-to-write upgrades.
		if err := tx.Exec("UPDATE sessions SET id = id WHERE token_hash = ? OR token = ?", encrypt.HashSHA256(token), token).Error; err != nil {
			return nil, err
		}
	} else {
		tx = tx.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	return configstore.GetSession(ctx, tx, token)
}
