package server

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/routing"
	"github.com/maximhq/bifrost/plugins/routing/rules"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestRoutingStartupFileReconciliation(t *testing.T) {
	// 空策略也必须保持托管；两种文件来源模式都不能覆盖发布内容。
	for _, source := range []string{lib.SourceOfTruthSplit, lib.SourceOfTruthConfigJSON} {
		for _, candidate := range []string{activationRoutingRules, "[]"} {
			name := "rules"
			if candidate == "[]" {
				name = "empty"
			}
			t.Run(source+"/"+name, func(t *testing.T) {
				cs, releases, storeConfig := routingStartupConfigFixture(t)
				attempt := acceptStartupRoutingVersion(t, releases, candidate)
				installation, err := releases.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, compileRoutingRelease, "startup-test")
				require.NoError(t, err)
				before := routingStartupFingerprint(t, cs)
				audits := activationRoutingAudits(t, cs)
				appDir := writeRoutingStartupConfig(t, storeConfig, source)

				config, err := lib.LoadConfig(t.Context(), appDir, lib.WithRoutingPolicyGuard(checkRoutingPolicyStartup))
				require.NoError(t, err)
				t.Cleanup(func() { config.Close(context.Background()) })
				require.Equal(t, string(storeConfig.Type), config.ConfigStore.DB().Dialector.Name())
				require.Equal(t, 4, config.ClientConfig.RoutingChainMaxDepth)
				require.Equal(t, 14, config.ClientConfig.LogRetentionDays, "unrelated file settings must still reconcile")
				require.Equal(t, before, routingStartupFingerprint(t, config.ConfigStore))
				persistedClient, err := cs.GetClientConfig(t.Context())
				require.NoError(t, err)
				require.Equal(t, 4, persistedClient.RoutingChainMaxDepth)
				require.Equal(t, 14, persistedClient.LogRetentionDays)
				head, err := releases.GetRoutingReleaseHead(t.Context())
				require.NoError(t, err)
				require.Equal(t, installation.Head, *head)
				require.Equal(t, audits, activationRoutingAudits(t, cs))

				plugin, err := initRoutingPlugin(t.Context(), nil, config, routing.NewMockGovernance())
				require.NoError(t, err)
				t.Cleanup(func() { require.NoError(t, plugin.Cleanup()) })
				local := plugin.GetRuleStore().(*rules.LocalStore)
				require.ErrorIs(t, local.CheckPolicyWritable(), rules.ErrPolicyManaged)
				require.Equal(t, 4, local.Snapshot().(interface{ ChainMaxDepth() int }).ChainMaxDepth())
				installed := local.GetAllRules(t.Context())
				require.Len(t, installed, len(installation.Policy.Rules))
				for index, rule := range installed {
					require.Equal(t, installation.Policy.Rules[index].ID, rule.ID)
					_, err := local.GetProgram(t.Context(), rule)
					require.NoError(t, err)
				}
			})
		}
	}
}

func TestRoutingStartupRejectsUnreadyBeforeFileReconciliation(t *testing.T) {
	for _, state := range []string{"pending", "drifted"} {
		t.Run(state, func(t *testing.T) {
			cs, releases, storeConfig := routingStartupConfigFixture(t)
			attempt := acceptStartupRoutingVersion(t, releases, activationRoutingRules)
			if state == "drifted" {
				_, err := releases.InstallAcceptedRoutingRelease(t.Context(), attempt.Epoch, compileRoutingRelease, "startup-test")
				require.NoError(t, err)
				require.NoError(t, cs.DB().Model(&tables.TableRoutingRule{}).
					Where("name = ?", "Published").UpdateColumn("cel_expression", "false").Error)
			}
			before := routingStartupFingerprint(t, cs)
			audits := activationRoutingAudits(t, cs)
			head, err := releases.GetRoutingReleaseHead(t.Context())
			require.NoError(t, err)
			appDir := writeRoutingStartupConfig(t, storeConfig, lib.SourceOfTruthConfigJSON)

			config, err := lib.LoadConfig(t.Context(), appDir, lib.WithRoutingPolicyGuard(checkRoutingPolicyStartup))
			if config != nil {
				t.Cleanup(func() { config.Close(context.Background()) })
			}
			require.ErrorIs(t, err, controlplane.ErrRoutingPolicyNotReady)
			require.Nil(t, config, "unready state must not produce a plugin configuration")
			require.Equal(t, before, routingStartupFingerprint(t, cs), "startup must not repair or install")
			client, err := cs.GetClientConfig(t.Context())
			require.NoError(t, err)
			require.Equal(t, 30, client.LogRetentionDays, "the first guard must reject before file reconciliation")
			afterHead, err := releases.GetRoutingReleaseHead(t.Context())
			require.NoError(t, err)
			require.Equal(t, head, afterHead)
			require.Equal(t, audits, activationRoutingAudits(t, cs))
		})
	}
}

func routingStartupConfigFixture(t *testing.T) (configstore.ConfigStore, *controlplane.Store, *configstore.Config) {
	t.Helper()
	logger = noopTestLogger{}
	lib.SetLogger(logger)
	storeConfig := routingTestStoreConfig(t)
	cs, err := configstore.NewConfigStore(t.Context(), storeConfig, logger)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, cs.Close(context.Background())) })
	require.Equal(t, string(storeConfig.Type), cs.DB().Dialector.Name())
	releases, err := controlplane.NewStore(t.Context(), cs)
	require.NoError(t, err)
	require.NoError(t, cs.UpdateClientConfig(t.Context(), &configstore.ClientConfig{
		RoutingChainMaxDepth: 7, LogRetentionDays: 30,
	}))
	require.NoError(t, cs.CreateRoutingRule(t.Context(), &tables.TableRoutingRule{
		ID: uuid.NewString(), Name: "Before publication", Scope: "global",
		CelExpression: "true", Enabled: new(true),
	}))
	return cs, releases, storeConfig
}

func acceptStartupRoutingVersion(t *testing.T, releases *controlplane.Store, candidate string) *controlplane.RoutingReleaseAttempt {
	t.Helper()
	draft, err := releases.CreateRoutingDraft(t.Context(), controlplane.RoutingDraftContent{
		Name: "Startup candidate", RulesJSON: candidate, ChainMaxDepth: 4,
	})
	require.NoError(t, err)
	version, err := releases.CreateRoutingPolicyVersion(t.Context(), draft.ID, 1, "startup-test")
	require.NoError(t, err)
	attempt, err := releases.AcceptRoutingRelease(t.Context(), controlplane.RoutingReleaseRequest{
		VersionID: version.ID, IdempotencyKey: uuid.NewString(), ActorID: "startup-test",
	})
	require.NoError(t, err)
	return attempt
}

func routingStartupFingerprint(t *testing.T, cs configstore.ConfigStore) string {
	t.Helper()
	var fingerprint string
	require.NoError(t, cs.ExecuteTransaction(t.Context(), func(tx *gorm.DB) error {
		policy, err := configstore.SnapshotRoutingPolicy(tx)
		if err != nil {
			return err
		}
		fingerprint, err = configstore.RoutingPolicyFingerprint(*policy)
		return err
	}))
	return fingerprint
}

func writeRoutingStartupConfig(t *testing.T, storeConfig *configstore.Config, source string) string {
	t.Helper()
	appDir := t.TempDir()
	// 本地目录替代所有目录同步 URL，避免启动测试使用外网。
	catalogURLs := make(map[string]string)
	for name, body := range map[string]string{"pricing": "{}", "model_parameters": "{}", "mcp_library": `{"servers":[]}`} {
		filename := filepath.Join(appDir, name+".json")
		require.NoError(t, os.WriteFile(filename, []byte(body), 0o600))
		catalogURLs[name+"_url"] = (&url.URL{Scheme: "file", Path: filepath.ToSlash(filename)}).String()
	}
	payload, err := json.Marshal(map[string]any{
		"$schema": lib.DefaultConfigSchemaURL, "version": 2, "source_of_truth": source,
		"config_store": storeConfig, "logs_store": map[string]any{"enabled": false},
		"vector_store": map[string]any{"enabled": false, "type": "chromem"}, "providers": map[string]any{},
		"client": map[string]any{"routing_chain_max_depth": 9, "log_retention_days": 14},
		"governance": map[string]any{"routing_rules": []map[string]any{{
			"id": uuid.NewString(), "name": "File must not publish", "scope": "global", "enabled": true,
			"cel_expression": "true", "targets": []map[string]any{{"provider": "openai", "model": "file-only", "weight": 1}},
		}}},
		"framework": map[string]any{"pricing": catalogURLs},
	})
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(appDir, "config.json"), payload, 0o600))
	return appDir
}
