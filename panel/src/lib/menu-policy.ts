export type EnterpriseResourceName = string;

export function visibleEnterpriseResources(
	features: readonly string[],
	resourceNames: readonly string[],
): EnterpriseResourceName[] {
	const available = new Set(features);
	return resourceNames.filter((resource) => available.has(resource));
}

export function pluginFeatureResourcePages<Page>(
	features: readonly string[],
	resourceNames: readonly string[],
	page: Page,
): Partial<Record<EnterpriseResourceName, { list: Page }>> {
	return Object.fromEntries(
		visibleEnterpriseResources(features, resourceNames).map((feature) => [feature, { list: page }]),
	) as Partial<Record<EnterpriseResourceName, { list: Page }>>;
}

export function isVisibleEnterpriseResource(
	name: string,
	features: readonly string[] = [],
	resourceNames: readonly string[] = [],
): boolean {
	return visibleEnterpriseResources(features, resourceNames).some((resource) => resource === name);
}
