<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { Button, ContentPageHeader, ContentPageShell, DataTableShell, FeedbackNotice, Input, ListPagination, Select } from '@svadmin/ui';
	import { RefreshCw, Search } from '@lucide/svelte';
	import { displayValue, getListPayload, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { columnLabelFor, columnValueFor } from '../lib/columns';
	import { clampPaginationPage, paginationPageCount } from '../lib/display-format';
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
	let loadSeq = 0;
	const columns = $derived.by(() => Array.from(new Set(records.flatMap((record) => Object.keys(record)))).slice(0, 8));
	const title = $derived(resourceName === 'virtual-keys' ? i18n.t('elygate.virtualKeys') : i18n.t(`elygate.${resourceName}`));
	const totalPages = $derived(paginationPageCount(total, Number(pageSize)));

	function endpoint(requestedResource: string, requestedPage: number, requestedPageSize: string, requestedQuery: string): string {
		const params = new URLSearchParams({ limit: requestedPageSize, offset: String((requestedPage - 1) * Number(requestedPageSize)) });
		if (requestedQuery) params.set(requestedResource === 'logs' ? 'content_search' : 'query', requestedQuery);
		if (requestedResource === 'logs') {
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
		const sequence = ++loadSeq;
		const requestedResource = resourceName;
		const requestedPage = page;
		const requestedPageSize = pageSize;
		const requestedQuery = query.trim();
		isLoading = true;
		error = '';
		try {
			const payload: unknown = await requestJson(endpoint(requestedResource, requestedPage, requestedPageSize, requestedQuery));
			if (sequence !== loadSeq || resourceName !== requestedResource || page !== requestedPage || pageSize !== requestedPageSize || query.trim() !== requestedQuery) return;
			const nextRecords = getListPayload(payload);
			const nextTotal = responseTotal(payload, nextRecords.length);
			const validPage = clampPaginationPage(requestedPage, nextTotal, Number(requestedPageSize));
			if (validPage !== requestedPage) {
				page = validPage;
				await load();
				return;
			}
			records = nextRecords;
			total = nextTotal;
		} catch (cause) {
			if (sequence === loadSeq && resourceName === requestedResource && page === requestedPage && pageSize === requestedPageSize && query.trim() === requestedQuery) {
				error = cause instanceof Error ? cause.message : i18n.t('elygate.loadFailed');
			}
		} finally {
			if (sequence === loadSeq) isLoading = false;
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
		if (isLoading) return;
		page = Math.max(1, Math.min(totalPages, nextPage));
		void load();
	}
</script>

<ContentPageShell pageId={resourceName} width="wide">
	<ContentPageHeader {title} eyebrow={`${getAppName()} / ${i18n.locale === 'zh-CN' ? '模型管理' : 'Model management'}`}>
		{#snippet actions()}
			<Button type="button" variant="outline" onclick={() => void load()} disabled={isLoading}>
				<RefreshCw size={16} aria-hidden="true" />{i18n.t('elygate.refresh')}
			</Button>
		{/snippet}
	</ContentPageHeader>
	<form class="filters" onsubmit={submitSearch}>
		<label>{i18n.t('elygate.search')}<Input bind:value={query} disabled={isLoading} /></label>
		<label>{i18n.t('elygate.pageSize')}<Select bind:value={pageSize} disabled={isLoading} onchange={() => { page = 1; void load(); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></Select></label>
		<Button type="submit" disabled={isLoading}><Search size={16} aria-hidden="true" />{i18n.t('elygate.search')}</Button>
	</form>

	{#if error}
		<FeedbackNotice tone="danger" message={error} />
	{:else if records.length === 0 && !isLoading}
		<p class="empty">{i18n.t('elygate.empty')}</p>
	{:else}
		<DataTableShell caption={title}>
			<table aria-busy={isLoading}>
				<thead><tr>{#each columns as column (column)}<th>{columnLabelFor(i18n.locale as ElygateLocale, column)}</th>{/each}</tr></thead>
				<tbody>
					{#each records as record (rowKey(record))}
						<tr>{#each columns as column (column)}<td title={displayValue(record[column])}>{columnValueFor(i18n.locale as ElygateLocale, column, record[column])}</td>{/each}</tr>
					{:else}
						<tr><td>{i18n.t('elygate.loading')}</td></tr>
					{/each}
				</tbody>
			</table>
		</DataTableShell>
	{/if}
	<fieldset disabled={isLoading} class="pagination" aria-busy={isLoading}>
		<ListPagination
			label={title}
			page={page}
			{totalPages}
			{total}
			rangeStart={total === 0 ? 0 : (page - 1) * Number(pageSize) + 1}
			rangeEnd={Math.min(page * Number(pageSize), total)}
			onPageChange={movePage}
		/>
	</fieldset>
</ContentPageShell>

<style>
	.filters { align-items: end; display: grid; gap: .75rem; grid-template-columns: minmax(240px, 1fr) 130px auto; margin-bottom: 1rem; }
	.filters label { color: var(--muted-foreground); display: grid; font-size: .8rem; font-weight: 650; gap: .35rem; }
	table { border-collapse: collapse; min-width: 740px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); max-width: 260px; overflow: hidden; padding: .8rem 1rem; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
	th { background: var(--muted); color: var(--muted-foreground); font-size: .75rem; font-weight: 700; }
	td { font-size: .875rem; }
	tbody tr:last-child td { border-bottom: 0; }
	.empty { color: var(--muted-foreground); padding: 1rem 0; }
	.pagination { border: 0; margin: 1rem 0 0; min-width: 0; padding: 0; }
	@media (max-width: 600px) { .filters { grid-template-columns: 1fr; } }
</style>
