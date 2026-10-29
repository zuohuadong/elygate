package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"time"

	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

var errBudgetUsageSourceUnavailable = errors.New("budget evaluation requires an available usage log source")

func (h *Handler) setProjectBudgets(ctx *fasthttp.RequestCtx) {
	h.setBudgets(ctx, BudgetScope{Type: "project", ID: routeParam(ctx, "project_id")})
}

func (h *Handler) setApplicationBudgets(ctx *fasthttp.RequestCtx) {
	h.setBudgets(ctx, BudgetScope{Type: "application", ID: routeParam(ctx, "application_id")})
}

func (h *Handler) setBudgets(ctx *fasthttp.RequestCtx, scope BudgetScope) {
	limits, err := decodeBudgetLimits(ctx.PostBody())
	if err != nil {
		writeError(ctx, fasthttp.StatusBadRequest, err)
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	if err := h.store.SetBudgetLimits(opCtx, scope, limits, auditActor(ctx)); err != nil {
		status := fasthttp.StatusInternalServerError
		if errors.Is(err, errInvalidBudget) {
			status = fasthttp.StatusBadRequest
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			status = fasthttp.StatusNotFound
		}
		writeError(ctx, status, err)
		return
	}
	writeJSON(ctx, fasthttp.StatusOK, limits)
}

func decodeBudgetLimits(body []byte) (BudgetLimits, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var limits *BudgetLimits
	if err := decoder.Decode(&limits); err != nil {
		return BudgetLimits{}, err
	}
	if limits == nil {
		return BudgetLimits{}, errors.New("budget limits must be a JSON object")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return BudgetLimits{}, errors.New("budget limits must contain one JSON object")
	}
	return *limits, nil
}

func (h *Handler) usageBudgets(ctx *fasthttp.RequestCtx) {
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	configured, err := h.store.HasUsageBudgets(opCtx)
	if err != nil {
		writeError(ctx, fasthttp.StatusInternalServerError, err)
		return
	}
	if !configured {
		writeJSON(ctx, fasthttp.StatusOK, map[string]any{"data": []BudgetStatus{}})
		return
	}
	if err := h.syncBudgetUsage(opCtx); err != nil {
		writeError(ctx, fasthttp.StatusInternalServerError, err)
		return
	}
	statuses, err := h.store.UsageBudgetStatus(opCtx, budgetQuery(ctx), time.Now().UTC())
	if err != nil {
		writeError(ctx, fasthttp.StatusInternalServerError, err)
		return
	}
	writeJSON(ctx, fasthttp.StatusOK, map[string]any{"data": statuses})
}

func budgetQuery(ctx *fasthttp.RequestCtx) UsageQuery {
	return UsageQuery{
		ProjectID:     string(ctx.QueryArgs().Peek("project_id")),
		ApplicationID: string(ctx.QueryArgs().Peek("application_id")),
		Limit:         ctx.QueryArgs().GetUintOrZero("limit"),
		Offset:        ctx.QueryArgs().GetUintOrZero("offset"),
	}
}

func (h *Handler) listBudgetAlerts(ctx *fasthttp.RequestCtx) {
	query, err := budgetAlertQuery(ctx)
	if err != nil {
		writeError(ctx, fasthttp.StatusBadRequest, err)
		return
	}
	opCtx, cancel := controlPlaneContext()
	defer cancel()
	alerts, err := h.store.ListBudgetAlerts(opCtx, query)
	if err != nil {
		writeError(ctx, fasthttp.StatusInternalServerError, err)
		return
	}
	writeJSON(ctx, fasthttp.StatusOK, map[string]any{"data": alerts})
}

func (h *Handler) refreshBudgetAlerts(ctx context.Context) error {
	configured, err := h.store.HasUsageBudgets(ctx)
	if err != nil {
		return err
	}
	if !configured {
		configured, err = h.store.hasBudgetPolicyHistory(ctx)
		if err != nil || !configured {
			return err
		}
	}
	if err := h.syncBudgetUsage(ctx); err != nil {
		return err
	}
	_, err = h.store.EvaluateBudgetAlerts(ctx, time.Now().UTC())
	return err
}

func (h *Handler) syncBudgetUsage(ctx context.Context) error {
	if h.logManager == nil {
		return errBudgetUsageSourceUnavailable
	}
	return h.syncUsage(ctx, nil, nil, false)
}
