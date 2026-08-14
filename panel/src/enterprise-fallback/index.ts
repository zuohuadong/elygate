import type { EnterpriseMenuGroup, EnterprisePanelManifest, EnterpriseResourceManifestEntry } from '../lib/enterprise-panel';
import { labelFor } from '../lib/i18n';
import EnterpriseFeaturePage from '../pages/EnterpriseFeaturePage.svelte';
import PluginsPage from '../pages/PluginsPage.svelte';

export const enterprisePanelAvailable = false;
export const enterpriseResourcePages = {};
export const enterprisePublicPages = {};

type LabelKey = Parameters<typeof labelFor>[1];

function resource(
	name: string,
	labelKey: LabelKey,
	icon: string,
	menu: { group: EnterpriseMenuGroup; order: number },
): EnterpriseResourceManifestEntry {
	return {
		name,
		icon,
		menuGroup: menu.group,
		menuOrder: menu.order,
		labels: {
			'zh-CN': labelFor('zh-CN', labelKey),
			en: labelFor('en', labelKey),
		},
	};
}

const resources = [
	resource('users', 'elygate.users', 'user-round', { group: 'governance', order: 300 }),
	resource('business-units', 'elygate.businessUnits', 'building', { group: 'governance', order: 400 }),
	resource('rbac', 'elygate.rbac', 'lock-keyhole', { group: 'governance', order: 500 }),
	resource('scim', 'elygate.scim', 'id-card', { group: 'governance', order: 600 }),
	resource('access-profiles', 'elygate.accessProfiles', 'fingerprint', { group: 'governance', order: 700 }),
	resource('audit-logs', 'elygate.auditLogs', 'file-search', { group: 'observability', order: 500 }),
	resource('alerting-channels', 'elygate.alertingChannels', 'megaphone', { group: 'observability', order: 600 }),
	resource('alerting-rules', 'elygate.alertingRules', 'gavel', { group: 'observability', order: 700 }),
	resource('alerting-history', 'elygate.alertingHistory', 'history', { group: 'observability', order: 800 }),
	resource('guardrails-config', 'elygate.guardrailsConfig', 'search-check', { group: 'guardrails', order: 100 }),
	resource('guardrails-providers', 'elygate.guardrailsProviders', 'boxes', { group: 'guardrails', order: 200 }),
	resource('edge-devices', 'elygate.edgeDevices', 'laptop-minimal-check', { group: 'edge-control', order: 100 }),
	resource('edge-inventory', 'elygate.edgeInventory', 'badge-check', { group: 'edge-control', order: 200 }),
	resource('edge-config', 'elygate.edgeConfig', 'settings', { group: 'edge-control', order: 300 }),
	resource('mcp-tool-groups', 'elygate.mcpToolGroups', 'tool-case', { group: 'mcp', order: 250 }),
	resource('mcp-auth-config', 'elygate.mcpAuthConfig', 'lock-keyhole', { group: 'mcp', order: 550 }),
	resource('api-keys', 'elygate.apiKeys', 'key-round', { group: 'system', order: 550 }),
	resource('license-info', 'elygate.licenseInfo', 'badge-info', { group: 'system', order: 1350 }),
	resource('cluster', 'elygate.cluster', 'boxes', { group: 'system', order: 1360 }),
	resource('circuit-breaker', 'elygate.circuitBreaker', 'workflow', { group: 'models-group', order: 750 }),
	resource('agent-handover', 'elygate.agentHandover', 'handshake', { group: 'system', order: 1370 }),
] as const;

export const enterprisePanelManifest: EnterprisePanelManifest = {
	resources,
	resourcePages: {},
	fallbackResourcePages: {
		users: { list: EnterpriseFeaturePage },
		'business-units': { list: EnterpriseFeaturePage },
		rbac: { list: EnterpriseFeaturePage },
		scim: { list: EnterpriseFeaturePage },
		'access-profiles': { list: EnterpriseFeaturePage },
		'audit-logs': { list: EnterpriseFeaturePage },
		alerting: { list: EnterpriseFeaturePage },
		'alerting-channels': { list: EnterpriseFeaturePage },
		'alerting-rules': { list: EnterpriseFeaturePage },
		'alerting-history': { list: EnterpriseFeaturePage },
		'guardrails-config': { list: PluginsPage },
		'guardrails-providers': { list: PluginsPage },
		'edge-devices': { list: EnterpriseFeaturePage },
		'edge-inventory': { list: EnterpriseFeaturePage },
		'edge-config': { list: EnterpriseFeaturePage },
		'mcp-tool-groups': { list: EnterpriseFeaturePage },
		'mcp-auth-config': { list: EnterpriseFeaturePage },
		'api-keys': { list: EnterpriseFeaturePage },
		'license-info': { list: EnterpriseFeaturePage },
		cluster: { list: PluginsPage },
		'circuit-breaker': { list: PluginsPage },
		'agent-handover': { list: EnterpriseFeaturePage },
	},
	publicPages: {},
	translations: {},
};
