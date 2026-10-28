<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { ChevronLeft, ChevronRight, Filter, RefreshCw } from '@lucide/svelte';
	import { requestJson } from '../lib/api';
	import { displayError } from '../lib/forms';
	import { formatBudgetAmount, type BudgetStatus } from '../lib/control-plane-budgets';
	import { budgetHistoryQuery, budgetHistoryRangeTimes, defaultBudgetHistoryRange, parseBudgetHistory, type BudgetHistoryPage, type BudgetHistoryRange, type BudgetWindow } from '../lib/control-plane-budget-history';

	let { project = '', application = '' }: { project?: string; application?: string } = $props();
	const i18n = useTranslation();
	const id = $props.id();
	const initialRange = defaultBudgetHistoryRange('daily');
	let range = $state<BudgetHistoryRange>(initialRange);
	let draftStart = $state(initialRange.start);
	let draftEnd = $state(initialRange.end);
	let page = $state<BudgetHistoryPage | null>(null);
	let offset = $state(0);
	let loading = $state(false);
	let error = $state('');
	let rangeError = $state('');
	let sequence = 0;
	let controller: AbortController | undefined;
	const lastPage = $derived(page === null || page.offset + page.data.length >= page.total);
	const maxEnd = $derived(defaultBudgetHistoryRange(range.window).end);

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function periodLabel(timestamp: string): string {
		return new Intl.DateTimeFormat(i18n.locale, range.window === 'monthly'
			? { year: 'numeric', month: 'short', timeZone: 'UTC' }
			: { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(timestamp));
	}
	function stateLabel(state: BudgetStatus['state']): string {
		return state === 'exceeded' ? text('已超额', 'Exceeded') : state === 'warning' ? text('预警', 'Warning') : text('正常', 'Healthy');
	}
	async function load(requestRange: BudgetHistoryRange, scope: { project: string; application: string }, requestOffset: number): Promise<void> {
		const requestSequence = ++sequence;
		controller?.abort();
		controller = new AbortController();
		loading = true;
		error = '';
		page = null;
		try {
			const query = budgetHistoryQuery(requestRange, scope, requestOffset);
			const loaded = parseBudgetHistory(await requestJson<unknown>(`/api/control-plane/usage/budgets/history?${query}`, { signal: controller.signal }));
			if (requestSequence !== sequence) return;
			if (loaded.window !== requestRange.window || loaded.offset !== requestOffset) throw new Error('Invalid budget history response');
			page = loaded;
		} catch (cause) {
			if (requestSequence === sequence) error = displayError(cause, text('历史预算不可用', 'Budget history unavailable'));
		} finally {
			if (requestSequence === sequence) loading = false;
		}
	}
	function reload(): void { void load(range, { project, application }, offset); }
	function switchWindow(window: BudgetWindow): void {
		if (window === range.window) return;
		range = defaultBudgetHistoryRange(window);
		draftStart = range.start;
		draftEnd = range.end;
		rangeError = '';
	}
	function applyRange(event: SubmitEvent): void {
		event.preventDefault();
		const next = { window: range.window, start: draftStart, end: draftEnd };
		try {
			budgetHistoryRangeTimes(next);
			rangeError = '';
			range = next;
		} catch {
			rangeError = range.window === 'daily'
				? text('请选择已结束且不超过 366 天的 UTC 日期范围', 'Choose a closed UTC range of up to 366 days')
				: text('请选择已结束且不超过 60 个月的 UTC 月份范围', 'Choose a closed UTC range of up to 60 months');
		}
	}
	function changePage(direction: -1 | 1): void { offset = Math.max(0, offset + direction * 25); reload(); }
	$effect(() => {
		const requestRange = range;
		const scope = { project, application };
		offset = 0;
		untrack(() => { void load(requestRange, scope, 0); });
	});
	onDestroy(() => { sequence += 1; controller?.abort(); });
</script>

<section class="budget-history" aria-busy={loading} aria-labelledby={`${id}-heading`}>
	<header>
		<div><h2 id={`${id}-heading`}>{text('历史预算', 'Budget history')}</h2><p class="muted">{text('已关闭周期 · UTC · USD', 'Closed periods · UTC · USD')}</p></div>
		<button class="icon-button" type="button" onclick={reload} disabled={loading} aria-label={text('刷新历史预算', 'Refresh budget history')} title={text('刷新历史预算', 'Refresh budget history')}><RefreshCw size={16} aria-hidden="true" /></button>
	</header>
	<form onsubmit={applyRange} class="history-filters">
		<div class="window-control" role="group" aria-label={text('历史预算周期', 'Budget history window')}>
			<button type="button" aria-pressed={range.window === 'daily'} onclick={() => switchWindow('daily')}>{text('日', 'Daily')}</button>
			<button type="button" aria-pressed={range.window === 'monthly'} onclick={() => switchWindow('monthly')}>{text('月', 'Monthly')}</button>
		</div>
		<label for={`${id}-start`}>{text('开始周期 (UTC)', 'First period (UTC)')}<input id={`${id}-start`} type={range.window === 'daily' ? 'date' : 'month'} bind:value={draftStart} max={maxEnd} required aria-invalid={!!rangeError} aria-describedby={rangeError ? `${id}-error` : undefined} /></label>
		<label for={`${id}-end`}>{text('结束边界 (不含)', 'End boundary (exclusive)')}<input id={`${id}-end`} type={range.window === 'daily' ? 'date' : 'month'} bind:value={draftEnd} max={maxEnd} required aria-invalid={!!rangeError} aria-describedby={rangeError ? `${id}-error` : undefined} /></label>
		<button class="apply" type="submit"><Filter size={15} aria-hidden="true" />{text('应用', 'Apply')}</button>
	</form>
	{#if rangeError}<p class="error" id={`${id}-error`} role="alert">{rangeError}</p>{/if}
	<div class="history-content">
		{#if error}<p class="error" role="alert">{error}</p>
		{:else if loading}<p class="muted" role="status">{text('加载历史预算…', 'Loading budget history…')}</p>
		{:else if page && page.data.length === 0}<p class="muted">{text('此范围暂无历史预算', 'No budget history in this range')}</p>
		{:else if page}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (横向溢出的表格需要键盘滚动焦点。) -->
			<div class="table-wrap" role="region" aria-label={text('历史预算明细', 'Budget history details')} tabindex="0">
				<table><thead><tr><th scope="col">{text('周期', 'Period')}</th><th scope="col">{text('范围', 'Scope')}</th><th scope="col" class="numeric">{text('用量 / 限额', 'Usage / limit')}</th><th scope="col" class="numeric">{text('利用率', 'Utilization')}</th><th scope="col">{text('状态', 'Status')}</th></tr></thead>
					<tbody>{#each page.data as status (`${status.scope_type}-${status.scope_id}-${status.period_start}`)}
						<tr><td class="period">{periodLabel(status.period_start)}</td><td class="scope"><strong>{status.scope_name}</strong><span class="muted">{status.scope_type === 'project' ? text('项目', 'Project') : text('应用', 'Application')}</span><code>{status.scope_id}</code></td><td class="numeric">{formatBudgetAmount(status.usage, i18n.locale)} / {formatBudgetAmount(status.limit, i18n.locale)}</td><td class="numeric">{new Intl.NumberFormat(i18n.locale, { style: 'percent', maximumFractionDigits: 1 }).format(status.usage / status.limit)}</td><td><span class={`state ${status.state}`}>{stateLabel(status.state)}</span></td></tr>
					{/each}</tbody>
				</table>
			</div>
		{/if}
	</div>
	<footer>
		<span class="muted" aria-live="polite">{page ? text(`共 ${page.total} 条 · 第 ${Math.floor(offset / 25) + 1} 页`, `${page.total} records · Page ${Math.floor(offset / 25) + 1}`) : text(`第 ${Math.floor(offset / 25) + 1} 页`, `Page ${Math.floor(offset / 25) + 1}`)}</span>
		<div class="page-controls"><button class="icon-button" type="button" onclick={() => changePage(-1)} disabled={loading || offset === 0} aria-label={text('历史预算上一页', 'Previous budget history page')} title={text('历史预算上一页', 'Previous budget history page')}><ChevronLeft size={17} aria-hidden="true" /></button><button class="icon-button" type="button" onclick={() => changePage(1)} disabled={loading || lastPage} aria-label={text('历史预算下一页', 'Next budget history page')} title={text('历史预算下一页', 'Next budget history page')}><ChevronRight size={17} aria-hidden="true" /></button></div>
	</footer>
</section>

<style>
	.budget-history { border-top: 1px solid var(--border); display: grid; gap: 1rem; padding-top: 1rem; min-width: 0; }
	header, footer { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
	h2 { font-size: 1rem; margin: 0; }
	p { margin: 0; }
	.muted, code { color: var(--muted-foreground); font-size: .82rem; }
	.history-filters { display: flex; gap: .75rem; align-items: end; flex-wrap: wrap; }
	label { display: grid; gap: .35rem; font-size: .82rem; min-width: 0; flex: 1 1 180px; max-width: 240px; }
	input, button { border: 1px solid var(--border); border-radius: .4rem; color: inherit; background: var(--background); font: inherit; min-height: 44px; }
	input { padding: .45rem .6rem; min-width: 0; width: 100%; box-sizing: border-box; }
	button { cursor: pointer; }
	button:disabled { cursor: not-allowed; opacity: .5; }
	button:hover:not(:disabled) { background: var(--muted); }
	button:focus-visible, input:focus-visible, .table-wrap:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
	.window-control { display: inline-flex; flex-shrink: 0; }
	.window-control button { border-radius: 0; min-width: 48px; padding: .45rem .7rem; }
	.window-control button:first-child { border-radius: .4rem 0 0 .4rem; }
	.window-control button:last-child { border-radius: 0 .4rem .4rem 0; border-left: 0; }
	.window-control button[aria-pressed="true"] { background: var(--muted); font-weight: 600; color: var(--foreground); }
	.apply, .icon-button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; gap: .4rem; }
	.apply { padding: .45rem .75rem; }
	.icon-button { width: 44px; height: 44px; padding: .5rem; }
	.history-content { min-height: 90px; min-width: 0; }
	.table-wrap { overflow-x: auto; max-width: 100%; }
	table { border-collapse: collapse; width: 100%; font-size: .82rem; }
	th, td { padding: .65rem .6rem; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
	th { color: var(--muted-foreground); font-weight: 600; white-space: nowrap; }
	.period, .numeric { white-space: nowrap; font-variant-numeric: tabular-nums; }
	.numeric { text-align: right; }
	.scope { min-width: 140px; max-width: 280px; overflow-wrap: anywhere; }
	.scope strong, .scope span, code { display: block; }
	code { font-size: .72rem; }
	.state { display: inline-block; font-size: .75rem; white-space: nowrap; }
	.state.warning { font-weight: 600; text-decoration: underline dotted; text-underline-offset: .25rem; }
	.state.exceeded { color: var(--destructive); font-weight: 600; }
	.page-controls { display: flex; gap: .5rem; }
	.error { background: color-mix(in srgb, var(--destructive) 12%, transparent); border: 1px solid var(--destructive); border-radius: .5rem; padding: .65rem .8rem; overflow-wrap: anywhere; }
	@media (max-width: 600px) { label { max-width: none; flex-basis: calc(50% - .75rem); } .window-control { flex-basis: 100%; } }
</style>
