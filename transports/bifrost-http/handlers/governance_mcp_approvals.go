package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/governance"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type mcpApprovalMutation struct {
	ClientName string `json:"client_name"`
	ToolName   string `json:"tool_name"`
	TTLSeconds int64  `json:"ttl_seconds"`
	Reason     string `json:"reason,omitempty"`
}

type mcpApprovalView struct {
	governance.MCPExecutionApproval
	Status string `json:"status"`
}

func (h *GovernanceHandler) getMCPApprovals(ctx *fasthttp.RequestCtx) {
	records, err := h.readMCPApprovalRecords(governanceDatabaseContext())
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "failed to read MCP approvals")
		return
	}
	SendJSON(ctx, map[string]any{
		"config_key": governance.MCPApprovalConfigKey,
		"approvals":  mcpApprovalViews(records, time.Now().UTC()),
	})
}

func (h *GovernanceHandler) issueMCPApproval(ctx *fasthttp.RequestCtx) {
	var payload mcpApprovalMutation
	decoder := json.NewDecoder(bytes.NewReader(ctx.PostBody()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("invalid JSON: %v", err))
		return
	}
	clientName := strings.TrimSpace(payload.ClientName)
	toolName := strings.TrimSpace(payload.ToolName)
	if err := governance.ValidateMCPExecutionApprovalTarget(clientName, toolName); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	if payload.TTLSeconds < int64(governance.MCPApprovalMinTTL/time.Second) ||
		payload.TTLSeconds > int64(governance.MCPApprovalMaxTTL/time.Second) {
		SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("ttl_seconds must be between %d and %d", int64(governance.MCPApprovalMinTTL/time.Second), int64(governance.MCPApprovalMaxTTL/time.Second)))
		return
	}
	ttl := time.Duration(payload.TTLSeconds) * time.Second
	if err := governance.ValidateMCPExecutionApprovalTTL(ttl); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	reason := strings.TrimSpace(payload.Reason)
	if err := governance.ValidateMCPExecutionApprovalReason(reason); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	token, err := governance.GenerateMCPApprovalToken()
	if err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, "failed to issue MCP approval")
		return
	}
	now := time.Now().UTC()
	record := governance.MCPExecutionApprovalRecord{
		MCPExecutionApproval: governance.MCPExecutionApproval{
			ID:         uuid.NewString(),
			ClientName: clientName,
			ToolName:   toolName,
			IssuedAt:   now,
			ExpiresAt:  now.Add(ttl),
			Reason:     reason,
		},
		TokenHash: governance.HashMCPApprovalToken(token),
	}
	var persisted []governance.MCPExecutionApprovalRecord
	ctxDB := governanceDatabaseContext()
	if err := h.configStore.ExecuteTransaction(ctxDB, func(tx *gorm.DB) error {
		row := configstoreTables.TableGovernanceConfig{}
		query := tx.WithContext(ctxDB).Where("key = ?", governance.MCPApprovalConfigKey)
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		err := query.First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			row.Key = governance.MCPApprovalConfigKey
			row.Value = ""
		} else if err != nil {
			return err
		}
		persisted, err = governance.DecodeMCPApprovalRecords(row.Value)
		if err != nil {
			return err
		}
		persisted = append(persisted, record)
		row.Value, err = governance.EncodeMCPApprovalRecords(persisted, now)
		if err != nil {
			return err
		}
		return tx.WithContext(ctxDB).Save(&row).Error
	}); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("failed to persist MCP approval: %v", err))
		return
	}
	lib.RecordAuditChange(ctx, "mcp_approval.issued", "mcp_approval", record.ID, record.ClientName+"/"+record.ToolName, nil, map[string]any{
		"client_name": record.ClientName,
		"tool_name":   record.ToolName,
		"expires_at":  record.ExpiresAt,
		"reason":      record.Reason,
	})
	// The bearer is returned exactly once. It is deliberately excluded from
	// the audit payload and all persisted representations.
	SendJSON(ctx, map[string]any{
		"approval": mcpApprovalView{MCPExecutionApproval: record.MCPExecutionApproval, Status: "active"},
		"token":    token,
	})
}

func (h *GovernanceHandler) revokeMCPApproval(ctx *fasthttp.RequestCtx) {
	id := strings.TrimSpace(mcpApprovalID(ctx))
	if id == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "approval_id is required")
		return
	}
	now := time.Now().UTC()
	var revoked governance.MCPExecutionApprovalRecord
	var found, changed bool
	ctxDB := governanceDatabaseContext()
	if err := h.configStore.ExecuteTransaction(ctxDB, func(tx *gorm.DB) error {
		row := configstoreTables.TableGovernanceConfig{}
		query := tx.WithContext(ctxDB).Where("key = ?", governance.MCPApprovalConfigKey)
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
		records, err := governance.DecodeMCPApprovalRecords(row.Value)
		if err != nil {
			return err
		}
		for i := range records {
			if records[i].ID != id {
				continue
			}
			found = true
			revoked = records[i]
			if records[i].RevokedAt == nil {
				records[i].RevokedAt = &now
				revoked = records[i]
				changed = true
			}
			break
		}
		if !changed {
			return nil
		}
		row.Value, err = governance.EncodeMCPApprovalRecords(records, now)
		if err != nil {
			return err
		}
		return tx.WithContext(ctxDB).Save(&row).Error
	}); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("failed to revoke MCP approval: %v", err))
		return
	}
	if !found {
		SendError(ctx, fasthttp.StatusNotFound, "MCP approval not found")
		return
	}
	if changed {
		lib.RecordAuditChange(ctx, "mcp_approval.revoked", "mcp_approval", revoked.ID, revoked.ClientName+"/"+revoked.ToolName, nil, map[string]any{
			"client_name": revoked.ClientName,
			"tool_name":   revoked.ToolName,
		})
	}
	SendJSON(ctx, map[string]any{
		"revoked":  changed,
		"approval": mcpApprovalView{MCPExecutionApproval: revoked.MCPExecutionApproval, Status: mcpApprovalStatus(revoked, now)},
	})
}

func (h *GovernanceHandler) readMCPApprovalRecords(ctx context.Context) ([]governance.MCPExecutionApprovalRecord, error) {
	row, err := h.configStore.GetConfig(ctx, governance.MCPApprovalConfigKey)
	if errors.Is(err, configstore.ErrNotFound) {
		return []governance.MCPExecutionApprovalRecord{}, nil
	}
	if err != nil {
		return nil, err
	}
	return governance.DecodeMCPApprovalRecords(row.Value)
}

func mcpApprovalID(ctx *fasthttp.RequestCtx) string {
	if id, _ := ctx.UserValue("approval_id").(string); id != "" {
		return id
	}
	return strings.TrimSpace(string(ctx.QueryArgs().Peek("approval_id")))
}

func mcpApprovalViews(records []governance.MCPExecutionApprovalRecord, now time.Time) []mcpApprovalView {
	views := make([]mcpApprovalView, 0, len(records))
	for _, record := range records {
		views = append(views, mcpApprovalView{
			MCPExecutionApproval: record.MCPExecutionApproval,
			Status:               mcpApprovalStatus(record, now),
		})
	}
	return views
}

func mcpApprovalStatus(record governance.MCPExecutionApprovalRecord, now time.Time) string {
	if record.RevokedAt != nil {
		return "revoked"
	}
	if !now.Before(record.ExpiresAt) {
		return "expired"
	}
	return "active"
}
