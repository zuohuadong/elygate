package controlplane

import (
	"bytes"
	"context"
	"crypto/sha256"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/logstore"
	"github.com/maximhq/bifrost/framework/postgresconn"
	"github.com/stretchr/testify/require"
)

func testPostgresControlPlaneConfig(t *testing.T, socket string) *configstore.Config {
	t.Helper()
	require.True(t, filepath.IsAbs(socket), "PostgreSQL tests require an absolute local socket directory")
	require.DirExists(t, socket)
	config := &configstore.PostgresConfig{
		Host:         schemas.NewSecretVar(socket),
		Port:         schemas.NewSecretVar("5432"),
		User:         schemas.NewSecretVar("elygate_controlplane_test"),
		Password:     schemas.NewSecretVar(""),
		DBName:       schemas.NewSecretVar("postgres"),
		SSLMode:      schemas.NewSecretVar("disable"),
		MaxIdleConns: 2,
		MaxOpenConns: 4,
	}
	config.DBName = schemas.NewSecretVar(createControlPlaneTestDatabase(t, config))
	return &configstore.Config{Enabled: true, Type: configstore.ConfigStoreTypePostgres, Config: config}
}

func createControlPlaneTestDatabase(t *testing.T, config *configstore.PostgresConfig) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgx.Connect(ctx, postgresconn.BuildDSN(config))
	require.NoError(t, err, "connect to the private PostgreSQL test cluster")
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		require.NoError(t, admin.Close(ctx))
	})

	// Each test owns a fresh database, including its migration/runtime pools.
	database := "elygate_cp_test_" + uuid.NewString()
	identifier := pgx.Identifier{database}.Sanitize()
	_, err = admin.Exec(ctx, "CREATE DATABASE "+identifier)
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, err := admin.Exec(ctx, "DROP DATABASE "+identifier)
		require.NoError(t, err, "test store pools must close before dropping the owned database")
	})
	return database
}

type postgresRecoveryFixture struct {
	projectID, applicationID string
	active, revoked          *ApplicationKey
}

type postgresRecoveryKey struct {
	ID        string
	Digest    [32]byte
	Active    bool
	ExpiresAt *time.Time
}

type postgresRecoverySnapshot struct {
	InitialPoolSize, LogRetentionDays int
	InferenceAuth                     bool
	AllowedOrigins                    []string
	Project                           *Project
	Application                       *Application
	Bindings                          []ApplicationVirtualKeyBinding
	Keys                              []postgresRecoveryKey
	Ledger                            []UsageLedgerEntry
	Summary                           UsageSummary
	Checkpoint                        *UsageLedgerCheckpoint
	Audit                             []AuditEvent
}

func TestPostgresControlPlaneBackupRestore(t *testing.T) {
	socket := os.Getenv("ELYGATE_TEST_POSTGRES_SOCKET")
	if socket == "" {
		t.Skip("PostgreSQL recovery requires scripts/test-controlplane-postgres.sh")
	}
	for _, executable := range []string{"pg_dump", "pg_restore"} {
		_, err := exec.LookPath(executable)
		require.NoError(t, err, "explicit PostgreSQL recovery requires %s", executable)
	}
	ctx := context.Background()
	sourceConfig := testPostgresControlPlaneConfig(t, socket)
	source := openPostgresRecoveryStore(t, sourceConfig)
	fixture := seedPostgresRecovery(t, source)
	expected := snapshotPostgresRecovery(t, source, fixture)
	require.Len(t, expected.Ledger, 2)
	require.Len(t, expected.Keys, 2)
	require.Len(t, expected.Bindings, 2)
	require.Len(t, expected.Audit, 5)
	require.EqualValues(t, 2, expected.Summary.Requests)
	require.EqualValues(t, 1, expected.Summary.SuccessfulRequests)
	require.EqualValues(t, 1, expected.Summary.FailedRequests)
	require.EqualValues(t, 13, expected.Summary.TotalTokens)
	require.Equal(t, 0.375, expected.Summary.Cost)
	require.Equal(t, "recovery-error", expected.Checkpoint.LastLogID)
	archive := dumpPostgresRecovery(t, sourceConfig)
	require.NoError(t, source.configStore.UpdateClientConfig(ctx, &configstore.ClientConfig{InitialPoolSize: 3, LogRetentionDays: 3}))
	t.Run("conflict rolls back the entire restore", func(t *testing.T) {
		testPostgresRecoveryConflict(t, socket, archive)
	})
	t.Run("complete archive restores a writable independent database", func(t *testing.T) {
		targetConfig := testPostgresControlPlaneConfig(t, socket)
		_, err := runPostgresRecoveryTool(t, targetConfig, "pg_restore",
			"--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", archive)
		require.NoError(t, err, "pg_restore diagnostics are suppressed to protect key material")
		assertPostgresRecovery(t, openPostgresRecoveryStore(t, targetConfig), fixture, expected)
	})
	sourceClient, err := source.configStore.GetClientConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, 3, sourceClient.LogRetentionDays, "restoring a new database must not change the source")
}

func dumpPostgresRecovery(t *testing.T, config *configstore.Config) string {
	t.Helper()
	archive := filepath.Join(t.TempDir(), "config.dump")
	file, err := os.OpenFile(archive, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	require.NoError(t, err)
	require.NoError(t, file.Close())
	_, err = runPostgresRecoveryTool(t, config, "pg_dump", "--format=custom", "--file="+archive)
	require.NoError(t, err, "pg_dump diagnostics are suppressed to protect key material")
	archiveInfo, err := os.Stat(archive)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0600), archiveInfo.Mode().Perm())
	require.Positive(t, archiveInfo.Size())
	return archive
}

func assertPostgresRecovery(t *testing.T, restored *Store, fixture postgresRecoveryFixture, expected postgresRecoverySnapshot) {
	t.Helper()
	ctx := context.Background()
	require.Equal(t, expected, snapshotPostgresRecovery(t, restored, fixture))
	require.NoError(t, restored.CheckVirtualKeyValueAccess(ctx, fixture.active.Value))
	require.Error(t, restored.CheckVirtualKeyValueAccess(ctx, fixture.revoked.Value))
	require.NoError(t, restored.CreateProjectWithAudit(ctx, &Project{Name: "After recovery", DailyBudget: ptr(1.0)}, "recovery-test"))
	_, err := NewStore(ctx, restored.configStore)
	require.NoError(t, err)
}

func openPostgresRecoveryStore(t *testing.T, config *configstore.Config) *Store {
	t.Helper()
	ctx := context.Background()
	cs, err := configstore.NewConfigStore(ctx, config, bifrost.NewDefaultLogger(schemas.LogLevelError))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, cs.Close(ctx)) })
	require.Equal(t, "postgres", cs.DB().Dialector.Name())
	store, err := NewStore(ctx, cs)
	require.NoError(t, err)
	return store
}

func seedPostgresRecovery(t *testing.T, store *Store) postgresRecoveryFixture {
	t.Helper()
	ctx := context.Background()
	require.NoError(t, store.configStore.UpdateClientConfig(ctx, &configstore.ClientConfig{
		InitialPoolSize: 17, LogRetentionDays: 14, EnforceAuthOnInference: true,
		AllowedOrigins: []string{"https://recovery.example.test"},
	}))
	project := &Project{Name: "Recovery project", DailyBudget: ptr(10.0), MonthlyBudget: ptr(100.0)}
	require.NoError(t, store.CreateProjectWithAudit(ctx, project, "recovery-test"))
	app := &Application{ProjectID: project.ID, Name: "Recovery app", Environment: "staging", DailyBudget: ptr(2.0)}
	require.NoError(t, store.CreateApplicationWithAudit(ctx, app, "recovery-test"))
	expires := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Microsecond)
	active, err := store.CreateApplicationKey(ctx, app.ID, "active recovery key", "", &expires, "recovery-test")
	require.NoError(t, err)
	revoked, err := store.CreateApplicationKey(ctx, app.ID, "revoked recovery key", "", &expires, "recovery-test")
	require.NoError(t, err)
	require.NoError(t, store.RevokeApplicationKey(ctx, app.ID, revoked.VirtualKeyID, "recovery-test"))
	occurred := time.Now().UTC().Truncate(time.Microsecond)
	count, err := store.ProjectLogs(ctx, []logstore.Log{
		{ID: "recovery-success", Timestamp: occurred, VirtualKeyID: &active.VirtualKeyID,
			UserID: ptr("alice"), Provider: "openai", Model: "mini", Status: "success", PromptTokens: 2, CompletionTokens: 3, TotalTokens: 5, Cost: ptr(0.125)},
		{ID: "recovery-error", Timestamp: occurred.Add(time.Second), VirtualKeyID: &active.VirtualKeyID,
			UserID: ptr("bob"), Provider: "other", Model: "large", Status: "error", PromptTokens: 5, CompletionTokens: 3, TotalTokens: 8, Cost: ptr(0.25)},
	})
	require.NoError(t, err)
	require.Equal(t, 2, count)
	return postgresRecoveryFixture{project.ID, app.ID, active, revoked}
}

func snapshotPostgresRecovery(t *testing.T, store *Store, fixture postgresRecoveryFixture) postgresRecoverySnapshot {
	t.Helper()
	ctx := context.Background()
	client, err := store.configStore.GetClientConfig(ctx)
	require.NoError(t, err)
	require.NotNil(t, client)
	snapshot := postgresRecoverySnapshot{
		InitialPoolSize: client.InitialPoolSize, LogRetentionDays: client.LogRetentionDays,
		InferenceAuth: client.EnforceAuthOnInference, AllowedOrigins: client.AllowedOrigins,
	}
	snapshot.Project, err = store.GetProject(ctx, fixture.projectID)
	require.NoError(t, err)
	snapshot.Application, err = store.GetApplication(ctx, fixture.applicationID)
	require.NoError(t, err)
	snapshot.Bindings, err = store.ListBindings(ctx, fixture.applicationID)
	require.NoError(t, err)
	for _, key := range []*ApplicationKey{fixture.active, fixture.revoked} {
		vk, err := store.configStore.GetVirtualKey(ctx, key.VirtualKeyID)
		require.NoError(t, err)
		snapshot.Keys = append(snapshot.Keys, postgresRecoveryKey{
			ID: vk.ID, Digest: sha256.Sum256([]byte(vk.Value.GetValue())), Active: vk.IsActiveValue(), ExpiresAt: vk.ExpiresAt,
		})
	}
	snapshot.Ledger, _, err = store.ListUsage(ctx, UsageQuery{ApplicationID: fixture.applicationID})
	require.NoError(t, err)
	snapshot.Summary, err = store.SummarizeUsage(ctx, UsageQuery{ApplicationID: fixture.applicationID})
	require.NoError(t, err)
	snapshot.Checkpoint, err = store.Checkpoint(ctx)
	require.NoError(t, err)
	snapshot.Audit, err = store.ListAudit(ctx, 100)
	require.NoError(t, err)
	return snapshot
}

func runPostgresRecoveryTool(t *testing.T, config *configstore.Config, executable string, extra ...string) (string, error) {
	t.Helper()
	pg := config.Config.(*configstore.PostgresConfig)
	require.True(t, filepath.IsAbs(pg.Host.GetValue()), "recovery tools require a local test socket")
	require.True(t, strings.HasPrefix(pg.DBName.GetValue(), "elygate_cp_test_"), "recovery tools require an owned test database")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	args := []string{"--no-password", "--host=" + pg.Host.GetValue(), "--port=" + pg.Port.GetValue(),
		"--username=" + pg.User.GetValue(), "--dbname=" + pg.DBName.GetValue()}
	cmd := exec.CommandContext(ctx, executable, append(args, extra...)...)
	for _, variable := range os.Environ() {
		if !strings.HasPrefix(variable, "PG") {
			cmd.Env = append(cmd.Env, variable)
		}
	}
	cmd.Env = append(cmd.Env, "PGPASSFILE="+os.DevNull, "LC_ALL=C")
	var diagnostics bytes.Buffer
	cmd.Stderr = &diagnostics
	err := cmd.Run()
	return diagnostics.String(), err
}

func testPostgresRecoveryConflict(t *testing.T, socket, archive string) {
	t.Helper()
	config := testPostgresControlPlaneConfig(t, socket)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, postgresconn.BuildDSN(config.Config.(*configstore.PostgresConfig)))
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		require.NoError(t, conn.Close(ctx))
	})
	_, err = conn.Exec(ctx, "CREATE TABLE elygate_control_usage_ledger (sentinel text); INSERT INTO elygate_control_usage_ledger VALUES ('untouched')")
	require.NoError(t, err)
	diagnostics, err := runPostgresRecoveryTool(t, config, "pg_restore",
		"--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", archive)
	var exit *exec.ExitError
	require.ErrorAs(t, err, &exit)
	require.Equal(t, 1, exit.ExitCode())
	require.True(t, strings.Contains(diagnostics, `relation "elygate_control_usage_ledger" already exists`), "expected owned-table conflict; diagnostics suppressed")
	var tables int
	require.NoError(t, conn.QueryRow(ctx, "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'").Scan(&tables))
	require.Equal(t, 1, tables, "a failed restore must not leave partially created application tables")
	var sentinel string
	require.NoError(t, conn.QueryRow(ctx, "SELECT sentinel FROM elygate_control_usage_ledger").Scan(&sentinel))
	require.Equal(t, "untouched", sentinel)
}
