package controlplane

import "time"

// Project is the enterprise ownership boundary for applications and usage.
type Project struct {
	ID             string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	OrganizationID string    `gorm:"type:varchar(36);not null;index" json:"organization_id"`
	Name           string    `gorm:"type:varchar(128);not null" json:"name"`
	Status         string    `gorm:"type:varchar(32);not null;default:'active';index" json:"status"`
	CreatedAt      time.Time `gorm:"not null;index" json:"created_at"`
	UpdatedAt      time.Time `gorm:"not null" json:"updated_at"`
}

func (Project) TableName() string { return "elygate_control_projects" }

type Application struct {
	ID          string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	ProjectID   string    `gorm:"type:varchar(36);not null;index" json:"project_id"`
	Name        string    `gorm:"type:varchar(128);not null" json:"name"`
	Environment string    `gorm:"type:varchar(32);not null;default:'production';index" json:"environment"`
	Status      string    `gorm:"type:varchar(32);not null;default:'active';index" json:"status"`
	CreatedAt   time.Time `gorm:"not null;index" json:"created_at"`
	UpdatedAt   time.Time `gorm:"not null" json:"updated_at"`
}

func (Application) TableName() string { return "elygate_control_applications" }

type ApplicationVirtualKeyBinding struct {
	ID            string     `gorm:"primaryKey;type:varchar(36)" json:"id"`
	ApplicationID string     `gorm:"type:varchar(36);not null;index" json:"application_id"`
	VirtualKeyID  string     `gorm:"type:varchar(255);not null;index" json:"virtual_key_id"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	RevokedAt     *time.Time `gorm:"index" json:"revoked_at,omitempty"`
	CreatedAt     time.Time  `gorm:"not null;index" json:"created_at"`
	UpdatedAt     time.Time  `gorm:"not null" json:"updated_at"`
}

func (ApplicationVirtualKeyBinding) TableName() string { return "elygate_control_app_vk_bindings" }

type UsageLedgerEntry struct {
	ID            string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	SourceLogID   string    `gorm:"type:varchar(255);not null;uniqueIndex:idx_cp_usage_source" json:"source_log_id"`
	OccurredAt    time.Time `gorm:"not null;index" json:"occurred_at"`
	ProjectID     string    `gorm:"type:varchar(36);not null;index" json:"project_id"`
	ApplicationID string    `gorm:"type:varchar(36);not null;index" json:"application_id"`
	VirtualKeyID  string    `gorm:"type:varchar(255);not null;index" json:"virtual_key_id"`
	TeamID        *string   `gorm:"type:varchar(255);index" json:"team_id,omitempty"`
	CustomerID    *string   `gorm:"type:varchar(255);index" json:"customer_id,omitempty"`
	UserID        *string   `gorm:"type:varchar(255);index" json:"user_id,omitempty"`
	Provider      string    `gorm:"type:varchar(128);not null;index" json:"provider"`
	Model         string    `gorm:"type:varchar(255);not null;index" json:"model"`
	Status        string    `gorm:"type:varchar(32);not null;index" json:"status"`
	PromptTokens  int       `gorm:"not null;default:0" json:"prompt_tokens"`
	OutputTokens  int       `gorm:"not null;default:0" json:"output_tokens"`
	TotalTokens   int       `gorm:"not null;default:0" json:"total_tokens"`
	Cost          float64   `gorm:"not null;default:0" json:"cost"`
	TraceID       *string   `gorm:"type:varchar(255)" json:"trace_id,omitempty"`
	ProjectionVer int       `gorm:"not null;default:1" json:"projection_version"`
	CreatedAt     time.Time `gorm:"not null;index" json:"created_at"`
}

func (UsageLedgerEntry) TableName() string { return "elygate_control_usage_ledger" }

type UsageLedgerCheckpoint struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Watermark time.Time `gorm:"index" json:"watermark"`
	LastLogID string    `gorm:"type:varchar(255)" json:"last_log_id"`
	UpdatedAt time.Time `gorm:"not null" json:"updated_at"`
}

func (UsageLedgerCheckpoint) TableName() string { return "elygate_control_usage_checkpoints" }

type AuditEvent struct {
	ID           string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	ActorID      string    `gorm:"type:varchar(255);not null;index" json:"actor_id"`
	Action       string    `gorm:"type:varchar(128);not null;index" json:"action"`
	ResourceType string    `gorm:"type:varchar(64);not null;index" json:"resource_type"`
	ResourceID   string    `gorm:"type:varchar(255);not null;index" json:"resource_id"`
	CreatedAt    time.Time `gorm:"not null;index" json:"created_at"`
}

func (AuditEvent) TableName() string { return "elygate_control_audit_events" }

// VirtualKeyRevocation is a durable deny tombstone for a credential value that
// must never become valid again after rotation or revocation. It closes the
// fail-open window where an old value remains in an in-memory governance cache.
type VirtualKeyRevocation struct {
	ValueHash    string    `gorm:"primaryKey;type:varchar(64)" json:"-"`
	VirtualKeyID string    `gorm:"type:varchar(255);not null;index" json:"virtual_key_id"`
	Reason       string    `gorm:"type:varchar(32);not null" json:"reason"`
	RevokedAt    time.Time `gorm:"not null;index" json:"revoked_at"`
}

func (VirtualKeyRevocation) TableName() string { return "elygate_control_vk_revocations" }
