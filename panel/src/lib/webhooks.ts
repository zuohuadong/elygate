import { isJsonRecord, type JsonRecord } from './api';
import { parseJsonObject, prettyJson } from './forms';

export const WEBHOOK_EVENTS = ['async_job.completed', 'async_job.failed'] as const;
export type WebhookEvent = typeof WEBHOOK_EVENTS[number];

export interface WebhookDraft {
	name: string;
	url: string;
	events: WebhookEvent[];
	headersJson: string;
	includeResponse: boolean;
	allowPrivateNetwork: boolean;
	disabled: boolean;
	maxRetries: string | number;
	retryBackoffInitialSeconds: string | number;
	retryBackoffMaxSeconds: string | number;
	attemptTimeoutSeconds: string | number;
	maxResponsePayloadKbs: string | number;
	maxConcurrentDeliveries: string | number;
}

export interface WebhookFilters {
	search: string;
	events: string[];
	status: '' | 'enabled' | 'disabled';
	limit: number;
	offset: number;
}

function integer(value: string | number | undefined, field: string): number {
	if (value === undefined || String(value).trim() === '') return 0;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`invalid:${field}`);
	return parsed;
}

function normalizeHeaders(value: JsonRecord): JsonRecord {
	const normalized: JsonRecord = {};
	for (const [rawName, rawValue] of Object.entries(value)) {
		const name = rawName.trim();
		if (!name) continue;
		if (typeof rawValue === 'string') {
			if (!rawValue.trim()) throw new Error(`header-value:${name}`);
			normalized[name] = { value: rawValue, ref: '' };
			continue;
		}
		if (!isJsonRecord(rawValue) || (!String(rawValue.value ?? '').trim() && !String(rawValue.ref ?? '').trim())) throw new Error(`header-value:${name}`);
		normalized[name] = rawValue;
	}
	return normalized;
}

export function buildWebhookQuery(filters: WebhookFilters): string {
	const params = new URLSearchParams({ limit: String(filters.limit), offset: String(filters.offset) });
	if (filters.search.trim()) params.set('search', filters.search.trim());
	const events = filters.events.filter((event): event is WebhookEvent => WEBHOOK_EVENTS.includes(event as WebhookEvent));
	if (events.length) params.set('event', [...events].sort().join(','));
	if (filters.status) params.set('disabled', String(filters.status === 'disabled'));
	return params.toString();
}

export function emptyWebhookDraft(): WebhookDraft {
	return {
		name: '', url: '', events: [...WEBHOOK_EVENTS], headersJson: '{}', includeResponse: false, allowPrivateNetwork: false, disabled: false,
		maxRetries: '', retryBackoffInitialSeconds: '', retryBackoffMaxSeconds: '', attemptTimeoutSeconds: '', maxResponsePayloadKbs: '', maxConcurrentDeliveries: '',
	};
}

export function webhookDraftFromEndpoint(endpoint: JsonRecord): WebhookDraft {
	return {
		name: typeof endpoint.name === 'string' ? endpoint.name : '',
		url: typeof endpoint.url === 'string' ? endpoint.url : '',
		events: Array.isArray(endpoint.events) ? endpoint.events.filter((event): event is WebhookEvent => WEBHOOK_EVENTS.includes(event as WebhookEvent)) : [],
		headersJson: prettyJson(endpoint.headers, '{}'),
		includeResponse: endpoint.include_response === true,
		allowPrivateNetwork: endpoint.allow_private_network === true,
		disabled: endpoint.disabled === true,
		maxRetries: endpoint.max_retries ? String(endpoint.max_retries) : '',
		retryBackoffInitialSeconds: endpoint.retry_backoff_initial_seconds ? String(endpoint.retry_backoff_initial_seconds) : '',
		retryBackoffMaxSeconds: endpoint.retry_backoff_max_seconds ? String(endpoint.retry_backoff_max_seconds) : '',
		attemptTimeoutSeconds: endpoint.attempt_timeout_seconds ? String(endpoint.attempt_timeout_seconds) : '',
		maxResponsePayloadKbs: endpoint.max_response_payload_kbs ? String(endpoint.max_response_payload_kbs) : '',
		maxConcurrentDeliveries: endpoint.max_concurrent_deliveries ? String(endpoint.max_concurrent_deliveries) : '',
	};
}

export function buildWebhookPayload(draft: WebhookDraft): JsonRecord {
	const name = draft.name.trim();
	const url = draft.url.trim();
	if (!name) throw new Error('name-required');
	let parsedUrl: URL;
	try { parsedUrl = new URL(url); } catch { throw new Error('url-invalid'); }
	if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) throw new Error('url-invalid');
	if (parsedUrl.protocol === 'http:' && !draft.allowPrivateNetwork) throw new Error('http-private-required');
	if (!draft.events.length) throw new Error('events-required');
	return {
		name,
		url,
		events: [...draft.events],
		headers: normalizeHeaders(parseJsonObject(draft.headersJson, 'headers')),
		include_response: draft.includeResponse,
		allow_private_network: draft.allowPrivateNetwork,
		disabled: draft.disabled,
		max_retries: integer(draft.maxRetries, 'max_retries'),
		retry_backoff_initial_seconds: integer(draft.retryBackoffInitialSeconds, 'retry_backoff_initial_seconds'),
		retry_backoff_max_seconds: integer(draft.retryBackoffMaxSeconds, 'retry_backoff_max_seconds'),
		attempt_timeout_seconds: integer(draft.attemptTimeoutSeconds, 'attempt_timeout_seconds'),
		max_response_payload_kbs: integer(draft.maxResponsePayloadKbs, 'max_response_payload_kbs'),
		max_concurrent_deliveries: integer(draft.maxConcurrentDeliveries, 'max_concurrent_deliveries'),
	};
}

export function endpointPayload(endpoint: JsonRecord, overrides: Partial<WebhookDraft> = {}): JsonRecord {
	return buildWebhookPayload({ ...webhookDraftFromEndpoint(endpoint), ...overrides });
}
