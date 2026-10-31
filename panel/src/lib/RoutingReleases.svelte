<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { ChevronLeft, ChevronRight, RefreshCw, Square } from '@lucide/svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { requestJson } from './api';
	import { displayError } from './forms';
	import { routingDraftRecovery } from './routing-drafts';
	import { parseRoutingReleaseSnapshot, ROUTING_RELEASE_PAGE_SIZE, ROUTING_RELEASE_PATH, RoutingReleaseError, type RoutingRelease, type RoutingReleaseHead } from './routing-releases';

	let { active }: { active: boolean } = $props();
	const i18n = useTranslation();
	const authEpoch = routingDraftRecovery.epoch;
	let head = $state.raw<RoutingReleaseHead | null>(null);
	let releases = $state.raw<RoutingRelease[]>([]);
	let offset = $state(0);
	let busy = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let sequence = 0;
	let controller: AbortController | undefined;
	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }

	function cancelRead(): void {
		sequence += 1;
		controller?.abort();
		controller = undefined;
		if (busy) loaded = true;
		busy = false;
	}

	async function load(nextOffset = 0): Promise<void> {
		if (!active || busy || authEpoch !== routingDraftRecovery.epoch) return;
		const request = new AbortController();
		controller = request;
		const current = ++sequence;
		busy = true;
		error = '';
		head = null;
		releases = [];
		try {
			const payload = await requestJson<unknown>(`${ROUTING_RELEASE_PATH}?limit=${ROUTING_RELEASE_PAGE_SIZE}&offset=${nextOffset}`, { signal: request.signal });
			const snapshot = parseRoutingReleaseSnapshot(payload, nextOffset);
			if (current !== sequence || request.signal.aborted || authEpoch !== routingDraftRecovery.epoch) return;
			head = snapshot.head;
			releases = snapshot.releases;
			offset = nextOffset;
		} catch (cause) {
			if (current === sequence && !request.signal.aborted && authEpoch === routingDraftRecovery.epoch) {
				error = cause instanceof RoutingReleaseError ? text('发布记录响应无效。', 'Invalid release records.')
					: displayError(cause, text('读取发布记录失败。', 'Failed to read release records.'));
			}
			request.abort();
		} finally {
			if (current === sequence) { busy = false; loaded = true; controller = undefined; }
		}
	}

	$effect(() => { if (!active) untrack(cancelRead); });
	$effect(() => { if (active && !loaded && !busy) untrack(() => void load()); });
	onDestroy(cancelRead);
</script>

<section class="releases" aria-labelledby="routing-releases-heading" aria-busy={busy}>
	<header><h2 id="routing-releases-heading">{text('路由发布记录', 'Routing releases')}</h2><div class="actions">
		<button type="button" disabled={busy || !active} onclick={() => void load()} aria-label={text('刷新发布记录', 'Refresh releases')} title={text('刷新发布记录', 'Refresh releases')}><RefreshCw size={16} aria-hidden="true" /></button>
		{#if busy}<button type="button" onclick={cancelRead} aria-label={text('取消发布记录请求', 'Cancel release request')} title={text('取消发布记录请求', 'Cancel release request')}><Square size={16} aria-hidden="true" /></button>{/if}
	</div></header>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="status" role="status">{busy ? text('正在读取发布记录', 'Loading release records') : ''}</p>
	{#if head}
		<dl class="head">
			<div><dt>{text('当前持久代次', 'Durable epoch')}</dt><dd>{head.epoch}</dd></div>
			<div><dt>{text('持久状态', 'Durable state')}</dt><dd>{head.epoch === 0 ? text('未托管', 'Unmanaged') : head.state === 'pending' ? text('待安装', 'Pending installation') : text('已确认安装', 'Installation acknowledged')}</dd></div>
			<div><dt>{text('当前进程就绪状态', 'Current process readiness')}</dt><dd>{text('未核验', 'Not verified')}</dd></div>
			{#if head.desired_version_id}<div class="identity"><dt>{text('目标版本', 'Desired version')}</dt><dd>{head.desired_version_id}</dd></div>{/if}
		</dl>
	{/if}
	{#if loaded && !busy && !error && head && !releases.length}<p class="empty">{text('本页暂无发布记录', 'No release records on this page')}</p>{/if}
	<ul>{#each releases as release (release.id)}
		<li><div class="release-title"><strong>#{release.epoch} · {release.operation === 'rollback' ? text('回滚', 'Rollback') : text('发布', 'Publish')}</strong><span>{release.epoch !== head?.epoch ? text('已被取代', 'Superseded') : release.application ? text('已确认安装', 'Installation acknowledged') : text('待安装', 'Pending installation')}</span></div>
			<time datetime={release.created_at}>{new Date(release.created_at).toLocaleString(i18n.locale)}</time>
			<details><summary>{text('回执详情', 'Receipt details')}</summary><dl>
				<dt>{text('接收回执', 'Acceptance receipt')}</dt><dd>{release.id}</dd>
				<dt>{text('版本', 'Version')}</dt><dd>{release.version_id}</dd>
				<dt>SHA-256</dt><dd>{release.fingerprint}</dd>
				{#if release.rollback_of_epoch}<dt>{text('回滚目标代次', 'Rollback target epoch')}</dt><dd>#{release.rollback_of_epoch}</dd>{/if}
				{#if release.application}<dt>{text('安装时间', 'Installed at')}</dt><dd>{new Date(release.application.recorded_at).toLocaleString(i18n.locale)}</dd><dt>{text('策略指纹', 'Policy fingerprint')}</dt><dd>{release.application.policy_fingerprint}</dd>{/if}
			</dl></details>
		</li>
	{/each}</ul>
	<nav aria-label={text('发布记录分页', 'Release pagination')}><span>{releases.length ? `${offset + 1}-${offset + releases.length}` : '0'}</span>
		<button type="button" disabled={busy || !active || offset === 0} onclick={() => void load(Math.max(0, offset - ROUTING_RELEASE_PAGE_SIZE))} aria-label={text('上一页发布记录', 'Previous releases')} title={text('上一页发布记录', 'Previous releases')}><ChevronLeft size={16} aria-hidden="true" /></button>
		<button type="button" disabled={busy || !active || releases.length < ROUTING_RELEASE_PAGE_SIZE} onclick={() => void load(offset + ROUTING_RELEASE_PAGE_SIZE)} aria-label={text('下一页发布记录', 'Next releases')} title={text('下一页发布记录', 'Next releases')}><ChevronRight size={16} aria-hidden="true" /></button>
	</nav>
</section>

<style>
	.releases { display: grid; gap: .75rem; min-width: 0; }
	header, .actions, nav { align-items: center; display: flex; flex-wrap: wrap; gap: .5rem; }
	header { justify-content: space-between; }
	h2 { font-size: 1rem; margin: 0; }
	p { margin: 0; }
	button { align-items: center; background: var(--muted); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); cursor: pointer; display: inline-flex; flex: 0 0 44px; height: 44px; justify-content: center; padding: 0; width: 44px; }
	button:disabled { cursor: not-allowed; opacity: .5; }
	button:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
	.status, .empty, dt, time, .release-title span, nav { color: var(--muted-foreground); font-size: .85rem; }
	.status { min-height: 1.5em; }
	.error { border: 1px solid var(--destructive); border-radius: .5rem; color: color-mix(in srgb, var(--destructive) 75%, var(--foreground)); overflow-wrap: anywhere; padding: .75rem; }
	.head { border-block: 1px solid var(--border); display: grid; gap: 1rem; grid-template-columns: repeat(3, minmax(0, 1fr)); padding-block: 1rem; }
	.head .identity { grid-column: 1 / -1; }
	dl { margin: 0; min-width: 0; }
	dt, dd { margin: 0; overflow-wrap: anywhere; }
	dd { margin-top: .25rem; }
	ul { list-style: none; margin: 0; min-width: 0; padding: 0; }
	li { align-items: start; border-bottom: 1px solid var(--border); display: grid; gap: .75rem; grid-template-columns: minmax(0, 1fr) auto; padding-block: 1rem; }
	.release-title { display: grid; gap: .25rem; }
	details { grid-column: 1 / -1; min-width: 0; }
	summary { cursor: pointer; font-size: .85rem; min-height: 24px; }
	details dl { display: grid; gap: .35rem .75rem; grid-template-columns: auto minmax(0, 1fr); margin-top: .75rem; }
	details dd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; margin: 0; }
	nav span { margin-right: auto; }
	@media (max-width: 760px) { .head, li, details dl { grid-template-columns: minmax(0, 1fr); } }
</style>
