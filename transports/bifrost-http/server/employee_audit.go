package server

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
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
	return transactionalEmployeeAuditAppender(store, base)
}

func employeeSelfServiceAuditAppender(store configstore.ConfigStore, request *fasthttp.RequestCtx, employeeID string) employees.EmployeeAuditAppender {
	// This principal is an audit value only; never attach it to authorization.
	return transactionalEmployeeAuditAppender(store, handlers.GovernanceAuditInput{
		Principal: handlers.AdminPrincipal{
			ID: "employee:" + employeeID, Name: "Employee",
			AuthMethod: "employee-session", Authenticated: true,
		},
		RequestID: handlers.GovernanceRequestIDFromRequest(request),
		TraceID:   handlers.GovernanceTraceIDFromRequest(request), Outcome: "success",
	})
}

func employeeLoginFailureAuditor(store configstore.ConfigStore, logger schemas.Logger) func(context.Context) error {
	return func(ctx context.Context) error {
		appendAudit := transactionalEmployeeAuditAppender(store, handlers.GovernanceAuditInput{
			Principal: handlers.AdminPrincipal{ID: "anonymous", Name: "Anonymous", AuthMethod: "none"},
			Outcome:   "denied",
		})
		err := store.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
			return appendAudit(ctx, tx, employees.EmployeeAuditEvent{
				Action: "employee_session.login_failed", Resource: "employee_session", ResourceID: "employee",
			})
		})
		if err != nil {
			logger.Error("failed to persist employee login rejection audit")
		}
		return err
	}
}

func transactionalEmployeeAuditAppender(store configstore.ConfigStore, base handlers.GovernanceAuditInput) employees.EmployeeAuditAppender {
	if !encrypt.IsEnabled() {
		return compactEmployeeAuditAppender(base.Principal.ID)
	}
	return func(ctx context.Context, tx *gorm.DB, event employees.EmployeeAuditEvent) error {
		input := base
		if event.AuditAuthMethod != "" {
			input.Principal.AuthMethod = event.AuditAuthMethod
		}
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
