package logging

import (
	"github.com/maximhq/bifrost/framework/logstore"
)

// applySessionTreeToLog lifts the harness session identity recorded in the log
// metadata into the typed, indexed columns used by the panel's session-tree
// filters. The metadata keys are written by schemas.SessionTree.ApplyToMetadata
// during PreLLMHook and the streaming/realtime paths, so this runs after those
// merges and is safe to call more than once.
//
// The keys are removed from metadata after lifting: the columns are the source
// of truth for filtering, and leaving system identity in the free-form metadata
// blob would let it be confused with caller labels.
func applySessionTreeToLog(entry *logstore.Log) {
	if entry == nil || entry.MetadataParsed == nil {
		return
	}
	m := entry.MetadataParsed

	liftString := func(key string) string {
		value, ok := m[key]
		if !ok {
			return ""
		}
		text, ok := value.(string)
		if !ok {
			return ""
		}
		delete(m, key)
		return text
	}
	liftBool := func(key string) (bool, bool) {
		value, ok := m[key]
		if !ok {
			return false, false
		}
		flag, ok := value.(bool)
		if !ok {
			return false, false
		}
		delete(m, key)
		return flag, true
	}

	if sessionID := liftString("harness_session_id"); sessionID != "" && entry.SessionID == "" {
		entry.SessionID = sessionID
	}
	if parent := liftString("parent_session_id"); parent != "" {
		entry.ParentSessionID = &parent
	}
	if agent := liftString("agent_name"); agent != "" {
		entry.AgentName = &agent
	}
	if clientType := liftString("session_client_type"); clientType != "" {
		entry.SessionClientType = &clientType
	}
	if subagent, ok := liftBool("is_subagent"); ok {
		entry.IsSubagent = subagent
	}
	if fork, ok := liftBool("is_fork"); ok {
		entry.IsFork = fork
	}

	if len(m) == 0 {
		entry.MetadataParsed = nil
	}
}