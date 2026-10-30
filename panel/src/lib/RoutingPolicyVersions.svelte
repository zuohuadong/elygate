<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { ArrowDownToLine, ChevronLeft, ChevronRight, FileCheck2, RefreshCw, Square } from '@lucide/svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { ApiError, requestJson } from './api';
	import { displayError } from './forms';
	import { ROUTING_DRAFT_PATH, routingDraftRecovery, type RoutingDraft } from './routing-drafts';
	import {
		buildRoutingVersionPayload, parseRoutingPolicyVersion, parseRoutingPolicyVersionPage,
		ROUTING_VERSION_PAGE_SIZE, ROUTING_VERSION_PATH, RoutingVersionError,
		type RoutingPolicyVersion, type RoutingPolicyVersionSummary,
	} from './routing-policy-versions';

	let {
		active, disabled, draft, dirty, uncertain, busy = $bindable(false), onload,
	}: {
		active: boolean;
		disabled: boolean;
		draft: RoutingDraft | null;
		dirty: boolean;
		uncertain: boolean;
		busy?: boolean;
		onload: (version: RoutingPolicyVersion) => boolean;
	} = $props();
	const i18n = useTranslation();
	const epoch = routingDraftRecovery.epoch;
	let versions = $state.raw<RoutingPolicyVersionSummary[]>([]);
	let offset = $state(0);
	let loaded = $state(false);
	let operation = $state<'list' | 'capture' | 'load' | null>(null);
	let error = $state('');
	let status = $state('');
	let pendingCapture = $state.raw<{ id: string; revision: number; name: string } | null>(null);
	let sequence = 0;
	let controller: AbortController | undefined;
	const unavailable = $derived(disabled || busy || !active);
	const captureDisabled = $derived(unavailable || !draft || dirty || uncertain || Boolean(pendingCapture));

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }

	function cancelRead(): void {
		sequence += 1;
		controller?.abort();
		controller = undefined;
		if (operation === 'list') loaded = true;
		busy = false;
		operation = null;
	}

	function begin(kind: Exclude<typeof operation, null>) {
		if (unavailable || epoch !== routingDraftRecovery.epoch) return null;
		const request = new AbortController();
		controller = request;
		busy = true;
		operation = kind;
		error = '';
		status = '';
		return { request, sequence: ++sequence };
	}

	function current(context: { request: AbortController; sequence: number }): boolean {
		return context.sequence === sequence && !context.request.signal.aborted && epoch === routingDraftRecovery.epoch;
	}

	function finish(context: { sequence: number }): void {
		if (context.sequence === sequence) { busy = false; operation = null; }
	}

	function versionError(cause: unknown): string {
		if (cause instanceof RoutingVersionError) {
			return cause.code === 'revision'
				? text('该修订无法创建版本，请新建草稿。', 'This revision cannot be captured. Create a new draft.')
				: text('版本响应无效，请刷新重试。', 'Invalid version response. Refresh to retry.');
		}
		if (cause instanceof ApiError && cause.status === 409) {
			return text('源草稿已变更，请重新载入后再创建版本。', 'The source draft changed. Reload it before capturing a version.');
		}
		if (cause instanceof ApiError && cause.status === 404) {
			return text('源草稿或版本已不存在，请刷新列表。', 'The source draft or version no longer exists. Refresh the list.');
		}
		return displayError(cause, text('版本操作失败。', 'Version operation failed.'));
	}

	async function readPage(nextOffset: number, signal: AbortSignal): Promise<RoutingPolicyVersionSummary[]> {
		return parseRoutingPolicyVersionPage(await requestJson<unknown>(
			`${ROUTING_VERSION_PATH}?limit=${ROUTING_VERSION_PAGE_SIZE}&offset=${nextOffset}`, { signal }), nextOffset);
	}

	async function pageVersions(nextOffset = 0): Promise<void> {
		const context = begin('list');
		if (!context) return;
		try {
			const page = await readPage(nextOffset, context.request.signal);
			if (!current(context)) return;
			versions = page;
			offset = nextOffset;
			if (pendingCapture && page.some(version => version.draft_id === pendingCapture?.id && version.draft_revision === pendingCapture?.revision)) {
				pendingCapture = null;
				status = text('已在历史中确认版本。', 'Version confirmed in history.');
			}
		} catch (cause) {
			if (current(context)) error = versionError(cause);
		} finally {
			if (current(context)) loaded = true;
			finish(context);
		}
	}

	async function captureVersion(source: Pick<RoutingDraft, 'id' | 'revision' | 'name'>): Promise<void> {
		const context = begin('capture');
		if (!context) return;
		let sent = false;
		try {
			const payload = buildRoutingVersionPayload(source.revision);
			pendingCapture = { id: source.id, revision: source.revision, name: source.name };
			sent = true;
			const saved = parseRoutingPolicyVersion(await requestJson<unknown>(
				`${ROUTING_DRAFT_PATH}/${encodeURIComponent(source.id)}/versions`, {
					method: 'POST', body: JSON.stringify(payload), signal: context.request.signal,
				}));
			if (!current(context)) return;
			if (saved.draft_id !== source.id || saved.draft_revision !== source.revision) throw new RoutingVersionError('response');
			pendingCapture = null;
			status = text(`版本已确认 · 源修订 ${saved.draft_revision}`, `Version confirmed · Source revision ${saved.draft_revision}`);
			try {
				const page = await readPage(0, context.request.signal);
				if (current(context)) { versions = page; offset = 0; loaded = true; }
			} catch {
				if (current(context)) error = text('版本已确认，历史刷新失败，请重试刷新。', 'Version confirmed, but history refresh failed. Refresh to retry.');
			}
		} catch (cause) {
			if (current(context)) {
				const unconfirmed = sent && !(cause instanceof ApiError && cause.status >= 400 && cause.status < 500);
				if (!unconfirmed) pendingCapture = null;
				error = unconfirmed
					? text('版本创建结果未确认。请重试同一修订，或刷新历史确认。', 'Version capture is unconfirmed. Retry the same revision or refresh history to confirm.')
					: versionError(cause);
			}
		} finally { finish(context); }
	}

	function captureSavedDraft(): void {
		if (captureDisabled || !draft) return;
		void captureVersion({ id: draft.id, revision: draft.revision, name: draft.name });
	}

	function retryCapture(): void {
		if (!pendingCapture) return;
		const source = pendingCapture;
		// 重试只使用已发送的 ID/revision，不随编辑器当前选择漂移。
		void captureVersion(source);
	}

	async function loadVersion(id: string): Promise<void> {
		const context = begin('load');
		if (!context) return;
		try {
			const version = parseRoutingPolicyVersion(await requestJson<unknown>(
				`${ROUTING_VERSION_PATH}/${encodeURIComponent(id)}`, { signal: context.request.signal }), id);
			if (!current(context)) return;
			if (onload(version)) status = text('已载入为新候选；活动路由未改变。', 'Loaded as a new candidate; active routing was not changed.');
		} catch (cause) {
			if (current(context)) error = versionError(cause);
		} finally { finish(context); }
	}

	$effect(() => { if (!active && operation !== 'capture') untrack(cancelRead); });
	$effect(() => { if (active && !disabled && !busy && !loaded) untrack(() => void pageVersions()); });
	onMount(() => {
		const guard = (event: BeforeUnloadEvent): void => { if (operation === 'capture') event.preventDefault(); };
		window.addEventListener('beforeunload', guard);
		return () => window.removeEventListener('beforeunload', guard);
	});
	onDestroy(cancelRead);
</script>

<section class="versions" aria-labelledby="routing-versions-heading" aria-busy={busy}>
	<header>
		<h2 id="routing-versions-heading">{text('版本历史', 'Version history')}</h2>
		<div class="actions">
			<button type="button" onclick={captureSavedDraft} disabled={captureDisabled} title={dirty || uncertain ? text('请先保存并确认草稿修订', 'Save and confirm the draft revision first') : undefined}><FileCheck2 size={16} aria-hidden="true" />{operation === 'capture' ? text('创建中', 'Capturing') : text('创建版本', 'Capture version')}</button>
			<button class="icon-button" type="button" onclick={() => void pageVersions()} disabled={unavailable} aria-label={text('刷新版本历史', 'Refresh version history')} title={text('刷新版本历史', 'Refresh version history')}><RefreshCw size={16} aria-hidden="true" /></button>
			{#if busy && operation !== 'capture'}<button class="icon-button" type="button" onclick={cancelRead} aria-label={text('取消版本请求', 'Cancel version request')} title={text('取消版本请求', 'Cancel version request')}><Square size={16} aria-hidden="true" /></button>{/if}
		</div>
	</header>
	{#if pendingCapture}<div class="pending" role="status"><span>{pendingCapture.name} · {text('源修订', 'Source revision')} {pendingCapture.revision}</span><button type="button" onclick={retryCapture} disabled={unavailable}><RefreshCw size={16} aria-hidden="true" />{text('重试同一修订', 'Retry same revision')}</button></div>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="status" role="status">{status || (operation === 'list' ? text('正在读取版本历史', 'Loading version history') : '')}</p>
	{#if loaded && !versions.length}<p class="empty">{text('本页暂无版本', 'No versions on this page')}</p>{/if}
	<ul>
		{#each versions as version (version.id)}
			<li>
				<div class="version-title"><strong>{version.name}</strong><span>{text('源修订', 'Source revision')} {version.draft_revision}</span></div>
				<time datetime={version.created_at}>{new Date(version.created_at).toLocaleString(i18n.locale === 'zh-CN' ? 'zh-CN' : 'en-US')}</time>
				<details><summary>{text('版本标识', 'Version identity')}</summary><dl><dt>ID</dt><dd>{version.id}</dd><dt>SHA-256</dt><dd>{version.content_sha256}</dd><dt>{text('源草稿', 'Source draft')}</dt><dd>{version.draft_id}</dd></dl></details>
				<button type="button" onclick={() => void loadVersion(version.id)} disabled={unavailable}><ArrowDownToLine size={16} aria-hidden="true" />{text('载入为新候选', 'Load as new candidate')}</button>
			</li>
		{/each}
	</ul>
	<nav aria-label={text('版本分页', 'Version pagination')}>
		<span>{versions.length ? `${offset + 1}–${offset + versions.length}` : '0'}</span>
		<button class="icon-button" type="button" disabled={unavailable || offset === 0} onclick={() => void pageVersions(Math.max(0, offset - ROUTING_VERSION_PAGE_SIZE))} aria-label={text('上一页版本', 'Previous versions')} title={text('上一页版本', 'Previous versions')}><ChevronLeft size={16} aria-hidden="true" /></button>
		<button class="icon-button" type="button" disabled={unavailable || versions.length < ROUTING_VERSION_PAGE_SIZE} onclick={() => void pageVersions(offset + ROUTING_VERSION_PAGE_SIZE)} aria-label={text('下一页版本', 'Next versions')} title={text('下一页版本', 'Next versions')}><ChevronRight size={16} aria-hidden="true" /></button>
	</nav>
</section>

<style>
	.versions { border-block: 1px solid var(--border); display: grid; gap: .75rem; min-width: 0; padding-block: 1rem; }
	header, .actions, nav, .pending { align-items: center; display: flex; flex-wrap: wrap; gap: .5rem; }
	header { justify-content: space-between; }
	h2 { font-size: 1rem; margin: 0; }
	p { margin: 0; }
	button { align-items: center; background: var(--muted); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); cursor: pointer; display: inline-flex; font: inherit; font-size: .85rem; font-weight: 650; gap: .45rem; justify-content: center; min-height: 44px; padding: .5rem .75rem; }
	button:disabled { cursor: not-allowed; opacity: .5; }
	.icon-button { flex: 0 0 44px; height: 44px; padding: 0; width: 44px; }
	button:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
	.status, .empty, time, .version-title span, nav { color: var(--muted-foreground); font-size: .8rem; }
	.status { min-height: 1.5em; }
	.error { color: var(--simulation-error-text); font-size: .85rem; }
	.error, .pending { border: 1px solid var(--border); border-radius: .5rem; overflow-wrap: anywhere; padding: .75rem; }
	.pending span { flex: 1 1 12rem; min-width: 0; }
	ul { list-style: none; margin: 0; min-width: 0; padding: 0; }
	li { align-items: center; border-bottom: 1px solid var(--border); display: grid; gap: .75rem; grid-template-columns: minmax(0, 1fr) auto auto; padding-block: .75rem; }
	.version-title { display: grid; gap: .25rem; min-width: 0; overflow-wrap: anywhere; }
	details { grid-column: 1 / 3; grid-row: 2; min-width: 0; }
	li > button { grid-column: 3; grid-row: 1 / 3; }
	summary { cursor: pointer; font-size: .8rem; min-height: 24px; }
	dl { display: grid; gap: .35rem; grid-template-columns: auto minmax(0, 1fr); margin: .5rem 0 0; }
	dt, dd { font-size: .8rem; margin: 0; overflow-wrap: anywhere; }
	dd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	nav span { margin-right: auto; }
	@media (max-width: 760px) { li { grid-template-columns: minmax(0, 1fr); } li > button { grid-column: 1; grid-row: auto; justify-self: start; } details { grid-column: 1; grid-row: auto; } dl { grid-template-columns: minmax(0, 1fr); } dt { color: var(--muted-foreground); } }
</style>
