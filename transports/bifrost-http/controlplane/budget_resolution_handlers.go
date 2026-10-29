package controlplane

import (
	"errors"
	"strconv"

	"github.com/google/uuid"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

var errInvalidBudgetAlertQuery = errors.New("invalid budget alert filter or pagination")

func (h *Handler) setBudgetResolution(ctx *fasthttp.RequestCtx) {
	id := routeParam(ctx, "alert_id")
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id {
		writeError(ctx, 400, errors.New("alert ID must be a canonical UUID"))
		return
	}
	resolved, err := decodeBudgetResolution(ctx.PostBody())
	if err != nil {
		writeError(ctx, 400, err)
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	alert, err := h.store.SetBudgetResolution(opCtx, budgetResolutionMutation{id, resolved})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeError(ctx, 404, errors.New("budget alert does not exist"))
		} else {
			writeError(ctx, 500, errors.New("budget alert resolution could not be persisted"))
		}
		return
	}
	writeJSON(ctx, 200, alert)
}

func budgetAlertQuery(ctx *fasthttp.RequestCtx) (BudgetAlertQuery, error) {
	args := ctx.QueryArgs()
	query := BudgetAlertQuery{Limit: 100}
	for _, key := range []string{"project_id", "application_id", "resolution", "limit", "offset"} {
		if len(args.PeekMulti(key)) > 1 || args.Has(key) && len(args.Peek(key)) == 0 {
			return query, errInvalidBudgetAlertQuery
		}
	}
	query.ProjectID, query.ApplicationID = string(args.Peek("project_id")), string(args.Peek("application_id"))
	query.Resolution = string(args.Peek("resolution"))
	switch query.Resolution {
	case "", "all", "open", "resolved":
	default:
		return query, errInvalidBudgetAlertQuery
	}
	var err error
	query.Limit, err = budgetAlertPageInteger(args, "limit", 100)
	if err == nil {
		query.Offset, err = budgetAlertPageInteger(args, "offset", 0)
	}
	return query, err
}

func budgetAlertPageInteger(args *fasthttp.Args, key string, fallback int) (int, error) {
	if !args.Has(key) {
		return fallback, nil
	}
	raw := string(args.Peek(key))
	for _, digit := range raw {
		if digit < '0' || digit > '9' {
			return 0, errInvalidBudgetAlertQuery
		}
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || key == "limit" && (parsed == 0 || parsed > 1000) {
		return 0, errInvalidBudgetAlertQuery
	}
	return parsed, nil
}
