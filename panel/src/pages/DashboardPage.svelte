<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getListPayload, requestJson, type JsonRecord } from '../lib/api';

	interface DashboardState {
		providers: JsonRecord[];
		virtualKeys: JsonRecord[];
		models: JsonRecord[];
	}

	const i18n = useTranslation();
	let dashboard: DashboardState = $state.raw({ providers: [], virtualKeys: [], models: [] });
	let isLoading = $state(true);
	let error = $state('');
	let updatedAt = $state('');

	const activeProviders = $derived(dashboard.providers.filter((provider) => provider.provider_status === 'active').length);
	const locale = $derived(i18n.locale === 'zh-CN' ? 'zh-CN' : 'en-US');

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const [providers, virtualKeys, models] = await Promise.all([
				requestJson('/api/providers'),
				requestJson('/api/governance/virtual-keys'),
				// Bifrost defaults /api/models to five records; zero deliberately requests the full management list.
				requestJson('/api/models?limit=0'),
			]);
			dashboard = {
				providers: getListPayload(providers),
				virtualKeys: getListPayload(virtualKeys),
				models: getListPayload(models),
			};
			updatedAt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
		} catch (cause) {
			error = cause instanceof Error ? cause.message : i18n.t('elygate.loadFailed');
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		void load();
	});
</script>

<section class="page-shell">
	<header class="page-heading">
		<div>
			<p class="eyebrow">Elygate</p>
			<h1>{i18n.t('elygate.dashboard')}</h1>
			<p>{i18n.t('elygate.securityNotice')}</p>
		</div>
		<button type="button" onclick={() => void load()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button>
	</header>

	{#if error}
		<div class="notice error" role="alert">{error}</div>
	{/if}

	<div class="metric-grid" aria-busy={isLoading}>
		<article>
			<span>{i18n.t('elygate.providerCount')}</span>
			<strong>{dashboard.providers.length}</strong>
		</article>
		<article>
			<span>{i18n.t('elygate.activeProviderCount')}</span>
			<strong>{activeProviders}</strong>
		</article>
		<article>
			<span>{i18n.t('elygate.virtualKeyCount')}</span>
			<strong>{dashboard.virtualKeys.length}</strong>
		</article>
		<article>
			<span>{i18n.t('elygate.modelCount')}</span>
			<strong>{dashboard.models.length}</strong>
		</article>
	</div>

	<p class="updated">{i18n.t('elygate.lastUpdated')}: {updatedAt || '—'}</p>
</section>

<style>
	.page-shell { max-width: 1120px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { display: flex; align-items: start; justify-content: space-between; gap: 1rem; margin-bottom: 1.75rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 .5rem; }
	h1 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.15rem); letter-spacing: -.03em; }
	h1 + p { max-width: 680px; color: var(--muted-foreground); margin: .7rem 0 0; line-height: 1.6; }
	button { border: 0; border-radius: .7rem; background: var(--primary); color: var(--primary-foreground); cursor: pointer; font-weight: 650; padding: .7rem 1rem; white-space: nowrap; }
	button:disabled { cursor: wait; opacity: .55; }
	.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; }
	.metric-grid article { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; box-shadow: 0 1px 2px rgb(0 0 0 / .04); padding: 1.2rem; }
	.metric-grid span, .updated { color: var(--muted-foreground); font-size: .875rem; }
	.metric-grid strong { display: block; font-size: 2rem; letter-spacing: -.04em; margin-top: .55rem; }
	.notice { border-radius: .75rem; margin-bottom: 1rem; padding: .85rem 1rem; }
	.error { background: color-mix(in oklch, var(--destructive) 9%, transparent); color: var(--destructive); }
	.updated { margin-top: 1rem; }
	@media (max-width: 720px) { .page-heading { flex-direction: column; } .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
