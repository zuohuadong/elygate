package controlplane

import (
	"context"
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
