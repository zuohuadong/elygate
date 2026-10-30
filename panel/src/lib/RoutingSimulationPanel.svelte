<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { Download, FilePlus2, Import, Play, RefreshCw, Save, Square, Trash2 } from '@lucide/svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError } from './forms';
	import { ApiError, requestJson } from './api';
	import {
		buildSimulationPayload, emptySimulationDraft, importSimulationRules, parseSimulationResponse,
		SimulationInputError, type SimulationField, type SimulationPayload, type SimulationResponse,
	} from './routing-simulation';
	import {
		buildRoutingDraftPayload, parseRoutingDraft, parseRoutingDraftPage, routingDraftRevision, RoutingDraftError,
		routingDraftRecovery, ROUTING_DRAFT_PAGE_SIZE, ROUTING_DRAFT_PATH, type RoutingDraft, type RoutingDraftSummary,
	} from './routing-drafts';

	let { active = true }: { active?: boolean } = $props();
	const recoveryEpoch = routingDraftRecovery.epoch;
	const i18n = useTranslation();
	let draft = $state(emptySimulationDraft());
	let response = $state.raw<SimulationResponse | null>(null);
	let operation = $state<'import' | 'run' | 'list-drafts' | 'load-draft' | 'save-draft' | 'delete-draft' | null>(null);
	let error = $state('');
	let errorField = $state<SimulationField | ''>('');
	let status = $state('');
	let lastPayload = $state<SimulationPayload | null>(null);
	let drafts = $state.raw<RoutingDraftSummary[]>([]);
	let selectedDraft = $state.raw<RoutingDraft | null>(null);
	let selectedDraftId = $state('');
	let draftName = $state('');
	let draftDirty = $state(false);
	let draftsLoaded = $state(false);
	let draftOffset = $state(0);
	let uncertainMutation = $state(false);
	let errorElement = $state<HTMLDivElement | undefined>();
	let requestSequence = 0;
	let activeRequest: AbortController | undefined;
	const busy = $derived(operation !== null);
	const mutating = $derived(operation === 'save-draft' || operation === 'delete-draft');

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }

	function cancelRequests(): void {
		requestSequence += 1;
		activeRequest?.abort();
		activeRequest = undefined;
		if (operation === 'load-draft') selectedDraftId = selectedDraft?.id ?? '';
		operation = null;
	}

	function invalidate(): void {
		if (operation === 'run') cancelRequests();
		response = null;
		lastPayload = null;
		error = '';
		errorField = '';
		status = '';
	}

	function markDraftDirty(): void {
		draftDirty = true;
		invalidate();
	}

	function errorMessage(cause: unknown): string {
		if (!(cause instanceof SimulationInputError)) return displayError(cause, text('仿真请求失败。', 'Simulation request failed.'));
		switch (cause.code) {
			case 'invalid-json': return text('JSON 格式无效。', 'Invalid JSON.');
			case 'objects': return text('必须是 JSON 对象数组。', 'Expected an array of JSON objects.');
			case 'rule-count': return text('规则最多 32 条，未导入任何截断子集。', 'At most 32 rules are allowed. No truncated subset was imported.');
			case 'sample-count': return text('样本数量必须为 1 至 16。', 'Provide 1 to 16 samples.');
			case 'depth': return text('链最大深度必须为 1 至 20 的整数。', 'Chain depth must be an integer from 1 to 20.');
			case 'size': return text('请求超过 128 KiB。', 'Request exceeds 128 KiB.');
			case 'incomplete-import': return text('服务端未返回完整规则集，原草稿已保留。', 'The server did not return a complete rule set. The draft was preserved.');
			case 'invalid-response': return text('仿真响应与提交的样本不一致。', 'Simulation response does not match the submitted samples.');
		}
	}

	async function reportError(cause: unknown): Promise<void> {
		error = errorMessage(cause);
		errorField = cause instanceof SimulationInputError ? cause.field : 'request';
		await tick();
		if (active) errorElement?.focus();
	}

	function draftErrorMessage(cause: unknown): string {
		if (cause instanceof RoutingDraftError) {
			if (cause.code === 'name') return text('草稿名称应为 1 至 128 个字符，且不含控制字符。', 'Draft name must contain 1 to 128 characters without control characters.');
			if (cause.code === 'revision') return text('该修订无法继续更新，请新建草稿。', 'This revision cannot be updated further. Create a new draft.');
			return text('草稿响应无效，请刷新重试。', 'Invalid draft response. Refresh to retry.');
		}
		if (cause instanceof ApiError && cause.status === 409) {
			return text('草稿已被其他管理员修改。请重新载入后再保存；本地编辑内容已保留。', 'This draft was changed by another administrator. Reload it before saving; local edits were preserved.');
		}
		if (cause instanceof ApiError && cause.status === 404) {
			return text('草稿已不存在，请刷新草稿列表。', 'This draft no longer exists. Refresh the draft list.');
		}
		return displayError(cause, text('草稿操作失败。', 'Draft operation failed.'));
	}

	function beginDraftRequest(kind: Exclude<typeof operation, null>): { sequence: number; request: AbortController } | null {
		if (busy || !active) return null;
		const sequence = ++requestSequence;
		const request = new AbortController();
		activeRequest = request;
		operation = kind;
		error = '';
		errorField = '';
		status = '';
		return { sequence, request };
	}

	function applyLoadedDraft(next: RoutingDraft | null): void {
		selectedDraft = next;
		selectedDraftId = next?.id ?? '';
		draftName = next?.name ?? '';
		draft.rules = JSON.stringify(next?.rules ?? [], null, 2);
		draft.chainMaxDepth = next?.chain_max_depth ?? 10;
		draftDirty = false;
		response = null;
		lastPayload = null;
	}

	async function loadDraftList(): Promise<void> {
		await pageDrafts(0);
	}

	async function selectDraft(nextId: string, reload = false): Promise<void> {
		if (busy || !active) return;
		if (!reload && nextId === (selectedDraft?.id ?? '')) return;
		if ((draftDirty || uncertainMutation) && !window.confirm(text('当前编辑内容将被替换，继续？', 'Replace the current local edits?'))) {
			selectedDraftId = selectedDraft?.id ?? '';
			return;
		}
		if (!nextId) {
			applyLoadedDraft(null);
			uncertainMutation = false;
			status = text('已开始新的草稿。', 'Started a new draft.');
			return;
		}
		const context = beginDraftRequest('load-draft');
		if (!context) return;
		try {
			const payload = await requestJson<unknown>(`${ROUTING_DRAFT_PATH}/${encodeURIComponent(nextId)}`, { signal: context.request.signal });
			if (context.request.signal.aborted || context.sequence !== requestSequence) return;
			applyLoadedDraft(parseRoutingDraft(payload, nextId));
			uncertainMutation = false;
			status = text('草稿已载入。', 'Draft loaded.');
		} catch (cause) {
			if (!context.request.signal.aborted && context.sequence === requestSequence) {
				selectedDraftId = selectedDraft?.id ?? '';
				error = draftErrorMessage(cause);
				errorField = 'request';
			}
		} finally {
			if (context.sequence === requestSequence) operation = null;
		}
	}

	function startNewDraft(): void {
		if (busy) return;
		if ((draftDirty || uncertainMutation) && !window.confirm(text('放弃本地编辑并新建草稿？未确认的请求可能已经保存，请先检查列表。', 'Discard local edits and start a new draft? An unconfirmed request may already be saved; inspect the list first.'))) return;
		applyLoadedDraft(null);
		uncertainMutation = false;
		status = text('已开始新的草稿。', 'Started a new draft.');
	}

	async function saveDraft(): Promise<void> {
		if (uncertainMutation) return;
		const context = beginDraftRequest('save-draft');
		if (!context) return;
		let sent = false;
		try {
			const payload = buildRoutingDraftPayload(draftName, draft, selectedDraft?.revision);
			const path = selectedDraft ? `${ROUTING_DRAFT_PATH}/${encodeURIComponent(selectedDraft.id)}` : ROUTING_DRAFT_PATH;
			sent = true;
			const saved = parseRoutingDraft(await requestJson<unknown>(path, {
				method: selectedDraft ? 'PUT' : 'POST', body: JSON.stringify(payload), signal: context.request.signal,
			}), selectedDraft?.id);
			if (context.request.signal.aborted || context.sequence !== requestSequence) return;
			applyLoadedDraft(saved);
			status = text('草稿已保存；活动路由未改变。', 'Draft saved; active routing was not changed.');
			await refreshAfterMutation(context);
		} catch (cause) {
			if (!context.request.signal.aborted && context.sequence === requestSequence) {
				uncertainMutation = sent && !(cause instanceof ApiError && cause.status >= 400 && cause.status < 500);
				error = uncertainMutation ? text('保存结果未确认。请刷新列表并重新载入草稿后再操作，本地内容已保留。', 'Save outcome is unconfirmed. Refresh and reload the draft before another write. Local edits were preserved.') :
					cause instanceof SimulationInputError ? errorMessage(cause) : draftErrorMessage(cause);
				errorField = cause instanceof SimulationInputError ? cause.field : 'request';
			}
		} finally {
			if (context.sequence === requestSequence) operation = null;
		}
	}

	async function deleteDraft(): Promise<void> {
		if (!selectedDraft || busy || uncertainMutation || !window.confirm(text(`确认删除草稿“${selectedDraft.name}”及当前编辑？此操作不可撤销。`, `Delete draft "${selectedDraft.name}" and its local edits? This cannot be undone.`))) return;
		const context = beginDraftRequest('delete-draft');
		if (!context) return;
		let sent = false;
		try {
			const revision = routingDraftRevision(selectedDraft.revision);
			sent = true;
			await requestJson(`${ROUTING_DRAFT_PATH}/${encodeURIComponent(selectedDraft.id)}`, {
				method: 'DELETE', body: JSON.stringify({ expected_revision: revision }), signal: context.request.signal,
			});
			if (context.request.signal.aborted || context.sequence !== requestSequence) return;
			drafts = drafts.filter((item) => item.id !== selectedDraft?.id);
			applyLoadedDraft(null);
			status = text('草稿已删除；活动路由未改变。', 'Draft deleted; active routing was not changed.');
			await refreshAfterMutation(context);
		} catch (cause) {
			if (!context.request.signal.aborted && context.sequence === requestSequence) {
				uncertainMutation = sent && !(cause instanceof ApiError && cause.status >= 400 && cause.status < 500);
				error = uncertainMutation ? text('删除结果未确认。请刷新列表并重新载入后再操作。', 'Delete outcome is unconfirmed. Refresh and reload before another write.') : draftErrorMessage(cause);
				errorField = 'request';
			}
		} finally {
			if (context.sequence === requestSequence) operation = null;
		}
	}

	function refreshDrafts(): void {
		if (busy) return;
		void loadDraftList();
	}

	async function refreshAfterMutation(context: { sequence: number; request: AbortController }): Promise<void> {
		try {
			const payload = await requestJson<unknown>(`${ROUTING_DRAFT_PATH}?limit=${ROUTING_DRAFT_PAGE_SIZE}&offset=0`, { signal: context.request.signal });
			if (context.sequence !== requestSequence || context.request.signal.aborted) return;
			drafts = parseRoutingDraftPage(payload, 0);
			draftOffset = 0;
			draftsLoaded = true;
		} catch {
			if (context.sequence === requestSequence) status += text(' 草稿列表刷新失败，请重试刷新。', ' Draft list refresh failed; refresh to retry.');
		}
	}

	async function pageDrafts(offset: number): Promise<void> {
		const context = beginDraftRequest('list-drafts');
		if (!context) return;
		try {
			const payload = await requestJson<unknown>(`${ROUTING_DRAFT_PATH}?limit=${ROUTING_DRAFT_PAGE_SIZE}&offset=${offset}`, { signal: context.request.signal });
			if (context.request.signal.aborted || context.sequence !== requestSequence) return;
			drafts = parseRoutingDraftPage(payload, offset);
			draftOffset = offset;
			status = text(`已加载 ${drafts.length} 个草稿。`, `Loaded ${drafts.length} drafts.`);
		} catch (cause) {
			if (!context.request.signal.aborted && context.sequence === requestSequence) {
				error = draftErrorMessage(cause);
				errorField = 'request';
			}
		} finally {
			if (context.sequence === requestSequence) { draftsLoaded = true; operation = null; }
		}
	}

	async function importRules(): Promise<void> {
		if (busy) return;
		if (draft.rules !== '[]' && !window.confirm(text('替换当前候选规则草稿？样本保持不变。', 'Replace the candidate rules draft? Samples will be kept.'))) return;
		const sequence = ++requestSequence;
		const request = new AbortController();
		activeRequest = request;
		operation = 'import';
		error = '';
		errorField = '';
		status = '';
		try {
			const rules = importSimulationRules(await requestJson<unknown>('/api/routing/rules', { signal: request.signal }));
			if (request.signal.aborted || sequence !== requestSequence) return;
			draft.rules = JSON.stringify(rules, null, 2);
			draftDirty = true;
			response = null;
			lastPayload = null;
			status = text(`已导入全部 ${rules.length} 条规则，尚未保存草稿。`, `Imported all ${rules.length} rules; draft is not saved.`);
		} catch (cause) {
			if (!request.signal.aborted && sequence === requestSequence) await reportError(cause);
		} finally {
			if (sequence === requestSequence) operation = null;
		}
	}

	async function runSimulation(): Promise<void> {
		if (busy || !active) return;
		error = '';
		errorField = '';
		status = '';
		response = null;
		lastPayload = null;
		let payload: SimulationPayload;
		try { payload = buildSimulationPayload(draft); }
		catch (cause) { await reportError(cause); return; }
		const sequence = ++requestSequence;
		const request = new AbortController();
		activeRequest = request;
		operation = 'run';
		lastPayload = payload;
		try {
			const raw = await requestJson<unknown>('/api/control-plane/routing/simulate', {
				method: 'POST', body: JSON.stringify(payload), signal: request.signal,
			});
			if (request.signal.aborted || sequence !== requestSequence) return;
			response = parseSimulationResponse(raw, payload.samples);
			status = text(`已评估 ${response.results.length} 个样本。`, `Evaluated ${response.results.length} samples.`);
		} catch (cause) {
			if (!request.signal.aborted && sequence === requestSequence) await reportError(cause);
		} finally {
			if (sequence === requestSequence) operation = null;
		}
	}

	function cancel(): void {
		cancelRequests();
		status = text('已取消。', 'Cancelled.');
	}

	function selectDraftFromEvent(event: Event): void {
		const select = event.currentTarget;
		if (select instanceof HTMLSelectElement) void selectDraft(select.value);
	}

	function exportResults(): void {
		if (!response || !lastPayload) return;
		const url = URL.createObjectURL(new Blob([JSON.stringify({ input: lastPayload, ...response }, null, 2)], { type: 'application/json' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = 'routing-simulation.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	$effect(() => { if (!active && !mutating) untrack(cancelRequests); });
	$effect(() => { if (active && !draftsLoaded) untrack(() => void loadDraftList()); });
	onMount(() => {
		const recovery = recoveryEpoch === routingDraftRecovery.epoch ? routingDraftRecovery.current : null;
		if (recovery) {
			draft = { ...recovery.draft };
			selectedDraft = recovery.selectedDraft;
			selectedDraftId = recovery.selectedDraft?.id ?? '';
			draftName = recovery.name;
			draftDirty = recovery.dirty;
			uncertainMutation = recovery.uncertain;
			routingDraftRecovery.current = null;
		}
		const guard = (event: BeforeUnloadEvent): void => {
			if (draftDirty || mutating || uncertainMutation) event.preventDefault();
		};
		window.addEventListener('beforeunload', guard);
		return () => window.removeEventListener('beforeunload', guard);
	});
	function preserveAndCancel(): void {
		if (recoveryEpoch === routingDraftRecovery.epoch) routingDraftRecovery.current = draftDirty || mutating || uncertainMutation ? {
			draft: { ...draft }, selectedDraft, name: draftName, dirty: draftDirty,
			uncertain: uncertainMutation || mutating,
		} : null;
		cancelRequests();
	}
	onDestroy(preserveAndCancel);
</script>

<div class="simulation">
	<div class="toolbar">
		<div class="actions">
			<button type="button" onclick={() => void importRules()} disabled={busy}><Import size={16} aria-hidden="true" />{text('导入全部已存规则', 'Import all stored rules')}</button>
			<button class="primary" type="button" onclick={() => void runSimulation()} disabled={busy}><Play size={16} aria-hidden="true" />{operation === 'run' ? text('运行中', 'Running') : text('运行仿真', 'Run simulation')}</button>
			{#if busy && !mutating}<button class="icon-button" type="button" onclick={cancel} aria-label={text('取消请求', 'Cancel request')} title={text('取消请求', 'Cancel request')}><Square size={16} aria-hidden="true" /></button>{/if}
			<button class="icon-button" type="button" onclick={exportResults} disabled={!response || busy} aria-label={text('导出结果', 'Export results')} title={text('导出结果', 'Export results')}><Download size={16} aria-hidden="true" /></button>
		</div>
		<span class="mode">{text('离线 · 加权抽样', 'Offline · Weighted sample')}</span>
	</div>
	<div class="draft-toolbar">
		<label for="routing-draft-select">{text('已保存草稿', 'Saved draft')}
			<select id="routing-draft-select" bind:value={selectedDraftId} onchange={selectDraftFromEvent} disabled={busy}>
				<option value="">{text('新建草稿', 'New draft')}</option>
				{#if selectedDraft && !drafts.some((item) => item.id === selectedDraft?.id)}<option value={selectedDraft.id}>{selectedDraft.name} · v{selectedDraft.revision}</option>{/if}
				{#each drafts as item (item.id)}<option value={item.id}>{item.name} · v{item.revision}</option>{/each}
			</select>
		</label>
		<label class="draft-name" for="routing-draft-name">{text('草稿名称', 'Draft name')}
			<input id="routing-draft-name" bind:value={draftName} oninput={markDraftDirty} disabled={busy} />
		</label>
		<div class="draft-actions">
			<button type="button" onclick={startNewDraft} disabled={busy}><FilePlus2 size={16} aria-hidden="true" />{text('新建', 'New')}</button>
			<button class="primary" type="button" onclick={() => void saveDraft()} disabled={busy || uncertainMutation}><Save size={16} aria-hidden="true" />{operation === 'save-draft' ? text('保存中', 'Saving') : text('保存草稿', 'Save draft')}</button>
			<button class="icon-button" type="button" onclick={refreshDrafts} disabled={busy} aria-label={text('刷新草稿列表', 'Refresh drafts')} title={text('刷新草稿列表', 'Refresh drafts')}><RefreshCw size={16} aria-hidden="true" /></button>
			{#if selectedDraft}<button type="button" onclick={() => void selectDraft(selectedDraft!.id, true)} disabled={busy}>{text('重新载入', 'Reload')}</button><button class="icon-button danger" type="button" onclick={() => void deleteDraft()} disabled={busy || uncertainMutation} aria-label={text('删除草稿', 'Delete draft')} title={text('删除草稿', 'Delete draft')}><Trash2 size={16} aria-hidden="true" /></button>{/if}
		</div>
	</div>
	<div class="draft-pages"><span>{drafts.length ? text(`草稿 ${draftOffset + 1}–${draftOffset + drafts.length}`, `Drafts ${draftOffset + 1}–${draftOffset + drafts.length}`) : text('本页暂无草稿', 'No drafts on this page')}</span><button type="button" disabled={busy || draftOffset === 0} onclick={() => void pageDrafts(Math.max(0, draftOffset - ROUTING_DRAFT_PAGE_SIZE))}>{text('上一页', 'Previous')}</button><button type="button" disabled={busy || drafts.length < ROUTING_DRAFT_PAGE_SIZE} onclick={() => void pageDrafts(draftOffset + ROUTING_DRAFT_PAGE_SIZE)}>{text('下一页', 'Next')}</button></div>
	{#if selectedDraft}<p class="draft-meta">{text(`修订 ${selectedDraft.revision} · 最后更新 ${new Date(selectedDraft.updated_at).toLocaleString(i18n.locale === 'zh-CN' ? 'zh-CN' : 'en-US')}`, `Revision ${selectedDraft.revision} · Updated ${new Date(selectedDraft.updated_at).toLocaleString('en-US')}`)}{#if draftDirty}<span>{text(' · 有未保存修改', ' · Unsaved changes')}</span>{/if}</p>{:else if draftDirty}<p class="draft-meta">{text('新草稿 · 有未保存修改', 'New draft · Unsaved changes')}</p>{/if}
	<div class="status" role="status" aria-live="polite">{operation === 'import' ? text('正在导入全部规则', 'Importing all rules') : status}</div>
	{#if error}<div class="notice error" role="alert" tabindex="-1" bind:this={errorElement}>{error}</div>{/if}
	{#if uncertainMutation}<div class="notice recovery" role="alert">{text('上一次写入结果未确认。请先刷新列表并重新载入草稿，再继续保存或删除。', 'The previous write outcome is unconfirmed. Refresh the list and reload the draft before saving or deleting again.')}</div>{/if}
	<form onsubmit={(event) => { event.preventDefault(); void runSimulation(); }}>
		<fieldset disabled={busy && operation !== 'run'}>
			<div class="editors">
				<label for="simulation-rules">{text('候选规则 JSON', 'Candidate rules JSON')}
					<textarea id="simulation-rules" rows="20" spellcheck="false" autocomplete="off" bind:value={draft.rules} oninput={markDraftDirty} aria-invalid={errorField === 'rules'} aria-describedby={errorField === 'rules' ? 'simulation-rules-error' : undefined}></textarea>
					{#if errorField === 'rules'}<span class="field-error" id="simulation-rules-error">{error}</span>{/if}
				</label>
				<label for="simulation-samples">{text('样本与用量快照 JSON', 'Samples and usage snapshots JSON')}
					<textarea id="simulation-samples" rows="20" spellcheck="false" autocomplete="off" bind:value={draft.samples} oninput={invalidate} aria-invalid={errorField === 'samples'} aria-describedby={errorField === 'samples' ? 'simulation-samples-error' : undefined}></textarea>
					{#if errorField === 'samples'}<span class="field-error" id="simulation-samples-error">{error}</span>{/if}
				</label>
			</div>
			<label class="depth" for="simulation-depth">{text('最大链深度', 'Maximum chain depth')}<input id="simulation-depth" type="number" min="1" max="20" step="1" bind:value={draft.chainMaxDepth} oninput={markDraftDirty} aria-invalid={errorField === 'depth'} aria-describedby={errorField === 'depth' ? 'simulation-depth-error' : undefined} />{#if errorField === 'depth'}<span class="field-error" id="simulation-depth-error">{error}</span>{/if}</label>
		</fieldset>
	</form>
	<section class="results" aria-labelledby="simulation-results-title" aria-busy={operation === 'run'}>
		<h2 id="simulation-results-title">{text('仿真结果', 'Simulation results')}</h2>
		{#if operation === 'run'}<p role="status">{text('正在评估样本', 'Evaluating samples')}</p>
		{:else if response}
			<div class="result-list">
				{#each response.results as result, index (index)}
					<article class:failed={Boolean(result.error)}>
						<header><h3>{result.name || `${text('样本', 'Sample')} ${index + 1}`}</h3><span class="result-state">{result.error ? text('失败', 'Failed') : result.matched ? text('已匹配', 'Matched') : text('未匹配', 'No match')}</span></header>
						{#if result.error}<p class="field-error">{result.error}</p>{/if}
						{#if result.decision}<dl>
							<div><dt>{text('目标', 'Target')}</dt><dd>{result.decision.provider} / {result.decision.model}</dd></div>
							<div><dt>{text('匹配规则', 'Matched rule')}</dt><dd>{result.decision.rule_name} <code>{result.decision.rule_id}</code></dd></div>
							<div><dt>{text('密钥 ID', 'Key ID')}</dt><dd>{result.decision.key_id || '—'}</dd></div>
							<div><dt>TTFT</dt><dd>{result.decision.ttft_timeout_ms} ms</dd></div>
						</dl>{/if}
						<details><summary>{text('完整决策', 'Full decision')}</summary><pre>{JSON.stringify(result.decision, null, 2)}</pre></details>
						<details><summary>{text('引擎 trace', 'Engine trace')} ({result.logs.length})</summary><pre>{JSON.stringify(result.logs, null, 2)}</pre></details>
					</article>
				{/each}
			</div>
		{:else}<p class="empty">{text('暂无仿真结果', 'No simulation results')}</p>{/if}
	</section>
</div>

<style>
	.simulation { --simulation-error-text: color-mix(in srgb, var(--destructive) 75%, var(--foreground)); display: grid; gap: 1rem; min-width: 0; }
	.toolbar, .actions { align-items: center; display: flex; flex-wrap: wrap; gap: .5rem; }
	.toolbar { justify-content: space-between; }
	.draft-toolbar { align-items: end; border-bottom: 1px solid var(--border); display: grid; gap: .75rem; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); padding-bottom: .85rem; }
	.draft-actions { grid-column: 1 / -1; }
	.draft-pages { align-items: center; color: var(--muted-foreground); display: flex; flex-wrap: wrap; gap: .5rem; font-size: .8rem; }
	.draft-pages span { margin-right: auto; }
	.draft-toolbar label { min-width: 0; }
	.draft-actions { align-items: end; display: flex; flex-wrap: wrap; gap: .5rem; }
	.draft-meta { color: var(--muted-foreground); font-size: .8rem; margin: -.35rem 0 0; }
	.draft-meta span { color: var(--destructive); font-weight: 650; }
	button { align-items: center; background: var(--muted); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); cursor: pointer; display: inline-flex; font: inherit; font-size: .85rem; font-weight: 650; gap: .45rem; justify-content: center; min-height: 44px; padding: .5rem .75rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	button:disabled { cursor: not-allowed; opacity: .5; }
	.icon-button { height: 44px; padding: 0; width: 44px; }
	button:focus-visible, textarea:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, .notice:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
	.mode, .status, .empty, dt { color: var(--muted-foreground); }
	.mode { font-size: .8rem; }
	.status { font-size: .85rem; min-height: 1.5em; }
	fieldset { border: 0; margin: 0; min-width: 0; padding: 0; }
	.editors { display: grid; gap: 1rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	label { display: grid; font-size: .85rem; font-weight: 650; gap: .5rem; min-width: 0; }
	input, textarea, select { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; box-sizing: border-box; color: var(--foreground); min-width: 0; padding: .75rem; width: 100%; }
	textarea, pre { font: .85rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size: 2; }
	textarea { min-height: 25rem; resize: vertical; }
	.depth { margin-top: .85rem; max-width: 17rem; }
	input { font: inherit; min-height: 44px; }
	[aria-invalid="true"] { border-color: var(--destructive); }
	.field-error { color: var(--simulation-error-text); font-size: .85rem; font-weight: 400; overflow-wrap: anywhere; }
	.notice { border: 1px solid var(--destructive); border-radius: .5rem; color: var(--simulation-error-text); overflow-wrap: anywhere; padding: .75rem; }
	.notice.recovery { border-color: var(--primary); color: var(--foreground); }
	h2 { font-size: 1.1rem; margin: 0 0 .75rem; }
	h3, p { margin: 0; }
	h3 { font-size: 1rem; min-width: 0; overflow-wrap: anywhere; }
	.results { border-top: 1px solid var(--border); min-width: 0; padding-top: 1rem; }
	.result-list { display: grid; gap: .75rem; }
	article { border: 1px solid var(--border); border-radius: .5rem; display: grid; gap: .75rem; min-width: 0; padding: .9rem; }
	article.failed { border-color: var(--destructive); }
	article > header { align-items: start; display: flex; gap: .75rem; justify-content: space-between; }
	.result-state { flex-shrink: 0; font-size: .85rem; font-weight: 650; }
	dl { display: grid; gap: .75rem; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; }
	dl > div { min-width: 0; }
	dt { font-size: .8rem; }
	dd { font-size: .85rem; margin: .3rem 0 0; overflow-wrap: anywhere; }
	dd code { display: block; font-size: .8rem; }
	summary { cursor: pointer; font-size: .85rem; min-height: 24px; overflow-wrap: anywhere; }
	pre { background: var(--muted); border-radius: .5rem; margin: .65rem 0 0; max-height: 25rem; overflow: auto; overflow-wrap: anywhere; padding: .75rem; white-space: pre-wrap; }
	@media (max-width: 760px) { .draft-toolbar { grid-template-columns: minmax(0, 1fr); } .editors { grid-template-columns: minmax(0, 1fr); } dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } textarea { font-size: 1rem; min-height: 20rem; } input, select { font-size: 1rem; } }
	@media (max-width: 400px) { .actions { width: 100%; } .actions button:not(.icon-button) { flex: 1 1 auto; } dl { grid-template-columns: minmax(0, 1fr); } }
</style>
