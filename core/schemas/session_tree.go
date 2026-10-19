package schemas

import "strings"

// SessionTree is the observational identity of a harness request: the session
// it belongs to, the parent session a sub-agent was spawned from, the agent
// name, and the client family that produced it. It is derived from headers and
// persisted alongside the log row so the panel can group and filter harness
// traffic without guessing from free-form metadata.
//
// SessionID is deliberately resolved with the same priority list as the
// key-stickiness session ID (x-bf-session-id first, then HarnessSessionHeaders).
// ParentSessionID and AgentName are observational only and must never be used
// as a stickiness key.
type SessionTree struct {
	SessionID       string
	ParentSessionID string
	AgentName       string
	ClientType      string
	IsSubagent      bool
	IsFork          bool
}

// Empty reports whether no harness identity was supplied.
func (t SessionTree) Empty() bool {
	return t.SessionID == "" && t.ParentSessionID == "" && t.AgentName == "" &&
		t.ClientType == "" && !t.IsSubagent && !t.IsFork
}

// ApplyToMetadata records the tree on a log metadata map. Harness identity is a
// system field, so these keys are written last and override caller-supplied
// x-bf-lh-* values; the logger later lifts them into typed columns.
func (t SessionTree) ApplyToMetadata(metadata map[string]any) map[string]any {
	if t.Empty() {
		return metadata
	}
	if metadata == nil {
		metadata = make(map[string]any)
	}
	if t.SessionID != "" {
		metadata["harness_session_id"] = t.SessionID
	}
	if t.ParentSessionID != "" {
		metadata["parent_session_id"] = t.ParentSessionID
	}
	if t.AgentName != "" {
		metadata["agent_name"] = t.AgentName
	}
	if t.ClientType != "" {
		metadata["session_client_type"] = t.ClientType
	}
	if t.IsSubagent {
		metadata["is_subagent"] = true
	}
	if t.IsFork {
		metadata["is_fork"] = true
	}
	return metadata
}

// ExtractSessionTree builds a SessionTree from a lowercased header map.
func ExtractSessionTree(headers map[string]string) SessionTree {
	if len(headers) == 0 {
		return SessionTree{}
	}
	get := func(name string) string {
		return strings.TrimSpace(headers[strings.ToLower(name)])
	}

	tree := SessionTree{}

	// Session ID: an explicit x-bf-session-id decides whenever present; a
	// malformed explicit value yields no session rather than silently falling
	// back to a harness header.
	if raw := get("x-bf-session-id"); raw != "" {
		if sessionID, ok := NormalizeSessionID(raw); ok {
			tree.SessionID = sessionID
		}
	} else {
		for _, name := range HarnessSessionHeaders {
			raw := get(name)
			if raw == "" {
				continue
			}
			sessionID, ok := NormalizeSessionID(raw)
			if !ok {
				continue
			}
			if tree.SessionID == "" {
				tree.SessionID = sessionID
				tree.ClientType = clientTypeForSessionHeader(name)
			}
		}
	}

	if parent := get("x-parent-session-id"); parent != "" {
		if normalized, ok := NormalizeSessionID(parent); ok {
			tree.ParentSessionID = normalized
		}
	}
	if agent := get("x-claude-code-agent-id"); agent != "" {
		if normalized, ok := NormalizeSessionID(agent); ok {
			tree.AgentName = normalized
		}
	}

	if tree.ClientType == "" {
		switch {
		case get("x-claude-code-session-id") != "", get("x-claude-code-agent-id") != "":
			tree.ClientType = "claude"
		case get("x-session-affinity") != "":
			tree.ClientType = "opencode"
		}
	}

	// A child session or a named agent is a sub-agent. Fork markers are
	// opt-in and only honoured when explicitly true-ish.
	tree.IsSubagent = tree.ParentSessionID != "" || tree.AgentName != ""
	tree.IsFork = isTrueHeader(get("x-fork")) || isTrueHeader(get("x-bf-fork"))

	return tree
}

func clientTypeForSessionHeader(header string) string {
	switch strings.ToLower(header) {
	case "x-claude-code-session-id":
		return "claude"
	case "x-session-affinity", "x-session-id":
		return "opencode"
	case "session-id", "session_id", "thread-id", "conversation_id":
		return "codex"
	default:
		return ""
	}
}

func isTrueHeader(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}