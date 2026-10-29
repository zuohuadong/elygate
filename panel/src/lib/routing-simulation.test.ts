import { describe, expect, test } from 'bun:test';
import { buildSimulationPayload, emptySimulationDraft, importSimulationRules, parseSimulationResponse, SimulationInputError, type SimulationErrorCode, type SimulationField } from './routing-simulation';
import type { JsonRecord } from './api';

function expectInputError(run: () => unknown, code: SimulationErrorCode, field: SimulationField): void {
	expect(run).toThrow(SimulationInputError);
	try { run(); }
	catch (cause) {
		expect(cause).toMatchObject({ code, field });
	}
}

describe('routing simulation helpers', () => {
	test('builds bounded request payloads from editable JSON', () => {
		const rules = [{ id: 'rule-1', name: 'Route', targets: [{ provider: 'openai', model: 'gpt-4o', weight: 1 }] }];
		const draft = emptySimulationDraft();
		draft.rules = JSON.stringify(rules);
		draft.samples = JSON.stringify([{
			name: 'sample-1', provider: 'openai', model: 'gpt-4o', request_type: 'chat_completion',
			usage: [{ provider: 'openai', model: 'gpt-4o', status: null }],
		}]);
		const payload = buildSimulationPayload(draft);

		expect(payload.rules).toEqual(rules);
		expect(payload.samples).toHaveLength(1);
		expect(payload.chain_max_depth).toBe(10);
	});

	test('imports only the complete canonical rule payload', () => {
		const rules = importSimulationRules({
			rules: [{ id: 'rule-1', name: 'Route', created_at: 'ignored', targets: [{ provider: 'openai', model: 'gpt-4o', weight: 1, rule_id: 'ignored' }] }],
			total_count: 1,
		});
		expect(rules).toEqual([{ id: 'rule-1', name: 'Route', targets: [{ provider: 'openai', model: 'gpt-4o', weight: 1 }] }]);
		expectInputError(() => importSimulationRules({ rules: [], total_count: 2 }), 'incomplete-import', 'rules');
	});

	test('starts without invented model, identity, or usage limits', () => {
		const sample = JSON.parse(emptySimulationDraft().samples)[0];
		expect(sample.model).toBe('');
		expect(sample.provider).toBe('');
		expect(sample.usage).toEqual([]);
		expect(sample.scope).toEqual({});
	});

	test('preserves fallback key pins, scope, disabled rules, chain and TTFT on import', () => {
		const rule = {
			id: 'team-rule', name: 'Team routing', enabled: false, chain_rule: true, scope: 'team', scope_id: 'team-1', priority: 4,
			cel_expression: 'budget_used > 80.0', query: { any: true },
			targets: [{ provider: 'openai', model: 'target', key_id: 'pinned', ttft_timeout_ms: 3000, weight: 1 }],
			fallbacks: [{ provider: 'azure', model: 'backup', key_id: 'fallback-pin' }],
		};
		expect(importSimulationRules({ rules: [rule], total_count: 1 })).toEqual([rule]);
		expect(importSimulationRules({ rules: [], total_count: 0 })).toEqual([]);
	});

	test('rejects malformed, missing, truncated, or oversized imports', () => {
		for (const payload of [null, [], {}, { rules: [null], total_count: 1 }, { rules: [], total_count: '0' },
			{ rules: [], total_count: 1 }, { rules: [{}], total_count: 1 }]) {
			expectInputError(() => importSimulationRules(payload), 'incomplete-import', 'rules');
		}
		expectInputError(() => importSimulationRules({ rules: Array.from({ length: 33 }, () => ({ targets: [] })), total_count: 33 }), 'rule-count', 'rules');
	});

	test('rejects malformed arrays without silently filtering entries', () => {
		for (const source of ['null', '{}', '[1]', '[null]', '[{},"ignored"]']) {
			expectInputError(() => buildSimulationPayload({ rules: source, samples: '[{}]', chainMaxDepth: 10 }), 'objects', 'rules');
			expectInputError(() => buildSimulationPayload({ rules: '[]', samples: source, chainMaxDepth: 10 }), 'objects', 'samples');
		}
		expectInputError(() => buildSimulationPayload({ rules: '{', samples: '[{}]', chainMaxDepth: 10 }), 'invalid-json', 'rules');
		expectInputError(() => buildSimulationPayload({ rules: '[]', samples: '', chainMaxDepth: 10 }), 'invalid-json', 'samples');
	});

	test('checks quantity and integer-depth boundaries', () => {
		const draft = { rules: '[]', samples: '[{}]', chainMaxDepth: 1 };
		expect(buildSimulationPayload(draft).rules).toEqual([]);
		expect(buildSimulationPayload({ ...draft, rules: JSON.stringify(Array(32).fill({})), samples: JSON.stringify(Array(16).fill({})), chainMaxDepth: 20 }).samples).toHaveLength(16);
		expectInputError(() => buildSimulationPayload({ ...draft, rules: JSON.stringify(Array(33).fill({})) }), 'rule-count', 'rules');
		for (const samples of ['[]', JSON.stringify(Array(17).fill({}))]) {
			expectInputError(() => buildSimulationPayload({ ...draft, samples }), 'sample-count', 'samples');
		}
		for (const depth of [0, -1, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expectInputError(() => buildSimulationPayload({ ...draft, chainMaxDepth: depth }), 'depth', 'depth');
		}
	});

	test('measures request size as serialized UTF-8 bytes', () => {
		const draft = { rules: '[]', samples: '[{}]', chainMaxDepth: 10 };
		const overhead = new TextEncoder().encode(JSON.stringify(buildSimulationPayload(draft))).byteLength;
		const sampleOverhead = JSON.stringify({ text: '' }).length - 2;
		const text = 'a'.repeat(128 * 1024 - overhead - sampleOverhead);
		const boundary = { ...draft, samples: JSON.stringify([{ text }]) };
		expect(new TextEncoder().encode(JSON.stringify(buildSimulationPayload(boundary))).byteLength).toBe(128 * 1024);
		expectInputError(() => buildSimulationPayload({ ...draft, samples: JSON.stringify([{ text: `${text}a` }]) }), 'size', 'request');
		expectInputError(() => buildSimulationPayload({ ...draft, samples: JSON.stringify([{ text: '中'.repeat(45000) }]) }), 'size', 'request');
	});
});

describe('routing simulation response contract', () => {
	const samples: JsonRecord[] = [{ name: 'duplicate' }, { name: 'duplicate' }, {}];
	const decision = { provider: 'openai', model: 'target', key_id: 'key', rule_id: 'rule-1', rule_name: 'Route', ttft_timeout_ms: 2500, fallbacks: [{ provider: 'azure', model: 'backup', key_id: 'pin' }] };
	const payload = {
		mode: 'offline', selection: 'weighted_sample',
		results: [
			{ name: 'duplicate', matched: true, decision, logs: [{ level: 'info', message: 'matched' }] },
			{ name: 'duplicate', matched: false, decision: null, error: 'missing usage snapshot', logs: [] },
			{ name: '', matched: false, decision: null, logs: [] },
		],
	};

	test('keeps duplicate sample names, no-match, failed sample and full decisions distinct', () => {
		expect(parseSimulationResponse(payload, samples)).toEqual(payload);
	});

	test('rejects missing, contradictory, reordered and malformed results', () => {
		for (const invalid of [
			null, {}, { ...payload, mode: 'online' }, { ...payload, selection: 'deterministic' },
			{ ...payload, results: [] }, { ...payload, results: [null, ...payload.results.slice(1)] },
			{ ...payload, results: [{ ...payload.results[0], name: 'wrong' }, ...payload.results.slice(1)] },
			{ ...payload, results: [{ ...payload.results[0], decision: null }, ...payload.results.slice(1)] },
			{ ...payload, results: [{ ...payload.results[0], error: 'failed' }, ...payload.results.slice(1)] },
			{ ...payload, results: [{ ...payload.results[0], logs: [null] }, ...payload.results.slice(1)] },
		]) expectInputError(() => parseSimulationResponse(invalid, samples), 'invalid-response', 'response');
	});
});
