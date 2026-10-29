package controlplane

import (
	"context"
	"errors"
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

type auditCorrelation struct {
	requestID string
	traceID   string
}

type auditCorrelationContextKey struct{}

func auditCorrelationFromRequest(request *fasthttp.RequestCtx) auditCorrelation {
	requestID, _ := request.UserValue(schemas.BifrostContextKeyRequestID).(string)
	if requestID == "" {
		requestID = string(request.Response.Header.Peek(lib.HeaderBifrostRequestID))
	}
	if requestID == "" {
		requestID = string(request.Request.Header.Peek(lib.HeaderRequestID))
	}
	traceID, _ := request.UserValue(schemas.BifrostContextKeyExportTraceID).(string)
	if traceID == "" {
		traceID = string(request.Response.Header.Peek(lib.HeaderBifrostTraceID))
	}
	return normalizedAuditCorrelation(requestID, traceID)
}

func normalizedAuditCorrelation(requestID, traceID string) auditCorrelation {
	correlation := auditCorrelation{}
	if validAuditRequestID(requestID) {
		correlation.requestID = strings.Clone(requestID)
	}
	if validAuditTraceID(traceID) {
		correlation.traceID = strings.Clone(traceID)
	}
	return correlation
}

func validAuditRequestID(requestID string) bool {
	// Drop invalid identifiers instead of truncating them into false correlations.
	if len(requestID) == 0 || len(requestID) > 128 {
		return false
	}
	for _, char := range []byte(requestID) {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' ||
			char >= '0' && char <= '9' || char == '-' || char == '_' || char == '.' || char == ':') {
			return false
		}
	}
	return true
}

func validAuditTraceID(traceID string) bool {
	if len(traceID) != 32 || traceID == "00000000000000000000000000000000" {
		return false
	}
	for _, char := range []byte(traceID) {
		if !(char >= '0' && char <= '9' || char >= 'a' && char <= 'f') {
			return false
		}
	}
	return true
}

func controlPlaneAuditContext(request *fasthttp.RequestCtx) (context.Context, context.CancelFunc) {
	ctx, cancel := controlPlaneContext()
	return withAuditCorrelation(ctx, auditCorrelationFromRequest(request)), cancel
}

func withAuditCorrelation(ctx context.Context, correlation auditCorrelation) context.Context {
	if correlation == (auditCorrelation{}) {
		return ctx
	}
	return context.WithValue(ctx, auditCorrelationContextKey{}, correlation)
}

func auditCorrelationFromContext(ctx context.Context) auditCorrelation {
	if request, ok := ctx.(*fasthttp.RequestCtx); ok {
		return auditCorrelationFromRequest(request)
	}
	correlation, _ := ctx.Value(auditCorrelationContextKey{}).(auditCorrelation)
	return correlation
}

func migrateAuditCorrelation(tx *gorm.DB) error {
	for _, field := range []string{"RequestID", "TraceID"} {
		if !tx.Migrator().HasColumn(&AuditEvent{}, field) {
			if err := tx.Migrator().AddColumn(&AuditEvent{}, field); err != nil {
				return err
			}
		}
	}
	return nil
}

func auditCorrelationRollback(*gorm.DB) error {
	return errors.New("audit correlation is non-rollbackable: dropping it loses recorded request and trace identifiers")
}
