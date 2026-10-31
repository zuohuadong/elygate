import { isJsonRecord } from './api';

export const ROUTING_RELEASE_PATH = '/api/control-plane/routing/releases';
export const ROUTING_RELEASE_PAGE_SIZE = 25;

export interface RoutingReleaseHead {
	epoch: number;
	state: 'pending' | 'applied';
	desired_version_id: string;
	desired_fingerprint: string;
	applied_version_id: string;
	applied_fingerprint: string;
}

export interface RoutingReleaseApplication {
	attempt_id: string;
	epoch: number;
	version_id: string;
	fingerprint: string;
	policy_fingerprint: string;
	recorded_at: string;
}

export interface RoutingRelease {
	id: string;
	operation: 'publish' | 'rollback';
	expected_epoch: number;
	epoch: number;
	version_id: string;
	fingerprint: string;
	rollback_of_epoch?: number;
	rollback_of_attempt_id?: string;
	created_at: string;
	application: RoutingReleaseApplication | null;
}

export class RoutingReleaseError extends Error {
	public constructor() { super('Invalid routing release response'); this.name = 'RoutingReleaseError'; }
}

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const epoch = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function parseRoutingReleaseHead(payload: unknown): RoutingReleaseHead {
	if (!isJsonRecord(payload) || !epoch(payload.epoch) || !['pending', 'applied'].includes(String(payload.state))) throw new RoutingReleaseError();
	const managed = payload.epoch > 0;
	if (managed ? !uuid(payload.desired_version_id) || !hash(payload.desired_fingerprint)
		: payload.desired_version_id !== '' || payload.desired_fingerprint !== '' || payload.state !== 'pending') throw new RoutingReleaseError();
	if (payload.state === 'applied'
		? !managed || payload.applied_version_id !== payload.desired_version_id || payload.applied_fingerprint !== payload.desired_fingerprint
		: payload.applied_version_id !== '' || payload.applied_fingerprint !== '') throw new RoutingReleaseError();
	return {
		epoch: payload.epoch, state: payload.state as RoutingReleaseHead['state'],
		desired_version_id: payload.desired_version_id as string, desired_fingerprint: payload.desired_fingerprint as string,
		applied_version_id: payload.applied_version_id as string, applied_fingerprint: payload.applied_fingerprint as string,
	};
}

function parseApplication(payload: unknown, release: Omit<RoutingRelease, 'application'>): RoutingReleaseApplication | null {
	if (payload === null) return null;
	if (!isJsonRecord(payload) || payload.attempt_id !== release.id || payload.epoch !== release.epoch ||
		payload.version_id !== release.version_id || payload.fingerprint !== release.fingerprint ||
		!hash(payload.policy_fingerprint) || !timestamp(payload.recorded_at)) throw new RoutingReleaseError();
	return {
		attempt_id: release.id, epoch: release.epoch, version_id: release.version_id, fingerprint: release.fingerprint,
		policy_fingerprint: payload.policy_fingerprint, recorded_at: payload.recorded_at,
	};
}

function parseRelease(payload: unknown): RoutingRelease {
	if (!isJsonRecord(payload) || !uuid(payload.id) || !uuid(payload.version_id) || !hash(payload.fingerprint) ||
		!epoch(payload.expected_epoch) || !epoch(payload.epoch) || payload.epoch !== payload.expected_epoch + 1 ||
		!timestamp(payload.created_at) || !['publish', 'rollback'].includes(String(payload.operation))) throw new RoutingReleaseError();
	if (payload.operation === 'rollback'
		? !epoch(payload.rollback_of_epoch) || payload.rollback_of_epoch < 1 || payload.rollback_of_epoch >= payload.expected_epoch || !uuid(payload.rollback_of_attempt_id)
		: (payload.rollback_of_epoch !== undefined && payload.rollback_of_epoch !== 0) || (payload.rollback_of_attempt_id !== undefined && payload.rollback_of_attempt_id !== '')) throw new RoutingReleaseError();
	const release: Omit<RoutingRelease, 'application'> = {
		id: payload.id, version_id: payload.version_id, fingerprint: payload.fingerprint,
		expected_epoch: payload.expected_epoch, epoch: payload.epoch, created_at: payload.created_at,
		operation: payload.operation as RoutingRelease['operation'],
		...(payload.operation === 'rollback' ? { rollback_of_epoch: Number(payload.rollback_of_epoch), rollback_of_attempt_id: String(payload.rollback_of_attempt_id) } : {}),
	};
	return { ...release, application: parseApplication(payload.application, release) };
}

export function parseRoutingReleasePage(payload: unknown, offset: number): RoutingRelease[] {
	if (!isJsonRecord(payload) || !Array.isArray(payload.releases) || payload.limit !== ROUTING_RELEASE_PAGE_SIZE ||
		payload.offset !== offset || payload.releases.length > ROUTING_RELEASE_PAGE_SIZE) throw new RoutingReleaseError();
	const releases = payload.releases.map(parseRelease);
	if (new Set(releases.map(release => release.id)).size !== releases.length ||
		releases.some((release, index) => index > 0 && release.epoch >= releases[index - 1].epoch)) throw new RoutingReleaseError();
	return releases;
}

export function parseRoutingReleaseSnapshot(payload: unknown, offset: number): { head: RoutingReleaseHead; releases: RoutingRelease[] } {
	if (!isJsonRecord(payload)) throw new RoutingReleaseError();
	const head = parseRoutingReleaseHead(payload.head);
	const releases = parseRoutingReleasePage(payload, offset);
	if (releases.some(release => release.epoch > head.epoch) ||
		(offset === 0 && (head.epoch === 0 ? releases.length !== 0 : releases[0]?.epoch !== head.epoch))) throw new RoutingReleaseError();
	const current = releases.find(release => release.epoch === head.epoch);
	if (current && (current.version_id !== head.desired_version_id || current.fingerprint !== head.desired_fingerprint ||
		Boolean(current.application) !== (head.state === 'applied'))) throw new RoutingReleaseError();
	return { head, releases };
}
