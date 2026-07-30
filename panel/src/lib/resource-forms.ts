import type { JsonRecord } from './api';

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
