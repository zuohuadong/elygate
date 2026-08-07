import type { JsonRecord } from './api';

export type ProviderConfigSection = 'network' | 'proxy' | 'custom' | 'openai';

const PROVIDER_CONFIG_FIELDS: Record<ProviderConfigSection, ReadonlySet<string>> = {
	network: new Set([
		'base_url', 'extra_headers', 'default_request_timeout_in_seconds', 'max_retries',
		'retry_backoff_initial', 'retry_backoff_max', 'insecure_skip_verify', 'ca_cert_pem',
		'stream_idle_timeout_in_seconds', 'keep_alive_timeout_in_seconds', 'max_conns_per_host',
		'enforce_http2', 'http2_ping_interval_in_seconds', 'beta_header_overrides', 'allow_private_network',
	]),
	proxy: new Set(['type', 'url', 'username', 'password', 'ca_cert_pem']),
	custom: new Set(['is_key_less', 'base_provider_type', 'allowed_requests', 'request_path_overrides']),
	openai: new Set(['disable_store']),
};

const KEY_ADVANCED_FIELDS = [
	'aliases',
	'azure_key_config',
	'vertex_key_config',
	'bedrock_key_config',
	'bedrock_mantle_key_config',
	'vllm_key_config',
	'replicate_key_config',
	'ollama_key_config',
	'sgl_key_config',
	'use_for_batch_api',
	'use_anthropic_endpoints',
	'description',
] as const;

function isRecord(value: unknown): value is JsonRecord {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function unsupportedProviderConfigFields(section: ProviderConfigSection, value: JsonRecord): string[] {
	const allowed = PROVIDER_CONFIG_FIELDS[section];
	return Object.keys(value).filter((field) => !allowed.has(field)).sort();
}

export function unavailableVirtualKeyProviders(providerConfigs: unknown, providers: JsonRecord[]): string[] {
	if (!Array.isArray(providerConfigs)) return [];
	const statusByName = new Map<string, string>();
	for (const provider of providers) {
		if (typeof provider.name === 'string') {
			statusByName.set(provider.name, typeof provider.provider_status === 'string' ? provider.provider_status : '');
		}
	}
	const names = providerConfigs
		.filter(isRecord)
		.map((item) => item.provider)
		.filter((name): name is string => typeof name === 'string' && name.length > 0);
	return [...new Set(names.filter((name) => statusByName.get(name) !== 'active'))].sort();
}

export function providerConfigsForForm(value: unknown): unknown[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isRecord).map((item) => {
		const keys = Array.isArray(item.keys)
			? item.keys.filter(isRecord).map((key) => String(key.key_id ?? key.id ?? '')).filter(Boolean)
			: [];
		return {
			...(typeof item.id === 'number' ? { id: item.id } : {}),
			provider: item.provider,
			weight: item.weight,
			allowed_models: Array.isArray(item.allowed_models) ? item.allowed_models : [],
			blacklisted_models: Array.isArray(item.blacklisted_models) ? item.blacklisted_models : [],
			// Bifrost 用 ["*"] 表示允许该 Provider 的全部 Key；空数组是明确拒绝全部。
			key_ids: item.allow_all_keys === true ? ['*'] : keys,
			budgets: item.budgets,
			rate_limit: item.rate_limit,
		};
	});
}

export function keyAdvancedForForm(key: JsonRecord): JsonRecord {
	const advanced: JsonRecord = {};
	for (const field of KEY_ADVANCED_FIELDS) {
		if (key[field] !== undefined) advanced[field] = key[field];
	}
	return advanced;
}
