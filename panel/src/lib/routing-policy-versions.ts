import { isJsonRecord, type JsonRecord } from './api';
import { routingDraftRevision, RoutingDraftError } from './routing-drafts';

export const ROUTING_VERSION_PATH = '/api/control-plane/routing/versions';
export const ROUTING_VERSION_PAGE_SIZE = 25;

export interface RoutingPolicyVersionSummary {
	id: string;
	draft_id: string;
	draft_revision: number;
	name: string;
	chain_max_depth: number;
	content_sha256: string;
	created_at: string;
}

export interface RoutingPolicyVersion extends RoutingPolicyVersionSummary {
	rules: JsonRecord[];
}

export class RoutingVersionError extends Error {
	public constructor(public readonly code: 'revision' | 'response') {
		super(code);
		this.name = 'RoutingVersionError';
	}
}

export function buildRoutingVersionPayload(revision: number): { expected_revision: number } {
	try {
		return { expected_revision: routingDraftRevision(revision) };
	} catch (cause) {
		if (cause instanceof RoutingDraftError) throw new RoutingVersionError('revision');
		throw cause;
	}
}

function canonicalUUID(value: unknown): value is string {
	return typeof value === 'string' &&
		/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}

function validVersionName(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0 &&
		Array.from(value.trim()).length <= 128 && !/\p{Cc}/u.test(value.trim());
}

function parseVersionSummary(payload: unknown): RoutingPolicyVersionSummary {
	if (!isJsonRecord(payload) || !canonicalUUID(payload.id) || !canonicalUUID(payload.draft_id) ||
		!Number.isSafeInteger(payload.draft_revision) || Number(payload.draft_revision) < 1 ||
		Number(payload.draft_revision) >= Number.MAX_SAFE_INTEGER || !validVersionName(payload.name) ||
		!Number.isInteger(payload.chain_max_depth) || Number(payload.chain_max_depth) < 1 ||
		Number(payload.chain_max_depth) > 20 || typeof payload.content_sha256 !== 'string' ||
		!/^[0-9a-f]{64}$/.test(payload.content_sha256) ||
		typeof payload.created_at !== 'string' || !Number.isFinite(Date.parse(payload.created_at))) {
		throw new RoutingVersionError('response');
	}
	return {
		id: payload.id,
		draft_id: payload.draft_id,
		draft_revision: Number(payload.draft_revision),
		name: payload.name,
		chain_max_depth: Number(payload.chain_max_depth),
		content_sha256: payload.content_sha256,
		created_at: payload.created_at,
	};
}

export function parseRoutingPolicyVersion(payload: unknown, expectedId?: string): RoutingPolicyVersion {
	const summary = parseVersionSummary(payload);
	if (!isJsonRecord(payload) || !Array.isArray(payload.rules) || payload.rules.length > 32 ||
		!payload.rules.every(isJsonRecord) || (expectedId !== undefined && summary.id !== expectedId)) {
		throw new RoutingVersionError('response');
	}
	return { ...summary, rules: payload.rules };
}

export function parseRoutingPolicyVersionPage(payload: unknown, offset: number): RoutingPolicyVersionSummary[] {
	if (!isJsonRecord(payload) || !Array.isArray(payload.versions) ||
		payload.limit !== ROUTING_VERSION_PAGE_SIZE || payload.offset !== offset ||
		payload.versions.length > ROUTING_VERSION_PAGE_SIZE) {
		throw new RoutingVersionError('response');
	}
	const versions = payload.versions.map(parseVersionSummary);
	if (new Set(versions.map((version) => version.id)).size !== versions.length) {
		throw new RoutingVersionError('response');
	}
	return versions;
}
