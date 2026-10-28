package configstore

import (
	"context"
	"errors"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"gorm.io/gorm"
)

// GetSession shares the upstream lookup rules with callers holding a transaction.
func GetSession(ctx context.Context, db *gorm.DB, token string) (*tables.SessionsTable, error) {
	var session tables.SessionsTable
	err := db.WithContext(ctx).First(&session, "token_hash = ?", encrypt.HashSHA256(token)).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Ciphertext must never authenticate through the pre-hash plaintext fallback.
		err = db.WithContext(ctx).Where(plaintextRowPredicate).First(&session, "token = ?", token).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
	}
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// CreateSession retains the encryption hooks when writing through an existing transaction.
func CreateSession(ctx context.Context, db *gorm.DB, session *tables.SessionsTable) error {
	return db.WithContext(ctx).Create(session).Error
}

// DeleteSession shares upstream deletion behavior without escaping the supplied transaction.
func DeleteSession(ctx context.Context, db *gorm.DB, token string) error {
	var session tables.SessionsTable
	err := db.WithContext(ctx).First(&session, "token_hash = ?", encrypt.HashSHA256(token)).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.WithContext(ctx).Where(plaintextRowPredicate).Delete(&tables.SessionsTable{}, "token = ?", token).Error
	}
	if err != nil {
		return err
	}
	return db.WithContext(ctx).Delete(&session).Error
}
