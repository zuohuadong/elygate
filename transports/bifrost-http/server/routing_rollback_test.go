package server

import (
	"testing"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/plugins/routing/rules"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/stretchr/testify/require"
)

func TestRoutingRollbackActivationKeepsPinnedGeneration(t *testing.T) {
	server, releases, cs, first := pendingRoutingActivation(t, activationRoutingRules)
	require.NoError(t, server.installAcceptedRoutingRelease(t.Context(), releases, first.Epoch, "activator"))
	plugin, err := server.getRoutingPlugin()
	require.NoError(t, err)
	local := plugin.GetRuleStore().(*rules.LocalStore)
	firstRules := local.GetAllRules(t.Context())
	draft, err := releases.CreateRoutingDraft(t.Context(), controlplane.RoutingDraftContent{
		Name: "Empty policy", RulesJSON: "[]", ChainMaxDepth: 6,
	})
	require.NoError(t, err)
	version, err := releases.CreateRoutingPolicyVersion(t.Context(), draft.ID, 1, "author")
	require.NoError(t, err)
	second, err := releases.AcceptRoutingRelease(t.Context(), controlplane.RoutingReleaseRequest{
		VersionID: version.ID, ExpectedEpoch: first.Epoch, IdempotencyKey: uuid.NewString(),
	})
	require.NoError(t, err)
	require.NoError(t, server.installAcceptedRoutingRelease(t.Context(), releases, second.Epoch, "activator"))
	previous := schemas.NewBifrostContext(t.Context(), schemas.NoDeadline)
	defer previous.Cancel()
	require.Nil(t, server.Client.AdmitRequest(previous, &schemas.BifrostRequest{RequestType: schemas.ChatCompletionRequest}))
	pinned := local.SnapshotForRequest(previous)
	require.Empty(t, pinned.GetScopedRules(t.Context(), "global", ""))
	require.Equal(t, 6, pinned.(interface{ ChainMaxDepth() int }).ChainMaxDepth())
	request := controlplane.RoutingReleaseRequest{
		Operation: controlplane.RoutingReleaseRollback, RollbackOfEpoch: first.Epoch,
		ExpectedEpoch: second.Epoch, IdempotencyKey: uuid.NewString(),
	}
	rollback, err := releases.AcceptRoutingRelease(t.Context(), request)
	require.NoError(t, err)
	require.Empty(t, local.GetAllRules(t.Context()), "acceptance cannot change the serving generation")
	require.NoError(t, server.installAcceptedRoutingRelease(t.Context(), releases, rollback.Epoch, "rollback-activator"))
	require.Nil(t, activationAdmission(server, t))
	require.Equal(t, firstRules, local.GetAllRules(t.Context()))
	require.Equal(t, 4, server.Config.ClientConfig.RoutingChainMaxDepth)
	require.Same(t, pinned, local.SnapshotForRequest(previous), "in-flight requests keep their pre-rollback generation")
	require.Empty(t, local.SnapshotForRequest(previous).GetScopedRules(t.Context(), "global", ""))
	require.Equal(t, firstRules, restartRoutingPlugin(t, cs).GetRuleStore().GetAllRules(t.Context()))
	require.Len(t, activationRoutingAudits(t, cs), 6)
	after := local.Snapshot()
	_, err = releases.AcceptRoutingRelease(t.Context(), controlplane.RoutingReleaseRequest{
		VersionID: version.ID, ExpectedEpoch: rollback.Epoch, IdempotencyKey: uuid.NewString(),
	})
	require.NoError(t, err)
	replayed, err := releases.AcceptRoutingRelease(t.Context(), request)
	require.NoError(t, err)
	require.Equal(t, rollback.ID, replayed.ID)
	require.ErrorIs(t, server.installAcceptedRoutingRelease(t.Context(), releases, replayed.Epoch, "stale"),
		controlplane.ErrRoutingReleaseConflict)
	require.Same(t, after, local.Snapshot(), "historical replay cannot swap a generation")
}
