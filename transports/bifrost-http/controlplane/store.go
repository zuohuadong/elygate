package controlplane

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/maximhq/bifrost/framework/migrator"
	"github.com/maximhq/bifrost/plugins/governance"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Store struct {
	configStore configstore.ConfigStore
	tx          *gorm.DB
}

// ApplicationKey is the one-time disclosed credential returned by application
// key lifecycle endpoints. The persisted Virtual Key remains the source of
// truth; Value is intentionally only populated for create/rotate responses.
type ApplicationKey struct {
	VirtualKeyID  string     `json:"virtual_key_id"`
	ApplicationID string     `json:"application_id"`
	BindingID     string     `json:"binding_id"`
	Name          string     `json:"name"`
	Value         string     `json:"value"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
}

func NewStore(ctx context.Context, configStore configstore.ConfigStore) (*Store, error) {
	if configStore == nil {
		return nil, errors.New("control plane store requires config store")
	}
	migrations := []*migrator.Migration{
		{
			ID: "elygate_control_plane_v1",
			Migrate: func(tx *gorm.DB) error {
				if err := tx.AutoMigrate(&Project{}, &Application{}, &ApplicationVirtualKeyBinding{}, &UsageLedgerEntry{}, &UsageLedgerCheckpoint{}, &AuditEvent{}); err != nil {
					return err
				}
				return tx.FirstOrCreate(&UsageLedgerCheckpoint{ID: 1}, "id = ?", 1).Error
			},
			Rollback: func(tx *gorm.DB) error {
				return tx.Migrator().DropTable(&AuditEvent{}, &UsageLedgerEntry{}, &UsageLedgerCheckpoint{}, &ApplicationVirtualKeyBinding{}, &Application{}, &Project{})
			},
		},
		{
			ID: "elygate_control_plane_v2_active_binding_unique",
			Migrate: func(tx *gorm.DB) error {
				if tx.Dialector.Name() != "sqlite" && tx.Dialector.Name() != "postgres" {
					return nil
				}
				return tx.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_active_vk_binding ON elygate_control_app_vk_bindings (virtual_key_id) WHERE revoked_at IS NULL").Error
			},
			Rollback: func(tx *gorm.DB) error {
				if tx.Dialector.Name() != "sqlite" && tx.Dialector.Name() != "postgres" {
					return nil
				}
				return tx.Exec("DROP INDEX IF EXISTS idx_cp_active_vk_binding").Error
			},
		},
		{
			ID:       "elygate_control_plane_v3_vk_revocations",
			Migrate:  func(tx *gorm.DB) error { return tx.AutoMigrate(&VirtualKeyRevocation{}) },
			Rollback: func(tx *gorm.DB) error { return tx.Migrator().DropTable(&VirtualKeyRevocation{}) },
		},
		{
			ID:      "elygate_control_plane_v4_usage_session_tree",
			Migrate: func(tx *gorm.DB) error { return tx.AutoMigrate(&UsageLedgerEntry{}) },
			Rollback: func(tx *gorm.DB) error {
				for _, column := range []string{"session_id", "parent_session_id", "agent_name", "session_client_type", "is_subagent", "is_fork"} {
					if tx.Migrator().HasColumn(&UsageLedgerEntry{}, column) {
						if err := tx.Migrator().DropColumn(&UsageLedgerEntry{}, column); err != nil {
							return err
						}
					}
				}
				return nil
			},
		},
	}
	migrationIDs := make([]string, 0, len(migrations))
	for _, migration := range migrations {
		migrationIDs = append(migrationIDs, migration.ID)
	}
	pending, err := migrator.PendingIDs(ctx, configStore.DB(), nil, migrationIDs)
	if err != nil {
		return nil, fmt.Errorf("check control plane migration: %w", err)
	}
	if len(pending) > 0 {
		pendingSet := make(map[string]struct{}, len(pending))
		for _, id := range pending {
			pendingSet[id] = struct{}{}
		}
		for _, migration := range migrations {
			if _, ok := pendingSet[migration.ID]; !ok {
				continue
			}
			if err := configStore.RunMigration(ctx, func(ctx context.Context, db *gorm.DB) error {
				return configstore.RunSingleMigration(ctx, nil, db, nil, migration)
			}); err != nil {
				return nil, fmt.Errorf("run control plane migration %s: %w", migration.ID, err)
			}
		}
		if err := configStore.RefreshConnectionPool(ctx); err != nil {
			return nil, fmt.Errorf("refresh control plane pool: %w", err)
		}
	}
	return &Store{configStore: configStore}, nil
}

func (s *Store) db(ctx context.Context) *gorm.DB {
	if s.tx != nil {
		return s.tx.WithContext(ctx)
	}
	return s.configStore.DB().WithContext(ctx)
}

func (s *Store) CreateProject(ctx context.Context, project *Project) error {
	if err := prepareProject(project); err != nil {
		return err
	}
	return s.db(ctx).Create(project).Error
}

func prepareProject(project *Project) error {
	project.ID = uuid.NewString()
	project.Name = strings.TrimSpace(project.Name)
	project.Status = "active"
	now := time.Now().UTC()
	project.CreatedAt = now
	project.UpdatedAt = now
	if project.OrganizationID == "" {
		project.OrganizationID = "default"
	}
	if project.Name == "" {
		return errors.New("project name is required")
	}
	return nil
}

func (s *Store) CreateProjectWithAudit(ctx context.Context, project *Project, actorID string) error {
	if err := prepareProject(project); err != nil {
		return err
	}
	return s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(project).Error; err != nil {
			return err
		}
		return appendAuditTx(tx, actorID, "project.create", "project", project.ID)
	})
}

func (s *Store) ListBindings(ctx context.Context, applicationID string) ([]ApplicationVirtualKeyBinding, error) {
	var out []ApplicationVirtualKeyBinding
	err := s.db(ctx).Where("application_id = ?", applicationID).Order("created_at DESC").Find(&out).Error
	return out, err
}

func (s *Store) ListProjects(ctx context.Context) ([]Project, error) {
	var out []Project
	err := s.db(ctx).Order("created_at DESC").Find(&out).Error
	return out, err
}
func (s *Store) GetProject(ctx context.Context, id string) (*Project, error) {
	var out Project
	err := s.db(ctx).First(&out, "id = ?", id).Error
	return &out, err
}

func (s *Store) CreateApplication(ctx context.Context, app *Application) error {
	if err := s.prepareApplication(ctx, app); err != nil {
		return err
	}
	return s.db(ctx).Create(app).Error
}

func (s *Store) prepareApplication(ctx context.Context, app *Application) error {
	if strings.TrimSpace(app.Name) == "" || app.ProjectID == "" {
		return errors.New("project_id and application name are required")
	}
	if _, err := s.GetProject(ctx, app.ProjectID); err != nil {
		return err
	}
	app.ID = uuid.NewString()
	app.Name = strings.TrimSpace(app.Name)
	if app.Environment == "" {
		app.Environment = "production"
	}
	app.Status = "active"
	now := time.Now().UTC()
	app.CreatedAt = now
	app.UpdatedAt = now
	return nil
}

func (s *Store) CreateApplicationWithAudit(ctx context.Context, app *Application, actorID string) error {
	if err := s.prepareApplication(ctx, app); err != nil {
		return err
	}
	return s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(app).Error; err != nil {
			return err
		}
		return appendAuditTx(tx, actorID, "application.create", "application", app.ID)
	})
}

func (s *Store) ListApplications(ctx context.Context, projectID string) ([]Application, error) {
	var out []Application
	q := s.db(ctx).Order("created_at DESC")
	if projectID != "" {
		q = q.Where("project_id = ?", projectID)
	}
	err := q.Find(&out).Error
	return out, err
}
func (s *Store) GetApplication(ctx context.Context, id string) (*Application, error) {
	var out Application
	err := s.db(ctx).First(&out, "id = ?", id).Error
	return &out, err
}

func (s *Store) CreateApplicationKey(ctx context.Context, applicationID, name, description string, expiresAt *time.Time, actorID string) (*ApplicationKey, error) {
	if _, err := s.GetApplication(ctx, applicationID); err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("name is required")
	}
	if expiresAt != nil && !expiresAt.After(time.Now().UTC()) {
		return nil, errors.New("expires_at must be a future timestamp")
	}
	value := governance.GenerateVirtualKey()
	vk := &configtables.TableVirtualKey{
		ID:          uuid.NewString(),
		Name:        name,
		Description: description,
		Value:       *schemas.NewSecretVar(value),
		IsActive:    new(true),
		ExpiresAt:   expiresAt,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	binding := &ApplicationVirtualKeyBinding{ID: uuid.NewString(), ApplicationID: applicationID, VirtualKeyID: vk.ID, ExpiresAt: expiresAt, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
	if err := s.configStore.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		if err := s.configStore.CreateVirtualKey(ctx, vk, tx); err != nil {
			return err
		}
		if err := s.bindVirtualKeyTxWithDB(tx, binding); err != nil {
			return err
		}
		return appendAuditTx(tx, actorID, "application.key_create", "application", applicationID)
	}); err != nil {
		return nil, err
	}
	return &ApplicationKey{VirtualKeyID: vk.ID, ApplicationID: applicationID, BindingID: binding.ID, Name: vk.Name, Value: value, ExpiresAt: expiresAt}, nil
}

func (s *Store) RotateApplicationKey(ctx context.Context, applicationID, virtualKeyID, actorID string) (*ApplicationKey, error) {
	var result ApplicationKey
	err := s.configStore.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		var binding ApplicationVirtualKeyBinding
		bindingQuery := tx.Where("application_id = ? AND virtual_key_id = ? AND revoked_at IS NULL", applicationID, virtualKeyID)
		if tx.Dialector.Name() == "postgres" {
			bindingQuery = bindingQuery.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := bindingQuery.First(&binding).Error; err != nil {
			return err
		}
		var vk configtables.TableVirtualKey
		vkQuery := tx.Where("id = ?", binding.VirtualKeyID)
		if tx.Dialector.Name() == "postgres" {
			vkQuery = vkQuery.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := vkQuery.First(&vk).Error; err != nil {
			return err
		}
		oldValueHash := encrypt.HashSHA256(vk.Value.GetValue())
		if err := tx.Create(&VirtualKeyRevocation{ValueHash: oldValueHash, VirtualKeyID: vk.ID, Reason: "rotation", RevokedAt: time.Now().UTC()}).Error; err != nil {
			return err
		}
		value := governance.GenerateVirtualKey()
		vk.Value = *schemas.NewSecretVar(value)
		vk.UpdatedAt = time.Now().UTC()
		if err := s.configStore.UpdateVirtualKey(ctx, &vk, tx); err != nil {
			return err
		}
		if err := appendAuditTx(tx, actorID, "application.key_rotate", "application", applicationID); err != nil {
			return err
		}
		result = ApplicationKey{VirtualKeyID: vk.ID, ApplicationID: applicationID, BindingID: binding.ID, Name: vk.Name, Value: value, ExpiresAt: binding.ExpiresAt}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func (s *Store) RevokeApplicationKey(ctx context.Context, applicationID, virtualKeyID, actorID string) error {
	return s.configStore.ExecuteTransaction(ctx, func(tx *gorm.DB) error {
		var binding ApplicationVirtualKeyBinding
		bindingQuery := tx.Where("application_id = ? AND virtual_key_id = ? AND revoked_at IS NULL", applicationID, virtualKeyID)
		if tx.Dialector.Name() == "postgres" {
			bindingQuery = bindingQuery.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := bindingQuery.First(&binding).Error; err != nil {
			return err
		}
		var vk configtables.TableVirtualKey
		vkQuery := tx.Where("id = ?", binding.VirtualKeyID)
		if tx.Dialector.Name() == "postgres" {
			vkQuery = vkQuery.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := vkQuery.First(&vk).Error; err != nil {
			return err
		}
		oldValueHash := encrypt.HashSHA256(vk.Value.GetValue())
		if err := tx.Create(&VirtualKeyRevocation{ValueHash: oldValueHash, VirtualKeyID: vk.ID, Reason: "revoke", RevokedAt: time.Now().UTC()}).Error; err != nil {
			return err
		}
		inactive := false
		vk.IsActive = &inactive
		vk.UpdatedAt = time.Now().UTC()
		if err := s.configStore.UpdateVirtualKey(ctx, &vk, tx); err != nil {
			return err
		}
		now := time.Now().UTC()
		if err := tx.Model(&ApplicationVirtualKeyBinding{}).Where("id = ? AND revoked_at IS NULL", binding.ID).Updates(map[string]any{"revoked_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		return appendAuditTx(tx, actorID, "application.key_revoke", "application", applicationID)
	})
}

func (s *Store) BindVirtualKey(ctx context.Context, applicationID, virtualKeyID string, expiresAt *time.Time) (*ApplicationVirtualKeyBinding, error) {
	binding, err := s.prepareBinding(ctx, applicationID, virtualKeyID, expiresAt)
	if err != nil {
		return nil, err
	}
	err = s.bindVirtualKeyTx(ctx, binding)
	if err != nil {
		return nil, err
	}
	return binding, nil
}

func (s *Store) prepareBinding(ctx context.Context, applicationID, virtualKeyID string, expiresAt *time.Time) (*ApplicationVirtualKeyBinding, error) {
	if _, err := s.GetApplication(ctx, applicationID); err != nil {
		return nil, err
	}
	if _, err := s.configStore.GetVirtualKey(ctx, strings.TrimSpace(virtualKeyID)); err != nil {
		return nil, err
	}
	var binding ApplicationVirtualKeyBinding
	binding.ID = uuid.NewString()
	binding.ApplicationID = applicationID
	binding.VirtualKeyID = strings.TrimSpace(virtualKeyID)
	binding.ExpiresAt = expiresAt
	binding.CreatedAt = time.Now().UTC()
	binding.UpdatedAt = binding.CreatedAt
	if binding.VirtualKeyID == "" {
		return nil, errors.New("virtual_key_id is required")
	}
	return &binding, nil
}

func (s *Store) bindVirtualKeyTx(ctx context.Context, binding *ApplicationVirtualKeyBinding) error {
	return s.db(ctx).Transaction(func(tx *gorm.DB) error {
		return s.bindVirtualKeyTxWithDB(tx, binding)
	})
}

func (s *Store) BindVirtualKeyWithAudit(ctx context.Context, applicationID, virtualKeyID string, expiresAt *time.Time, actorID string) (*ApplicationVirtualKeyBinding, error) {
	binding, err := s.prepareBinding(ctx, applicationID, virtualKeyID, expiresAt)
	if err != nil {
		return nil, err
	}
	err = s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.bindVirtualKeyTxWithDB(tx, binding); err != nil {
			return err
		}
		return appendAuditTx(tx, actorID, "application.virtual_key_bind", "application", applicationID)
	})
	if err != nil {
		return nil, err
	}
	return binding, nil
}

func (s *Store) bindVirtualKeyTxWithDB(tx *gorm.DB, binding *ApplicationVirtualKeyBinding) error {
	if tx.Dialector.Name() == "postgres" {
		// The Virtual Key row always exists, so locking it also serializes the
		// first binding where no binding row exists yet.
		var virtualKey configtables.TableVirtualKey
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").First(&virtualKey, "id = ?", binding.VirtualKeyID).Error; err != nil {
			return err
		}
	}
	now := time.Now().UTC()
	binding.CreatedAt = now
	binding.UpdatedAt = now
	if err := tx.Model(&ApplicationVirtualKeyBinding{}).Where("virtual_key_id = ? AND revoked_at IS NULL", binding.VirtualKeyID).Updates(map[string]any{"revoked_at": now, "updated_at": now}).Error; err != nil {
		return err
	}
	return tx.Create(binding).Error
}

func (s *Store) RevokeBinding(ctx context.Context, applicationID string) error {
	return s.revokeBinding(ctx, applicationID, "", false)
}

func (s *Store) RevokeBindingWithAudit(ctx context.Context, applicationID, actorID string) error {
	return s.revokeBinding(ctx, applicationID, actorID, true)
}

func (s *Store) revokeBinding(ctx context.Context, applicationID, actorID string, withAudit bool) error {
	now := time.Now().UTC()
	return s.db(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&ApplicationVirtualKeyBinding{}).Where("application_id = ? AND revoked_at IS NULL", applicationID).Updates(map[string]any{"revoked_at": now, "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		if withAudit {
			return appendAuditTx(tx, actorID, "application.virtual_key_revoke", "application", applicationID)
		}
		return nil
	})
}
func (s *Store) ActiveBindingByVirtualKey(ctx context.Context, virtualKeyID string) (*ApplicationVirtualKeyBinding, error) {
	var out ApplicationVirtualKeyBinding
	now := time.Now().UTC()
	err := s.db(ctx).Where("virtual_key_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", virtualKeyID, now).Order("created_at DESC").First(&out).Error
	return &out, err
}

func (s *Store) ActiveBindingByApplication(ctx context.Context, applicationID string) (*ApplicationVirtualKeyBinding, error) {
	var out ApplicationVirtualKeyBinding
	err := s.db(ctx).Where("application_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", applicationID, time.Now().UTC()).Order("created_at DESC").First(&out).Error
	return &out, err
}
func (s *Store) BindingAt(ctx context.Context, virtualKeyID string, occurredAt time.Time) (*ApplicationVirtualKeyBinding, error) {
	var out ApplicationVirtualKeyBinding
	err := s.db(ctx).Where("virtual_key_id = ? AND created_at <= ? AND (revoked_at IS NULL OR revoked_at > ?) AND (expires_at IS NULL OR expires_at > ?)", virtualKeyID, occurredAt, occurredAt, occurredAt).Order("created_at DESC").First(&out).Error
	return &out, err
}
func (s *Store) HasBinding(ctx context.Context, virtualKeyID string) (bool, error) {
	var count int64
	err := s.db(ctx).Model(&ApplicationVirtualKeyBinding{}).Where("virtual_key_id = ?", virtualKeyID).Count(&count).Error
	return count > 0, err
}

func (s *Store) ProjectLogs(ctx context.Context, logs []logstore.Log) (int, error) {
	return s.projectLogs(ctx, logs, true)
}

func (s *Store) projectLogs(ctx context.Context, logs []logstore.Log, advanceCheckpoint bool) (int, error) {
	var fallbackApp *Application
	getFallbackApp := func() (*Application, error) {
		if fallbackApp != nil {
			return fallbackApp, nil
		}
		project := &Project{ID: "default", OrganizationID: "default", Name: "Default", Status: "active", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
		if err := s.db(ctx).Where("id = ?", project.ID).FirstOrCreate(project).Error; err != nil {
			return nil, err
		}
		fallbackApp = &Application{ID: "default", ProjectID: project.ID, Name: "Unassigned", Environment: "production", Status: "active", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
		if err := s.db(ctx).Where("id = ?", fallbackApp.ID).FirstOrCreate(fallbackApp).Error; err != nil {
			return nil, err
		}
		return fallbackApp, nil
	}
	count := 0
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockUsageProjection(tx); err != nil {
			return err
		}
		projector := &Store{configStore: s.configStore, tx: tx}
		var err error
		count, err = projector.projectLogsTx(ctx, logs, advanceCheckpoint)
		return err
	})
	return count, err
}

func lockUsageProjection(tx *gorm.DB) error {
	// Acquire the database lock before opening the source snapshot. This also
	// serializes projectors in different processes and avoids stale overwrites.
	result := tx.Model(&UsageLedgerCheckpoint{}).Where("id = 1").
		UpdateColumn("updated_at", gorm.Expr("updated_at"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("usage projection checkpoint is missing")
	}
	return nil
}

func usageCheckpointHasProjection(checkpoint *UsageLedgerCheckpoint) bool {
	if checkpoint == nil {
		return false
	}
	return !checkpoint.Watermark.IsZero() || strings.TrimSpace(checkpoint.LastLogID) != ""
}

func copyOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	copied := trimmed
	return &copied
}

func optionalStringsEqual(left, right *string) bool {
	return optionalStringValue(left) == optionalStringValue(right)
}

func optionalStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func (s *Store) ReconcileUsage(ctx context.Context, reader logstore.UsageLogReader, force ...bool) error {
	// Keep the variadic argument for source compatibility with older callers.
	// Reuse decisions belong to Handler, where an optional source fingerprint
	// can prove that no terminal log changed. Store-level calls always reconcile
	// fully so a direct force=false call can never return a stale projection.
	return s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockUsageProjection(tx); err != nil {
			return err
		}
		snapshotComplete := false
		if snapshotReader, ok := reader.(logstore.UsageLogSnapshotReader); ok {
			snapshotComplete = snapshotReader.UsageLogSnapshotComplete()
		}
		if snapshotComplete {
			if err := tx.Where("status = ?", "processing").Delete(&UsageLedgerEntry{}).Error; err != nil {
				return err
			}
		}
		projector := &Store{configStore: s.configStore, tx: tx}
		seenSourceLogs := make(map[string]struct{})
		if err := reader.ScanUsageLogs(ctx, func(logs []logstore.Log) error {
			for _, entry := range logs {
				// ScanUsageLogs normally returns terminal rows only. Keep the
				// eligibility check here as a contract guard for custom readers:
				// rows that cannot produce a ledger entry must not keep a stale
				// projection alive after a virtual key is cleared.
				if entry.Status != "processing" && entry.VirtualKeyID != nil && *entry.VirtualKeyID != "" {
					seenSourceLogs[entry.ID] = struct{}{}
				}
			}
			_, err := projector.projectLogsTx(ctx, logs, true)
			return err
		}); err != nil {
			return err
		}
		if snapshotComplete {
			if err := deleteStaleUsageLedgerEntries(tx, seenSourceLogs); err != nil {
				return err
			}
		}
		return tx.Model(&UsageLedgerCheckpoint{}).Where("id = 1").
			UpdateColumn("updated_at", time.Now().UTC()).Error
	})
}

// deleteStaleUsageLedgerEntries keeps the ledger aligned with a complete
// source snapshot. Source rows that are deleted, become non-terminal, or lose
// their virtual key are intentionally absent from seenSourceLogs and must not
// remain billable in the control plane.
func deleteStaleUsageLedgerEntries(tx *gorm.DB, seenSourceLogs map[string]struct{}) error {
	var sourceIDs []string
	if err := tx.Model(&UsageLedgerEntry{}).Pluck("source_log_id", &sourceIDs).Error; err != nil {
		return err
	}
	stale := make([]string, 0)
	for _, sourceID := range sourceIDs {
		if _, ok := seenSourceLogs[sourceID]; !ok {
			stale = append(stale, sourceID)
		}
	}
	for start := 0; start < len(stale); start += 500 {
		end := start + 500
		if end > len(stale) {
			end = len(stale)
		}
		if err := tx.Where("source_log_id IN ?", stale[start:end]).Delete(&UsageLedgerEntry{}).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) projectLogsTx(ctx context.Context, logs []logstore.Log, advanceCheckpoint bool) (int, error) {
	count := 0
	for _, entry := range logs {
		if entry.Status == "processing" {
			continue
		}
		virtualKeyID := ""
		if entry.VirtualKeyID != nil {
			virtualKeyID = *entry.VirtualKeyID
		}
		var app *Application
		if virtualKeyID != "" {
			binding, err := s.BindingAt(ctx, virtualKeyID, entry.Timestamp)
			if err == nil {
				app, err = s.GetApplication(ctx, binding.ApplicationID)
				if err != nil {
					return count, err
				}
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return count, err
			}
		}
		cost := 0.0
		if entry.Cost != nil {
			cost = *entry.Cost
		}
		// Corrections update values, not the original request's ownership.
		values := map[string]any{
			"occurred_at": entry.Timestamp, "provider": entry.Provider, "model": entry.Model, "status": entry.Status,
			"prompt_tokens": entry.PromptTokens, "output_tokens": entry.CompletionTokens,
			"total_tokens": entry.TotalTokens, "cost": cost, "projection_ver": 2,
			"session_id": entry.SessionID, "parent_session_id": entry.ParentSessionID,
			"agent_name": entry.AgentName, "session_client_type": entry.SessionClientType,
			"is_subagent": entry.IsSubagent, "is_fork": entry.IsFork,
		}
		var existing UsageLedgerEntry
		err := s.db(ctx).Where("source_log_id = ?", entry.ID).First(&existing).Error
		if err == nil {
			if !existing.OccurredAt.Equal(entry.Timestamp) || existing.Provider != entry.Provider || existing.Model != entry.Model ||
				existing.Status != entry.Status || existing.PromptTokens != entry.PromptTokens ||
				existing.OutputTokens != entry.CompletionTokens || existing.TotalTokens != entry.TotalTokens ||
				existing.Cost != cost || existing.ProjectionVer != 2 ||
				!optionalStringsEqual(existing.SessionID, entry.SessionID) ||
				!optionalStringsEqual(existing.ParentSessionID, entry.ParentSessionID) ||
				!optionalStringsEqual(existing.AgentName, entry.AgentName) ||
				!optionalStringsEqual(existing.SessionClientType, entry.SessionClientType) ||
				existing.IsSubagent != entry.IsSubagent || existing.IsFork != entry.IsFork {
				if err := s.db(ctx).Model(&existing).Updates(values).Error; err != nil {
					return count, err
				}
			}
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return count, err
		}
		if app == nil {
			var err error
			app, err = getFallbackApp()
			if err != nil {
				return count, err
			}
		}
		row := UsageLedgerEntry{ID: uuid.NewString(), SourceLogID: entry.ID, OccurredAt: entry.Timestamp, ProjectID: app.ProjectID, ApplicationID: app.ID, VirtualKeyID: virtualKeyID, TeamID: entry.TeamID, CustomerID: entry.CustomerID, UserID: entry.UserID, SessionID: copyOptionalString(entry.SessionID), ParentSessionID: copyOptionalString(entry.ParentSessionID), AgentName: copyOptionalString(entry.AgentName), SessionClientType: copyOptionalString(entry.SessionClientType), IsSubagent: entry.IsSubagent, IsFork: entry.IsFork, Provider: entry.Provider, Model: entry.Model, Status: entry.Status, PromptTokens: entry.PromptTokens, OutputTokens: entry.CompletionTokens, TotalTokens: entry.TotalTokens, Cost: cost, ProjectionVer: 2, CreatedAt: time.Now().UTC()}
		result := s.db(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "source_log_id"}}, DoNothing: true}).Create(&row)
		if result.Error != nil {
			return count, result.Error
		}
		count += int(result.RowsAffected)
	}
	// Advance the projector checkpoint for every scanned log batch, including
	// logs that cannot be projected because they have no virtual-key binding.
	// Otherwise an unbound request is rescanned forever and the Usage Ledger
	// status falsely reports a stalled watermark.
	if advanceCheckpoint && len(logs) > 0 {
		last := logs[0]
		for _, item := range logs[1:] {
			if item.Timestamp.After(last.Timestamp) || (item.Timestamp.Equal(last.Timestamp) && item.ID > last.ID) {
				last = item
			}
		}
		err := func(tx *gorm.DB) error {
			var checkpoint UsageLedgerCheckpoint
			query := tx.Where("id = 1")
			if tx.Dialector.Name() == "postgres" {
				query = query.Clauses(clause.Locking{Strength: "UPDATE"})
			}
			if err := query.First(&checkpoint).Error; err != nil {
				return err
			}
			if last.Timestamp.Before(checkpoint.Watermark) || (last.Timestamp.Equal(checkpoint.Watermark) && last.ID <= checkpoint.LastLogID) {
				return nil
			}
			return tx.Model(&checkpoint).Updates(map[string]any{"watermark": last.Timestamp, "last_log_id": last.ID, "updated_at": time.Now().UTC()}).Error
		}(s.db(ctx))
		if err != nil {
			return count, err
		}
	}
	return count, nil
}

type UsageQuery struct {
	ProjectID, ApplicationID                             string
	SessionID, ParentSessionID, AgentName, TreeSessionID string
	IsSubagent, IsFork                                   *bool
	StartTime, EndTime                                   *time.Time
	Limit, Offset                                        int
	Export                                               bool
}

func (s *Store) ListUsage(ctx context.Context, q UsageQuery) ([]UsageLedgerEntry, int64, error) {
	var out []UsageLedgerEntry
	db := s.db(ctx).Order("occurred_at DESC, id DESC")
	if q.ProjectID != "" {
		db = db.Where("project_id = ?", q.ProjectID)
	}
	if q.ApplicationID != "" {
		db = db.Where("application_id = ?", q.ApplicationID)
	}
	if q.SessionID != "" {
		db = db.Where("session_id = ?", q.SessionID)
	}
	if q.ParentSessionID != "" {
		db = db.Where("parent_session_id = ?", q.ParentSessionID)
	}
	if q.AgentName != "" {
		db = db.Where("agent_name = ?", q.AgentName)
	}
	if q.TreeSessionID != "" {
		db = db.Where("(session_id = ? OR parent_session_id = ?)", q.TreeSessionID, q.TreeSessionID)
	}
	if q.IsSubagent != nil {
		db = db.Where("is_subagent = ?", *q.IsSubagent)
	}
	if q.IsFork != nil {
		db = db.Where("is_fork = ?", *q.IsFork)
	}
	if q.StartTime != nil {
		db = db.Where("occurred_at >= ?", *q.StartTime)
	}
	if q.EndTime != nil {
		db = db.Where("occurred_at < ?", *q.EndTime)
	}
	var total int64
	if err := db.Model(&UsageLedgerEntry{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	maxLimit := 1000
	if q.Export {
		maxLimit = 100000
	}
	if q.Limit <= 0 || q.Limit > maxLimit {
		q.Limit = 100
	}
	if q.Offset < 0 {
		q.Offset = 0
	}
	err := db.Limit(q.Limit).Offset(q.Offset).Find(&out).Error
	return out, total, err
}
func (s *Store) Checkpoint(ctx context.Context) (*UsageLedgerCheckpoint, error) {
	var out UsageLedgerCheckpoint
	err := s.db(ctx).First(&out, "id = 1").Error
	return &out, err
}

func (s *Store) AppendAudit(ctx context.Context, actorID, action, resourceType, resourceID string) error {
	return appendAuditTx(s.db(ctx), actorID, action, resourceType, resourceID)
}

func appendAuditTx(tx *gorm.DB, actorID, action, resourceType, resourceID string) error {
	if actorID == "" {
		actorID = "local-admin"
	}
	return tx.Create(&AuditEvent{ID: uuid.NewString(), ActorID: actorID, Action: action, ResourceType: resourceType, ResourceID: resourceID, CreatedAt: time.Now().UTC()}).Error
}

func (s *Store) ListAudit(ctx context.Context, limit int) ([]AuditEvent, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	var out []AuditEvent
	if err := s.db(ctx).Order("created_at DESC").Limit(limit).Find(&out).Error; err != nil {
		return nil, err
	}
	// Governance mutations use the signed audit chain. Surface those events in
	// the control-plane feed as well so the Usage Ledger audit view does not
	// appear empty just because two audit stores back different API surfaces.
	if s.db(ctx).Migrator().HasTable(&configtables.TableGovernanceAuditEvent{}) {
		var governanceEvents []configtables.TableGovernanceAuditEvent
		if err := s.db(ctx).Order("occurred_at DESC").Limit(limit).Find(&governanceEvents).Error; err != nil {
			return nil, err
		}
		for _, event := range governanceEvents {
			out = append(out, AuditEvent{ID: event.ID, ActorID: event.ActorID, Action: event.Action, ResourceType: event.Resource, ResourceID: event.ResourceID, CreatedAt: event.OccurredAt})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (s *Store) CheckVirtualKeyValueAccess(ctx context.Context, value string) error {
	var tombstone VirtualKeyRevocation
	if err := s.db(ctx).First(&tombstone, "value_hash = ?", encrypt.HashSHA256(value)).Error; err == nil {
		return errors.New("virtual key has been revoked or rotated")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	virtualKeyID, err := configstore.LookupVirtualKeyID(ctx, s.configStore, value)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) || errors.Is(err, configstore.ErrNotFound) {
			return nil
		}
		return err
	}
	hasBinding, err := s.HasBinding(ctx, virtualKeyID)
	if err != nil || !hasBinding {
		return err
	}
	_, err = s.ActiveBindingByVirtualKey(ctx, virtualKeyID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errors.New("application credential binding is revoked or expired")
	}
	return err
}
