import { describe, expect, test } from 'bun:test';
import { buildRoutingDraftPayload, clearRoutingDraftRecovery, parseRoutingDraft, parseRoutingDraftPage, routingDraftRecovery, routingDraftRevision, RoutingDraftError } from './routing-drafts';
import { SimulationInputError } from './routing-simulation';

const draftRules = [{ id: 'rule-1', name: 'Route', targets: [{ provider: 'openai', model: 'mini', weight: 1 }] }];
const draft = { rules: JSON.stringify(draftRules), chainMaxDepth: 10 };
const detail = { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Candidate', revision: 1, chain_max_depth: 10,
	created_at: '2026-10-30T00:00:00Z', updated_at: '2026-10-30T00:00:00Z', rules: draftRules };
const { rules: _rules, ...summary } = detail;

describe('routing draft contracts', () => {
	test('invalidates recovery across authentication epochs', () => {
		const epoch = routingDraftRecovery.epoch;
		routingDraftRecovery.current = { draft: { ...draft, samples: '[]' }, selectedDraft: detail, name: detail.name, dirty: true, uncertain: true };
		clearRoutingDraftRecovery();
		expect(routingDraftRecovery.current).toBeNull();
		expect(routingDraftRecovery.epoch).toBe(epoch + 1);
	});
	test('builds a bounded server payload without samples or credentials', () => {
		const payload = buildRoutingDraftPayload(' Candidate ', { ...draft, samples: 'invalid JSON, never stored' } as typeof draft);
		expect(payload).toEqual({ name: 'Candidate', rules: draftRules, chain_max_depth: 10 });
		expect(JSON.stringify(payload)).not.toContain('samples');
	});

	test('supports optimistic revision updates and rejects invalid names', () => {
		expect(buildRoutingDraftPayload('Candidate', draft, 7).expected_revision).toBe(7);
		// Cases: blank / control / 128 Unicode code points / 129 / revision endpoints.
		for (const name of ['', ' \t', 'a\nb', 'a\u0000b', 'a\u007fb', 'x'.repeat(129)]) {
			expect(() => buildRoutingDraftPayload(name, draft)).toThrow(RoutingDraftError);
		}
		expect(buildRoutingDraftPayload('\u{1f600}'.repeat(128), draft).name).toHaveLength(256);
		for (const revision of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() => buildRoutingDraftPayload('Candidate', draft, revision)).toThrow(RoutingDraftError);
		}
		expect(routingDraftRevision(Number.MAX_SAFE_INTEGER - 1)).toBe(Number.MAX_SAFE_INTEGER - 1);
		expect(routingDraftRevision(1)).toBe(1);
	});

	test('parses canonical detail and paginated summary responses', () => {
		expect(parseRoutingDraft(detail, detail.id)).toEqual(detail);
		expect(parseRoutingDraftPage({ drafts: [summary], limit: 25, offset: 25 }, 25)).toEqual([summary]);
		expect(parseRoutingDraftPage({ drafts: [], limit: 25, offset: 0 }, 0)).toEqual([]);
		expect(parseRoutingDraft({ ...detail, rules: [] }).rules).toEqual([]);
		expect(parseRoutingDraft({ ...detail, revision: Number.MAX_SAFE_INTEGER }).revision).toBe(Number.MAX_SAFE_INTEGER);
	});

	test('rejects incomplete details, contradictory IDs, unsafe revisions and malformed summaries', () => {
		for (const payload of [
			null, [], {}, { ...detail, id: detail.id.toUpperCase() }, { ...detail, id: 'bad-id' },
			{ ...detail, name: '' }, { ...detail, revision: 0 }, { ...detail, revision: '1' },
			{ ...detail, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...detail, revision: 1.5 },
			{ ...detail, chain_max_depth: 0 }, { ...detail, chain_max_depth: 21 }, { ...detail, chain_max_depth: '10' },
			{ ...detail, created_at: null }, { ...detail, updated_at: 'invalid' },
			{ ...detail, rules: null }, summary, { ...detail, rules: [null] }, { ...detail, rules: Array(33).fill({}) },
		]) expect(() => parseRoutingDraft(payload)).toThrow(RoutingDraftError);
		expect(() => parseRoutingDraft(detail, '00000000-0000-0000-0000-000000000000')).toThrow(RoutingDraftError);
		for (const payload of [
			null, {}, { drafts: null, limit: 25, offset: 0 }, { drafts: [summary], limit: 1, offset: 0 },
			{ drafts: [summary], limit: 25, offset: 25 }, { drafts: [{ ...summary, revision: 0 }], limit: 25, offset: 0 },
			{ drafts: [summary, summary], limit: 25, offset: 0 }, { drafts: Array(26).fill(summary), limit: 25, offset: 0 },
		]) expect(() => parseRoutingDraftPage(payload, 0)).toThrow(RoutingDraftError);
	});

	test('validates rules and depth independently of simulation samples', () => {
		for (const rules of ['', 'null', '{}', '[null]', '[] []', JSON.stringify(Array(33).fill({}))]) {
			expect(() => buildRoutingDraftPayload('Candidate', { ...draft, rules })).toThrow(SimulationInputError);
		}
		for (const chainMaxDepth of [0, 21, 1.5, NaN]) {
			expect(() => buildRoutingDraftPayload('Candidate', { ...draft, chainMaxDepth })).toThrow(SimulationInputError);
		}
		expect(buildRoutingDraftPayload('Candidate', { rules: '[]', chainMaxDepth: 20 }).rules).toEqual([]);
	});

	test('counts the complete create and update payload as UTF-8 bytes', () => {
		for (const revision of [undefined, 7]) {
			const base = { rules: '[{"description":""}]', chainMaxDepth: 10 };
			const overhead = new TextEncoder().encode(JSON.stringify(buildRoutingDraftPayload('Candidate', base, revision))).length;
			const text = 'x'.repeat(128 * 1024 - overhead);
			const boundary = { ...base, rules: JSON.stringify([{ description: text }]) };
			expect(new TextEncoder().encode(JSON.stringify(buildRoutingDraftPayload('Candidate', boundary, revision))).length).toBe(128 * 1024);
			expect(() => buildRoutingDraftPayload('Candidate', { ...base, rules: JSON.stringify([{ description: text + 'x' }]) }, revision)).toThrow(SimulationInputError);
			expect(() => buildRoutingDraftPayload('Candidate', { ...base, rules: JSON.stringify([{ description: '\u754c'.repeat(45000) }]) }, revision)).toThrow(SimulationInputError);
		}
	});
});
