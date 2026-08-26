package tables

import "time"

// TableGovernanceAuditHead serializes append operations and records the
// authoritative tail of the governance audit chain.
type TableGovernanceAuditHead struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	LastSequence uint64    `gorm:"not null" json:"last_sequence"`
	LastHash     string    `gorm:"type:varchar(64);not null" json:"last_hash"`
	UpdatedAt    time.Time `gorm:"not null" json:"updated_at"`
}

func (TableGovernanceAuditHead) TableName() string { return "governance_audit_head" }

// TableGovernanceAuditPublicKey retains the verification material for every
// signing key that has contributed to the audit chain.
type TableGovernanceAuditPublicKey struct {
	KeyID     string    `gorm:"type:varchar(64);primaryKey" json:"key_id"`
	Algorithm string    `gorm:"type:varchar(32);not null" json:"algorithm"`
	PublicKey string    `gorm:"type:text;not null" json:"public_key"`
	CreatedAt time.Time `gorm:"not null" json:"created_at"`
}

func (TableGovernanceAuditPublicKey) TableName() string { return "governance_audit_public_keys" }

// TableGovernanceAuditEvent is append-only application data. No update or
// delete method is exposed by the governance audit store.
type TableGovernanceAuditEvent struct {
	Sequence      uint64    `gorm:"primaryKey;autoIncrement:false" json:"sequence"`
	ID            string    `gorm:"type:varchar(36);uniqueIndex;not null" json:"id"`
	SchemaVersion uint      `gorm:"not null" json:"schema_version"`
	OccurredAt    time.Time `gorm:"not null;index" json:"occurred_at"`
	ActorID       string    `gorm:"type:varchar(255);not null;index" json:"actor_id"`
	ActorName     string    `gorm:"type:varchar(255);not null" json:"actor_name"`
	AuthMethod    string    `gorm:"type:varchar(32);not null" json:"auth_method"`
	RoleID        string    `gorm:"type:varchar(64)" json:"role_id,omitempty"`
	LocalAdmin    bool      `gorm:"not null" json:"local_admin"`
	Action        string    `gorm:"type:varchar(96);not null;index" json:"action"`
	Resource      string    `gorm:"type:varchar(64);not null;index:idx_governance_audit_resource,priority:1" json:"resource"`
	ResourceID    string    `gorm:"type:varchar(255);not null;index:idx_governance_audit_resource,priority:2" json:"resource_id"`
	Outcome       string    `gorm:"type:varchar(16);not null;index" json:"outcome"`
	RequestID     string    `gorm:"type:varchar(128);index" json:"request_id,omitempty"`
	TraceID       string    `gorm:"type:varchar(128);index" json:"trace_id,omitempty"`
	BeforeJSON    string    `gorm:"type:text;not null" json:"before_json"`
	AfterJSON     string    `gorm:"type:text;not null" json:"after_json"`
	MetadataJSON  string    `gorm:"type:text;not null" json:"metadata_json"`
	PreviousHash  string    `gorm:"type:varchar(64);not null" json:"previous_hash"`
	EventHash     string    `gorm:"type:varchar(64);uniqueIndex;not null" json:"event_hash"`
	Signature     string    `gorm:"type:text;not null" json:"signature"`
	KeyID         string    `gorm:"type:varchar(64);not null;index" json:"key_id"`
}

func (TableGovernanceAuditEvent) TableName() string { return "governance_audit_events" }
