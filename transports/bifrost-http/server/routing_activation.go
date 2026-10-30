package server

import (
	"context"
	"errors"
	"fmt"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/plugins/routing"
	"github.com/maximhq/bifrost/plugins/routing/rules"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/controlplane"
	"github.com/maximhq/bifrost/transports/v2/bifrost-http/lib"
)

// routingPolicyPublisher is the process-local half of publication. Database
// acknowledgement stays in the control plane; this only swaps one generation.
type routingPolicyPublisher interface {
	routingPolicyAdmission
	PreparePolicy(context.Context, []*tables.TableRoutingRule, int) (*rules.PreparedPolicy, error)
	InstallPreparedPolicy(context.Context, *rules.PreparedPolicy) error
}

type routingPolicyAdmission interface {
	Admit(*schemas.BifrostContext, *schemas.BifrostRequest) bool
	CloseAdmission() bool
	OpenAdmission()
	ManagePolicy()
	CheckPolicyWritable() error
}

// A lost commit receipt or post-commit swap failure leaves admission closed.
// Recovery revalidates durable state rather than serving a guessed old policy.
func (s *BifrostHTTPServer) installAcceptedRoutingRelease(ctx context.Context, releases *controlplane.Store, epoch int64, actor string) error {
	if s == nil || s.Config == nil || releases == nil {
		return errors.New("routing release activation is not initialized")
	}
	if s.Config.ClientConfig == nil {
		return errors.New("client config is not loaded")
	}
	s.routingPublicationMu.Lock()
	defer s.routingPublicationMu.Unlock()
	if s.Client == nil {
		return errors.New("routing request admission is not initialized")
	}
	plugin, err := s.getRoutingPlugin()
	if err != nil {
		return err
	}
	publisher, ok := plugin.GetRuleStore().(routingPolicyPublisher)
	if !ok {
		return errors.New("routing store cannot swap a prepared policy")
	}
	s.Client.SetRequestAdmission(routingRequestAdmission(publisher))
	wasOpen := publisher.CloseAdmission()
	installation, err := releases.InstallAcceptedRoutingRelease(ctx, epoch, compileRoutingRelease, actor)
	if err != nil {
		if wasOpen && !errors.Is(err, controlplane.ErrRoutingInstallationUncertain) {
			publisher.OpenAdmission()
		}
		return err
	}
	publisher.ManagePolicy()
	if err := activateCommittedRoutingPolicy(ctx, s.Config, publisher, installation.Policy); err != nil {
		return fmt.Errorf("routing release committed but this process failed closed: %w", err)
	}
	publisher.OpenAdmission()
	return nil
}

func routingRequestAdmission(controller routingPolicyAdmission) schemas.RequestAdmission {
	return func(ctx *schemas.BifrostContext, req *schemas.BifrostRequest) *schemas.BifrostError {
		if controller.Admit(ctx, req) {
			return nil
		}
		return &schemas.BifrostError{
			IsBifrostError: true, StatusCode: schemas.Ptr(503), AllowFallbacks: schemas.Ptr(false),
			Error: &schemas.ErrorField{Message: "routing policy is unavailable while installation is unresolved"},
		}
	}
}

func (s *BifrostHTTPServer) configureRoutingAdmission() error {
	if !s.Config.IsPluginLoaded(routing.PluginName) {
		return nil
	}
	plugin, err := s.getRoutingPlugin()
	if err != nil {
		return err
	}
	if controller, ok := plugin.GetRuleStore().(routingPolicyAdmission); ok {
		if errors.Is(controller.CheckPolicyWritable(), rules.ErrPolicyManaged) {
			s.Client.SetRequestAdmission(routingRequestAdmission(controller))
		}
	}
	return nil
}

func activateCommittedRoutingPolicy(ctx context.Context, config *lib.Config, publisher routingPolicyPublisher, policy configstore.RoutingPolicySnapshot) error {
	if config == nil || config.ClientConfig == nil {
		return errors.New("client config is not loaded")
	}
	if err := publishRoutingPolicyGeneration(ctx, publisher, policy); err != nil {
		return err
	}
	config.Mu.Lock()
	config.ClientConfig.RoutingChainMaxDepth = policy.ChainMaxDepth
	config.Mu.Unlock()
	return nil
}

func publishRoutingPolicyGeneration(ctx context.Context, publisher routingPolicyPublisher, policy configstore.RoutingPolicySnapshot) error {
	if publisher == nil {
		return errors.New("routing policy publisher is not available")
	}
	compiled := make([]*tables.TableRoutingRule, len(policy.Rules))
	for index := range policy.Rules {
		compiled[index] = &policy.Rules[index]
	}
	prepared, err := publisher.PreparePolicy(ctx, compiled, policy.ChainMaxDepth)
	if err != nil {
		return err
	}
	// InstallPreparedPolicy already publishes rules, programs and depth together.
	// A later UpdateChainMaxDepth would open a second generation.
	return publisher.InstallPreparedPolicy(ctx, prepared)
}
