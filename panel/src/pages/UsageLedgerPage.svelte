<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getAppName } from '../lib/branding';
	import { displayError } from '../lib/forms';
	import { formatUsdCost } from '../lib/display-format';
	import { getListPayload, requestJson, type JsonRecord } from '../lib/api';

	interface Props { resourceName: string; }
	interface UsageStatus { watermark?: string; lag_seconds?: number; }

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let usage = $state.raw<JsonRecord[]>([]);
	let audit = $state.raw<JsonRecord[]>([]);
	let status = $state<UsageStatus>({});
	let isLoading = $state(true);
	let error = $state('');

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function value(record: JsonRecord, key: string): string {
		const raw = record[key];
		return raw === undefined || raw === null || raw === '' ? '—' : String(raw);
	}
	function display(record: JsonRecord, key: string): string { return value(record, key); }
	function formatDate(value: unknown): string {
		if (!value) return '—';
		const date = new Date(String(value));
		return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
	}
	function formatDuration(seconds: unknown): string {
		const total = Math.max(0, Math.floor(Number(seconds) || 0));
		if (total < 60) return text(`${total} 秒`, `${total}s`);
		const minutes = Math.floor(total / 60);
		if (minutes < 60) return text(`${minutes} 分钟`, `${minutes}m`);
		const hours = Math.floor(minutes / 60);
		const remainder = minutes % 60;
		return text(`${hours} 小时${remainder ? ` ${remainder} 分钟` : ''}`, `${hours}h${remainder ? ` ${remainder}m` : ''}`);
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const [usagePayload, auditPayload, statusPayload] = await Promise.all([
				requestJson<unknown>('/api/control-plane/usage?limit=100'),
				requestJson<unknown>('/api/control-plane/audit-events?limit=100'),
				requestJson<UsageStatus>('/api/control-plane/usage/status'),
			]);
			usage = getListPayload(usagePayload);
			audit = getListPayload(auditPayload);
			status = statusPayload ?? {};
		} catch (cause) {
			error = displayError(cause, text('加载 Usage Ledger 失败', 'Failed to load Usage Ledger'));
		} finally {
			isLoading = false;
		}
	}

	onMount(() => { void load(); });
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading">
		<div>
			<p class="eyebrow">{getAppName()} / {text('可观测性', 'Observability')}</p>
			<h1>{text('Usage Ledger', 'Usage Ledger')}</h1>
			<p>{text('查看请求用量投影、同步水位和管理审计事件。', 'Inspect projected request usage, sync watermark, and administrative audit events.')}</p>
		</div>
		<button type="button" onclick={() => void load()} disabled={isLoading}>{text('刷新', 'Refresh')}</button>
	</header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	<section class="status-strip" aria-busy={isLoading}>
		<div><span>{text('同步水位', 'Watermark')}</span><strong>{formatDate(status.watermark)}</strong></div>
		<div><span>{text('同步延迟', 'Lag')}</span><strong>{formatDuration(status.lag_seconds)}</strong></div>
		<div><span>{text('账本条数', 'Ledger rows')}</span><strong>{usage.length.toLocaleString(i18n.locale)}</strong></div>
		<div><span>{text('审计事件', 'Audit events')}</span><strong>{audit.length.toLocaleString(i18n.locale)}</strong></div>
	</section>
	<section class="ledger-section">
		<header><h2>{text('用量账本', 'Usage ledger')}</h2></header>
		<div class="table-wrap"><table><thead><tr><th>{text('时间', 'Time')}</th><th>{text('应用', 'Application')}</th><th>{text('供应商', 'Provider')}</th><th>{text('模型', 'Model')}</th><th>{text('状态', 'Status')}</th><th>{text('Token', 'Tokens')}</th><th>{text('成本', 'Cost')}</th></tr></thead><tbody>
			{#each usage as row (value(row, 'id'))}
				<tr><td>{formatDate(row.occurred_at)}</td><td>{display(row, 'application_id')}</td><td>{display(row, 'provider')}</td><td>{display(row, 'model')}</td><td>{display(row, 'status')}</td><td>{display(row, 'total_tokens')}</td><td>{formatUsdCost(row.cost)}</td></tr>
			{:else}<tr><td colspan="7" class="empty">{text('暂无账本数据', 'No ledger data')}</td></tr>{/each}
		</tbody></table></div>
	</section>
	<section class="ledger-section">
		<header><h2>{text('审计事件', 'Audit events')}</h2></header>
		<div class="table-wrap"><table><thead><tr><th>{text('时间', 'Time')}</th><th>{text('操作者', 'Actor')}</th><th>{text('动作', 'Action')}</th><th>{text('资源', 'Resource')}</th><th>ID</th></tr></thead><tbody>
			{#each audit as row (value(row, 'id'))}
				<tr><td>{formatDate(row.created_at)}</td><td>{display(row, 'actor_id')}</td><td>{display(row, 'action')}</td><td>{display(row, 'resource_type')}</td><td>{display(row, 'resource_id')}</td></tr>
			{:else}<tr><td colspan="5" class="empty">{text('暂无审计事件', 'No audit events')}</td></tr>{/each}
		</tbody></table></div>
	</section>
</section>

<style>
	.page-shell { max-width: 1440px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: flex-start; display: flex; gap: 1rem; justify-content: space-between; margin-bottom: 1.25rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .45rem; text-transform: uppercase; }
	h1, h2 { margin: 0; }
	.page-heading p:last-child { color: var(--muted-foreground); margin: .45rem 0 0; }
	button { background: var(--primary); border: 1px solid var(--primary); border-radius: 6px; color: var(--primary-foreground); cursor: pointer; font-weight: 650; padding: .6rem .85rem; }
	button:disabled { cursor: wait; opacity: .6; }
	.notice { border: 1px solid var(--border); margin-bottom: 1rem; padding: .75rem 1rem; }
	.notice.error { border-color: var(--destructive); color: var(--destructive); }
	.status-strip { border-bottom: 1px solid var(--border); border-top: 1px solid var(--border); display: grid; gap: 1rem; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 1.5rem; padding: 1rem 0; }
	.status-strip div { display: grid; gap: .3rem; min-width: 0; }
	.status-strip span { color: var(--muted-foreground); font-size: .8rem; }
	.status-strip strong { overflow-wrap: anywhere; }
	.ledger-section { margin-top: 1.5rem; }
	.ledger-section header { margin-bottom: .65rem; }
	.table-wrap { overflow-x: auto; }
	table { border-collapse: collapse; min-width: 760px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); padding: .7rem .55rem; text-align: left; vertical-align: top; }
	th { color: var(--muted-foreground); font-size: .78rem; font-weight: 700; }
	.empty { color: var(--muted-foreground); padding: 2rem 1rem; text-align: center; }
	@media (max-width: 760px) {
		.page-shell { padding: 1rem; }
		.page-heading { flex-direction: column; }
		.status-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
</style>
