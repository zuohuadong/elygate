package controlplane

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errInvalidBudget = errors.New("invalid budget")

// BudgetLimits is a full replacement: nil clears a window rather than retaining it.
type BudgetLimits struct {
	DailyBudget   *float64 `json:"daily_budget"`
	MonthlyBudget *float64 `json:"monthly_budget"`
}

func (limits BudgetLimits) validate() error {
	for _, limit := range []*float64{limits.DailyBudget, limits.MonthlyBudget} {
		if limit != nil && (math.IsNaN(*limit) || math.IsInf(*limit, 0) || *limit <= 0) {
			return fmt.Errorf("%w: limits must be finite USD amounts greater than zero, or null", errInvalidBudget)
		}
	}
	return nil
}

type BudgetScope struct {
	Type string
	ID   string
}

func (scope BudgetScope) model() (any, error) {
	if scope.ID == "" {
		return nil, fmt.Errorf("%w: scope ID is required", errInvalidBudget)
	}
	switch scope.Type {
	case "project":
		return &Project{}, nil
	case "application":
		return &Application{}, nil
	default:
		return nil, fmt.Errorf("%w: scope must be project or application", errInvalidBudget)
	}
}

func (s *Store) SetBudgetLimits(ctx context.Context, scope BudgetScope, limits BudgetLimits, actor string) error {
	if err := limits.validate(); err != nil {
		return err
	}
	model, err := scope.model()
	if err != nil {
		return err
	}
	return s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockUsageProjection(tx); err != nil {
			return err
		}
		updated := tx.Model(model).Where("id = ?", scope.ID).
			Updates(map[string]any{"daily_budget": limits.DailyBudget, "monthly_budget": limits.MonthlyBudget})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := appendBudgetPolicyRevision(tx, budgetScope{BudgetScope: scope, Limits: limits}, time.Now().UTC()); err != nil {
			return err
		}
		return appendAuditTx(tx, actor, scope.Type+".budget_update", scope.Type, scope.ID)
	})
}

type budgetScope struct {
	BudgetScope
	ProjectID string
	Limits    BudgetLimits
}

type BudgetStatus struct {
	ScopeType   string    `json:"scope_type"`
	ScopeID     string    `json:"scope_id"`
	ProjectID   string    `json:"project_id"`
	Window      string    `json:"window"`
	PeriodStart time.Time `json:"period_start"`
	PeriodEnd   time.Time `json:"period_end"`
	Usage       float64   `json:"usage"`
	Limit       float64   `json:"limit"`
	State       string    `json:"state"`
}

func (s *Store) HasUsageBudgets(ctx context.Context) (bool, error) {
	for _, model := range []any{&Project{}, &Application{}} {
		var count int64
		if err := s.db(ctx).Model(model).Where("daily_budget IS NOT NULL OR monthly_budget IS NOT NULL").Limit(1).Count(&count).Error; err != nil {
			return false, err
		}
		if count > 0 {
			return true, nil
		}
	}
	return false, nil
}

func (s *Store) budgetScopes(ctx context.Context, query UsageQuery) ([]budgetScope, error) {
	var projects []Project
	projectQuery := s.db(ctx).Where("daily_budget IS NOT NULL OR monthly_budget IS NOT NULL")
	if query.ProjectID != "" {
		projectQuery = projectQuery.Where("id = ?", query.ProjectID)
	}
	// An application filter must not silently include its whole project's budget.
	if query.ApplicationID == "" {
		if err := projectQuery.Order("id").Find(&projects).Error; err != nil {
			return nil, err
		}
	}
	var apps []Application
	appQuery := s.db(ctx).Where("daily_budget IS NOT NULL OR monthly_budget IS NOT NULL")
	if query.ProjectID != "" {
		appQuery = appQuery.Where("project_id = ?", query.ProjectID)
	}
	if query.ApplicationID != "" {
		appQuery = appQuery.Where("id = ?", query.ApplicationID)
	}
	if err := appQuery.Order("id").Find(&apps).Error; err != nil {
		return nil, err
	}
	scopes := make([]budgetScope, 0, len(projects)+len(apps))
	for _, project := range projects {
		scopes = append(scopes, budgetScope{BudgetScope{"project", project.ID}, project.ID, BudgetLimits{project.DailyBudget, project.MonthlyBudget}})
	}
	for _, app := range apps {
		scopes = append(scopes, budgetScope{BudgetScope{"application", app.ID}, app.ProjectID, BudgetLimits{app.DailyBudget, app.MonthlyBudget}})
	}
	return scopes, nil
}

func budgetPeriods(scope budgetScope, now time.Time) []BudgetStatus {
	periods := make([]BudgetStatus, 0, 2)
	for _, window := range []struct {
		name, duration string
		limit          *float64
	}{
		{"daily", "1d", scope.Limits.DailyBudget},
		{"monthly", "1M", scope.Limits.MonthlyBudget},
	} {
		if window.limit == nil {
			continue
		}
		start := configtables.GetCalendarPeriodStart(window.duration, now, configtables.QuarterStartNotApplicable)
		end := start.AddDate(0, 0, 1)
		if window.name == "monthly" {
			end = start.AddDate(0, 1, 0)
		}
		periods = append(periods, BudgetStatus{ScopeType: scope.Type, ScopeID: scope.ID, ProjectID: scope.ProjectID,
			Window: window.name, PeriodStart: start, PeriodEnd: end, Limit: *window.limit})
	}
	return periods
}

func budgetState(usage, limit float64) string {
	switch {
	case reachedBudgetThreshold(usage, limit, 1):
		return "exceeded"
	case reachedBudgetThreshold(usage, limit, 0.8):
		return "warning"
	default:
		return "healthy"
	}
}

func reachedBudgetThreshold(usage, limit, threshold float64) bool {
	if usage <= 0 {
		return false
	}
	target := limit * threshold
	if usage >= target {
		return true
	}
	// SQL cost sums and decimal inputs use binary floats upstream. Permit only
	// representational noise (eight ULPs), without rounding billable sub-cent costs.
	tolerance := 8 * (target - math.Nextafter(target, 0))
	return target-usage <= tolerance
}

func (s *Store) UsageBudgetStatus(ctx context.Context, query UsageQuery, now time.Time) ([]BudgetStatus, error) {
	var statuses []BudgetStatus
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockUsageProjection(tx); err != nil {
			return err
		}
		reader := &Store{configStore: s.configStore, tx: tx}
		var err error
		statuses, err = reader.usageBudgetStatus(ctx, query, now)
		return err
	})
	return statuses, err
}

func (s *Store) usageBudgetStatus(ctx context.Context, query UsageQuery, now time.Time) ([]BudgetStatus, error) {
	scopes, err := s.budgetScopes(ctx, query)
	if err != nil {
		return nil, err
	}
	statuses := make([]BudgetStatus, 0, len(scopes)*2)
	for _, scope := range scopes {
		for _, period := range budgetPeriods(scope, now) {
			filter := UsageQuery{ProjectID: scope.ProjectID, StartTime: &period.PeriodStart, EndTime: &period.PeriodEnd}
			if scope.Type == "application" {
				filter.ApplicationID = scope.ID
			}
			summary, err := s.SummarizeUsage(ctx, filter)
			if err != nil {
				return nil, err
			}
			period.Usage, period.State = summary.Cost, budgetState(summary.Cost, period.Limit)
			statuses = append(statuses, period)
		}
	}
	return statuses, nil
}

func (s *Store) EvaluateBudgetAlerts(ctx context.Context, now time.Time) (int64, error) {
	var created int64
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		// Serialize against reconciliation so a partial projection never emits an alert.
		if err := lockUsageProjection(tx); err != nil {
			return err
		}
		reader := &Store{configStore: s.configStore, tx: tx}
		statuses, err := reader.usageBudgetStatus(ctx, UsageQuery{}, now)
		if err != nil {
			return err
		}
		for _, status := range statuses {
			count, err := createBudgetAlerts(tx, status, now.UTC())
			if err != nil {
				return err
			}
			created += count
		}
		historical, err := reader.evaluateClosedBudgetPeriods(ctx, now)
		created += historical
		return err
	})
	if err != nil {
		return 0, err
	}
	return created, nil
}

func createBudgetAlerts(tx *gorm.DB, status BudgetStatus, now time.Time) (int64, error) {
	var created int64
	for _, threshold := range []float64{0.8, 1} {
		if !reachedBudgetThreshold(status.Usage, status.Limit, threshold) {
			continue
		}
		alert := BudgetAlert{ID: uuid.NewString(), ScopeType: status.ScopeType, ScopeID: status.ScopeID,
			Window: status.Window, PeriodStart: status.PeriodStart, Threshold: threshold,
			Usage: status.Usage, Limit: status.Limit, TriggeredAt: now}
		inserted := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&alert)
		if inserted.Error != nil {
			return 0, inserted.Error
		}
		if inserted.RowsAffected == 1 {
			if err := enqueueBudgetNotification(tx, alert); err != nil {
				return 0, err
			}
			if err := enqueueBudgetWebhooks(tx, alert); err != nil {
				return 0, err
			}
		}
		created += inserted.RowsAffected
	}
	return created, nil
}

func enqueueBudgetNotification(tx *gorm.DB, alert BudgetAlert) error {
	now := alert.TriggeredAt.UTC()
	outbox := BudgetNotificationOutbox{
		ID:      uuid.NewSHA1(uuid.NameSpaceURL, []byte("elygate:budget-notification:"+alert.ID)).String(),
		AlertID: alert.ID, ScopeType: alert.ScopeType, ScopeID: alert.ScopeID,
		Window: alert.Window, PeriodStart: alert.PeriodStart, Threshold: alert.Threshold,
		Usage: alert.Usage, Limit: alert.Limit, Status: BudgetNotificationPending,
		NextAttemptAt: now, CreatedAt: now, UpdatedAt: now,
	}
	return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "alert_id"}}, DoNothing: true}).Create(&outbox).Error
}

type BudgetAlertQuery struct {
	ProjectID     string
	ApplicationID string
	Resolution    string
	Limit         int
	Offset        int
}

func budgetAlertViews(db *gorm.DB) *gorm.DB {
	return db.Table("elygate_control_budget_alerts AS a").
		Select("a.*, k.acknowledged_at, k.acknowledged_by, r.resolved_at, r.resolved_by").
		Joins("LEFT JOIN " + budgetAcknowledgementTable + " AS k ON k.alert_id = a.id").
		Joins("LEFT JOIN " + budgetResolutionTable + " AS r ON r.alert_id = a.id")
}

func (s *Store) ListBudgetAlerts(ctx context.Context, query BudgetAlertQuery) ([]BudgetAlertView, error) {
	alerts := []BudgetAlertView{}
	db := budgetAlertViews(s.db(ctx)).Order("a.triggered_at DESC, a.id DESC")
	switch query.Resolution {
	case "", "all":
	case "open":
		db = db.Where("r.alert_id IS NULL")
	case "resolved":
		db = db.Where("r.alert_id IS NOT NULL")
	default:
		return nil, errInvalidBudgetAlertQuery
	}
	if query.ApplicationID != "" {
		db = db.Where("a.scope_type = ? AND a.scope_id = ?", "application", query.ApplicationID)
	}
	if query.ProjectID != "" {
		appIDs := s.db(ctx).Model(&Application{}).Select("id").Where("project_id = ?", query.ProjectID)
		db = db.Where("(a.scope_type = ? AND a.scope_id = ?) OR (a.scope_type = ? AND a.scope_id IN (?))", "project", query.ProjectID, "application", appIDs)
	}
	limit := query.Limit
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	err := db.Limit(limit).Offset(max(0, query.Offset)).Scan(&alerts).Error
	for index := range alerts {
		alerts[index].normalizeState()
	}
	return alerts, err
}
