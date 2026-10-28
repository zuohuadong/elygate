package controlplane

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

var (
	errNotificationReadMutation      = errors.New("request must contain only a required read boolean")
	errBudgetAcknowledgementMutation = errors.New("request must contain only a required acknowledged boolean")
)

func decodeNotificationReadMutation(body []byte) (bool, error) {
	return decodeBooleanMutation(body, "read", errNotificationReadMutation)
}

func decodeBudgetAcknowledgement(body []byte) (bool, error) {
	return decodeBooleanMutation(body, "acknowledged", errBudgetAcknowledgementMutation)
}

func decodeBooleanMutation(body []byte, field string, invalid error) (bool, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return false, invalid
	}
	key, err := decoder.Token()
	if err != nil || key != field {
		return false, invalid
	}
	token, err := decoder.Token()
	enabled, boolean := token.(bool)
	if err != nil || !boolean {
		return false, invalid
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') || decoder.Decode(new(any)) != io.EOF {
		return false, invalid
	}
	return enabled, nil
}
