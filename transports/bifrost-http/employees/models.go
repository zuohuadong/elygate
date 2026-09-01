package employees

import (
	"time"

	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
)

type Employee struct {
	ID                 string               `gorm:"primaryKey;type:varchar(36)" json:"id"`
	Username           string               `gorm:"type:varchar(64);not null;uniqueIndex" json:"username"`
	Name               string               `gorm:"type:varchar(128);not null;index" json:"name"`
	JobTitle           string               `gorm:"type:varchar(128)" json:"job_title"`
	Department         string               `gorm:"type:varchar(128);index" json:"department"`
	Applications       string               `gorm:"type:varchar(255)" json:"applications"`
	AccountType        string               `gorm:"type:varchar(128)" json:"account_type"`
	PasswordHash       string               `gorm:"type:varchar(255);not null" json:"-"`
	IsActive           bool                 `gorm:"not null;default:true;index" json:"is_active"`
	MustChangePassword bool                 `gorm:"not null;default:true" json:"must_change_password"`
	FailedLoginCount   int                  `gorm:"not null;default:0" json:"-"`
	LockedUntil        *time.Time           `gorm:"index" json:"locked_until,omitempty"`
	LastLoginAt        *time.Time           `json:"last_login_at,omitempty"`
	ImportBatchID      *string              `gorm:"type:varchar(64);index" json:"import_batch_id,omitempty"`
	ImportBatch        *EmployeeImportBatch `gorm:"foreignKey:ImportBatchID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT" json:"-"`
	CreatedAt          time.Time            `gorm:"not null;index" json:"created_at"`
	UpdatedAt          time.Time            `gorm:"not null" json:"updated_at"`
}

func (Employee) TableName() string { return "elygate_employees" }

type EmployeeVirtualKey struct {
	EmployeeID   string                       `gorm:"primaryKey;type:varchar(36);index" json:"employee_id"`
	VirtualKeyID string                       `gorm:"primaryKey;type:varchar(255);uniqueIndex" json:"virtual_key_id"`
	CreatedAt    time.Time                    `gorm:"not null" json:"created_at"`
	Employee     Employee                     `gorm:"foreignKey:EmployeeID;constraint:OnDelete:CASCADE" json:"-"`
	VirtualKey   configtables.TableVirtualKey `gorm:"foreignKey:VirtualKeyID;constraint:OnDelete:CASCADE" json:"-"`
}

func (EmployeeVirtualKey) TableName() string { return "elygate_employee_virtual_keys" }

type EmployeeSession struct {
	ID            string    `gorm:"primaryKey;type:varchar(36)" json:"id"`
	EmployeeID    string    `gorm:"type:varchar(36);not null;index" json:"employee_id"`
	TokenHash     string    `gorm:"type:varchar(64);not null;uniqueIndex" json:"-"`
	CSRFTokenHash string    `gorm:"type:varchar(64);not null" json:"-"`
	ExpiresAt     time.Time `gorm:"not null;index" json:"expires_at"`
	CreatedAt     time.Time `gorm:"not null;index" json:"created_at"`
	Employee      Employee  `gorm:"foreignKey:EmployeeID;constraint:OnDelete:CASCADE" json:"-"`
}

func (EmployeeSession) TableName() string { return "elygate_employee_sessions" }

type EmployeeImportBatch struct {
	ID            string     `gorm:"primaryKey;type:varchar(64)" json:"id"`
	PayloadDigest string     `gorm:"type:varchar(64);not null" json:"payload_digest"`
	EmployeeCount int        `gorm:"not null" json:"employee_count"`
	RolledBackAt  *time.Time `json:"rolled_back_at,omitempty"`
	CreatedAt     time.Time  `gorm:"not null;index" json:"created_at"`
}

func (EmployeeImportBatch) TableName() string { return "elygate_employee_import_batches" }

type EmployeeVirtualKeyScope struct {
	VirtualKeyID string
	CreatedAt    time.Time
}

type VirtualKeyView struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description,omitempty"`
	IsActive    bool       `json:"is_active"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	MaskedValue string     `json:"masked_value"`
}

type EmployeeView struct {
	Employee
	VirtualKeys []VirtualKeyView `json:"virtual_keys"`
}
