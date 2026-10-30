package server

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/routing"
	"github.com/maximhq/bifrost/plugins/routing/rules"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
	"github.com/stretchr/testify/require"
)

const activationRoutingRules = `[{
	"name":"Published",
	"cel_expression":"model == \"incoming\"",
	"targets":[
		{"provider":"openai","model":"first","weight":0.5},
		{"provider":"anthropic","model":"second","weight":0.5}
	],
	"fallbacks":["openai/mini"]
}]`

func TestRoutingReleaseActivationSwapsGenerationThenMemoryDepth(t *testing.T) {
	server, releases, cs, attempt := pendingRoutingActivation(t, activationRoutingRules)
	plugin, err := server.getRoutingPlugin()
	require.NoError(t, err)
	store := plugin.GetRuleStore().(*rules.LocalStore)
	before := store.Snapshot()
	require.Equal(t, "old-live", store.GetAllRules(t.Context())[0].ID)
	require.Equal(t, 7, before.(interface{ ChainMaxDepth() int }).ChainMaxDepth())

	require.NoError(t, server.installAcceptedRoutingRelease(t.Context(), releases, attempt.Epoch, "activator"))

	after := store.Snapshot()
	require.NotSame(t, before, after)
	require.Equal(t, 4, after.(interface{ ChainMaxDepth() int }).ChainMaxDepth())
	require.Equal(t, 4, server.Config.ClientConfig.RoutingChainMaxDepth)
	require.Nil(t, activationAdmission(server, t))
	require.ErrorIs(t, store.CheckPolicyWritable(), rules.ErrPolicyManaged)
	require.ErrorIs(t, server.ReloadRoutingRule(t.Context(), "old-live"), rules.ErrPolicyManaged)
	require.ErrorIs(t, server.RemoveRoutingRule(t.Context(), "old-live"), rules.ErrPolicyManaged)
	require.ErrorIs(t, server.ReloadPlugin(t.Context(), routing.PluginName, nil, nil, nil, nil), rules.ErrPolicyManaged)
	installed := store.GetAllRules(t.Context())
	require.Len(t, installed, 1)
	require.NotEqual(t, "old-live", installed[0].ID)
	require.Equal(t, "Published", installed[0].Name)
	require.Equal(t, "model == \"incoming\"", installed[0].CelExpression)
	require.Len(t, installed[0].Targets, 2)
	require.Equal(t, 0, *installed[0].Targets[0].Position)
	require.Equal(t, "first", *installed[0].Targets[0].Model)
	require.Equal(t, 1, *installed[0].Targets[1].Position)
	require.Equal(t, "second", *installed[0].Targets[1].Model)
	require.Equal(t, []string{"openai/mini"}, tables.RoutingFallbackStrings(installed[0].ParsedFallbacks))
	program, err := store.GetProgram(t.Context(), installed[0])
	require.NoError(t, err)
	require.NotNil(t, program)

	head, err := releases.GetRoutingReleaseHead(t.Context())
	require.NoError(t, err)
	require.True(t, head.IsApplied())
	require.Len(t, activationRoutingAudits(t, cs), 2)

	restarted := restartRoutingPlugin(t, cs)
	restartedRules := restarted.GetRuleStore().GetAllRules(t.Context())
	require.Equal(t, installed[0].ID, restartedRules[0].ID)
	require.Equal(t, 4, restarted.GetRuleStore().(*rules.LocalStore).Snapshot().(interface{ ChainMaxDepth() int }).ChainMaxDepth())
	require.Equal(t, []string{"openai/mini"}, tables.RoutingFallbackStrings(restartedRules[0].ParsedFallbacks))
}

func TestRoutingAdmissionConfiguredBeforeReleaseManagement(t *testing.T) {
	server, store := routingAdmissionFixture(t)
	require.NoError(t, server.configureRoutingAdmission())
	require.Nil(t, activationAdmission(server, t))

	pinned := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	defer pinned.Cancel()
	require.Nil(t, server.Client.AdmitRequest(pinned, nil))
	before := store.SnapshotForRequest(pinned)
	require.True(t, store.CloseAdmission())
	refusal := activationAdmission(server, t)
	require.NotNil(t, refusal)
	require.Equal(t, 503, refusal.EffectiveHTTPStatus())
	require.False(t, *refusal.AllowFallbacks)
	require.NoError(t, server.configureRoutingAdmission(), "rewiring must not reopen a closed store")
	require.NotNil(t, activationAdmission(server, t))
	require.Nil(t, server.Client.AdmitRequest(pinned, nil), "already-pinned requests may finish")
	require.Same(t, before, store.SnapshotForRequest(pinned))
	store.OpenAdmission()
	require.Nil(t, activationAdmission(server, t))
}

func TestRoutingAdmissionFollowsUnmanagedPluginLifecycle(t *testing.T) {
	server, previous := routingAdmissionFixture(t)
	require.NoError(t, server.configureRoutingAdmission())
	replacement, err := routing.Init(t.Context(), nil, rules.NewMockLogger(), nil, routing.NewMockGovernance())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, replacement.Cleanup()) })
	require.NoError(t, server.SyncLoadedPlugin(t.Context(), routing.PluginName, replacement, nil, nil))
	current := replacement.GetRuleStore().(*rules.LocalStore)
	previous.CloseAdmission()
	require.Nil(t, activationAdmission(server, t), "the retired store cannot gate new requests")
	current.CloseAdmission()
	require.NotNil(t, activationAdmission(server, t), "reload must bind admission to the replacement store")
	current.OpenAdmission()
	require.NoError(t, server.RemovePlugin(t.Context(), routing.PluginName))
	current.CloseAdmission()
	require.Nil(t, activationAdmission(server, t), "a removed plugin must not retain its admission callback")
}

func TestRoutingAdmissionCustomStoreKeepsUpstreamContract(t *testing.T) {
	server, previous := routingAdmissionFixture(t)
	require.NoError(t, server.configureRoutingAdmission())
	custom, err := routing.InitFromStore(t.Context(), nil, rules.NewMockLogger(), nil,
		routingPolicyCustomStore{previous}, routing.NewMockGovernance())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, custom.Cleanup()) })
	require.NoError(t, server.SyncLoadedPlugin(t.Context(), routing.PluginName, custom, nil, nil))
	previous.CloseAdmission()
	require.Nil(t, activationAdmission(server, t), "a custom store without admission keeps upstream semantics")
}

func routingAdmissionFixture(t testing.TB) (*BifrostHTTPServer, *rules.LocalStore) {
	t.Helper()
	logger = noopTestLogger{}
	plugin, err := routing.Init(t.Context(), nil, rules.NewMockLogger(), nil, routing.NewMockGovernance())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, plugin.Cleanup()) })
	config := &lib.Config{ClientConfig: &configstore.ClientConfig{}}
	plugins := []schemas.BasePlugin{plugin}
	config.BasePlugins.Store(&plugins)
	client, err := bifrost.Init(t.Context(), schemas.BifrostConfig{
		Account: lib.NewBaseAccount(config), Logger: rules.NewMockLogger(), InitialPoolSize: 1,
	})
	require.NoError(t, err)
	t.Cleanup(client.Shutdown)
	serverContext := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	t.Cleanup(serverContext.Cancel)
	return &BifrostHTTPServer{Ctx: serverContext, Config: config, Client: client}, plugin.GetRuleStore().(*rules.LocalStore)
}

func BenchmarkRoutingAdmissionBootstrap(b *testing.B) {
	for _, configured := range []bool{false, true} {
		name := "disabled"
		if configured {
			name = "configured"
		}
		b.Run(name, func(b *testing.B) {
			server, _ := routingAdmissionFixture(b)
			if configured {
				require.NoError(b, server.configureRoutingAdmission())
			}
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
				// Gateway requests already carry metadata before admission.
				ctx.SetValue(schemas.BifrostContextKeyRequestID, "benchmark")
				if refusal := server.Client.AdmitRequest(ctx, nil); refusal != nil {
					b.Fatal(refusal.Error.Message)
				}
				ctx.Cancel()
			}
		})
	}
}

func TestRoutingReleaseActivationConflictLeavesCommittedPolicy(t *testing.T) {
	server, releases, cs, attempt := pendingRoutingActivation(t, activationRoutingRules)
	plugin, err := server.getRoutingPlugin()
	require.NoError(t, err)
	local := plugin.GetRuleStore().(*rules.LocalStore)
	plugins := []schemas.BasePlugin{replaceRoutingStore(t, plugin, conflictRoutingStore{LocalStore: local})}
	server.Config.BasePlugins.Store(&plugins)
	before := local.Snapshot()

	err = server.installAcceptedRoutingRelease(t.Context(), releases, attempt.Epoch, "activator")
	require.ErrorIs(t, err, rules.ErrPolicyConflict)
	require.ErrorContains(t, err, "failed closed")
	require.Same(t, before, local.Snapshot())
	require.Equal(t, "old-live", local.GetAllRules(t.Context())[0].ID)
	require.Equal(t, 7, server.Config.ClientConfig.RoutingChainMaxDepth)
	refusal := activationAdmission(server, t)
	require.NotNil(t, refusal, "a returned error alone must not leave the process serving old policy")
	require.Equal(t, 503, refusal.EffectiveHTTPStatus())
	require.False(t, *refusal.AllowFallbacks)
	require.ErrorIs(t, server.ReloadRoutingRule(t.Context(), "old-live"), rules.ErrPolicyAdmissionClosed)
	require.ErrorIs(t, local.UpsertRule(t.Context(), &tables.TableRoutingRule{ID: "bypass"}), rules.ErrPolicyAdmissionClosed)
	require.ErrorIs(t, local.DeleteRule(t.Context(), "old-live"), rules.ErrPolicyAdmissionClosed)
	require.ErrorIs(t, local.UpdateChainMaxDepth(3), rules.ErrPolicyAdmissionClosed)
	require.Error(t, server.installAcceptedRoutingRelease(t.Context(), releases, attempt.Epoch+1, "stale"))
	require.NotNil(t, activationAdmission(server, t), "a rejected retry cannot reopen a failed activation")

	head, err := releases.GetRoutingReleaseHead(t.Context())
	require.NoError(t, err)
	require.True(t, head.IsApplied(), "generation conflict must not roll back the committed release")
	live, err := cs.GetRoutingRules(t.Context())
	require.NoError(t, err)
	require.Len(t, live, 1)
	require.Equal(t, "Published", live[0].Name)
	require.Len(t, activationRoutingAudits(t, cs), 2)

	restarted := restartRoutingPlugin(t, cs)
	require.Equal(t, "Published", restarted.GetRuleStore().GetAllRules(t.Context())[0].Name)
	require.Equal(t, 4, restarted.GetRuleStore().(*rules.LocalStore).Snapshot().(interface{ ChainMaxDepth() int }).ChainMaxDepth())
}

func TestRoutingReleaseActivationRejectionDoesNotSwap(t *testing.T) {
	server, releases, cs, attempt := pendingRoutingActivation(t, `[{
		"name":"Unresolved user",
		"scope":"user",
		"scope_id":"user-1",
		"cel_expression":"true",
		"targets":[{"provider":"openai","model":"only","weight":1}]
	}]`)
	plugin, err := server.getRoutingPlugin()
	require.NoError(t, err)
	local := plugin.GetRuleStore().(*rules.LocalStore)
	before := local.Snapshot()

	err = server.installAcceptedRoutingRelease(t.Context(), releases, attempt.Epoch, "activator")
	require.Error(t, err)
	require.NotErrorIs(t, err, rules.ErrPolicyConflict)
	require.NotContains(t, err.Error(), "failed closed")
	require.Same(t, before, local.Snapshot())
	require.Equal(t, 7, server.Config.ClientConfig.RoutingChainMaxDepth)
	head, err := releases.GetRoutingReleaseHead(t.Context())
	require.NoError(t, err)
	require.Equal(t, "pending", head.State)
	require.False(t, head.IsApplied())
	live, err := cs.GetRoutingRules(t.Context())
	require.NoError(t, err)
	require.Equal(t, "old-live", live[0].ID)
	require.Len(t, activationRoutingAudits(t, cs), 1)
	require.Nil(t, activationAdmission(server, t), "confirmed rejection preserves the open previous generation")

	server.Config.BasePlugins.Store(nil)
	err = server.installAcceptedRoutingRelease(t.Context(), releases, attempt.Epoch, "activator")
	require.Error(t, err)
	require.Same(t, before, local.Snapshot())
	head, err = releases.GetRoutingReleaseHead(t.Context())
	require.NoError(t, err)
	require.Equal(t, "pending", head.State)
}

func activationAdmission(server *BifrostHTTPServer, t *testing.T) *schemas.BifrostError {
	t.Helper()
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	defer ctx.Cancel()
	return server.Client.AdmitRequest(ctx, &schemas.BifrostRequest{
		RequestType: schemas.ChatCompletionRequest,
		ChatRequest: &schemas.BifrostChatRequest{Provider: schemas.OpenAI, Model: "incoming"},
	})
}

type conflictRoutingStore struct {
	*rules.LocalStore
}

func (conflictRoutingStore) InstallPreparedPolicy(context.Context, *rules.PreparedPolicy) error {
	return rules.ErrPolicyConflict
}

func pendingRoutingActivation(t *testing.T, rulesJSON string) (*BifrostHTTPServer, *controlplane.Store, configstore.ConfigStore, *controlplane.RoutingReleaseAttempt) {
	t.Helper()
	logger = noopTestLogger{}
	ctx := t.Context()
	cs, err := configstore.NewConfigStore(ctx, &configstore.Config{
		Enabled: true, Type: configstore.ConfigStoreTypeSQLite,
		Config: &configstore.SQLiteConfig{Path: filepath.Join(t.TempDir(), "routing-activation.db")},
	}, logger)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, cs.Close(context.Background())) })
	releases, err := controlplane.NewStore(ctx, cs)
	require.NoError(t, err)
	require.NoError(t, cs.UpdateClientConfig(ctx, &configstore.ClientConfig{RoutingChainMaxDepth: 7}))
	require.NoError(t, cs.CreateRoutingRule(ctx, &tables.TableRoutingRule{
		ID: "old-live", Name: "Old live", Scope: "global", CelExpression: "true", Enabled: new(true),
		Targets: []tables.TableRoutingTarget{{Model: new("old-model"), Weight: 1}},
	}))
	local, err := rules.NewLocalStore(ctx, rules.NewMockLogger(), cs)
	require.NoError(t, err)
	config := &lib.Config{
		ConfigStore:  cs,
		ClientConfig: &configstore.ClientConfig{RoutingChainMaxDepth: 7},
	}
	plugin, err := routing.InitFromStore(ctx, &routing.Config{ChainMaxDepth: &config.ClientConfig.RoutingChainMaxDepth}, rules.NewMockLogger(), cs, local, routing.NewMockGovernance())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, plugin.Cleanup()) })
	plugins := []schemas.BasePlugin{plugin}
	config.BasePlugins.Store(&plugins)
	client, err := bifrost.Init(ctx, schemas.BifrostConfig{
		Account: lib.NewBaseAccount(config), Logger: rules.NewMockLogger(), InitialPoolSize: 1,
	})
	require.NoError(t, err)
	t.Cleanup(client.Shutdown)
	draft, err := releases.CreateRoutingDraft(ctx, controlplane.RoutingDraftContent{
		Name: "Release candidate", RulesJSON: rulesJSON, ChainMaxDepth: 4,
	})
	require.NoError(t, err)
	version, err := releases.CreateRoutingPolicyVersion(ctx, draft.ID, 1, "sealing-admin")
	require.NoError(t, err)
	attempt, err := releases.AcceptRoutingRelease(ctx, controlplane.RoutingReleaseRequest{
		VersionID: version.ID, IdempotencyKey: uuid.NewString(),
	})
	require.NoError(t, err)
	return &BifrostHTTPServer{Config: config, Client: client}, releases, cs, attempt
}

func restartRoutingPlugin(t *testing.T, cs configstore.ConfigStore) *routing.RoutingPlugin {
	t.Helper()
	config := &lib.Config{ConfigStore: cs, ClientConfig: &configstore.ClientConfig{}}
	lib.WithRoutingPolicyGuard(checkRoutingPolicyStartup)(config)
	plugin, err := initRoutingPlugin(t.Context(), nil, config, routing.NewMockGovernance())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, plugin.Cleanup()) })
	return plugin
}

func replaceRoutingStore(t *testing.T, current *routing.RoutingPlugin, store rules.Store) *routing.RoutingPlugin {
	t.Helper()
	replacement, err := routing.InitFromStore(t.Context(), &routing.Config{ChainMaxDepth: new(7)}, rules.NewMockLogger(), nil, store, routing.NewMockGovernance())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, replacement.Cleanup()) })
	require.NoError(t, current.Cleanup())
	return replacement
}

func activationRoutingAudits(t *testing.T, cs configstore.ConfigStore) []controlplane.AuditEvent {
	t.Helper()
	var events []controlplane.AuditEvent
	require.NoError(t, cs.DB().Where("resource_type = ?", "routing-release").
		Order("created_at, id").Find(&events).Error)
	return events
}
