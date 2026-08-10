import { describe, expect, test } from 'bun:test';
import { buildComplexityPayload, buildProxyPayload, complexityDraftFromRecord, proxyDraftFromRecord } from './routing-network-settings';

describe('routing and network settings helpers', () => {
	test('normalizes ordered complexity tiers and de-duplicates keywords', () => {
		const draft = complexityDraftFromRecord({
			tier_boundaries: { simple_medium: 0.2, medium_complex: 0.4, complex_reasoning: 0.7 },
			keywords: { simple_keywords: ['hello'], code_keywords: ['code'], technical_keywords: ['infra'], reasoning_keywords: ['why'] },
		});
		draft.keywords.code_keywords = 'Code\ncode\ndebug';
		expect(buildComplexityPayload(draft)).toEqual({
			tier_boundaries: { simple_medium: 0.2, medium_complex: 0.4, complex_reasoning: 0.7 },
			keywords: { simple_keywords: ['hello'], code_keywords: ['Code', 'debug'], technical_keywords: ['infra'], reasoning_keywords: ['why'] },
		});
	});

	test('rejects unordered thresholds and empty keyword groups', () => {
		const draft = complexityDraftFromRecord({
			keywords: { simple_keywords: ['hello'], code_keywords: ['code'], technical_keywords: ['infra'], reasoning_keywords: ['why'] },
		});
		draft.mediumComplex = 0.1;
		expect(() => buildComplexityPayload(draft)).toThrow('boundary-order');
		draft.mediumComplex = 0.35; draft.keywords.reasoning_keywords = '';
		expect(() => buildComplexityPayload(draft)).toThrow('keywords:reasoning_keywords');
	});

	test('round-trips redacted proxy credentials and all entity toggles', () => {
		const draft = proxyDraftFromRecord({
			enabled: true, type: 'http', url: 'https://proxy.example.com:8443', username: 'svc', password: '<redacted>',
			no_proxy: ' localhost, .internal ', timeout: 60, skip_tls_verify: true,
			enable_for_scim: true, enable_for_inference: true, enable_for_api: true,
		});
		expect(buildProxyPayload(draft)).toEqual({
			enabled: true, type: 'http', url: 'https://proxy.example.com:8443', username: 'svc', password: '<redacted>',
			no_proxy: 'localhost, .internal', timeout: 60, skip_tls_verify: true,
			enable_for_scim: true, enable_for_inference: true, enable_for_api: true,
		});
	});

	test('rejects unsupported proxy URLs and oversized timeouts', () => {
		const draft = proxyDraftFromRecord({ enabled: true, url: 'socks5://proxy.example.com', timeout: 30 });
		expect(() => buildProxyPayload(draft)).toThrow('url-invalid');
		draft.url = 'http://proxy.example.com'; draft.timeout = 301;
		expect(() => buildProxyPayload(draft)).toThrow('timeout-invalid');
	});
});
