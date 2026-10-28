package configstore

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func TestWebhookResourceJobValidationAndRoundTrip(t *testing.T) {
	store := setupRDBTestStore(t)
	ctx := context.Background()
	job := &tables.TableWebhookJob{ID: "budget-job", EndpointID: "endpoint",
		Event: tables.WebhookEventBudgetThresholdReached, ResourceID: "alert-1", PayloadJSON: `{"id":"alert-1"}`}
	require.NoError(t, store.CreateWebhookJob(ctx, job))
	stored := getWebhookJob(t, store, job.ID)
	require.Empty(t, stored.AsyncJobID)
	require.Equal(t, job.ResourceID, stored.ResourceID)
	require.Equal(t, job.PayloadJSON, stored.PayloadJSON)
	for _, payload := range []string{"", "null", "[]", "true", "broken"} {
		invalid := *job
		invalid.ID = "invalid"
		invalid.PayloadJSON = payload
		require.Error(t, store.CreateWebhookJob(ctx, &invalid))
	}
	invalid := *job
	invalid.ResourceID = ""
	require.Error(t, store.CreateWebhookJob(ctx, &invalid))
	invalid = *job
	invalid.AsyncJobID = "async"
	require.Error(t, store.CreateWebhookJob(ctx, &invalid))
}

func TestMigrationWebhookResourceColumnsPreservesQueue(t *testing.T) {
	db := setupTestDB(t)
	require.NoError(t, db.Exec("CREATE TABLE webhook_jobs (id TEXT PRIMARY KEY, async_job_id TEXT)").Error)
	require.NoError(t, db.Exec("INSERT INTO webhook_jobs (id, async_job_id) VALUES (?, ?)", "queued", "async").Error)
	for range 2 {
		require.NoError(t, migrationAddWebhookResourceEventColumns(context.Background(), db, testMigrationLogger))
	}
	var row tables.TableWebhookJob
	require.NoError(t, db.First(&row, "id = ?", "queued").Error)
	require.Equal(t, "async", row.AsyncJobID)
	require.True(t, db.Migrator().HasColumn(&tables.TableWebhookJob{}, "ResourceID"))
	require.True(t, db.Migrator().HasColumn(&tables.TableWebhookJob{}, "PayloadJSON"))
}
