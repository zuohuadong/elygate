package schemas

import (
	"context"
	"time"
)

type NotificationSeverity string

const (
	NotificationSeverityInfo    NotificationSeverity = "info"
	NotificationSeveritySuccess NotificationSeverity = "success"
	NotificationSeverityWarning NotificationSeverity = "warning"
	NotificationSeverityError   NotificationSeverity = "error"
)

type NotificationAudience string

const (
	NotificationAudienceAll   NotificationAudience = "all"
	NotificationAudienceRoles NotificationAudience = "roles"
	NotificationAudienceAdmin NotificationAudience = "admin"
)

// Notification is a persisted dashboard notification. Read and dismissal
// state deliberately do not live here; those preferences are local to each UI.
type Notification struct {
	ID          string               `json:"id"`
	Audience    NotificationAudience `json:"audience"`
	RoleIDs     []uint               `json:"role_ids,omitempty"`
	Severity    NotificationSeverity `json:"severity"`
	Title       string               `json:"title"`
	Message     string               `json:"message"`
	ActionLabel string               `json:"action_label,omitempty"`
	ActionPath  string               `json:"action_path,omitempty"`
	CreatedAt   time.Time            `json:"created_at"`
	ExpiresAt   time.Time            `json:"expires_at"`
}

// NotificationInput is accepted by the in-process publisher and the admin API.
// IDs and timestamps are always assigned by the notification service.
type NotificationInput struct {
	Audience    NotificationAudience `json:"audience"`
	RoleIDs     []uint               `json:"role_ids,omitempty"`
	Severity    NotificationSeverity `json:"severity"`
	Title       string               `json:"title"`
	Message     string               `json:"message"`
	ActionLabel string               `json:"action_label,omitempty"`
	ActionPath  string               `json:"action_path,omitempty"`
}

// NotificationPublisher persists a notification and pushes it to every
// connected dashboard the audience covers. Producers use the notification
// service rather than writing feed rows directly, keeping WebSocket fan-out
// and audience validation together. Durable producers use its stable-ID
// publisher so a replay cannot insert a second notification.
type NotificationPublisher func(context.Context, NotificationInput) (*Notification, error)
