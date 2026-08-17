import { afterEach, describe, expect, test } from 'bun:test';
import { bifrostDataProvider } from './data-provider';
import {
	hasOpenAIBaseURLVersionConflict,
	isMissingProviderKeyError,
	keyAdvancedForForm,
	providerKeyModelAccess,
	providerKeyModelsForPayload,
	providerConfigsForForm,
	providerMaxRetriesForPayload,
	removedVirtualKeyProviderConfigCount,
	unavailableVirtualKeyProviders,
	unsupportedProviderConfigFields,
	virtualKeyAdvancedProviderFields,
	virtualKeyProviderConfigsForPayload,
} from './resource-forms';

const originalFetch = globalThis.fetch;

function respond(payload: unknown): Promise<Response> {
	return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => { globalThis.fetch = originalFetch; });

describe('Bifrost DataProvider', () => {
	test('maps virtual-key pagination and total', async () => {
		let requested = '';
		globalThis.fetch = ((input) => { requested = String(input); return respond({ virtual_keys: [{ id: 'vk-1' }], total_count: 7 }); }) as typeof fetch;
		const result = await bifrostDataProvider.getList({ resource: 'virtual-keys', pagination: { current: 2, pageSize: 3 } });
		expect(requested).toBe('/api/governance/virtual-keys?limit=3&offset=3');
		expect(result.total).toBe(7);
		expect(result.data).toEqual([{ id: 'vk-1' }]);
	});

	test('encodes provider ids and sends complete update body', async () => {
		let requested = '';
		let body = '';
		globalThis.fetch = ((input, init) => { requested = String(input); body = String(init?.body); return respond({ name: 'open ai' }); }) as typeof fetch;
		const variables = { network_config: { max_retries: 1 }, concurrency_and_buffer_size: { concurrency: 2, buffer_size: 4 } };
		const result = await bifrostDataProvider.update({ resource: 'providers', id: 'open ai', variables });
		expect(requested).toBe('/api/providers/open%20ai');
		expect(JSON.parse(body)).toEqual(variables);
		expect(result.data.name).toBe('open ai');
	});

	test('unwraps virtual-key mutation responses', async () => {
		globalThis.fetch = (() => respond({ message: 'ok', virtual_key: { id: 'vk-2', name: 'production' } })) as typeof fetch;
		const result = await bifrostDataProvider.create({ resource: 'virtual-keys', variables: { name: 'production' } });
		expect(result.data).toEqual({ id: 'vk-2', name: 'production' });
	});

	test('preserves allow-all provider-key semantics when hydrating a virtual key form', () => {
		expect(providerConfigsForForm([{ id: 3, provider: 'openai', allow_all_keys: true, keys: [] }])).toEqual([
			{
				id: 3,
				provider: 'openai',
				weight: undefined,
				allowed_models: [],
				blacklisted_models: [],
				allow_all_keys: true,
				budgets: undefined,
				rate_limit: undefined,
			},
		]);
	});

	test('normalizes virtual-key provider routing modes without accepting response projections', () => {
		expect(virtualKeyProviderConfigsForPayload([
			{ provider: 'openai', allow_all_keys: true, key_ids: [] },
			{ provider: 'anthropic', key_ids: ['key-1'] },
		])).toEqual([
			{ provider: 'openai', allow_all_keys: true },
			{ provider: 'anthropic', key_ids: ['key-1'] },
		]);
		expect(() => virtualKeyProviderConfigsForPayload([{ provider: 'openai', keys: ['key-1'] }]))
			.toThrow('keys is response-only');
		expect(() => virtualKeyProviderConfigsForPayload([{ provider: 'openai', allow_all_keys: true, key_ids: ['key-1'] }]))
			.toThrow('allow_all_keys');
	});

	test('reports provider routing fields misplaced in virtual-key advanced JSON', () => {
		expect(virtualKeyAdvancedProviderFields({ allow_all_keys: true, key_ids: ['key-1'], description: 'ok' }))
			.toEqual(['allow_all_keys', 'key_ids']);
	});

	test('detects provider routes removed by a full virtual-key replacement', () => {
		expect(removedVirtualKeyProviderConfigCount(
			[{ id: 1, provider: 'openai' }, { id: 2, provider: 'anthropic' }],
			[{ id: 1, provider: 'openai', allow_all_keys: true }, { provider: 'gemini', key_ids: ['key-1'] }],
		)).toBe(1);
		expect(removedVirtualKeyProviderConfigCount([{ id: 1 }], [{ id: 1, provider: 'openai' }])).toBe(0);
	});

	test('accepts retry values emitted by Svelte number inputs', () => {
		expect(providerMaxRetriesForPayload(2)).toBe(2);
		expect(providerMaxRetriesForPayload('1')).toBe(1);
		expect(providerMaxRetriesForPayload('')).toBeUndefined();
		expect(() => providerMaxRetriesForPayload(-1)).toThrow('non-negative integer');
		expect(() => providerMaxRetriesForPayload(1.5)).toThrow('non-negative integer');
	});

	test('preserves provider-specific key configuration in the advanced form', () => {
		const advanced = keyAdvancedForForm({
			id: 'key-1',
			name: 'primary',
			value: { value: 'sk-********' },
			aliases: { fast: { model: 'gpt-5' } },
			azure_key_config: { endpoint: { value: 'https://example.test' } },
			use_for_batch_api: false,
			status: 'active',
		});
		expect(advanced).toEqual({
			aliases: { fast: { model: 'gpt-5' } },
			azure_key_config: { endpoint: { value: 'https://example.test' } },
			use_for_batch_api: false,
		});
	});

	test('reports provider JSON fields that the management API would otherwise discard', () => {
		expect(unsupportedProviderConfigFields('openai', { disable_store: false, base_url: 'https://example.com', api_key: 'secret', model: 'gpt-4o' }))
			.toEqual(['api_key', 'base_url', 'model']);
		expect(unsupportedProviderConfigFields('network', { base_url: 'https://example.com' })).toEqual([]);
		expect(unsupportedProviderConfigFields('custom', { base_provider_type: 'openai', is_key_less: false })).toEqual([]);
	});

	test('rejects an OpenAI-compatible base URL that already ends in /v1', () => {
		expect(hasOpenAIBaseURLVersionConflict(
			{ base_url: 'https://api.example.com/v1/' },
			{ base_provider_type: 'openai' },
		)).toBeTrue();
		expect(hasOpenAIBaseURLVersionConflict(
			{ base_url: 'https://api.example.com/gateway' },
			{ base_provider_type: 'openai' },
		)).toBeFalse();
		expect(hasOpenAIBaseURLVersionConflict(
			{ base_url: 'https://api.example.com/v1/' },
			{ base_provider_type: 'anthropic' },
		)).toBeFalse();
	});

	test('normalizes an empty provider-key model list to the explicit wildcard', () => {
		expect(providerKeyModelsForPayload('')).toEqual(['*']);
		expect(providerKeyModelsForPayload(' gpt-4o, claude-sonnet ')).toEqual(['gpt-4o', 'claude-sonnet']);
		expect(providerKeyModelAccess([])).toBe('none');
		expect(providerKeyModelAccess(['*'])).toBe('all');
		expect(providerKeyModelAccess(['gpt-4o'])).toBe('limited');
	});

	test('treats a missing key on delete as an idempotent result', () => {
		expect(isMissingProviderKeyError({ status: 404 })).toBeTrue();
		expect(isMissingProviderKeyError({ status: 500 })).toBeFalse();
	});

	test('marks virtual-key provider routes unavailable when a provider is missing or unhealthy', () => {
		const configs = [{ provider: 'healthy' }, { provider: 'broken' }, { provider: 'missing' }];
		const providers = [
			{ name: 'healthy', provider_status: 'active' },
			{ name: 'broken', provider_status: 'error' },
		];
		expect(unavailableVirtualKeyProviders(configs, providers)).toEqual(['broken', 'missing']);
	});
});
