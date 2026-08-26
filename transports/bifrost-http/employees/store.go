package employees

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/maximhq/bifrost/framework/migrator"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Store struct {
	configStore configstore.ConfigStore
}

// Share the configstore migration lock so employee DDL cannot race another
// node updating the common migrations table.
const employeeMigrationLockKey = 1000001

var (
	ErrAssignmentImmutable = errors.New("employee virtual key assignment is immutable")
	ErrImportBatchConflict = errors.New("employee import batch payload conflict")
)

func acquireEmployeeMigrationLock(ctx context.Context, db *gorm.DB) (*sql.Conn, error) {
	if db.Dialector.Name() != "postgres" {
		return nil, nil
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("get employee migration database: %w", err)
	}
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("get employee migration connection: %w", err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		var acquired bool
		if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock($1)", employeeMigrationLockKey).Scan(&acquired); err != nil {
			_ = conn.Close()
			return nil, fmt.Errorf("acquire employee migration lock: %w", err)
		}
		if acquired {
			return conn, nil
		}
		if time.Now().After(deadline) {
			_ = conn.Close()
			return nil, errors.New("acquire employee migration lock: timed out")
		}
		select {
		case <-ctx.Done():
			_ = conn.Close()
			return nil, fmt.Errorf("acquire employee migration lock: %w", ctx.Err())
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func releaseEmployeeMigrationLock(conn *sql.Conn) error {
	if conn == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var released bool
	unlockErr := conn.QueryRowContext(ctx, "SELECT pg_advisory_unlock($1)", employeeMigrationLockKey).Scan(&released)
	closeErr := conn.Close()
	if unlockErr != nil {
		return fmt.Errorf("release employee migration lock: %w", unlockErr)
	}
	if !released {
		return errors.New("release employee migration lock: lock was not held by the connection")
	}
	if closeErr != nil {
		return fmt.Errorf("close employee migration connection: %w", closeErr)
	}
	return nil
}

func NewStore(ctx context.Context, configStore configstore.ConfigStore) (*Store, error) {
	if configStore == nil {
		return nil, errors.New("employee store requires config store")
	}
	const migrationID = "elygate_employees_v1"
	pending, err := migrator.PendingIDs(ctx, configStore.DB(), nil, []string{migrationID})
	if err != nil {
		return nil, fmt.Errorf("check employee migrations: %w", err)
	}
	if len(pending) == 0 {
		return &Store{configStore: configStore}, nil
	}
	if err := configStore.RunMigration(ctx, func(ctx context.Context, db *gorm.DB) error {
		lockConn, err := acquireEmployeeMigrationLock(ctx, db)
		if err != nil {
			return err
		}
		migrationErr := configstore.RunSingleMigration(ctx, nil, db, nil, &migrator.Migration{
			ID: migrationID,
			Migrate: func(migrationDB *gorm.DB) error {
				return migrationDB.AutoMigrate(&EmployeeImportBatch{}, &Employee{}, &EmployeeVirtualKey{}, &EmployeeSession{})
			},
			Rollback: func(migrationDB *gorm.DB) error {
				return migrationDB.Migrator().DropTable(&EmployeeSession{}, &EmployeeVirtualKey{}, &Employee{}, &EmployeeImportBatch{})
			},
		})
		unlockErr := releaseEmployeeMigrationLock(lockConn)
		if migrationErr != nil {
			return migrationErr
		}
		return unlockErr
	}); err != nil {
		return nil, fmt.Errorf("migrate employee tables: %w", err)
	}
	if err := configStore.RefreshConnectionPool(ctx); err != nil {
		return nil, fmt.Errorf("refresh connection pool after employee migration: %w", err)
	}
	return &Store{configStore: configStore}, nil
}

func (s *Store) db(ctx context.Context) *gorm.DB {
	return s.configStore.DB().WithContext(ctx)
}

func normalizeUsername(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func (s *Store) List(ctx context.Context) ([]Employee, error) {
	var employees []Employee
	err := s.db(ctx).Order("department ASC, name ASC, username ASC").Find(&employees).Error
	return employees, err
}

func (s *Store) Get(ctx context.Context, id string) (*Employee, error) {
	var employee Employee
	if err := s.db(ctx).First(&employee, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &employee, nil
}

func (s *Store) GetByUsername(ctx context.Context, username string) (*Employee, error) {
	var employee Employee
	if err := s.db(ctx).First(&employee, "username = ?", normalizeUsername(username)).Error; err != nil {
		return nil, err
	}
	return &employee, nil
}

func (s *Store) Create(ctx context.Context, employee *Employee, password string, virtualKeyIDs []string) error {
	hash, err := encrypt.Hash(password)
	if err != nil {
		return err
	}
	employee.ID = uuid.NewString()
	employee.Username = normalizeUsername(employee.Username)
	employee.PasswordHash = hash
	employee.MustChangePassword = true
	return s.db(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(employee).Error; err != nil {
			return err
		}
		if err := replaceAssignments(tx, employee.ID, virtualKeyIDs); err != nil {
			return err
		}
		return nil
	})
}

type BulkCreateEntry struct {
	Employee      *Employee
	Password      string
	VirtualKeyIDs []string
}

func (s *Store) BulkCreateImport(ctx context.Context, batchID, payloadDigest string, entries []BulkCreateEntry) (bool, error) {
	alreadyImported := false
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		batch := EmployeeImportBatch{ID: batchID, PayloadDigest: payloadDigest, EmployeeCount: len(entries)}
		createBatch := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&batch)
		if createBatch.Error != nil {
			return createBatch.Error
		}
		if createBatch.RowsAffected == 0 {
			var existing EmployeeImportBatch
			if err := tx.First(&existing, "id = ?", batchID).Error; err != nil {
				return err
			}
			if existing.PayloadDigest != payloadDigest || existing.EmployeeCount != len(entries) {
				return ErrImportBatchConflict
			}
			if existing.RolledBackAt != nil {
				return errors.New("employee import batch has been rolled back")
			}
			alreadyImported = true
			return nil
		}
		for _, entry := range entries {
			hash, err := encrypt.Hash(entry.Password)
			if err != nil {
				return err
			}
			entry.Employee.ID = uuid.NewString()
			entry.Employee.Username = normalizeUsername(entry.Employee.Username)
			entry.Employee.PasswordHash = hash
			entry.Employee.MustChangePassword = true
			entry.Employee.ImportBatchID = &batch.ID
			if err := tx.Create(entry.Employee).Error; err != nil {
				return err
			}
			if err := replaceAssignments(tx, entry.Employee.ID, entry.VirtualKeyIDs); err != nil {
				return err
			}
		}
		return nil
	})
	return alreadyImported, err
}

func (s *Store) Update(ctx context.Context, employee *Employee, virtualKeyIDs []string) error {
	return s.db(ctx).Transaction(func(tx *gorm.DB) error {
		var current []EmployeeVirtualKey
		if err := tx.Where("employee_id = ?", employee.ID).Order("virtual_key_id ASC").Find(&current).Error; err != nil {
			return err
		}
		requested := normalizedAssignmentIDs(virtualKeyIDs)
		if len(current) > 0 && (len(requested) != len(current) || requested[0] != current[0].VirtualKeyID) {
			return ErrAssignmentImmutable
		}
		updates := map[string]any{
			"username":     normalizeUsername(employee.Username),
			"name":         strings.TrimSpace(employee.Name),
			"job_title":    strings.TrimSpace(employee.JobTitle),
			"department":   strings.TrimSpace(employee.Department),
			"applications": strings.TrimSpace(employee.Applications),
			"account_type": strings.TrimSpace(employee.AccountType),
			"is_active":    employee.IsActive,
		}
		result := tx.Model(&Employee{}).Where("id = ?", employee.ID).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		if !employee.IsActive {
			if err := tx.Where("employee_id = ?", employee.ID).Delete(&EmployeeSession{}).Error; err != nil {
				return err
			}
		}
		if err := replaceAssignments(tx, employee.ID, virtualKeyIDs); err != nil {
			return err
		}
		return nil
	})
}

func replaceAssignments(tx *gorm.DB, employeeID string, virtualKeyIDs []string) error {
	ids := normalizedAssignmentIDs(virtualKeyIDs)
	deleteQuery := tx.Where("employee_id = ?", employeeID)
	if len(ids) > 0 {
		deleteQuery = deleteQuery.Where("virtual_key_id NOT IN ?", ids)
	}
	if err := deleteQuery.Delete(&EmployeeVirtualKey{}).Error; err != nil {
		return err
	}
	for _, id := range ids {
		assignment := EmployeeVirtualKey{EmployeeID: employeeID, VirtualKeyID: id}
		if err := tx.Where("employee_id = ? AND virtual_key_id = ?", employeeID, id).FirstOrCreate(&assignment).Error; err != nil {
			return err
		}
	}
	return nil
}

func normalizedAssignmentIDs(virtualKeyIDs []string) []string {
	seen := make(map[string]struct{}, len(virtualKeyIDs))
	ids := make([]string, 0, len(virtualKeyIDs))
	for _, rawID := range virtualKeyIDs {
		id := strings.TrimSpace(rawID)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

func (s *Store) AssignmentIDs(ctx context.Context, employeeID string) ([]string, error) {
	var assignments []EmployeeVirtualKey
	if err := s.db(ctx).Where("employee_id = ?", employeeID).Order("created_at ASC").Find(&assignments).Error; err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(assignments))
	for _, assignment := range assignments {
		ids = append(ids, assignment.VirtualKeyID)
	}
	return ids, nil
}

func (s *Store) AssignmentScopes(ctx context.Context, employeeID string) ([]EmployeeVirtualKeyScope, error) {
	var assignments []EmployeeVirtualKey
	if err := s.db(ctx).Where("employee_id = ?", employeeID).Order("created_at ASC").Find(&assignments).Error; err != nil {
		return nil, err
	}
	scopes := make([]EmployeeVirtualKeyScope, 0, len(assignments))
	for _, assignment := range assignments {
		scopes = append(scopes, EmployeeVirtualKeyScope{VirtualKeyID: assignment.VirtualKeyID, CreatedAt: assignment.CreatedAt})
	}
	return scopes, nil
}

func (s *Store) VirtualKeyEmployeeStatus(ctx context.Context, virtualKeyID string) (bool, bool, error) {
	var result struct {
		IsActive bool
	}
	query := s.db(ctx).Table("elygate_employee_virtual_keys AS assignment").
		Select("employee.is_active").
		Joins("JOIN elygate_employees AS employee ON employee.id = assignment.employee_id").
		Where("assignment.virtual_key_id = ?", virtualKeyID).
		Take(&result)
	if errors.Is(query.Error, gorm.ErrRecordNotFound) {
		return false, false, nil
	}
	if query.Error != nil {
		return false, false, query.Error
	}
	return true, result.IsActive, nil
}

func (s *Store) RollbackImport(ctx context.Context, batchID string) (int64, error) {
	var disabled int64
	err := s.db(ctx).Transaction(func(tx *gorm.DB) error {
		var batch EmployeeImportBatch
		if err := tx.First(&batch, "id = ?", batchID).Error; err != nil {
			return err
		}
		if batch.RolledBackAt != nil {
			return nil
		}
		result := tx.Model(&Employee{}).Where("import_batch_id = ?", batchID).Update("is_active", false)
		if result.Error != nil {
			return result.Error
		}
		disabled = result.RowsAffected
		if disabled != int64(batch.EmployeeCount) {
			return fmt.Errorf("import batch employee count mismatch: expected %d, found %d", batch.EmployeeCount, disabled)
		}
		var employeeIDs []string
		if err := tx.Model(&Employee{}).Where("import_batch_id = ?", batchID).Pluck("id", &employeeIDs).Error; err != nil {
			return err
		}
		if len(employeeIDs) > 0 {
			if err := tx.Where("employee_id IN ?", employeeIDs).Delete(&EmployeeSession{}).Error; err != nil {
				return err
			}
		}
		now := time.Now()
		return tx.Model(&batch).Update("rolled_back_at", &now).Error
	})
	return disabled, err
}

func (s *Store) ResetPassword(ctx context.Context, employeeID, password string) error {
	hash, err := encrypt.Hash(password)
	if err != nil {
		return err
	}
	return s.db(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&Employee{}).Where("id = ?", employeeID).Updates(map[string]any{
			"password_hash":        hash,
			"must_change_password": true,
			"failed_login_count":   0,
			"locked_until":         nil,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return tx.Where("employee_id = ?", employeeID).Delete(&EmployeeSession{}).Error
	})
}

func (s *Store) ChangePassword(ctx context.Context, employeeID, password string) error {
	hash, err := encrypt.Hash(password)
	if err != nil {
		return err
	}
	return s.db(ctx).Model(&Employee{}).Where("id = ?", employeeID).Updates(map[string]any{
		"password_hash":        hash,
		"must_change_password": false,
		"failed_login_count":   0,
		"locked_until":         nil,
	}).Error
}

func (s *Store) RecordFailedLogin(ctx context.Context, employee *Employee) error {
	now := time.Now()
	count := employee.FailedLoginCount + 1
	updates := map[string]any{"failed_login_count": count}
	if count >= 5 {
		updates["locked_until"] = now.Add(15 * time.Minute)
		updates["failed_login_count"] = 0
	}
	return s.db(ctx).Model(&Employee{}).Where("id = ?", employee.ID).Updates(updates).Error
}

func (s *Store) RecordSuccessfulLogin(ctx context.Context, employeeID string) error {
	now := time.Now()
	return s.db(ctx).Model(&Employee{}).Where("id = ?", employeeID).Updates(map[string]any{
		"last_login_at":      now,
		"failed_login_count": 0,
		"locked_until":       nil,
	}).Error
}

func (s *Store) CreateSession(ctx context.Context, employeeID, tokenHash, csrfHash string, expiresAt time.Time) error {
	return s.db(ctx).Create(&EmployeeSession{
		ID: uuid.NewString(), EmployeeID: employeeID, TokenHash: tokenHash,
		CSRFTokenHash: csrfHash, ExpiresAt: expiresAt,
	}).Error
}

func (s *Store) Session(ctx context.Context, tokenHash string) (*EmployeeSession, *Employee, error) {
	var session EmployeeSession
	if err := s.db(ctx).First(&session, "token_hash = ?", tokenHash).Error; err != nil {
		return nil, nil, err
	}
	if !session.ExpiresAt.After(time.Now()) {
		_ = s.db(ctx).Delete(&session).Error
		return nil, nil, gorm.ErrRecordNotFound
	}
	employee, err := s.Get(ctx, session.EmployeeID)
	if err != nil {
		return nil, nil, err
	}
	return &session, employee, nil
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	return s.db(ctx).Where("token_hash = ?", tokenHash).Delete(&EmployeeSession{}).Error
}

func (s *Store) DeleteOtherSessions(ctx context.Context, employeeID, keepTokenHash string) error {
	return s.db(ctx).Where("employee_id = ? AND token_hash <> ?", employeeID, keepTokenHash).Delete(&EmployeeSession{}).Error
}
