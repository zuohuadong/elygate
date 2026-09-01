import { labelFor, type ElygateLocale } from './i18n';

const ROUTE_LABEL_KEYS = {
	'': 'elygate.dashboard',
	dashboard: 'elygate.dashboard',
	providers: 'elygate.providers',
	'provider-keys': 'elygate.providerKeys',
	'virtual-keys': 'elygate.virtualKeys',
	models: 'elygate.models',
	'model-catalog': 'elygate.modelCatalog',
	logs: 'elygate.logs',
	'request-logs': 'elygate.logs',
	employees: 'elygate.employees',
	teams: 'elygate.teams',
	customers: 'elygate.customers',
	'routing-rules': 'elygate.routingRules',
	'model-configs': 'elygate.modelConfigs',
	'provider-governance': 'elygate.providerGovernance',
	'pricing-overrides': 'elygate.pricingOverrides',
	budgets: 'elygate.budgetList',
	'rate-limits': 'elygate.rateLimits',
	webhooks: 'elygate.webhooks',
	'mcp-clients': 'elygate.mcpClients',
	'mcp-library': 'elygate.mcpLibrary',
	'mcp-sessions': 'elygate.mcpSessions',
	'oauth-grants': 'elygate.oauthGrants',
	'mcp-logs': 'elygate.mcpLogs',
	'mcp-settings': 'elygate.mcpSettings',
	'mcp-usage-guide': 'elygate.mcpUsageGuide',
	plugins: 'elygate.plugins',
	skills: 'elygate.skills',
	'prompt-folders': 'elygate.promptFolders',
	prompts: 'elygate.prompts',
	connectors: 'elygate.connectors',
	'usage-ledger': 'elygate.usageLedger',
	config: 'elygate.config',
	'client-settings': 'elygate.clientSettings',
	'compatibility-config': 'elygate.compatibilityConfig',
	'caching-config': 'elygate.cachingConfig',
	'security-config': 'elygate.securityConfig',
	'performance-config': 'elygate.performanceConfig',
	'logging-config': 'elygate.loggingConfig',
	'feature-flags': 'elygate.featureFlags',
	'proxy-config': 'elygate.proxyConfigTitle',
	'pricing-config': 'elygate.pricingConfig',
	'observability-config': 'elygate.observabilityConfig',
	'large-payload-config': 'elygate.largePayloadConfig',
	'mcp-gateway-config': 'elygate.mcpGatewayConfig',
	'complexity-analyzer': 'elygate.complexityAnalyzer',
	'complexity-router': 'elygate.complexityRouter',
	'adaptive-routing': 'elygate.adaptiveRouting',
	'docs-hub': 'elygate.docsHub',
	pprof: 'elygate.pprof',
} as const;

export function pageTitleForHash(hash: string, locale: ElygateLocale, resourceLabels: Readonly<Record<string, string>> = {}): string {
	const route = hash.replace(/^#\/?/, '').split(/[/?]/, 1)[0] || '';
	if (resourceLabels[route]) return resourceLabels[route];
	const standaloneTitles: Record<string, [string, string]> = {
		login: ['登录', 'Login'],
		register: ['注册', 'Register'],
		'forgot-password': ['找回密码', 'Forgot password'],
		'update-password': ['更新密码', 'Update password'],
		account: ['账户设置', 'Account settings'],
		settings: ['系统设置', 'System settings'],
	};
	const standaloneTitle = standaloneTitles[route];
	if (standaloneTitle) return locale === 'zh-CN' ? standaloneTitle[0] : standaloneTitle[1];
	const key = ROUTE_LABEL_KEYS[route as keyof typeof ROUTE_LABEL_KEYS];
	if (!key) return locale === 'zh-CN' ? '页面未找到' : 'Page not found';
	return labelFor(locale, key);
}
