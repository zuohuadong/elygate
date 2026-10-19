package vectorstore

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSqliteConfig_UnmarshalAndRequiresVectors(t *testing.T) {
	var config Config
	err := json.Unmarshal([]byte(`{
		"enabled": true,
		"type": "sqlite",
		"config": {"path": "/tmp/elygate-vectors.db"}
	}`), &config)
	require.NoError(t, err)
	require.Equal(t, VectorStoreTypeSqlite, config.Type)
	sqliteConfig, ok := config.Config.(SqliteConfig)
	require.True(t, ok)
	require.Equal(t, "/tmp/elygate-vectors.db", sqliteConfig.Path)
	require.True(t, (&SqliteStore{}).RequiresVectors())
}

func TestSqliteNamespaceTable_IsStableAndInjectionSafe(t *testing.T) {
	tableA, err := sqliteNamespaceTable("semantic-cache/user:42")
	require.NoError(t, err)
	tableB, err := sqliteNamespaceTable("semantic-cache/user:42")
	require.NoError(t, err)
	require.Equal(t, tableA, tableB)
	require.Regexp(t, `^bifrost_vec_[a-f0-9]{32}$`, tableA)
	_, err = sqliteNamespaceTable("")
	require.Error(t, err)
}

func TestSqliteStore_RoundTripAndFiltering(t *testing.T) {
	path := filepath.Join(t.TempDir(), "vectors.db")
	store, err := newSqliteStore(t.Context(), &SqliteConfig{Path: path}, nil)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close(context.Background(), "")) })

	namespace := "sqlite-round-trip"
	require.ErrorContains(t, store.CreateNamespace(t.Context(), namespace, 0, nil), "greater than 0")
	require.NoError(t, store.CreateNamespace(t.Context(), namespace, 3, nil))
	require.ErrorContains(t, store.CreateNamespace(t.Context(), namespace, 2, nil), "already exists with dimension 3")

	require.NoError(t, store.Add(t.Context(), namespace, "first", []float32{1, 0, 0}, map[string]interface{}{
		"cache_key": "tenant-a", "tags": []string{"code", "safe"}, "score": 10,
	}))
	require.NoError(t, store.Add(t.Context(), namespace, "second", []float32{0, 1, 0}, map[string]interface{}{
		"cache_key": "tenant-b", "tags": []string{"code"}, "score": 5,
	}))
	require.NoError(t, store.Add(t.Context(), namespace, "third", []float32{0.9, 0.1, 0}, map[string]interface{}{
		"cache_key": "tenant-a", "tags": []string{"code"}, "score": 7,
	}))

	chunk, err := store.GetChunk(t.Context(), namespace, "first")
	require.NoError(t, err)
	require.Equal(t, "tenant-a", chunk.Properties["cache_key"])

	chunks, err := store.GetChunks(t.Context(), namespace, []string{"first", "second"})
	require.NoError(t, err)
	require.Len(t, chunks, 2)

	all, cursor, err := store.GetAll(t.Context(), namespace, []Query{{Field: "cache_key", Operator: QueryOperatorEqual, Value: "tenant-a"}}, nil, nil, 10)
	require.NoError(t, err)
	require.Nil(t, cursor)
	require.Len(t, all, 2)

	numeric, _, err := store.GetAll(t.Context(), namespace, []Query{{Field: "score", Operator: QueryOperatorGreaterThan, Value: 8}}, nil, nil, 10)
	require.NoError(t, err)
	require.Len(t, numeric, 1)
	require.Equal(t, "first", numeric[0].ID)

	containsAll, _, err := store.GetAll(t.Context(), namespace, []Query{{Field: "tags", Operator: QueryOperatorContainsAll, Value: []string{"code", "safe"}}}, nil, nil, 10)
	require.NoError(t, err)
	require.Len(t, containsAll, 1)
	require.Equal(t, "first", containsAll[0].ID)

	nearest, err := store.GetNearest(t.Context(), namespace, []float32{1, 0, 0},
		[]Query{{Field: "cache_key", Operator: QueryOperatorEqual, Value: "tenant-a"}}, nil, 0.9, 2)
	require.NoError(t, err)
	require.NotEmpty(t, nearest)
	require.Equal(t, "first", nearest[0].ID)
	require.NotNil(t, nearest[0].Score)
	require.InDelta(t, 1.0, *nearest[0].Score, 1e-5)

	namespaces, err := store.ListNamespaces(t.Context(), "sqlite-")
	require.NoError(t, err)
	require.Contains(t, namespaces, namespace)

	deleted, err := store.DeleteAll(t.Context(), namespace, []Query{{Field: "tags", Operator: QueryOperatorContainsAny, Value: []string{"safe"}}})
	require.NoError(t, err)
	require.Len(t, deleted, 1)

	require.NoError(t, store.Delete(t.Context(), namespace, "second"))
	_, err = store.GetChunk(t.Context(), namespace, "second")
	require.ErrorContains(t, err, "not found")

	require.NoError(t, store.DeleteNamespace(t.Context(), namespace))
	namespaces, err = store.ListNamespaces(t.Context(), "sqlite-")
	require.NoError(t, err)
	require.NotContains(t, namespaces, namespace)
}

func TestSqliteStore_RejectsUnresolvedPath(t *testing.T) {
	_, err := newSqliteStore(t.Context(), &SqliteConfig{}, nil)
	require.ErrorContains(t, err, "path is required")
}
