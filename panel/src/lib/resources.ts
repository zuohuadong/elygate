import type { MenuItem, ResourceDefinition } from '@svadmin/core';
import { labelFor, type ElygateLocale } from './i18n';

function resource(locale: ElygateLocale, name: string, labelKey: Parameters<typeof labelFor>[1], icon: string): ResourceDefinition {
	return { name, label: labelFor(locale, labelKey), icon, fields: [], showInMenu: false };
}

export function createResources(locale: ElygateLocale): ResourceDefinition[] {
	return [
		resource(locale, 'providers', 'elygate.providers', 'server'),
		resource(locale, 'virtual-keys', 'elygate.virtualKeys', 'key-round'),
		resource(locale, 'models', 'elygate.models', 'bot'),
		resource(locale, 'logs', 'elygate.logs', 'scroll-text'),
		resource(locale, 'teams', 'elygate.teams', 'users-round'),
		resource(locale, 'customers', 'elygate.customers', 'building-2'),
		resource(locale, 'routing-rules', 'elygate.routingRules', 'route'),
		resource(locale, 'model-configs', 'elygate.modelConfigs', 'sliders-horizontal'),
		resource(locale, 'provider-governance', 'elygate.providerGovernance', 'shield-check'),
		resource(locale, 'pricing-overrides', 'elygate.pricingOverrides', 'badge-dollar-sign'),
		resource(locale, 'budgets', 'elygate.budgetList', 'wallet'),
		resource(locale, 'rate-limits', 'elygate.rateLimits', 'gauge'),
		resource(locale, 'webhooks', 'elygate.webhooks', 'webhook'),
		resource(locale, 'mcp-sessions', 'elygate.mcpSessions', 'monitor-dot'),
		resource(locale, 'mcp-logs', 'elygate.mcpLogs', 'list-tree'),
		resource(locale, 'plugins', 'elygate.plugins', 'plug'),
		resource(locale, 'skills', 'elygate.skills', 'sparkles'),
		resource(locale, 'prompt-folders', 'elygate.promptFolders', 'folder'),
		resource(locale, 'prompts', 'elygate.prompts', 'message-square-text'),
		resource(locale, 'config', 'elygate.config', 'settings'),
		resource(locale, 'complexity-analyzer', 'elygate.complexityAnalyzer', 'brain-circuit'),
		resource(locale, 'users', 'elygate.users', 'user-round'),
		resource(locale, 'business-units', 'elygate.businessUnits', 'building'),
		resource(locale, 'rbac', 'elygate.rbac', 'lock-keyhole'),
		resource(locale, 'scim', 'elygate.scim', 'id-card'),
		resource(locale, 'access-profiles', 'elygate.accessProfiles', 'fingerprint'),
		resource(locale, 'audit-logs', 'elygate.auditLogs', 'file-search'),
		resource(locale, 'alerting', 'elygate.alerting', 'bell-ring'),
		resource(locale, 'guardrails', 'elygate.guardrails', 'shield-alert'),
		resource(locale, 'cluster', 'elygate.cluster', 'boxes'),
		resource(locale, 'circuit-breaker', 'elygate.circuitBreaker', 'workflow'),
		resource(locale, 'adaptive-routing', 'elygate.adaptiveRouting', 'git-branch-plus'),
	];
}

export function createMenu(locale: ElygateLocale): MenuItem[] {
	return [
		{ name: 'dashboard', label: labelFor(locale, 'elygate.dashboard'), icon: 'layout-dashboard', href: '/' },
		{
			name: 'gateway',
			label: labelFor(locale, 'elygate.gateway'),
			icon: 'network',
			children: [
				{ name: 'providers', label: labelFor(locale, 'elygate.providers'), icon: 'server', href: '/providers' },
				{ name: 'virtual-keys', label: labelFor(locale, 'elygate.virtualKeys'), icon: 'key-round', href: '/virtual-keys' },
				{ name: 'models', label: labelFor(locale, 'elygate.models'), icon: 'bot', href: '/models' },
				{ name: 'routing-rules', label: labelFor(locale, 'elygate.routingRules'), icon: 'route', href: '/routing-rules' },
				{ name: 'model-configs', label: labelFor(locale, 'elygate.modelConfigs'), icon: 'sliders-horizontal', href: '/model-configs' },
				{ name: 'provider-governance', label: labelFor(locale, 'elygate.providerGovernance'), icon: 'shield-check', href: '/provider-governance' },
				{ name: 'pricing-overrides', label: labelFor(locale, 'elygate.pricingOverrides'), icon: 'badge-dollar-sign', href: '/pricing-overrides' },
			],
		},
		{
			name: 'enterprise',
			label: labelFor(locale, 'elygate.enterprise'),
			icon: 'briefcase-business',
			children: [
				{ name: 'customers', label: labelFor(locale, 'elygate.customers'), icon: 'building-2', href: '/customers' },
				{ name: 'teams', label: labelFor(locale, 'elygate.teams'), icon: 'users-round', href: '/teams' },
				{ name: 'users', label: labelFor(locale, 'elygate.users'), icon: 'user-round', href: '/users' },
				{ name: 'business-units', label: labelFor(locale, 'elygate.businessUnits'), icon: 'building', href: '/business-units' },
				{ name: 'access-profiles', label: labelFor(locale, 'elygate.accessProfiles'), icon: 'fingerprint', href: '/access-profiles' },
				{ name: 'rbac', label: labelFor(locale, 'elygate.rbac'), icon: 'lock-keyhole', href: '/rbac' },
				{ name: 'scim', label: labelFor(locale, 'elygate.scim'), icon: 'id-card', href: '/scim' },
			],
		},
		{
			name: 'mcp',
			label: labelFor(locale, 'elygate.mcp'),
			icon: 'boxes',
			children: [
				{ name: 'mcp-sessions', label: labelFor(locale, 'elygate.mcpSessions'), icon: 'monitor-dot', href: '/mcp-sessions' },
				{ name: 'mcp-logs', label: labelFor(locale, 'elygate.mcpLogs'), icon: 'list-tree', href: '/mcp-logs' },
			],
		},
		{
			name: 'observability',
			label: labelFor(locale, 'elygate.observability'),
			icon: 'activity',
			children: [
				{ name: 'logs', label: labelFor(locale, 'elygate.logs'), icon: 'scroll-text', href: '/logs' },
				{ name: 'budgets', label: labelFor(locale, 'elygate.budgetList'), icon: 'wallet', href: '/budgets' },
				{ name: 'rate-limits', label: labelFor(locale, 'elygate.rateLimits'), icon: 'gauge', href: '/rate-limits' },
				{ name: 'audit-logs', label: labelFor(locale, 'elygate.auditLogs'), icon: 'file-search', href: '/audit-logs' },
				{ name: 'alerting', label: labelFor(locale, 'elygate.alerting'), icon: 'bell-ring', href: '/alerting' },
			],
		},
		{
			name: 'integrations',
			label: labelFor(locale, 'elygate.integrations'),
			icon: 'plug-zap',
			children: [
				{ name: 'webhooks', label: labelFor(locale, 'elygate.webhooks'), icon: 'webhook', href: '/webhooks' },
				{ name: 'plugins', label: labelFor(locale, 'elygate.plugins'), icon: 'plug', href: '/plugins' },
				{ name: 'skills', label: labelFor(locale, 'elygate.skills'), icon: 'sparkles', href: '/skills' },
				{ name: 'prompt-folders', label: labelFor(locale, 'elygate.promptFolders'), icon: 'folder', href: '/prompt-folders' },
				{ name: 'prompts', label: labelFor(locale, 'elygate.prompts'), icon: 'message-square-text', href: '/prompts' },
			],
		},
		{
			name: 'system',
			label: labelFor(locale, 'elygate.system'),
			icon: 'settings',
			children: [
				{ name: 'config', label: labelFor(locale, 'elygate.config'), icon: 'settings', href: '/config' },
				{ name: 'complexity-analyzer', label: labelFor(locale, 'elygate.complexityAnalyzer'), icon: 'brain-circuit', href: '/complexity-analyzer' },
				{ name: 'adaptive-routing', label: labelFor(locale, 'elygate.adaptiveRouting'), icon: 'git-branch-plus', href: '/adaptive-routing' },
				{ name: 'guardrails', label: labelFor(locale, 'elygate.guardrails'), icon: 'shield-alert', href: '/guardrails' },
				{ name: 'cluster', label: labelFor(locale, 'elygate.cluster'), icon: 'boxes', href: '/cluster' },
				{ name: 'circuit-breaker', label: labelFor(locale, 'elygate.circuitBreaker'), icon: 'workflow', href: '/circuit-breaker' },
			],
		},
	];
}
