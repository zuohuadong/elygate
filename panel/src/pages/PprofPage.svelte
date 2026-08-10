<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError } from '../lib/forms';
	import { requestJson } from '../lib/api';

	interface Props { resourceName: string; }
	interface Allocation { function: string; file: string; line: number; bytes: number; count: number; stack: string[]; }
	interface HistoryPoint { timestamp: string; alloc: number; heap_inuse: number; goroutines: number; gc_pause_ns: number; cpu_percent: number; }
	interface PprofData {
		timestamp: string;
		memory: { alloc: number; total_alloc: number; heap_inuse: number; heap_objects: number; sys: number };
		cpu: { usage_percent: number; user_time: number; system_time: number };
		runtime: { num_goroutine: number; num_gc: number; gc_pause_ns: number; num_cpu: number; gomaxprocs: number };
		top_allocations: Allocation[];
		inuse_allocations: Allocation[];
		history: HistoryPoint[];
	}
	interface GoroutineGroup { count: number; state: string; wait_reason?: string; wait_minutes?: number; top_func: string; stack: string[]; category: string; }
	interface GoroutineProfile {
		timestamp: string;
		total_goroutines: number;
		groups: GoroutineGroup[];
		summary: { background: number; per_request: number; long_waiting: number; potentially_stuck: number };
	}

	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let pprof = $state.raw<PprofData | null>(null);
	let goroutines = $state.raw<GoroutineProfile | null>(null);
	let isLoading = $state(true);
	let error = $state('');
	let allocationMode = $state<'inuse' | 'cumulative'>('inuse');
	let showOnlyStuck = $state(false);

	const allocations = $derived(
		[...(allocationMode === 'inuse' ? pprof?.inuse_allocations ?? [] : pprof?.top_allocations ?? [])]
			.sort((left, right) => right.bytes - left.bytes),
	);
	const visibleGroups = $derived(
		(goroutines?.groups ?? []).filter((group) => !showOnlyStuck || (group.wait_minutes ?? 0) > 0),
	);

	function formatBytes(bytes = 0): string {
		if (!bytes) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		return `${(bytes / 1024 ** index).toFixed(2)} ${units[index]}`;
	}

	function formatDuration(ns = 0): string {
		if (ns < 1_000) return `${ns}ns`;
		if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)}µs`;
		if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)}ms`;
		return `${(ns / 1_000_000_000).toFixed(2)}s`;
	}

	function historyPoints(key: 'alloc' | 'heap_inuse' | 'goroutines' | 'cpu_percent'): string {
		const history = pprof?.history ?? [];
		if (history.length < 2) return '';
		const values = history.map((point) => point[key]);
		const max = Math.max(...values, 1);
		return values.map((value, index) => `${(index / (values.length - 1)) * 100},${48 - (value / max) * 44}`).join(' ');
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			[pprof, goroutines] = await Promise.all([
				requestJson<PprofData>('/api/dev/pprof'),
				requestJson<GoroutineProfile>('/api/dev/pprof/goroutines'),
			]);
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.pprofUnavailable'));
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		void load();
		const timer = window.setInterval(() => void load(), 10_000);
		return () => window.clearInterval(timer);
	});
</script>

<section class="page-shell">
	<header class="page-heading">
		<div>
			<p class="eyebrow">Elygate / Go Runtime</p>
			<h1>{i18n.t('elygate.pprof')}</h1>
			<p>{i18n.t('elygate.pprofHint')}</p>
		</div>
		<button type="button" onclick={() => void load()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button>
	</header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}

	<div class="metric-grid" aria-busy={isLoading}>
		<article><span>{i18n.t('elygate.heapAllocated')}</span><strong>{formatBytes(pprof?.memory.alloc)}</strong></article>
		<article><span>{i18n.t('elygate.heapInUse')}</span><strong>{formatBytes(pprof?.memory.heap_inuse)}</strong></article>
		<article><span>{i18n.t('elygate.cpuUsage')}</span><strong>{(pprof?.cpu.usage_percent ?? 0).toFixed(1)}%</strong></article>
		<article><span>{i18n.t('elygate.goroutines')}</span><strong>{goroutines?.total_goroutines ?? pprof?.runtime.num_goroutine ?? 0}</strong></article>
		<article><span>{i18n.t('elygate.gcRuns')}</span><strong>{pprof?.runtime.num_gc ?? 0}</strong></article>
		<article><span>{i18n.t('elygate.gcPause')}</span><strong>{formatDuration(pprof?.runtime.gc_pause_ns)}</strong></article>
		<article><span>{i18n.t('elygate.heapObjects')}</span><strong>{(pprof?.memory.heap_objects ?? 0).toLocaleString()}</strong></article>
		<article><span>{i18n.t('elygate.potentiallyStuck')}</span><strong>{goroutines?.summary.potentially_stuck ?? 0}</strong></article>
	</div>

	<section class="panel">
		<h2>{i18n.t('elygate.runtimeHistory')}</h2>
		<div class="charts">
			{#each [['alloc', 'elygate.heapAllocated'], ['heap_inuse', 'elygate.heapInUse'], ['goroutines', 'elygate.goroutines'], ['cpu_percent', 'elygate.cpuUsage']] as chart (chart[0])}
				<div class="sparkline">
					<span>{i18n.t(chart[1])}</span>
					<svg viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true"><polyline points={historyPoints(chart[0] as 'alloc' | 'heap_inuse' | 'goroutines' | 'cpu_percent')} /></svg>
				</div>
			{/each}
		</div>
	</section>

	<section class="panel">
		<div class="section-heading">
			<h2>{i18n.t('elygate.allocations')}</h2>
			<div class="segmented">
				<button type="button" class:is-active={allocationMode === 'inuse'} onclick={() => (allocationMode = 'inuse')}>{i18n.t('elygate.liveMemory')}</button>
				<button type="button" class:is-active={allocationMode === 'cumulative'} onclick={() => (allocationMode = 'cumulative')}>{i18n.t('elygate.cumulative')}</button>
			</div>
		</div>
		<div class="table-wrap"><table><thead><tr><th>{i18n.t('elygate.function')}</th><th>{i18n.t('elygate.file')}</th><th>{i18n.t('elygate.bytes')}</th><th>{i18n.t('elygate.count')}</th></tr></thead><tbody>
			{#each allocations as item (`${item.function}:${item.file}:${item.line}`)}
				<tr><td><details><summary>{item.function}</summary><pre>{item.stack.join('\n')}</pre></details></td><td>{item.file}:{item.line}</td><td>{formatBytes(item.bytes)}</td><td>{item.count.toLocaleString()}</td></tr>
			{:else}<tr><td colspan="4">{i18n.t('elygate.empty')}</td></tr>{/each}
		</tbody></table></div>
	</section>

	<section class="panel">
		<div class="section-heading">
			<h2>{i18n.t('elygate.goroutineGroups')}</h2>
			<label class="filter"><input type="checkbox" bind:checked={showOnlyStuck} /> {i18n.t('elygate.onlyWaiting')}</label>
		</div>
		<div class="summary-row">
			<span>{i18n.t('elygate.background')}: <strong>{goroutines?.summary.background ?? 0}</strong></span>
			<span>{i18n.t('elygate.perRequest')}: <strong>{goroutines?.summary.per_request ?? 0}</strong></span>
			<span>{i18n.t('elygate.longWaiting')}: <strong>{goroutines?.summary.long_waiting ?? 0}</strong></span>
		</div>
		<div class="group-list">
			{#each visibleGroups as group, index (`${group.top_func}:${group.state}:${index}`)}
				<details><summary><strong>{group.count}×</strong> {group.top_func} <span>{group.category} · {group.state}{group.wait_reason ? ` · ${group.wait_reason}` : ''}</span></summary><pre>{group.stack.join('\n')}</pre></details>
			{:else}<p>{i18n.t('elygate.empty')}</p>{/each}
		</div>
	</section>
</section>

<style>
	.page-shell { max-width: 1240px; margin: 0 auto; padding: 1.5rem; }
	.page-heading, .section-heading { align-items: start; display: flex; gap: 1rem; justify-content: space-between; }
	.page-heading { margin-bottom: 1.25rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .45rem; text-transform: uppercase; }
	h1 { font-size: clamp(1.5rem, 3vw, 2.15rem); margin: 0; }
	.page-heading p { color: var(--muted-foreground); margin: .55rem 0 0; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); cursor: pointer; font-weight: 650; padding: .55rem .7rem; }
	.page-heading > button, button.is-active { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button:disabled { cursor: wait; opacity: .55; }
	.metric-grid { display: grid; gap: .75rem; grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.metric-grid article, .panel { background: var(--card); border: 1px solid var(--border); border-radius: .85rem; }
	.metric-grid article { padding: 1rem; }
	.metric-grid span { color: var(--muted-foreground); font-size: .8rem; }
	.metric-grid strong { display: block; font-size: 1.35rem; margin-top: .35rem; }
	.panel { margin-top: .85rem; padding: 1rem; }
	h2 { font-size: 1.05rem; margin: 0 0 .8rem; }
	.charts { display: grid; gap: .75rem; grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.sparkline { border: 1px solid var(--border); border-radius: .6rem; padding: .65rem; }
	.sparkline span { color: var(--muted-foreground); font-size: .75rem; }
	.sparkline svg { display: block; height: 70px; margin-top: .4rem; width: 100%; }
	polyline { fill: none; stroke: var(--primary); stroke-width: 2; vector-effect: non-scaling-stroke; }
	.segmented { display: flex; gap: .35rem; }
	.table-wrap { overflow-x: auto; }
	table { border-collapse: collapse; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); font-size: .8rem; padding: .65rem; text-align: left; vertical-align: top; }
	th { color: var(--muted-foreground); }
	td pre, .group-list pre { background: var(--muted); border-radius: .45rem; max-height: 240px; overflow: auto; padding: .65rem; white-space: pre-wrap; }
	.filter { align-items: center; display: flex; font-size: .8rem; gap: .35rem; }
	.summary-row { display: flex; flex-wrap: wrap; gap: .6rem; margin-bottom: .75rem; }
	.summary-row span { background: var(--muted); border-radius: 999px; font-size: .78rem; padding: .35rem .6rem; }
	.group-list { display: grid; gap: .45rem; }
	.group-list details { border: 1px solid var(--border); border-radius: .55rem; padding: .65rem; }
	.group-list summary { cursor: pointer; }
	.group-list summary span { color: var(--muted-foreground); font-size: .78rem; }
	.notice { border-radius: .65rem; margin-bottom: 1rem; padding: .75rem 1rem; }
	.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	@media (max-width: 860px) { .metric-grid, .charts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 560px) { .page-heading, .section-heading { align-items: stretch; flex-direction: column; } .metric-grid { grid-template-columns: 1fr; } }
</style>
