import { describe, expect, test } from 'bun:test';
import { compareVersions, isVersionNewer } from './version';

describe('version comparison', () => {
	test('compares stable semantic versions and v prefixes', () => {
		expect(compareVersions('v1.12.0', '1.11.9')).toBe(1);
		expect(compareVersions('1.4', '1.4.0')).toBe(0);
		expect(compareVersions('1.3.9', '1.4.0')).toBe(-1);
	});

	test('orders prereleases below stable releases', () => {
		expect(compareVersions('1.5.0', '1.5.0-rc.2')).toBe(1);
		expect(compareVersions('1.5.0-rc.10', '1.5.0-rc.2')).toBe(1);
		expect(compareVersions('1.5.0-beta', '1.5.0-rc')).toBe(-1);
	});

	test('does not advertise malformed versions as updates', () => {
		expect(isVersionNewer('latest', '1.0.0')).toBe(false);
		expect(isVersionNewer('1.1.0', 'development')).toBe(false);
	});
});
