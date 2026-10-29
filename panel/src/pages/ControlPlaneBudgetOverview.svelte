<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { AlertTriangle, Check, CircleCheck, LoaderCircle, RefreshCw, RotateCcw, Undo2 } from '@lucide/svelte';
	import { displayError } from '../lib/forms';
	import { requestJson } from '../lib/api';
	import { saveBudgetAcknowledgement, saveBudgetResolution, waitForBudgetAlertMutations } from '../lib/budget-alert-mutations';
	import { budgetProgress, budgetQuery, formatBudgetAmount, parseBudgetAlerts, parseBudgetStatuses, type BudgetAlert, type BudgetAlertResolution, type BudgetStatus } from '../lib/control-plane-budgets';

	let { project = '', application = '' }: { project?: string; application?: string } = $props();
	const i18n = useTranslation();
	let statuses = $state<BudgetStatus[]>([]);
	let alerts = $state<BudgetAlert[]>([]);
	let loading = $state(false);
	let statusError = $state('');
	let alertError = $state('');
	let hasNextPage = $state(false);
	let alertOffset = $state(0);
	let savingID = $state('');
	let savingAction = $state<'acknowledgement' | 'resolution' | ''>('');
	let resolution = $state<BudgetAlertResolution>('all');
	let resolutionSelect: HTMLSelectElement;
	let mutationError = $state('');
	let uncertainIDs = $state<string[]>([]);
	const alertLimit = 25;
	let loadSequence = 0;
	let activeRequest: AbortController | undefined;
	let destroyed = false;

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function date(value: string): string {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(parsed);
	}
	function label(scope: string, window: string): string {
		return `${scope === 'project' ? text('项目', 'Project') : text('应用', 'Application')} · ${window === 'daily' ? text('日', 'Daily') : text('月', 'Monthly')}`;
	}
	function stateLabel(state: BudgetStatus['state']): string {
		return state === 'exceeded' ? text('已超额', 'Exceeded') : state === 'warning' ? text('预警', 'Warning') : text('正常', 'Healthy');
	}
	async function load(scope: { project: string; application: string; resolution: BudgetAlertResolution }, offset: number): Promise<void> {
		const sequence = ++loadSequence;
		activeRequest?.abort();
		const request = new AbortController();
		activeRequest = request;
		savingID = '';
		savingAction = '';
		uncertainIDs = [];
		mutationError = '';
		loading = true;
		statusError = '';
		alertError = '';
		statuses = [];
		alerts = [];
		hasNextPage = false;
		try {
			await waitForBudgetAlertMutations();
			if (sequence !== loadSequence) return;
			const query = budgetQuery(scope.project, scope.application);
			const alertsQuery = new URLSearchParams(query);
			alertsQuery.set('resolution', scope.resolution);
			alertsQuery.set('limit', String(alertLimit + 1));
			alertsQuery.set('offset', String(offset));
			const [statusResult, alertResult] = await Promise.allSettled([
				requestJson<unknown>(`/api/control-plane/usage/budgets?${query}`, { signal: request.signal }).then(parseBudgetStatuses),
				requestJson<unknown>(`/api/control-plane/budget-alerts?${alertsQuery}`, { signal: request.signal }).then(parseBudgetAlerts),
			]);
			if (sequence !== loadSequence) return;
			if (statusResult.status === 'fulfilled') statuses = statusResult.value;
			else statusError = displayError(statusResult.reason, text('预算状态不可用', 'Budget status unavailable'));
			if (alertResult.status === 'fulfilled') {
				alerts = alertResult.value.slice(0, alertLimit);
				hasNextPage = alertResult.value.length > alertLimit;
			} else alertError = displayError(alertResult.reason, text('告警记录不可用', 'Alert history unavailable'));
		} finally {
			if (sequence === loadSequence) loading = false;
		}
	}
	function reload(): void {
		if (!loading && !savingID) void load({ project, application, resolution }, alertOffset);
	}
	function nextPage(): void {
		if (loading || savingID || !hasNextPage) return;
		alertOffset += alertLimit;
		reload();
	}
	function previousPage(): void {
		if (loading || savingID || alertOffset === 0) return;
		alertOffset = Math.max(0, alertOffset - alertLimit);
		reload();
	}
	async function applyAlertUpdate(updated: BudgetAlert, trigger: HTMLButtonElement): Promise<void> {
		if (resolution === 'all' || (resolution === 'resolved') === updated.resolved) {
			alerts = alerts.map((row) => row.id === updated.id ? updated : row);
			return;
		}
		// The row may leave this filter; refill from page one and preserve a
		// keyboard user's place without stealing focus after a scope change.
		const restoreFocus = document.activeElement === trigger;
		alertOffset = 0;
		const nextSequence = loadSequence + 1;
		await load({ project, application, resolution }, 0);
		await tick();
		if (restoreFocus && !destroyed && loadSequence === nextSequence && document.activeElement === document.body) {
			resolutionSelect.focus();
		}
	}
	async function toggleAlert(alert: BudgetAlert, action: 'acknowledgement' | 'resolution', trigger: HTMLButtonElement): Promise<void> {
		if (loading || savingID || uncertainIDs.includes(alert.id)) return;
		const sequence = loadSequence;
		savingID = alert.id;
		savingAction = action;
		mutationError = '';
		try {
			const updated = action === 'acknowledgement'
				? await saveBudgetAcknowledgement(alert.id, !alert.acknowledged)
				: await saveBudgetResolution(alert.id, !alert.resolved);
			if (sequence === loadSequence && !destroyed) await applyAlertUpdate(updated, trigger);
		} catch (cause) {
			if (sequence !== loadSequence || destroyed) return;
			// The server may have committed before the response was lost.
			uncertainIDs = [...uncertainIDs, alert.id];
			mutationError = `${displayError(cause, text('告警状态保存失败', 'Failed to save alert state'))} · ${text('请刷新确认状态', 'Refresh to verify the state')}`;
		} finally {
			if (sequence === loadSequence && !destroyed) {
				savingID = '';
				savingAction = '';
			}
		}
	}
	$effect(() => {
		const scope = { project, application, resolution };
		alertOffset = 0;
		untrack(() => { void load(scope, 0); });
	});
	onDestroy(() => {
		destroyed = true;
		loadSequence += 1;
		activeRequest?.abort();
	});
</script>

<section class="budget-overview" aria-busy={loading}>
	<header class="section-heading">
		<div>
			<h2>{text('预算状态', 'Budget status')}</h2>
			<p class="muted">{text('当前周期 · UTC', 'Current period · UTC')}</p>
		</div>
		<button class="icon-button" type="button" onclick={reload} disabled={loading || !!savingID} aria-label={text('刷新预算状态', 'Refresh budget status')} title={text('刷新预算状态', 'Refresh budget status')}><RefreshCw size={16} /></button>
	</header>
	{#if statusError}<p class="error" role="alert">{statusError}</p>{:else if loading}<p class="muted">{text('加载预算状态…', 'Loading budget status…')}</p>{:else if statuses.length === 0}<p class="empty">{text('暂无预算配置', 'No budgets configured')}</p>{:else}
		<div class="budget-status-grid">
			{#each statuses as status (`${status.scope_type}-${status.scope_id}-${status.window}`)}
				<article class="budget-status">
					<div class="status-top"><strong>{label(status.scope_type, status.window)}</strong><span class={`state ${status.state}`}>{stateLabel(status.state)}</span></div>
					<code class="scope-id">{status.scope_id}</code>
					<div class="amounts"><strong>{formatBudgetAmount(status.usage, i18n.locale)}</strong><span>/ {formatBudgetAmount(status.limit, i18n.locale)}</span></div>
					<progress max="100" value={budgetProgress(status.usage, status.limit)} aria-label={`${label(status.scope_type, status.window)} ${status.scope_id}`}></progress>
					<p class="period">{date(status.period_start)} – {date(status.period_end)}</p>
				</article>
			{/each}
		</div>
	{/if}

	<div class="alerts">
		<div class="subheading"><h3><AlertTriangle size={16} aria-hidden="true" />{text('告警记录', 'Alert history')}</h3>
			<label class="resolution-filter">{text('处理状态', 'Resolution')}
				<select bind:this={resolutionSelect} bind:value={resolution} disabled={loading || !!savingID}>
					<option value="all">{text('全部', 'All')}</option>
					<option value="open">{text('待处理', 'Open')}</option>
					<option value="resolved">{text('已处理', 'Resolved')}</option>
				</select>
			</label>
		</div>
		{#if mutationError}<p class="error" role="alert">{mutationError}</p>{/if}
		{#if alertError}<p class="error" role="alert">{alertError}</p>{:else if loading}<p class="muted">{text('加载告警记录…', 'Loading alert history…')}</p>{:else if alerts.length === 0}<p class="empty">{text('暂无告警记录', 'No alert history')}</p>{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (横向溢出的表格需要键盘滚动焦点。) -->
			<div class="table-wrap" role="region" aria-label={text('预算告警明细', 'Budget alert details')} tabindex="0"><table><thead><tr><th>{text('时间', 'Triggered')}</th><th>{text('范围', 'Scope')}</th><th>{text('周期', 'Window')}</th><th>{text('阈值', 'Threshold')}</th><th>{text('用量 / 限额', 'Usage / limit')}</th><th>{text('确认状态', 'Acknowledgement')}</th><th>{text('处理状态', 'Resolution')}</th></tr></thead><tbody>
				{#each alerts as alert (alert.id)}
					{@const uncertain = uncertainIDs.includes(alert.id)}
					{@const action = alert.acknowledged ? text('撤销确认', 'Undo acknowledgement') : text('确认告警', 'Acknowledge alert')}
					{@const resolutionAction = alert.resolved ? text('重新打开告警', 'Reopen alert') : text('标记处理完成', 'Resolve alert')}
					<tr>
						<td>{date(alert.triggered_at)}</td>
						<td>{alert.scope_type === 'project' ? text('项目', 'Project') : text('应用', 'Application')} <code>{alert.scope_id}</code></td>
						<td>{alert.window === 'daily' ? text('日', 'Daily') : text('月', 'Monthly')}</td>
						<td>{Math.round(alert.threshold * 100)}%</td>
						<td>{formatBudgetAmount(alert.usage, i18n.locale)} / {formatBudgetAmount(alert.limit, i18n.locale)}</td>
						<td><div class="acknowledgement">
							<button class="icon-button" type="button" onclick={(event) => toggleAlert(alert, 'acknowledgement', event.currentTarget)}
								aria-label={action} title={action} aria-pressed={uncertain ? undefined : alert.acknowledged}
								aria-disabled={loading || !!savingID || uncertain} aria-busy={savingID === alert.id && savingAction === 'acknowledgement'}>
								{#if savingID === alert.id && savingAction === 'acknowledgement'}<LoaderCircle size={16} aria-hidden="true" />{:else if alert.acknowledged}<Undo2 size={16} aria-hidden="true" />{:else}<Check size={16} aria-hidden="true" />{/if}
							</button>
							<div role="status">
								<span>{savingID === alert.id && savingAction === 'acknowledgement' ? text('正在保存…', 'Saving…') : uncertain ? text('状态未知', 'Unknown state') : alert.acknowledged ? text('已确认', 'Acknowledged') : text('待确认', 'Unacknowledged')}</span>
								{#if !uncertain && alert.acknowledged_at && alert.acknowledged_by}<small>{date(alert.acknowledged_at)} · {alert.acknowledged_by}</small>{/if}
							</div>
						</div></td>
						<td><div class="acknowledgement">
							<button class="icon-button" type="button" onclick={(event) => toggleAlert(alert, 'resolution', event.currentTarget)}
								aria-label={resolutionAction} title={resolutionAction} aria-pressed={uncertain ? undefined : alert.resolved}
								aria-disabled={loading || !!savingID || uncertain} aria-busy={savingID === alert.id && savingAction === 'resolution'}>
								{#if savingID === alert.id && savingAction === 'resolution'}<LoaderCircle size={16} aria-hidden="true" />{:else if alert.resolved}<RotateCcw size={16} aria-hidden="true" />{:else}<CircleCheck size={16} aria-hidden="true" />{/if}
							</button>
							<div role="status">
								<span>{savingID === alert.id && savingAction === 'resolution' ? text('正在保存…', 'Saving…') : uncertain ? text('状态未知', 'Unknown state') : alert.resolved ? text('已处理', 'Resolved') : text('待处理', 'Open')}</span>
								{#if !uncertain && alert.resolved_at && alert.resolved_by}<small>{date(alert.resolved_at)} · {alert.resolved_by}</small>{/if}
							</div>
						</div></td>
					</tr>
				{/each}
			</tbody></table></div>
		{/if}
		<footer class="pagination"><span>{text(`第 ${Math.floor(alertOffset / alertLimit) + 1} 页`, `Page ${Math.floor(alertOffset / alertLimit) + 1}`)}</span><div><button type="button" class="secondary" onclick={previousPage} disabled={loading || !!savingID || alertOffset === 0}>{text('上一页', 'Previous')}</button><button type="button" class="secondary" onclick={nextPage} disabled={loading || !!savingID || !hasNextPage}>{text('下一页', 'Next')}</button></div></footer>
	</div>
</section>

<style>
	.budget-overview { border-top: 1px solid var(--border); display: grid; gap: 1rem; padding-top: 1rem; min-width: 0; }
	.section-heading, .subheading { align-items: center; display: flex; gap: 1rem; justify-content: space-between; }
	h2, h3 { margin: 0; font-size: 1rem; }
	h3 { align-items: center; display: flex; gap: .45rem; font-size: .95rem; }
	.muted, .period, .empty { color: var(--muted-foreground); margin: 0; }
	.budget-status-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
	.budget-status { border: 1px solid var(--border); border-radius: .5rem; display: grid; gap: .65rem; padding: .85rem; min-width: 0; }
	.status-top, .amounts, .pagination { align-items: center; display: flex; gap: .5rem; justify-content: space-between; }
	.amounts { flex-wrap: wrap; overflow-wrap: anywhere; }
	.amounts strong { font-size: 1.05rem; font-variant-numeric: tabular-nums; }
	.amounts span { color: var(--muted-foreground); font-size: .85rem; }
	.state { border-radius: 999px; font-size: .72rem; padding: .2rem .45rem; }
	.state.healthy { background: color-mix(in srgb, #2f8f63 14%, transparent); color: #24704f; }
	.state.warning { background: color-mix(in srgb, #b7791f 16%, transparent); color: #8a5b14; }
	.state.exceeded { background: color-mix(in srgb, var(--destructive) 14%, transparent); color: var(--destructive); }
	progress { accent-color: var(--primary); height: .5rem; width: 100%; }
	.period { font-size: .75rem; }
	.alerts { display: grid; gap: .75rem; min-width: 0; }
	.table-wrap { overflow: auto; }
	table { border-collapse: collapse; width: 100%; font-size: .82rem; }
	th, td { border-bottom: 1px solid var(--border); padding: .55rem .6rem; text-align: left; white-space: nowrap; }
	th { color: var(--muted-foreground); font-weight: 600; }
	code { overflow-wrap: anywhere; }
	.scope-id { color: var(--muted-foreground); font-size: .75rem; }
	.icon-button { align-items: center; background: transparent; border: 1px solid var(--border); border-radius: .45rem; color: inherit; cursor: pointer; display: inline-flex; flex-shrink: 0; justify-content: center; height: 2.5rem; width: 2.5rem; padding: .45rem; }
	.acknowledgement { align-items: center; display: flex; gap: .6rem; min-width: 14rem; }
	.acknowledgement small { color: var(--muted-foreground); display: block; font-size: .75rem; }
	.resolution-filter { align-items: center; display: flex; gap: .6rem; font-size: .82rem; }
	select { background: var(--background); border: 1px solid var(--border); border-radius: .45rem; color: inherit; font: inherit; height: 2.5rem; padding: .4rem .65rem; }
	button:focus-visible, select:focus-visible, .table-wrap:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
	button.secondary { background: transparent; border: 1px solid var(--border); border-radius: .45rem; color: inherit; cursor: pointer; font: inherit; padding: .45rem .65rem; }
	button:disabled, button[aria-disabled="true"] { cursor: not-allowed; opacity: .55; }
	.error { background: color-mix(in srgb, var(--destructive) 12%, transparent); border: 1px solid var(--destructive); border-radius: .5rem; margin: 0; padding: .65rem .8rem; }
	@media (max-width: 600px) {
		.section-heading { align-items: flex-start; flex-direction: column; }
		.subheading { align-items: flex-start; flex-direction: column; }
		.icon-button { height: 2.75rem; width: 2.75rem; }
	}
</style>
