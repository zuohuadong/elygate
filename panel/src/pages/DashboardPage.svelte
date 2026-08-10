<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError } from '../lib/forms';
	import { requestJson } from '../lib/api';

	type DashboardTab = 'overview' | 'providers' | 'models' | 'mcp' | 'dimensions';
	interface Bucket { timestamp: string; [key: string]: unknown; }
	interface Ranking { model?: string; provider?: string; name?: string; id?: string; total_requests?: number; total_tokens?: number; total_cost?: number; success_rate?: number; avg_latency?: number; throughput?: number; }
	interface DashboardData {
		meta: { generated_at: string; start_time?: string; end_time?: string };
		overview: {
			stats: { total_requests: number; success_rate: number; user_facing_success_rate: number; average_latency: number; total_tokens: number; prompt_tokens: number; completion_tokens: number; total_cost: number; direct_cache_hits?: number; semantic_cache_hits?: number; cache_hit_rate_total_requests?: number };
			requests: { buckets: Bucket[] };
			tokens: { buckets: Bucket[] };
			cost: { buckets: Bucket[] };
			latency: { buckets: Bucket[] };
			throughput: { buckets: Bucket[] };
		};
		provider_usage: {
			cost: { buckets: Bucket[]; providers: string[] };
			tokens: { buckets: Bucket[]; providers: string[] };
			latency: { buckets: Bucket[]; providers: string[] };
			throughput: { buckets: Bucket[]; providers: string[] };
		};
		model_rankings: { rankings: { rankings: Ranking[] } };
		dimension_rankings: Record<string, { rankings: Ranking[] }>;
		mcp: { volume: { buckets: Bucket[] }; cost: { buckets: Bucket[] }; top_tools: { tools: { tool_name: string; count: number; cost: number }[] } };
	}
	interface ChartDefinition { labelKey: string; buckets: Bucket[]; key: string; format: (value: number) => string; }

	const i18n = useTranslation();
	let data = $state.raw<DashboardData | null>(null);
	let period = $state('24h');
	let tab = $state<DashboardTab>('overview');
	let dimension = $state('team');
	let isLoading = $state(true);
	let error = $state('');

	const stats = $derived(data?.overview.stats);
	const cacheHits = $derived((stats?.direct_cache_hits ?? 0) + (stats?.semantic_cache_hits ?? 0));
	const cacheRate = $derived(stats?.cache_hit_rate_total_requests ? cacheHits / stats.cache_hit_rate_total_requests * 100 : 0);
	const overviewCharts = $derived.by<ChartDefinition[]>(() => data ? [
		{ labelKey: 'elygate.requestVolume', buckets: data.overview.requests.buckets, key: 'count', format: integer },
		{ labelKey: 'elygate.tokenUsage', buckets: data.overview.tokens.buckets, key: 'total_tokens', format: compact },
		{ labelKey: 'elygate.totalCost', buckets: data.overview.cost.buckets, key: 'total_cost', format: currency },
		{ labelKey: 'elygate.averageLatency', buckets: data.overview.latency.buckets, key: 'avg_latency', format: milliseconds },
		{ labelKey: 'elygate.throughput', buckets: data.overview.throughput.buckets, key: 'tokens_per_second', format: (value) => `${value.toFixed(1)} tok/s` },
	] : []);
	const providerRows = $derived(providerUsageRows(data));
	const modelRows = $derived(data?.model_rankings.rankings.rankings ?? []);
	const dimensionRows = $derived(data?.dimension_rankings[dimension]?.rankings ?? []);

	function numberValue(value: unknown): number {
		return typeof value === 'number' && Number.isFinite(value) ? value : 0;
	}

	function integer(value: number): string { return Math.round(value).toLocaleString(); }
	function compact(value: number): string { return new Intl.NumberFormat(i18n.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
	function currency(value: number): string { return new Intl.NumberFormat(i18n.locale, { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 4 : 2 }).format(value); }
	function milliseconds(value: number): string { return `${value.toFixed(0)} ms`; }
	function percentage(value: number): string { return `${value.toFixed(1)}%`; }

	function chartPoints(buckets: Bucket[], key: string): string {
		if (!buckets.length) return '';
		const values = buckets.map((bucket) => numberValue(bucket[key]));
		const max = Math.max(...values, 1);
		return values.map((value, index) => `${buckets.length === 1 ? 50 : (index / (buckets.length - 1)) * 100},${52 - (value / max) * 46}`).join(' ');
	}

	function chartTotal(buckets: Bucket[], key: string): number {
		return buckets.reduce((total, bucket) => total + numberValue(bucket[key]), 0);
	}

	function nestedNumber(bucket: Bucket, section: string, provider: string, field?: string): number {
		const value = bucket[section];
		if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
		const providerValue = (value as Record<string, unknown>)[provider];
		if (!field) return numberValue(providerValue);
		if (!providerValue || typeof providerValue !== 'object' || Array.isArray(providerValue)) return 0;
		return numberValue((providerValue as Record<string, unknown>)[field]);
	}

	function providerUsageRows(source: DashboardData | null): Ranking[] {
		if (!source) return [];
		const providers = new Set([
			...(source.provider_usage.cost.providers ?? []),
			...(source.provider_usage.tokens.providers ?? []),
			...(source.provider_usage.latency.providers ?? []),
			...(source.provider_usage.throughput.providers ?? []),
		]);
		return [...providers].map((provider) => {
			const cost = source.provider_usage.cost.buckets.reduce((sum, bucket) => sum + nestedNumber(bucket, 'by_provider', provider), 0);
			const tokens = source.provider_usage.tokens.buckets.reduce((sum, bucket) => sum + nestedNumber(bucket, 'by_provider', provider, 'total_tokens'), 0);
			const latencyValues = source.provider_usage.latency.buckets.map((bucket) => nestedNumber(bucket, 'by_provider', provider, 'avg_latency')).filter(Boolean);
			const throughputValues = source.provider_usage.throughput.buckets.map((bucket) => nestedNumber(bucket, 'by_provider', provider, 'tokens_per_second')).filter(Boolean);
			return {
				provider,
				total_cost: cost,
				total_tokens: tokens,
				avg_latency: latencyValues.length ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length : 0,
				throughput: throughputValues.length ? throughputValues.reduce((sum, value) => sum + value, 0) / throughputValues.length : 0,
			};
		}).sort((left, right) => (right.total_cost ?? 0) - (left.total_cost ?? 0));
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			data = await requestJson<DashboardData>(`/api/logs/dashboard?period=${encodeURIComponent(period)}&limit=20`);
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	function exportCsv(): void {
		if (!data) return;
		const rows = modelRows.map((row) => [row.model, row.provider, row.total_requests, row.total_tokens, row.total_cost, row.success_rate, row.avg_latency, row.throughput]);
		const csv = [['model', 'provider', 'requests', 'tokens', 'cost', 'success_rate', 'avg_latency_ms', 'throughput'], ...rows]
			.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
		const link = document.createElement('a');
		link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
		link.download = `elygate-dashboard-${period}.csv`;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	onMount(() => {
		void load();
	});
</script>

<section class="page-shell">
	<header class="page-heading">
		<div>
			<p class="eyebrow">Elygate / Observability</p>
			<h1>{i18n.t('elygate.dashboard')}</h1>
			<p>{i18n.t('elygate.dashboardHint')}</p>
		</div>
		<div class="heading-actions">
			<select bind:value={period} onchange={() => void load()} aria-label={i18n.t('elygate.timeRange')}>
				<option value="1h">{i18n.t('elygate.lastHour')}</option>
				<option value="24h">{i18n.t('elygate.lastDay')}</option>
				<option value="7d">{i18n.t('elygate.lastWeek')}</option>
				<option value="30d">{i18n.t('elygate.lastMonth')}</option>
			</select>
			<button type="button" onclick={exportCsv} disabled={!data}>{i18n.t('elygate.exportCsv')}</button>
			<button class="primary" type="button" onclick={() => void load()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button>
		</div>
	</header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}

	<div class="metric-grid" aria-busy={isLoading}>
		<article><span>{i18n.t('elygate.totalRequests')}</span><strong>{integer(stats?.total_requests ?? 0)}</strong></article>
		<article><span>{i18n.t('elygate.successRate')}</span><strong>{percentage(stats?.user_facing_success_rate ?? stats?.success_rate ?? 0)}</strong></article>
		<article><span>{i18n.t('elygate.averageLatency')}</span><strong>{milliseconds(stats?.average_latency ?? 0)}</strong></article>
		<article><span>{i18n.t('elygate.tokenUsage')}</span><strong>{compact(stats?.total_tokens ?? 0)}</strong></article>
		<article><span>{i18n.t('elygate.totalCost')}</span><strong>{currency(stats?.total_cost ?? 0)}</strong></article>
		<article><span>{i18n.t('elygate.cacheHitRate')}</span><strong>{percentage(cacheRate)}</strong></article>
	</div>

	<nav class="tabs" aria-label={i18n.t('elygate.dashboard')}>
		{#each [['overview', 'elygate.overview'], ['providers', 'elygate.providerUsage'], ['models', 'elygate.modelRankings'], ['mcp', 'elygate.mcpUsage'], ['dimensions', 'elygate.governanceRankings']] as item (item[0])}
			<button type="button" class:is-active={tab === item[0]} onclick={() => (tab = item[0] as DashboardTab)}>{i18n.t(item[1])}</button>
		{/each}
	</nav>

	{#if tab === 'overview'}
		<div class="chart-grid">
			{#each overviewCharts as chart (chart.labelKey)}
				<article class="chart-card">
					<div><span>{i18n.t(chart.labelKey)}</span><strong>{chart.format(chartTotal(chart.buckets, chart.key))}</strong></div>
					<svg viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true"><polyline points={chartPoints(chart.buckets, chart.key)} /></svg>
				</article>
			{/each}
		</div>
	{:else if tab === 'providers'}
		{@render RankingTable(providerRows, 'provider', i18n)}
	{:else if tab === 'models'}
		{@render RankingTable(modelRows, 'model', i18n)}
	{:else if tab === 'mcp'}
		<div class="mcp-grid">
			<article class="chart-card"><div><span>{i18n.t('elygate.mcpCalls')}</span><strong>{integer(chartTotal(data?.mcp.volume.buckets ?? [], 'count'))}</strong></div><svg viewBox="0 0 100 56" preserveAspectRatio="none"><polyline points={chartPoints(data?.mcp.volume.buckets ?? [], 'count')} /></svg></article>
			<article class="chart-card"><div><span>{i18n.t('elygate.mcpCost')}</span><strong>{currency(chartTotal(data?.mcp.cost.buckets ?? [], 'total_cost'))}</strong></div><svg viewBox="0 0 100 56" preserveAspectRatio="none"><polyline points={chartPoints(data?.mcp.cost.buckets ?? [], 'total_cost')} /></svg></article>
			<article class="panel top-tools"><h2>{i18n.t('elygate.topMcpTools')}</h2>{#each data?.mcp.top_tools.tools ?? [] as tool (tool.tool_name)}<div><span>{tool.tool_name}</span><strong>{integer(tool.count)} · {currency(tool.cost)}</strong></div>{:else}<p>{i18n.t('elygate.empty')}</p>{/each}</article>
		</div>
	{:else}
		<div class="dimension-picker">
			{#each ['team', 'user', 'virtual_key', 'customer', 'business_unit'] as item (item)}
				<button type="button" class:is-active={dimension === item} onclick={() => (dimension = item)}>{i18n.t(`elygate.dimension.${item}`)}</button>
			{/each}
		</div>
		{@render RankingTable(dimensionRows, 'name', i18n)}
	{/if}

	<p class="updated">{i18n.t('elygate.lastUpdated')}: {data?.meta.generated_at ? new Date(data.meta.generated_at).toLocaleString(i18n.locale) : '—'}</p>
</section>

{#snippet RankingTable(rows: Ranking[], nameKey: 'model' | 'provider' | 'name', i18n: ReturnType<typeof useTranslation>)}
	<div class="table-wrap"><table><thead><tr><th>{i18n.t('elygate.name')}</th><th>{i18n.t('elygate.totalRequests')}</th><th>{i18n.t('elygate.tokenUsage')}</th><th>{i18n.t('elygate.totalCost')}</th><th>{i18n.t('elygate.successRate')}</th><th>{i18n.t('elygate.averageLatency')}</th><th>{i18n.t('elygate.throughput')}</th></tr></thead><tbody>
		{#each rows as row, index (`${String(row[nameKey] ?? row.id ?? '')}:${index}`)}
			<tr><td><strong>{String(row[nameKey] ?? row.id ?? '—')}</strong>{#if nameKey === 'model' && row.provider}<small>{row.provider}</small>{/if}</td><td>{integer(row.total_requests ?? 0)}</td><td>{compact(row.total_tokens ?? 0)}</td><td>{currency(row.total_cost ?? 0)}</td><td>{row.success_rate === undefined ? '—' : percentage(row.success_rate)}</td><td>{row.avg_latency === undefined ? '—' : milliseconds(row.avg_latency)}</td><td>{row.throughput === undefined ? '—' : `${row.throughput.toFixed(1)} tok/s`}</td></tr>
		{:else}<tr><td colspan="7">{i18n.t('elygate.empty')}</td></tr>{/each}
	</tbody></table></div>
{/snippet}

<style>
	.page-shell { max-width: 1260px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: start; display: flex; gap: 1rem; justify-content: space-between; margin-bottom: 1.25rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .45rem; text-transform: uppercase; }
	h1 { font-size: clamp(1.5rem, 3vw, 2.15rem); margin: 0; }
	.page-heading p, .updated { color: var(--muted-foreground); }
	.page-heading p { margin: .55rem 0 0; max-width: 720px; }
	.heading-actions, .tabs, .dimension-picker { display: flex; flex-wrap: wrap; gap: .45rem; }
	button, select { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); cursor: pointer; font-weight: 650; padding: .55rem .7rem; }
	button.primary, button.is-active { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button:disabled { cursor: wait; opacity: .55; }
	.metric-grid { display: grid; gap: .75rem; grid-template-columns: repeat(6, minmax(0, 1fr)); }
	.metric-grid article, .chart-card, .panel { background: var(--card); border: 1px solid var(--border); border-radius: .85rem; }
	.metric-grid article { padding: 1rem; }
	.metric-grid span, .chart-card span { color: var(--muted-foreground); font-size: .78rem; }
	.metric-grid strong { display: block; font-size: 1.45rem; margin-top: .35rem; }
	.tabs { border-bottom: 1px solid var(--border); margin: 1rem 0; padding-bottom: .65rem; }
	.chart-grid { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.chart-card { padding: .9rem; }
	.chart-card > div { align-items: center; display: flex; justify-content: space-between; }
	.chart-card svg { display: block; height: 145px; margin-top: .7rem; width: 100%; }
	polyline { fill: none; stroke: var(--primary); stroke-width: 2; vector-effect: non-scaling-stroke; }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .85rem; overflow-x: auto; }
	table { border-collapse: collapse; min-width: 900px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); font-size: .8rem; padding: .7rem .8rem; text-align: left; }
	th { color: var(--muted-foreground); }
	td small { color: var(--muted-foreground); display: block; margin-top: .2rem; }
	.mcp-grid { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.top-tools { grid-column: 1 / -1; padding: 1rem; }
	.top-tools h2 { font-size: 1rem; margin: 0 0 .65rem; }
	.top-tools > div { border-top: 1px solid var(--border); display: flex; justify-content: space-between; padding: .6rem 0; }
	.dimension-picker { margin-bottom: .7rem; }
	.updated { font-size: .8rem; margin-top: .85rem; }
	.notice { border-radius: .65rem; margin-bottom: 1rem; padding: .75rem 1rem; }
	.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	@media (max-width: 1040px) { .metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	@media (max-width: 720px) { .page-heading { flex-direction: column; } .metric-grid, .chart-grid, .mcp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 520px) { .metric-grid, .chart-grid, .mcp-grid { grid-template-columns: 1fr; } }
</style>
