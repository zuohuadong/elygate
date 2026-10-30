package server

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/postgresconn"
	"github.com/stretchr/testify/require"
)

func newRoutingTestConfigStore(t *testing.T) configstore.ConfigStore {
	t.Helper()
	config := &configstore.Config{
		Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "routing.db")},
	}
	if socket := os.Getenv("ELYGATE_TEST_POSTGRES_SOCKET"); socket != "" {
		config.Type = configstore.ConfigStoreTypePostgres
		config.Config = routingPostgresTestConfig(t, socket)
	}
	store, err := configstore.NewConfigStore(t.Context(), config, noopTestLogger{})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close(context.Background())) })
	require.Equal(t, string(config.Type), store.DB().Dialector.Name())
	t.Logf("routing test backend: %s", config.Type)
	return store
}

func routingPostgresTestConfig(t *testing.T, socket string) *configstore.PostgresConfig {
	t.Helper()
	require.True(t, filepath.IsAbs(socket), "routing tests require an absolute private PostgreSQL socket")
	require.DirExists(t, socket)
	config := &configstore.PostgresConfig{
		Host: schemas.NewSecretVar(socket), Port: schemas.NewSecretVar("5432"),
		User: schemas.NewSecretVar("elygate_controlplane_test"), Password: schemas.NewSecretVar(""),
		DBName: schemas.NewSecretVar("postgres"), SSLMode: schemas.NewSecretVar("disable"),
		MaxIdleConns: 2, MaxOpenConns: 4,
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	admin, err := pgx.Connect(ctx, postgresconn.BuildDSN(config))
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		require.NoError(t, admin.Close(ctx))
	})
	config.DBName = schemas.NewSecretVar(createRoutingTestDatabase(t, admin))
	return config
}

func createRoutingTestDatabase(t *testing.T, admin *pgx.Conn) string {
	t.Helper()
	database := "elygate_cp_test_server_" + uuid.NewString()
	identifier := pgx.Identifier{database}.Sanitize()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	_, err := admin.Exec(ctx, "CREATE DATABASE "+identifier)
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, err := admin.Exec(ctx, "DROP DATABASE "+identifier)
		require.NoError(t, err, "routing test pools must close before dropping their owned database")
	})
	return database
}
