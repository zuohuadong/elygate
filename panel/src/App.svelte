<script lang="ts">
	import { onMount } from 'svelte';
	import { AdminApp } from '@svadmin/ui';
	import { builtinPresets } from '@svadmin/core';
	import * as enterprisePanel from '@elygate/enterprise-panel';
	import { ApiError, configureRequestErrorFormatter, getListPayload, getSessionStatus, requestJson } from './lib/api';
	import { createBifrostAuthProvider } from './lib/auth';
	import { bifrostDataProvider } from './lib/data-provider';
	import {
		registerEnterprisePanelTranslations,
		resolveEnterprisePanelManifest,
	} from './lib/enterprise-panel';
	import { getAppName, getEnName, onAppNameChange, resolveAppName, resolveBranding } from './lib/branding';
	import { labelFor, registerElygateTranslations, type ElygateLocale } from './lib/i18n';
	import { pluginFeatureResourcePages } from './lib/menu-policy';
	import { resolvePublicPanelRoute } from './lib/public-routes';
	import {
		activePluginFeatures,
		managedPluginFromRecord,
		PLUGIN_CAPABILITIES_CHANGED_EVENT,
	} from './lib/plugin-management';
	import { createMenu, createResources } from './lib/resources';
	import { pageTitleForHash } from './lib/page-metadata';
	import { enterprisePanelManifest as fallbackEnterprisePanelManifest } from './enterprise-fallback';
	import DashboardPage from './pages/DashboardPage.svelte';
	import BifrostResourcePage from './pages/BifrostResourcePage.svelte';
	import CachingConfigPage from './pages/CachingConfigPage.svelte';
	import ConfigPage from './pages/ConfigPage.svelte';
	import DocsHubPage from './pages/DocsHubPage.svelte';
	import EnterprisePublicFallbackPage from './pages/EnterprisePublicFallbackPage.svelte';
	import EmployeePortalPage from './pages/EmployeePortalPage.svelte';
	import EmployeesPage from './pages/EmployeesPage.svelte';
	import GovernanceManagementPage from './pages/GovernanceManagementPage.svelte';
	import LogsPage from './pages/LogsPage.svelte';
	import McpLogsPage from './pages/McpLogsPage.svelte';
	import McpManagementPage from './pages/McpManagementPage.svelte';
	import McpUsageGuidePage from './pages/McpUsageGuidePage.svelte';
	import McpSettingsPage from './pages/McpSettingsPage.svelte';
	import McpAuthFlowPage from './pages/McpAuthFlowPage.svelte';
	import ModelCatalogPage from './pages/ModelCatalogPage.svelte';
	import ModelLimitsPage from './pages/ModelLimitsPage.svelte';
	import OAuthConsentPage from './pages/OAuthConsentPage.svelte';
	import ObservabilityConnectorsPage from './pages/ObservabilityConnectorsPage.svelte';
	import UsageLedgerPage from './pages/UsageLedgerPage.svelte';
	import OperationalSettingsPage from './pages/OperationalSettingsPage.svelte';
	import PanelAssist from './pages/PanelAssist.svelte';
	import PprofPage from './pages/PprofPage.svelte';
	import PluginsPage from './pages/PluginsPage.svelte';
	import ProvidersPage from './pages/ProvidersPage.svelte';
	import PromptRepositoryPage from './pages/PromptRepositoryPage.svelte';
	import RoutingRulesPage from './pages/RoutingRulesPage.svelte';
	import RoutingNetworkSettingsPage from './pages/RoutingNetworkSettingsPage.svelte';
	import SkillsPage from './pages/SkillsPage.svelte';
	import VirtualKeysPage from './pages/VirtualKeysPage.svelte';
	import WebhooksPage from './pages/WebhooksPage.svelte';

	registerElygateTranslations();
	const enterpriseManifest = resolveEnterprisePanelManifest(enterprisePanel, fallbackEnterprisePanelManifest);
	registerEnterprisePanelTranslations(enterpriseManifest);

	function normalizeInitialHashRoute(): void {
		if (typeof window === 'undefined') return;
		const { hash, pathname, search } = window.location;
		if (hash || pathname === '/') return;

		const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
		window.history.replaceState(null, '', `/#${path}${search}`);
	}

	const publicRoute = typeof window !== 'undefined' ? resolvePublicPanelRoute(window.location.pathname) : null;
	if (!publicRoute) normalizeInitialHashRoute();
	const enterpriseResourcePages = enterpriseManifest.resourcePages;
	const enterpriseFallbackResourcePages = enterpriseManifest.fallbackResourcePages;
	const enterprisePublicPages = enterpriseManifest.publicPages;
	const enterpriseResources = enterpriseManifest.resources;
	const enterpriseResourceNames = enterpriseResources.map((resource) => resource.name);
	const enterprisePublicRoute = publicRoute === 'employee' ? null : publicRoute;
	const EnterprisePublicPage = enterprisePublicRoute ? enterprisePublicPages[enterprisePublicRoute] : undefined;
	const includeDevelopmentResources = import.meta.env.DEV;

	let currentAppName = $state(getAppName());
	let currentLocale = $state<ElygateLocale>('zh-CN');
	let currentHash = $state(typeof window !== 'undefined' ? window.location.hash : '');
	let runtimeFeatureNames = $state.raw<string[]>([]);
	const themeLabels = {
		'zh-CN': { neutral: '中性色', indigo: '靛蓝色', blue: '蓝色', green: '绿色', rose: '玫瑰色', orange: '橙色', violet: '紫罗兰色' },
		en: { neutral: 'Neutral', indigo: 'Indigo', blue: 'Blue', green: 'Green', rose: 'Rose', orange: 'Orange', violet: 'Violet' },
	} as const;
	const enterprisePageNames = Object.keys(enterpriseResourcePages);
	const availableEnterpriseResources = $derived([...new Set([...enterprisePageNames, ...runtimeFeatureNames])]);

	async function refreshAppConfig(): Promise<void> {
		try {
			const sessionStatus = await getSessionStatus();
			resolveBranding(sessionStatus as Record<string, unknown>);
		} catch {
			// offline or unauthenticated
		}
		try {
			const config = await requestJson<Record<string, unknown>>('/api/config');
			resolveBranding(config);
		} catch {
			// offline or unauthenticated
		}
	}

	async function refreshRuntimeFeatures(): Promise<void> {
		try {
			const payload = await requestJson<unknown>('/api/plugins');
			runtimeFeatureNames = activePluginFeatures(getListPayload(payload).map(managedPluginFromRecord));
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) return;
			console.error('Failed to load plugin feature capabilities.', error);
		}
	}

	configureRequestErrorFormatter((status) => labelFor(currentLocale, 'elygate.requestFailed').replace('{status}', String(status)));
	const bifrostAuthProvider = createBifrostAuthProvider(() => currentLocale, refreshRuntimeFeatures);
	const resources = $derived.by(() =>
		createResources(currentLocale, includeDevelopmentResources, enterpriseResources, availableEnterpriseResources),
	);
	const menu = $derived.by(() =>
		createMenu(currentLocale, availableEnterpriseResources, includeDevelopmentResources, enterpriseResources),
	);
	const loginHint = $derived(labelFor(currentLocale, 'elygate.loginHint'));

	function applyLocaleMetadata(locale: ElygateLocale): void {
		if (typeof document !== 'undefined') {
			const resourceLabels = Object.fromEntries(resources.map((resource) => [resource.name, resource.label]));
			const pageTitle = pageTitleForHash(currentHash, locale, resourceLabels);
			document.title = locale === 'zh-CN' ? `${pageTitle} - ${currentAppName} 管理台` : `${pageTitle} - ${getEnName()} Admin Console`;
			document.documentElement.lang = locale;
		}
		for (const [name, label] of Object.entries(themeLabels[locale])) {
			if (builtinPresets[name]) builtinPresets[name].label = label;
		}
	}

	$effect(() => {
		applyLocaleMetadata(currentLocale);
	});

	const builtInResourcePages = {
		providers: { list: ProvidersPage },
		'virtual-keys': { list: VirtualKeysPage },
		models: { list: BifrostResourcePage },
		logs: { list: LogsPage },
		'request-logs': { list: LogsPage },
		employees: { list: EmployeesPage },
		teams: { list: GovernanceManagementPage },
		customers: { list: GovernanceManagementPage },
		'routing-rules': { list: RoutingRulesPage },
		'model-configs': { list: ModelLimitsPage },
		'provider-governance': { list: GovernanceManagementPage },
		'pricing-overrides': { list: GovernanceManagementPage },
		budgets: { list: ModelLimitsPage },
		'rate-limits': { list: ModelLimitsPage },
		webhooks: { list: WebhooksPage },
		'mcp-clients': { list: McpManagementPage },
		'mcp-library': { list: McpManagementPage },
		'mcp-sessions': { list: McpManagementPage },
		'oauth-grants': { list: McpManagementPage },
		'mcp-logs': { list: McpLogsPage },
		plugins: { list: PluginsPage },
		skills: { list: SkillsPage },
		'prompt-folders': { list: PromptRepositoryPage },
		prompts: { list: PromptRepositoryPage },
		'user-agent-mappings': { list: OperationalSettingsPage },
		'provider-keys': { list: ProvidersPage },
		'model-catalog': { list: ModelCatalogPage },
		'feature-flags': { list: OperationalSettingsPage },
		config: { list: ConfigPage },
		'client-settings': { list: ConfigPage },
		'compatibility-config': { list: ConfigPage },
		'caching-config': { list: CachingConfigPage },
		'security-config': { list: ConfigPage },
		'performance-config': { list: ConfigPage },
		'logging-config': { list: ConfigPage },
		'pricing-config': { list: ConfigPage },
		'observability-config': { list: ConfigPage },
		'mcp-settings': { list: McpSettingsPage },
		'mcp-gateway-config': { list: ConfigPage },
		'complexity-analyzer': { list: RoutingNetworkSettingsPage },
		'complexity-router': { list: RoutingNetworkSettingsPage },
		'proxy-config': { list: RoutingNetworkSettingsPage },
		'mcp-usage-guide': { list: McpUsageGuidePage },
		'docs-hub': { list: DocsHubPage },
		...(includeDevelopmentResources ? { pprof: { list: PprofPage } } : {}),
		connectors: { list: ObservabilityConnectorsPage },
		'usage-ledger': { list: UsageLedgerPage },
		'large-payload-config': { list: ConfigPage },
		'adaptive-routing': { list: RoutingRulesPage },
	};
	const runtimeFeaturePages = $derived.by(() =>
		pluginFeatureResourcePages(runtimeFeatureNames, enterpriseResourceNames, PluginsPage),
	);
	const resourcePages = $derived.by(() => ({
		...builtInResourcePages,
		...enterpriseFallbackResourcePages,
		...runtimeFeaturePages,
		...enterpriseResourcePages,
	}));

	onMount(() => {
		const refresh = () => { void refreshRuntimeFeatures(); };
		const syncHash = () => { currentHash = window.location.hash; };
		refresh();
		void refreshAppConfig();
		const unsubscribeBrand = onAppNameChange((name) => {
			currentAppName = name;
			registerElygateTranslations(name);
		});
		window.addEventListener(PLUGIN_CAPABILITIES_CHANGED_EVENT, refresh);
		window.addEventListener('hashchange', syncHash);
		return () => {
			window.removeEventListener(PLUGIN_CAPABILITIES_CHANGED_EVENT, refresh);
			window.removeEventListener('hashchange', syncHash);
			unsubscribeBrand();
		};
	});
</script>

{#key currentAppName}
	{#if publicRoute && EnterprisePublicPage}
		<EnterprisePublicPage route={enterprisePublicRoute!} />
	{:else if publicRoute === 'employee'}
		<EmployeePortalPage />
	{:else if publicRoute === 'oauth-consent'}
		<OAuthConsentPage />
	{:else if publicRoute === 'agent-handover' || publicRoute === 'scim-oauth-callback'}
		<EnterprisePublicFallbackPage route={publicRoute} />
	{:else if publicRoute}
		<McpAuthFlowPage route={publicRoute} />
	{:else}
		{#key `${currentLocale}:${currentHash}`}
			<AdminApp
				dataProvider={bifrostDataProvider}
				authProvider={bifrostAuthProvider}
				{resources}
				{menu}
				resourcePages={resourcePages}
				title={currentAppName}
				bind:locale={currentLocale}
				defaultTheme="system"
				themeConfig={{ layoutPreset: 'clean-flat' }}
				loginDefaults={{ hint: loginHint }}
			>
				{#snippet dashboard()}
					<DashboardPage />
				{/snippet}
			</AdminApp>
		{/key}

		{#key currentLocale}
			<PanelAssist locale={currentLocale} />
		{/key}

		{#if currentHash === '#/login'}
		<div class="locale-switcher" role="group" aria-label={labelFor(currentLocale, 'elygate.language')}>
			<button
				type="button"
				class={['locale-option', currentLocale === 'zh-CN' && 'is-active']}
				onclick={() => (currentLocale = 'zh-CN')}
			>简体中文</button>
			<button
				type="button"
				class={['locale-option', currentLocale === 'en' && 'is-active']}
				onclick={() => (currentLocale = 'en')}
			>English</button>
		</div>
		{/if}
	{/if}
{/key}

<style>
	:global(span[aria-hidden="true"].rounded-lg),
	:global(aside a.group > span[aria-hidden="true"]) {
		background-image: var(--app-logo, none);
		background-size: contain;
		background-position: center;
		background-repeat: no-repeat;
	}
	.locale-switcher {
		background: color-mix(in oklch, var(--card) 92%, transparent);
		border: 1px solid var(--border);
		border-radius: .65rem;
		display: flex;
		gap: .15rem;
		padding: .2rem;
		position: fixed;
		right: 1rem;
		top: 1rem;
		z-index: 50;
	}

	.locale-option {
		background: transparent;
		border: 0;
		border-radius: .45rem;
		color: var(--muted-foreground);
		cursor: pointer;
		font-size: .75rem;
		padding: .35rem .5rem;
	}

	.locale-option.is-active { background: var(--muted); color: var(--foreground); font-weight: 650; }
	:global([data-svadmin-system-error] button) { cursor: pointer; pointer-events: auto !important; }
</style>
