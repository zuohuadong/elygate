<script lang="ts">
	import { AdminApp } from '@svadmin/ui';
	import { configureRequestErrorFormatter } from './lib/api';
	import { createBifrostAuthProvider } from './lib/auth';
	import { bifrostDataProvider } from './lib/data-provider';
	import { labelFor, registerElygateTranslations, type ElygateLocale } from './lib/i18n';
	import { createMenu, createResources } from './lib/resources';
	import DashboardPage from './pages/DashboardPage.svelte';
	import BifrostResourcePage from './pages/BifrostResourcePage.svelte';
	import ConfigPage from './pages/ConfigPage.svelte';
	import EnterpriseFeaturePage from './pages/EnterpriseFeaturePage.svelte';
	import GenericAdminPage from './pages/GenericAdminPage.svelte';
	import JsonDocumentPage from './pages/JsonDocumentPage.svelte';
	import ProvidersPage from './pages/ProvidersPage.svelte';
	import VirtualKeysPage from './pages/VirtualKeysPage.svelte';

	registerElygateTranslations();

	function normalizeInitialHashRoute(): void {
		if (typeof window === 'undefined') return;
		const { hash, pathname, search } = window.location;
		if (hash || pathname === '/') return;

		const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
		window.history.replaceState(null, '', `/#${path}${search}`);
	}

	normalizeInitialHashRoute();

	let currentLocale = $state<ElygateLocale>('zh-CN');
	configureRequestErrorFormatter((status) => labelFor(currentLocale, 'elygate.requestFailed').replace('{status}', String(status)));
	const bifrostAuthProvider = createBifrostAuthProvider(() => currentLocale);
	const resources = $derived.by(() => createResources(currentLocale));
	const menu = $derived.by(() => createMenu(currentLocale));
	const loginHint = $derived(labelFor(currentLocale, 'elygate.loginHint'));

	const resourcePages = {
		providers: { list: ProvidersPage },
		'virtual-keys': { list: VirtualKeysPage },
		models: { list: BifrostResourcePage },
		logs: { list: BifrostResourcePage },
		teams: { list: GenericAdminPage },
		customers: { list: GenericAdminPage },
		'routing-rules': { list: GenericAdminPage },
		'model-configs': { list: GenericAdminPage },
		'provider-governance': { list: GenericAdminPage },
		'pricing-overrides': { list: GenericAdminPage },
		budgets: { list: GenericAdminPage },
		'rate-limits': { list: GenericAdminPage },
		webhooks: { list: GenericAdminPage },
		'mcp-sessions': { list: GenericAdminPage },
		'mcp-logs': { list: GenericAdminPage },
		plugins: { list: GenericAdminPage },
		skills: { list: GenericAdminPage },
		'prompt-folders': { list: GenericAdminPage },
		prompts: { list: GenericAdminPage },
		config: { list: ConfigPage },
		'complexity-analyzer': { list: JsonDocumentPage },
		users: { list: EnterpriseFeaturePage },
		'business-units': { list: EnterpriseFeaturePage },
		rbac: { list: EnterpriseFeaturePage },
		scim: { list: EnterpriseFeaturePage },
		'access-profiles': { list: EnterpriseFeaturePage },
		'audit-logs': { list: EnterpriseFeaturePage },
		alerting: { list: EnterpriseFeaturePage },
		guardrails: { list: EnterpriseFeaturePage },
		cluster: { list: EnterpriseFeaturePage },
		'circuit-breaker': { list: EnterpriseFeaturePage },
		'adaptive-routing': { list: EnterpriseFeaturePage },
	};
</script>

{#key currentLocale}
	<AdminApp
		dataProvider={bifrostDataProvider}
		authProvider={bifrostAuthProvider}
		{resources}
		{menu}
		resourcePages={resourcePages}
		title="Elygate"
		bind:locale={currentLocale}
		defaultTheme="light"
		themeConfig={{ layoutPreset: 'clean-flat' }}
		loginDefaults={{ hint: loginHint }}
	>
		{#snippet dashboard()}
			<DashboardPage />
		{/snippet}
	</AdminApp>
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
