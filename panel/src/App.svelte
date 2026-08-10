<script lang="ts">
	import { onMount } from 'svelte';
	import { AdminApp } from '@svadmin/ui';
	import * as enterprisePanel from '@elygate/enterprise-panel';
	import { ApiError, configureRequestErrorFormatter, getListPayload, requestJson } from './lib/api';
	import { createBifrostAuthProvider } from './lib/auth';
	import { bifrostDataProvider } from './lib/data-provider';
	import { labelFor, registerElygateTranslations, type ElygateLocale } from './lib/i18n';
	import { pluginFeatureResourcePages } from './lib/menu-policy';
	import { resolvePublicPanelRoute } from './lib/public-routes';
	import {
		activePluginFeatures,
		managedPluginFromRecord,
		PLUGIN_CAPABILITIES_CHANGED_EVENT,
	} from './lib/plugin-management';
	import { createMenu, createResources } from './lib/resources';
	import DashboardPage from './pages/DashboardPage.svelte';
	import BifrostResourcePage from './pages/BifrostResourcePage.svelte';
	import CachingConfigPage from './pages/CachingConfigPage.svelte';
	import ConfigPage from './pages/ConfigPage.svelte';
	import DocsHubPage from './pages/DocsHubPage.svelte';
	import EnterpriseFeaturePage from './pages/EnterpriseFeaturePage.svelte';
	import EnterprisePublicFallbackPage from './pages/EnterprisePublicFallbackPage.svelte';
	import GovernanceManagementPage from './pages/GovernanceManagementPage.svelte';
	import LogsPage from './pages/LogsPage.svelte';
	import McpLogsPage from './pages/McpLogsPage.svelte';
	import McpManagementPage from './pages/McpManagementPage.svelte';
	import McpUsageGuidePage from './pages/McpUsageGuidePage.svelte';
	import McpAuthFlowPage from './pages/McpAuthFlowPage.svelte';
	import ModelCatalogPage from './pages/ModelCatalogPage.svelte';
	import ModelLimitsPage from './pages/ModelLimitsPage.svelte';
	import OAuthConsentPage from './pages/OAuthConsentPage.svelte';
	import ObservabilityConnectorsPage from './pages/ObservabilityConnectorsPage.svelte';
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

	function normalizeInitialHashRoute(): void {
		if (typeof window === 'undefined') return;
		const { hash, pathname, search } = window.location;
		if (hash || pathname === '/') return;

		const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
		window.history.replaceState(null, '', `/#${path}${search}`);
	}

	const publicRoute = typeof window !== 'undefined' ? resolvePublicPanelRoute(window.location.pathname) : null;
	if (!publicRoute) normalizeInitialHashRoute();
	const enterpriseResourcePages = enterprisePanel.enterpriseResourcePages ?? {};
	const enterprisePublicPages = enterprisePanel.enterprisePublicPages ?? {};
	const EnterprisePublicPage = publicRoute ? enterprisePublicPages[publicRoute] : undefined;
	const includeDevelopmentResources = import.meta.env.DEV;

	let currentLocale = $state<ElygateLocale>('zh-CN');
	let runtimeFeatureNames = $state.raw<string[]>([]);
	const enterprisePageNames = Object.keys(enterpriseResourcePages);
	const availableEnterpriseResources = $derived([...new Set([...enterprisePageNames, ...runtimeFeatureNames])]);

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
	const resources = $derived.by(() => createResources(currentLocale, includeDevelopmentResources));
	const menu = $derived.by(() => createMenu(currentLocale, availableEnterpriseResources, includeDevelopmentResources));
	const loginHint = $derived(labelFor(currentLocale, 'elygate.loginHint'));

	const builtInResourcePages = {
		providers: { list: ProvidersPage },
		'virtual-keys': { list: VirtualKeysPage },
		models: { list: BifrostResourcePage },
		logs: { list: LogsPage },
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
		'mcp-settings': { list: ConfigPage },
		'mcp-gateway-config': { list: ConfigPage },
		'complexity-analyzer': { list: RoutingNetworkSettingsPage },
		'complexity-router': { list: RoutingNetworkSettingsPage },
		'proxy-config': { list: RoutingNetworkSettingsPage },
		'mcp-usage-guide': { list: McpUsageGuidePage },
		'docs-hub': { list: DocsHubPage },
		...(includeDevelopmentResources ? { pprof: { list: PprofPage } } : {}),
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
		guardrails: { list: EnterpriseFeaturePage },
		'guardrails-config': { list: PluginsPage },
		'guardrails-providers': { list: PluginsPage },
		'edge-devices': { list: EnterpriseFeaturePage },
		'edge-inventory': { list: EnterpriseFeaturePage },
		'edge-config': { list: EnterpriseFeaturePage },
		connectors: { list: ObservabilityConnectorsPage },
		'mcp-tool-groups': { list: EnterpriseFeaturePage },
		'mcp-auth-config': { list: EnterpriseFeaturePage },
		'api-keys': { list: EnterpriseFeaturePage },
		'large-payload-config': { list: ConfigPage },
		'license-info': { list: EnterpriseFeaturePage },
		cluster: { list: PluginsPage },
		'circuit-breaker': { list: PluginsPage },
		'adaptive-routing': { list: RoutingRulesPage },
		'agent-handover': { list: EnterpriseFeaturePage },
	};
	const runtimeFeaturePages = $derived.by(() => pluginFeatureResourcePages(runtimeFeatureNames, PluginsPage));
	const resourcePages = $derived.by(() => ({
		...builtInResourcePages,
		...runtimeFeaturePages,
		...enterpriseResourcePages,
	}));

	onMount(() => {
		const refresh = () => { void refreshRuntimeFeatures(); };
		refresh();
		window.addEventListener(PLUGIN_CAPABILITIES_CHANGED_EVENT, refresh);
		return () => window.removeEventListener(PLUGIN_CAPABILITIES_CHANGED_EVENT, refresh);
	});
</script>

{#if publicRoute && EnterprisePublicPage}
	<EnterprisePublicPage route={publicRoute} />
{:else if publicRoute === 'oauth-consent'}
	<OAuthConsentPage />
{:else if publicRoute === 'agent-handover' || publicRoute === 'scim-oauth-callback'}
	<EnterprisePublicFallbackPage route={publicRoute} />
{:else if publicRoute}
	<McpAuthFlowPage route={publicRoute} />
{:else}
	{#key currentLocale}
		<AdminApp
		dataProvider={bifrostDataProvider}
		authProvider={bifrostAuthProvider}
		{resources}
		{menu}
		resourcePages={resourcePages}
		title="Elygate"
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

<style>
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
</style>
