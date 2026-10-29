import { isJsonRecord, type JsonRecord } from './api';

export interface SimulationDraft {
	rules: string;
	samples: string;
	chainMaxDepth: number;
}

export interface SimulationPayload {
	rules: JsonRecord[];
	samples: JsonRecord[];
	chain_max_depth: number;
}

export interface SimulationDecision {
	provider: string;
	model: string;
	key_id: string;
	rule_id: string;
	rule_name: string;
	fallbacks: unknown[] | null;
	ttft_timeout_ms: number;
}

export interface SimulationResult {
	name: string;
	matched: boolean;
	decision: SimulationDecision | null;
	error?: string;
	logs: JsonRecord[];
}

export interface SimulationResponse {
	mode: 'offline';
	selection: 'weighted_sample';
	results: SimulationResult[];
}

export type SimulationErrorCode = 'invalid-json' | 'objects' | 'rule-count' | 'sample-count' | 'depth' | 'size' | 'incomplete-import' | 'invalid-response';
export type SimulationField = 'rules' | 'samples' | 'depth' | 'request' | 'response';

export class SimulationInputError extends Error {
	constructor(public readonly code: SimulationErrorCode, public readonly field: SimulationField) {
		super(code);
		this.name = 'SimulationInputError';
	}
}

export function emptySimulationDraft(): SimulationDraft {
	return {
		rules: '[]',
		samples: JSON.stringify([{
			name: 'sample-1', provider: '', model: '', request_type: 'chat_completion',
			scope: {}, headers: {}, params: {}, metadata: {}, usage: [],
		}], null, 2),
		chainMaxDepth: 10,
	};
}

function simulationArray(source: string, field: 'rules' | 'samples'): JsonRecord[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (cause) {
		if (cause instanceof SyntaxError) throw new SimulationInputError('invalid-json', field);
		throw cause;
	}
	if (!Array.isArray(parsed) || parsed.some((entry) => !isJsonRecord(entry))) {
		throw new SimulationInputError('objects', field);
	}
	return parsed;
}

export function buildSimulationPayload(draft: SimulationDraft): SimulationPayload {
	const rules = simulationArray(draft.rules, 'rules');
	const samples = simulationArray(draft.samples, 'samples');
	if (rules.length > 32) throw new SimulationInputError('rule-count', 'rules');
	if (samples.length < 1 || samples.length > 16) throw new SimulationInputError('sample-count', 'samples');
	if (!Number.isInteger(draft.chainMaxDepth) || draft.chainMaxDepth < 1 || draft.chainMaxDepth > 20) {
		throw new SimulationInputError('depth', 'depth');
	}
	const payload = { rules, samples, chain_max_depth: draft.chainMaxDepth };
	if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 128 * 1024) {
		throw new SimulationInputError('size', 'request');
	}
	return payload;
}

const ruleFields = ['id', 'name', 'description', 'enabled', 'chain_rule', 'cel_expression', 'fallbacks', 'scope', 'scope_id', 'query', 'priority'];
const targetFields = ['provider', 'model', 'key_id', 'weight', 'ttft_timeout_ms'];

function pickFields(record: JsonRecord, fields: string[]): JsonRecord {
	return Object.fromEntries(fields.filter((field) => Object.hasOwn(record, field)).map((field) => [field, record[field]]));
}

export function importSimulationRules(payload: unknown): JsonRecord[] {
	if (!isJsonRecord(payload) || !Array.isArray(payload.rules) || !payload.rules.every(isJsonRecord) ||
		!Number.isSafeInteger(payload.total_count) || payload.total_count !== payload.rules.length) {
		throw new SimulationInputError('incomplete-import', 'rules');
	}
	if (payload.rules.length > 32) throw new SimulationInputError('rule-count', 'rules');
	return payload.rules.map((rule) => {
		if (!Array.isArray(rule.targets) || !rule.targets.every(isJsonRecord)) {
			throw new SimulationInputError('incomplete-import', 'rules');
		}
		return { ...pickFields(rule, ruleFields), targets: rule.targets.map((target) => pickFields(target, targetFields)) };
	});
}

function validDecision(decision: unknown): decision is SimulationDecision {
	if (!isJsonRecord(decision)) return false;
	return ['provider', 'model', 'key_id', 'rule_id', 'rule_name'].every((field) => typeof decision[field] === 'string') &&
		typeof decision.ttft_timeout_ms === 'number' && Number.isFinite(decision.ttft_timeout_ms) &&
		(decision.fallbacks === null || Array.isArray(decision.fallbacks));
}

function validResult(result: unknown): result is SimulationResult {
	if (!isJsonRecord(result) || typeof result.name !== 'string' || typeof result.matched !== 'boolean' ||
		!Array.isArray(result.logs) || !result.logs.every(isJsonRecord) ||
		(result.error !== undefined && typeof result.error !== 'string')) return false;
	if (result.error) return !result.matched && result.decision === null;
	return result.matched ? validDecision(result.decision) : result.decision === null;
}

export function parseSimulationResponse(payload: unknown, samples: JsonRecord[]): SimulationResponse {
	if (!isJsonRecord(payload) || payload.mode !== 'offline' || payload.selection !== 'weighted_sample' ||
		!Array.isArray(payload.results) || payload.results.length !== samples.length ||
		!payload.results.every(validResult) ||
		payload.results.some((result, index) => result.name !== (samples[index].name ?? ''))) {
		throw new SimulationInputError('invalid-response', 'response');
	}
	return { mode: 'offline', selection: 'weighted_sample', results: payload.results };
}
