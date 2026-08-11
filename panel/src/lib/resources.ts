import type { MenuItem, ResourceDefinition } from '@svadmin/core';
import { labelFor, type ElygateLocale } from './i18n';
import { VISIBLE_ENTERPRISE_RESOURCES } from './menu-policy';

type LabelKey = Parameters<typeof labelFor>[1];
type ResourceSpec = readonly [name: string, labelKey: LabelKey, icon: string];

const RESOURCE_SPECS: ResourceSpec[] = [
	['providers', 'elygate.providers', 'server'],
	['provider-keys', 'elygate.providerKeys', 'key-round'],
	['virtual-keys', 'elygate.virtualKeys', 'key-round'],
	['models', 'elygate.models', 'bot'],
	['model-catalog', 'elygate.modelCatalog', 'layout-grid'],
	['logs', 'elygate.logs', 'scroll-text'],
	['teams', 'elygate.teams', 'users-round'],
	['customers', 'elygate.customers', 'building-2'],
	['routing-rules', 'elygate.routingRules', 'route'],
	['model-configs', 'elygate.modelConfigs', 'sliders-horizontal'],
	['provider-governance', 'elygate.providerGovernance', 'shield-check'],
	['pricing-overrides', 'elygate.pricingOverrides', 'badge-dollar-sign'],
	['budgets', 'elygate.budgetList', 'wallet'],
	['rate-limits', 'elygate.rateLimits', 'gauge'],
	['webhooks', 'elygate.webhooks', 'webhook'],
	['mcp-clients', 'elygate.mcpClients', 'server-cog'],
	['mcp-library', 'elygate.mcpLibrary', 'library'],
	['mcp-sessions', 'elygate.mcpSessions', 'monitor-dot'],
	['oauth-grants', 'elygate.oauthGrants', 'shield-check'],
	['mcp-logs', 'elygate.mcpLogs', 'list-tree'],
	['mcp-tool-groups', 'elygate.mcpToolGroups', 'tool-case'],
	['mcp-settings', 'elygate.mcpSettings', 'settings'],
	['mcp-auth-config', 'elygate.mcpAuthConfig', 'lock-keyhole'],
	['mcp-usage-guide', 'elygate.mcpUsageGuide', 'book-open-text'],
	['plugins', 'elygate.plugins', 'plug'],
	['skills', 'elygate.skills', 'sparkles'],
	['prompt-folders', 'elygate.promptFolders', 'folder'],
	['prompts', 'elygate.prompts', 'message-square-text'],
	['user-agent-mappings', 'elygate.userAgentMappings', 'tags'],
	['connectors', 'elygate.connectors', 'cable'],
	['config', 'elygate.config', 'settings'],
	['client-settings', 'elygate.clientSettings', 'settings-2'],
	['compatibility-config', 'elygate.compatibilityConfig', 'plug-zap'],
	['caching-config', 'elygate.cachingConfig', 'database-zap'],
	['security-config', 'elygate.securityConfig', 'shield-check'],
	['api-keys', 'elygate.apiKeys', 'key-round'],
	['performance-config', 'elygate.performanceConfig', 'activity'],
	['logging-config', 'elygate.loggingConfig', 'scroll-text'],
	['feature-flags', 'elygate.featureFlags', 'flag'],
	['proxy-config', 'elygate.proxyConfigTitle', 'globe'],
	['pricing-config', 'elygate.pricingConfig', 'badge-dollar-sign'],
	['observability-config', 'elygate.observabilityConfig', 'telescope'],
	['large-payload-config', 'elygate.largePayloadConfig', 'package-open'],
	['mcp-gateway-config', 'elygate.mcpGatewayConfig', 'boxes'],
	['license-info', 'elygate.licenseInfo', 'badge-info'],
	['complexity-analyzer', 'elygate.complexityAnalyzer', 'brain-circuit'],
	['complexity-router', 'elygate.complexityRouter', 'git-compare-arrows'],
	['users', 'elygate.users', 'user-round'],
	['business-units', 'elygate.businessUnits', 'building'],
	['rbac', 'elygate.rbac', 'lock-keyhole'],
	['scim', 'elygate.scim', 'id-card'],
	['access-profiles', 'elygate.accessProfiles', 'fingerprint'],
	['audit-logs', 'elygate.auditLogs', 'file-search'],
	['alerting-channels', 'elygate.alertingChannels', 'megaphone'],
	['alerting-rules', 'elygate.alertingRules', 'gavel'],
	['alerting-history', 'elygate.alertingHistory', 'history'],
	['guardrails-config', 'elygate.guardrailsConfig', 'search-check'],
	['guardrails-providers', 'elygate.guardrailsProviders', 'boxes'],
	['edge-devices', 'elygate.edgeDevices', 'laptop-minimal-check'],
	['edge-inventory', 'elygate.edgeInventory', 'badge-check'],
	['edge-config', 'elygate.edgeConfig', 'settings'],
	['cluster', 'elygate.cluster', 'boxes'],
	['circuit-breaker', 'elygate.circuitBreaker', 'workflow'],
	['adaptive-routing', 'elygate.adaptiveRouting', 'git-branch-plus'],
	['agent-handover', 'elygate.agentHandover', 'handshake'],
	['docs-hub', 'elygate.docsHub', 'book-open-text'],
	['pprof', 'elygate.pprof', 'gauge'],
];

function resource(locale: ElygateLocale, [name, labelKey, icon]: ResourceSpec): ResourceDefinition {
	return { name, label: labelFor(locale, labelKey), icon, fields: [], showInMenu: false };
}

function menuItem(locale: ElygateLocale, name: string, labelKey: LabelKey, icon: string): MenuItem {
	return { name, label: labelFor(locale, labelKey), icon, href: `#/${name}` };
}

const enterpriseResourceNames = new Set<string>(VISIBLE_ENTERPRISE_RESOURCES);
const developmentResourceNames = new Set<string>(['pprof']);

function capabilityMenu(items: MenuItem[], availableResources: ReadonlySet<string>): MenuItem[] {
	return items.flatMap((item) => {
		if (item.children) {
			const children = capabilityMenu(item.children, availableResources);
			return children.length > 0 ? [{ ...item, children }] : [];
		}
		if (enterpriseResourceNames.has(item.name) && !availableResources.has(item.name)) return [];
		return [item];
	});
}

export function createResources(locale: ElygateLocale, includeDevelopmentResources = false): ResourceDefinition[] {
	return RESOURCE_SPECS
		.filter(([name]) => includeDevelopmentResources || !developmentResourceNames.has(name))
		.map((spec) => resource(locale, spec));
}

export function createMenu(
	locale: ElygateLocale,
	availableEnterpriseResources: readonly string[] = [],
	includeDevelopmentResources = false,
): MenuItem[] {
	const menu: MenuItem[] = [
		{ name: 'dashboard', label: labelFor(locale, 'elygate.dashboard'), icon: 'layout-dashboard', href: '#/' },
		{
			name: 'observability',
			label: labelFor(locale, 'elygate.observability'),
			icon: 'activity',
			children: [
				menuItem(locale, 'logs', 'elygate.logs', 'scroll-text'),
				menuItem(locale, 'mcp-logs', 'elygate.mcpLogs', 'list-tree'),
				menuItem(locale, 'connectors', 'elygate.connectors', 'cable'),
				menuItem(locale, 'user-agent-mappings', 'elygate.userAgentMappings', 'tags'),
				menuItem(locale, 'audit-logs', 'elygate.auditLogs', 'file-search'),
				menuItem(locale, 'alerting-channels', 'elygate.alertingChannels', 'megaphone'),
				menuItem(locale, 'alerting-rules', 'elygate.alertingRules', 'gavel'),
				menuItem(locale, 'alerting-history', 'elygate.alertingHistory', 'history'),
			],
		},
		{
			name: 'models-group',
			label: labelFor(locale, 'elygate.models'),
			icon: 'box',
			children: [
				menuItem(locale, 'models', 'elygate.models', 'bot'),
				menuItem(locale, 'model-catalog', 'elygate.modelCatalog', 'layout-grid'),
				menuItem(locale, 'providers', 'elygate.providers', 'server'),
				menuItem(locale, 'provider-keys', 'elygate.providerKeys', 'key-round'),
				menuItem(locale, 'virtual-keys', 'elygate.virtualKeys', 'key-round'),
				menuItem(locale, 'routing-rules', 'elygate.routingRules', 'route'),
				menuItem(locale, 'complexity-router', 'elygate.complexityRouter', 'git-compare-arrows'),
				menuItem(locale, 'circuit-breaker', 'elygate.circuitBreaker', 'workflow'),
				menuItem(locale, 'model-configs', 'elygate.modelConfigs', 'sliders-horizontal'),
				menuItem(locale, 'provider-governance', 'elygate.providerGovernance', 'shield-check'),
				menuItem(locale, 'pricing-overrides', 'elygate.pricingOverrides', 'badge-dollar-sign'),
			],
		},
		{
			name: 'mcp',
			label: labelFor(locale, 'elygate.mcp'),
			icon: 'boxes',
			children: [
				menuItem(locale, 'mcp-clients', 'elygate.mcpClients', 'server-cog'),
				menuItem(locale, 'mcp-library', 'elygate.mcpLibrary', 'library'),
				menuItem(locale, 'mcp-tool-groups', 'elygate.mcpToolGroups', 'tool-case'),
				menuItem(locale, 'mcp-sessions', 'elygate.mcpSessions', 'monitor-dot'),
				menuItem(locale, 'oauth-grants', 'elygate.oauthGrants', 'shield-check'),
				menuItem(locale, 'mcp-settings', 'elygate.mcpSettings', 'settings'),
				menuItem(locale, 'mcp-auth-config', 'elygate.mcpAuthConfig', 'lock-keyhole'),
				menuItem(locale, 'mcp-usage-guide', 'elygate.mcpUsageGuide', 'book-open-text'),
			],
		},
		{
			name: 'governance',
			label: labelFor(locale, 'elygate.enterprise'),
			icon: 'landmark',
			children: [
				menuItem(locale, 'teams', 'elygate.teams', 'users-round'),
				menuItem(locale, 'customers', 'elygate.customers', 'building-2'),
				menuItem(locale, 'users', 'elygate.users', 'user-round'),
				menuItem(locale, 'business-units', 'elygate.businessUnits', 'building'),
				menuItem(locale, 'rbac', 'elygate.rbac', 'lock-keyhole'),
				menuItem(locale, 'scim', 'elygate.scim', 'id-card'),
				menuItem(locale, 'access-profiles', 'elygate.accessProfiles', 'fingerprint'),
			],
		},
		{
			name: 'guardrails',
			label: labelFor(locale, 'elygate.guardrails'),
			icon: 'shield-alert',
			children: [
				menuItem(locale, 'guardrails-config', 'elygate.guardrailsConfig', 'search-check'),
				menuItem(locale, 'guardrails-providers', 'elygate.guardrailsProviders', 'boxes'),
			],
		},
		{
			name: 'edge-control',
			label: labelFor(locale, 'elygate.edgeControl'),
			icon: 'hexagon',
			children: [
				menuItem(locale, 'edge-devices', 'elygate.edgeDevices', 'laptop-minimal-check'),
				menuItem(locale, 'edge-inventory', 'elygate.edgeInventory', 'badge-check'),
				menuItem(locale, 'edge-config', 'elygate.edgeConfig', 'settings'),
			],
		},
		{
			name: 'integrations',
			label: labelFor(locale, 'elygate.integrations'),
			icon: 'plug-zap',
			children: [
				menuItem(locale, 'webhooks', 'elygate.webhooks', 'webhook'),
				menuItem(locale, 'plugins', 'elygate.plugins', 'plug'),
				menuItem(locale, 'skills', 'elygate.skills', 'sparkles'),
				menuItem(locale, 'prompts', 'elygate.prompts', 'message-square-text'),
			],
		},
		{
			name: 'system',
			label: labelFor(locale, 'elygate.system'),
			icon: 'settings',
			children: [
				menuItem(locale, 'config', 'elygate.config', 'settings'),
				menuItem(locale, 'client-settings', 'elygate.clientSettings', 'settings-2'),
				menuItem(locale, 'compatibility-config', 'elygate.compatibilityConfig', 'plug-zap'),
				menuItem(locale, 'caching-config', 'elygate.cachingConfig', 'database-zap'),
				menuItem(locale, 'security-config', 'elygate.securityConfig', 'shield-check'),
				menuItem(locale, 'api-keys', 'elygate.apiKeys', 'key-round'),
				menuItem(locale, 'performance-config', 'elygate.performanceConfig', 'activity'),
				menuItem(locale, 'logging-config', 'elygate.loggingConfig', 'scroll-text'),
				menuItem(locale, 'feature-flags', 'elygate.featureFlags', 'flag'),
				menuItem(locale, 'proxy-config', 'elygate.proxyConfigTitle', 'globe'),
				menuItem(locale, 'pricing-config', 'elygate.pricingConfig', 'badge-dollar-sign'),
				menuItem(locale, 'observability-config', 'elygate.observabilityConfig', 'telescope'),
				menuItem(locale, 'large-payload-config', 'elygate.largePayloadConfig', 'package-open'),
				menuItem(locale, 'mcp-gateway-config', 'elygate.mcpGatewayConfig', 'boxes'),
				menuItem(locale, 'license-info', 'elygate.licenseInfo', 'badge-info'),
				menuItem(locale, 'cluster', 'elygate.cluster', 'boxes'),
				{
					name: 'adaptive-routing',
					label: labelFor(locale, 'elygate.adaptiveRouting'),
					icon: 'git-branch-plus',
					href: '#/routing-rules',
				},
				menuItem(locale, 'agent-handover', 'elygate.agentHandover', 'handshake'),
				menuItem(locale, 'docs-hub', 'elygate.docsHub', 'book-open-text'),
				...(includeDevelopmentResources ? [menuItem(locale, 'pprof', 'elygate.pprof', 'gauge')] : []),
			],
		},
	];
	return capabilityMenu(menu, new Set(availableEnterpriseResources));
}
