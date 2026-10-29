<script lang="ts">
	import { onMount } from 'svelte';
	import { Button, ContentPageHeader, ContentPageShell } from '@svadmin/ui';
	import { Download, RefreshCw, Trash2, X } from '@lucide/svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, prettyJson } from '../lib/forms';
	import { isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { formatPagination, formatUsdCost } from '../lib/display-format';
	import { emptyRelayLogFilters, relayLogParams, type RelayLogFilterInput } from '../lib/relay-management';
	import { relayLogListUrl, relayLogPage } from '../lib/relay-log-export';
	import RelayLogExport from '../lib/RelayLogExport.svelte';
	import RelayLogFacet from '../lib/RelayLogFacet.svelte';

	interface Props { resourceName: string; }
	interface RelayStats { total_requests?: number; success_rate?: number; average_latency?: number; total_cost?: number; }
	interface Bucket { timestamp?: string; count?: number; }
	interface ExportSnapshot { query: string; logs: JsonRecord[]; total: number; sortBy: string; order: string; }

	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let logs = $state.raw<JsonRecord[]>([]);
	let stats = $state<RelayStats>({});
	let histogram = $state.raw<Bucket[]>([]);
	let topEndpoints = $state.raw<JsonRecord[]>([]);
	let selected = $state.raw<JsonRecord | null>(null);
	let selectedIds = $state.raw<string[]>([]);
	let search = $state('');
	let relayNames = $state<string[]>([]);
	let methods = $state<string[]>([]);
	let statuses = $state<string[]>([]);
	let kinds = $state<string[]>([]);
	let apps = $state<string[]>([]);
	let virtualKeyIds = $state<string[]>([]);
	let userIds = $state<string[]>([]);
	let teamIds = $state<string[]>([]);
	let customerIds = $state<string[]>([]);
	let businessUnitIds = $state<string[]>([]);
	let projectIds = $state<string[]>([]);
	let requestId = $state('');
	let jobId = $state('');
	let billable = $state('');
	let minCost = $state('');
	let maxCost = $state('');
	let period = $state('24h');
	let page = $state(1);
	let pageSize = $state('50');
	let sortBy = $state('timestamp');
	let order = $state('desc');
	let total = $state(0);
	let isLoading = $state(true);
	let isMutating = $state(false);
	let error = $state('');
	let detailError = $state('');
	let detailLoading = $state(false);
	let filterValidation = $state('');
	let appliedFilters = $state.raw<RelayLogFilterInput>(emptyRelayLogFilters());
	let appliedQuery = $state(relayLogParams(emptyRelayLogFilters()).toString());
	let exportSnapshot = $state.raw<ExportSnapshot | null>(null);
	let loadSeq = 0;
	let detailSeq = 0;
	const totalPages = $derived(Math.max(1, Math.ceil(total / Number(pageSize))));
	const maxBucketCount = $derived(Math.max(1, ...histogram.map((bucket) => Number(bucket.count ?? 0))));
	const hasDraftChanges = $derived(JSON.stringify(draftFilters()) !== JSON.stringify(appliedFilters));

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function value(record: JsonRecord, key: string): string { const candidate = record[key]; return candidate === null || candidate === undefined || candidate === '' ? '—' : String(candidate); }
	function statusLabel(statusValue: string): string {
		return ({ success: i18n.t('elygate.success'), error: i18n.t('elygate.error'), cancelled: i18n.t('elygate.cancelled') } as Record<string, string>)[statusValue] ?? statusValue;
	}
	function draftFilters(): RelayLogFilterInput {
		return {
			search, relayNames, methods, statuses, kinds, period,
			apps, virtualKeyIds, userIds, teamIds, customerIds, businessUnitIds, projectIds, requestId, jobId, billable, minCost, maxCost,
		};
	}
	function filterError(cause: unknown): string {
		const key = cause instanceof Error ? cause.message : '';
		return ({
			'invalid-log-cost': text('成本必须是有限数字。', 'Cost bounds must be finite numbers.'),
			'invalid-log-cost-range': text('最小成本不能大于最大成本。', 'Minimum cost cannot exceed maximum cost.'),
			'invalid-billable': text('计费筛选值无效。', 'Billable filter is invalid.'),
		} as Record<string, string>)[key] ?? displayError(cause, text('筛选条件无效。', 'Invalid filter.'));
	}
	async function load(): Promise<void> {
		const sequence = ++loadSeq;
		isLoading = true; error = '';
		try {
			const queryString = appliedQuery;
			const [listResult, statsResult, histogramResult, topResult] = await Promise.allSettled([
				requestJson<unknown>(relayLogListUrl(queryString, { limit: Number(pageSize), offset: (page - 1) * Number(pageSize), sortBy, order })),
				requestJson<RelayStats>(`/api/relay-logs/stats?${queryString}`),
				requestJson<JsonRecord>(`/api/relay-logs/histogram?${queryString}`),
				requestJson<JsonRecord>(`/api/relay-logs/top-endpoints?${queryString}`),
			]);
			if (listResult.status === 'rejected') throw listResult.reason;
			if (sequence !== loadSeq) return;
			const payload = relayLogPage(listResult.value);
			logs = payload.logs;
			total = payload.total;
			stats = statsResult.status === 'fulfilled' ? statsResult.value : {};
			histogram = histogramResult.status === 'fulfilled' && Array.isArray(histogramResult.value.buckets) ? histogramResult.value.buckets.filter(isJsonRecord) as Bucket[] : [];
			topEndpoints = topResult.status === 'fulfilled' && Array.isArray(topResult.value.endpoints) ? topResult.value.endpoints.filter(isJsonRecord) : [];
			selectedIds = selectedIds.filter((id) => logs.some((row) => String(row.id) === id));
			const failed = [statsResult, histogramResult, topResult].flatMap((result, index) => result.status === 'rejected' ? [text(['统计', '趋势', '排行'][index], ['Statistics', 'Volume', 'Rankings'][index])] : []);
			if (failed.length) error = text(`${failed.join('、')}加载失败。`, `${failed.join(', ')} unavailable.`);
			if (total > 0 && page > totalPages) { page = totalPages; await load(); }
			else if (total === 0 && page !== 1) { page = 1; await load(); }
		} catch (cause) {
			if (sequence === loadSeq) {
				logs = []; total = 0; stats = {}; histogram = []; topEndpoints = []; selectedIds = [];
				error = cause instanceof Error && cause.message === 'invalid-relay-log-page'
					? text('日志响应无效，请刷新重试。', 'Invalid log response. Refresh to retry.')
					: displayError(cause, text('无法加载 Relay 日志。', 'Unable to load relay logs.'));
			}
		} finally {
			if (sequence === loadSeq) isLoading = false;
		}
	}
	function submit(event: SubmitEvent): void {
		event.preventDefault();
		try {
			const filters = $state.snapshot(draftFilters());
			const query = relayLogParams(filters).toString();
			appliedFilters = filters; appliedQuery = query; filterValidation = ''; page = 1;
			void load();
		} catch (cause) { filterValidation = filterError(cause); }
	}
	function resetFilters(): void {
		search = ''; relayNames = []; methods = []; statuses = []; kinds = []; apps = []; virtualKeyIds = []; userIds = [];
		teamIds = []; customerIds = []; businessUnitIds = []; projectIds = []; requestId = ''; jobId = ''; billable = '';
		minCost = ''; maxCost = ''; period = '24h'; page = 1;
		appliedFilters = emptyRelayLogFilters(); appliedQuery = relayLogParams(appliedFilters).toString();
		filterValidation = ''; void load();
	}
	function refresh(): void {
		appliedQuery = relayLogParams(appliedFilters).toString();
		page = 1; void load();
	}
	function openExport(): void {
		if (isLoading || isMutating) return;
		exportSnapshot = { query: appliedQuery, logs: [...logs], total, sortBy, order };
	}
	async function openDetail(row: JsonRecord): Promise<void> {
		const sequence = ++detailSeq;
		selected = row; detailLoading = true; detailError = '';
		try { const detail = await requestJson<JsonRecord>(`/api/relay-logs/${encodeURIComponent(String(row.id))}`); if (sequence === detailSeq) selected = detail; }
		catch (cause) { if (sequence === detailSeq) detailError = displayError(cause, text('无法读取日志详情。', 'Unable to read log details.')); }
		finally { if (sequence === detailSeq) detailLoading = false; }
	}
	function closeDetail(): void { detailSeq += 1; selected = null; detailLoading = false; detailError = ''; }
	function showModal(dialog: HTMLDialogElement): { destroy: () => void } { dialog.showModal(); return { destroy: () => dialog.close() }; }
	function toggle(id: string, checked: boolean): void { selectedIds = checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((item) => item !== id); }
	async function deleteSelected(): Promise<void> {
		if (isMutating || !selectedIds.length || !window.confirm(text('确认删除选中的 Relay 日志？', 'Delete selected relay logs?'))) return;
		isMutating = true; error = '';
		try { await requestJson('/api/relay-logs', { method: 'DELETE', body: JSON.stringify({ ids: [...selectedIds] }) }); selectedIds = []; await load(); }
		catch (cause) { error = displayError(cause, text('删除失败。', 'Delete failed.')); }
		finally { isMutating = false; }
	}
	function movePage(next: number): void { page = Math.max(1, Math.min(totalPages, next)); void load(); }
	function changePageSize(): void { page = 1; void load(); }
	onMount(() => {
		void load();
		return () => { loadSeq += 1; detailSeq += 1; };
	});
</script>

<ContentPageShell pageId="relay-logs" width="wide">
	<ContentPageHeader title={text('Relay 日志', 'Relay logs')} />
	<div class="heading-actions">
		<Button variant="outline" type="button" onclick={openExport} disabled={isLoading || isMutating || !logs.length}><Download size={16} aria-hidden="true" />{text('导出 CSV', 'Export CSV')}</Button>
		<Button variant="outline" type="button" onclick={() => void deleteSelected()} disabled={!selectedIds.length || isMutating || isLoading}><Trash2 size={16} aria-hidden="true" />{text('删除选中项', 'Delete selected')} ({selectedIds.length})</Button>
		<Button variant="outline" type="button" title={i18n.t('elygate.refresh')} aria-label={i18n.t('elygate.refresh')} onclick={refresh} disabled={isLoading || isMutating}><RefreshCw size={16} aria-hidden="true" /></Button>
	</div>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	<div class="metric-grid"><article><span>{text('请求数', 'Requests')}</span><strong>{stats.total_requests?.toLocaleString() ?? '—'}</strong></article><article><span>{i18n.t('elygate.successRate')}</span><strong>{stats.success_rate === undefined ? '—' : `${stats.success_rate.toFixed(1)}%`}</strong></article><article><span>{i18n.t('elygate.averageLatency')}</span><strong>{stats.average_latency === undefined ? '—' : `${stats.average_latency.toFixed(0)} ms`}</strong></article><article><span>{i18n.t('elygate.totalCost')}</span><strong>{stats.total_cost === undefined ? '—' : formatUsdCost(stats.total_cost)}</strong></article></div>
	<div class="insights"><article class="chart-card"><h2>{text('调用趋势', 'Call volume')}</h2><div class="bars" aria-label={text('Relay 调用趋势', 'Relay call volume')}>{#each histogram as bucket (String(bucket.timestamp))}<span style={`height:${Math.max(4, Number(bucket.count ?? 0) / maxBucketCount * 100)}%`} title={`${new Date(String(bucket.timestamp)).toLocaleString(i18n.locale)} · ${bucket.count ?? 0}`}></span>{:else}<p>{i18n.t('elygate.empty')}</p>{/each}</div></article><article class="top-card"><h2>{text('热门端点', 'Top endpoints')}</h2>{#each topEndpoints as endpoint (String(endpoint.relay_name))}<div class="top-row"><strong>{value(endpoint, 'relay_name')}</strong><span>{Number(endpoint.count ?? 0).toLocaleString()} · {formatUsdCost(endpoint.cost)}</span></div>{:else}<p>{i18n.t('elygate.empty')}</p>{/each}</article></div>
	<form onsubmit={submit}>
	<div class="filters">
		<label>{i18n.t('elygate.search')}<input bind:value={search} /></label>
		<RelayLogFacet label={text('端点', 'Endpoints')} dimension="relay_names" bind:selected={relayNames} />
		<RelayLogFacet label={text('方法', 'Methods')} dimension="methods" bind:selected={methods} />
		<RelayLogFacet label={i18n.t('elygate.status')} options={[{ id: 'success', name: i18n.t('elygate.success') }, { id: 'error', name: i18n.t('elygate.error') }, { id: 'cancelled', name: i18n.t('elygate.cancelled') }]} bind:selected={statuses} />
		<RelayLogFacet label={text('类型', 'Kinds')} options={[{ id: 'call', name: text('调用', 'Call') }, { id: 'job', name: text('任务', 'Job') }]} bind:selected={kinds} />
		<label>{i18n.t('elygate.timeRange')}<select bind:value={period}><option value="1h">{i18n.t('elygate.period.1h')}</option><option value="24h">{i18n.t('elygate.period.24h')}</option><option value="7d">{i18n.t('elygate.period.7d')}</option><option value="30d">{i18n.t('elygate.period.30d')}</option></select></label>
		<label>{text('计费', 'Billable')}<select bind:value={billable}><option value="">{i18n.t('elygate.all')}</option><option value="true">{text('仅计费', 'Billable only')}</option><option value="false">{text('非计费', 'Non-billable only')}</option></select></label>
		<label>{text('最小成本 ($)', 'Min cost ($)')}<input bind:value={minCost} inputmode="decimal" /></label>
		<label>{text('最大成本 ($)', 'Max cost ($)')}<input bind:value={maxCost} inputmode="decimal" /></label>
	</div>
	<details class="advanced"><summary>{text('归属与精确条件', 'Attribution and exact filters')}</summary><div class="advanced-grid">
		<RelayLogFacet label={text('应用', 'Apps')} dimension="apps" bind:selected={apps} />
		<RelayLogFacet label={text('虚拟密钥', 'Virtual keys')} dimension="virtual_keys" bind:selected={virtualKeyIds} />
		<RelayLogFacet label={text('用户', 'Users')} dimension="users" bind:selected={userIds} />
		<RelayLogFacet label={text('团队', 'Teams')} dimension="teams" bind:selected={teamIds} />
		<RelayLogFacet label={text('客户', 'Customers')} dimension="customers" bind:selected={customerIds} />
		<RelayLogFacet label={text('业务单元', 'Business units')} dimension="business_units" bind:selected={businessUnitIds} />
		<RelayLogFacet label={text('项目', 'Projects')} dimension="projects" bind:selected={projectIds} />
		<label>{text('Request ID', 'Request ID')}<input bind:value={requestId} /></label><label>{text('Job ID', 'Job ID')}<input bind:value={jobId} /></label>
	</div></details>
		{#if filterValidation}<p class="filter-error" role="alert">{filterValidation}</p>{/if}
		<div class="filter-actions"><Button type="submit" disabled={isMutating}>{text('应用筛选', 'Apply filters')}</Button><Button type="button" variant="outline" onclick={resetFilters} disabled={isMutating}>{text('重置', 'Reset')}</Button>{#if hasDraftChanges}<span role="status">{text('筛选尚未应用', 'Filters not applied')}</span>{/if}</div>
	</form>
	<div class="table-tools">
		<label>{text('排序', 'Sort by')}<select bind:value={sortBy} onchange={changePageSize} disabled={isLoading || isMutating}><option value="timestamp">{i18n.t('elygate.timestamp')}</option><option value="latency">{i18n.t('elygate.latency')}</option><option value="cost">{i18n.t('elygate.totalCost')}</option></select></label>
		<label>{text('顺序', 'Order')}<select bind:value={order} onchange={changePageSize} disabled={isLoading || isMutating}><option value="desc">{text('降序', 'Descending')}</option><option value="asc">{text('升序', 'Ascending')}</option></select></label>
		<label>{i18n.t('elygate.pageSize')}<select bind:value={pageSize} onchange={changePageSize} disabled={isLoading || isMutating}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
	</div>
	<div class="table-wrap" aria-busy={isLoading}><table><thead><tr><th></th><th>{i18n.t('elygate.timestamp')}</th><th>{text('端点', 'Endpoint')}</th><th>{i18n.t('elygate.request')}</th><th>{text('类型', 'Kind')}</th><th>{i18n.t('elygate.status')}</th><th>{text('应用', 'App')}</th><th>{i18n.t('elygate.latency')}</th><th>{i18n.t('elygate.totalCost')}</th></tr></thead><tbody>{#each logs as row (String(row.id))}<tr><td><input type="checkbox" checked={selectedIds.includes(String(row.id))} onchange={(event) => toggle(String(row.id), event.currentTarget.checked)} aria-label={i18n.t('elygate.select')} /></td><td><button class="link" type="button" onclick={() => void openDetail(row)}>{new Date(value(row, 'timestamp')).toLocaleString(i18n.locale)}</button></td><td><strong>{value(row, 'relay_name')}</strong><small>{value(row, 'route_path')}</small></td><td><code>{value(row, 'method')} {value(row, 'path')}</code><small>{value(row, 'request_id')}</small></td><td>{value(row, 'kind')}</td><td><span class={['status', value(row, 'status')]}>{statusLabel(value(row, 'status'))}</span></td><td>{value(row, 'app')}</td><td>{Number(row.latency ?? 0).toFixed(0)} ms</td><td>{formatUsdCost(row.cost)}</td></tr>{:else}<tr><td colspan="9" class="empty">{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</td></tr>{/each}</tbody></table></div>
	<footer class="pagination"><span>{formatPagination(page, totalPages, total, i18n.locale)}</span><div><button type="button" disabled={page <= 1 || isLoading} onclick={() => movePage(page - 1)}>{i18n.t('elygate.previous')}</button><button type="button" disabled={page >= totalPages || isLoading} onclick={() => movePage(page + 1)}>{i18n.t('elygate.next')}</button></div></footer>
</ContentPageShell>
{#if exportSnapshot}<RelayLogExport snapshot={exportSnapshot} onclose={() => exportSnapshot = null} />{/if}
{#if selected}<dialog class="modal" aria-labelledby="relay-log-detail" use:showModal oncancel={(event) => { event.preventDefault(); closeDetail(); }}><header><h2 id="relay-log-detail">{text('Relay 日志详情', 'Relay log details')}</h2><Button variant="ghost" size="icon" type="button" title={i18n.t('elygate.close')} aria-label={i18n.t('elygate.close')} onclick={closeDetail}><X size={18} aria-hidden="true" /></Button></header>{#if detailError}<p role="alert">{detailError}</p>{:else if detailLoading}<p role="status">{i18n.t('elygate.loading')}</p>{:else}<pre>{prettyJson(selected, '{}')}</pre>{/if}</dialog>{/if}

<style>
	.heading-actions, footer, .pagination, .pagination div { align-items: center; display: flex; gap: .5rem; } .heading-actions { justify-content: end; margin-bottom: 1rem; flex-wrap: wrap; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); cursor: pointer; font: inherit; font-weight: 600; min-height: 42px; padding: .55rem .75rem; } button:disabled { cursor: not-allowed; opacity: .55; } .link { background: transparent; border: 0; color: var(--primary); min-height: auto; padding: 0; text-align: left; } .notice { border-radius: 6px; margin-bottom: 1rem; padding: .7rem .9rem; } .notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.metric-grid { display: grid; gap: .75rem; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 1rem; } .metric-grid article, .chart-card, .top-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: .9rem; } .metric-grid span { color: var(--muted-foreground); display: block; font-size: .78rem; } .metric-grid strong { display: block; font-size: 1.35rem; margin-top: .3rem; } .insights { display: grid; gap: .75rem; grid-template-columns: 1.3fr 1fr; margin-bottom: 1rem; } .chart-card h2, .top-card h2 { font-size: .95rem; margin: 0 0 .75rem; } .bars { align-items: end; display: flex; gap: 3px; height: 120px; } .bars span { background: var(--primary); flex: 1; min-width: 3px; } .bars p, .top-card p { color: var(--muted-foreground); } .top-row { border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; gap: .5rem; padding: .45rem 0; } .top-row span { color: var(--muted-foreground); font-size: .8rem; }
	.filters, .advanced-grid { align-items: end; display: grid; gap: .6rem; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 1rem; } .advanced { border-bottom: 1px solid var(--border); margin-bottom: 1rem; padding-bottom: .6rem; } .advanced summary { cursor: pointer; font-weight: 600; padding: .5rem 0; } .advanced-grid { margin: .7rem 0 0; } label { display: grid; font-size: .8rem; font-weight: 600; gap: .3rem; min-width: 0; } input, select { background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); font: inherit; min-height: 42px; padding: .55rem .65rem; width: 100%; }
	.filter-actions, .table-tools { align-items: center; display: flex; flex-wrap: wrap; gap: .6rem; margin-bottom: 1rem; } .filter-actions span { color: var(--muted-foreground); font-size: .8rem; } .table-tools { justify-content: end; } .table-tools label { min-width: 120px; } .filter-error { color: var(--destructive); font-size: .85rem; margin-bottom: .6rem; }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow-x: auto; } table { border-collapse: collapse; min-width: 1250px; width: 100%; } th, td { border-bottom: 1px solid var(--border); padding: .7rem .8rem; text-align: left; vertical-align: top; } th { background: var(--muted); color: var(--muted-foreground); font-size: .74rem; } td small { color: var(--muted-foreground); display: block; margin-top: .2rem; } code { overflow-wrap: anywhere; }
	.pagination { justify-content: space-between; margin-top: 1rem; flex-wrap: wrap; } .modal { background: var(--card); color: var(--foreground); border: 1px solid var(--border); border-radius: 8px; margin: auto; max-height: 92dvh; overflow: auto; padding: 1rem; width: min(calc(100% - 2rem), 900px); } .modal::backdrop { background: rgb(0 0 0 / .5); } .modal header { align-items: center; display: flex; justify-content: space-between; gap: .5rem; } .modal h2 { font-size: 1.15rem; } pre { background: var(--muted); border-radius: 6px; max-height: 72vh; overflow: auto; overflow-wrap: anywhere; padding: .8rem; white-space: pre-wrap; }
	.status { font-size: .8rem; font-weight: 600; } .status.success { color: var(--primary); } .status.error { color: var(--destructive); }
	@media (max-width: 1100px) { .filters, .advanced-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 900px) { .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .insights { grid-template-columns: 1fr; } } @media (max-width: 560px) { .heading-actions { width: 100%; } .filters, .advanced-grid { grid-template-columns: 1fr; } .metric-grid { grid-template-columns: 1fr 1fr; } input, select { font-size: 16px; } }
</style>
