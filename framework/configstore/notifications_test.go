package configstore

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func TestNotificationStoreLifecycle(t *testing.T) {
	store := setupRDBTestStore(t)
	require.NoError(t, store.DB().AutoMigrate(&tables.TableNotification{}))
	now := time.Now().UTC()
	ctx := context.Background()

	for _, notification := range []tables.TableNotification{
		{ID: "older", Audience: "all", Severity: "info", Title: "Older", Message: "message", CreatedAt: now.Add(-time.Hour), ExpiresAt: now.Add(time.Hour)},
		{ID: "newer", Audience: "roles", RoleIDs: []uint{2, 7}, Severity: "warning", Title: "Newer", Message: "message", CreatedAt: now, ExpiresAt: now.Add(time.Hour)},
		{ID: "expired", Audience: "all", Severity: "info", Title: "Expired", Message: "message", CreatedAt: now.Add(-48 * time.Hour), ExpiresAt: now.Add(-time.Hour)},
		{ID: "expired-admin", Audience: "admin", Severity: "warning", Title: "Expired admin", Message: "message", CreatedAt: now.Add(-48 * time.Hour), ExpiresAt: now.Add(-time.Hour)},
	} {
		require.NoError(t, store.CreateNotification(ctx, &notification))
	}

	rows, err := store.ListNotifications(ctx, time.Time{}, "", 50)
	require.NoError(t, err)
	require.Len(t, rows, 2)
	require.Equal(t, "newer", rows[0].ID)
	require.Equal(t, []uint{2, 7}, rows[0].RoleIDs)

	rows, err = store.ListNotifications(ctx, rows[0].CreatedAt, rows[0].ID, 50)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "older", rows[0].ID)

	deleted, err := store.DeleteExpiredNotifications(ctx, now)
	require.NoError(t, err)
	require.Equal(t, int64(2), deleted)
}

func TestNotificationStoreIdempotencyPreservesOriginal(t *testing.T) {
	store := setupRDBTestStore(t)
	require.NoError(t, store.DB().AutoMigrate(&tables.TableNotification{}))
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	original := tables.TableNotification{ID: "once", Audience: "admin", Severity: "warning",
		Title: "First", Message: "First payload", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	inserted, err := store.CreateNotificationIfNotExists(ctx, &original)
	require.NoError(t, err)
	require.True(t, inserted)
	require.True(t, original.RetainForReplay)
	deleted, err := store.DeleteExpiredNotifications(ctx, now.Add(48*time.Hour))
	require.NoError(t, err)
	require.Zero(t, deleted, "expiry must preserve durable replay receipts")
	replay := tables.TableNotification{ID: "once", Audience: "all", Severity: "info",
		Title: "Changed", Message: "Must not replace", CreatedAt: now.Add(time.Hour), ExpiresAt: now.Add(48 * time.Hour)}
	inserted, err = store.CreateNotificationIfNotExists(ctx, &replay)
	require.NoError(t, err)
	require.False(t, inserted)
	require.Equal(t, original.ID, replay.ID)
	require.Equal(t, original.Audience, replay.Audience)
	require.Equal(t, original.Message, replay.Message)
	require.True(t, original.CreatedAt.Equal(replay.CreatedAt))
	require.True(t, original.ExpiresAt.Equal(replay.ExpiresAt))
	var count int64
	require.NoError(t, store.DB().Model(&tables.TableNotification{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestNotificationReplayRetentionMigration(t *testing.T) {
	store := setupRDBTestStore(t)
	db := store.DB()
	ctx := context.Background()
	require.NoError(t, db.AutoMigrate(&tables.TableNotification{}))
	require.NoError(t, db.Create(&tables.TableNotification{
		ID: "pre-marker", Audience: "admin", Severity: "warning", Title: "Before marker",
		Message: "message", CreatedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC(),
	}).Error)
	require.NoError(t, db.Migrator().DropColumn(&tables.TableNotification{}, "RetainForReplay"))
	for range 2 {
		require.NoError(t, migrationAddNotificationReplayRetention(ctx, db, testMigrationLogger))
	}
	var beforeMarker tables.TableNotification
	require.NoError(t, db.First(&beforeMarker, "id = ?", "pre-marker").Error)
	require.False(t, beforeMarker.RetainForReplay)
	require.True(t, db.Migrator().HasColumn(&tables.TableNotification{}, "RetainForReplay"))
}

func TestNotificationReplayReceiptStaysHiddenAfterExpiry(t *testing.T) {
	store := setupRDBTestStore(t)
	require.NoError(t, store.DB().AutoMigrate(&tables.TableNotification{}))
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	original := tables.TableNotification{ID: "expired-receipt", Audience: "roles", RoleIDs: []uint{7},
		Severity: "warning", Title: "Original", Message: "Original payload",
		CreatedAt: now.Add(-31 * 24 * time.Hour), ExpiresAt: now.Add(-time.Hour)}
	created, err := store.CreateNotificationIfNotExists(ctx, &original)
	require.NoError(t, err)
	require.True(t, created)
	deleted, err := store.DeleteExpiredNotifications(ctx, now)
	require.NoError(t, err)
	require.Zero(t, deleted)
	replay := tables.TableNotification{ID: original.ID, Audience: "all", Severity: "info",
		Title: "Changed", Message: "Changed payload", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	created, err = store.CreateNotificationIfNotExists(ctx, &replay)
	require.NoError(t, err)
	require.False(t, created)
	require.Equal(t, original.Message, replay.Message)
	require.Equal(t, original.Audience, replay.Audience)
	require.Equal(t, original.RoleIDs, replay.RoleIDs)
	require.True(t, original.CreatedAt.Equal(replay.CreatedAt))
	require.True(t, original.ExpiresAt.Equal(replay.ExpiresAt))
	feed, err := store.ListNotifications(ctx, time.Time{}, "", 50)
	require.NoError(t, err)
	require.Empty(t, feed, "replay cannot reanimate an expired feed entry")
}
