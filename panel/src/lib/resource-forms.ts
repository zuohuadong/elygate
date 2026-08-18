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

const VIRTUAL_KEY_PROVIDER_FIELDS = new Set(['allow_all_keys', 'key_ids', 'keys']);

function isRecord(value: unknown): value is JsonRecord {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function unsupportedProviderConfigFields(section: ProviderConfigSection, value: JsonRecord): string[] {
	const allowed = PROVIDER_CONFIG_FIELDS[section];
	return Object.keys(value).filter((field) => !allowed.has(field)).sort();
}

export function hasOpenAIBaseURLVersionConflict(network: JsonRecord, custom: JsonRecord): boolean {
	if (String(custom.base_provider_type ?? '').trim().toLowerCase() !== 'openai') return false;
	if (typeof network.base_url !== 'string' || !network.base_url.trim()) return false;
	try {
		const pathname = new URL(network.base_url).pathname.replace(/\/+$/, '');
		return pathname.toLowerCase().endsWith('/v1');
	} catch {
		return false;
	}
}

export function providerKeyModelsForPayload(modelsInput: string): string[] {
	const models = modelsInput.split(',').map((item) => item.trim()).filter(Boolean);
	return models.length ? models : ['*'];
}

export type ProviderKeyModelAccess = 'all' | 'none' | 'limited';

export function providerKeyModelAccess(models: unknown): ProviderKeyModelAccess {
	if (!Array.isArray(models) || models.length === 0) return 'none';
	return models.some((model) => String(model).trim() === '*') ? 'all' : 'limited';
}

export function isMissingProviderKeyError(error: unknown): boolean {
	return isRecord(error) && error.status === 404;
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
			// API uses the explicit field; empty key_ids remains a deny-all configuration.
			...(item.allow_all_keys === true ? { allow_all_keys: true } : { key_ids: keys }),
			budgets: item.budgets,
			rate_limit: item.rate_limit,
		};
	});
}

export function virtualKeyAdvancedProviderFields(value: JsonRecord): string[] {
	return Object.keys(value).filter((field) => VIRTUAL_KEY_PROVIDER_FIELDS.has(field)).sort();
}

export function removedVirtualKeyProviderConfigCount(current: unknown, next: JsonRecord[]): number {
	if (!Array.isArray(current)) return 0;
	const nextIDs = new Set(next.map((item) => item.id).filter((id): id is number => typeof id === 'number'));
	return current.filter(isRecord).filter((item) => typeof item.id === 'number' && !nextIDs.has(item.id)).length;
}

export function duplicateVirtualKeyProviders(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const item of value) {
		if (!isRecord(item) || typeof item.provider !== 'string') continue;
		const provider = item.provider.trim();
		if (!provider) continue;
		if (seen.has(provider)) duplicates.add(provider);
		seen.add(provider);
	}
	return [...duplicates].sort();
}

export function availableVirtualKeyProviders(providers: JsonRecord[], routes: JsonRecord[], currentIndex = -1): JsonRecord[] {
	const used = new Set(routes
		.filter((_, index) => index !== currentIndex)
		.map((route) => typeof route.provider === 'string' ? route.provider : '')
		.filter(Boolean));
	return providers.filter((provider) => typeof provider.name === 'string' && !used.has(provider.name));
}

export function providerMaxRetriesForPayload(value: unknown): number | undefined {
	const normalized = String(value ?? '').trim();
	if (!normalized) return undefined;
	const parsed = Number(normalized);
	if (!Number.isInteger(parsed) || parsed < 0) throw new RangeError('max_retries must be a non-negative integer');
	return parsed;
}

export function virtualKeyProviderConfigsForPayload(value: unknown[]): JsonRecord[] {
	return value.map((item, index) => {
		if (!isRecord(item)) throw new Error(`provider_configs[${index}] must be an object`);
		if ('keys' in item) throw new Error(`provider_configs[${index}].keys is response-only; use key_ids or allow_all_keys`);
		const normalized = { ...item };
		const keyIDs = Array.isArray(normalized.key_ids) ? normalized.key_ids : [];
		if (normalized.allow_all_keys === true) {
			if (keyIDs.length > 0) throw new Error(`provider_configs[${index}] cannot combine allow_all_keys with key_ids`);
			delete normalized.key_ids;
		}
		return normalized;
	});
}

export function keyAdvancedForForm(key: JsonRecord): JsonRecord {
	const advanced: JsonRecord = {};
	for (const field of KEY_ADVANCED_FIELDS) {
		if (key[field] !== undefined) advanced[field] = key[field];
	}
	return advanced;
}
