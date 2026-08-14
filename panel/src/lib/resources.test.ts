import { describe, expect, test } from 'bun:test';
import type { MenuItem } from '@svadmin/core';

(globalThis as Record<string, unknown>).$state = <Value>(value: Value): Value => value;
const { createMenu, createResources } = await import('./resources');
const { enterprisePanelManifest } = await import('../enterprise-fallback/index');
const enterpriseResources = enterprisePanelManifest.resources;
const enterpriseResourceNames = enterpriseResources.map((resource) => resource.name);

function leafResourceNames(items: MenuItem[]): string[] {
	return items.flatMap((item) => item.children?.length ? leafResourceNames(item.children) : item.href === '#/' ? [] : [item.name]);
}

function leafItems(items: MenuItem[]): MenuItem[] {
	return items.flatMap((item) => item.children?.length ? leafItems(item.children) : item.href === '#/' ? [] : [item]);
}

const requiredParityResources = [
	'providers',
	'provider-keys',
	'virtual-keys',
	'models',
	'model-catalog',
	'logs',
	'teams',
	'customers',
	'mcp-logs',
	'routing-rules',
	'model-configs',
	'provider-governance',
	'pricing-overrides',
	'budgets',
	'rate-limits',
	'webhooks',
	'mcp-clients',
	'mcp-library',
	'mcp-sessions',
	'oauth-grants',
	'mcp-tool-groups',
	'mcp-settings',
	'mcp-auth-config',
	'mcp-usage-guide',
	'plugins',
	'skills',
	'prompt-folders',
	'prompts',
	'user-agent-mappings',
	'connectors',
	'config',
	'client-settings',
	'compatibility-config',
	'feature-flags',
	'caching-config',
	'security-config',
	'api-keys',
	'performance-config',
	'logging-config',
	'complexity-analyzer',
	'complexity-router',
	'proxy-config',
	'pricing-config',
	'observability-config',
	'large-payload-config',
	'mcp-gateway-config',
	'license-info',
	'users',
	'business-units',
	'rbac',
	'scim',
	'access-profiles',
	'audit-logs',
	'alerting-channels',
	'alerting-rules',
	'alerting-history',
	'guardrails-config',
	'guardrails-providers',
	'edge-devices',
	'edge-inventory',
	'edge-config',
	'cluster',
	'circuit-breaker',
	'adaptive-routing',
	'agent-handover',
	'docs-hub',
	'pprof',
] as const;

describe('panel resource registry', () => {
	test('registers every parity-critical resource exactly once', () => {
		const names = createResources('zh-CN', true, enterpriseResources).map((resource) => resource.name);
		expect(new Set(names).size).toBe(names.length);
		for (const required of requiredParityResources) expect(names).toContain(required);
	});

	test('exposes canonical workflows while retaining hidden compatibility routes', () => {
		const resourceNames = createResources('en', true, enterpriseResources).map((resource) => resource.name).sort();
		const menuNames = leafResourceNames(createMenu('en', enterpriseResourceNames, true, enterpriseResources)).sort();
		const hiddenCompatibilityRoutes = ['adaptive-routing', 'budgets', 'complexity-analyzer', 'prompt-folders', 'rate-limits'];
		expect(new Set(menuNames).size).toBe(menuNames.length);
		expect(menuNames).toEqual(resourceNames.filter((name) => !hiddenCompatibilityRoutes.includes(name)));
		expect(resourceNames).toEqual(expect.arrayContaining(hiddenCompatibilityRoutes));
		expect(menuNames).toContain('model-configs');
		expect(menuNames).toContain('complexity-router');
	});

	test('places virtual keys with model access while keeping organization management focused', () => {
		const menu = createMenu('zh-CN', [], false, enterpriseResources);
		const models = menu.find((group) => group.name === 'models-group');
		const enterprise = menu.find((group) => group.name === 'governance');
		expect(models?.children?.map((item) => item.name)).toContain('virtual-keys');
		expect(enterprise?.children?.map((item) => item.name)).not.toContain('virtual-keys');
		const entries = leafItems(menu).filter((item) => item.name === 'virtual-keys');
		expect(entries).toHaveLength(1);
		expect(entries[0]?.href).toBe('#/virtual-keys');
		expect(createResources('zh-CN', false, enterpriseResources).map((resource) => resource.name)).toContain('virtual-keys');
	});

	test('preserves stable group ordering when extension resources are injected', () => {
		const menu = createMenu('zh-CN', enterpriseResourceNames, false, enterpriseResources);
		const mcpNames = menu.find((group) => group.name === 'mcp')?.children?.map((entry) => entry.name);
		const systemNames = menu.find((group) => group.name === 'system')?.children?.map((entry) => entry.name);

		expect(mcpNames).toEqual([
			'mcp-clients', 'mcp-library', 'mcp-tool-groups', 'mcp-sessions', 'oauth-grants',
			'mcp-settings', 'mcp-auth-config', 'mcp-usage-guide',
		]);
		expect(systemNames?.indexOf('api-keys')).toBe((systemNames?.indexOf('security-config') ?? -2) + 1);
		expect(systemNames?.slice(-4)).toEqual(['license-info', 'cluster', 'agent-handover', 'docs-hub']);
	});

	test('keeps the development profiler out of production panel builds', async () => {
		expect(createResources('zh-CN', false, enterpriseResources).map((resource) => resource.name)).not.toContain('pprof');
		expect(leafResourceNames(createMenu('zh-CN', enterpriseResourceNames, false, enterpriseResources))).not.toContain('pprof');
		expect(createResources('zh-CN', true, enterpriseResources).map((resource) => resource.name)).toContain('pprof');
		expect(leafResourceNames(createMenu('zh-CN', enterpriseResourceNames, true, enterpriseResources))).toContain('pprof');

		const appSource = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		expect(appSource).toContain('const includeDevelopmentResources = import.meta.env.DEV');
		expect(appSource).toContain('...(includeDevelopmentResources ? { pprof: { list: PprofPage } } : {})');
	});

	test('keeps OAuth consent exclusively on its public flow route', async () => {
		expect(createResources('zh-CN', false, enterpriseResources).map((resource) => resource.name)).not.toContain('oauth-consent');
		expect(leafResourceNames(createMenu('zh-CN', enterpriseResourceNames, false, enterpriseResources))).not.toContain('oauth-consent');
		const appSource = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		expect(appSource).not.toContain("'oauth-consent': { list: OAuthConsentPage }");
		expect(appSource).toContain("publicRoute === 'oauth-consent'");
	});

	test('hides unavailable enterprise surfaces instead of rendering placeholders', () => {
		const names = leafResourceNames(createMenu('zh-CN', [], false, enterpriseResources));
		for (const enterprise of [
			'users', 'business-units', 'rbac', 'scim', 'access-profiles', 'audit-logs',
			'alerting-channels', 'alerting-rules', 'alerting-history', 'guardrails-config',
			'guardrails-providers', 'edge-devices', 'edge-inventory', 'edge-config',
			'mcp-tool-groups', 'mcp-auth-config', 'api-keys',
			'license-info', 'cluster', 'circuit-breaker', 'agent-handover',
		]) {
			expect(names).not.toContain(enterprise);
		}
		expect(names).not.toContain('adaptive-routing');
	});

	test('keeps adaptive routing as a hidden compatibility route without duplicating routing rules', () => {
		const menu = createMenu('zh-CN', [], false, enterpriseResources);
		const leaves = leafItems(menu);
		expect(leaves.filter((entry) => entry.name === 'adaptive-routing')).toHaveLength(0);
		expect(leaves.filter((entry) => entry.href === '#/routing-rules')).toHaveLength(1);
		expect(createResources('zh-CN', false, enterpriseResources).map((resource) => resource.name)).toContain('adaptive-routing');
	});

	test('keeps core MCP workflows on the dedicated management page', async () => {
		const appSource = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		for (const resource of ['mcp-clients', 'mcp-library', 'mcp-sessions', 'oauth-grants']) {
			expect(appSource).toContain(`'${resource}': { list: McpManagementPage }`);
			expect(appSource).not.toContain(`'${resource}': { list: GenericAdminPage }`);
		}
	});

	test('keeps webhook secret and delivery workflows on a dedicated page', async () => {
		const appSource = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		expect(appSource).toContain('webhooks: { list: WebhooksPage }');
		expect(appSource).not.toContain('webhooks: { list: GenericAdminPage }');
	});

	test('keeps plugin runtime, configuration, and sequence workflows on a dedicated page', async () => {
		const appSource = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		expect(appSource).toContain('plugins: { list: PluginsPage }');
		expect(appSource).toContain('pluginFeatureResourcePages(runtimeFeatureNames, enterpriseResourceNames, PluginsPage)');
		expect(appSource).toMatch(/\.\.\.builtInResourcePages[\s\S]*\.\.\.enterpriseFallbackResourcePages[\s\S]*\.\.\.runtimeFeaturePages[\s\S]*\.\.\.enterpriseResourcePages/);
		expect(appSource).toContain('window.addEventListener(PLUGIN_CAPABILITIES_CHANGED_EVENT, refresh)');
		expect(appSource).toContain('window.removeEventListener(PLUGIN_CAPABILITIES_CHANGED_EVENT, refresh)');
		const pluginsPageSource = await Bun.file(new URL('../pages/PluginsPage.svelte', import.meta.url)).text();
		expect(pluginsPageSource).toContain('window.dispatchEvent(new Event(PLUGIN_CAPABILITIES_CHANGED_EVENT))');
		expect(appSource).not.toContain('plugins: { list: GenericAdminPage }');
	});

	test('keeps organization, provider, and pricing governance on structured workflows', async () => {
		const appSource = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		for (const resource of ['teams', 'customers', 'provider-governance', 'pricing-overrides']) {
			const key = resource.includes('-') ? `'${resource}'` : resource;
			expect(appSource).toContain(`${key}: { list: GovernanceManagementPage }`);
			expect(appSource).not.toContain(`${key}: { list: GenericAdminPage }`);
		}
	});

	test('keeps feature flags and user-agent mappings on guarded operational workflows', async () => {
		const appSource = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		for (const resource of ['feature-flags', 'user-agent-mappings']) {
			expect(appSource).toContain(`'${resource}': { list: OperationalSettingsPage }`);
			expect(appSource).not.toContain(`'${resource}': { list: GenericAdminPage }`);
		}
		expect(appSource).toContain(`'provider-keys': { list: ProvidersPage }`);
	});

	test('keeps complexity routing and proxy settings on structured forms', async () => {
		const appSource = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		for (const resource of ['complexity-analyzer', 'complexity-router', 'proxy-config']) {
			expect(appSource).toContain(`'${resource}': { list: RoutingNetworkSettingsPage }`);
			expect(appSource).not.toContain(`'${resource}': { list: JsonDocumentPage }`);
		}
	});

	test('keeps adaptive routing on the dedicated routing rules page', async () => {
		const appSource = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		expect(appSource).toContain(`'adaptive-routing': { list: RoutingRulesPage }`);
		expect(appSource).not.toContain(`'adaptive-routing': { list: EnterpriseFeaturePage }`);
	});

	test('does not route built-in resources through generic editors', async () => {
		const appSource = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		expect(appSource).not.toContain('GenericAdminPage');
		expect(appSource).not.toContain('JsonDocumentPage');
	});
});
