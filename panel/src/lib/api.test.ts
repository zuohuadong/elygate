import { afterEach, describe, expect, test } from 'bun:test';
import { ApiError, configureRequestErrorFormatter, getListPayload, requestJson } from './api';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	configureRequestErrorFormatter();
});

describe('requestJson', () => {
	test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('sets JSON content type for bodyless %s', async (method) => {
		globalThis.fetch = (async (_path, init) => {
			expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
			expect(init?.credentials).toBe('same-origin');
			return new Response(null, { status: 204 });
		}) as typeof fetch;
		await requestJson('/api/control-plane/test', { method });
	});

	test('preserves Headers and tuple header overrides', async () => {
		for (const headers of [new Headers({ 'X-Test': 'yes', Accept: 'text/plain' }), [['X-Test', 'yes'], ['Accept', 'text/plain']] as [string, string][]]) {
			globalThis.fetch = (async (_path, init) => {
				expect(new Headers(init?.headers).get('X-Test')).toBe('yes');
				expect(new Headers(init?.headers).get('Accept')).toBe('text/plain');
				return new Response('{}');
			}) as typeof fetch;
			await requestJson('/api/test', { headers });
		}
	});
	test('uses the active localized fallback for unstructured errors', async () => {
		configureRequestErrorFormatter((status) => `请求失败（HTTP ${status}）`);
		globalThis.fetch = (() => Promise.resolve(new Response('', { status: 503 }))) as typeof fetch;

		await expect(requestJson('/api/test')).rejects.toEqual(new ApiError(503, '请求失败（HTTP 503）'));
	});

	test('prefers a structured server error message', async () => {
		configureRequestErrorFormatter((status) => `Request failed (HTTP ${status})`);
		const payload = { error: 'Provider unavailable' };
		globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(payload), {
			status: 502,
			headers: { 'Content-Type': 'application/json' },
		}))) as typeof fetch;

		await expect(requestJson('/api/test')).rejects.toEqual(new ApiError(502, 'Provider unavailable', payload));
	});

	test('extracts the nested Bifrost error message', async () => {
		const payload = {
			status_code: 409,
			error: { message: 'Provider is not healthy' },
		};
		globalThis.fetch = (async () => new Response(JSON.stringify({
			...payload,
		}), {
			status: 409,
			headers: { 'Content-Type': 'application/json' },
		})) as typeof fetch;

		await expect(requestJson('/api/test')).rejects.toEqual(new ApiError(409, 'Provider is not healthy', payload));
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
