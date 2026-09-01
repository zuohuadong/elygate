package configstore

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func TestGetMCPClientFilterDataUsesCompleteNarrowProjection(t *testing.T) {
	store := setupRDBTestStore(t)
	ctx := context.Background()
	clients := []tables.TableMCPClient{
		{ClientID: "z-client", Name: "Zulu", ConnectionType: "sse", AuthType: "oauth"},
		{ClientID: "a-client", Name: "Alpha", ConnectionType: "http", AuthType: "none"},
		{ClientID: "b-client", Name: "Beta", ConnectionType: "http", AuthType: "none"},
	}
	require.NoError(t, store.DB().WithContext(ctx).Create(&clients).Error)

	got, err := store.GetMCPClientFilterData(ctx)

	require.NoError(t, err)
	require.Equal(t, []string{"a-client", "b-client", "z-client"}, got.ClientIDs)
	require.Equal(t, []string{"http", "sse"}, got.ConnectionTypes)
	require.Equal(t, []string{"none", "oauth"}, got.AuthTypes)
}
