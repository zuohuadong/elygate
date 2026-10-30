import { describe, expect, test } from 'bun:test';
import {
	buildRoutingVersionPayload, parseRoutingPolicyVersion, parseRoutingPolicyVersionPage,
	ROUTING_VERSION_PAGE_SIZE, RoutingVersionError,
} from './routing-policy-versions';

const version = {
	id: '123e4567-e89b-12d3-a456-426614174001',
	draft_id: '123e4567-e89b-12d3-a456-426614174000',
	draft_revision: 3,
	name: 'Candidate',
	chain_max_depth: 10,
	content_sha256: 'a'.repeat(64),
	created_at: '2026-10-30T00:00:00Z',
	rules: [{ id: 'rule-1', targets: [{ provider: 'openai', model: 'mini', weight: 1 }] }],
};

describe('routing policy version contracts', () => {
	test('builds an expected revision payload with JavaScript-safe bounds', () => {
		expect(buildRoutingVersionPayload(3)).toEqual({ expected_revision: 3 });
		for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() => buildRoutingVersionPayload(revision)).toThrow(RoutingVersionError);
		}
	});

	test('parses immutable details and paginated summaries', () => {
		expect(parseRoutingPolicyVersion(version, version.id)).toEqual(version);
		const { rules: _rules, ...summary } = version;
		expect(parseRoutingPolicyVersionPage({ versions: [summary], limit: ROUTING_VERSION_PAGE_SIZE, offset: 25 }, 25)).toEqual([summary]);
		expect(parseRoutingPolicyVersion({ ...version, rules: [] }).rules).toEqual([]);
	});

	test('rejects malformed, unsafe, duplicate and incomplete responses', () => {
		for (const payload of [
			null, {}, { ...version, id: version.id.toUpperCase() }, { ...version, draft_id: 'bad' },
			{ ...version, draft_revision: 0 }, { ...version, draft_revision: Number.MAX_SAFE_INTEGER },
			{ ...version, name: '' }, { ...version, chain_max_depth: 21 },
			{ ...version, content_sha256: 'bad' }, { ...version, created_at: 'invalid' },
			{ ...version, rules: null }, { ...version, rules: [null] }, { ...version, rules: Array(33).fill({}) },
		]) expect(() => parseRoutingPolicyVersion(payload)).toThrow(RoutingVersionError);
		expect(() => parseRoutingPolicyVersion(version, '123e4567-e89b-12d3-a456-426614174099')).toThrow(RoutingVersionError);
		const { rules: _rules, ...summary } = version;
		for (const payload of [
			null, {}, { versions: null, limit: ROUTING_VERSION_PAGE_SIZE, offset: 0 },
			{ versions: [summary], limit: 1, offset: 0 }, { versions: [summary, summary], limit: ROUTING_VERSION_PAGE_SIZE, offset: 0 },
			{ versions: Array(26).fill(summary), limit: ROUTING_VERSION_PAGE_SIZE, offset: 0 },
		]) expect(() => parseRoutingPolicyVersionPage(payload, 0)).toThrow(RoutingVersionError);
	});
});
