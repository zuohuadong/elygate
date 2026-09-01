import { describe, expect, test } from 'bun:test';
import {
	isVisibleEnterpriseResource,
	pluginFeatureResourcePages,
	visibleEnterpriseResources,
} from './menu-policy';

const expectedEnterpriseResources = [
	'users', 'business-units', 'rbac', 'scim', 'access-profiles', 'audit-logs',
	'alerting-channels', 'alerting-rules', 'alerting-history', 'guardrails-config',
	'guardrails-providers', 'edge-devices', 'edge-inventory', 'edge-config',
	'mcp-tool-groups', 'mcp-auth-config', 'api-keys', 'license-info',
	'cluster', 'circuit-breaker', 'agent-handover',
] as const;

(globalThis as Record<string, unknown>).$state = <Value>(value: Value): Value => value;
const fallback = await import('../enterprise-fallback/index');
const enterpriseResourceNames = fallback.enterprisePanelManifest.resources.map((resource) => resource.name);

describe('enterprise menu policy', () => {
	test('only exposes enterprise surfaces backed by current capabilities', () => {
		expect([...enterpriseResourceNames].sort()).toEqual([...expectedEnterpriseResources].sort());
		expect(visibleEnterpriseResources([], enterpriseResourceNames)).toEqual([]);
		expect(visibleEnterpriseResources(['guardrails-config', 'circuit-breaker', 'unknown'], enterpriseResourceNames)).toEqual([
			'guardrails-config',
			'circuit-breaker',
		]);
		expect(isVisibleEnterpriseResource('guardrails-config', ['guardrails-config'], enterpriseResourceNames)).toBe(true);
		expect(isVisibleEnterpriseResource('guardrails-config', [], enterpriseResourceNames)).toBe(false);
		expect(isVisibleEnterpriseResource('teams', enterpriseResourceNames, enterpriseResourceNames)).toBe(false);
		expect(isVisibleEnterpriseResource('customers', enterpriseResourceNames, enterpriseResourceNames)).toBe(false);
		expect(isVisibleEnterpriseResource('adaptive-routing', enterpriseResourceNames, enterpriseResourceNames)).toBe(false);
	});

	test('runtime plugin metadata maps enterprise features to scoped plugin pages', () => {
		const pluginPage = Symbol('plugin-page');
		expect(pluginFeatureResourcePages([
			'users',
			'rbac',
			'guardrails-config',
			'adaptive-routing',
			'unknown',
		], enterpriseResourceNames, pluginPage)).toEqual({
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
		expect(fallback.enterprisePanelManifest.resourcePages).toEqual({});
		expect(fallback.enterprisePanelManifest.resources.map((resource) => resource.name).sort()).toEqual(
			[...expectedEnterpriseResources].sort(),
		);
	});
});
