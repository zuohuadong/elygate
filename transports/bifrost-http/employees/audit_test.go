package employees

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type employeeTestAudit struct {
	ID         uint `gorm:"primaryKey"`
	Action     string
	ResourceID string
	Snapshot   string
}

func auditedTestStore(t *testing.T, store *Store, fail *bool) *Store {
	t.Helper()
	require.NoError(t, store.db(context.Background()).AutoMigrate(&employeeTestAudit{}))
	return &Store{configStore: store.configStore, auditAppender: func(ctx context.Context, tx *gorm.DB, event EmployeeAuditEvent) error {
		snapshot, err := json.Marshal(event)
		if err != nil {
			return err
		}
		if err := tx.WithContext(ctx).Create(&employeeTestAudit{
			Action: event.Action, ResourceID: event.ResourceID, Snapshot: string(snapshot),
		}).Error; err != nil {
			return err
		}
		if *fail {
			return errors.New("forced audit failure after insert")
		}
		return nil
	}}
}

func employeeAuditRows(t *testing.T, store *Store) []employeeTestAudit {
	t.Helper()
	var rows []employeeTestAudit
	require.NoError(t, store.db(context.Background()).Order("id").Find(&rows).Error)
	return rows
}

func TestEmployeeAuditCreateRollsBackEmployeeAndAssignment(t *testing.T) {
	store, configStore := testStore(t)
	seedVirtualKey(t, configStore, "vk-audit-create", "sk-bf-audit-create-secret")
	fail := true
	audited := auditedTestStore(t, store, &fail)
	ctx := context.Background()
	employee := &Employee{Username: "audit.create", Name: "Created", IsActive: true}
	const password = "StrongPassword!123"
	err := audited.Create(ctx, employee, password, []string{"vk-audit-create"})
	require.ErrorIs(t, err, ErrEmployeeAudit)
	_, err = store.Get(ctx, employee.ID)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	assignments, err := store.AssignmentIDs(ctx, employee.ID)
	require.NoError(t, err)
	require.Empty(t, assignments)
	require.Empty(t, employeeAuditRows(t, store))

	fail = false
	require.NoError(t, audited.Create(ctx, employee, password, []string{"vk-audit-create"}))
	rows := employeeAuditRows(t, store)
	require.Len(t, rows, 1)
	require.Equal(t, "employee.create", rows[0].Action)
	require.Equal(t, employee.ID, rows[0].ResourceID)
	require.NotContains(t, rows[0].Snapshot, password)
	require.NotContains(t, rows[0].Snapshot, employee.PasswordHash)
	require.NotContains(t, rows[0].Snapshot, "sk-bf-audit-create-secret")
}

func TestEmployeeAuditUpdateAndResetRollBackSessionsAndCredentials(t *testing.T) {
	for _, action := range []string{"update", "password_reset"} {
		t.Run(action, func(t *testing.T) {
			store, configStore := testStore(t)
			seedVirtualKey(t, configStore, "vk-audit-update", "sk-bf-audit-update")
			ctx := context.Background()
			employee := &Employee{Username: "audit.update", Name: "Before", IsActive: true}
			require.NoError(t, store.Create(ctx, employee, "OriginalPassword!123", []string{"vk-audit-update"}))
			originalHash := employee.PasswordHash
			require.NoError(t, store.CreateSession(ctx, employee.ID, "audit-token", "audit-csrf", time.Now().Add(time.Hour)))
			fail := true
			audited := auditedTestStore(t, store, &fail)
			mutate := func() error {
				if action == "password_reset" {
					return audited.ResetPassword(ctx, employee.ID, "ReplacementPassword!123")
				}
				changed := *employee
				changed.Name, changed.IsActive = "After", false
				return audited.Update(ctx, &changed, []string{"vk-audit-update"})
			}
			require.ErrorIs(t, mutate(), ErrEmployeeAudit)
			current, err := store.Get(ctx, employee.ID)
			require.NoError(t, err)
			require.Equal(t, "Before", current.Name)
			require.True(t, current.IsActive)
			require.Equal(t, originalHash, current.PasswordHash)
			_, _, err = store.Session(ctx, "audit-token")
			require.NoError(t, err, "audit failure must restore revoked sessions")
			require.Empty(t, employeeAuditRows(t, store))

			fail = false
			require.NoError(t, mutate())
			_, _, err = store.Session(ctx, "audit-token")
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
			rows := employeeAuditRows(t, store)
			require.Len(t, rows, 1)
			require.Equal(t, "employee."+action, rows[0].Action)
			require.NotContains(t, rows[0].Snapshot, originalHash)
			require.NotContains(t, rows[0].Snapshot, "ReplacementPassword!123")
			current, err = store.Get(ctx, employee.ID)
			require.NoError(t, err)
			if action == "update" {
				require.False(t, current.IsActive)
				require.Contains(t, rows[0].Snapshot, `"Before":{"is_active":true,"name":"Before"`)
				require.Contains(t, rows[0].Snapshot, `"After":{"is_active":false,"name":"After"`)
			} else {
				matched, err := encrypt.CompareHash(current.PasswordHash, "ReplacementPassword!123")
				require.NoError(t, err)
				require.True(t, matched)
			}
		})
	}
}

func TestEmployeeAuditImportAndRollbackAreAtomicAndIdempotent(t *testing.T) {
	store, configStore := testStore(t)
	seedVirtualKey(t, configStore, "vk-audit-import", "sk-bf-audit-import")
	ctx := context.Background()
	entry := BulkCreateEntry{
		Employee: &Employee{Username: "audit.import", Name: "Import", IsActive: true},
		Password: "StrongPassword!123", VirtualKeyIDs: []string{"vk-audit-import"},
	}
	fail := true
	audited := auditedTestStore(t, store, &fail)
	const batchID = "batch-audit-import"
	_, err := audited.BulkCreateImport(ctx, batchID, "digest", []BulkCreateEntry{entry})
	require.ErrorIs(t, err, ErrEmployeeAudit)
	var batch EmployeeImportBatch
	require.ErrorIs(t, store.db(ctx).First(&batch, "id = ?", batchID).Error, gorm.ErrRecordNotFound)
	employees, err := store.List(ctx)
	require.NoError(t, err)
	require.Empty(t, employees)
	require.Empty(t, employeeAuditRows(t, store))

	fail = false
	already, err := audited.BulkCreateImport(ctx, batchID, "digest", []BulkCreateEntry{entry})
	require.NoError(t, err)
	require.False(t, already)
	require.NoError(t, store.CreateSession(ctx, entry.Employee.ID, "import-token", "import-csrf", time.Now().Add(time.Hour)))
	fail = true
	already, err = audited.BulkCreateImport(ctx, batchID, "digest", []BulkCreateEntry{entry})
	require.NoError(t, err, "replay must not attempt another audit write")
	require.True(t, already)
	require.Len(t, employeeAuditRows(t, store), 1)

	_, err = audited.RollbackImport(ctx, batchID)
	require.ErrorIs(t, err, ErrEmployeeAudit)
	require.NoError(t, store.db(ctx).First(&batch, "id = ?", batchID).Error)
	require.Nil(t, batch.RolledBackAt)
	current, err := store.Get(ctx, entry.Employee.ID)
	require.NoError(t, err)
	require.True(t, current.IsActive)
	_, _, err = store.Session(ctx, "import-token")
	require.NoError(t, err)
	require.Len(t, employeeAuditRows(t, store), 1)

	fail = false
	disabled, err := audited.RollbackImport(ctx, batchID)
	require.NoError(t, err)
	require.EqualValues(t, 1, disabled)
	_, _, err = store.Session(ctx, "import-token")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	fail = true
	disabled, err = audited.RollbackImport(ctx, batchID)
	require.NoError(t, err)
	require.Zero(t, disabled)
	rows := employeeAuditRows(t, store)
	require.Len(t, rows, 2)
	require.Equal(t, "employee.import", rows[0].Action)
	require.Equal(t, "employee.import_rollback", rows[1].Action)
}
