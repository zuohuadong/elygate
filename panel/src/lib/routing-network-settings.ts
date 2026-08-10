import { isJsonRecord, type JsonRecord } from './api';

export type ComplexityKeywordKey = 'simple_keywords' | 'code_keywords' | 'technical_keywords' | 'reasoning_keywords';

export interface ComplexityDraft {
	simpleMedium: string | number;
	mediumComplex: string | number;
	complexReasoning: string | number;
	keywords: Record<ComplexityKeywordKey, string>;
}

export interface ProxyDraft {
	enabled: boolean;
	type: 'http';
	url: string;
	username: string;
	password: string;
	noProxy: string;
	timeout: string | number;
	skipTlsVerify: boolean;
	enableForScim: boolean;
	enableForInference: boolean;
	enableForApi: boolean;
}

export const COMPLEXITY_KEYWORD_KEYS: ComplexityKeywordKey[] = ['simple_keywords', 'code_keywords', 'technical_keywords', 'reasoning_keywords'];

function numberValue(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function listText(value: unknown): string { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').join('\n') : ''; }
function boundary(value: string | number, name: string): number {
	const parsed = Number(String(value).trim());
	if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) throw new Error(`boundary:${name}`);
	return parsed;
}
function keywordList(value: string, key: ComplexityKeywordKey): string[] {
	const seen = new Set<string>();
	const values = value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).filter((item) => {
		const normalized = item.toLowerCase(); if (seen.has(normalized)) return false; seen.add(normalized); return true;
	});
	if (values.length === 0) throw new Error(`keywords:${key}`);
	return values;
}

export function complexityDraftFromRecord(record: JsonRecord): ComplexityDraft {
	const tiers = isJsonRecord(record.tier_boundaries) ? record.tier_boundaries : {};
	const keywords = isJsonRecord(record.keywords) ? record.keywords : {};
	return {
		simpleMedium: numberValue(tiers.simple_medium, 0.15),
		mediumComplex: numberValue(tiers.medium_complex, 0.35),
		complexReasoning: numberValue(tiers.complex_reasoning, 0.6),
		keywords: {
			simple_keywords: listText(keywords.simple_keywords),
			code_keywords: listText(keywords.code_keywords),
			technical_keywords: listText(keywords.technical_keywords),
			reasoning_keywords: listText(keywords.reasoning_keywords),
		},
	};
}

export function buildComplexityPayload(draft: ComplexityDraft): JsonRecord {
	const simpleMedium = boundary(draft.simpleMedium, 'simple-medium');
	const mediumComplex = boundary(draft.mediumComplex, 'medium-complex');
	const complexReasoning = boundary(draft.complexReasoning, 'complex-reasoning');
	if (!(simpleMedium < mediumComplex && mediumComplex < complexReasoning)) throw new Error('boundary-order');
	return {
		tier_boundaries: { simple_medium: simpleMedium, medium_complex: mediumComplex, complex_reasoning: complexReasoning },
		keywords: Object.fromEntries(COMPLEXITY_KEYWORD_KEYS.map((key) => [key, keywordList(draft.keywords[key], key)])),
	};
}

export function emptyProxyDraft(): ProxyDraft {
	return { enabled: false, type: 'http', url: '', username: '', password: '', noProxy: '', timeout: 30, skipTlsVerify: false, enableForScim: false, enableForInference: false, enableForApi: false };
}

export function proxyDraftFromRecord(record: JsonRecord): ProxyDraft {
	return {
		enabled: record.enabled === true,
		type: 'http',
		url: stringValue(record.url),
		username: stringValue(record.username),
		password: stringValue(record.password),
		noProxy: stringValue(record.no_proxy),
		timeout: numberValue(record.timeout, 30),
		skipTlsVerify: record.skip_tls_verify === true,
		enableForScim: record.enable_for_scim === true,
		enableForInference: record.enable_for_inference === true,
		enableForApi: record.enable_for_api === true,
	};
}

export function buildProxyPayload(draft: ProxyDraft): JsonRecord {
	const timeout = Number(String(draft.timeout).trim() || '0');
	if (!Number.isInteger(timeout) || timeout < 0 || timeout > 300) throw new Error('timeout-invalid');
	const url = draft.url.trim();
	if (draft.enabled) {
		if (!url) throw new Error('url-required');
		let parsed: URL;
		try { parsed = new URL(url); } catch { throw new Error('url-invalid'); }
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('url-invalid');
	}
	return {
		enabled: draft.enabled,
		type: 'http',
		url,
		username: draft.username.trim(),
		password: draft.password,
		no_proxy: draft.noProxy.split(',').map((host) => host.trim()).filter(Boolean).join(', '),
		timeout,
		skip_tls_verify: draft.skipTlsVerify,
		enable_for_scim: draft.enableForScim,
		enable_for_inference: draft.enableForInference,
		enable_for_api: draft.enableForApi,
	};
}
