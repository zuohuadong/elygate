package agentgateway

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/maximhq/bifrost/tests/agentgateway/driver"
	"github.com/maximhq/bifrost/tests/agentgateway/fixture"
)

// TestSecuritySmoke is the deterministic Agent Gateway security gate that runs
// whenever AGENTGATEWAY_URL is set: admin auth is required, a private agent card
// is rejected until its host is allowlisted, and then accepted.
func TestSecuritySmoke(t *testing.T) {
	gwURL := os.Getenv("AGENTGATEWAY_URL")
	if gwURL == "" {
		t.Skip("AGENTGATEWAY_URL is not set")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
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
	if err != nil {
		t.Fatal(err)
	}
	if status != 200 {
		t.Fatalf("GET /api/config: %d %s", status, body)
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
	t.Cleanup(func() {
		cleanCtx, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		_, _, _ = gw.Do(cleanCtx, "PUT", "/api/config", map[string]any{
			"client_config":    originalCC,
			"framework_config": cfg["framework_config"],
		}, nil)
	})

	setAllow := func(values []string) {
		raw, _ := json.Marshal(values)
		cc["a2a_private_allowlist"] = raw
		status, body, err := gw.Do(ctx, "PUT", "/api/config", map[string]any{
			"client_config":    cc,
			"framework_config": cfg["framework_config"],
		}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if status != 200 {
			t.Fatalf("PUT /api/config: %d %s", status, body)
		}
	}

	bind, host := envOr("AGENTGATEWAY_BIND", "127.0.0.1")+":0", envOr("AGENTGATEWAY_HOST", "127.0.0.1")
	fx, err := fixture.Start(bind, host)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = fx.Close() })

	name := fmt.Sprintf("security-smoke-%d", time.Now().UnixNano())

	// Anonymous control-plane access must be rejected before any target policy.
	anon := driver.NewGateway(gwURL, "")
	status, _, _ = anon.Do(ctx, "POST", "/api/agents", map[string]any{"name": name, "agent_card_url": fx.CardURL, "enabled": true, "allow_by_default": true, "forward_accepted_credential": false, "forward_accepted_credential_overrides_auth": false}, nil)
	if status != 401 && status != 403 {
		t.Fatalf("anonymous agent registration = %d, want 401/403", status)
	}

	// A loopback target is private and must be refused when not allowlisted.
	setAllow(nil)
	status, body, _ = gw.Do(ctx, "POST", "/api/agents", map[string]any{"name": name, "agent_card_url": fx.CardURL, "enabled": true, "allow_by_default": true, "forward_accepted_credential": false, "forward_accepted_credential_overrides_auth": false}, nil)
	if status != 400 && status != 403 {
		t.Fatalf("private agent target = %d, want 400/403: %s", status, body)
	}

	// Explicitly allowlisting the host must grant access.
	setAllow([]string{"127.0.0.1"})
	status, body, _ = gw.Do(ctx, "POST", "/api/agents", map[string]any{"name": name, "agent_card_url": fx.CardURL, "enabled": true, "allow_by_default": true, "forward_accepted_credential": false, "forward_accepted_credential_overrides_auth": false}, nil)
	if status != 200 {
		t.Fatalf("allowlisted agent registration = %d: %s", status, body)
	}
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = gw.DeleteAgent(c, name)
	})
}
