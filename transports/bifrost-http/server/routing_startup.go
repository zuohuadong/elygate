package server

import (
	"context"

	"github.com/google/uuid"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/handlers"
)

func compileRoutingRelease(ctx context.Context, version controlplane.RoutingPolicyVersion) ([]*tables.TableRoutingRule, error) {
	id, err := uuid.Parse(version.ID)
	if err != nil {
		return nil, err
	}
	return handlers.CompileRoutingPolicy(ctx, handlers.RoutingPolicyCandidate{
		VersionID: id, RulesJSON: version.RulesJSON, ChainMaxDepth: version.ChainMaxDepth, CreatedAt: version.CreatedAt,
	})
}

func checkRoutingPolicyStartup(ctx context.Context, store configstore.ConfigStore) (bool, error) {
	return controlplane.CheckRoutingPolicyStartup(ctx, store, compileRoutingRelease)
}
