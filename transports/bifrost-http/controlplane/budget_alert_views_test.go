package controlplane

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func benchmarkBudgetAlertViews(b *testing.B) *gorm.DB {
	b.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(b.TempDir(), "budget-views.db")), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(b, err)
	connection, err := db.DB()
	require.NoError(b, err)
	b.Cleanup(func() { require.NoError(b, connection.Close()) })
	require.NoError(b, db.AutoMigrate(&BudgetAlert{}))
	require.NoError(b, migrateBudgetAcknowledgements(db))
	require.NoError(b, migrateBudgetResolutions(db))
	now := time.Now().UTC().Truncate(time.Microsecond)
	for index := range 25 {
		alert := BudgetAlert{ID: uuid.NewString(), ScopeType: "project", ScopeID: "benchmark", Window: "daily",
			PeriodStart: now.Truncate(24*time.Hour).AddDate(0, 0, -index), Threshold: .8, Usage: 8, Limit: 10,
			TriggeredAt: now.Add(time.Duration(index) * time.Second)}
		require.NoError(b, db.Create(&alert).Error)
		if index%2 == 0 {
			require.NoError(b, db.Create(&budgetAcknowledgement{alert.ID, now, budgetAcknowledgementActor}).Error)
			require.NoError(b, db.Create(&budgetResolution{alert.ID, now, budgetResolutionActor}).Error)
		}
	}
	return db
}

func BenchmarkBudgetAlertViewReads(b *testing.B) {
	db := benchmarkBudgetAlertViews(b)
	for _, variant := range []string{"acknowledgement-only", "with-resolution"} {
		b.Run(variant, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				var query *gorm.DB
				if variant == "with-resolution" {
					query = budgetAlertViews(db)
				} else {
					query = db.Table("elygate_control_budget_alerts AS a").
						Select("a.*, k.acknowledged_at, k.acknowledged_by").
						Joins("LEFT JOIN " + budgetAcknowledgementTable + " AS k ON k.alert_id = a.id")
				}
				var alerts []BudgetAlertView
				err := query.Order("a.triggered_at DESC, a.id DESC").Limit(25).Scan(&alerts).Error
				require.NoError(b, err)
				require.Len(b, alerts, 25)
				for index := range alerts {
					alerts[index].normalizeState()
				}
			}
		})
	}
}
