<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount, tick } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Save, Search, Trash2, X } from '@lucide/svelte';
	import { getListPayload, getTotal, requestJson, type JsonRecord } from '../lib/api';
	import { displayError } from '../lib/forms';
	import { formatPagination, formatUsdCost } from '../lib/display-format';
	import {
		buildModelAttributes,
		displayModelsWithAliases,
		formatTokenPrice,
		ModelAttributeError,
		MODEL_GOVERNANCE_KEYS,
		readModelAttributes,
		type ModelGovernanceFields,
		type ModelGovernanceKey,
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
	let editorError = $state('');
	let notice = $state('');
	let editing = $state.raw<ModelDetails | null>(null);
	let description = $state('');
	let governance = $state<ModelGovernanceFields>({ region: '', data_class: '', capabilities: '', health: '' });
	let attributeRows = $state<EditableAttributeRow[]>([]);
	let modalElement = $state<HTMLDivElement | null>(null);
	let returnFocusElement = $state<HTMLElement | null>(null);
	let editorErrorElement = $state<HTMLDivElement | null>(null);
	let nextRowId = 1;
	let overviewLoadSeq = 0;
	let modelsLoadSeq = 0;
	function governanceEntries(model: ModelDetails): { key: ModelGovernanceKey; value: string }[] {
		const fields = readModelAttributes(model.additional_attributes ?? {}).governance;
		return MODEL_GOVERNANCE_KEYS.flatMap((key) => fields[key] ? [{ key, value: fields[key] }] : []);
	}

	const filteredOverviewRows = $derived(overviewProvider
		? overviewRows.filter((row) => row.provider.name === overviewProvider)
		: overviewRows);
	const currentPage = $derived(Math.floor(offset / PAGE_SIZE) + 1);
	const totalPages = $derived(Math.max(1, Math.ceil(modelTotal / PAGE_SIZE)));

	function integer(value: number): string { return Math.round(value).toLocaleString(i18n.locale); }
	function currency(value: number): string { return formatUsdCost(value); }
	function customProvider(provider: Provider): string { return provider.custom_provider_config?.base_provider_type ? `${i18n.t('elygate.customProvider')} · ${provider.custom_provider_config.base_provider_type}` : i18n.t('elygate.builtInProvider'); }

	async function loadOverview(): Promise<void> {
		const sequence = ++overviewLoadSeq;
		isOverviewLoading = true;
		error = '';
		try {
			const [providerPayload, modelPayload, stats] = await Promise.all([
				requestJson<unknown>('/api/providers'),
				requestJson<unknown>('/api/models?unfiltered=true&limit=0'),
				requestJson<LogStats>('/api/logs/stats?period=24h').catch((): LogStats => ({})),
			]);
			const nextProviders = getListPayload(providerPayload).filter((value): value is Provider => typeof value.name === 'string');
			const nextTotalModels = getTotal(modelPayload, getListPayload(modelPayload).length);
			const nextOverviewRows = await Promise.all(nextProviders.map(async (provider) => {
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
			if (sequence !== overviewLoadSeq) return;
			providers = nextProviders;
			totalModels = nextTotalModels;
			globalStats = stats;
			overviewRows = nextOverviewRows;
		} catch (cause) {
			if (sequence === overviewLoadSeq) error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			if (sequence === overviewLoadSeq) isOverviewLoading = false;
		}
	}

	async function loadModels(reset = false): Promise<void> {
		if (reset) offset = 0;
		const sequence = ++modelsLoadSeq;
		const requestedOffset = offset;
		const requestedQuery = query.trim();
		const requestedProvider = providerFilter;
		isModelsLoading = true;
		error = '';
		const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(requestedOffset), unfiltered: 'true' });
		if (requestedQuery) params.set('query', requestedQuery);
		if (requestedProvider) params.set('provider', requestedProvider);
		try {
			const payload = await requestJson<unknown>(`/api/models/details?${params.toString()}`);
			if (sequence !== modelsLoadSeq || offset !== requestedOffset || query.trim() !== requestedQuery || providerFilter !== requestedProvider) return;
			const nextModels = getListPayload(payload).filter((value): value is ModelDetails => typeof value.name === 'string' && typeof value.provider === 'string');
			models = nextModels;
			modelTotal = getTotal(payload, nextModels.length);
		} catch (cause) {
			if (sequence === modelsLoadSeq && offset === requestedOffset && query.trim() === requestedQuery && providerFilter === requestedProvider) error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			if (sequence === modelsLoadSeq) isModelsLoading = false;
		}
	}

	function openEditor(model: ModelDetails): void {
		if (isSaving) return;
		if (document.activeElement instanceof HTMLElement) returnFocusElement = document.activeElement;
		editing = model;
		const attributes = readModelAttributes(model.additional_attributes ?? {});
		description = attributes.description;
		governance = attributes.governance;
		attributeRows = attributes.rows.map((row) => ({ id: nextRowId++, ...row }));
		notice = '';
		editorError = '';
		void tick().then(() => (focusableElements()[0] ?? modalElement)?.focus());
	}

	function closeEditor(): void {
		if (isSaving) return;
		finishClosingEditor();
	}

	function finishClosingEditor(): void {
		editing = null;
		void tick().then(() => {
			returnFocusElement?.focus();
			returnFocusElement = null;
		});
	}

	function focusableElements(): HTMLElement[] {
		if (!modalElement) return [];
		return Array.from(modalElement.querySelectorAll<HTMLElement>(
			'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
		)).filter((element) => !element.hidden);
	}

	function handleModalKeydown(event: KeyboardEvent): void {
		if (!editing) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			closeEditor();
			return;
		}
		if (event.key !== 'Tab') return;
		const elements = focusableElements();
		if (elements.length === 0) {
			event.preventDefault();
			modalElement?.focus();
			return;
		}
		const first = elements[0];
		const last = elements[elements.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function addAttributeRow(): void {
		attributeRows.push({ id: nextRowId++, key: '', value: '' });
	}

	function removeAttributeRow(id: number): void {
		attributeRows = attributeRows.filter((row) => row.id !== id);
	}

	function attributeError(cause: ModelAttributeError): string {
		if (cause.issue === 'missing-key') return i18n.t('elygate.attributeKeyRequired');
		if (cause.issue === 'reserved-key') return cause.key === 'description'
			? i18n.t('elygate.attributeDescriptionReserved')
			: i18n.t('elygate.attributeStructuredReserved').replace('{key}', cause.key);
		return i18n.t('elygate.attributeDuplicate').replace('{key}', cause.key);
	}

	async function saveAttributes(): Promise<void> {
		if (!editing || isSaving) return;
		const editingSnapshot = { name: editing.name, provider: editing.provider };
		isSaving = true;
		editorError = '';
		try {
			const attributes = buildModelAttributes(description, attributeRows, governance);
			await requestJson<void>('/api/models/catalog', {
				method: 'PUT',
				body: JSON.stringify([{ model: editingSnapshot.name, provider: editingSnapshot.provider, additional_attributes: attributes }]),
			});
			if (editing?.name === editingSnapshot.name && editing?.provider === editingSnapshot.provider) {
				finishClosingEditor();
				notice = i18n.t('elygate.attributesSaved');
				await loadModels();
			}
		} catch (cause) {
			editorError = cause instanceof ModelAttributeError ? attributeError(cause) : displayError(cause, i18n.t('elygate.saveFailed'));
			void tick().then(() => editorErrorElement?.focus());
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
		return () => { overviewLoadSeq += 1; modelsLoadSeq += 1; };
	});
</script>

<svelte:window onkeydown={handleModalKeydown} />

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading">
		<div><p class="eyebrow">{getAppName()} / {i18n.t('elygate.models')}</p><h1>{i18n.t('elygate.modelCatalog')}</h1><p>{i18n.t('elygate.modelCatalogHint')}</p></div>
		<button type="button" class="icon-button" title={i18n.t('elygate.refresh')} aria-label={i18n.t('elygate.refresh')} onclick={() => void (tab === 'overview' ? loadOverview() : loadModels())}><RefreshCw size={18} aria-hidden="true" /></button>
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
			<button type="submit"><Search size={16} aria-hidden="true" />{i18n.t('elygate.search')}</button>
		</form>
		<div class="table-wrap"><table class="models-table"><thead><tr><th>{i18n.t('elygate.provider')}</th><th>{i18n.t('elygate.model')}</th><th>{i18n.t('elygate.inputPrice')}</th><th>{i18n.t('elygate.outputPrice')}</th><th>{i18n.t('elygate.cacheWritePrice')}</th><th>{i18n.t('elygate.cacheReadPrice')}</th><th>{i18n.t('elygate.description')}</th><th>{i18n.t('elygate.modelGovernance')}</th><th>{i18n.t('elygate.attributes')}</th><th></th></tr></thead><tbody>
			{#each models as model (`${model.provider}:${model.name}`)}
				<tr><td>{model.provider}</td><td><strong class="model-name">{model.name}</strong></td><td>{formatTokenPrice(model.input_cost_per_token, i18n.locale)}</td><td>{formatTokenPrice(model.output_cost_per_token, i18n.locale)}</td><td>{formatTokenPrice(model.cache_creation_input_token_cost, i18n.locale)}</td><td>{formatTokenPrice(model.cache_read_input_token_cost, i18n.locale)}</td><td class="description">{model.additional_attributes?.description ?? '—'}</td><td><dl class="governance-summary">{#each governanceEntries(model) as field (field.key)}<div><dt>{i18n.t(`elygate.modelGovernance.${field.key}`)}</dt><dd>{field.value}</dd></div>{:else}—{/each}</dl></td><td>{Object.keys(model.additional_attributes ?? {}).filter((key) => key !== 'description').length}</td><td><button type="button" class="icon-button" title={i18n.t('elygate.edit')} aria-label={`${i18n.t('elygate.edit')} ${model.name}`} disabled={isSaving} onclick={() => openEditor(model)}><Pencil size={16} aria-hidden="true" /></button></td></tr>
			{:else}<tr><td colspan="10">{isModelsLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</td></tr>{/each}
		</tbody></table></div>
		<footer class="pagination"><span>{formatPagination(currentPage, totalPages, modelTotal, i18n.locale)}</span><div><button type="button" class="icon-button" title={i18n.t('elygate.previous')} aria-label={i18n.t('elygate.previous')} disabled={offset === 0 || isModelsLoading} onclick={() => { offset = Math.max(0, offset - PAGE_SIZE); void loadModels(); }}><ChevronLeft size={18} aria-hidden="true" /></button><button type="button" class="icon-button" title={i18n.t('elygate.next')} aria-label={i18n.t('elygate.next')} disabled={offset + PAGE_SIZE >= modelTotal || isModelsLoading} onclick={() => { offset += PAGE_SIZE; void loadModels(); }}><ChevronRight size={18} aria-hidden="true" /></button></div></footer>
	{/if}
</section>

{#if editing}
	<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
		<div bind:this={modalElement} class="modal" role="dialog" aria-modal="true" aria-labelledby="model-attribute-title" tabindex="-1">
			<header><div><h2 id="model-attribute-title">{i18n.t('elygate.editModelAttributes')}</h2><p>{editing.provider} / <code>{editing.name}</code></p></div><button type="button" class="icon-button" title={i18n.t('elygate.close')} aria-label={i18n.t('elygate.close')} disabled={isSaving} onclick={closeEditor}><X size={18} aria-hidden="true" /></button></header>
			{#if editorError}<div bind:this={editorErrorElement} class="notice error" role="alert" tabindex="-1">{editorError}</div>{/if}
			<div class="pricing-grid"><article><span>{i18n.t('elygate.inputPrice')}</span><strong>{formatTokenPrice(editing.input_cost_per_token, i18n.locale)}</strong></article><article><span>{i18n.t('elygate.outputPrice')}</span><strong>{formatTokenPrice(editing.output_cost_per_token, i18n.locale)}</strong></article><article><span>{i18n.t('elygate.cacheWritePrice')}</span><strong>{formatTokenPrice(editing.cache_creation_input_token_cost, i18n.locale)}</strong></article><article><span>{i18n.t('elygate.cacheReadPrice')}</span><strong>{formatTokenPrice(editing.cache_read_input_token_cost, i18n.locale)}</strong></article></div>
			<label>{i18n.t('elygate.description')}<textarea bind:value={description} rows="4" placeholder={i18n.t('elygate.modelDescriptionHint')} disabled={isSaving}></textarea></label>
			<fieldset class="governance-fields" disabled={isSaving}><legend>{i18n.t('elygate.modelGovernanceAnnotations')}</legend><div>{#each MODEL_GOVERNANCE_KEYS as key (key)}<label>{i18n.t(`elygate.modelGovernance.${key}`)}<textarea rows={key === 'capabilities' ? 2 : 1} bind:value={governance[key]}></textarea></label>{/each}</div></fieldset>
			<div class="attribute-heading"><strong>{i18n.t('elygate.otherAttributes')}</strong><button type="button" class="icon-button" title={i18n.t('elygate.add')} aria-label={i18n.t('elygate.add')} disabled={isSaving} onclick={addAttributeRow}><Plus size={18} aria-hidden="true" /></button></div>
			<div class="attribute-list">{#each attributeRows as row, index (row.id)}<div><label>{i18n.t('elygate.attributeKey')}<input bind:value={row.key} disabled={isSaving} /></label><label>{i18n.t('elygate.attributeValue')}<input bind:value={row.value} disabled={isSaving} /></label><button type="button" class="icon-button" title={i18n.t('elygate.delete')} aria-label={`${i18n.t('elygate.delete')} ${index + 1}`} disabled={isSaving} onclick={() => removeAttributeRow(row.id)}><Trash2 size={16} aria-hidden="true" /></button></div>{:else}<p>{i18n.t('elygate.noOtherAttributes')}</p>{/each}</div>
			<footer><a href={`https://getbifrost.ai/datasheet?model=${encodeURIComponent(editing.name)}`} target="_blank" rel="noreferrer">{i18n.t('elygate.pricingSource')}</a><div><button type="button" disabled={isSaving} onclick={closeEditor}>{i18n.t('elygate.cancel')}</button><button class="primary" type="button" disabled={isSaving} onclick={() => void saveAttributes()}><Save size={16} aria-hidden="true" />{isSaving ? i18n.t('elygate.saving') : i18n.t('elygate.save')}</button></div></footer>
		</div>
	</div>
{/if}

<style>
	.page-shell { max-width: 1320px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: start; display: flex; gap: 1rem; justify-content: space-between; }
	.page-heading h1 { font-size: 1.65rem; margin: 0; }
	.page-heading p { color: var(--muted-foreground); margin: .55rem 0 0; max-width: 760px; }
	.eyebrow { color: var(--primary) !important; font-size: .75rem; font-weight: 700; letter-spacing: 0; text-transform: uppercase; }
	button, input, select, textarea { border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); font: inherit; min-width: 0; }
	button, select { background: var(--muted); cursor: pointer; padding: .55rem .7rem; }
	button { align-items: center; display: inline-flex; gap: .4rem; justify-content: center; min-height: 40px; }
	button.icon-button { flex: 0 0 40px; height: 40px; padding: 0; width: 40px; }
	button.primary, button.is-active { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button:disabled { cursor: wait; opacity: .55; }
	input, textarea { background: var(--background); padding: .6rem .7rem; }
	.tabs { border-bottom: 1px solid var(--border); display: flex; gap: .45rem; margin: 1.15rem 0; padding-bottom: .65rem; }
	.metric-grid { display: grid; gap: .75rem; grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.metric-grid article { background: var(--card); border: 1px solid var(--border); border-radius: .5rem; padding: .9rem; }
	.pricing-grid article { min-width: 0; }
	.metric-grid span, .pricing-grid span { color: var(--muted-foreground); display: block; font-size: .78rem; }
	.metric-grid strong { display: block; font-size: 1.45rem; margin-top: .35rem; }
	.toolbar { align-items: end; display: flex; flex-wrap: wrap; gap: .65rem; margin: 1rem 0 .75rem; }
	.toolbar label, .modal > label { color: var(--muted-foreground); display: grid; font-size: .78rem; gap: .35rem; }
	.toolbar input { min-width: min(360px, 70vw); }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .5rem; overflow-x: auto; }
	table { border-collapse: collapse; min-width: 920px; width: 100%; }
	.models-table { min-width: 1250px; }
	th, td { border-bottom: 1px solid var(--border); font-size: .8rem; padding: .7rem .8rem; text-align: left; vertical-align: top; }
	th { color: var(--muted-foreground); }
	.model-name { font-family: ui-monospace, monospace; }
	.governance-summary { display: grid; gap: .4rem; margin: 0; min-width: 180px; max-width: 280px; }
	.governance-summary dt { color: var(--muted-foreground); font-size: .72rem; }
	.governance-summary dd { margin: .1rem 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }
	.description { max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.chips { display: flex; flex-wrap: wrap; gap: .3rem; max-width: 500px; }
	.chips span { background: var(--muted); border-radius: 999px; font-size: .72rem; padding: .2rem .45rem; }
	.pagination { align-items: center; display: flex; justify-content: space-between; margin-top: .75rem; }
	.pagination div { align-items: center; display: flex; gap: .6rem; }
	.notice { border-radius: .5rem; margin-top: .85rem; padding: .75rem 1rem; overflow-wrap: anywhere; }
	.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.success { background: color-mix(in oklch, var(--primary) 10%, transparent); color: var(--primary); }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .5); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: .5rem; box-shadow: 0 20px 70px rgb(0 0 0 / .3); display: grid; gap: 1rem; max-height: 92dvh; max-width: 760px; overflow: auto; padding: 1.1rem; width: 100%; }
	.modal > *, .modal header > div { min-width: 0; }
	.modal header, .modal footer, .attribute-heading { align-items: center; display: flex; gap: .6rem; justify-content: space-between; }
	.modal header p { overflow-wrap: anywhere; }
	.modal h2 { font-size: 1.15rem; margin: 0; }
	.modal header p { color: var(--muted-foreground); margin: .35rem 0 0; }
	.modal header > button { font-size: 1.2rem; }
	.pricing-grid { border-bottom: 1px solid var(--border); display: grid; gap: .7rem; grid-template-columns: repeat(2, minmax(0, 1fr)); padding-bottom: .8rem; }
	.pricing-grid strong { display: block; font-size: .85rem; margin-top: .3rem; }
	.modal textarea { resize: vertical; }
	.governance-fields { border: 0; border-top: 1px solid var(--border); display: grid; gap: .65rem; margin: 0; min-width: 0; padding: .8rem 0 0; }
	.governance-fields legend { color: var(--foreground); font-size: .85rem; font-weight: 700; padding: 0 .4rem 0 0; }
	.governance-fields > div { display: grid; gap: .65rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.governance-fields label, .attribute-list label { color: var(--muted-foreground); display: grid; font-size: .78rem; gap: .35rem; min-width: 0; }
	.attribute-list { display: grid; gap: .5rem; }
	.attribute-list > div { align-items: end; display: grid; gap: .45rem; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
	.attribute-list p { color: var(--muted-foreground); font-size: .8rem; }
	.modal footer { border-top: 1px solid var(--border); padding-top: .9rem; }
	.modal footer > div { display: flex; gap: .5rem; }
	.modal a { color: var(--primary); font-size: .8rem; }
	button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible { outline: 2px solid var(--ring, var(--primary)); outline-offset: 2px; }
	@media (max-width: 800px) { .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .page-heading { flex-direction: column; } }
	@media (max-width: 520px) { .page-shell { padding: 1rem; } .metric-grid, .governance-fields > div { grid-template-columns: 1fr; } .attribute-list > div { grid-template-columns: minmax(0, 1fr) auto; } .attribute-list > div label:first-child { grid-column: 1 / -1; } .modal footer { align-items: stretch; flex-direction: column; } .modal input, .modal textarea { font-size: 1rem; } }
</style>
