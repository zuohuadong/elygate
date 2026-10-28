package controlplane

import (
	"strconv"
	"time"

	"github.com/valyala/fasthttp"
)

func budgetHistoryQuery(ctx *fasthttp.RequestCtx, now time.Time) (BudgetHistoryQuery, error) {
	args := ctx.QueryArgs()
	for _, key := range []string{"window", "start_time", "end_time", "limit", "offset", "project_id", "application_id"} {
		if len(args.PeekMulti(key)) > 1 || (args.Has(key) && len(args.Peek(key)) == 0) {
			return BudgetHistoryQuery{}, errInvalidBudgetHistory
		}
	}
	query := BudgetHistoryQuery{ProjectID: string(args.Peek("project_id")), ApplicationID: string(args.Peek("application_id")),
		Window: string(args.Peek("window")), Limit: 25}
	var err error
	query.Limit, err = budgetHistoryInteger(args, "limit", 25)
	if err != nil {
		return query, err
	}
	query.Offset, err = budgetHistoryInteger(args, "offset", 0)
	if err != nil {
		return query, err
	}
	return budgetHistoryRange(args, query, now)
}

func budgetHistoryInteger(args *fasthttp.Args, key string, fallback int) (int, error) {
	if !args.Has(key) {
		return fallback, nil
	}
	raw := string(args.Peek(key))
	for _, digit := range raw {
		if digit < '0' || digit > '9' {
			return 0, errInvalidBudgetHistory
		}
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || (key == "limit" && parsed == 0) {
		return 0, errInvalidBudgetHistory
	}
	return parsed, nil
}

func budgetHistoryRange(args *fasthttp.Args, query BudgetHistoryQuery, now time.Time) (BudgetHistoryQuery, error) {
	if args.Has("start_time") != args.Has("end_time") {
		return query, errInvalidBudgetHistory
	}
	if args.Has("start_time") {
		var err error
		query.StartTime, err = time.Parse(time.RFC3339, string(args.Peek("start_time")))
		if err != nil {
			return query, errInvalidBudgetHistory
		}
		query.EndTime, err = time.Parse(time.RFC3339, string(args.Peek("end_time")))
		if err != nil {
			return query, errInvalidBudgetHistory
		}
		if query.StartTime.IsZero() || query.EndTime.IsZero() {
			return query, errInvalidBudgetHistory
		}
	}
	return query.normalize(now)
}

func (h *Handler) usageBudgetHistory(ctx *fasthttp.RequestCtx) {
	now := time.Now().UTC()
	query, err := budgetHistoryQuery(ctx, now)
	if err != nil {
		writeError(ctx, fasthttp.StatusBadRequest, err)
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	configured, err := h.store.hasBudgetPolicyHistory(opCtx)
	if err == nil && configured {
		err = h.syncBudgetUsage(opCtx)
	}
	if err != nil {
		writeError(ctx, fasthttp.StatusInternalServerError, err)
		return
	}
	page, err := h.store.UsageBudgetHistory(opCtx, query, now)
	if err != nil {
		writeError(ctx, fasthttp.StatusInternalServerError, err)
		return
	}
	writeJSON(ctx, fasthttp.StatusOK, page)
}
