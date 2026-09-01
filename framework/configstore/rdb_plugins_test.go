package configstore

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func TestGetPluginsBestEffortIsolatesCorruptRowsAndAllowsDirectDelete(t *testing.T) {
	store := setupRDBTestStore(t)
	ctx := context.Background()
	require.NoError(t, store.CreatePlugin(ctx, &tables.TablePlugin{
		Name: "healthy", Enabled: true, Config: map[string]any{"store": "sqlite"},
	}))
	require.NoError(t, store.CreatePlugin(ctx, &tables.TablePlugin{
		Name: "broken", Enabled: true, Config: map[string]any{"store": "sqlite"},
	}))
	require.NoError(t, store.DB().Model(&tables.TablePlugin{}).
		Where("name = ?", "broken").UpdateColumn("config_json", "{not-json").Error)
	exists, err := store.PluginRecordExistsDirect(ctx, "broken")
	require.NoError(t, err)
	require.True(t, exists)

	plugins, diagnostics, err := store.GetPluginsBestEffort(ctx)
	require.NoError(t, err)
	require.Len(t, plugins, 2)
	require.Error(t, diagnostics["broken"])
	require.NotContains(t, diagnostics, "healthy")

	require.NoError(t, store.DeletePluginDirect(ctx, "broken"))
	exists, err = store.PluginRecordExistsDirect(ctx, "broken")
	require.NoError(t, err)
	require.False(t, exists)
	_, err = store.GetPlugin(ctx, "broken")
	require.ErrorIs(t, err, ErrNotFound)
	require.ErrorIs(t, store.DeletePluginDirect(ctx, "broken"), ErrNotFound)
}
