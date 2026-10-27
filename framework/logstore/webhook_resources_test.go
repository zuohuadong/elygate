package logstore

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestWebhookResourceHistoryRoundTrip(t *testing.T) {
	store := setupWebhookDeliveryTestStore(t)
	ctx := context.Background()
	delivery := &WebhookDelivery{ID: "budget-attempt", WebhookID: "budget-webhook", EndpointID: "endpoint",
		Event: tables.WebhookEventBudgetThresholdReached, ResourceID: "alert-1",
		PayloadJSON: `{"id":"alert-1","usage":8,"limit":10}`, AttemptNo: 1,
		Outcome: WebhookDeliveryOutcomeDelivered, CreatedAt: time.Now().UTC()}
	require.NoError(t, store.CreateWebhookDelivery(ctx, delivery))
	stored, err := store.FindWebhookDeliveryByID(ctx, delivery.ID)
	require.NoError(t, err)
	require.Empty(t, stored.AsyncJobID)
	require.Equal(t, delivery.ResourceID, stored.ResourceID)
	require.Equal(t, delivery.PayloadJSON, stored.PayloadJSON)
	encoded, err := json.Marshal(stored)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "payload_json")
	require.NotContains(t, string(encoded), `"usage"`)
}

func TestMigrationWebhookResourceHistoryPreservesRows(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "history.db")), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec("CREATE TABLE webhook_deliveries (id TEXT PRIMARY KEY, async_job_id TEXT)").Error)
	require.NoError(t, db.Exec("INSERT INTO webhook_deliveries (id, async_job_id) VALUES (?, ?)", "attempt", "async").Error)
	for range 2 {
		require.NoError(t, migrationAddWebhookDeliveryResourceEventColumns(context.Background(), db, testLogger{}))
	}
	var row WebhookDelivery
	require.NoError(t, db.First(&row, "id = ?", "attempt").Error)
	require.Equal(t, "async", row.AsyncJobID)
	require.True(t, db.Migrator().HasColumn(&WebhookDelivery{}, "ResourceID"))
	require.True(t, db.Migrator().HasColumn(&WebhookDelivery{}, "PayloadJSON"))
}
