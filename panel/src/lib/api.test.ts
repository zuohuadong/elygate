import { afterEach, describe, expect, test } from 'bun:test';
import { ApiError, configureRequestErrorFormatter, getListPayload, requestJson } from './api';

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

	test('extracts the nested Bifrost error message', async () => {
		globalThis.fetch = (async () => new Response(JSON.stringify({
			status_code: 409,
			error: { message: 'Provider is not healthy' },
		}), {
			status: 409,
			headers: { 'Content-Type': 'application/json' },
		})) as typeof fetch;

		await expect(requestJson('/api/test')).rejects.toEqual(new ApiError(409, 'Provider is not healthy'));
	});
});

describe('getListPayload', () => {
	test('unwraps Bifrost management list responses used by the lightweight panel', () => {
		expect(getListPayload({ teams: [{ id: 'team-1' }] })).toEqual([{ id: 'team-1' }]);
		expect(getListPayload({ pricing_overrides: [{ id: 'price-1' }] })).toEqual([{ id: 'price-1' }]);
		expect(getListPayload({ endpoints: [{ id: 'webhook-1' }] })).toEqual([{ id: 'webhook-1' }]);
		expect(getListPayload({ sessions: [{ id: 'mcp-session-1' }] })).toEqual([{ id: 'mcp-session-1' }]);
	});
});
