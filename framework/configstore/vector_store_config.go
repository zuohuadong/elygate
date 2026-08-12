package configstore

import (
	"encoding/json"
	"fmt"

	"github.com/maximhq/bifrost/core/schemas"
)

// marshalVectorStoreConfigForStorage keeps secret references as references.
// SecretVar's API JSON intentionally includes its resolved value, but storing
// that representation would copy env/vault secrets into the database when
// database encryption is not configured.
func marshalVectorStoreConfigForStorage(config any) (*string, error) {
	encoded, err := json.Marshal(config)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal vector store config: %w", err)
	}
	var normalized any
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		return nil, fmt.Errorf("failed to normalize vector store config: %w", err)
	}
	normalized = normalizeVectorStoreSecretsForStorage(normalized)
	encoded, err = json.Marshal(normalized)
	if err != nil {
		return nil, fmt.Errorf("failed to encode vector store config for storage: %w", err)
	}
	value := string(encoded)
	return &value, nil
}

func normalizeVectorStoreSecretsForStorage(node any) any {
	switch value := node.(type) {
	case map[string]any:
		secretType, _ := value["type"].(string)
		secretRef, _ := value["ref"].(string)
		if secretRef != "" && isStorageSecretVar(value) &&
			(secretType == string(schemas.SecretTypeEnv) || secretType == string(schemas.SecretTypeVault)) {
			return secretRef
		}
		for key, child := range value {
			value[key] = normalizeVectorStoreSecretsForStorage(child)
		}
		return value
	case []any:
		for index, child := range value {
			value[index] = normalizeVectorStoreSecretsForStorage(child)
		}
		return value
	default:
		return node
	}
}

func isStorageSecretVar(value map[string]any) bool {
	for key := range value {
		if key != "value" && key != "ref" && key != "type" {
			return false
		}
	}
	return true
}
