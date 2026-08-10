export const VISIBLE_ENTERPRISE_RESOURCES = [
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
	'mcp-tool-groups',
	'mcp-auth-config',
	'api-keys',
	'license-info',
	'cluster',
	'circuit-breaker',
	'agent-handover',
] as const;

export type EnterpriseResourceName = (typeof VISIBLE_ENTERPRISE_RESOURCES)[number];

export function visibleEnterpriseResources(features: readonly string[]): EnterpriseResourceName[] {
	const available = new Set(features);
	return VISIBLE_ENTERPRISE_RESOURCES.filter((resource) => available.has(resource));
}

export function pluginFeatureResourcePages<Page>(
	features: readonly string[],
	page: Page,
): Partial<Record<EnterpriseResourceName, { list: Page }>> {
	return Object.fromEntries(
		visibleEnterpriseResources(features).map((feature) => [feature, { list: page }]),
	) as Partial<Record<EnterpriseResourceName, { list: Page }>>;
}

export function isVisibleEnterpriseResource(name: string, features: readonly string[] = []): boolean {
	return visibleEnterpriseResources(features).some((resource) => resource === name);
}
