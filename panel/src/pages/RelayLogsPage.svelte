<script lang="ts">
	import { onMount } from 'svelte';
	import { Button, ContentPageShell, ContentPageHeader } from '@svadmin/ui';
	import { RefreshCw, Trash2, X } from '@lucide/svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, prettyJson } from '../lib/forms';
	import { getListPayload, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { formatPagination, formatUsdCost } from '../lib/display-format';
	import { relayLogParams } from '../lib/relay-management';

	interface Props { resourceName: string; }
	interface RelayStats { total_requests?: number; success_count?: number; error_count?: number; success_rate?: number; average_latency?: number; total_cost?: number; total_units?: number; total_bytes_out?: number; }
	interface Bucket { timestamp?: string; count?: number; success?: number; error?: number; cancelled?: number; }
	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let logs = $state.raw<JsonRecord[]>([]);
	let stats = $state<RelayStats>({});
	let filterData = $state.raw<JsonRecord>({});
	let histogram = $state.raw<Bucket[]>([]);
	let topEndpoints = $state.raw<JsonRecord[]>([]);
	let selected = $state.raw<JsonRecord | null>(null);
	let selectedIds = $state.raw<string[]>([]);
	let search = $state('');
	let relayName = $state('');
	let method = $state('');
	let status = $state('');
	let kind = $state('');
	let period = $state('24h');
	let page = $state(1);
	let pageSize = $state('50');
	let total = $state(0);
	let isLoading = $state(true);
	let isMutating = $state(false);
	let error = $state('');
	let detailError = $state('');
	let detailLoading = $state(false);
	let filtersError = $state('');
	let loadSeq = 0;
	let detailSeq = 0;
	const totalPages = $derived(Math.max(1, Math.ceil(total / Number(pageSize))));
	const maxBucketCount = $derived(Math.max(1, ...histogram.map((bucket) => Number(bucket.count ?? 0))));
	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function list(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
	function value(record: JsonRecord, key: string): string { const v = record[key]; return v === null || v === undefined || v === '' ? '—' : String(v); }
	function statusLabel(value: string): string { return ({ success: i18n.t('elygate.success'), error: i18n.t('elygate.error'), cancelled: i18n.t('elygate.cancelled'), processing: i18n.t('elygate.processing') } as Record<string, string>)[value] ?? value; }
	function params(): URLSearchParams {
		return relayLogParams({ period, search, relayName, method, status, kind });
	}
	function endpoint(base: URLSearchParams): string {
		const p = new URLSearchParams(base);
		p.set('limit', pageSize); p.set('offset', String((page - 1) * Number(pageSize))); p.set('sort_by', 'timestamp'); p.set('order', 'desc');
		return `/api/relay-logs?${p.toString()}`;
	}
	async function loadFilters(): Promise<void> {
		filtersError = '';
		try { filterData = await requestJson<JsonRecord>('/api/relay-logs/filterdata?dimensions=relay_names,methods,apps'); }
		catch (cause) { filterData = {}; filtersError = displayError(cause, text('端点筛选项不可用。', 'Endpoint filter options unavailable.')); }
	}
	async function load(): Promise<void> {
		const sequence = ++loadSeq;
		isLoading = true; error = '';
		try {
			const filterParams = params();
			const query = filterParams.toString();
			const [listResult, statsResult, histogramResult, topResult] = await Promise.allSettled([
				requestJson<unknown>(endpoint(filterParams)),
				requestJson<RelayStats>(`/api/relay-logs/stats?${query}`),
				requestJson<JsonRecord>(`/api/relay-logs/histogram?${query}`),
				requestJson<JsonRecord>(`/api/relay-logs/top-endpoints?${query}`),
			]);
			if (listResult.status === 'rejected') throw listResult.reason;
			if (sequence !== loadSeq) return;
			const payload = listResult.value;
			logs = getListPayload(payload);
			total = isJsonRecord(payload) && isJsonRecord(payload.pagination) ? getTotal(payload.pagination, logs.length) : getTotal(payload, logs.length);
			stats = statsResult.status === 'fulfilled' ? statsResult.value : {};
			histogram = histogramResult.status === 'fulfilled' && Array.isArray(histogramResult.value.buckets) ? histogramResult.value.buckets.filter(isJsonRecord) as Bucket[] : [];
			topEndpoints = topResult.status === 'fulfilled' && Array.isArray(topResult.value.endpoints) ? topResult.value.endpoints.filter(isJsonRecord) : [];
			selectedIds = selectedIds.filter((id) => logs.some((row) => String(row.id) === id));
			const failures = [statsResult, histogramResult, topResult].flatMap((result, index) => result.status === 'rejected' ? [text(['统计', '趋势', '排行'][index], ['Statistics', 'Volume', 'Rankings'][index])] : []);
			if (failures.length) error = text(`${failures.join('、')}加载失败。`, `${failures.join(', ')} unavailable.`);
			if (total > 0 && page > totalPages) { page = totalPages; await load(); }
			else if (total === 0 && page !== 1) { page = 1; await load(); }
		} catch (cause) { if (sequence === loadSeq) { logs = []; total = 0; stats = {}; histogram = []; topEndpoints = []; selectedIds = []; error = displayError(cause, text('无法加载 Relay 日志。', 'Unable to load relay logs.')); } }
		finally { if (sequence === loadSeq) isLoading = false; }
	}
	async function openDetail(row: JsonRecord): Promise<void> {
		const sequence = ++detailSeq;
		selected = row;
		detailLoading = true; detailError = '';
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
	function submit(event: SubmitEvent): void { event.preventDefault(); page = 1; void load(); }
	onMount(() => { void Promise.all([load(), loadFilters()]); return () => { loadSeq += 1; detailSeq += 1; }; });
</script>

<ContentPageShell pageId="relay-logs" width="wide">
	<ContentPageHeader title={text('Relay 日志', 'Relay logs')} />
	<div class="heading-actions"><Button variant="outline" type="button" onclick={() => void deleteSelected()} disabled={!selectedIds.length || isMutating}><Trash2 size={16} aria-hidden="true" />{text('删除选中项', 'Delete selected')} ({selectedIds.length})</Button><Button variant="outline" type="button" title={i18n.t('elygate.refresh')} aria-label={i18n.t('elygate.refresh')} onclick={() => { void load(); void loadFilters(); }} disabled={isLoading}><RefreshCw size={16} aria-hidden="true" /></Button></div>
	{#if error || filtersError}<div class="notice error" role="alert">{[error, filtersError].filter(Boolean).join(' ')}</div>{/if}
	<div class="metric-grid"><article><span>{text('请求数', 'Requests')}</span><strong>{stats.total_requests?.toLocaleString() ?? '—'}</strong></article><article><span>{i18n.t('elygate.successRate')}</span><strong>{stats.success_rate === undefined ? '—' : `${stats.success_rate.toFixed(1)}%`}</strong></article><article><span>{i18n.t('elygate.averageLatency')}</span><strong>{stats.average_latency === undefined ? '—' : `${stats.average_latency.toFixed(0)} ms`}</strong></article><article><span>{i18n.t('elygate.totalCost')}</span><strong>{stats.total_cost === undefined ? '—' : formatUsdCost(stats.total_cost)}</strong></article></div>
	<div class="insights"><article class="chart-card"><h2>{text('调用趋势', 'Call volume')}</h2><div class="bars" aria-label={text('Relay 调用趋势', 'Relay call volume')}>{#each histogram as bucket (String(bucket.timestamp))}<span style={`height:${Math.max(4, Number(bucket.count ?? 0) / maxBucketCount * 100)}%`} title={`${new Date(String(bucket.timestamp)).toLocaleString(i18n.locale)} · ${bucket.count ?? 0}`}></span>{:else}<p>{i18n.t('elygate.empty')}</p>{/each}</div></article><article class="top-card"><h2>{text('热门端点', 'Top endpoints')}</h2>{#each topEndpoints as endpoint (String(endpoint.relay_name))}<div class="top-row"><strong>{value(endpoint, 'relay_name')}</strong><span>{Number(endpoint.count ?? 0).toLocaleString()} · {formatUsdCost(endpoint.cost)}</span></div>{:else}<p>{i18n.t('elygate.empty')}</p>{/each}</article></div>
	<form class="filters" onsubmit={submit}><label>{i18n.t('elygate.search')}<input bind:value={search} /></label><label>{text('端点', 'Endpoint')}<select bind:value={relayName}><option value="">{i18n.t('elygate.all')}</option>{#each list(filterData.relay_names) as item}<option value={item}>{item}</option>{/each}</select></label><label>{text('方法', 'Method')}<select bind:value={method}><option value="">{i18n.t('elygate.all')}</option>{#each ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as item}<option value={item}>{item}</option>{/each}</select></label><label>{i18n.t('elygate.status')}<select bind:value={status}><option value="">{i18n.t('elygate.all')}</option><option value="success">{i18n.t('elygate.success')}</option><option value="error">{i18n.t('elygate.error')}</option><option value="cancelled">{i18n.t('elygate.cancelled')}</option></select></label><label>{text('类型', 'Kind')}<select bind:value={kind}><option value="">{i18n.t('elygate.all')}</option><option value="call">call</option><option value="job">job</option></select></label><label>{i18n.t('elygate.timeRange')}<select bind:value={period}><option value="1h">{i18n.t('elygate.period.1h')}</option><option value="24h">{i18n.t('elygate.period.24h')}</option><option value="7d">{i18n.t('elygate.period.7d')}</option><option value="30d">{i18n.t('elygate.period.30d')}</option></select></label><button type="submit" disabled={isLoading}>{i18n.t('elygate.search')}</button></form>
	<div class="table-wrap" aria-busy={isLoading}><table><thead><tr><th></th><th>{i18n.t('elygate.timestamp')}</th><th>{text('端点', 'Endpoint')}</th><th>{i18n.t('elygate.request')}</th><th>{text('类型', 'Kind')}</th><th>{i18n.t('elygate.status')}</th><th>{i18n.t('elygate.latency')}</th><th>{i18n.t('elygate.totalCost')}</th></tr></thead><tbody>{#each logs as row (String(row.id))}<tr><td><input type="checkbox" checked={selectedIds.includes(String(row.id))} onchange={(event) => toggle(String(row.id), event.currentTarget.checked)} aria-label={i18n.t('elygate.select')} /></td><td><button class="link" type="button" onclick={() => void openDetail(row)}>{new Date(value(row, 'timestamp')).toLocaleString(i18n.locale)}</button></td><td><strong>{value(row, 'relay_name')}</strong><small>{value(row, 'route_path')}</small></td><td><code>{value(row, 'method')} {value(row, 'path')}</code></td><td>{value(row, 'kind')}</td><td><span class={['status', value(row, 'status')]}>{statusLabel(value(row, 'status'))}</span></td><td>{Number(row.latency ?? 0).toFixed(0)} ms</td><td>{formatUsdCost(row.cost)}</td></tr>{:else}<tr><td colspan="8" class="empty">{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</td></tr>{/each}</tbody></table></div>
	<footer class="pagination"><span>{formatPagination(page, totalPages, total, i18n.locale)}</span><div><button type="button" disabled={page <= 1 || isLoading} onclick={() => { page -= 1; void load(); }}>{i18n.t('elygate.previous')}</button><button type="button" disabled={page >= totalPages || isLoading} onclick={() => { page += 1; void load(); }}>{i18n.t('elygate.next')}</button></div></footer>
</ContentPageShell>
{#if selected}<dialog class="modal" aria-labelledby="relay-log-detail" use:showModal oncancel={(event) => { event.preventDefault(); closeDetail(); }}><header><h2 id="relay-log-detail">{text('Relay 日志详情', 'Relay log details')}</h2><Button variant="ghost" size="icon" type="button" title={i18n.t('elygate.close')} aria-label={i18n.t('elygate.close')} onclick={closeDetail}><X size={18} aria-hidden="true" /></Button></header>{#if detailError}<p role="alert">{detailError}</p>{:else if detailLoading}<p role="status">{i18n.t('elygate.loading')}</p>{:else}<pre>{prettyJson(selected, '{}')}</pre>{/if}</dialog>{/if}

<style>
	.heading-actions, footer, .pagination, .pagination div { align-items: center; display: flex; gap: .5rem; } .heading-actions { justify-content: end; margin-bottom: 1rem; flex-wrap: wrap; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); cursor: pointer; font: inherit; font-weight: 600; min-height: 42px; padding: .55rem .75rem; } button:disabled { cursor: not-allowed; opacity: .55; } .link { background: transparent; border: 0; color: var(--primary); min-height: auto; padding: 0; text-align: left; } .notice { border-radius: 6px; margin-bottom: 1rem; padding: .7rem .9rem; } .notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.metric-grid { display: grid; gap: .75rem; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 1rem; } .metric-grid article, .chart-card, .top-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: .9rem; } .metric-grid span { color: var(--muted-foreground); display: block; font-size: .78rem; } .metric-grid strong { display: block; font-size: 1.35rem; margin-top: .3rem; } .insights { display: grid; gap: .75rem; grid-template-columns: 1.3fr 1fr; margin-bottom: 1rem; } .chart-card h2, .top-card h2 { font-size: .95rem; margin: 0 0 .75rem; } .bars { align-items: end; display: flex; gap: 3px; height: 120px; } .bars span { background: var(--primary); flex: 1; min-width: 3px; } .bars p, .top-card p { color: var(--muted-foreground); } .top-row { border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; gap: .5rem; padding: .45rem 0; } .top-row span { color: var(--muted-foreground); font-size: .8rem; }
	.filters { align-items: end; display: grid; gap: .6rem; grid-template-columns: 2fr repeat(5, minmax(100px, 1fr)) auto; margin-bottom: 1rem; } label { display: grid; font-size: .8rem; font-weight: 600; gap: .3rem; } input, select { background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); font: inherit; min-height: 42px; padding: .55rem .65rem; width: 100%; } .table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow-x: auto; } table { border-collapse: collapse; min-width: 1100px; width: 100%; } th, td { border-bottom: 1px solid var(--border); padding: .7rem .8rem; text-align: left; vertical-align: top; } th { background: var(--muted); color: var(--muted-foreground); font-size: .74rem; } td small { color: var(--muted-foreground); display: block; margin-top: .2rem; } code { overflow-wrap: anywhere; }
	.pagination { justify-content: space-between; margin-top: 1rem; flex-wrap: wrap; } .modal { background: var(--card); color: var(--foreground); border: 1px solid var(--border); border-radius: 8px; margin: auto; max-height: 92dvh; overflow: auto; padding: 1rem; width: min(calc(100% - 2rem), 900px); } .modal::backdrop { background: rgb(0 0 0 / .5); } .modal header { align-items: center; display: flex; justify-content: space-between; gap: .5rem; } .modal h2 { font-size: 1.15rem; } pre { background: var(--muted); border-radius: 6px; max-height: 72vh; overflow: auto; overflow-wrap: anywhere; padding: .8rem; white-space: pre-wrap; }
	.status { font-size: .8rem; font-weight: 600; } .status.success { color: var(--primary); } .status.error { color: var(--destructive); }
	@media (max-width: 1100px) { .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 900px) { .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .insights { grid-template-columns: 1fr; } } @media (max-width: 560px) { .heading-actions { width: 100%; } .filters { grid-template-columns: 1fr; } .metric-grid { grid-template-columns: 1fr 1fr; } }
</style>
