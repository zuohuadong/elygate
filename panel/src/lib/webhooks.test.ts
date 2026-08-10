import { describe, expect, test } from 'bun:test';
import { buildWebhookPayload, buildWebhookQuery, endpointPayload, emptyWebhookDraft, webhookDraftFromEndpoint } from './webhooks';

describe('webhook management helpers', () => {
	test('builds canonical filters', () => {
		const query = buildWebhookQuery({ search: ' billing ', events: ['async_job.failed', 'unknown', 'async_job.completed'], status: 'disabled', limit: 25, offset: 50 });
		expect(query).toContain('search=billing');
		expect(query).toContain('event=async_job.completed%2Casync_job.failed');
		expect(query).toContain('disabled=true');
	});

	test('builds a complete create payload and normalizes string headers', () => {
		const draft = emptyWebhookDraft();
		draft.name = 'billing';
		draft.url = 'https://hooks.example.com/bifrost';
		draft.headersJson = '{"Authorization":"Bearer token","X-Key":{"type":"env","ref":"HOOK_KEY"}}';
		draft.maxRetries = 3;
		const payload = buildWebhookPayload(draft);
		expect(payload.headers).toEqual({ Authorization: { value: 'Bearer token', ref: '' }, 'X-Key': { type: 'env', ref: 'HOOK_KEY' } });
		expect(payload.max_retries).toBe(3);
		expect(payload.events).toEqual(['async_job.completed', 'async_job.failed']);
	});

	test('requires private-network acknowledgement for HTTP receivers', () => {
		const draft = emptyWebhookDraft();
		draft.name = 'internal';
		draft.url = 'http://10.0.0.8/hook';
		expect(() => buildWebhookPayload(draft)).toThrow('http-private-required');
		draft.allowPrivateNetwork = true;
		expect(buildWebhookPayload(draft).allow_private_network).toBe(true);
	});

	test('round-trips the full endpoint state when toggling', () => {
		const endpoint = {
			name: 'jobs', url: 'https://hooks.example.com/jobs', events: ['async_job.failed'], headers: { Authorization: { value: '********', ref: '' } },
			include_response: true, allow_private_network: false, disabled: false, max_retries: 4, retry_backoff_initial_seconds: 30,
			retry_backoff_max_seconds: 1800, attempt_timeout_seconds: 10, max_response_payload_kbs: 256, max_concurrent_deliveries: 10,
		};
		const draft = webhookDraftFromEndpoint(endpoint);
		expect(draft.maxRetries).toBe('4');
		const payload = endpointPayload(endpoint, { disabled: true });
		expect(payload.disabled).toBe(true);
		expect(payload.headers).toEqual(endpoint.headers);
		expect(payload.max_concurrent_deliveries).toBe(10);
	});
});
