export interface EnterpriseFeatureLink {
	href: string;
	labelKey: string;
}

export interface EnterpriseFeatureDefinition {
	titleKey: string;
	sectionKey: string;
	hintKey: string;
	links: EnterpriseFeatureLink[];
}

const defaultLinks: EnterpriseFeatureLink[] = [
	{ href: '#/teams', labelKey: 'elygate.teams' },
	{ href: '#/customers', labelKey: 'elygate.customers' },
	{ href: '#/mcp-sessions', labelKey: 'elygate.mcpSessions' },
	{ href: '#/routing-rules', labelKey: 'elygate.routingRules' },
];

const systemFeatures: Record<string, Omit<EnterpriseFeatureDefinition, 'titleKey' | 'sectionKey'>> = {
	'adaptive-routing': {
		hintKey: 'elygate.adaptiveRoutingUnavailableHint',
		links: [{ href: '#/routing-rules', labelKey: 'elygate.routingRules' }],
	},
	guardrails: { hintKey: 'elygate.guardrailsUnavailableHint', links: [] },
	cluster: { hintKey: 'elygate.clusterUnavailableHint', links: [] },
	'circuit-breaker': { hintKey: 'elygate.circuitBreakerUnavailableHint', links: [] },
};

export function enterpriseFeatureDefinition(resourceName: string, titleKey: string): EnterpriseFeatureDefinition {
	const systemFeature = systemFeatures[resourceName];
	if (systemFeature) return { titleKey, sectionKey: 'elygate.system', ...systemFeature };
	return {
		titleKey,
		sectionKey: 'elygate.enterprise',
		hintKey: 'elygate.enterpriseFeatureHint',
		links: defaultLinks,
	};
}
