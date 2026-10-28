package controlplane

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

var errInvalidBudgetHistory = errors.New("invalid budget history query")

type BudgetHistoryQuery struct {
	ProjectID, ApplicationID string
	Window                   string
	StartTime, EndTime       time.Time
	Limit, Offset            int
}

type BudgetHistoryStatus struct {
	BudgetStatus
	ScopeName string `json:"scope_name"`
}

type BudgetHistoryPage struct {
	Data      []BudgetHistoryStatus `json:"data"`
	Total     int64                 `json:"total"`
	Limit     int                   `json:"limit"`
	Offset    int                   `json:"offset"`
	Window    string                `json:"window"`
	StartTime time.Time             `json:"start_time"`
	EndTime   time.Time             `json:"end_time"`
}

func budgetHistoryPeriodStart(window string, at time.Time) time.Time {
	at = at.UTC()
	day := at.Day()
	if window == "monthly" {
		day = 1
	}
	return time.Date(at.Year(), at.Month(), day, 0, 0, 0, 0, time.UTC)
}

func shiftBudgetHistoryPeriod(window string, at time.Time, count int) time.Time {
	if window == "monthly" {
		return at.AddDate(0, count, 0)
	}
	return at.AddDate(0, 0, count)
}

func (query BudgetHistoryQuery) normalize(now time.Time) (BudgetHistoryQuery, error) {
	if query.Window == "" {
		query.Window = "daily"
	}
	if query.Window != "daily" && query.Window != "monthly" {
		return query, errInvalidBudgetHistory
	}
	if query.Limit == 0 {
		query.Limit = 25
	}
	if query.Limit < 1 || query.Limit > 100 || query.Offset < 0 {
		return query, errInvalidBudgetHistory
	}
	return query.normalizeRange(now)
}

func (query BudgetHistoryQuery) normalizeRange(now time.Time) (BudgetHistoryQuery, error) {
	closedBefore := budgetHistoryPeriodStart(query.Window, now)
	if query.StartTime.IsZero() && query.EndTime.IsZero() {
		count := 30
		if query.Window == "monthly" {
			count = 12
		}
		query.EndTime = closedBefore
		query.StartTime = shiftBudgetHistoryPeriod(query.Window, closedBefore, -count)
	}
	query.StartTime, query.EndTime = query.StartTime.UTC(), query.EndTime.UTC()
	if !query.StartTime.Before(query.EndTime) || query.EndTime.After(closedBefore) ||
		!query.StartTime.Equal(budgetHistoryPeriodStart(query.Window, query.StartTime)) ||
		!query.EndTime.Equal(budgetHistoryPeriodStart(query.Window, query.EndTime)) {
		return query, errInvalidBudgetHistory
	}
	return query, query.validatePeriodCount()
}

func (query BudgetHistoryQuery) validatePeriodCount() error {
	maxPeriods := 366
	if query.Window == "monthly" {
		maxPeriods = 60
	}
	if query.StartTime.IsZero() || query.EndTime.IsZero() ||
		query.StartTime.Year() < 1 || query.EndTime.Year() > 9999 ||
		query.EndTime.After(shiftBudgetHistoryPeriod(query.Window, query.StartTime, maxPeriods)) {
		return errInvalidBudgetHistory
	}
	return nil
}

func (query BudgetHistoryQuery) periods() []time.Time {
	var periods []time.Time
	for at := query.StartTime; at.Before(query.EndTime); at = shiftBudgetHistoryPeriod(query.Window, at, 1) {
		periods = append(periods, at)
	}
	return periods
}

func budgetHistoryScopes(db *gorm.DB, query BudgetHistoryQuery) *gorm.DB {
	apps := db.Model(&Application{}).Select("'application' AS scope_type, id AS scope_id, project_id, name AS scope_name")
	if query.ProjectID != "" {
		apps = apps.Where("project_id = ?", query.ProjectID)
	}
	if query.ApplicationID != "" {
		return apps.Where("id = ?", query.ApplicationID)
	}
	projects := db.Model(&Project{}).Select("'project' AS scope_type, id AS scope_id, id AS project_id, name AS scope_name")
	if query.ProjectID != "" {
		projects = projects.Where("id = ?", query.ProjectID)
	}
	return db.Raw("? UNION ALL ?", projects, apps)
}

func budgetHistoryCandidates(db *gorm.DB, query BudgetHistoryQuery) *gorm.DB {
	limitColumn := "daily_budget"
	if query.Window == "monthly" {
		limitColumn = "monthly_budget"
	}
	// Select the last revision before testing null: clearing must not resurrect an older budget.
	revisions := (BudgetPolicyRevision{}).TableName()
	return db.Table("(?) AS scopes", budgetHistoryScopes(db, query)).
		Joins("CROSS JOIN (?) AS periods", budgetHistoryPeriodSource(db, query)).
		Joins("JOIN " + revisions + " AS revision ON revision.id = (SELECT id FROM " + revisions +
			" AS latest WHERE latest.scope_type = scopes.scope_type AND latest.scope_id = scopes.scope_id" +
			" AND latest.effective_at < periods.period_end ORDER BY latest.effective_at DESC, latest.id DESC LIMIT 1)").
		Where("revision." + limitColumn + " IS NOT NULL").
		Select("scopes.*, periods.period_index, revision." + limitColumn + " AS budget_limit")
}

func budgetHistoryPeriodSource(db *gorm.DB, query BudgetHistoryQuery) *gorm.DB {
	periodSelect := "SELECT CAST(? AS integer) AS period_index, ? AS period_end"
	if db.Dialector.Name() == "postgres" {
		periodSelect = "SELECT CAST(? AS integer) AS period_index, CAST(? AS timestamptz) AS period_end"
	}
	var selects []string
	var args []any
	for index, start := range query.periods() {
		selects = append(selects, periodSelect)
		args = append(args, index, shiftBudgetHistoryPeriod(query.Window, start, 1))
	}
	return db.Raw(strings.Join(selects, " UNION ALL "), args...)
}

func (s *Store) UsageBudgetHistory(ctx context.Context, query BudgetHistoryQuery, now time.Time) (BudgetHistoryPage, error) {
	query, err := query.normalize(now)
	if err != nil {
		return BudgetHistoryPage{}, err
	}
	var page BudgetHistoryPage
	err = s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockUsageProjection(tx); err != nil {
			return err
		}
		var readErr error
		page, readErr = (&Store{configStore: s.configStore, tx: tx}).budgetHistoryPage(ctx, query)
		return readErr
	})
	return page, err
}

type budgetHistoryCandidate struct {
	ScopeType, ScopeID, ProjectID, ScopeName string
	PeriodIndex                              int
	BudgetLimit                              float64
}

func (s *Store) budgetHistoryPage(ctx context.Context, query BudgetHistoryQuery) (BudgetHistoryPage, error) {
	page := BudgetHistoryPage{Data: []BudgetHistoryStatus{}, Limit: query.Limit, Offset: query.Offset,
		Window: query.Window, StartTime: query.StartTime, EndTime: query.EndTime}
	candidates := budgetHistoryCandidates(s.db(ctx), query)
	if err := s.db(ctx).Table("(?) AS budgets", candidates).Count(&page.Total).Error; err != nil {
		return page, err
	}
	var rows []budgetHistoryCandidate
	if err := candidates.Order("periods.period_index DESC, scopes.scope_type ASC, scopes.scope_id ASC").
		Limit(query.Limit).Offset(query.Offset).Scan(&rows).Error; err != nil {
		return page, err
	}
	periods := query.periods()
	for _, row := range rows {
		status, err := s.budgetHistoryStatus(ctx, query, row, periods[row.PeriodIndex])
		if err != nil {
			return page, err
		}
		page.Data = append(page.Data, status)
	}
	return page, nil
}

func (s *Store) budgetHistoryStatus(ctx context.Context, query BudgetHistoryQuery, row budgetHistoryCandidate, start time.Time) (BudgetHistoryStatus, error) {
	end := shiftBudgetHistoryPeriod(query.Window, start, 1)
	filter := UsageQuery{ProjectID: row.ProjectID, StartTime: &start, EndTime: &end}
	if row.ScopeType == "application" {
		filter.ApplicationID = row.ScopeID
	}
	summary, err := s.SummarizeUsage(ctx, filter)
	return BudgetHistoryStatus{BudgetStatus: BudgetStatus{ScopeType: row.ScopeType, ScopeID: row.ScopeID,
		ProjectID: row.ProjectID, Window: query.Window, PeriodStart: start, PeriodEnd: end,
		Limit: row.BudgetLimit, Usage: summary.Cost, State: budgetState(summary.Cost, row.BudgetLimit)}, ScopeName: row.ScopeName}, err
}
