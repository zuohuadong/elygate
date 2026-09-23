package logstore

import (
	"context"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// GetStats reports input/output tokens alongside the total so the logs stats
// card can show the split. Only terminal requests contribute, matching the
// total/cost aggregates computed in the same query.
func TestGetStatsTokenSplit(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Log{}))

	s := &RDBLogStore{db: db, logger: bifrost.NewDefaultLogger(schemas.LogLevelInfo)}
	ctx := context.Background()
	now := time.Now()

	seed := []struct {
		id                        string
		prompt, completion, total int
		cost                      float64
		status                    string
	}{
		{"a", 100, 10, 110, 0.00085, "success"},
		{"b", 200, 20, 220, 0.00837, "success"},
		{"c", 400, 40, 440, 0.001, "error"},   // terminal, must count
		{"d", 999, 99, 1098, 5, "processing"}, // non-terminal, must NOT count
	}
	for _, sd := range seed {
		cost := sd.cost
		require.NoError(t, db.Create(&Log{
			ID:               sd.id,
			Timestamp:        now,
			Status:           sd.status,
			PromptTokens:     sd.prompt,
			CompletionTokens: sd.completion,
			TotalTokens:      sd.total,
			Cost:             &cost,
		}).Error)
	}

	stats, err := s.GetStats(ctx, SearchFilters{})
	require.NoError(t, err)

	require.Equal(t, int64(770), stats.TotalTokens, "total excludes non-terminal")
	require.Equal(t, int64(700), stats.PromptTokens, "prompt = 100+200+400")
	require.Equal(t, int64(70), stats.CompletionTokens, "completion = 10+20+40")
	require.Equal(t, stats.TotalTokens, stats.PromptTokens+stats.CompletionTokens, "split sums to total")
	require.InDelta(t, 0.01022, stats.TotalCost, 0.0000001, "cost sums terminal rows shown in the filtered log list")
}

// TestMCPAttributionFiltersApplyToRowsAndStats checks each stored scope filters both records and aggregates.
func TestMCPAttributionFiltersApplyToRowsAndStats(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&MCPToolLog{}))
	store := &RDBLogStore{db: db, logger: bifrost.NewDefaultLogger(schemas.LogLevelInfo)}
	ctx := context.Background()
	a, b := "a", "b"
	now := time.Now()
	require.NoError(t, db.Create(&MCPToolLog{ID: a, ToolName: "Read", Timestamp: now, Status: "success", UserID: &a, TeamID: &a, CustomerID: &a, BusinessUnitID: &a, ProjectID: &a, DeviceID: &a}).Error)
	require.NoError(t, db.Create(&MCPToolLog{ID: b, ToolName: "Read", Timestamp: now, Status: "error", UserID: &b, TeamID: &b, CustomerID: &b, BusinessUnitID: &b, ProjectID: &b, DeviceID: &b}).Error)
	for _, filters := range []MCPToolLogSearchFilters{{UserIDs: []string{a}}, {TeamIDs: []string{a}}, {CustomerIDs: []string{a}}, {BusinessUnitIDs: []string{a}}, {ProjectIDs: []string{a}}, {DeviceIDs: []string{a}}} {
		result, err := store.SearchMCPToolLogs(ctx, filters, PaginationOptions{Limit: 10, SortBy: "timestamp", Order: "desc"})
		require.NoError(t, err)
		require.Len(t, result.Logs, 1)
		require.Equal(t, a, result.Logs[0].ID)
		stats, err := store.GetMCPToolLogStats(ctx, filters)
		require.NoError(t, err)
		require.EqualValues(t, 1, stats.TotalExecutions)
		require.EqualValues(t, 100, stats.SuccessRate)
	}
}
