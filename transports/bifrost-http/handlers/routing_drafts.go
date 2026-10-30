package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	configtables "github.com/maximhq/bifrost/framework/configstore/tables"
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
	if err := validateRoutingDraftFallbackFields(rulesJSON); err != nil {
		return err
	}
	store, err := rules.NewSimulationStore(context.Background(), bifrost.NewDefaultLogger(schemas.LogLevelError))
	if err != nil {
		return err
	}
	return loadSimulationRules(store, candidates)
}

func validateRoutingDraftFallbackFields(rulesJSON string) error {
	var candidates []struct {
		Fallbacks []json.RawMessage `json:"fallbacks"`
	}
	if err := json.Unmarshal([]byte(rulesJSON), &candidates); err != nil {
		return errors.New("invalid routing draft fallbacks")
	}
	// The upstream custom decoder intentionally accepts unknown object fields.
	// Drafts retain the raw JSON, so validate those fields before persisting it.
	type fallbackFields configtables.RoutingFallback
	for _, candidate := range candidates {
		for _, fallback := range candidate.Fallbacks {
			if raw := bytes.TrimSpace(fallback); len(raw) > 0 && raw[0] == '{' {
				var fields fallbackFields
				decoder := json.NewDecoder(bytes.NewReader(raw))
				decoder.DisallowUnknownFields()
				if err := decoder.Decode(&fields); err != nil {
					return errors.New("invalid routing draft fallback fields")
				}
			}
		}
	}
	return nil
}
