package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/vectorstore"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func newVectorStoreConfigHandlerTest(t *testing.T) (*ConfigHandler, configstore.ConfigStore) {
	t.Helper()
	SetLogger(&mockLogger{})
	store, err := configstore.NewConfigStore(context.Background(), &configstore.Config{
		Enabled: true,
		Type:    configstore.ConfigStoreTypeSQLite,
		Config:  &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "vector-store-config.db")},
	}, &mockLogger{})
	require.NoError(t, err)
	return NewConfigHandler(nil, &lib.Config{ConfigStore: store}), store
}

func newVectorStoreConfigRequestCtx(body string) *fasthttp.RequestCtx {
	var request fasthttp.Request
	request.SetBodyString(body)
	ctx := &fasthttp.RequestCtx{}
	ctx.Init(&request, nil, nil)
	return ctx
}

func TestGetLatestReleaseProxiesJSONThroughBackend(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "application/json", r.Header.Get("Accept"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"v1.2.3","changelogUrl":"https://docs.example/release"}`))
	}))
	defer upstream.Close()

	handler := NewConfigHandler(nil, &lib.Config{})
	handler.latestReleaseURL = upstream.URL
	ctx := newVectorStoreConfigRequestCtx("")
	handler.getLatestRelease(ctx)

	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	var payload map[string]any
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &payload))
	require.Equal(t, "v1.2.3", payload["version"])
}

func TestGetLatestReleaseRejectsRedirectsAndOversizedResponses(t *testing.T) {
	t.Run("redirect", func(t *testing.T) {
		target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"version":"should-not-be-followed"}`))
		}))
		defer target.Close()
		upstream := httptest.NewServer(http.RedirectHandler(target.URL, http.StatusFound))
		defer upstream.Close()

		handler := NewConfigHandler(nil, &lib.Config{})
		handler.latestReleaseURL = upstream.URL
		ctx := newVectorStoreConfigRequestCtx("")
		handler.getLatestRelease(ctx)

		require.Equal(t, fasthttp.StatusBadGateway, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	})

	t.Run("oversized", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"version":"` + strings.Repeat("x", int(maxLatestReleaseResponseBytes)) + `"}`))
		}))
		defer upstream.Close()

		handler := NewConfigHandler(nil, &lib.Config{})
		handler.latestReleaseURL = upstream.URL
		ctx := newVectorStoreConfigRequestCtx("")
		handler.getLatestRelease(ctx)

		require.Equal(t, fasthttp.StatusBadGateway, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	})
}

func TestGetVectorStoreConfigRedactsPgvectorConnectionString(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	active := &vectorstore.Config{Enabled: true, Type: vectorstore.VectorStoreTypePgvector, Config: vectorstore.PgvectorConfig{
		ConnectionString: *schemas.NewSecretVar("postgres://elygate:super-secret@db.internal:5432/elygate"), Schema: "elygate_vectors",
	}}
	handler.store.VectorStoreConfig = active
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), active))

	ctx := newVectorStoreConfigRequestCtx("")
	handler.getVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.NotContains(t, string(ctx.Response.Body()), "super-secret")
	var response struct {
		Enabled         bool                        `json:"enabled"`
		Type            vectorstore.VectorStoreType `json:"type"`
		Config          vectorstore.PgvectorConfig  `json:"config"`
		RestartRequired bool                        `json:"restart_required"`
	}
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
	require.True(t, response.Enabled)
	require.Equal(t, vectorstore.VectorStoreTypePgvector, response.Type)
	require.Equal(t, "<REDACTED>", response.Config.ConnectionString.GetValue())
	require.False(t, response.RestartRequired)
}

func TestGetVectorStoreConfigReturnsSafeReadOnlyMetadataForExistingRedis(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	desired := &vectorstore.Config{Enabled: true, Type: vectorstore.VectorStoreTypeRedis, Config: vectorstore.RedisConfig{
		Addr: schemas.NewSecretVar("redis.internal:6379"), Password: schemas.NewSecretVar("super-secret"),
	}}
	handler.store.VectorStoreConfig = desired
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), desired))

	ctx := newVectorStoreConfigRequestCtx("")
	handler.getVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.NotContains(t, string(ctx.Response.Body()), "redis.internal")
	require.NotContains(t, string(ctx.Response.Body()), "super-secret")
	var response struct {
		Type      vectorstore.VectorStoreType `json:"type"`
		Supported bool                        `json:"supported"`
		Editable  bool                        `json:"editable"`
		Config    map[string]any              `json:"config"`
	}
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
	require.Equal(t, vectorstore.VectorStoreTypeRedis, response.Type)
	require.False(t, response.Supported)
	require.False(t, response.Editable)
	require.Empty(t, response.Config)
}

func TestUpdateVectorStoreConfigRejectsConfigJSONManagedStore(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	handler.store.VectorStoreConfigManagedByConfigJSON = true
	original := &vectorstore.Config{Enabled: true, Type: vectorstore.VectorStoreTypePgvector, Config: vectorstore.PgvectorConfig{
		ConnectionString: *schemas.NewSecretVar("postgres://original@db/elygate"), Schema: "safe_vectors",
	}}
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), original))
	payload := `{"enabled":false,"type":"pgvector","config":{"connection_string":"<REDACTED>","schema":"changed"}}`
	ctx := newVectorStoreConfigRequestCtx(payload)
	handler.updateVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusForbidden, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	stored, err := store.GetVectorStoreConfig(context.Background())
	require.NoError(t, err)
	require.Equal(t, original.Enabled, stored.Enabled)
	require.Equal(t, "safe_vectors", stored.Config.(vectorstore.PgvectorConfig).Schema)
}

func TestUpdateVectorStoreConfigPreservesRedactedConnectionStringAndRequiresRestart(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	secret := "postgres://elygate:super-secret@db.internal:5432/elygate"
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), &vectorstore.Config{
		Enabled: true, Type: vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{ConnectionString: *schemas.NewSecretVar(secret), Schema: "old_vectors"},
	}))
	payload, err := json.Marshal(vectorstore.Config{
		Enabled: true, Type: vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{ConnectionString: *schemas.NewSecretVar("<REDACTED>"), Schema: "new_vectors"},
	})
	require.NoError(t, err)
	ctx := newVectorStoreConfigRequestCtx(string(payload))
	handler.updateVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.NotContains(t, string(ctx.Response.Body()), "super-secret")

	stored, err := store.GetVectorStoreConfig(context.Background())
	require.NoError(t, err)
	pg, ok := stored.Config.(vectorstore.PgvectorConfig)
	require.True(t, ok)
	require.Equal(t, secret, pg.ConnectionString.GetValue())
	require.Equal(t, "new_vectors", pg.Schema)
	var response struct {
		RestartRequired bool                       `json:"restart_required"`
		Config          vectorstore.PgvectorConfig `json:"config"`
	}
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
	require.True(t, response.RestartRequired)
	require.Equal(t, "<REDACTED>", response.Config.ConnectionString.GetValue())
}

func TestUpdateVectorStoreConfigReadsSentinelAfterDistributedLock(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	oldSecret := "postgres://elygate:old-secret@db.internal:5432/elygate"
	newSecret := "postgres://elygate:new-secret@db.internal:5432/elygate"
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), &vectorstore.Config{
		Enabled: true, Type: vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{ConnectionString: *schemas.NewSecretVar(oldSecret), Schema: "old_vectors"},
	}))

	lockManager := configstore.NewDistributedLockManager(store, &mockLogger{},
		configstore.WithDefaultTTL(time.Minute),
	)
	heldLock, err := lockManager.NewLock(lib.VectorStoreMutationLockKey)
	require.NoError(t, err)
	require.NoError(t, heldLock.Lock(context.Background()))

	payload, err := json.Marshal(vectorstore.Config{
		Enabled: true, Type: vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{ConnectionString: *schemas.NewSecretVar("<REDACTED>"), Schema: "new_vectors"},
	})
	require.NoError(t, err)
	ctx := newVectorStoreConfigRequestCtx(string(payload))
	done := make(chan struct{})
	go func() {
		handler.updateVectorStoreConfig(ctx)
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("update completed while the distributed lock was still held")
	case <-time.After(150 * time.Millisecond):
	}

	// 模拟另一实例在交出锁之前完成了一次更新；当前请求必须在拿到锁后
	// 重新读取密文，不能把旧连接串写回去。
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), &vectorstore.Config{
		Enabled: true, Type: vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{ConnectionString: *schemas.NewSecretVar(newSecret), Schema: "other_vectors"},
	}))
	require.NoError(t, heldLock.Unlock(context.Background()))

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for the serialized vector store update")
	}
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.NotContains(t, string(ctx.Response.Body()), "new-secret")

	stored, err := store.GetVectorStoreConfig(context.Background())
	require.NoError(t, err)
	pg := stored.Config.(vectorstore.PgvectorConfig)
	require.Equal(t, newSecret, pg.ConnectionString.GetValue())
	require.Equal(t, "new_vectors", pg.Schema)
}

func TestUpdateVectorStoreConfigClearsItsRestartReasonWhenRestoredToActiveConfig(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	active := &vectorstore.Config{Enabled: true, Type: vectorstore.VectorStoreTypePgvector, Config: vectorstore.PgvectorConfig{
		ConnectionString: *schemas.NewSecretVar("postgres://elygate:secret@db/elygate"), Schema: "active_vectors",
	}}
	handler.store.VectorStoreConfig = active
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), active))
	require.NoError(t, store.SetRestartRequiredConfig(context.Background(), &configstoreTables.RestartRequiredConfig{
		Required: true, Reason: "Other restart reason. " + lib.VectorStoreRestartReason,
	}))
	payload, err := json.Marshal(active)
	require.NoError(t, err)
	ctx := newVectorStoreConfigRequestCtx(string(payload))
	handler.updateVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	restart, err := store.GetRestartRequiredConfig(context.Background())
	require.NoError(t, err)
	require.True(t, restart.Required)
	require.Equal(t, "Other restart reason.", restart.Reason)
}

func TestUpdateVectorStoreConfigRejectsInvalidSchemaWithoutChangingStoredConfig(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	original := &vectorstore.Config{Enabled: true, Type: vectorstore.VectorStoreTypePgvector, Config: vectorstore.PgvectorConfig{
		ConnectionString: *schemas.NewSecretVar("postgres://elygate:secret@127.0.0.1:5432/elygate"), Schema: "safe_vectors",
	}}
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), original))
	payload, err := json.Marshal(vectorstore.Config{Enabled: true, Type: vectorstore.VectorStoreTypePgvector, Config: vectorstore.PgvectorConfig{
		ConnectionString: *schemas.NewSecretVar("<REDACTED>"), Schema: `unsafe"; DROP SCHEMA public; --`,
	}})
	require.NoError(t, err)
	ctx := newVectorStoreConfigRequestCtx(string(payload))
	handler.updateVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	stored, err := store.GetVectorStoreConfig(context.Background())
	require.NoError(t, err)
	pg, ok := stored.Config.(vectorstore.PgvectorConfig)
	require.True(t, ok)
	require.Equal(t, "safe_vectors", pg.Schema)
}

func TestUpdateVectorStoreConfigRejectsEmptySecretReferenceWithoutChangingStoredConfig(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	original := &vectorstore.Config{Enabled: true, Type: vectorstore.VectorStoreTypePgvector, Config: vectorstore.PgvectorConfig{
		ConnectionString: *schemas.NewSecretVar("postgres://original@db/elygate"), Schema: "safe_vectors",
	}}
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), original))
	payload := `{"enabled":true,"type":"pgvector","config":{"connection_string":{"type":"env","ref":""},"schema":"changed"}}`
	ctx := newVectorStoreConfigRequestCtx(payload)
	handler.updateVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	stored, err := store.GetVectorStoreConfig(context.Background())
	require.NoError(t, err)
	pg := stored.Config.(vectorstore.PgvectorConfig)
	require.Equal(t, "postgres://original@db/elygate", pg.ConnectionString.GetValue())
	require.Equal(t, "safe_vectors", pg.Schema)
}

func TestGetPasswordPolicyFailures(t *testing.T) {
	tests := []struct {
		name     string
		password string
		want     []string
	}{
		{
			name:     "valid password",
			password: "StrongPass1!",
			want:     []string{},
		},
		{
			name:     "missing all requirements",
			password: "",
			want: []string{
				"at least 12 characters",
				"one uppercase letter",
				"one lowercase letter",
				"one number",
				"one special character",
			},
		},
		{
			name:     "missing character classes",
			password: "weakpassword",
			want: []string{
				"one uppercase letter",
				"one number",
				"one special character",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := getPasswordPolicyFailures(tt.password)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("getPasswordPolicyFailures() = %v, want %v", got, tt.want)
			}
		})
	}
}
