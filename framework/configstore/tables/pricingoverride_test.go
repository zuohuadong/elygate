package tables

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func TestTablePricingOverrideBeforeSaveRequiresRequestTypes(t *testing.T) {
	override := TablePricingOverride{}
	if err := override.BeforeSave(nil); err == nil {
		t.Fatal("BeforeSave accepted an empty request_types list")
	}

	override.RequestTypes = []schemas.RequestType{schemas.ChatCompletionRequest}
	if err := override.BeforeSave(nil); err != nil {
		t.Fatalf("BeforeSave rejected a valid request_types list: %v", err)
	}
	if override.RequestTypesJSON != `["chat_completion"]` {
		t.Fatalf("RequestTypesJSON = %q", override.RequestTypesJSON)
	}
}
