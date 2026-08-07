export const VISIBLE_ENTERPRISE_RESOURCES = ['customers', 'teams'] as const;

export function isVisibleEnterpriseResource(name: string): boolean {
	return VISIBLE_ENTERPRISE_RESOURCES.some((resource) => resource === name);
}
