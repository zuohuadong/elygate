export type JsonRecord = Record<string, unknown>;

export interface SessionStatus {
	auth_type: 'none' | 'password';
	has_valid_token: boolean;
	is_auth_enabled: boolean;
}

export class ApiError extends Error {
	public readonly status: number;
	public readonly payload: unknown;

	public constructor(status: number, message: string, payload?: unknown) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.payload = payload;
	}
}

export type RequestErrorFormatter = (status: number) => string;

const defaultRequestErrorFormatter: RequestErrorFormatter = (status) => `HTTP ${status}`;
let requestErrorFormatter = defaultRequestErrorFormatter;

export function configureRequestErrorFormatter(formatter?: RequestErrorFormatter): void {
	requestErrorFormatter = formatter ?? defaultRequestErrorFormatter;
}

function errorMessageFrom(value: unknown, depth = 0): string {
	if (typeof value === 'string') return value.trim();
	if (!isJsonRecord(value) || depth > 2) return '';
	for (const key of ['message', 'detail', 'error']) {
		const message = errorMessageFrom(value[key], depth + 1);
		if (message) return message;
	}
	return '';
}

function getErrorMessage(payload: unknown, fallback: string): string {
	return errorMessageFrom(payload) || fallback;
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(path, {
		credentials: 'same-origin',
		headers: {
			Accept: 'application/json',
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			...init.headers,
		},
		...init,
	});

	const payload: unknown = await response.json().catch(() => undefined);
	if (!response.ok) {
		throw new ApiError(response.status, getErrorMessage(payload, requestErrorFormatter(response.status)), payload);
	}
	return payload as T;
}

export function getSessionStatus(): Promise<SessionStatus> {
	return requestJson<SessionStatus>('/api/session/is-auth-enabled');
}

export function getListPayload(value: unknown): JsonRecord[] {
	if (Array.isArray(value)) return value.filter(isJsonRecord);
	if (!isJsonRecord(value)) return [];

	for (const key of ['data', 'items', 'providers', 'virtual_keys', 'logs', 'models', 'keys', 'teams', 'customers', 'rules', 'model_configs', 'budgets', 'rate_limits', 'pricing_overrides', 'webhooks', 'endpoints', 'sessions', 'plugins', 'skills', 'folders', 'prompts']) {
		const candidate = value[key];
		if (Array.isArray(candidate)) return candidate.filter(isJsonRecord);
	}

	for (const candidate of Object.values(value)) {
		if (Array.isArray(candidate)) return candidate.filter(isJsonRecord);
	}

	return [];
}

export function getTotal(value: unknown, fallback = 0): number {
	if (!isJsonRecord(value)) return fallback;
	for (const key of ['total', 'total_count', 'count']) {
		const candidate = value[key];
		if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
	}
	return fallback;
}

export function getObjectPayload(value: unknown, key: string): JsonRecord {
	if (!isJsonRecord(value)) return {};
	return isJsonRecord(value[key]) ? value[key] : value;
}

export function encodePathSegment(value: string | number): string {
	return encodeURIComponent(String(value));
}

export function isJsonRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function displayValue(value: unknown): string {
	if (value === null || value === undefined) return '—';
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) return value.map(displayValue).join(', ');
	return JSON.stringify(value);
}
