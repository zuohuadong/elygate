import { afterEach, describe, expect, test } from 'bun:test';
import { bifrostDataProvider } from './data-provider';
import { keyAdvancedForForm, providerConfigsForForm } from './resource-forms';

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
				key_ids: ['*'],
				budgets: undefined,
				rate_limit: undefined,
			},
		]);
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
});
