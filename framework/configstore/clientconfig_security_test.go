package configstore

import (
	"encoding/json"
	"testing"
)

func TestClientConfigEnforceAuthDefaultsSecurely(t *testing.T) {
	tests := []struct {
		name string
		body string
		want bool
	}{
		{name: "omitted", body: `{}`, want: true},
		{name: "explicit false", body: `{"enforce_auth_on_inference":false}`, want: false},
		{name: "explicit true", body: `{"enforce_auth_on_inference":true}`, want: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var config ClientConfig
			if err := json.Unmarshal([]byte(test.body), &config); err != nil {
				t.Fatalf("unmarshal client config: %v", err)
			}
			if config.EnforceAuthOnInference != test.want {
				t.Fatalf("EnforceAuthOnInference = %v, want %v", config.EnforceAuthOnInference, test.want)
			}
		})
	}
}

func TestUpdateClientConfigPreservesExplicitEnforceAuthValue(t *testing.T) {
	store := setupRDBTestStore(t)
	ctx := t.Context()

	for _, enabled := range []bool{true, false, true} {
		config := &ClientConfig{EnforceAuthOnInference: enabled}
		if err := store.UpdateClientConfig(ctx, config); err != nil {
			t.Fatalf("update client config with enforce auth %v: %v", enabled, err)
		}
		loaded, err := store.GetClientConfig(ctx)
		if err != nil {
			t.Fatalf("reload client config with enforce auth %v: %v", enabled, err)
		}
		if loaded == nil || loaded.EnforceAuthOnInference != enabled {
			t.Fatalf("EnforceAuthOnInference = %v, want %v", loaded != nil && loaded.EnforceAuthOnInference, enabled)
		}
	}
}
