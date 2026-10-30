package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/plugins/routing/rules"
)

// ValidateRoutingDraft shares simulation's bounded upstream compiler without
// consulting credentials, real usage, or installing any live routing state.
func ValidateRoutingDraft(rulesJSON string) error {
	var candidates []simulationRule
	decoder := json.NewDecoder(bytes.NewBufferString(rulesJSON))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&candidates); err != nil || decoder.Decode(new(any)) != io.EOF {
		return errors.New("invalid routing draft rules JSON")
	}
	if candidates == nil || len(candidates) > 32 {
		return errors.New("rules must be an array of 0..32 rules")
	}
	store, err := rules.NewSimulationStore(context.Background(), bifrost.NewDefaultLogger(schemas.LogLevelError))
	if err != nil {
		return err
	}
	return loadSimulationRules(store, candidates)
}
