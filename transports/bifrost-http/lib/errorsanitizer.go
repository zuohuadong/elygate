package lib

import (
	"slices"
	"strings"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/valyala/fasthttp"
)

const ClientSafeInternalErrorMessage = "internal server error"

// SanitizeBifrostErrorForClient returns a copy safe to serialize to API clients.
// Internal errors can contain stack traces or database details; keep those in logs only.
func SanitizeBifrostErrorForClient(err *schemas.BifrostError) *schemas.BifrostError {
	if err == nil {
		return nil
	}

	sanitized := *err
	if err.Error != nil {
		errorField := *err.Error
		if shouldHideErrorDetails(err, err.Error) {
			errorField.Message = ClientSafeInternalErrorMessage
			errorField.Error = nil
			errorField.Param = nil
		}
		sanitized.Error = &errorField
	}
	sanitized.ExtraFields.FallbackAttempts = sanitizeFallbackAttempts(err.ExtraFields.FallbackAttempts)

	return &sanitized
}

// NormalizeBifrostErrorStatusCode preserves the transport-selected status in
// the JSON body, including provider/model auto-resolution validation failures.
func NormalizeBifrostErrorStatusCode(err *schemas.BifrostError) *schemas.BifrostError {
	if err == nil || err.StatusCode != nil {
		return err
	}

	normalized := *err
	statusCode := fasthttp.StatusInternalServerError
	if !err.IsBifrostError || (err.Error != nil &&
		(err.Error.Message == bifrost.ProviderAutoResolveErrorMessage || err.Error.Message == bifrost.ModelAutoResolveErrorMessage)) {
		statusCode = fasthttp.StatusBadRequest
	}
	normalized.StatusCode = &statusCode
	return &normalized
}

// sanitizeFallbackAttempts applies the same check to each fallback's message, which an exhausted
// chain copies onto the primary's error. The slice is copied only when a message has to be hidden,
// so the original error, which logging may still hold, is never changed.
func sanitizeFallbackAttempts(attempts []schemas.FallbackAttempt) []schemas.FallbackAttempt {
	var out []schemas.FallbackAttempt
	for i, attempt := range attempts {
		if !containsStackTrace(attempt.Message) && !containsSQLDetails(attempt.Message) {
			continue
		}
		if out == nil {
			out = slices.Clone(attempts)
		}
		out[i].Message = ClientSafeInternalErrorMessage
	}
	if out == nil {
		return attempts
	}
	return out
}

func shouldHideErrorDetails(_ *schemas.BifrostError, field *schemas.ErrorField) bool {
	message := field.Message
	if field.Error != nil {
		message += " " + field.Error.Error()
	}

	return containsStackTrace(message) || containsSQLDetails(message)
}

func containsStackTrace(message string) bool {
	lower := strings.ToLower(message)
	return strings.Contains(lower, "stack trace") ||
		strings.Contains(lower, "traceback (most recent call last)") ||
		strings.Contains(lower, "runtime/debug.stack") ||
		strings.Contains(lower, "goroutine ") ||
		strings.Contains(lower, "panic:") ||
		strings.Contains(lower, ".go:")
}

func containsSQLDetails(message string) bool {
	lower := strings.ToLower(message)
	return strings.Contains(lower, "sqlstate") ||
		strings.Contains(lower, "sql:") ||
		strings.Contains(lower, "pq:") ||
		strings.Contains(lower, "pgx:") ||
		strings.Contains(lower, "duplicate key value violates") ||
		strings.Contains(lower, "violates foreign key constraint") ||
		strings.Contains(lower, "violates unique constraint") ||
		strings.Contains(lower, "syntax error at or near") ||
		strings.Contains(lower, "relation does not exist") ||
		strings.Contains(lower, "database/sql")
}
