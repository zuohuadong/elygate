import { describe, expect, test } from 'bun:test';
import {
	isVisibleEnterpriseResource,
	pluginFeatureResourcePages,
	visibleEnterpriseResources,
	VISIBLE_ENTERPRISE_RESOURCES,
} from './menu-policy';

const expectedEnterpriseResources = [
	'users', 'business-units', 'rbac', 'scim', 'access-profiles', 'audit-logs',
	'alerting-channels', 'alerting-rules', 'alerting-history', 'guardrails-config',
	'guardrails-providers', 'edge-devices', 'edge-inventory', 'edge-config',
	'mcp-tool-groups', 'mcp-auth-config', 'api-keys', 'license-info',
	'cluster', 'circuit-breaker', 'agent-handover',
] as const;

describe('enterprise menu policy', () => {
	test('only exposes enterprise surfaces backed by current capabilities', () => {
		expect([...VISIBLE_ENTERPRISE_RESOURCES].sort()).toEqual([...expectedEnterpriseResources].sort());
		expect(visibleEnterpriseResources([])).toEqual([]);
		expect(visibleEnterpriseResources(['guardrails-config', 'circuit-breaker', 'unknown'])).toEqual([
			'guardrails-config',
			'circuit-breaker',
		]);
		expect(isVisibleEnterpriseResource('guardrails-config', ['guardrails-config'])).toBe(true);
		expect(isVisibleEnterpriseResource('guardrails-config', [])).toBe(false);
		expect(isVisibleEnterpriseResource('teams')).toBe(false);
		expect(isVisibleEnterpriseResource('customers')).toBe(false);
		expect(isVisibleEnterpriseResource('adaptive-routing')).toBe(false);
	});

	test('runtime plugin metadata maps enterprise features to scoped plugin pages', () => {
		const pluginPage = Symbol('plugin-page');
		expect(pluginFeatureResourcePages([
			'users',
			'rbac',
			'guardrails-config',
			'adaptive-routing',
			'unknown',
		], pluginPage)).toEqual({
			users: { list: pluginPage },
			rbac: { list: pluginPage },
			'guardrails-config': { list: pluginPage },
		});
	});

	test('ships a non-claiming OSS enterprise fallback contract', async () => {
		const fallback = await import('../enterprise-fallback/index');
		expect(fallback.enterprisePanelAvailable).toBe(false);
		expect(fallback.enterpriseResourcePages).toEqual({});
		expect(fallback.enterprisePublicPages).toEqual({});
	});
});
