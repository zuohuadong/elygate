package lib

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/vectorstore"
	"github.com/stretchr/testify/require"
)

type vectorDefaultStore struct {
	configstore.ConfigStore
	sqlitePath  string
	postgresDSN string
}

func (s *vectorDefaultStore) SQLitePath() string  { return s.sqlitePath }
func (s *vectorDefaultStore) PostgresDSN() string { return s.postgresDSN }

func newTestSecret(value string) *schemas.SecretVar {
	return schemas.NewSecretVar(value)
}

func TestResolveVectorStoreConfigDefaultsToConfigDatabase(t *testing.T) {
	t.Run("sqlite uses the config file", func(t *testing.T) {
		store := &vectorDefaultStore{sqlitePath: "/app/data/elygate.db"}
		desired, source, err := resolveVectorStoreConfig(context.Background(), nil, store)
		require.NoError(t, err)
		require.Equal(t, vectorStoreSourceDatabaseDefault, source)
		require.Equal(t, vectorstore.VectorStoreTypeSqlite, desired.Type)
		require.Equal(t, "/app/data/elygate.db", desired.Config.(vectorstore.SqliteConfig).Path)
	})

	t.Run("postgres uses pgvector on the config DSN", func(t *testing.T) {
		store := &vectorDefaultStore{postgresDSN: "postgres://user:pass@db/elygate"}
		desired, source, err := resolveVectorStoreConfig(context.Background(), nil, store)
		require.NoError(t, err)
		require.Equal(t, vectorStoreSourceDatabaseDefault, source)
		require.Equal(t, vectorstore.VectorStoreTypePgvector, desired.Type)
		pgvectorConfig := desired.Config.(vectorstore.PgvectorConfig)
		require.Equal(t, "postgres://user:pass@db/elygate", pgvectorConfig.ConnectionString.GetValue())
	})

	t.Run("an explicit config wins over the database default", func(t *testing.T) {
		var store configstore.ConfigStore
		explicit := &vectorstore.Config{
			Enabled: true,
			Type:    vectorstore.VectorStoreTypePgvector,
			Config:  vectorstore.PgvectorConfig{ConnectionString: *newTestSecret("postgres://explicit/db")},
		}
		desired, source, err := resolveVectorStoreConfig(context.Background(), &ConfigData{VectorStoreConfig: explicit}, store)
		require.NoError(t, err)
		require.Equal(t, vectorStoreSourceConfigJSON, source)
		require.Equal(t, explicit, desired)
	})
}
