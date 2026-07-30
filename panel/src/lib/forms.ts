import type { JsonRecord } from './api';

export function parseJsonObject(value: string, label: string, invalidMessage = 'Invalid JSON'): JsonRecord {
	if (!value.trim()) return {};
	let parsed: unknown;
	try { parsed = JSON.parse(value); } catch { throw new Error(`${invalidMessage}: ${label}`); }
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${invalidMessage}: ${label}`);
	return parsed as JsonRecord;
}

export function parseJsonArray(value: string, label: string, invalidMessage = 'Invalid JSON'): unknown[] {
	if (!value.trim()) return [];
	let parsed: unknown;
	try { parsed = JSON.parse(value); } catch { throw new Error(`${invalidMessage}: ${label}`); }
	if (!Array.isArray(parsed)) throw new Error(`${invalidMessage}: ${label}`);
	return parsed;
}

export function prettyJson(value: unknown, fallback = ''): string {
	if (value === undefined || value === null) return fallback;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return fallback;
	}
}

export function csv(value: string): string[] {
	return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function displayError(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
