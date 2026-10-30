import { isJsonRecord, type JsonRecord } from './api';
import { buildCandidateRules, SimulationInputError, type SimulationDraft } from './routing-simulation';

export const ROUTING_DRAFT_PATH = '/api/control-plane/routing/drafts';
export const ROUTING_DRAFT_PAGE_SIZE = 25;

export interface RoutingDraftSummary {
	id: string;
	name: string;
	revision: number;
	chain_max_depth: number;
	created_at: string;
	updated_at: string;
}

export interface RoutingDraft extends RoutingDraftSummary {
	rules: JsonRecord[];
}

export interface RoutingDraftRecovery {
	draft: SimulationDraft;
	selectedDraft: RoutingDraft | null;
	name: string;
	dirty: boolean;
	uncertain: boolean;
}

// 仅在当前页面进程中保留编辑，避免站内路由重建组件时丢失，不写入浏览器持久存储。
export const routingDraftRecovery: { epoch: number; current: RoutingDraftRecovery | null } = { epoch: 0, current: null };

export function clearRoutingDraftRecovery(): void {
	routingDraftRecovery.epoch += 1;
	routingDraftRecovery.current = null;
}

export class RoutingDraftError extends Error {
	constructor(public readonly code: 'name' | 'revision' | 'response') {
		super(code);
		this.name = 'RoutingDraftError';
	}
}

function validName(name: unknown): name is string {
	return typeof name === 'string' && name.trim().length > 0 &&
		Array.from(name.trim()).length <= 128 && !/\p{Cc}/u.test(name.trim());
}

export function routingDraftRevision(revision: number): number {
	if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER) {
		throw new RoutingDraftError('revision');
	}
	return revision;
}

export function buildRoutingDraftPayload(name: string, draft: Pick<SimulationDraft, 'rules' | 'chainMaxDepth'>, revision?: number) {
	if (!validName(name)) throw new RoutingDraftError('name');
	const payload = {
		name: name.trim(), ...buildCandidateRules(draft),
		...(revision === undefined ? {} : { expected_revision: routingDraftRevision(revision) }),
	};
	if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 128 * 1024) {
		throw new SimulationInputError('size', 'request');
	}
	return payload;
}

function parseSummary(payload: unknown): RoutingDraftSummary {
	if (!isJsonRecord(payload) || typeof payload.id !== 'string' ||
		!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(payload.id) ||
		!validName(payload.name) || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1 ||
		!Number.isInteger(payload.chain_max_depth) || Number(payload.chain_max_depth) < 1 || Number(payload.chain_max_depth) > 20 ||
		![payload.created_at, payload.updated_at].every((time) => typeof time === 'string' && Number.isFinite(Date.parse(time)))) {
		throw new RoutingDraftError('response');
	}
	return { id: payload.id, name: payload.name, revision: Number(payload.revision),
		chain_max_depth: Number(payload.chain_max_depth), created_at: String(payload.created_at), updated_at: String(payload.updated_at) };
}

export function parseRoutingDraft(payload: unknown, expectedId?: string): RoutingDraft {
	const summary = parseSummary(payload);
	if (!isJsonRecord(payload) || !Array.isArray(payload.rules) || payload.rules.length > 32 ||
		!payload.rules.every(isJsonRecord) || (expectedId !== undefined && summary.id !== expectedId)) {
		throw new RoutingDraftError('response');
	}
	return { ...summary, rules: payload.rules };
}

export function parseRoutingDraftPage(payload: unknown, offset: number): RoutingDraftSummary[] {
	if (!isJsonRecord(payload) || !Array.isArray(payload.drafts) || payload.limit !== ROUTING_DRAFT_PAGE_SIZE ||
		payload.offset !== offset || payload.drafts.length > ROUTING_DRAFT_PAGE_SIZE) {
		throw new RoutingDraftError('response');
	}
	const drafts = payload.drafts.map(parseSummary);
	if (new Set(drafts.map((draft) => draft.id)).size !== drafts.length) throw new RoutingDraftError('response');
	return drafts;
}
