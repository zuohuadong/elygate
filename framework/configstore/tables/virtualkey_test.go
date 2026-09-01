package tables

import (
	"encoding/json"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func TestTableVirtualKeyMarshalJSONOmitsRecursiveOwners(t *testing.T) {
	vk := TableVirtualKey{
		ID:    "vk-1",
		Value: *schemas.NewSecretVar("bfvk-test"),
	}
	team := TableTeam{ID: "team-1"}
	customer := TableCustomer{ID: "customer-1"}
	team.VirtualKeys = []TableVirtualKey{vk}
	customer.VirtualKeys = []TableVirtualKey{vk}
	vk.Team = &team
	vk.Customer = &customer

	data, err := json.Marshal(vk)
	if err != nil {
		t.Fatalf("marshal virtual key: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("unmarshal virtual key payload: %v", err)
	}
	if _, ok := payload["team"]; ok {
		t.Fatal("team relationship must be omitted to prevent recursive serialization")
	}
	if _, ok := payload["customer"]; ok {
		t.Fatal("customer relationship must be omitted to prevent recursive serialization")
	}
	if payload["value"] != "bfvk-test" {
		t.Fatalf("unexpected serialized value: %#v", payload["value"])
	}
}
