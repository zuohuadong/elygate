package controlplane

import (
	"strings"
	"testing"
)

func TestBooleanMutationPayloads(t *testing.T) {
	for _, mutation := range []struct {
		field, escaped, alias string
		decode                func([]byte) (bool, error)
	}{
		{"read", `\u0072ead`, "Read", decodeNotificationReadMutation},
		{"acknowledged", `\u0061cknowledged`, "Acknowledged", decodeBudgetAcknowledgement},
		{"resolved", `\u0072esolved`, "Resolved", decodeBudgetResolution},
	} {
		t.Run(mutation.field, func(t *testing.T) {
			// Missing/null, scalar/container types, duplicate/escaped/case-variant
			// keys, truncation and trailing content must never become mutations.
			for _, tc := range []struct {
				name, body  string
				want, valid bool
			}{
				{"true", `{"FIELD":true}`, true, true},
				{"false", `{"FIELD":false}`, false, true},
				{"whitespace", " \n { \"FIELD\" : false } \t\r\n", false, true},
				{"escaped-key", `{"ESCAPED":true}`, true, true},
				{"empty", "", false, false},
				{"null-object", "null", false, false},
				{"empty-object", "{}", false, false},
				{"array", "[]", false, false},
				{"boolean-object", "true", false, false},
				{"number-object", "1", false, false},
				{"string-object", `"true"`, false, false},
				{"null-field", `{"FIELD":null}`, false, false},
				{"string-field", `{"FIELD":"true"}`, false, false},
				{"number-field", `{"FIELD":1}`, false, false},
				{"array-field", `{"FIELD":[]}`, false, false},
				{"object-field", `{"FIELD":{}}`, false, false},
				{"duplicate-undo", `{"FIELD":true,"FIELD":false}`, false, false},
				{"duplicate-enable", `{"FIELD":false,"FIELD":true}`, false, false},
				{"duplicate-same", `{"FIELD":true,"FIELD":true}`, false, false},
				{"escaped-duplicate", `{"FIELD":false,"ESCAPED":true}`, false, false},
				{"escaped-duplicate-first", `{"ESCAPED":true,"FIELD":false}`, false, false},
				{"case-variant", `{"ALIAS":true}`, false, false},
				{"case-duplicate", `{"FIELD":false,"ALIAS":true}`, false, false},
				{"unknown-before", `{"actor":"other","FIELD":true}`, false, false},
				{"unknown-after", `{"FIELD":true,"actor":"other"}`, false, false},
				{"missing-value", `{"FIELD":}`, false, false},
				{"missing-brace", `{"FIELD":true`, false, false},
				{"trailing-comma", `{"FIELD":true,}`, false, false},
				{"trailing-object", `{"FIELD":true} {}`, false, false},
				{"trailing-null", `{"FIELD":true} null`, false, false},
				{"trailing-boolean", `{"FIELD":true} false`, false, false},
				{"trailing-text", `{"FIELD":true} invalid`, false, false},
				{"adjacent-objects", `{"FIELD":true}{"FIELD":false}`, false, false},
			} {
				t.Run(tc.name, func(t *testing.T) {
					body := strings.NewReplacer("FIELD", mutation.field, "ESCAPED", mutation.escaped, "ALIAS", mutation.alias).Replace(tc.body)
					got, err := mutation.decode([]byte(body))
					if tc.valid {
						if err != nil || got != tc.want {
							t.Fatalf("decode(%q) = %v, %v; want %v", body, got, err, tc.want)
						}
						return
					}
					message := "request must contain only a required " + mutation.field + " boolean"
					if err == nil || err.Error() != message || got {
						t.Fatalf("decode(%q) = %v, %v; want false and %q", body, got, err, message)
					}
				})
			}
		})
	}
}

func BenchmarkBooleanMutation(b *testing.B) {
	for _, mutation := range []struct {
		field  string
		decode func([]byte) (bool, error)
	}{
		{"read", decodeNotificationReadMutation},
		{"acknowledged", decodeBudgetAcknowledgement},
		{"resolved", decodeBudgetResolution},
	} {
		for _, literal := range []string{"true", "false"} {
			b.Run(mutation.field+"/"+literal, func(b *testing.B) {
				body := []byte(`{"` + mutation.field + `":` + literal + `}`)
				b.ReportAllocs()
				for b.Loop() {
					enabled, err := mutation.decode(body)
					if err != nil || enabled != (literal == "true") {
						b.Fatalf("unexpected mutation: %v, %v", enabled, err)
					}
				}
			})
		}
	}
}
