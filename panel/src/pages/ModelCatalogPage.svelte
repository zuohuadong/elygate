<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getListPayload, getTotal, requestJson, type JsonRecord } from '../lib/api';
	import { displayError } from '../lib/forms';
	import { formatPagination, formatUsdCost } from '../lib/display-format';
	import {
		buildModelAttributes,
		displayModelsWithAliases,
		formatTokenPrice,
		ModelAttributeError,
		type ModelAttributeRow,
	} from '../lib/model-catalog';

	type CatalogTab = 'overview' | 'models';
	interface Provider extends JsonRecord { name: string; custom_provider_config?: { base_provider_type?: string }; }
	interface LogStats { total_requests?: number; total_cost?: number; }
	interface ModelHistogram { models?: string[]; }
	interface ModelDetails extends JsonRecord {
		name: string;
		provider: string;
		input_cost_per_token?: number;
		output_cost_per_token?: number;
		cache_creation_input_token_cost?: number;
		cache_read_input_token_cost?: number;
		additional_attributes?: Record<string, string>;
	}
	interface ProviderOverview { provider: Provider; requests: number; cost: number; models: string[]; }
	interface EditableAttributeRow extends ModelAttributeRow { id: number; }
	interface Props { resourceName: string; }

	const PAGE_SIZE = 25;
	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let tab = $state<CatalogTab>('overview');
	let providers = $state.raw<Provider[]>([]);
	let overviewRows = $state.raw<ProviderOverview[]>([]);
	let overviewProvider = $state('');
	let totalModels = $state(0);
	let globalStats = $state.raw<LogStats>({});
	let models = $state.raw<ModelDetails[]>([]);
	let modelTotal = $state(0);
	let query = $state('');
	let providerFilter = $state('');
	let offset = $state(0);
	let isOverviewLoading = $state(true);
	let isModelsLoading = $state(true);
	let isSaving = $state(false);
	let error = $state('');
	let notice = $state('');
	let editing = $state.raw<ModelDetails | null>(null);
	let description = $state('');
	let attributeRows = $state<EditableAttributeRow[]>([]);
	let nextRowId = 1;

	const filteredOverviewRows = $derived(overviewProvider
		? overviewRows.filter((row) => row.provider.name === overviewProvider)
		: overviewRows);
	const currentPage = $derived(Math.floor(offset / PAGE_SIZE) + 1);
	const totalPages = $derived(Math.max(1, Math.ceil(modelTotal / PAGE_SIZE)));

	function integer(value: number): string { return Math.round(value).toLocaleString(i18n.locale); }
	function currency(value: number): string { return formatUsdCost(value); }
	function customProvider(provider: Provider): string { return provider.custom_provider_config?.base_provider_type ? `${i18n.t('elygate.customProvider')} · ${provider.custom_provider_config.base_provider_type}` : i18n.t('elygate.builtInProvider'); }

	async function loadOverview(): Promise<void> {
		isOverviewLoading = true;
		error = '';
		try {
			const [providerPayload, modelPayload, stats] = await Promise.all([
				requestJson<unknown>('/api/providers'),
				requestJson<unknown>('/api/models?unfiltered=true&limit=0'),
				requestJson<LogStats>('/api/logs/stats?period=24h').catch((): LogStats => ({})),
			]);
			providers = getListPayload(providerPayload).filter((value): value is Provider => typeof value.name === 'string');
			totalModels = getTotal(modelPayload, getListPayload(modelPayload).length);
			globalStats = stats;
			overviewRows = await Promise.all(providers.map(async (provider) => {
				const encodedProvider = encodeURIComponent(provider.name);
				const [providerStats, histogram, keyPayload] = await Promise.all([
					requestJson<LogStats>(`/api/logs/stats?period=24h&providers=${encodedProvider}`).catch((): LogStats => ({})),
					requestJson<ModelHistogram>(`/api/logs/histogram/models?period=30d&providers=${encodedProvider}`).catch(() => ({ models: [] })),
					requestJson<unknown>(`/api/providers/${encodedProvider}/keys`).catch(() => []),
				]);
				return {
					provider,
					requests: providerStats.total_requests ?? 0,
					cost: providerStats.total_cost ?? 0,
					models: displayModelsWithAliases(histogram.models ?? [], getListPayload(keyPayload)),
				};
			}));
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isOverviewLoading = false;
		}
	}

	async function loadModels(reset = false): Promise<void> {
		if (reset) offset = 0;
		isModelsLoading = true;
		error = '';
		const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), unfiltered: 'true' });
		if (query.trim()) params.set('query', query.trim());
		if (providerFilter) params.set('provider', providerFilter);
		try {
			const payload = await requestJson<unknown>(`/api/models/details?${params.toString()}`);
			models = getListPayload(payload).filter((value): value is ModelDetails => typeof value.name === 'string' && typeof value.provider === 'string');
			modelTotal = getTotal(payload, models.length);
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isModelsLoading = false;
		}
	}

	function openEditor(model: ModelDetails): void {
		editing = model;
		description = model.additional_attributes?.description ?? '';
		attributeRows = Object.entries(model.additional_attributes ?? {})
			.filter(([key]) => key !== 'description')
			.map(([key, value]) => ({ id: nextRowId++, key, value }));
		notice = '';
	}

	function addAttributeRow(): void {
		attributeRows.push({ id: nextRowId++, key: '', value: '' });
	}

	function removeAttributeRow(id: number): void {
		attributeRows = attributeRows.filter((row) => row.id !== id);
	}

	function attributeError(cause: ModelAttributeError): string {
		if (cause.issue === 'missing-key') return i18n.t('elygate.attributeKeyRequired');
		if (cause.issue === 'reserved-key') return i18n.t('elygate.attributeDescriptionReserved');
		return i18n.t('elygate.attributeDuplicate').replace('{key}', cause.key);
	}

	async function saveAttributes(): Promise<void> {
		if (!editing) return;
		isSaving = true;
		error = '';
		try {
			const attributes = buildModelAttributes(description, attributeRows);
			await requestJson<void>('/api/models/catalog', {
				method: 'PUT',
				body: JSON.stringify([{ model: editing.name, provider: editing.provider, additional_attributes: attributes }]),
			});
			editing = null;
			notice = i18n.t('elygate.attributesSaved');
			await loadModels();
		} catch (cause) {
			error = cause instanceof ModelAttributeError ? attributeError(cause) : displayError(cause, i18n.t('elygate.saveFailed'));
		} finally {
			isSaving = false;
		}
	}

	async function switchTab(next: CatalogTab): Promise<void> {
		tab = next;
		if (next === 'models' && models.length === 0) await loadModels();
	}

	onMount(() => {
		void loadOverview();
		void loadModels();
	});
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading">
		<div><p class="eyebrow">Elygate / Models</p><h1>{i18n.t('elygate.modelCatalog')}</h1><p>{i18n.t('elygate.modelCatalogHint')}</p></div>
		<button type="button" class="primary" onclick={() => void (tab === 'overview' ? loadOverview() : loadModels())}>{i18n.t('elygate.refresh')}</button>
	</header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}

	<nav class="tabs" aria-label={i18n.t('elygate.modelCatalog')}>
		<button type="button" class:is-active={tab === 'overview'} onclick={() => void switchTab('overview')}>{i18n.t('elygate.providerOverview')}</button>
		<button type="button" class:is-active={tab === 'models'} onclick={() => void switchTab('models')}>{i18n.t('elygate.modelAttributes')}</button>
	</nav>

	{#if tab === 'overview'}
		<div class="metric-grid" aria-busy={isOverviewLoading}>
			<article><span>{i18n.t('elygate.providers')}</span><strong>{integer(providers.length)}</strong></article>
			<article><span>{i18n.t('elygate.models')}</span><strong>{integer(totalModels)}</strong></article>
			<article><span>{i18n.t('elygate.requests24h')}</span><strong>{integer(globalStats.total_requests ?? 0)}</strong></article>
			<article><span>{i18n.t('elygate.cost24h')}</span><strong>{currency(globalStats.total_cost ?? 0)}</strong></article>
		</div>
		<div class="toolbar"><label>{i18n.t('elygate.provider')}<select bind:value={overviewProvider}><option value="">{i18n.t('elygate.all')}</option>{#each providers as provider (provider.name)}<option value={provider.name}>{provider.name}</option>{/each}</select></label></div>
		<div class="table-wrap"><table><thead><tr><th>{i18n.t('elygate.provider')}</th><th>{i18n.t('elygate.providerType')}</th><th>{i18n.t('elygate.modelsUsed30d')}</th><th>{i18n.t('elygate.requests24h')}</th><th>{i18n.t('elygate.cost24h')}</th></tr></thead><tbody>
			{#each filteredOverviewRows as row (row.provider.name)}
				<tr><td><strong>{row.provider.name}</strong></td><td>{customProvider(row.provider)}</td><td><div class="chips">{#each row.models as model (model)}<span>{model}</span>{:else}—{/each}</div></td><td>{integer(row.requests)}</td><td>{currency(row.cost)}</td></tr>
			{:else}<tr><td colspan="5">{isOverviewLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</td></tr>{/each}
		</tbody></table></div>
	{:else}
		<form class="toolbar search" onsubmit={(event) => { event.preventDefault(); void loadModels(true); }}>
			<label>{i18n.t('elygate.search')}<input bind:value={query} placeholder={i18n.t('elygate.searchModels')} /></label>
			<label>{i18n.t('elygate.provider')}<select bind:value={providerFilter} onchange={() => void loadModels(true)}><option value="">{i18n.t('elygate.all')}</option>{#each providers as provider (provider.name)}<option value={provider.name}>{provider.name}</option>{/each}</select></label>
			<button type="submit">{i18n.t('elygate.search')}</button>
		</form>
		<div class="table-wrap"><table class="models-table"><thead><tr><th>{i18n.t('elygate.provider')}</th><th>{i18n.t('elygate.model')}</th><th>{i18n.t('elygate.inputPrice')}</th><th>{i18n.t('elygate.outputPrice')}</th><th>{i18n.t('elygate.cacheWritePrice')}</th><th>{i18n.t('elygate.cacheReadPrice')}</th><th>{i18n.t('elygate.description')}</th><th>{i18n.t('elygate.attributes')}</th><th></th></tr></thead><tbody>
			{#each models as model (`${model.provider}:${model.name}`)}
				<tr><td>{model.provider}</td><td><strong class="model-name">{model.name}</strong></td><td>{formatTokenPrice(model.input_cost_per_token, i18n.locale)}</td><td>{formatTokenPrice(model.output_cost_per_token, i18n.locale)}</td><td>{formatTokenPrice(model.cache_creation_input_token_cost, i18n.locale)}</td><td>{formatTokenPrice(model.cache_read_input_token_cost, i18n.locale)}</td><td class="description">{model.additional_attributes?.description ?? '—'}</td><td>{Math.max(0, Object.keys(model.additional_attributes ?? {}).length - (model.additional_attributes?.description ? 1 : 0))}</td><td><button type="button" onclick={() => openEditor(model)}>{i18n.t('elygate.edit')}</button></td></tr>
			{:else}<tr><td colspan="9">{isModelsLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</td></tr>{/each}
		</tbody></table></div>
		<footer class="pagination"><span>{formatPagination(currentPage, totalPages, modelTotal, i18n.locale)}</span><div><button type="button" disabled={offset === 0 || isModelsLoading} onclick={() => { offset = Math.max(0, offset - PAGE_SIZE); void loadModels(); }}>{i18n.t('elygate.previous')}</button><button type="button" disabled={offset + PAGE_SIZE >= modelTotal || isModelsLoading} onclick={() => { offset += PAGE_SIZE; void loadModels(); }}>{i18n.t('elygate.next')}</button></div></footer>
	{/if}
</section>

{#if editing}
	<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !isSaving) editing = null; }}>
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="model-attribute-title">
			<header><div><h2 id="model-attribute-title">{i18n.t('elygate.editModelAttributes')}</h2><p>{editing.provider} / <code>{editing.name}</code></p></div><button type="button" aria-label={i18n.t('elygate.close')} onclick={() => (editing = null)}>×</button></header>
			<div class="pricing-grid"><article><span>{i18n.t('elygate.inputPrice')}</span><strong>{formatTokenPrice(editing.input_cost_per_token, i18n.locale)}</strong></article><article><span>{i18n.t('elygate.outputPrice')}</span><strong>{formatTokenPrice(editing.output_cost_per_token, i18n.locale)}</strong></article><article><span>{i18n.t('elygate.cacheWritePrice')}</span><strong>{formatTokenPrice(editing.cache_creation_input_token_cost, i18n.locale)}</strong></article><article><span>{i18n.t('elygate.cacheReadPrice')}</span><strong>{formatTokenPrice(editing.cache_read_input_token_cost, i18n.locale)}</strong></article></div>
			<label>{i18n.t('elygate.description')}<textarea bind:value={description} rows="4" placeholder={i18n.t('elygate.modelDescriptionHint')}></textarea></label>
			<div class="attribute-heading"><strong>{i18n.t('elygate.otherAttributes')}</strong><button type="button" onclick={addAttributeRow}>+ {i18n.t('elygate.add')}</button></div>
			<div class="attribute-list">{#each attributeRows as row (row.id)}<div><input bind:value={row.key} placeholder={i18n.t('elygate.attributeKey')} /><input bind:value={row.value} placeholder={i18n.t('elygate.attributeValue')} /><button type="button" aria-label={i18n.t('elygate.delete')} onclick={() => removeAttributeRow(row.id)}>×</button></div>{:else}<p>{i18n.t('elygate.noOtherAttributes')}</p>{/each}</div>
			<footer><a href={`https://getbifrost.ai/datasheet?model=${encodeURIComponent(editing.name)}`} target="_blank" rel="noreferrer">{i18n.t('elygate.pricingSource')}</a><div><button type="button" onclick={() => (editing = null)}>{i18n.t('elygate.cancel')}</button><button class="primary" type="button" disabled={isSaving} onclick={() => void saveAttributes()}>{isSaving ? i18n.t('elygate.saving') : i18n.t('elygate.save')}</button></div></footer>
		</div>
	</div>
{/if}

<style>
	.page-shell { max-width: 1320px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: start; display: flex; gap: 1rem; justify-content: space-between; }
	.page-heading h1 { font-size: clamp(1.5rem, 3vw, 2.1rem); margin: 0; }
	.page-heading p { color: var(--muted-foreground); margin: .55rem 0 0; max-width: 760px; }
	.eyebrow { color: var(--primary) !important; font-size: .75rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
	button, input, select, textarea { border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); font: inherit; }
	button, select { background: var(--muted); cursor: pointer; padding: .55rem .7rem; }
	button.primary, button.is-active { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button:disabled { cursor: wait; opacity: .55; }
	input, textarea { background: var(--background); padding: .6rem .7rem; }
	.tabs { border-bottom: 1px solid var(--border); display: flex; gap: .45rem; margin: 1.15rem 0; padding-bottom: .65rem; }
	.metric-grid { display: grid; gap: .75rem; grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.metric-grid article, .pricing-grid article { background: var(--card); border: 1px solid var(--border); border-radius: .75rem; padding: .9rem; }
	.metric-grid span, .pricing-grid span { color: var(--muted-foreground); display: block; font-size: .78rem; }
	.metric-grid strong { display: block; font-size: 1.45rem; margin-top: .35rem; }
	.toolbar { align-items: end; display: flex; flex-wrap: wrap; gap: .65rem; margin: 1rem 0 .75rem; }
	.toolbar label, .modal > label { color: var(--muted-foreground); display: grid; font-size: .78rem; gap: .35rem; }
	.toolbar input { min-width: min(360px, 70vw); }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; overflow-x: auto; }
	table { border-collapse: collapse; min-width: 920px; width: 100%; }
	.models-table { min-width: 1250px; }
	th, td { border-bottom: 1px solid var(--border); font-size: .8rem; padding: .7rem .8rem; text-align: left; vertical-align: top; }
	th { color: var(--muted-foreground); }
	.model-name { font-family: ui-monospace, monospace; }
	.description { max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.chips { display: flex; flex-wrap: wrap; gap: .3rem; max-width: 500px; }
	.chips span { background: var(--muted); border-radius: 999px; font-size: .72rem; padding: .2rem .45rem; }
	.pagination { align-items: center; display: flex; justify-content: space-between; margin-top: .75rem; }
	.pagination div { align-items: center; display: flex; gap: .6rem; }
	.notice { border-radius: .65rem; margin-top: .85rem; padding: .75rem 1rem; }
	.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.success { background: color-mix(in oklch, var(--primary) 10%, transparent); color: var(--primary); }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .5); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; box-shadow: 0 20px 70px rgb(0 0 0 / .3); display: grid; gap: 1rem; max-height: 92vh; max-width: 760px; overflow: auto; padding: 1.1rem; width: 100%; }
	.modal header, .modal footer, .attribute-heading { align-items: center; display: flex; justify-content: space-between; }
	.modal h2 { margin: 0; }
	.modal header p { color: var(--muted-foreground); margin: .35rem 0 0; }
	.modal header > button { font-size: 1.2rem; }
	.pricing-grid { display: grid; gap: .55rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.pricing-grid strong { display: block; font-size: .85rem; margin-top: .3rem; }
	.modal textarea { resize: vertical; }
	.attribute-list { display: grid; gap: .5rem; }
	.attribute-list > div { display: grid; gap: .45rem; grid-template-columns: 1fr 1fr auto; }
	.attribute-list p { color: var(--muted-foreground); font-size: .8rem; }
	.modal footer { border-top: 1px solid var(--border); padding-top: .9rem; }
	.modal footer > div { display: flex; gap: .5rem; }
	.modal a { color: var(--primary); font-size: .8rem; }
	@media (max-width: 800px) { .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .page-heading { flex-direction: column; } }
	@media (max-width: 520px) { .metric-grid, .pricing-grid { grid-template-columns: 1fr; } .attribute-list > div { grid-template-columns: 1fr auto; } .attribute-list > div input:first-child { grid-column: 1 / -1; } .modal footer { align-items: stretch; flex-direction: column; } }
</style>
