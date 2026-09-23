<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, parseJsonObject, prettyJson } from '../lib/forms';
	import { getListPayload, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { promptSessionHasCommitMessages } from '../lib/prompt-repository';

	interface Props { resourceName: string; }
	type DraftMode = 'version' | 'session' | 'edit-session' | null;

	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let folders = $state.raw<JsonRecord[]>([]);
	let prompts = $state.raw<JsonRecord[]>([]);
	let versions = $state.raw<JsonRecord[]>([]);
	let sessions = $state.raw<JsonRecord[]>([]);
	let selectedFolderId = $state('');
	let selectedPrompt = $state.raw<JsonRecord | null>(null);
	let selectedSession = $state.raw<JsonRecord | null>(null);
	let inspected = $state.raw<JsonRecord | null>(null);
	let draftMode = $state<DraftMode>(null);
	let draftJson = $state('');
	let isListLoading = $state(true);
	let isDetailLoading = $state(false);
	let isSaving = $state(false);
	let error = $state('');
	let notice = $state('');
	let listLoadSeq = 0;
	let detailLoadSeq = 0;
	let inspectLoadSeq = 0;
	let contextSeq = 0;
	const isLoading = $derived(isListLoading || isDetailLoading);

	function objectPayload(payload: unknown, key: string): JsonRecord {
		return isJsonRecord(payload) && isJsonRecord(payload[key]) ? payload[key] : isJsonRecord(payload) ? payload : {};
	}

	function arrayPayload(payload: unknown, key: string): JsonRecord[] {
		return isJsonRecord(payload) && Array.isArray(payload[key]) ? payload[key].filter(isJsonRecord) : getListPayload(payload);
	}

	function promptId(prompt = selectedPrompt): string { return String(prompt?.id ?? ''); }

	async function load(): Promise<void> {
		const sequence = ++listLoadSeq;
		const requestedFolderId = selectedFolderId;
		const requestedPromptId = promptId();
		const requestedContextSeq = contextSeq;
		const requestedInspectSeq = inspectLoadSeq;
		const requestedDraftMode = draftMode;
		const requestedDraftJson = draftJson;
		const requestedSessionId = String(selectedSession?.id ?? '');
		isListLoading = true;
		error = '';
		try {
			const promptPath = requestedFolderId ? `/api/prompt-repo/prompts?folder_id=${encodeURIComponent(requestedFolderId)}` : '/api/prompt-repo/prompts';
			const [folderPayload, promptPayload] = await Promise.all([
				requestJson('/api/prompt-repo/folders'),
				requestJson(promptPath),
			]);
			if (sequence !== listLoadSeq || selectedFolderId !== requestedFolderId) return;
			folders = arrayPayload(folderPayload, 'folders');
			prompts = arrayPayload(promptPayload, 'prompts');
			const detailContextMatches = contextSeq === requestedContextSeq && inspectLoadSeq === requestedInspectSeq
				&& draftMode === requestedDraftMode && draftJson === requestedDraftJson
				&& String(selectedSession?.id ?? '') === requestedSessionId;
			if (requestedPromptId && promptId() === requestedPromptId && detailContextMatches) {
				const refreshed = prompts.find((item) => promptId(item) === requestedPromptId);
				if (refreshed) await selectPrompt(refreshed, { markContext: false });
				else if (sequence === listLoadSeq && selectedFolderId === requestedFolderId && promptId() === requestedPromptId && detailContextMatches) clearPrompt(true);
			}
		} catch (cause) {
			if (sequence === listLoadSeq && selectedFolderId === requestedFolderId) error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			if (sequence === listLoadSeq) isListLoading = false;
		}
	}

	async function selectPrompt(prompt: JsonRecord, options: { markContext?: boolean } = {}): Promise<boolean> {
		const requestedPromptId = promptId(prompt);
		if (!requestedPromptId) return false;
		if (options.markContext !== false) contextSeq += 1;
		const requestedContextSeq = contextSeq;
		const sequence = ++detailLoadSeq;
		inspectLoadSeq += 1;
		selectedPrompt = prompt;
		selectedSession = null;
		versions = [];
		sessions = [];
		inspected = null;
		draftMode = null;
		isDetailLoading = true;
		error = '';
		try {
			const id = encodeURIComponent(requestedPromptId);
			const [detailPayload, versionPayload, sessionPayload] = await Promise.all([
				requestJson(`/api/prompt-repo/prompts/${id}`),
				requestJson(`/api/prompt-repo/prompts/${id}/versions`),
				requestJson(`/api/prompt-repo/prompts/${id}/sessions`),
			]);
			if (sequence !== detailLoadSeq || promptId() !== requestedPromptId || contextSeq !== requestedContextSeq) return false;
			selectedPrompt = { ...prompt, ...objectPayload(detailPayload, 'prompt') };
			versions = arrayPayload(versionPayload, 'versions');
			sessions = arrayPayload(sessionPayload, 'sessions');
			inspected = null;
			draftMode = null;
			return true;
		} catch (cause) {
			if (sequence === detailLoadSeq && promptId() === requestedPromptId && contextSeq === requestedContextSeq) error = displayError(cause, i18n.t('elygate.loadFailed'));
			return false;
		} finally {
			if (sequence === detailLoadSeq) isDetailLoading = false;
		}
	}

	function clearPrompt(internal = false): void {
		if (!internal) contextSeq += 1;
		detailLoadSeq += 1;
		inspectLoadSeq += 1;
		isDetailLoading = false;
		selectedPrompt = null;
		selectedSession = null;
		versions = [];
		sessions = [];
		inspected = null;
		draftMode = null;
	}

	async function createFolder(): Promise<void> {
		if (isSaving) return;
		const name = window.prompt(i18n.t('elygate.folderName'))?.trim();
		if (!name) return;
		isSaving = true; error = ''; notice = '';
		try {
			await requestJson('/api/prompt-repo/folders', { method: 'POST', body: JSON.stringify({ name, description: null }) });
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isSaving = false; }
	}

	async function editFolder(folder: JsonRecord): Promise<void> {
		if (isSaving) return;
		const folderId = String(folder.id ?? '');
		if (!folderId) return;
		const name = window.prompt(i18n.t('elygate.folderName'), String(folder.name ?? ''))?.trim();
		if (!name) return;
		isSaving = true; error = ''; notice = '';
		try {
			await requestJson(`/api/prompt-repo/folders/${encodeURIComponent(folderId)}`, { method: 'PUT', body: JSON.stringify({ name, description: folder.description ?? null }) });
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isSaving = false; }
	}

	async function deleteFolder(folder: JsonRecord): Promise<void> {
		if (isSaving) return;
		const folderId = String(folder.id ?? '');
		if (!folderId) return;
		if (!window.confirm(i18n.t('elygate.confirmDelete'))) return;
		isSaving = true; error = ''; notice = '';
		try {
			await requestJson(`/api/prompt-repo/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' });
			if (selectedFolderId === folderId) selectedFolderId = '';
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isSaving = false; }
	}

	async function createPrompt(): Promise<void> {
		if (isSaving) return;
		const name = window.prompt(i18n.t('elygate.promptName'))?.trim();
		if (!name) return;
		const folderId = selectedFolderId;
		const requestedPromptId = promptId();
		const requestedHadSelection = Boolean(requestedPromptId);
		const requestedContextSeq = contextSeq;
		const requestedDraftMode = draftMode;
		const requestedDraftJson = draftJson;
		const requestedSessionId = String(selectedSession?.id ?? '');
		isSaving = true; error = ''; notice = '';
		try {
			const response = await requestJson('/api/prompt-repo/prompts', { method: 'POST', body: JSON.stringify({ name, folder_id: folderId || null }) });
			const createdPrompt = objectPayload(response, 'prompt');
			await load();
			const selectionUnchanged = requestedHadSelection ? promptId() === requestedPromptId : !selectedPrompt;
			const detailContextMatches = contextSeq === requestedContextSeq
				&& draftMode === requestedDraftMode && draftJson === requestedDraftJson
				&& String(selectedSession?.id ?? '') === requestedSessionId;
			if (selectedFolderId === folderId && selectionUnchanged && detailContextMatches && promptId(createdPrompt)) {
				await selectPrompt(createdPrompt);
			}
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isSaving = false; }
	}

	async function editPrompt(): Promise<void> {
		if (!selectedPrompt || isSaving) return;
		const requestedPromptId = promptId();
		const name = window.prompt(i18n.t('elygate.promptName'), String(selectedPrompt.name ?? ''))?.trim();
		if (!name) return;
		isSaving = true; error = ''; notice = '';
		try {
			await requestJson(`/api/prompt-repo/prompts/${encodeURIComponent(requestedPromptId)}`, { method: 'PUT', body: JSON.stringify({ name, folder_id: selectedPrompt.folder_id ?? null }) });
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isSaving = false; }
	}

	async function deletePrompt(): Promise<void> {
		if (!selectedPrompt || isSaving || !window.confirm(i18n.t('elygate.confirmDelete'))) return;
		const requestedPromptId = promptId();
		isSaving = true; error = ''; notice = '';
		try {
			await requestJson(`/api/prompt-repo/prompts/${encodeURIComponent(requestedPromptId)}`, { method: 'DELETE' });
			if (promptId() === requestedPromptId) clearPrompt();
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isSaving = false; }
	}

	function openDraft(mode: Exclude<DraftMode, null>, session?: JsonRecord): void {
		contextSeq += 1;
		inspectLoadSeq += 1;
		draftMode = mode;
		selectedSession = session ?? null;
		inspected = null;
		if (mode === 'version') {
			draftJson = prettyJson({ commit_message: '', messages: [{ role: 'system', content: '' }, { role: 'user', content: '' }], model_params: {}, provider: '', model: '', variables: {} });
		} else if (mode === 'session') {
			draftJson = prettyJson({ name: '', version_id: versions[0]?.id ?? null, messages: [], model_params: {}, provider: '', model: '', variables: {} });
		} else {
			draftJson = prettyJson({ name: session?.name ?? '', messages: session?.messages ?? [], model_params: session?.model_params ?? {}, provider: session?.provider ?? '', model: session?.model ?? '', variables: session?.variables ?? {} });
		}
	}

	async function saveDraft(): Promise<void> {
		if (!selectedPrompt || !draftMode || isSaving) return;
		const requestedPromptId = promptId();
		const requestedMode = draftMode;
		const requestedSessionId = String(selectedSession?.id ?? '');
		const requestedContextSeq = contextSeq;
		const requestedInspectSeq = inspectLoadSeq;
		const requestedDraftJson = draftJson;
		isSaving = true;
		error = '';
		notice = '';
		try {
			const body = parseJsonObject(draftJson, i18n.t('elygate.requestJson'), i18n.t('elygate.invalidJson'));
			if (requestedMode === 'version') await requestJson(`/api/prompt-repo/prompts/${encodeURIComponent(requestedPromptId)}/versions`, { method: 'POST', body: JSON.stringify(body) });
			else if (requestedMode === 'session') await requestJson(`/api/prompt-repo/prompts/${encodeURIComponent(requestedPromptId)}/sessions`, { method: 'POST', body: JSON.stringify(body) });
			else if (requestedSessionId) await requestJson(`/api/prompt-repo/sessions/${encodeURIComponent(requestedSessionId)}`, { method: 'PUT', body: JSON.stringify(body) });
			const contextMatches = promptId() === requestedPromptId && contextSeq === requestedContextSeq && inspectLoadSeq === requestedInspectSeq
				&& draftMode === requestedMode && draftJson === requestedDraftJson
				&& (requestedMode !== 'edit-session' || String(selectedSession?.id ?? '') === requestedSessionId);
			if (!contextMatches) { notice = i18n.t('elygate.saveSuccess'); return; }
			draftMode = null;
			if (await selectPrompt(selectedPrompt!, { markContext: false })) notice = i18n.t('elygate.saveSuccess');
			else {
				error = '';
				notice = i18n.t('elygate.saveSuccessRefreshFailed');
			}
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isSaving = false; }
	}

	async function inspectVersion(version: JsonRecord): Promise<void> {
		const requestedPromptId = promptId();
		const versionId = String(version.id ?? '');
		if (!requestedPromptId || !versionId) return;
		contextSeq += 1;
		const requestedContextSeq = contextSeq;
		const sequence = ++inspectLoadSeq;
		try {
			const detail = objectPayload(await requestJson(`/api/prompt-repo/versions/${encodeURIComponent(versionId)}`), 'version');
			if (sequence !== inspectLoadSeq || promptId() !== requestedPromptId || contextSeq !== requestedContextSeq) return;
			inspected = detail;
			draftMode = null;
		} catch (cause) { if (sequence === inspectLoadSeq && promptId() === requestedPromptId && contextSeq === requestedContextSeq) error = displayError(cause, i18n.t('elygate.loadFailed')); }
	}

	async function inspectSession(session: JsonRecord): Promise<void> {
		const requestedPromptId = promptId();
		const sessionId = String(session.id ?? '');
		if (!requestedPromptId || !sessionId) return;
		contextSeq += 1;
		const requestedContextSeq = contextSeq;
		const sequence = ++inspectLoadSeq;
		try {
			const detail = objectPayload(await requestJson(`/api/prompt-repo/sessions/${encodeURIComponent(sessionId)}`), 'session');
			if (sequence !== inspectLoadSeq || promptId() !== requestedPromptId || contextSeq !== requestedContextSeq) return;
			inspected = detail;
			openDraft('edit-session', detail);
		} catch (cause) { if (sequence === inspectLoadSeq && promptId() === requestedPromptId && contextSeq === requestedContextSeq) error = displayError(cause, i18n.t('elygate.loadFailed')); }
	}

	async function commitSession(session: JsonRecord): Promise<void> {
		if (isSaving) return;
		error = '';
		notice = '';
		if (!promptSessionHasCommitMessages(session)) {
			error = i18n.t('elygate.promptSessionEmpty');
			return;
		}
		const commitMessage = window.prompt(i18n.t('elygate.commitMessage'))?.trim();
		if (!commitMessage) return;
		const requestedPromptId = promptId();
		const sessionId = String(session.id ?? '');
		if (!requestedPromptId || !sessionId) return;
		const requestedContextSeq = contextSeq;
		const requestedInspectSeq = inspectLoadSeq;
		const requestedSessionId = String(selectedSession?.id ?? '');
		const requestedDraftMode = draftMode;
		const requestedDraftJson = draftJson;
		isSaving = true;
		try {
			await requestJson(`/api/prompt-repo/sessions/${encodeURIComponent(sessionId)}/commit`, { method: 'POST', body: JSON.stringify({ commit_message: commitMessage }) });
			const contextMatches = promptId() === requestedPromptId && contextSeq === requestedContextSeq && inspectLoadSeq === requestedInspectSeq
				&& String(selectedSession?.id ?? '') === requestedSessionId && draftMode === requestedDraftMode && draftJson === requestedDraftJson;
			if (!contextMatches) { notice = i18n.t('elygate.saveSuccess'); return; }
			if (await selectPrompt(selectedPrompt!, { markContext: false })) notice = i18n.t('elygate.saveSuccess');
			else {
				error = '';
				notice = i18n.t('elygate.saveSuccessRefreshFailed');
			}
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isSaving = false; }
	}

	async function removeChild(kind: 'versions' | 'sessions', id: unknown): Promise<void> {
		if (isSaving || !window.confirm(i18n.t('elygate.confirmDelete'))) return;
		const requestedPromptId = promptId();
		const childId = String(id ?? '');
		if (!requestedPromptId || !childId) return;
		const requestedContextSeq = contextSeq;
		const requestedInspectSeq = inspectLoadSeq;
		const requestedSessionId = String(selectedSession?.id ?? '');
		const requestedDraftMode = draftMode;
		const requestedDraftJson = draftJson;
		isSaving = true; error = ''; notice = '';
		try {
			await requestJson(`/api/prompt-repo/${kind}/${encodeURIComponent(childId)}`, { method: 'DELETE' });
			const contextMatches = promptId() === requestedPromptId && contextSeq === requestedContextSeq && inspectLoadSeq === requestedInspectSeq
				&& String(selectedSession?.id ?? '') === requestedSessionId && draftMode === requestedDraftMode && draftJson === requestedDraftJson;
			if (contextMatches) await selectPrompt(selectedPrompt!, { markContext: false });
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isSaving = false; }
	}

	function closeDraft(): void {
		contextSeq += 1;
		inspectLoadSeq += 1;
		draftMode = null;
	}

	onMount(() => { void load(); });
</script>

<section class="page-shell">
	<header class="page-heading"><div><p class="eyebrow">{getAppName()} / {i18n.t('elygate.integrations')}</p><h1>{i18n.t('elygate.prompts')}</h1><p>{i18n.t('elygate.promptsHint')}</p></div><div><button type="button" onclick={() => void createFolder()}>{i18n.t('elygate.newFolder')}</button><button class="primary" type="button" onclick={() => void createPrompt()}>{i18n.t('elygate.newPrompt')}</button></div></header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<div class="workspace">
		<aside class="folders"><button type="button" class:is-active={!selectedFolderId} onclick={() => { selectedFolderId = ''; clearPrompt(); void load(); }}>{i18n.t('elygate.allPrompts')}</button>{#each folders as folder (String(folder.id))}<div><button type="button" class:is-active={selectedFolderId === String(folder.id)} onclick={() => { selectedFolderId = String(folder.id); clearPrompt(); void load(); }}><strong class="folder-name" title={String(folder.name)}>{String(folder.name)}</strong><span>{Number(folder.prompts_count ?? 0)}</span></button><button type="button" title={i18n.t('elygate.edit')} aria-label={`${i18n.t('elygate.edit')} ${String(folder.name)}`} onclick={() => void editFolder(folder)}>✎</button><button type="button" title={i18n.t('elygate.delete')} aria-label={`${i18n.t('elygate.delete')} ${String(folder.name)}`} onclick={() => void deleteFolder(folder)}>×</button></div>{/each}</aside>
		<aside class="prompts">{#each prompts as prompt (String(prompt.id))}<button type="button" class:is-active={selectedPrompt?.id === prompt.id} onclick={() => void selectPrompt(prompt)}><strong>{String(prompt.name)}</strong><span>{prompt.latest_version ? `v${String((prompt.latest_version as JsonRecord).version_number ?? '')}` : i18n.t('elygate.noVersions')}</span></button>{:else}<p>{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</p>{/each}</aside>
		<main class="detail">
			{#if selectedPrompt}
				<header><div><h2>{String(selectedPrompt.name)}</h2><p>{String(selectedPrompt.id)}</p></div><div><button type="button" onclick={() => void editPrompt()}>{i18n.t('elygate.edit')}</button><button class="danger" type="button" onclick={() => void deletePrompt()}>{i18n.t('elygate.delete')}</button></div></header>
				<div class="actions"><button class="primary" type="button" onclick={() => openDraft('version')}>{i18n.t('elygate.newVersion')}</button><button type="button" onclick={() => openDraft('session')}>{i18n.t('elygate.newSession')}</button></div>
				<div class="columns"><section><h3>{i18n.t('elygate.versionHistory')}</h3>{#each versions as version (String(version.id))}<div class="row"><button type="button" onclick={() => void inspectVersion(version)}><strong>v{String(version.version_number)}</strong><span>{String(version.commit_message ?? '')}</span></button><button type="button" onclick={() => void removeChild('versions', version.id)}>×</button></div>{:else}<p>{i18n.t('elygate.noVersions')}</p>{/each}</section><section><h3>{i18n.t('elygate.sessions')}</h3>{#each sessions as session (String(session.id))}<div class="row"><button type="button" onclick={() => void inspectSession(session)}><strong>{String(session.name || `#${session.id}`)}</strong><span>{String(session.provider ?? '')} / {String(session.model ?? '')}</span></button><button type="button" disabled={!promptSessionHasCommitMessages(session)} title={promptSessionHasCommitMessages(session) ? i18n.t('elygate.commit') : i18n.t('elygate.promptSessionEmpty')} onclick={() => void commitSession(session)}>✓</button><button type="button" onclick={() => void removeChild('sessions', session.id)}>×</button></div>{:else}<p>{i18n.t('elygate.noSessions')}</p>{/each}</section></div>
				{#if draftMode}<section class="editor"><h3>{i18n.t(draftMode === 'version' ? 'elygate.newVersion' : draftMode === 'session' ? 'elygate.newSession' : 'elygate.editSession')}</h3><textarea bind:value={draftJson} rows="20"></textarea><footer><button type="button" onclick={closeDraft}>{i18n.t('elygate.cancel')}</button><button class="primary" type="button" onclick={() => void saveDraft()} disabled={isSaving}>{i18n.t('elygate.save')}</button></footer></section>{:else if inspected}<section class="editor"><h3>{i18n.t('elygate.inspect')}</h3><pre>{prettyJson(inspected)}</pre></section>{/if}
			{:else}<div class="empty-state"><h2>{i18n.t('elygate.selectPrompt')}</h2><p>{i18n.t('elygate.selectPromptHint')}</p></div>{/if}
		</main>
	</div>
</section>

<style>
	.page-shell { max-width: 1380px; margin: 0 auto; padding: 1.5rem; }
	.page-heading, .page-heading > div:last-child, .detail > header, .detail > header > div:last-child, .actions, footer, .row { align-items: center; display: flex; gap: .45rem; }
	.page-heading { align-items: start; justify-content: space-between; margin-bottom: 1rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .4rem; text-transform: uppercase; }
	h1, h2 { margin: 0; } .page-heading p, .detail header p { color: var(--muted-foreground); margin: .45rem 0 0; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); cursor: pointer; font-weight: 650; padding: .5rem .65rem; }
	button.primary, button.is-active { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); } button.danger { color: var(--destructive); }
	.workspace { display: grid; gap: .7rem; grid-template-columns: minmax(240px, 280px) minmax(260px, 320px) minmax(0, 1fr); }
	.folders, .prompts, .detail { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; padding: .7rem; }
	.folders, .prompts { max-height: calc(100vh - 180px); overflow: auto; }
	.folders > button, .prompts > button { display: grid; margin-bottom: .35rem; text-align: left; width: 100%; }
	.folders > div { align-items: center; display: grid; gap: .25rem; grid-template-columns: 1fr auto auto; margin-bottom: .25rem; }
	.folders > div > button:first-child { align-items: center; display: flex; justify-content: space-between; min-width: 0; text-align: left; }
	.folder-name { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.folders span, .prompts span, .row span { color: var(--muted-foreground); display: block; font-size: .72rem; margin-top: .2rem; }
	.detail > header { justify-content: space-between; }
	.actions { margin: .7rem 0; }
	.columns { display: grid; gap: .7rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.columns section, .editor { border: 1px solid var(--border); border-radius: .65rem; padding: .7rem; }
	h3 { font-size: .9rem; margin: 0 0 .5rem; }
	.row { border-top: 1px solid var(--border); padding: .4rem 0; }
	.row > button:first-child { background: transparent; border: 0; display: grid; flex: 1; text-align: left; }
	.editor { margin-top: .7rem; }
	textarea, pre { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); font: .78rem ui-monospace, SFMono-Regular, Menlo, monospace; padding: .7rem; width: 100%; }
	pre { max-height: 460px; overflow: auto; white-space: pre-wrap; }
	footer { justify-content: flex-end; margin-top: .5rem; }
	.empty-state { color: var(--muted-foreground); padding: 4rem 1rem; text-align: center; }
	.notice { border-radius: .65rem; margin-bottom: .8rem; padding: .7rem .85rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 12%, transparent); color: var(--primary); }
	@media (max-width: 980px) { .workspace { grid-template-columns: minmax(220px, 280px) 1fr; } .detail { grid-column: 1 / -1; } .folders, .prompts { max-height: 280px; } }
	@media (max-width: 620px) { .page-heading { flex-direction: column; } .workspace, .columns { grid-template-columns: 1fr; } .detail { grid-column: auto; } }
</style>
