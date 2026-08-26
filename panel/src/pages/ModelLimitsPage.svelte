<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getListPayload, getTotal, requestJson, type JsonRecord } from '../lib/api';
	import { displayError } from '../lib/forms';
	import { formatPagination, formatUsdCost } from '../lib/display-format';
	import { buildModelLimitPayload, ModelLimitError, type BudgetDraft, type ModelLimitDraft } from '../lib/model-limits';

	interface Props { resourceName: string; }
	interface Budget { id?: string; max_limit: number; current_usage?: number; reset_duration: string; }
	interface RateLimit { token_max_limit?: number; token_current_usage?: number; token_reset_duration?: string; request_max_limit?: number; request_current_usage?: number; request_reset_duration?: string; }
	interface ModelConfig extends JsonRecord { id: string; model_name: string; provider?: string; scope?: string; scope_id?: string; scope_name?: string; budgets?: Budget[]; rate_limit?: RateLimit; }
	interface NamedRecord extends JsonRecord { id: string; name: string; }

	const PAGE_SIZE = 25;
	const resetDurations = ['30s', '1m', '5m', '15m', '1h', '6h', '1d', '1w', '1M'];
	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let records = $state.raw<ModelConfig[]>([]);
	let providers = $state.raw<string[]>([]);
	let virtualKeys = $state.raw<NamedRecord[]>([]);
	let total = $state(0);
	let offset = $state(0);
	let search = $state('');
	let scopeFilter = $state('');
	let providerFilter = $state('');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let error = $state('');
	let notice = $state('');
	let editing = $state.raw<ModelConfig | null>(null);
	let modalOpen = $state(false);
	let draft = $state<ModelLimitDraft>(emptyDraft());
	const currentPage = $derived(Math.floor(offset / PAGE_SIZE) + 1);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));

	function emptyDraft(): ModelLimitDraft {
		return { modelName: '*', provider: '', scope: 'global', scopeId: '', budgets: [], tokenMaxLimit: '', tokenResetDuration: '1h', requestMaxLimit: '', requestResetDuration: '1h' };
	}

	function integer(value: number): string { return Math.round(value).toLocaleString(i18n.locale); }
	function currency(value: number): string { return formatUsdCost(value); }
	function usage(current = 0, limit = 0): string { return `${currency(current)} / ${currency(limit)}`; }
	function rateUsage(current = 0, limit = 0): string { return `${integer(current)} / ${integer(limit)}`; }

	async function loadLookups(): Promise<void> {
		const [providerPayload, virtualKeyPayload] = await Promise.all([
			requestJson<unknown>('/api/providers').catch(() => []),
			requestJson<unknown>('/api/governance/virtual-keys?limit=0&from_memory=true').catch(() => []),
		]);
		providers = getListPayload(providerPayload).map((record) => record.name).filter((name): name is string => typeof name === 'string');
		virtualKeys = getListPayload(virtualKeyPayload).filter((record): record is NamedRecord => typeof record.id === 'string' && typeof record.name === 'string');
	}

	async function load(reset = false): Promise<void> {
		if (reset) offset = 0;
		isLoading = true;
		error = '';
		const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
		if (search.trim()) params.set('search', search.trim());
		if (scopeFilter) params.set('scope', scopeFilter);
		if (providerFilter) params.set('provider', providerFilter);
		try {
			const payload = await requestJson<unknown>(`/api/governance/model-configs?${params.toString()}`);
			records = getListPayload(payload).filter((record): record is ModelConfig => typeof record.id === 'string' && typeof record.model_name === 'string');
			total = getTotal(payload, records.length);
			if (total > 0 && offset >= total) { offset = Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE; await load(); }
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	function openCreate(): void {
		editing = null;
		draft = emptyDraft();
		modalOpen = true;
		error = '';
	}

	function openEdit(record: ModelConfig): void {
		editing = record;
		draft = {
			modelName: record.model_name,
			provider: record.provider ?? '',
			scope: record.scope ?? 'global',
			scopeId: record.scope_id ?? '',
			budgets: (record.budgets ?? []).map((budget) => ({ id: budget.id, maxLimit: String(budget.max_limit), resetDuration: budget.reset_duration })),
			tokenMaxLimit: record.rate_limit?.token_max_limit === undefined ? '' : String(record.rate_limit.token_max_limit),
			tokenResetDuration: record.rate_limit?.token_reset_duration ?? '1h',
			requestMaxLimit: record.rate_limit?.request_max_limit === undefined ? '' : String(record.rate_limit.request_max_limit),
			requestResetDuration: record.rate_limit?.request_reset_duration ?? '1h',
		};
		modalOpen = true;
		error = '';
	}

	function addBudget(): void { draft.budgets.push({ maxLimit: '', resetDuration: '1M' }); }
	function removeBudget(index: number): void { draft.budgets = draft.budgets.filter((_, current) => current !== index); }

	function validationMessage(cause: ModelLimitError): string {
		return i18n.t(`elygate.modelLimitIssue.${cause.issue}`);
	}

	async function save(): Promise<void> {
		if (isSaving) return;
		isSaving = true;
		error = '';
		notice = '';
		try {
			const payload = buildModelLimitPayload(draft, !!editing?.rate_limit);
			const path = editing ? `/api/governance/model-configs/${encodeURIComponent(editing.id)}` : '/api/governance/model-configs';
			await requestJson<unknown>(path, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
			modalOpen = false;
			notice = editing ? i18n.t('elygate.modelLimitUpdated') : i18n.t('elygate.modelLimitCreated');
			await load();
		} catch (cause) {
			error = cause instanceof ModelLimitError ? validationMessage(cause) : displayError(cause, i18n.t('elygate.saveFailed'));
		} finally {
			isSaving = false;
		}
	}

	async function remove(record: ModelConfig): Promise<void> {
		if (!window.confirm(i18n.t('elygate.confirmDeleteModelLimit').replace('{model}', record.model_name))) return;
		error = '';
		try {
			await requestJson<void>(`/api/governance/model-configs/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
			notice = i18n.t('elygate.modelLimitDeleted');
			await load();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.deleteFailed'));
		}
	}

	onMount(() => {
		void Promise.all([loadLookups(), load()]);
		const timer = window.setInterval(() => { if (!modalOpen) void load(); }, 5000);
		return () => window.clearInterval(timer);
	});
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading"><div><p class="eyebrow">{getAppName()} / Governance</p><h1>{i18n.t('elygate.modelLimits')}</h1><p>{i18n.t('elygate.modelLimitsHint')}</p></div><button class="primary" type="button" onclick={openCreate}>+ {i18n.t('elygate.addLimit')}</button></header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<form class="toolbar" onsubmit={(event) => { event.preventDefault(); void load(true); }}>
		<label>{i18n.t('elygate.search')}<input bind:value={search} placeholder={i18n.t('elygate.searchModelLimits')} /></label>
		<label>{i18n.t('elygate.scope')}<select bind:value={scopeFilter} onchange={() => void load(true)}><option value="">{i18n.t('elygate.all')}</option><option value="global">{i18n.t('elygate.global')}</option><option value="virtual_key">{i18n.t('elygate.virtualKey')}</option></select></label>
		<label>{i18n.t('elygate.provider')}<select bind:value={providerFilter} onchange={() => void load(true)}><option value="">{i18n.t('elygate.all')}</option>{#each providers as provider (provider)}<option value={provider}>{provider}</option>{/each}</select></label>
		<button type="submit">{i18n.t('elygate.search')}</button>
	</form>
	<div class="table-wrap"><table><thead><tr><th>{i18n.t('elygate.model')}</th><th>{i18n.t('elygate.provider')}</th><th>{i18n.t('elygate.scope')}</th><th>{i18n.t('elygate.scopeTarget')}</th><th>{i18n.t('elygate.budgetList')}</th><th>{i18n.t('elygate.rateLimits')}</th><th></th></tr></thead><tbody>
		{#each records as record (record.id)}
			<tr><td><strong>{record.model_name === '*' ? i18n.t('elygate.allModels') : record.model_name}</strong></td><td>{record.provider || i18n.t('elygate.all')}</td><td>{record.scope === 'virtual_key' ? i18n.t('elygate.virtualKey') : i18n.t('elygate.global')}</td><td>{record.scope_name || record.scope_id || '—'}</td><td><div class="limit-lines">{#each record.budgets ?? [] as budget (budget.id ?? budget.reset_duration)}<span>{usage(budget.current_usage, budget.max_limit)} · {budget.reset_duration}</span>{:else}—{/each}</div></td><td><div class="limit-lines">{#if record.rate_limit?.token_max_limit !== undefined}<span>{i18n.t('elygate.tokens')}: {rateUsage(record.rate_limit.token_current_usage, record.rate_limit.token_max_limit)} · {record.rate_limit.token_reset_duration}</span>{/if}{#if record.rate_limit?.request_max_limit !== undefined}<span>{i18n.t('elygate.requests')}: {rateUsage(record.rate_limit.request_current_usage, record.rate_limit.request_max_limit)} · {record.rate_limit.request_reset_duration}</span>{/if}{#if !record.rate_limit}—{/if}</div></td><td><div class="actions"><button type="button" onclick={() => openEdit(record)}>{i18n.t('elygate.edit')}</button><button class="danger" type="button" onclick={() => void remove(record)}>{i18n.t('elygate.delete')}</button></div></td></tr>
		{:else}<tr><td colspan="7">{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</td></tr>{/each}
	</tbody></table></div>
	<footer class="pagination"><span>{formatPagination(currentPage, totalPages, total, i18n.locale)}</span><div><button type="button" disabled={offset === 0 || isLoading} onclick={() => { offset = Math.max(0, offset - PAGE_SIZE); void load(); }}>{i18n.t('elygate.previous')}</button><button type="button" disabled={offset + PAGE_SIZE >= total || isLoading} onclick={() => { offset += PAGE_SIZE; void load(); }}>{i18n.t('elygate.next')}</button></div></footer>
</section>

{#if modalOpen}
	<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !isSaving) modalOpen = false; }}>
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="model-limit-title">
			<header><div><h2 id="model-limit-title">{editing ? i18n.t('elygate.editLimit') : i18n.t('elygate.createLimit')}</h2><p>{i18n.t('elygate.modelLimitFormHint')}</p></div><button type="button" aria-label={i18n.t('elygate.close')} onclick={() => (modalOpen = false)}>×</button></header>
			<div class="form-grid">
				<label>{i18n.t('elygate.provider')}<select bind:value={draft.provider} disabled={!!editing}><option value="">{i18n.t('elygate.all')}</option>{#each providers as provider (provider)}<option value={provider}>{provider}</option>{/each}</select></label>
				<label>{i18n.t('elygate.model')}<input bind:value={draft.modelName} disabled={!!editing} placeholder="*" /></label>
				<label>{i18n.t('elygate.scope')}<select bind:value={draft.scope} disabled={!!editing} onchange={() => { if (draft.scope === 'global') draft.scopeId = ''; }}><option value="global">{i18n.t('elygate.global')}</option><option value="virtual_key">{i18n.t('elygate.virtualKey')}</option></select></label>
				{#if draft.scope === 'virtual_key'}<label>{i18n.t('elygate.virtualKey')}<select bind:value={draft.scopeId} disabled={!!editing}><option value="">{i18n.t('elygate.selectVirtualKey')}</option>{#each virtualKeys as key (key.id)}<option value={key.id}>{key.name}</option>{/each}</select></label>{/if}
			</div>
			<section class="form-section"><div class="section-heading"><div><h3>{i18n.t('elygate.budgets')}</h3><p>{i18n.t('elygate.budgetsHint')}</p></div><button type="button" onclick={addBudget}>+ {i18n.t('elygate.addBudget')}</button></div><div class="budget-list">{#each draft.budgets as budget, index (budget.id ?? `new-${index}`)}<div><label>{i18n.t('elygate.maxCost')}<input type="number" min="0" step="any" bind:value={budget.maxLimit} /></label><label>{i18n.t('elygate.resetPeriod')}<select bind:value={budget.resetDuration}>{#each resetDurations as duration (duration)}<option value={duration}>{duration}</option>{/each}</select></label><button type="button" aria-label={i18n.t('elygate.delete')} onclick={() => removeBudget(index)}>×</button></div>{:else}<p>{i18n.t('elygate.noBudgets')}</p>{/each}</div></section>
			<section class="form-section"><div class="section-heading"><div><h3>{i18n.t('elygate.rateLimits')}</h3><p>{i18n.t('elygate.rateLimitsHint')}</p></div></div><div class="form-grid"><label>{i18n.t('elygate.tokenLimit')}<input type="number" min="0" step="1" bind:value={draft.tokenMaxLimit} /></label><label>{i18n.t('elygate.resetPeriod')}<select bind:value={draft.tokenResetDuration}>{#each resetDurations as duration (duration)}<option value={duration}>{duration}</option>{/each}</select></label><label>{i18n.t('elygate.requestLimit')}<input type="number" min="0" step="1" bind:value={draft.requestMaxLimit} /></label><label>{i18n.t('elygate.resetPeriod')}<select bind:value={draft.requestResetDuration}>{#each resetDurations as duration (duration)}<option value={duration}>{duration}</option>{/each}</select></label></div></section>
			<footer><button type="button" onclick={() => (modalOpen = false)}>{i18n.t('elygate.cancel')}</button><button class="primary" type="button" disabled={isSaving} onclick={() => void save()}>{isSaving ? i18n.t('elygate.saving') : i18n.t('elygate.save')}</button></footer>
		</div>
	</div>
{/if}

<style>
	.page-shell { max-width: 1320px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: start; display: flex; gap: 1rem; justify-content: space-between; }
	.page-heading h1 { margin: 0; }
	.page-heading p { color: var(--muted-foreground); margin: .55rem 0 0; max-width: 760px; }
	.eyebrow { color: var(--primary) !important; font-size: .75rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
	button, input, select { border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); font: inherit; }
	button, select { background: var(--muted); cursor: pointer; padding: .55rem .7rem; }
	input { background: var(--background); padding: .6rem .7rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	button:disabled { cursor: wait; opacity: .55; }
	.toolbar { align-items: end; display: flex; flex-wrap: wrap; gap: .65rem; margin: 1rem 0 .75rem; }
	.toolbar label, .form-grid label, .budget-list label { color: var(--muted-foreground); display: grid; font-size: .75rem; gap: .35rem; }
	.toolbar input { min-width: min(330px, 70vw); }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; overflow-x: auto; }
	table { border-collapse: collapse; min-width: 1100px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); font-size: .78rem; padding: .7rem .8rem; text-align: left; vertical-align: top; }
	th { color: var(--muted-foreground); }
	.limit-lines { display: grid; gap: .25rem; min-width: 170px; }
	.actions { display: flex; gap: .35rem; }
	.pagination { align-items: center; display: flex; justify-content: space-between; margin-top: .75rem; }
	.pagination div { align-items: center; display: flex; gap: .6rem; }
	.notice { border-radius: .65rem; margin-top: .85rem; padding: .75rem 1rem; }
	.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.success { background: color-mix(in oklch, var(--primary) 10%, transparent); color: var(--primary); }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .5); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; display: grid; gap: 1rem; max-height: 92vh; max-width: 780px; overflow: auto; padding: 1.1rem; width: 100%; }
	.modal > header, .modal > footer, .section-heading { align-items: center; display: flex; justify-content: space-between; }
	.modal h2, .modal h3 { margin: 0; }
	.modal header p, .section-heading p { color: var(--muted-foreground); font-size: .78rem; margin: .35rem 0 0; }
	.form-grid { display: grid; gap: .7rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-section { border-top: 1px solid var(--border); padding-top: 1rem; }
	.budget-list { display: grid; gap: .55rem; margin-top: .7rem; }
	.budget-list > div { align-items: end; display: grid; gap: .55rem; grid-template-columns: 1fr 1fr auto; }
	.budget-list > p { color: var(--muted-foreground); font-size: .8rem; }
	.modal > footer { border-top: 1px solid var(--border); gap: .5rem; justify-content: end; padding-top: .9rem; }
	@media (max-width: 700px) { .page-heading { flex-direction: column; } .form-grid { grid-template-columns: 1fr; } }
</style>
