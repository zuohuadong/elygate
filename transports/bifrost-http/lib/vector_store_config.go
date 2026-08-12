package lib

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/vectorstore"
)

type vectorStoreConfigSource string

const (
	vectorStoreSourceNone            vectorStoreConfigSource = "none"
	vectorStoreSourceDatabase        vectorStoreConfigSource = "database"
	vectorStoreSourceConfigJSON      vectorStoreConfigSource = "config.json"
	vectorStoreInitializationTimeout                         = 30 * time.Second
	vectorStoreFileHashKey                                   = "vector_store_file_hash"
	// VectorStoreMutationLockKey serializes dashboard updates with startup
	// reconciliation across every server sharing the configuration database.
	VectorStoreMutationLockKey = "config/vector-store"
	// VectorStoreMutationLockTTL outlives the bounded reconciliation operation.
	VectorStoreMutationLockTTL = 2 * time.Minute
	// VectorStoreMutationTimeout bounds database work while the lease is held.
	VectorStoreMutationTimeout = 90 * time.Second
	// VectorStoreRestartReason identifies only the vector-store-owned part of
	// the shared restart marker.
	VectorStoreRestartReason = "Vector store configuration has been updated. A restart is required to load the saved pgvector settings."
)

// NewVectorStoreMutationLock returns the shared lock used by both the panel
// update path and startup reconciliation.
func NewVectorStoreMutationLock(store configstore.LockStore, lockLogger schemas.Logger) (*configstore.DistributedLock, error) {
	manager := configstore.NewDistributedLockManager(store, lockLogger,
		configstore.WithDefaultTTL(VectorStoreMutationLockTTL),
		configstore.WithRetryInterval(100*time.Millisecond),
		configstore.WithMaxRetries(50),
	)
	return manager.NewLock(VectorStoreMutationLockKey)
}

func withVectorStoreMutationLock(ctx context.Context, store configstore.ConfigStore, operation func(context.Context) error) error {
	lock, err := NewVectorStoreMutationLock(store, logger)
	if err != nil {
		return fmt.Errorf("failed to create vector store configuration lock: %w", err)
	}
	lockCtx, cancelLock := context.WithTimeout(ctx, 10*time.Second)
	defer cancelLock()
	if err := lock.Lock(lockCtx); err != nil {
		return fmt.Errorf("failed to acquire vector store configuration lock: %w", err)
	}
	defer func() {
		unlockCtx, cancelUnlock := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelUnlock()
		if err := lock.Unlock(unlockCtx); err != nil {
			logger.Warn("failed to release vector store configuration lock: %v", err)
		}
	}()
	mutationCtx, cancelMutation := context.WithTimeout(ctx, VectorStoreMutationTimeout)
	defer cancelMutation()
	return operation(mutationCtx)
}

func stripResolvedSecretValues(configNode any) {
	configMap, ok := configNode.(map[string]any)
	if !ok {
		return
	}
	for _, fieldNode := range configMap {
		stripResolvedSecretValues(fieldNode)
	}
	secretType, _ := configMap["type"].(string)
	secretRef, _ := configMap["ref"].(string)
	if secretRef != "" && (secretType == string(schemas.SecretTypeEnv) || secretType == string(schemas.SecretTypeVault)) {
		configMap["value"] = ""
	}
}

func vectorStoreConfigHash(config *vectorstore.Config) (string, error) {
	encodedConfig, err := json.Marshal(config)
	if err != nil {
		return "", fmt.Errorf("failed to marshal vector store config for hashing: %w", err)
	}
	var decodedConfig any
	if err := json.Unmarshal(encodedConfig, &decodedConfig); err != nil {
		return "", fmt.Errorf("failed to normalize vector store config for hashing: %w", err)
	}
	stripResolvedSecretValues(decodedConfig)
	normalizedConfig, err := json.Marshal(decodedConfig)
	if err != nil {
		return "", fmt.Errorf("failed to encode normalized vector store config: %w", err)
	}
	digest := sha256.Sum256(normalizedConfig)
	return hex.EncodeToString(digest[:]), nil
}

func vectorStoreFileChanged(ctx context.Context, store configstore.ConfigStore, fileConfig *vectorstore.Config) (bool, error) {
	fileHash, err := vectorStoreConfigHash(fileConfig)
	if err != nil {
		return false, err
	}
	checkpoint, err := store.GetConfig(ctx, vectorStoreFileHashKey)
	if errors.Is(err, configstore.ErrNotFound) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to get vector store file hash: %w", err)
	}
	return checkpoint.Value != fileHash, nil
}

func resolveVectorStoreConfig(ctx context.Context, configData *ConfigData, store configstore.ConfigStore) (*vectorstore.Config, vectorStoreConfigSource, error) {
	if configData == nil {
		return nil, vectorStoreSourceNone, nil
	}
	if store != nil && !configData.vectorStoreManagedByConfigJSON() {
		if configData.VectorStoreConfig != nil {
			changed, err := vectorStoreFileChanged(ctx, store, configData.VectorStoreConfig)
			if err != nil {
				return nil, vectorStoreSourceNone, err
			}
			if changed {
				return configData.VectorStoreConfig, vectorStoreSourceConfigJSON, nil
			}
		}
		persisted, err := store.GetVectorStoreConfig(ctx)
		if err != nil {
			return nil, vectorStoreSourceNone, fmt.Errorf("failed to get vector store config: %w", err)
		}
		if persisted != nil {
			return persisted, vectorStoreSourceDatabase, nil
		}
	}
	if configData.VectorStoreConfig != nil {
		return configData.VectorStoreConfig, vectorStoreSourceConfigJSON, nil
	}
	return nil, vectorStoreSourceNone, nil
}

func persistVectorStoreFileConfig(ctx context.Context, store configstore.ConfigStore, fileConfig *vectorstore.Config) error {
	if err := store.UpdateVectorStoreConfig(ctx, fileConfig); err != nil {
		return fmt.Errorf("failed to persist vector store config: %w", err)
	}
	return persistVectorStoreFileHash(ctx, store, fileConfig)
}

func persistVectorStoreFileHash(ctx context.Context, store configstore.ConfigStore, fileConfig *vectorstore.Config) error {
	fileHash, err := vectorStoreConfigHash(fileConfig)
	if err != nil {
		return err
	}
	checkpoint := &configstoreTables.TableGovernanceConfig{Key: vectorStoreFileHashKey, Value: fileHash}
	if err := store.UpdateConfig(ctx, checkpoint); err != nil {
		return fmt.Errorf("failed to persist vector store file hash: %w", err)
	}
	return nil
}

type vectorStoreFactory func(context.Context, *vectorstore.Config, schemas.Logger) (vectorstore.VectorStore, error)

func initializeResolvedVectorStore(ctx context.Context, config *Config, desired *vectorstore.Config, source vectorStoreConfigSource, factory vectorStoreFactory) (bool, error) {
	if desired == nil {
		return false, nil
	}
	if !desired.Enabled {
		config.VectorStoreConfig = desired
		return false, nil
	}
	logger.Info("connecting to vectorstore")
	initializationCtx, cancelInitialization := context.WithTimeout(ctx, vectorStoreInitializationTimeout)
	defer cancelInitialization()
	store, err := factory(initializationCtx, desired, logger)
	if err != nil {
		if source == vectorStoreSourceDatabase {
			logger.Error("failed to connect to database-managed vector store; cache is disabled until the saved configuration is corrected")
			config.VectorStore = nil
			config.VectorStoreConfig = nil
			return true, nil
		}
		return false, fmt.Errorf("failed to connect to vector store: %w", err)
	}
	config.VectorStore = store
	config.VectorStoreConfig = desired
	return false, nil
}

func initializeVectorStoreConfig(ctx context.Context, config *Config, configData *ConfigData, factory vectorStoreFactory) error {
	operation := func(operationCtx context.Context) error {
		desired, source, err := resolveVectorStoreConfig(operationCtx, configData, config.ConfigStore)
		if err != nil {
			return err
		}
		if desired == nil {
			return nil
		}
		degraded, err := initializeResolvedVectorStore(operationCtx, config, desired, source, factory)
		if err != nil {
			return err
		}
		if config.ConfigStore != nil && source == vectorStoreSourceConfigJSON {
			if err := persistVectorStoreFileConfig(operationCtx, config.ConfigStore, desired); err != nil {
				return err
			}
		}
		config.vectorStoreStartupDegraded = degraded
		return nil
	}
	if config.ConfigStore == nil {
		return operation(ctx)
	}
	return withVectorStoreMutationLock(ctx, config.ConfigStore, operation)
}

// VectorStoreConfigMatchesRuntime reports whether a desired persisted config
// is represented by the immutable startup snapshot.
func VectorStoreConfigMatchesRuntime(desired, active *vectorstore.Config) bool {
	if (desired == nil || !desired.Enabled) && (active == nil || !active.Enabled) {
		return true
	}
	if desired == nil || active == nil || desired.Enabled != active.Enabled || desired.Type != active.Type {
		return false
	}
	if desired.Type != vectorstore.VectorStoreTypePgvector {
		return true
	}
	desiredConfig, desiredOK := pgvectorConfigValue(desired.Config)
	activeConfig, activeOK := pgvectorConfigValue(active.Config)
	if !desiredOK || !activeOK {
		return false
	}
	desiredSchema := desiredConfig.Schema
	if desiredSchema == "" {
		desiredSchema = "bifrost_vectors"
	}
	activeSchema := activeConfig.Schema
	if activeSchema == "" {
		activeSchema = "bifrost_vectors"
	}
	return desiredSchema == activeSchema && desiredConfig.ConnectionString.Equals(&activeConfig.ConnectionString)
}

func pgvectorConfigValue(config any) (vectorstore.PgvectorConfig, bool) {
	switch configured := config.(type) {
	case vectorstore.PgvectorConfig:
		return configured, true
	case *vectorstore.PgvectorConfig:
		if configured != nil {
			return *configured, true
		}
	}
	return vectorstore.PgvectorConfig{}, false
}

func clearAppliedVectorStoreRestartReason(ctx context.Context, store configstore.ConfigStore) error {
	current, err := store.GetRestartRequiredConfig(ctx)
	if err != nil {
		return fmt.Errorf("failed to get restart required config: %w", err)
	}
	if current == nil || !current.Required || !strings.Contains(current.Reason, VectorStoreRestartReason) {
		return nil
	}
	remaining := strings.TrimSpace(strings.ReplaceAll(current.Reason, VectorStoreRestartReason, ""))
	if remaining == "" {
		return store.ClearRestartRequiredConfig(ctx)
	}
	return store.SetRestartRequiredConfig(ctx, &configstoreTables.RestartRequiredConfig{Required: true, Reason: remaining})
}

// MarkRestartApplied removes only the vector-store-owned marker after binding.
// A concurrent update or a degraded startup leaves the marker intact.
func (c *Config) MarkRestartApplied(ctx context.Context) {
	if c == nil || c.ConfigStore == nil || c.vectorStoreStartupDegraded {
		return
	}
	err := withVectorStoreMutationLock(ctx, c.ConfigStore, func(operationCtx context.Context) error {
		desired, err := c.ConfigStore.GetVectorStoreConfig(operationCtx)
		if err != nil {
			return fmt.Errorf("failed to get vector store config: %w", err)
		}
		if !VectorStoreConfigMatchesRuntime(desired, c.VectorStoreConfig) {
			return nil
		}
		return clearAppliedVectorStoreRestartReason(operationCtx, c.ConfigStore)
	})
	if err != nil {
		logger.Warn("failed to reconcile vector store restart marker: %v", err)
	}
}
