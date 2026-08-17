package safety

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

// PluginName is the built-in plugin identifier used in config.json.
const PluginName = "safety"

type ApplyTo string

const (
	ApplyToInput  ApplyTo = "input"
	ApplyToOutput ApplyTo = "output"
	ApplyToBoth   ApplyTo = "both"
)

type Action string

const (
	ActionBlock   Action = "block"
	ActionRespond Action = "respond"
)

// Rule is a deterministic, regular-expression safety rule evaluated against
// request or response JSON at the HTTP inference boundary.
type Rule struct {
	ID       string  `json:"id"`
	Name     string  `json:"name,omitempty"`
	Pattern  string  `json:"pattern"`
	ApplyTo  ApplyTo `json:"apply_to"`
	Action   Action  `json:"action"`
	Response string  `json:"response,omitempty"`
}

// Config controls the built-in HTTP safety plugin. Rules run in declaration
// order, and the first matching rule determines the action.
type Config struct {
	Enabled bool   `json:"enabled"`
	Rules   []Rule `json:"rules"`
}

type compiledRule struct {
	rule    Rule
	pattern *regexp.Regexp
}

// Plugin applies deterministic input and output safety rules before a request
// reaches a provider and before a non-streaming response reaches the caller.
type Plugin struct {
	enabled        bool
	rules          []compiledRule
	hasOutputRules bool
}

// Init validates and compiles the configured rules.
func Init(config *Config) (*Plugin, error) {
	plugin := &Plugin{}
	if config == nil || !config.Enabled {
		return plugin, nil
	}

	plugin.enabled = true
	for index, rule := range config.Rules {
		normalized, err := normalizeRule(rule)
		if err != nil {
			return nil, fmt.Errorf("invalid safety rule at index %d: %w", index, err)
		}
		compiled, err := regexp.Compile(normalized.Pattern)
		if err != nil {
			return nil, fmt.Errorf("invalid safety rule %q pattern: %w", normalized.ID, err)
		}
		plugin.rules = append(plugin.rules, compiledRule{rule: normalized, pattern: compiled})
		if normalized.ApplyTo == ApplyToOutput || normalized.ApplyTo == ApplyToBoth {
			plugin.hasOutputRules = true
		}
	}

	return plugin, nil
}

func normalizeRule(rule Rule) (Rule, error) {
	rule.ID = strings.TrimSpace(rule.ID)
	rule.Pattern = strings.TrimSpace(rule.Pattern)
	if rule.ID == "" {
		return Rule{}, fmt.Errorf("id is required")
	}
	if rule.Pattern == "" {
		return Rule{}, fmt.Errorf("pattern is required")
	}
	if rule.ApplyTo == "" {
		rule.ApplyTo = ApplyToBoth
	}
	if rule.ApplyTo != ApplyToInput && rule.ApplyTo != ApplyToOutput && rule.ApplyTo != ApplyToBoth {
		return Rule{}, fmt.Errorf("apply_to must be input, output, or both")
	}
	if rule.Action == "" {
		rule.Action = ActionBlock
	}
	if rule.Action != ActionBlock && rule.Action != ActionRespond {
		return Rule{}, fmt.Errorf("action must be block or respond")
	}
	return rule, nil
}

// GetName implements schemas.BasePlugin.
func (p *Plugin) GetName() string {
	return PluginName
}

// GetPluginMetadata describes the built-in plugin in the management API.
func (p *Plugin) GetPluginMetadata() schemas.PluginMetadata {
	return schemas.PluginMetadata{
		Description:   "Deterministic input and output safety rules for inference HTTP requests.",
		DescriptionZh: "面向推理 HTTP 请求的本地输入与输出安全规则。",
		Features:      []string{"input inspection", "output inspection", "block", "safe response"},
	}
}

// HTTPTransportPreHook blocks unsafe inputs before provider invocation. Output
// checks fail closed for streamed requests because an emitted chunk cannot be
// recalled after a later rule match.
func (p *Plugin) HTTPTransportPreHook(ctx *schemas.BifrostContext, req *schemas.HTTPRequest) (*schemas.HTTPResponse, error) {
	if !p.enabled || req == nil {
		return nil, nil
	}
	if p.hasOutputRules && isStreamingRequest(req.Body) {
		return safetyErrorResponse(400, "streaming_not_supported", "streaming is disabled while output safety rules are enabled"), nil
	}
	if rule := p.match(ApplyToInput, req.Body); rule != nil {
		logMatch(ctx, "input", rule.ID)
		if rule.Action == ActionRespond {
			return safeResponse(req, rule), nil
		}
		return safetyErrorResponse(403, rule.ID, "request blocked by safety policy"), nil
	}
	return nil, nil
}

// HTTPTransportPostHook replaces or blocks unsafe non-streaming output before
// it is written to the HTTP client.
func (p *Plugin) HTTPTransportPostHook(ctx *schemas.BifrostContext, req *schemas.HTTPRequest, resp *schemas.HTTPResponse) error {
	if !p.enabled || req == nil || resp == nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil
	}
	if rule := p.match(ApplyToOutput, resp.Body); rule != nil {
		logMatch(ctx, "output", rule.ID)
		if rule.Action == ActionRespond {
			safe := safeResponse(req, rule)
			resp.StatusCode = safe.StatusCode
			resp.Headers = safe.Headers
			resp.Body = safe.Body
			return nil
		}
		blocked := safetyErrorResponse(403, rule.ID, "response blocked by safety policy")
		resp.StatusCode = blocked.StatusCode
		resp.Headers = blocked.Headers
		resp.Body = blocked.Body
	}
	return nil
}

// HTTPTransportStreamChunkHook passes chunks through. Streamed output is
// rejected in the pre-hook whenever output rules are configured.
func (p *Plugin) HTTPTransportStreamChunkHook(_ *schemas.BifrostContext, _ *schemas.HTTPRequest, chunk *schemas.BifrostStreamChunk) (*schemas.BifrostStreamChunk, error) {
	return chunk, nil
}

// Cleanup implements schemas.BasePlugin.
func (p *Plugin) Cleanup() error {
	return nil
}

// HasOutputRules reports whether the configuration inspects provider output.
func (p *Plugin) HasOutputRules() bool {
	return p.hasOutputRules
}

func (p *Plugin) match(phase ApplyTo, body []byte) *Rule {
	for _, rule := range p.rules {
		if rule.rule.ApplyTo != phase && rule.rule.ApplyTo != ApplyToBoth {
			continue
		}
		if rule.pattern.Match(body) {
			matched := rule.rule
			return &matched
		}
	}
	return nil
}

func isStreamingRequest(body []byte) bool {
	var request struct {
		Stream bool `json:"stream"`
	}
	return json.Unmarshal(body, &request) == nil && request.Stream
}

func safetyErrorResponse(statusCode int, ruleID, message string) *schemas.HTTPResponse {
	body, _ := json.Marshal(map[string]any{
		"error": map[string]string{
			"message": message,
			"type":    "safety_violation",
			"code":    ruleID,
		},
	})
	return &schemas.HTTPResponse{
		StatusCode: statusCode,
		Headers: map[string]string{
			"Content-Type":          "application/json",
			"X-Bifrost-Safety-Rule": ruleID,
		},
		Body: body,
	}
}

func safeResponse(req *schemas.HTTPRequest, rule *Rule) *schemas.HTTPResponse {
	message := strings.TrimSpace(rule.Response)
	if message == "" {
		message = "The request cannot be completed because it matched a safety policy."
	}
	model := requestedModel(req.Body)
	created := time.Now().Unix()

	var body any
	switch {
	case strings.HasSuffix(req.Path, "/chat/completions"):
		body = map[string]any{
			"id":      "safety-chat-completion",
			"object":  "chat.completion",
			"created": created,
			"model":   model,
			"choices": []any{map[string]any{
				"index":         0,
				"message":       map[string]string{"role": "assistant", "content": message},
				"finish_reason": "stop",
			}},
		}
	case strings.HasSuffix(req.Path, "/completions"):
		body = map[string]any{
			"id":      "safety-text-completion",
			"object":  "text_completion",
			"created": created,
			"model":   model,
			"choices": []any{map[string]any{
				"index":         0,
				"text":          message,
				"finish_reason": "stop",
			}},
		}
	case strings.HasSuffix(req.Path, "/responses"):
		body = map[string]any{
			"id":         "resp_safety",
			"object":     "response",
			"created_at": created,
			"model":      model,
			"status":     "completed",
			"output": []any{map[string]any{
				"id":   "msg_safety",
				"type": "message",
				"role": "assistant",
				"content": []any{map[string]any{
					"type": "output_text",
					"text": message,
				}},
			}},
		}
	default:
		return safetyErrorResponse(403, rule.ID, "request matched a safety policy")
	}

	encoded, _ := json.Marshal(body)
	return &schemas.HTTPResponse{
		StatusCode: 200,
		Headers: map[string]string{
			"Content-Type":          "application/json",
			"X-Bifrost-Safety-Rule": rule.ID,
		},
		Body: encoded,
	}
}

func requestedModel(body []byte) string {
	var request struct {
		Model string `json:"model"`
	}
	if json.Unmarshal(body, &request) == nil && request.Model != "" {
		return request.Model
	}
	return "safety-guardrail"
}

func logMatch(ctx *schemas.BifrostContext, phase, ruleID string) {
	if ctx != nil {
		ctx.Log(schemas.LogLevelWarn, fmt.Sprintf("safety rule %s matched %s", ruleID, phase))
	}
}
