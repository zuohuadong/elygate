<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, prettyJson } from '../lib/forms';
	import { getListPayload, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { formatPagination, formatUsdCost } from '../lib/display-format';

	interface Props { resourceName: string; }
	interface McpStats { total_executions?: number; success_rate?: number; average_latency?: number; total_cost?: number; }
	interface HistogramBucket { timestamp?: string; count?: number; success?: number; error?: number; cancelled?: number; }

	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let logs = $state.raw<JsonRecord[]>([]);
	let stats = $state.raw<McpStats>({});
	let filterData = $state.raw<JsonRecord>({});
	let histogram = $state.raw<HistogramBucket[]>([]);
	let topTools = $state.raw<JsonRecord[]>([]);
	let selectedLog = $state.raw<JsonRecord | null>(null);
	let selectedIds = $state.raw<string[]>([]);
	let query = $state('');
	let toolName = $state('');
	let serverLabel = $state('');
	let status = $state('');
	let period = $state('24h');
	let page = $state(1);
	let pageSize = $state('50');
	let total = $state(0);
	let isLoading = $state(true);
	let isMutating = $state(false);
	let error = $state('');
	let notice = $state('');

	const hasNext = $derived(page * Number(pageSize) < total);
	const totalPages = $derived(Math.max(1, Math.ceil(total / Number(pageSize))));
	const toolNames = $derived(stringList(filterData.tool_names));
	const serverLabels = $derived(stringList(filterData.server_labels));
	const maxBucketCount = $derived(Math.max(1, ...histogram.map((bucket) => Number(bucket.count ?? 0))));

	function stringList(value: unknown): string[] {
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
	}

	function value(record: JsonRecord, key: string): string {
		const candidate = record[key];
		return candidate === null || candidate === undefined || candidate === '' ? '—' : String(candidate);
	}

	function filterParams(): URLSearchParams {
		const params = new URLSearchParams({ period });
		if (query.trim()) params.set('content_search', query.trim());
		if (toolName) params.set('tool_names', toolName);
		if (serverLabel) params.set('server_labels', serverLabel);
		if (status) params.set('status', status);
		return params;
	}

	function listEndpoint(): string {
		const params = filterParams();
		params.set('limit', pageSize);
		params.set('offset', String((page - 1) * Number(pageSize)));
		params.set('sort_by', 'timestamp');
		params.set('order', 'desc');
		return `/api/mcp-logs?${params.toString()}`;
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const params = filterParams().toString();
			const [listPayload, statsPayload, histogramPayload, toolsPayload] = await Promise.all([
				requestJson<unknown>(listEndpoint()),
				requestJson<McpStats>(`/api/mcp-logs/stats?${params}`),
				requestJson<JsonRecord>(`/api/mcp-logs/histogram?${params}`).catch((): JsonRecord => ({})),
				requestJson<JsonRecord>(`/api/mcp-logs/histogram/top-tools?${params}`).catch((): JsonRecord => ({})),
			]);
			logs = getListPayload(listPayload);
			stats = statsPayload;
			total = isJsonRecord(listPayload) && isJsonRecord(listPayload.pagination)
				? getTotal(listPayload.pagination, logs.length)
				: getTotal(listPayload, logs.length);
			histogram = Array.isArray(histogramPayload.buckets)
				? histogramPayload.buckets.filter((bucket): bucket is HistogramBucket => isJsonRecord(bucket))
				: [];
			topTools = Array.isArray(toolsPayload.tools) ? toolsPayload.tools.filter(isJsonRecord) : [];
			selectedIds = selectedIds.filter((id) => logs.some((log) => String(log.id) === id));
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	async function loadFilters(): Promise<void> {
		try {
			filterData = await requestJson<JsonRecord>('/api/mcp-logs/filterdata?dimensions=tool_names,server_labels');
		} catch {
			filterData = {};
		}
	}

	async function openDetail(record: JsonRecord): Promise<void> {
		selectedLog = record;
		try {
			selectedLog = await requestJson<JsonRecord>(`/api/mcp-logs/${encodeURIComponent(String(record.id))}`);
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		}
	}

	async function deleteSelected(): Promise<void> {
		if (selectedIds.length === 0 || !window.confirm(i18n.t('elygate.confirmDeleteSelected'))) return;
		isMutating = true;
		error = '';
		try {
			await requestJson('/api/mcp-logs', { method: 'DELETE', body: JSON.stringify({ ids: selectedIds }) });
			selectedIds = [];
			notice = i18n.t('elygate.deleted');
			await load();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isMutating = false;
		}
	}

	function toggleSelected(id: string, checked: boolean): void {
		selectedIds = checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((item) => item !== id);
	}

	function submitFilters(event: SubmitEvent): void {
		event.preventDefault();
		page = 1;
		void load();
	}

	function movePage(next: number): void {
		page = Math.max(1, next);
		void load();
	}

	function formatted(value: unknown): string {
		if (typeof value === 'string') {
			try { return prettyJson(JSON.parse(value), value); } catch { return value; }
		}
		return prettyJson(value, '—');
	}

	onMount(() => {
		void Promise.all([load(), loadFilters()]);
	});
</script>

<section class="page-shell">
	<header class="page-heading">
		<div><p class="eyebrow">Elygate / MCP</p><h1>{i18n.t('elygate.mcpLogs')}</h1><p>{i18n.t('elygate.mcpLogsHint')}</p></div>
		<div class="heading-actions"><button class="danger" type="button" onclick={() => void deleteSelected()} disabled={selectedIds.length === 0 || isMutating}>{i18n.t('elygate.deleteSelected')} ({selectedIds.length})</button><button class="primary" type="button" onclick={() => void load()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button></div>
	</header>

	<div class="metric-grid">
		<article><span>{i18n.t('elygate.executions')}</span><strong>{(stats.total_executions ?? total).toLocaleString()}</strong></article>
		<article><span>{i18n.t('elygate.successRate')}</span><strong>{(stats.success_rate ?? 0).toFixed(1)}%</strong></article>
		<article><span>{i18n.t('elygate.averageLatency')}</span><strong>{(stats.average_latency ?? 0).toFixed(0)} ms</strong></article>
		<article><span>{i18n.t('elygate.totalCost')}</span><strong>{formatUsdCost(stats.total_cost ?? 0)}</strong></article>
	</div>

	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}

	<div class="insights">
		<article class="chart-card"><h2>{i18n.t('elygate.mcpCalls')}</h2><div class="bars" aria-label={i18n.t('elygate.mcpCalls')}>{#each histogram as bucket (String(bucket.timestamp))}<span style={`height: ${Math.max(4, Number(bucket.count ?? 0) / maxBucketCount * 100)}%`} title={`${new Date(String(bucket.timestamp)).toLocaleString(i18n.locale)} · ${bucket.count ?? 0}`}></span>{:else}<p>{i18n.t('elygate.empty')}</p>{/each}</div></article>
		<article class="top-card"><h2>{i18n.t('elygate.topMcpTools')}</h2>{#each topTools as tool (String(tool.tool_name))}<div class="tool-row"><strong>{value(tool, 'tool_name')}</strong><span>{Number(tool.count ?? 0).toLocaleString()} · {formatUsdCost(tool.cost)}</span></div>{:else}<p>{i18n.t('elygate.empty')}</p>{/each}</article>
	</div>

	<form class="filters" onsubmit={submitFilters}>
		<label>{i18n.t('elygate.search')}<input bind:value={query} /></label>
		<label>{i18n.t('elygate.toolName')}<select bind:value={toolName}><option value="">{i18n.t('elygate.all')}</option>{#each toolNames as item (item)}<option value={item}>{item}</option>{/each}</select></label>
		<label>{i18n.t('elygate.serverLabel')}<select bind:value={serverLabel}><option value="">{i18n.t('elygate.all')}</option>{#each serverLabels as item (item)}<option value={item}>{item}</option>{/each}</select></label>
		<label>{i18n.t('elygate.status')}<select bind:value={status}><option value="">{i18n.t('elygate.all')}</option><option value="success">success</option><option value="error">error</option><option value="cancelled">cancelled</option><option value="processing">processing</option></select></label>
		<label>{i18n.t('elygate.timeRange')}<select bind:value={period}><option value="1h">1h</option><option value="24h">24h</option><option value="7d">7d</option><option value="30d">30d</option></select></label>
		<label>{i18n.t('elygate.pageSize')}<select bind:value={pageSize}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
		<button type="submit" disabled={isLoading}>{i18n.t('elygate.search')}</button>
	</form>

	<div class="table-wrap" aria-busy={isLoading}>
		<table><thead><tr><th></th><th>{i18n.t('elygate.timestamp')}</th><th>{i18n.t('elygate.toolName')}</th><th>{i18n.t('elygate.serverLabel')}</th><th>{i18n.t('elygate.status')}</th><th>{i18n.t('elygate.latency')}</th><th>{i18n.t('elygate.totalCost')}</th><th>{i18n.t('elygate.app')}</th></tr></thead><tbody>
			{#each logs as log (String(log.id))}<tr><td><input type="checkbox" checked={selectedIds.includes(String(log.id))} onchange={(event) => toggleSelected(String(log.id), event.currentTarget.checked)} aria-label={i18n.t('elygate.select')} /></td><td><button class="link" type="button" onclick={() => void openDetail(log)}>{new Date(value(log, 'timestamp')).toLocaleString(i18n.locale)}</button></td><td>{value(log, 'tool_name')}</td><td>{value(log, 'server_label')}</td><td><span class={['status', value(log, 'status')]}>{value(log, 'status')}</span></td><td>{Number(log.latency ?? 0).toFixed(0)} ms</td><td>{formatUsdCost(log.cost)}</td><td>{value(log, 'app')}</td></tr>{:else}<tr><td colspan="8">{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</td></tr>{/each}
		</tbody></table>
	</div>
	<footer class="pagination"><span>{formatPagination(page, totalPages, total, i18n.locale)}</span><div><button type="button" onclick={() => movePage(page - 1)} disabled={page <= 1 || isLoading}>{i18n.t('elygate.previous')}</button><button type="button" onclick={() => movePage(page + 1)} disabled={!hasNext || isLoading}>{i18n.t('elygate.next')}</button></div></footer>
</section>

{#if selectedLog}
	<div class="drawer-backdrop" role="presentation" onclick={() => (selectedLog = null)}></div>
	<aside class="drawer" aria-label={i18n.t('elygate.mcpLogDetails')}>
		<header><div><p>{value(selectedLog, 'server_label')}</p><h2>{value(selectedLog, 'tool_name')}</h2></div><button type="button" onclick={() => (selectedLog = null)}>{i18n.t('elygate.close')}</button></header>
		<div class="detail-grid"><div><span>{i18n.t('elygate.status')}</span><strong>{value(selectedLog, 'status')}</strong></div><div><span>{i18n.t('elygate.latency')}</span><strong>{Number(selectedLog.latency ?? 0).toFixed(0)} ms</strong></div><div><span>{i18n.t('elygate.virtualKey')}</span><strong>{value(selectedLog, 'virtual_key_name')}</strong></div><div><span>{i18n.t('elygate.llmRequestId')}</span><strong>{value(selectedLog, 'llm_request_id')}</strong></div></div>
		<h3>{i18n.t('elygate.arguments')}</h3><pre>{formatted(selectedLog.arguments)}</pre>
		<h3>{i18n.t('elygate.result')}</h3><pre>{formatted(selectedLog.result)}</pre>
		{#if selectedLog.error_details}<h3>{i18n.t('elygate.errorDetails')}</h3><pre>{formatted(selectedLog.error_details)}</pre>{/if}
		{#if selectedLog.plugin_logs}<h3>{i18n.t('elygate.pluginLogs')}</h3><pre>{formatted(selectedLog.plugin_logs)}</pre>{/if}
		<h3>{i18n.t('elygate.metadata')}</h3><pre>{formatted(selectedLog.metadata)}</pre>
	</aside>
{/if}

<style>
	.page-shell{display:grid;gap:1rem;padding:1.25rem}.page-heading,.heading-actions,.pagination,.pagination div{align-items:center;display:flex;gap:.65rem;justify-content:space-between}.eyebrow{color:var(--primary);font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.page-heading h1{font-size:1.8rem;margin:.15rem 0}.page-heading p{color:var(--muted-foreground);margin:.15rem 0}.page-shell button{background:var(--secondary);border:1px solid var(--border);border-radius:.55rem;color:var(--foreground);cursor:pointer;padding:.55rem .8rem}.page-shell button.primary{background:var(--primary);color:var(--primary-foreground)}.page-shell button.danger{color:var(--destructive)}button:disabled{cursor:not-allowed;opacity:.55}.metric-grid{display:grid;gap:.75rem;grid-template-columns:repeat(4,minmax(0,1fr))}.metric-grid article,.chart-card,.top-card{background:var(--card);border:1px solid var(--border);border-radius:.8rem;padding:1rem}.metric-grid span{color:var(--muted-foreground);display:block;font-size:.8rem}.metric-grid strong{font-size:1.45rem}.notice{border-radius:.65rem;padding:.75rem}.notice.error{background:color-mix(in oklch,var(--destructive) 12%,transparent);color:var(--destructive)}.notice.success{background:color-mix(in oklch,#16a34a 12%,transparent);color:#15803d}.insights{display:grid;gap:.75rem;grid-template-columns:2fr 1fr}.insights h2{font-size:1rem;margin:0 0 .75rem}.bars{align-items:end;display:flex;gap:2px;height:9rem}.bars span{background:var(--primary);border-radius:2px 2px 0 0;flex:1;min-width:2px}.tool-row{align-items:center;border-top:1px solid var(--border);display:flex;gap:1rem;justify-content:space-between;padding:.55rem 0}.tool-row span{color:var(--muted-foreground);font-size:.8rem}.filters{align-items:end;display:grid;gap:.65rem;grid-template-columns:2fr repeat(5,1fr) auto}.filters label{color:var(--muted-foreground);display:grid;font-size:.75rem;gap:.3rem}.filters input,.filters select{background:var(--background);border:1px solid var(--border);border-radius:.5rem;color:var(--foreground);min-width:0;padding:.55rem}.table-wrap{border:1px solid var(--border);border-radius:.8rem;overflow:auto}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--border);padding:.7rem;text-align:left;white-space:nowrap}th{background:var(--muted);font-size:.72rem}.link{background:transparent!important;border:0!important;color:var(--primary)!important;padding:0!important}.status{border-radius:999px;padding:.15rem .45rem}.status.success{background:#dcfce7;color:#166534}.status.error{background:#fee2e2;color:#991b1b}.status.processing{background:#dbeafe;color:#1e40af}.drawer-backdrop{background:rgb(0 0 0/.4);inset:0;position:fixed;z-index:60}.drawer{background:var(--background);border-left:1px solid var(--border);bottom:0;box-shadow:-12px 0 32px rgb(0 0 0/.16);display:grid;gap:.9rem;overflow:auto;padding:1.25rem;position:fixed;right:0;top:0;width:min(46rem,92vw);z-index:61}.drawer header{align-items:center;display:flex;justify-content:space-between}.drawer h2,.drawer h3,.drawer p{margin:.15rem 0}.drawer h3{font-size:.9rem}.detail-grid{display:grid;gap:.6rem;grid-template-columns:repeat(2,minmax(0,1fr))}.detail-grid div{background:var(--muted);border-radius:.55rem;padding:.65rem}.detail-grid span{color:var(--muted-foreground);display:block;font-size:.72rem}.drawer pre{background:#10131a;border-radius:.6rem;color:#e5e7eb;max-height:22rem;overflow:auto;padding:.85rem;white-space:pre-wrap;word-break:break-word}@media(max-width:950px){.page-heading{align-items:flex-start;flex-direction:column}.metric-grid{grid-template-columns:repeat(2,1fr)}.insights,.filters{grid-template-columns:1fr}.heading-actions{flex-wrap:wrap}.detail-grid{grid-template-columns:1fr}}@media(max-width:560px){.metric-grid{grid-template-columns:1fr}.page-shell{padding:.8rem}}
</style>
