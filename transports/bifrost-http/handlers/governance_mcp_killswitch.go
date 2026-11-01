package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type mcpKillSwitchMutation struct {
	Scope     string     `json:"scope"`
	Target    string     `json:"target"`
	Enabled   bool       `json:"enabled"`
	Reason    string     `json:"reason,omitempty"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

func (h *GovernanceHandler) getMCPKillSwitches(ctx *fasthttp.RequestCtx) {
	switches, err := h.readMCPKillSwitches(governanceDatabaseContext())
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "failed to read MCP kill switches")
		return
	}
	SendJSON(ctx, map[string]any{
		"config_key": governance.MCPKillSwitchConfigKey,
		"switches":   switches,
	})
}

func (h *GovernanceHandler) updateMCPKillSwitch(ctx *fasthttp.RequestCtx) {
	var payload mcpKillSwitchMutation
	decoder := json.NewDecoder(bytes.NewReader(ctx.PostBody()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("invalid JSON: %v", err))
		return
	}
	rule := governance.MCPKillSwitch{
		Scope:     payload.Scope,
		Target:    payload.Target,
		Enabled:   payload.Enabled,
		Reason:    payload.Reason,
		ExpiresAt: payload.ExpiresAt,
		UpdatedAt: time.Now().UTC(),
	}
	if err := governance.ValidateMCPKillSwitch(rule); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	rule.Scope = strings.ToLower(strings.TrimSpace(rule.Scope))
	rule.Target = strings.TrimSpace(rule.Target)
	rule.Reason = strings.TrimSpace(rule.Reason)
	if rule.Scope == governance.MCPKillSwitchScopeGlobal && rule.Target == "" {
		rule.Target = "*"
	}
	if rule.ExpiresAt != nil {
		expiresAt := rule.ExpiresAt.UTC()
		rule.ExpiresAt = &expiresAt
	}
	ctxDB := governanceDatabaseContext()
	var persisted []governance.MCPKillSwitch
	if err := h.configStore.ExecuteTransaction(ctxDB, func(tx *gorm.DB) error {
		row := configstoreTables.TableGovernanceConfig{}
		query := tx.WithContext(ctxDB).Where("key = ?", governance.MCPKillSwitchConfigKey)
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		err := query.First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			row.Key = governance.MCPKillSwitchConfigKey
			row.Value = ""
		} else if err != nil {
			return err
		}
		persisted, err = governance.DecodeMCPKillSwitches(row.Value)
		if err != nil {
			return err
		}
		replaced := false
		for i := range persisted {
			if persisted[i].Scope == rule.Scope && persisted[i].Target == rule.Target {
				persisted[i] = rule
				replaced = true
				break
			}
		}
		if !replaced {
			persisted = append(persisted, rule)
		}
		row.Value, err = governance.EncodeMCPKillSwitches(persisted, rule.UpdatedAt)
		if err != nil {
			return err
		}
		return tx.WithContext(ctxDB).Save(&row).Error
	}); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("failed to persist MCP kill switch: %v", err))
		return
	}
	lib.RecordAuditChange(ctx, "mcp_kill_switch.updated", "mcp_kill_switch", rule.Scope+":"+rule.Target, rule.Target, nil, map[string]any{
		"scope": rule.Scope, "target": rule.Target, "enabled": rule.Enabled, "reason": rule.Reason, "expires_at": rule.ExpiresAt,
	})
	SendJSON(ctx, map[string]any{"kill_switch": rule, "switches": persisted})
}

func (h *GovernanceHandler) deleteMCPKillSwitch(ctx *fasthttp.RequestCtx) {
	scope := strings.ToLower(strings.TrimSpace(string(ctx.QueryArgs().Peek("scope"))))
	target := strings.TrimSpace(string(ctx.QueryArgs().Peek("target")))
	if scope == "" || target == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "scope and target are required")
		return
	}
	var removed bool
	ctxDB := governanceDatabaseContext()
	var persisted []governance.MCPKillSwitch
	if err := h.configStore.ExecuteTransaction(ctxDB, func(tx *gorm.DB) error {
		row := configstoreTables.TableGovernanceConfig{}
		query := tx.WithContext(ctxDB).Where("key = ?", governance.MCPKillSwitchConfigKey)
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		err := query.First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		persisted, err = governance.DecodeMCPKillSwitches(row.Value)
		if err != nil {
			return err
		}
		next := persisted[:0]
		for _, rule := range persisted {
			if rule.Scope == scope && rule.Target == target {
				removed = true
				continue
			}
			next = append(next, rule)
		}
		persisted = next
		if !removed {
			return nil
		}
		row.Value, err = governance.EncodeMCPKillSwitches(persisted, time.Now().UTC())
		if err != nil {
			return err
		}
		return tx.WithContext(ctxDB).Save(&row).Error
	}); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("failed to delete MCP kill switch: %v", err))
		return
	}
	if !removed {
		SendError(ctx, fasthttp.StatusNotFound, "MCP kill switch not found")
		return
	}
	lib.RecordAuditChange(ctx, "mcp_kill_switch.deleted", "mcp_kill_switch", scope+":"+target, target, map[string]any{
		"scope": scope, "target": target,
	}, nil)
	SendJSON(ctx, map[string]any{"deleted": true, "scope": scope, "target": target, "switches": persisted})
}

func (h *GovernanceHandler) readMCPKillSwitches(ctx context.Context) ([]governance.MCPKillSwitch, error) {
	row, err := h.configStore.GetConfig(ctx, governance.MCPKillSwitchConfigKey)
	if errors.Is(err, configstore.ErrNotFound) {
		return []governance.MCPKillSwitch{}, nil
	}
	if err != nil {
		return nil, err
	}
	return governance.DecodeMCPKillSwitches(row.Value)
}
