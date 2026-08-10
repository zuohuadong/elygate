package schemas

import "slices"

var builtinPluginMetadata = map[string]PluginMetadata{
	"telemetry": {
		Description:   "Exports gateway metrics and can push them to Prometheus Pushgateway.",
		DescriptionZh: "采集网关指标，并可推送到 Prometheus Pushgateway。",
	},
	"prompts": {
		Description:   "Serves versioned prompt repositories and draft sessions.",
		DescriptionZh: "提供版本化提示词仓库与草稿会话能力。",
	},
	"logging": {
		Description:   "Records requests, responses, usage, and errors for troubleshooting.",
		DescriptionZh: "记录请求、响应、用量和错误，便于排障与审计。",
	},
	"governance": {
		Description:   "Enforces virtual-key access, budgets, rate limits, and routing policies.",
		DescriptionZh: "执行虚拟密钥访问、预算、限流和路由治理策略。",
		Features:      []string{"adaptive-routing"},
	},
	"otel": {
		Description:   "Exports request traces and metrics to OpenTelemetry collectors.",
		DescriptionZh: "将请求链路和指标导出到 OpenTelemetry Collector。",
	},
	"semantic_cache": {
		Description:   "Caches semantically similar requests to reduce latency and cost.",
		DescriptionZh: "缓存语义相近的请求，降低延迟与模型调用成本。",
	},
	"compat": {
		Description:   "Normalizes compatible API requests and provider behavior.",
		DescriptionZh: "规范兼容 API 请求并统一提供商行为。",
	},
	"maxim": {
		Description:   "Sends LLM observability data to Maxim.",
		DescriptionZh: "将 LLM 可观测数据发送到 Maxim。",
	},
	"model-catalog-resolver": {
		Description:   "Resolves provider and model routing from the model catalog.",
		DescriptionZh: "根据模型目录解析提供商与模型路由。",
	},
}

// GetBuiltinPluginMetadata returns the user-facing metadata for a built-in plugin.
func GetBuiltinPluginMetadata(name string) PluginMetadata {
	metadata := builtinPluginMetadata[name]
	metadata.Features = slices.Clone(metadata.Features)
	return metadata
}
