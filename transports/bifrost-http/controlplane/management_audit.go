package controlplane

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

// ManagementAuditMiddleware persists the upstream handlers' committed changes.
// It deliberately stores identities only: snapshots can include user-authored
// content and require resource-specific redaction before durable storage.
func (h *Handler) ManagementAuditMiddleware(logger schemas.Logger) schemas.BifrostHTTPMiddleware {
	return func(next fasthttp.RequestHandler) fasthttp.RequestHandler {
		return func(request *fasthttp.RequestCtx) {
			actor := managementAuditActor(request)
			defer func() {
				changes, _ := request.UserValue(configstore.AuditChangesUserValueKey).([]configstore.AuditChange)
				if len(changes) == 0 {
					return
				}
				ctx, cancel := controlPlaneContext()
				defer cancel()
				if err := h.store.appendManagementAudit(ctx, actor, changes); err != nil {
					// The mutation may already have committed and its response may hold
					// a one-time secret. Do not replace it or invite an unsafe retry.
					request.SetUserValue(lib.FastHTTPUserValueAuditPersistenceFailed, true)
					request.Response.Header.Set(lib.HeaderAuditStatus, "failed")
					logger.Error("failed to persist management audit changes; administrative mutation may already be committed")
				}
			}()
			next(request)
		}
	}
}

func managementAuditActor(request *fasthttp.RequestCtx) string {
	if bypassed, _ := request.UserValue(schemas.BifrostContextKeyAuthBypassed).(bool); bypassed {
		return "anonymous"
	}
	if actor, _ := request.UserValue(lib.FastHTTPUserValueManagementAuditActor).(string); actor != "" {
		return actor
	}
	if actor := auditActor(request); actor != "" {
		return actor
	}
	if localAdmin, _ := request.UserValue(schemas.IsLocalAdminContextKey).(bool); localAdmin {
		return "local-admin"
	}
	return "anonymous"
}

func (s *Store) appendManagementAudit(ctx context.Context, actorID string, changes []configstore.AuditChange) error {
	now := time.Now().UTC()
	events := make([]AuditEvent, 0, len(changes))
	for _, change := range changes {
		resourceID := change.TargetID
		// Cache keys may contain the original prompt or user-provided secrets.
		if change.TargetType == "cache" {
			resourceID = fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(resourceID)))
		}
		events = append(events, AuditEvent{
			ID: uuid.NewString(), ActorID: actorID, Action: change.EventName,
			ResourceType: change.TargetType, ResourceID: resourceID, CreatedAt: now,
		})
	}
	return s.db(ctx).Transaction(func(tx *gorm.DB) error {
		return tx.CreateInBatches(&events, 100).Error
	})
}
