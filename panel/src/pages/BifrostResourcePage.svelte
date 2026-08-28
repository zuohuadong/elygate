<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayValue, getListPayload, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { columnLabelFor, columnValueFor } from '../lib/columns';
	import { clampPaginationPage, formatPagination, paginationPageCount } from '../lib/display-format';
	import type { ElygateLocale } from '../lib/i18n';

	interface Props {
		resourceName: string;
	}

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let records = $state.raw<JsonRecord[]>([]);
	let error = $state('');
	let isLoading = $state(true);
	let query = $state('');
	let page = $state(1);
	let pageSize = $state('50');
	let total = $state(0);
	const columns = $derived.by(() => Array.from(new Set(records.flatMap((record) => Object.keys(record)))).slice(0, 8));
	const hasNext = $derived(page * Number(pageSize) < total);
	const totalPages = $derived(paginationPageCount(total, Number(pageSize)));

	function endpoint(): string {
		const params = new URLSearchParams({ limit: pageSize, offset: String((page - 1) * Number(pageSize)) });
		if (query.trim()) params.set(resourceName === 'logs' ? 'content_search' : 'query', query.trim());
		if (resourceName === 'logs') {
			params.set('sort_by', 'timestamp');
			params.set('order', 'desc');
			return `/api/logs?${params.toString()}`;
		}
		return `/api/models?${params.toString()}`;
	}

	function responseTotal(payload: unknown, count: number): number {
		const direct = getTotal(payload, -1);
		if (direct >= 0) return direct;
		if (isJsonRecord(payload) && isJsonRecord(payload.pagination)) return getTotal(payload.pagination, count);
		return count;
	}

	function rowKey(record: JsonRecord): string {
		return String(record.id ?? record.request_id ?? `${record.provider ?? ''}:${record.name ?? ''}:${record.timestamp ?? ''}:${JSON.stringify(record)}`);
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const payload: unknown = await requestJson(endpoint());
			const nextRecords = getListPayload(payload);
			const nextTotal = responseTotal(payload, nextRecords.length);
			const validPage = clampPaginationPage(page, nextTotal, Number(pageSize));
			if (validPage !== page) {
				page = validPage;
				await load();
				return;
			}
			records = nextRecords;
			total = nextTotal;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : i18n.t('elygate.loadFailed');
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		void load();
	});

	function submitSearch(event: SubmitEvent): void {
		event.preventDefault();
		page = 1;
		void load();
	}

	function movePage(nextPage: number): void {
		page = Math.max(1, nextPage);
		void load();
	}
</script>

<section class="page-shell">
	<header>
		<div>
		<p class="eyebrow">{getAppName()} / {i18n.locale === 'zh-CN' ? '模型管理' : 'Model management'}</p>
			<h1>{resourceName === 'virtual-keys' ? i18n.t('elygate.virtualKeys') : i18n.t(`elygate.${resourceName}`)}</h1>
		</div>
		<button type="button" onclick={() => void load()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button>
	</header>
	<form class="filters" onsubmit={submitSearch}>
		<label>{i18n.t('elygate.search')}<input bind:value={query} /></label>
		<label>{i18n.t('elygate.pageSize')}<select bind:value={pageSize} onchange={() => { page = 1; void load(); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
		<button type="submit" disabled={isLoading}>{i18n.t('elygate.search')}</button>
	</form>

	{#if error}
		<div class="notice" role="alert">{error}</div>
	{:else if records.length === 0 && !isLoading}
		<p class="empty">{i18n.t('elygate.empty')}</p>
	{:else}
		<div class="table-wrap" aria-busy={isLoading}>
			<table>
				<thead><tr>{#each columns as column (column)}<th>{columnLabelFor(i18n.locale as ElygateLocale, column)}</th>{/each}</tr></thead>
				<tbody>
					{#each records as record (rowKey(record))}
						<tr>{#each columns as column (column)}<td title={displayValue(record[column])}>{columnValueFor(i18n.locale as ElygateLocale, column, record[column])}</td>{/each}</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	<footer class="pagination"><span>{formatPagination(page, totalPages, total, i18n.locale)}</span><div><button type="button" onclick={() => movePage(page - 1)} disabled={page <= 1 || isLoading}>{i18n.t('elygate.previous')}</button><button type="button" onclick={() => movePage(page + 1)} disabled={!hasNext || isLoading}>{i18n.t('elygate.next')}</button></div></footer>
</section>

<style>
	.page-shell { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
	header { align-items: center; display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .45rem; text-transform: uppercase; }
	h1 { font-size: 1.75rem; letter-spacing: -.03em; margin: 0; }
	button { border: 0; border-radius: .7rem; background: var(--primary); color: var(--primary-foreground); cursor: pointer; font-weight: 650; padding: .7rem 1rem; }
	button:disabled { cursor: wait; opacity: .55; }
	.filters { align-items: end; display: grid; gap: .75rem; grid-template-columns: minmax(240px, 1fr) 130px auto; margin-bottom: 1rem; }
	.filters label { color: var(--muted-foreground); display: grid; font-size: .8rem; font-weight: 650; gap: .35rem; }
	.filters input, .filters select { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); font: inherit; padding: .6rem .7rem; }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; overflow-x: auto; }
	table { border-collapse: collapse; min-width: 740px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); max-width: 260px; overflow: hidden; padding: .8rem 1rem; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
	th { background: var(--muted); color: var(--muted-foreground); font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
	td { font-size: .875rem; }
	tbody tr:last-child td { border-bottom: 0; }
	.notice, .empty { background: var(--muted); border-radius: .75rem; color: var(--muted-foreground); padding: 1rem; }
	.notice { color: var(--destructive); }
	.pagination { align-items: center; color: var(--muted-foreground); display: flex; justify-content: space-between; margin-top: 1rem; }
	.pagination div { display: flex; gap: .5rem; }
	@media (max-width: 600px) { header { align-items: flex-start; flex-direction: column; } .filters { grid-template-columns: 1fr; } }
</style>
