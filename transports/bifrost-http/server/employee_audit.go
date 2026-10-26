package server

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/employees"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func employeeAuditAppender(store configstore.ConfigStore, request *fasthttp.RequestCtx) employees.EmployeeAuditAppender {
	base := handlers.GovernanceAuditInput{
		Principal: handlers.AdminPrincipalFromRequest(request),
		RequestID: handlers.GovernanceRequestIDFromRequest(request),
		TraceID:   handlers.GovernanceTraceIDFromRequest(request),
		Outcome:   "success",
	}
	if actor, _ := request.UserValue(lib.FastHTTPUserValueManagementAuditActor).(string); actor != "" && base.Principal.Authenticated {
		base.Principal.ID = actor
	}
	if !encrypt.IsEnabled() {
		return compactEmployeeAuditAppender(base.Principal.ID)
	}
	return func(ctx context.Context, tx *gorm.DB, event employees.EmployeeAuditEvent) error {
		input := base
		input.Action, input.Resource, input.ResourceID = event.Action, event.Resource, event.ResourceID
		input.Before, input.After = event.Before, event.After
		return handlers.AppendGovernanceAudit(ctx, store, tx, input)
	}
}

func compactEmployeeAuditAppender(actorID string) employees.EmployeeAuditAppender {
	return func(ctx context.Context, tx *gorm.DB, event employees.EmployeeAuditEvent) error {
		return tx.WithContext(ctx).Create(&controlplane.AuditEvent{
			ID: uuid.NewString(), ActorID: actorID, Action: event.Action,
			ResourceType: event.Resource, ResourceID: event.ResourceID,
			CreatedAt: time.Now().UTC(),
		}).Error
	}
}
