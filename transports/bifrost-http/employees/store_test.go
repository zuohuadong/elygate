package employees

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/encrypt"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func testStore(t *testing.T) (*Store, configstore.ConfigStore) {
	t.Helper()
	ctx := context.Background()
	logger := bifrost.NewDefaultLogger(schemas.LogLevelError)
	configStore, err := configstore.NewConfigStore(ctx, &configstore.Config{
		Enabled: true,
		Type:    configstore.ConfigStoreTypeSQLite,
		Config:  &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "employees.db")},
	}, logger)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, configStore.Close(ctx)) })
	store, err := NewStore(ctx, configStore)
	require.NoError(t, err)
	return store, configStore
}

func seedVirtualKey(t *testing.T, store configstore.ConfigStore, id, value string) {
	t.Helper()
	active := true
	require.NoError(t, store.CreateVirtualKey(context.Background(), &configtables.TableVirtualKey{
		ID: id, Name: id, Value: *schemas.NewSecretVar(value), IsActive: &active,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}))
}

func TestEmployeeStoreCreatesHashedCredentialAndDedicatedAssignment(t *testing.T) {
	store, configStore := testStore(t)
	seedVirtualKey(t, configStore, "vk-1", "sk-bf-test-one")

	employee := &Employee{Username: "  Alice.Dev ", Name: "Alice", IsActive: true}
	require.NoError(t, store.Create(context.Background(), employee, "StrongPassword!123", []string{"vk-1", "vk-1"}))
	require.Equal(t, "alice.dev", employee.Username)
	require.NotEqual(t, "StrongPassword!123", employee.PasswordHash)
	matched, err := encrypt.CompareHash(employee.PasswordHash, "StrongPassword!123")
	require.NoError(t, err)
	require.True(t, matched)

	ids, err := store.AssignmentIDs(context.Background(), employee.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"vk-1"}, ids)

	other := &Employee{Username: "other.dev", Name: "Other", IsActive: true}
	err = store.Create(context.Background(), other, "StrongPassword!456", []string{"vk-1"})
	require.Error(t, err, "a dedicated virtual key must not be assigned to two employees")
}

func TestEmployeeStoreMigrationIsIdempotentAndAssignmentCannotBeRemoved(t *testing.T) {
	store, configStore := testStore(t)
	seedVirtualKey(t, configStore, "vk-rotate", "sk-bf-before")
	employee := &Employee{Username: "rotate.user", Name: "Rotate", IsActive: true}
	require.NoError(t, store.Create(context.Background(), employee, "StrongPassword!123", []string{"vk-rotate"}))

	_, err := NewStore(context.Background(), configStore)
	require.NoError(t, err, "employee migration must be safe to rerun")

	employee.Name = "Updated"
	err = store.Update(context.Background(), employee, nil)
	require.ErrorIs(t, err, ErrAssignmentImmutable)
}

func TestEmployeeStoreResetPasswordRevokesSessions(t *testing.T) {
	store, _ := testStore(t)
	employee := &Employee{Username: "session.user", Name: "Session", IsActive: true}
	require.NoError(t, store.Create(context.Background(), employee, "StrongPassword!123", nil))
	require.NoError(t, store.CreateSession(context.Background(), employee.ID, "token-hash", "csrf-hash", time.Now().Add(time.Hour)))

	require.NoError(t, store.ResetPassword(context.Background(), employee.ID, "NewStrongPassword!123"))
	_, _, err := store.Session(context.Background(), "token-hash")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	updated, err := store.Get(context.Background(), employee.ID)
	require.NoError(t, err)
	require.True(t, updated.MustChangePassword)
	matched, err := encrypt.CompareHash(updated.PasswordHash, "NewStrongPassword!123")
	require.NoError(t, err)
	require.True(t, matched)
}

func TestEmployeeStatusBlocksAssignedKeyWithoutChangingAdminKeyState(t *testing.T) {
	store, configStore := testStore(t)
	seedVirtualKey(t, configStore, "vk-status", "sk-bf-status")
	employee := &Employee{Username: "status.user", Name: "Status", IsActive: true}
	require.NoError(t, store.Create(context.Background(), employee, "StrongPassword!123", []string{"vk-status"}))

	assigned, active, err := store.VirtualKeyEmployeeStatus(context.Background(), "vk-status")
	require.NoError(t, err)
	require.True(t, assigned)
	require.True(t, active)

	employee.IsActive = false
	require.NoError(t, store.Update(context.Background(), employee, []string{"vk-status"}))
	assigned, active, err = store.VirtualKeyEmployeeStatus(context.Background(), "vk-status")
	require.NoError(t, err)
	require.True(t, assigned)
	require.False(t, active)

	key, err := configStore.GetVirtualKey(context.Background(), "vk-status")
	require.NoError(t, err)
	require.True(t, key.IsActiveValue(), "employee status must not overwrite the administrator's key state")
}

func TestEmployeeBulkCreateRollsBackWholeBatch(t *testing.T) {
	store, configStore := testStore(t)
	seedVirtualKey(t, configStore, "vk-bulk", "sk-bf-bulk")
	first := &Employee{Username: "bulk.one", Name: "One", IsActive: true}
	second := &Employee{Username: "bulk.two", Name: "Two", IsActive: true}
	_, err := store.BulkCreateImport(context.Background(), "batch-test-rollback", "digest-one", []BulkCreateEntry{
		{Employee: first, Password: "StrongPassword!123", VirtualKeyIDs: []string{"vk-bulk"}},
		{Employee: second, Password: "StrongPassword!456", VirtualKeyIDs: []string{"vk-bulk"}},
	})
	require.Error(t, err)
	employees, listErr := store.List(context.Background())
	require.NoError(t, listErr)
	require.Empty(t, employees)
}

func TestEmployeeImportIsIdempotentAndCanRollbackOnlyItsBatch(t *testing.T) {
	store, configStore := testStore(t)
	seedVirtualKey(t, configStore, "vk-import", "sk-bf-import")
	entry := BulkCreateEntry{
		Employee: &Employee{Username: "import.user", Name: "Import", IsActive: true},
		Password: "StrongPassword!123", VirtualKeyIDs: []string{"vk-import"},
	}
	already, err := store.BulkCreateImport(context.Background(), "batch-test-import", "digest-import", []BulkCreateEntry{entry})
	require.NoError(t, err)
	require.False(t, already)
	already, err = store.BulkCreateImport(context.Background(), "batch-test-import", "digest-import", []BulkCreateEntry{entry})
	require.NoError(t, err)
	require.True(t, already)
	_, err = store.BulkCreateImport(context.Background(), "batch-test-import", "different", []BulkCreateEntry{entry})
	require.ErrorIs(t, err, ErrImportBatchConflict)

	disabled, err := store.RollbackImport(context.Background(), "batch-test-import")
	require.NoError(t, err)
	require.EqualValues(t, 1, disabled)
	employees, err := store.List(context.Background())
	require.NoError(t, err)
	require.Len(t, employees, 1)
	require.False(t, employees[0].IsActive)
	assigned, active, err := store.VirtualKeyEmployeeStatus(context.Background(), "vk-import")
	require.NoError(t, err)
	require.True(t, assigned)
	require.False(t, active)
	key, err := configStore.GetVirtualKey(context.Background(), "vk-import")
	require.NoError(t, err)
	require.Equal(t, "sk-bf-import", key.Value.GetValue())
}

func TestEmployeeImportBatchIsConcurrentIdempotent(t *testing.T) {
	store, configStore := testStore(t)
	seedVirtualKey(t, configStore, "vk-concurrent", "sk-bf-concurrent")
	makeEntry := func() BulkCreateEntry {
		return BulkCreateEntry{
			Employee: &Employee{Username: "concurrent.user", Name: "Concurrent", IsActive: true},
			Password: "StrongPassword!123", VirtualKeyIDs: []string{"vk-concurrent"},
		}
	}

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.BulkCreateImport(context.Background(), "batch-concurrent", "digest-concurrent", []BulkCreateEntry{makeEntry()})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	employees, err := store.List(context.Background())
	require.NoError(t, err)
	require.Len(t, employees, 1)
}

func TestEmployeeImportBatchForeignKeyIsEnforced(t *testing.T) {
	store, _ := testStore(t)
	missingBatch := "missing-batch"
	employee := &Employee{Username: "foreign.user", Name: "Foreign", IsActive: true, ImportBatchID: &missingBatch}
	err := store.Create(context.Background(), employee, "StrongPassword!123", nil)
	require.Error(t, err)
}
