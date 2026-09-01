import { describe, expect, test } from 'bun:test';
import { enterpriseFeatureDefinition } from './enterprise-feature';

describe('enterprise feature placeholders', () => {
	test('uses feature-specific system copy instead of generic enterprise links', () => {
		const cluster = enterpriseFeatureDefinition('cluster', 'elygate.cluster');
		expect(cluster.sectionKey).toBe('elygate.system');
		expect(cluster.hintKey).toBe('elygate.clusterUnavailableHint');
		expect(cluster.links).toEqual([]);

		const routing = enterpriseFeatureDefinition('adaptive-routing', 'elygate.adaptiveRouting');
		expect(routing.links).toEqual([{ href: '#/routing-rules', labelKey: 'elygate.routingRules' }]);
	});

	test('keeps enterprise links for enterprise-only resources', () => {
		const users = enterpriseFeatureDefinition('users', 'elygate.users');
		expect(users.sectionKey).toBe('elygate.enterprise');
		expect(users.links.length).toBeGreaterThan(0);
	});
});
