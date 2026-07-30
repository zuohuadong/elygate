import { afterEach, describe, expect, test } from 'bun:test';
import { ApiError, configureRequestErrorFormatter, requestJson } from './api';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	configureRequestErrorFormatter();
});

describe('requestJson', () => {
	test('uses the active localized fallback for unstructured errors', async () => {
		configureRequestErrorFormatter((status) => `请求失败（HTTP ${status}）`);
		globalThis.fetch = (() => Promise.resolve(new Response('', { status: 503 }))) as typeof fetch;

		await expect(requestJson('/api/test')).rejects.toEqual(new ApiError(503, '请求失败（HTTP 503）'));
	});

	test('prefers a structured server error message', async () => {
		configureRequestErrorFormatter((status) => `Request failed (HTTP ${status})`);
		globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ error: 'Provider unavailable' }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' },
		}))) as typeof fetch;

		await expect(requestJson('/api/test')).rejects.toEqual(new ApiError(502, 'Provider unavailable'));
	});
});
