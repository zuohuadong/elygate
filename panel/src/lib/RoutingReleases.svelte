<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { ChevronLeft, ChevronRight, RefreshCw, Rocket, Square, Undo2 } from '@lucide/svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { ApiError, requestJson } from './api';
	import { displayError } from './forms';
	import { routingDraftRecovery } from './routing-drafts';
	import { parseRoutingPolicyVersionPage, ROUTING_VERSION_PAGE_SIZE, ROUTING_VERSION_PATH, type RoutingPolicyVersionSummary } from './routing-policy-versions';
	import { parseRoutingReleaseSnapshot, ROUTING_RELEASE_PAGE_SIZE, ROUTING_RELEASE_PATH, RoutingReleaseError, type RoutingRelease, type RoutingReleaseHead } from './routing-releases';

	let { active }: { active: boolean } = $props();
	const i18n = useTranslation();
	const authEpoch = routingDraftRecovery.epoch;
	let head = $state.raw<RoutingReleaseHead | null>(null);
	let releases = $state.raw<RoutingRelease[]>([]);
	let versions = $state.raw<RoutingPolicyVersionSummary[]>([]);
	let selectedVersionId = $state('');
	let offset = $state(0);
	let busy = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let actionStatus = $state('');
	let pendingMutation = $state<{
		operation: 'publish' | 'rollback';
		idempotencyKey: string;
		expectedEpoch: number;
		versionId?: string;
		rollbackOfEpoch?: number;
	} | null>(null);
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
		actionStatus = '';
		head = null;
		releases = [];
		try {
			const [releasePayload, versionPayload] = await Promise.all([
				requestJson<unknown>(`${ROUTING_RELEASE_PATH}?limit=${ROUTING_RELEASE_PAGE_SIZE}&offset=${nextOffset}`, { signal: request.signal }),
				requestJson<unknown>(`${ROUTING_VERSION_PATH}?limit=${ROUTING_VERSION_PAGE_SIZE}&offset=0`, { signal: request.signal }),
			]);
			const snapshot = parseRoutingReleaseSnapshot(releasePayload, nextOffset);
			const nextVersions = parseRoutingPolicyVersionPage(versionPayload, 0);
			if (current !== sequence || request.signal.aborted || authEpoch !== routingDraftRecovery.epoch) return;
			head = snapshot.head;
			releases = snapshot.releases;
			versions = nextVersions;
			if (!nextVersions.some((version) => version.id === selectedVersionId)) selectedVersionId = nextVersions[0]?.id ?? '';
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

	async function publish(): Promise<void> {
		if (busy || !head || !selectedVersionId) return;
		const expectedEpoch = head.epoch;
		const pending = pendingMutation?.operation === 'publish' &&
			pendingMutation.expectedEpoch === expectedEpoch &&
			pendingMutation.versionId === selectedVersionId
			? pendingMutation
			: null;
		const idempotencyKey = pending?.idempotencyKey ?? crypto.randomUUID();
		pendingMutation = { operation: 'publish', idempotencyKey, expectedEpoch, versionId: selectedVersionId };
		busy = true;
		error = '';
		actionStatus = '';
		try {
			await requestJson('/api/control-plane/routing/releases/publish', {
				method: 'POST',
				body: JSON.stringify({
					version_id: selectedVersionId,
					expected_epoch: expectedEpoch,
					idempotency_key: idempotencyKey,
				}),
			});
			pendingMutation = null;
			busy = false;
			await load(offset);
			actionStatus = text('发布请求已处理。', 'Publish request processed.');
		} catch (cause) {
			if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) pendingMutation = null;
			error = cause instanceof ApiError && cause.status === 503
				? text('发布已持久化但尚未确认安装，请用同一按钮重试。', 'The publish is durable but installation is not confirmed; retry with the same button.')
				: displayError(cause, text('发布失败。', 'Publish failed.'));
			busy = false;
		}
	}

	async function rollback(release: RoutingRelease): Promise<void> {
		if (busy || !head || !release.application || release.epoch >= head.epoch) return;
		if (!window.confirm(text(`确认回滚到代次 #${release.epoch}？`, `Roll back to epoch #${release.epoch}?`))) return;
		const expectedEpoch = head.epoch;
		const pending = pendingMutation?.operation === 'rollback' &&
			pendingMutation.expectedEpoch === expectedEpoch &&
			pendingMutation.rollbackOfEpoch === release.epoch
			? pendingMutation
			: null;
		const idempotencyKey = pending?.idempotencyKey ?? crypto.randomUUID();
		pendingMutation = { operation: 'rollback', idempotencyKey, expectedEpoch, rollbackOfEpoch: release.epoch };
		busy = true;
		error = '';
		actionStatus = '';
		try {
			await requestJson('/api/control-plane/routing/releases/rollback', {
				method: 'POST',
				body: JSON.stringify({
					rollback_of_epoch: release.epoch,
					expected_epoch: expectedEpoch,
					idempotency_key: idempotencyKey,
				}),
			});
			pendingMutation = null;
			busy = false;
			await load(offset);
			actionStatus = text('回滚请求已处理。', 'Rollback request processed.');
		} catch (cause) {
			if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) pendingMutation = null;
			error = cause instanceof ApiError && cause.status === 503
				? text('回滚已持久化但尚未确认安装，请用同一按钮重试。', 'The rollback is durable but installation is not confirmed; retry with the same button.')
				: displayError(cause, text('回滚失败。', 'Rollback failed.'));
			busy = false;
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
	<p class="status" role="status">{actionStatus || (busy ? text('正在读取发布记录', 'Loading release records') : '')}</p>
	{#if head}
		<dl class="head">
			<div><dt>{text('当前持久代次', 'Durable epoch')}</dt><dd>{head.epoch}</dd></div>
			<div><dt>{text('持久状态', 'Durable state')}</dt><dd>{head.epoch === 0 ? text('未托管', 'Unmanaged') : head.state === 'pending' ? text('待安装', 'Pending installation') : text('已确认安装', 'Installation acknowledged')}</dd></div>
			<div><dt>{text('当前进程就绪状态', 'Current process readiness')}</dt><dd>{text('未核验', 'Not verified')}</dd></div>
			{#if head.desired_version_id}<div class="identity"><dt>{text('目标版本', 'Desired version')}</dt><dd>{head.desired_version_id}</dd></div>{/if}
		</dl>
		<div class="publish-controls">
			<label>{text('封存版本', 'Immutable version')}
				<select bind:value={selectedVersionId} disabled={busy || !active || !versions.length}>
					{#each versions as version (version.id)}
						<option value={version.id}>{version.name} · r{version.draft_revision} · {version.content_sha256.slice(0, 12)}</option>
					{:else}<option value="">{text('暂无可发布版本', 'No immutable versions')}</option>{/each}
				</select>
			</label>
			<button class="action" type="button" disabled={busy || !active || !selectedVersionId} onclick={() => void publish()}><Rocket size={16} aria-hidden="true" />{pendingMutation?.operation === 'publish' ? text('重试发布', 'Retry publish') : text('发布版本', 'Publish version')}</button>
		</div>
	{/if}
	{#if loaded && !busy && !error && head && !releases.length}<p class="empty">{text('本页暂无发布记录', 'No release records on this page')}</p>{/if}
	<ul>{#each releases as release (release.id)}
		<li><div class="release-title"><strong>#{release.epoch} · {release.operation === 'rollback' ? text('回滚', 'Rollback') : text('发布', 'Publish')}</strong><span>{release.epoch !== head?.epoch ? text('已被取代', 'Superseded') : release.application ? text('已确认安装', 'Installation acknowledged') : text('待安装', 'Pending installation')}</span></div>
			<time datetime={release.created_at}>{new Date(release.created_at).toLocaleString(i18n.locale)}</time>
			{#if head && head.state === 'applied' && release.application && release.epoch < head.epoch}<button class="action rollback" type="button" disabled={busy || !active} onclick={() => void rollback(release)}><Undo2 size={16} aria-hidden="true" />{pendingMutation?.operation === 'rollback' && pendingMutation.rollbackOfEpoch === release.epoch ? text('重试回滚', 'Retry rollback') : text('回滚到此版本', 'Roll back here')}</button>{/if}
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
	li { align-items: start; border-bottom: 1px solid var(--border); display: grid; gap: .75rem; grid-template-columns: minmax(0, 1fr) auto auto; padding-block: 1rem; }
	.release-title { display: grid; gap: .25rem; }
	.publish-controls { align-items: end; border-bottom: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: .75rem; padding-block: .75rem; }
	.publish-controls label { display: grid; gap: .3rem; min-width: min(100%, 28rem); }
	select { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); min-height: 44px; min-width: 0; padding: .5rem .65rem; }
	.action { align-items: center; display: inline-flex; gap: .4rem; min-height: 44px; width: auto; }
	.rollback { grid-column: 2 / -1; justify-self: end; }
	details { grid-column: 1 / -1; min-width: 0; }
	summary { cursor: pointer; font-size: .85rem; min-height: 24px; }
	details dl { display: grid; gap: .35rem .75rem; grid-template-columns: auto minmax(0, 1fr); margin-top: .75rem; }
	details dd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85rem; margin: 0; }
	nav span { margin-right: auto; }
	@media (max-width: 760px) { .head, li, details dl { grid-template-columns: minmax(0, 1fr); } .rollback { grid-column: 1; justify-self: start; } .publish-controls { align-items: stretch; flex-direction: column; } .publish-controls .action { justify-content: center; } }
</style>
