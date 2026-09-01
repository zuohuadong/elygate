package vectorstore

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/require"
)

func TestPgvectorConfig_UnmarshalAndRequiresVectors(t *testing.T) {
	var config Config
	err := json.Unmarshal([]byte(`{
		"enabled": true,
		"type": "pgvector",
		"config": {"connection_string": "env.PGVECTOR_DSN", "schema": "bifrost_vectors"}
	}`), &config)
	require.NoError(t, err)
	require.Equal(t, VectorStoreTypePgvector, config.Type)

	pgvectorConfig, ok := config.Config.(PgvectorConfig)
	require.True(t, ok)
	require.Equal(t, "env.PGVECTOR_DSN", pgvectorConfig.ConnectionString.GetRawRef())
	require.Equal(t, "bifrost_vectors", pgvectorConfig.Schema)
	require.True(t, (&PgvectorStore{}).RequiresVectors())
}

func TestPgvectorNamespaceTable_IsStableAndInjectionSafe(t *testing.T) {
	tableA, err := pgvectorNamespaceTable("semantic-cache/user:42")
	require.NoError(t, err)
	tableB, err := pgvectorNamespaceTable("semantic-cache/user:42")
	require.NoError(t, err)
	require.Equal(t, tableA, tableB)
	require.Regexp(t, `^bifrost_vec_[a-f0-9]{32}$`, tableA)

	_, err = pgvectorNamespaceTable("")
	require.Error(t, err)
}

func TestPgvectorFilter_UsesParameterizedMetadataFields(t *testing.T) {
	where, args, err := buildPgvectorFilter([]Query{
		{Field: "cache_key", Operator: QueryOperatorEqual, Value: "tenant-a"},
		{Field: "enabled", Operator: QueryOperatorEqual, Value: true},
		{Field: "tags", Operator: QueryOperatorContainsAll, Value: []string{"code", "safe"}},
	}, 1)
	require.NoError(t, err)
	require.Contains(t, where, "metadata ->> $1 = $2")
	require.Contains(t, where, "metadata ->> $3 = $4")
	require.Contains(t, where, "metadata -> $5 @> $6::jsonb")
	require.Equal(t, []any{"cache_key", "tenant-a", "enabled", "true", "tags", `["code","safe"]`}, args)
}

func TestPgvectorConfig_RequiresConnectionString(t *testing.T) {
	_, err := newPgvectorStore(t.Context(), &PgvectorConfig{ConnectionString: *schemas.NewSecretVar("")}, nil)
	require.ErrorContains(t, err, "pgvector connection_string is required")
}

func TestPgvectorConfig_RejectsUnresolvedSecretReference(t *testing.T) {
	t.Setenv("ELYGATE_TEST_MISSING_PGVECTOR_DSN", "")
	_, err := newPgvectorStore(t.Context(), &PgvectorConfig{
		ConnectionString: *schemas.NewSecretVar("env.ELYGATE_TEST_MISSING_PGVECTOR_DSN"),
	}, nil)
	require.ErrorContains(t, err, "did not resolve to a value")
}

func TestPgvectorConnectionString_FullyRedactsLiteralDSN(t *testing.T) {
	dsn := schemas.NewSecretVar("postgres://bifrost:secret@example.internal:5432/bifrost")
	redacted := dsn.FullyRedacted()
	require.Equal(t, "<REDACTED>", redacted.GetValue())
	require.NotContains(t, redacted.GetValue(), "example.internal")
	require.NotContains(t, redacted.GetValue(), "secret")
}

func TestPgvectorStore_Integration(t *testing.T) {
	dsn := os.Getenv("PGVECTOR_DSN")
	if dsn == "" {
		t.Skip("set PGVECTOR_DSN to run pgvector integration tests")
	}

	store, err := newPgvectorStore(t.Context(), &PgvectorConfig{ConnectionString: *schemas.NewSecretVar(dsn)}, nil)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close(t.Context(), "")) })

	namespace := "bifrost-pgvector-test-" + time.Now().UTC().Format("20060102150405.000000000")
	require.ErrorContains(t, store.CreateNamespace(t.Context(), namespace+"-invalid", 0, nil), "greater than 0")

	directNamespace := namespace + "-direct"
	require.NoError(t, store.CreateNamespace(t.Context(), directNamespace, 1, nil))
	t.Cleanup(func() { require.NoError(t, store.DeleteNamespace(context.Background(), directNamespace)) })

	require.NoError(t, store.CreateNamespace(t.Context(), namespace, 3, map[string]VectorStoreProperties{
		"cache_key": {DataType: VectorStorePropertyTypeString},
	}))
	t.Cleanup(func() { require.NoError(t, store.DeleteNamespace(context.Background(), namespace)) })

	require.NoError(t, store.Add(t.Context(), namespace, "first", []float32{1, 0, 0}, map[string]interface{}{"cache_key": "tenant-a"}))
	chunk, err := store.GetChunk(t.Context(), namespace, "first")
	require.NoError(t, err)
	require.Equal(t, "tenant-a", chunk.Properties["cache_key"])

	nearest, err := store.GetNearest(t.Context(), namespace, []float32{1, 0, 0}, []Query{{Field: "cache_key", Operator: QueryOperatorEqual, Value: "tenant-a"}}, nil, 0.99, 1)
	require.NoError(t, err)
	require.Len(t, nearest, 1)
	require.Equal(t, "first", nearest[0].ID)

	deleted, err := store.DeleteAll(t.Context(), namespace, []Query{{Field: "cache_key", Operator: QueryOperatorEqual, Value: "tenant-a"}})
	require.NoError(t, err)
	require.Len(t, deleted, 1)
	require.Equal(t, "first", deleted[0].ID)
	require.Equal(t, DeleteStatusSuccess, deleted[0].Status)

	_, err = store.GetChunk(t.Context(), namespace, "first")
	require.ErrorContains(t, err, "not found")
}
