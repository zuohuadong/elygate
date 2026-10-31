import { describe, expect, test } from 'bun:test';
import { parseRoutingReleaseHead, parseRoutingReleasePage, parseRoutingReleaseSnapshot, RoutingReleaseError } from './routing-releases';

const version = '11111111-1111-4111-8111-111111111111';
const attempt = '22222222-2222-4222-8222-222222222222';
const fingerprint = 'a'.repeat(64);

function release(application: unknown = null) {
	return {
		id: attempt, operation: 'publish', expected_epoch: 0, epoch: 1, version_id: version,
		fingerprint, created_at: '2026-10-31T00:00:00Z', application,
	};
}

describe('routing release read model', () => {
	test('parses epoch-zero, pending and applied head states without implying process readiness', () => {
		expect(parseRoutingReleaseHead({
			epoch: 0, state: 'pending', desired_version_id: '', desired_fingerprint: '',
			applied_version_id: '', applied_fingerprint: '',
		}).state).toBe('pending');
		expect(parseRoutingReleaseHead({
			epoch: 1, state: 'pending', desired_version_id: version, desired_fingerprint: fingerprint,
			applied_version_id: '', applied_fingerprint: '',
		}).desired_version_id).toBe(version);
		expect(parseRoutingReleaseHead({
			epoch: 1, state: 'applied', desired_version_id: version, desired_fingerprint: fingerprint,
			applied_version_id: version, applied_fingerprint: fingerprint,
		}).state).toBe('applied');
	});

	test('parses ordered acceptance and installation receipts', () => {
		const application = {
			attempt_id: attempt, epoch: 1, version_id: version, fingerprint,
			policy_fingerprint: 'b'.repeat(64), recorded_at: '2026-10-31T00:01:00Z',
		};
		expect(parseRoutingReleasePage({ releases: [release(application)], limit: 25, offset: 0 }, 0)[0].application?.epoch).toBe(1);
		expect(parseRoutingReleasePage({ releases: [release()], limit: 25, offset: 0 }, 0)[0].application).toBeNull();
	});

	test('rejects malformed state, duplicate IDs and out-of-order history', () => {
		expect(() => parseRoutingReleaseHead({ epoch: 1, state: 'pending', desired_version_id: version, desired_fingerprint: fingerprint, applied_version_id: version, applied_fingerprint: fingerprint })).toThrow(RoutingReleaseError);
		expect(() => parseRoutingReleasePage({ releases: [release(), release()], limit: 25, offset: 0 }, 0)).toThrow(RoutingReleaseError);
		expect(() => parseRoutingReleasePage({ releases: [{ ...release(), epoch: 2, expected_epoch: 1 }, release()], limit: 25, offset: 0 }, 0)).toThrow(RoutingReleaseError);
	});

	test('rejects mixed generations and unproven installation in a snapshot', () => {
		const head = {
			epoch: 1, state: 'pending', desired_version_id: version, desired_fingerprint: fingerprint,
			applied_version_id: '', applied_fingerprint: '',
		};
		const page = { head, releases: [release()], limit: 25, offset: 0 };
		expect(parseRoutingReleaseSnapshot(page, 0).head.epoch).toBe(1);
		expect(() => parseRoutingReleaseSnapshot({ ...page, releases: [] }, 0)).toThrow(RoutingReleaseError);
		expect(() => parseRoutingReleaseSnapshot({ ...page, releases: [{ ...release(), epoch: 2, expected_epoch: 1 }] }, 0)).toThrow(RoutingReleaseError);
		expect(() => parseRoutingReleaseSnapshot({ ...page, head: { ...head, state: 'applied', applied_version_id: version, applied_fingerprint: fingerprint } }, 0)).toThrow(RoutingReleaseError);
		expect(() => parseRoutingReleaseSnapshot({ ...page, head: { ...head, epoch: Number.MAX_SAFE_INTEGER + 1 } }, 0)).toThrow(RoutingReleaseError);
	});

	test('rejects invalid application identities and rollback provenance', () => {
		const application = { attempt_id: version, epoch: 1, version_id: version, fingerprint, policy_fingerprint: fingerprint, recorded_at: '2026-10-31T00:01:00Z' };
		expect(() => parseRoutingReleasePage({ releases: [release(application)], limit: 25, offset: 0 }, 0)).toThrow(RoutingReleaseError);
		expect(() => parseRoutingReleasePage({ releases: [{ ...release(), operation: 'rollback', rollback_of_epoch: 1, rollback_of_attempt_id: attempt }], limit: 25, offset: 0 }, 0)).toThrow(RoutingReleaseError);
	});
});
