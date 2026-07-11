package handlers

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/vectorstore"
	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"github.com/valyala/fasthttp"
)

func TestCheckURLAccessibilitySupportsRelativeFileURL(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "pricing.json"), []byte(`{}`), 0o600))
	t.Chdir(dir)

	require.NoError(t, checkURLAccessibility("file://./pricing.json"))
}

func newVectorStoreConfigHandlerTest(t *testing.T) (*ConfigHandler, configstore.ConfigStore) {
	t.Helper()
	store, err := configstore.NewConfigStore(context.Background(), &configstore.Config{
		Enabled: true,
		Type:    configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{
			Path: filepath.Join(t.TempDir(), "vector-store-config.db"),
		},
	}, &mockLogger{})
	require.NoError(t, err)
	require.NotNil(t, store)
	return NewConfigHandler(nil, &lib.Config{ConfigStore: store}), store
}

func newVectorStoreConfigRequestCtx(body string) *fasthttp.RequestCtx {
	var request fasthttp.Request
	request.SetBodyString(body)
	ctx := &fasthttp.RequestCtx{}
	ctx.Init(&request, nil, nil)
	return ctx
}

func TestGetVectorStoreConfigRedactsPgvectorConnectionString(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	active := &vectorstore.Config{
		Enabled: true,
		Type:    vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{
			ConnectionString: *schemas.NewSecretVar("postgres://elygate:super-secret@db.internal:5432/elygate"),
			Schema:           "elygate_vectors",
		},
	}
	handler.store.VectorStoreConfig = active
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), active))

	ctx := newVectorStoreConfigRequestCtx("")
	handler.getVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.NotContains(t, string(ctx.Response.Body()), "super-secret")

	var response struct {
		Enabled          bool                        `json:"enabled"`
		Type             vectorstore.VectorStoreType `json:"type"`
		Config           vectorstore.PgvectorConfig  `json:"config"`
		RuntimeConnected bool                        `json:"runtime_connected"`
		RestartRequired  bool                        `json:"restart_required"`
	}
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
	require.True(t, response.Enabled)
	require.Equal(t, vectorstore.VectorStoreTypePgvector, response.Type)
	require.Equal(t, "elygate_vectors", response.Config.Schema)
	require.Equal(t, "<REDACTED>", response.Config.ConnectionString.GetValue())
	require.False(t, response.RuntimeConnected)
	require.False(t, response.RestartRequired)
}

func TestGetVectorStoreConfigRejectsUnsupportedExistingStore(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), &vectorstore.Config{
		Enabled: false,
		Type:    vectorstore.VectorStoreTypeRedis,
		Config:  vectorstore.RedisConfig{},
	}))

	ctx := newVectorStoreConfigRequestCtx("")
	handler.getVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusConflict, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.Contains(t, string(ctx.Response.Body()), "only supports pgvector")
}

func TestVectorStoreConfigConfigJSONAuthorityIsReadOnly(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	original := &vectorstore.Config{
		Enabled: true,
		Type:    vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{
			ConnectionString: *schemas.NewSecretVar("postgres://elygate:secret@127.0.0.1:5432/elygate"),
			Schema:           "file_vectors",
		},
	}
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), original))
	handler.store.VectorStoreConfigManagedByConfigJSON = true

	getCtx := newVectorStoreConfigRequestCtx("")
	handler.getVectorStoreConfig(getCtx)
	require.Equal(t, fasthttp.StatusOK, getCtx.Response.StatusCode(), string(getCtx.Response.Body()))
	var response struct {
		Editable          bool   `json:"editable"`
		ManagedBy         string `json:"managed_by"`
		ManagementMessage string `json:"management_message"`
	}
	require.NoError(t, json.Unmarshal(getCtx.Response.Body(), &response))
	require.False(t, response.Editable)
	require.Equal(t, "config.json", response.ManagedBy)
	require.Contains(t, response.ManagementMessage, "config.json")

	payload, err := json.Marshal(vectorstore.Config{
		Enabled: true,
		Type:    vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{
			ConnectionString: *schemas.NewSecretVar("postgres://elygate:replacement@127.0.0.1:5432/elygate"),
			Schema:           "dashboard_vectors",
		},
	})
	require.NoError(t, err)

	putCtx := newVectorStoreConfigRequestCtx(string(payload))
	handler.updateVectorStoreConfig(putCtx)
	require.Equal(t, fasthttp.StatusForbidden, putCtx.Response.StatusCode(), string(putCtx.Response.Body()))
	require.Contains(t, string(putCtx.Response.Body()), "config.json")

	stored, err := store.GetVectorStoreConfig(context.Background())
	require.NoError(t, err)
	require.NotNil(t, stored)
	storedPgvector, ok := stored.Config.(vectorstore.PgvectorConfig)
	require.True(t, ok)
	require.Equal(t, "file_vectors", storedPgvector.Schema)
	require.Equal(t, "postgres://elygate:secret@127.0.0.1:5432/elygate", storedPgvector.ConnectionString.GetValue())
}

func TestUpdateVectorStoreConfigPreservesRedactedPgvectorConnectionString(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	storedConnectionString := "postgres://elygate:super-secret@db.internal:5432/elygate"
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), &vectorstore.Config{
		Enabled: true,
		Type:    vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{
			ConnectionString: *schemas.NewSecretVar(storedConnectionString),
			Schema:           "old_vectors",
		},
	}))

	payload, err := json.Marshal(vectorstore.Config{
		Enabled: true,
		Type:    vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{
			ConnectionString: *schemas.NewSecretVar("<REDACTED>"),
			Schema:           "new_vectors",
		},
	})
	require.NoError(t, err)

	ctx := newVectorStoreConfigRequestCtx(string(payload))
	handler.updateVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.NotContains(t, string(ctx.Response.Body()), "super-secret")

	stored, err := store.GetVectorStoreConfig(context.Background())
	require.NoError(t, err)
	require.NotNil(t, stored)
	storedPgvector, ok := stored.Config.(vectorstore.PgvectorConfig)
	require.True(t, ok)
	require.Equal(t, storedConnectionString, storedPgvector.ConnectionString.GetValue())
	require.Equal(t, "new_vectors", storedPgvector.Schema)

	restartConfig, err := store.GetRestartRequiredConfig(context.Background())
	require.NoError(t, err)
	require.NotNil(t, restartConfig)
	require.True(t, restartConfig.Required)
	require.Contains(t, restartConfig.Reason, "Vector store")

	var response struct {
		Config           vectorstore.PgvectorConfig `json:"config"`
		RuntimeConnected bool                       `json:"runtime_connected"`
		RestartRequired  bool                       `json:"restart_required"`
	}
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
	require.Equal(t, "<REDACTED>", response.Config.ConnectionString.GetValue())
	require.False(t, response.RuntimeConnected)
	require.True(t, response.RestartRequired)
}

func TestUpdateVectorStoreConfigAcceptsNewPgvectorConnectionStringWithoutEchoingIt(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	connectionString := "postgres://elygate:new-secret@127.0.0.1:5432/elygate"
	payload, err := json.Marshal(vectorstore.Config{
		Enabled: true,
		Type:    vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{
			ConnectionString: *schemas.NewSecretVar(connectionString),
			Schema:           "elygate_vectors",
		},
	})
	require.NoError(t, err)

	ctx := newVectorStoreConfigRequestCtx(string(payload))
	handler.updateVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
	require.NotContains(t, string(ctx.Response.Body()), "new-secret")

	stored, err := store.GetVectorStoreConfig(context.Background())
	require.NoError(t, err)
	storedPgvector, ok := stored.Config.(vectorstore.PgvectorConfig)
	require.True(t, ok)
	require.Equal(t, connectionString, storedPgvector.ConnectionString.GetValue())

	var response struct {
		Config vectorstore.PgvectorConfig `json:"config"`
	}
	require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
	require.Equal(t, "<REDACTED>", response.Config.ConnectionString.GetValue())
}

func TestUpdateVectorStoreConfigRejectsInvalidPgvectorSchemaWithoutChangingStoredConfig(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	original := &vectorstore.Config{
		Enabled: true,
		Type:    vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{
			ConnectionString: *schemas.NewSecretVar("postgres://elygate:secret@127.0.0.1:5432/elygate"),
			Schema:           "safe_vectors",
		},
	}
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), original))

	payload, err := json.Marshal(vectorstore.Config{
		Enabled: true,
		Type:    vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{
			ConnectionString: *schemas.NewSecretVar("<REDACTED>"),
			Schema:           `unsafe"; DROP SCHEMA public; --`,
		},
	})
	require.NoError(t, err)

	ctx := newVectorStoreConfigRequestCtx(string(payload))
	handler.updateVectorStoreConfig(ctx)
	require.Equal(t, fasthttp.StatusBadRequest, ctx.Response.StatusCode(), string(ctx.Response.Body()))

	stored, err := store.GetVectorStoreConfig(context.Background())
	require.NoError(t, err)
	storedPgvector, ok := stored.Config.(vectorstore.PgvectorConfig)
	require.True(t, ok)
	require.Equal(t, "safe_vectors", storedPgvector.Schema)
}

func TestUpdateVectorStoreConfigClearsRestartWhenRestoredToActiveConfig(t *testing.T) {
	handler, store := newVectorStoreConfigHandlerTest(t)
	active := &vectorstore.Config{
		Enabled: true,
		Type:    vectorstore.VectorStoreTypePgvector,
		Config: vectorstore.PgvectorConfig{
			ConnectionString: *schemas.NewSecretVar("postgres://elygate:secret@127.0.0.1:5432/elygate"),
			Schema:           "active_vectors",
		},
	}
	handler.store.VectorStoreConfig = active
	require.NoError(t, store.UpdateVectorStoreConfig(context.Background(), active))

	update := func(schema string) bool {
		t.Helper()
		payload, err := json.Marshal(vectorstore.Config{
			Enabled: true,
			Type:    vectorstore.VectorStoreTypePgvector,
			Config: vectorstore.PgvectorConfig{
				ConnectionString: *schemas.NewSecretVar("<REDACTED>"),
				Schema:           schema,
			},
		})
		require.NoError(t, err)
		ctx := newVectorStoreConfigRequestCtx(string(payload))
		handler.updateVectorStoreConfig(ctx)
		require.Equal(t, fasthttp.StatusOK, ctx.Response.StatusCode(), string(ctx.Response.Body()))
		var response struct {
			RestartRequired bool `json:"restart_required"`
		}
		require.NoError(t, json.Unmarshal(ctx.Response.Body(), &response))
		return response.RestartRequired
	}

	require.True(t, update("changed_vectors"))
	require.False(t, update("active_vectors"))
	restartConfig, err := store.GetRestartRequiredConfig(context.Background())
	require.NoError(t, err)
	require.NotNil(t, restartConfig)
	require.False(t, restartConfig.Required)
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
