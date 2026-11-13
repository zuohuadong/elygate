package agentgateway

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/a2aproject/a2a-go/v2/a2a"
	"github.com/a2aproject/a2a-go/v2/a2aclient"
	a2agrpc "github.com/a2aproject/a2a-go/v2/a2agrpc/v1"
	"github.com/maximhq/bifrost/tests/agentgateway/driver"
	"github.com/maximhq/bifrost/tests/agentgateway/fixture"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// TestBindingsSmoke exercises the three advertised A2A transports through an
// already running gateway: JSON-RPC, HTTP+JSON and gRPC. It is part of the
// deterministic release gate whenever AGENTGATEWAY_URL is set.
func TestBindingsSmoke(t *testing.T) {
	gwURL := os.Getenv("AGENTGATEWAY_URL")
	if gwURL == "" {
		t.Skip("AGENTGATEWAY_URL is not set")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()

	token := os.Getenv("AGENTGATEWAY_ADMIN_TOKEN")
	if user := os.Getenv("AGENTGATEWAY_ADMIN_USER"); token == "" && user != "" {
		var err error
		token, err = driver.Login(ctx, gwURL, user, os.Getenv("AGENTGATEWAY_ADMIN_PASS"))
		if err != nil {
			t.Fatal(err)
		}
	}
	gw := driver.NewGateway(gwURL, token)

	status, body, err := gw.Do(ctx, "GET", "/api/config?from_db=true", nil, nil)
	if err != nil || status != 200 {
		t.Fatalf("GET /api/config: %d %v %s", status, err, body)
	}
	var cfg map[string]json.RawMessage
	if err := json.Unmarshal(body, &cfg); err != nil {
		t.Fatal(err)
	}
	var cc map[string]json.RawMessage
	if err := json.Unmarshal(cfg["client_config"], &cc); err != nil {
		t.Fatal(err)
	}
	originalCC := make(map[string]json.RawMessage, len(cc))
	for k, v := range cc {
		originalCC[k] = append(json.RawMessage(nil), v...)
	}
	rawAllow, _ := json.Marshal([]string{"127.0.0.1"})
	cc["a2a_private_allowlist"] = rawAllow
	status, body, err = gw.Do(ctx, "PUT", "/api/config", map[string]any{"client_config": cc, "framework_config": cfg["framework_config"]}, nil)
	if err != nil || status != 200 {
		t.Fatalf("PUT /api/config: %d %v %s", status, err, body)
	}
	t.Cleanup(func() {
		c, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		_, _, _ = gw.Do(c, "PUT", "/api/config", map[string]any{"client_config": originalCC, "framework_config": cfg["framework_config"]}, nil)
	})

	bind, host := envOr("AGENTGATEWAY_BIND", "127.0.0.1")+":0", envOr("AGENTGATEWAY_HOST", "127.0.0.1")
	fx, err := fixture.Start(bind, host)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = fx.Close() })

	name := fmt.Sprintf("bindings-smoke-%d", time.Now().UnixNano())
	status, body, err = gw.Do(ctx, "POST", "/api/agents", map[string]any{
		"name": name, "agent_card_url": fx.CardURL, "enabled": true,
		"allow_by_default": true, "forward_accepted_credential": false,
		"forward_accepted_credential_overrides_auth": false,
	}, nil)
	if err != nil || status != 201 {
		t.Fatalf("register agent: %d %v %s", status, err, body)
	}
	t.Cleanup(func() {
		c, stop := context.WithTimeout(context.Background(), 15*time.Second)
		defer stop()
		_ = gw.DeleteAgent(c, name)
	})

	card, err := gw.WaitForCard(ctx, name, "", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, binding := range []a2a.TransportProtocol{
		a2a.TransportProtocolJSONRPC,
		a2a.TransportProtocolHTTPJSON,
		a2a.TransportProtocolGRPC,
	} {
		t.Run(string(binding), func(t *testing.T) {
			selected := &a2a.AgentCard{}
			*selected = *card
			selected.SupportedInterfaces = nil
			for _, iface := range card.SupportedInterfaces {
				if iface.ProtocolBinding == binding {
					selected.SupportedInterfaces = append(selected.SupportedInterfaces, iface)
				}
			}
			if len(selected.SupportedInterfaces) == 0 {
				t.Fatalf("gateway card advertises no %s interface", binding)
			}
			options := []a2aclient.FactoryOption{}
			if binding == a2a.TransportProtocolGRPC {
				options = append(options, a2agrpc.WithGRPCTransport(grpc.WithTransportCredentials(insecure.NewCredentials())))
			}
			client, err := a2aclient.NewFromCard(ctx, selected, options...)
			if err != nil {
				t.Fatalf("create client: %v", err)
			}
			defer client.Destroy()
			msg := a2a.NewMessage(a2a.MessageRoleUser, a2a.NewTextPart("bindings smoke"))
			if _, err := client.SendMessage(ctx, &a2a.SendMessageRequest{Message: msg}); err != nil {
				t.Fatalf("SendMessage over %s: %v", binding, err)
			}
		})
	}
}
