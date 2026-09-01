package tables

import (
	"encoding/json"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func TestTableVirtualKeyMarshalJSONBreaksRelationshipCycles(t *testing.T) {
	value := *schemas.NewSecretVar("bfvk-test")
	teamVK := TableVirtualKey{ID: "vk-team", Name: "team-test", Value: value}
	customerVK := TableVirtualKey{ID: "vk-customer", Name: "customer-test", Value: value}
	team := &TableTeam{ID: "team-1", Name: "Team"}
	customer := &TableCustomer{ID: "customer-1", Name: "Customer"}
	teamVK.Team = team
	customerVK.Customer = customer
	team.Customer = customer
	team.VirtualKeys = []TableVirtualKey{teamVK}
	customer.Teams = []TableTeam{*team}
	customer.VirtualKeys = []TableVirtualKey{customerVK}

	assertShallowRelationship := func(vk TableVirtualKey, name string, forbidden ...string) {
		t.Helper()
		encoded, err := json.Marshal(vk)
		if err != nil {
			t.Fatalf("marshal virtual key with relationship cycles: %v", err)
		}
		var payload map[string]any
		if err := json.Unmarshal(encoded, &payload); err != nil {
			t.Fatalf("decode virtual key payload: %v", err)
		}
		if payload["value"] != "bfvk-test" {
			t.Fatalf("value = %#v, want plain virtual key", payload["value"])
		}
		relationship, ok := payload[name].(map[string]any)
		if !ok {
			t.Fatalf("%s = %#v, want object", name, payload[name])
		}
		for _, field := range forbidden {
			if value, exists := relationship[field]; exists && value != nil {
				t.Fatalf("%s unexpectedly contains recursive field %q", name, field)
			}
		}
	}
	assertShallowRelationship(teamVK, "team", "customer", "virtual_keys")
	assertShallowRelationship(customerVK, "customer", "teams", "virtual_keys")
}
