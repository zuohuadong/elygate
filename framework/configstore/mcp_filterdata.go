package configstore

import (
	"context"
	"sort"

	"github.com/maximhq/bifrost/framework/configstore/tables"
)

// MCPClientFilterData is a narrow projection for the Panel's MCP client
// facets. It deliberately excludes connection strings, headers and OAuth data.
type MCPClientFilterData struct {
	ClientIDs       []string `json:"-"`
	ConnectionTypes []string `json:"connection_types"`
	AuthTypes       []string `json:"auth_types"`
}

// GetMCPClientFilterData returns values from the complete client table without
// materializing or decrypting credential-bearing MCP configuration fields.
func (s *RDBConfigStore) GetMCPClientFilterData(ctx context.Context) (*MCPClientFilterData, error) {
	type filterRow struct {
		ClientID       string `gorm:"column:client_id"`
		ConnectionType string `gorm:"column:connection_type"`
		AuthType       string `gorm:"column:auth_type"`
	}

	var rows []filterRow
	if err := s.DB().WithContext(ctx).
		Model(&tables.TableMCPClient{}).
		Select("client_id", "connection_type", "auth_type").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	clientIDs := make(map[string]struct{}, len(rows))
	connectionTypes := make(map[string]struct{})
	authTypes := make(map[string]struct{})
	for _, row := range rows {
		if row.ClientID != "" {
			clientIDs[row.ClientID] = struct{}{}
		}
		if row.ConnectionType != "" {
			connectionTypes[row.ConnectionType] = struct{}{}
		}
		if row.AuthType != "" {
			authTypes[row.AuthType] = struct{}{}
		}
	}

	result := &MCPClientFilterData{
		ClientIDs:       make([]string, 0, len(clientIDs)),
		ConnectionTypes: make([]string, 0, len(connectionTypes)),
		AuthTypes:       make([]string, 0, len(authTypes)),
	}
	for value := range clientIDs {
		result.ClientIDs = append(result.ClientIDs, value)
	}
	for value := range connectionTypes {
		result.ConnectionTypes = append(result.ConnectionTypes, value)
	}
	for value := range authTypes {
		result.AuthTypes = append(result.AuthTypes, value)
	}
	sort.Strings(result.ClientIDs)
	sort.Strings(result.ConnectionTypes)
	sort.Strings(result.AuthTypes)
	return result, nil
}
