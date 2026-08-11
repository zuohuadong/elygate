<script lang="ts">
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
	let isLoading = $state(true);
	let isSaving = $state(false);
	let error = $state('');
	let notice = $state('');

	function objectPayload(payload: unknown, key: string): JsonRecord {
		return isJsonRecord(payload) && isJsonRecord(payload[key]) ? payload[key] : isJsonRecord(payload) ? payload : {};
	}

	function arrayPayload(payload: unknown, key: string): JsonRecord[] {
		return isJsonRecord(payload) && Array.isArray(payload[key]) ? payload[key].filter(isJsonRecord) : getListPayload(payload);
	}

	function promptId(): string { return String(selectedPrompt?.id ?? ''); }

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const promptPath = selectedFolderId ? `/api/prompt-repo/prompts?folder_id=${encodeURIComponent(selectedFolderId)}` : '/api/prompt-repo/prompts';
			const [folderPayload, promptPayload] = await Promise.all([
				requestJson('/api/prompt-repo/folders'),
				requestJson(promptPath),
			]);
			folders = arrayPayload(folderPayload, 'folders');
			prompts = arrayPayload(promptPayload, 'prompts');
			if (selectedPrompt) {
				const refreshed = prompts.find((item) => item.id === selectedPrompt?.id);
				if (refreshed) await selectPrompt(refreshed);
				else clearPrompt();
			}
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	async function selectPrompt(prompt: JsonRecord): Promise<boolean> {
		isLoading = true;
		error = '';
		try {
			const id = encodeURIComponent(String(prompt.id));
			const [detailPayload, versionPayload, sessionPayload] = await Promise.all([
				requestJson(`/api/prompt-repo/prompts/${id}`),
				requestJson(`/api/prompt-repo/prompts/${id}/versions`),
				requestJson(`/api/prompt-repo/prompts/${id}/sessions`),
			]);
			selectedPrompt = objectPayload(detailPayload, 'prompt');
			versions = arrayPayload(versionPayload, 'versions');
			sessions = arrayPayload(sessionPayload, 'sessions');
			inspected = null;
			draftMode = null;
			return true;
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
			return false;
		} finally {
			isLoading = false;
		}
	}

	function clearPrompt(): void {
		selectedPrompt = null;
		selectedSession = null;
		versions = [];
		sessions = [];
		inspected = null;
		draftMode = null;
	}

	async function createFolder(): Promise<void> {
		const name = window.prompt(i18n.t('elygate.folderName'))?.trim();
		if (!name) return;
		try {
			await requestJson('/api/prompt-repo/folders', { method: 'POST', body: JSON.stringify({ name, description: null }) });
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
	}

	async function editFolder(folder: JsonRecord): Promise<void> {
		const name = window.prompt(i18n.t('elygate.folderName'), String(folder.name ?? ''))?.trim();
		if (!name) return;
		try {
			await requestJson(`/api/prompt-repo/folders/${encodeURIComponent(String(folder.id))}`, { method: 'PUT', body: JSON.stringify({ name, description: folder.description ?? null }) });
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
	}

	async function deleteFolder(folder: JsonRecord): Promise<void> {
		if (!window.confirm(i18n.t('elygate.confirmDelete'))) return;
		try {
			await requestJson(`/api/prompt-repo/folders/${encodeURIComponent(String(folder.id))}`, { method: 'DELETE' });
			if (selectedFolderId === String(folder.id)) selectedFolderId = '';
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
	}

	async function createPrompt(): Promise<void> {
		const name = window.prompt(i18n.t('elygate.promptName'))?.trim();
		if (!name) return;
		try {
			const response = await requestJson('/api/prompt-repo/prompts', { method: 'POST', body: JSON.stringify({ name, folder_id: selectedFolderId || null }) });
			await load();
			await selectPrompt(objectPayload(response, 'prompt'));
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
	}

	async function editPrompt(): Promise<void> {
		if (!selectedPrompt) return;
		const name = window.prompt(i18n.t('elygate.promptName'), String(selectedPrompt.name ?? ''))?.trim();
		if (!name) return;
		try {
			await requestJson(`/api/prompt-repo/prompts/${encodeURIComponent(promptId())}`, { method: 'PUT', body: JSON.stringify({ name, folder_id: selectedPrompt.folder_id ?? null }) });
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
	}

	async function deletePrompt(): Promise<void> {
		if (!selectedPrompt || !window.confirm(i18n.t('elygate.confirmDelete'))) return;
		try {
			await requestJson(`/api/prompt-repo/prompts/${encodeURIComponent(promptId())}`, { method: 'DELETE' });
			clearPrompt();
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
	}

	function openDraft(mode: Exclude<DraftMode, null>, session?: JsonRecord): void {
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
		if (!selectedPrompt || !draftMode) return;
		isSaving = true;
		error = '';
		notice = '';
		try {
			const body = parseJsonObject(draftJson, i18n.t('elygate.requestJson'), i18n.t('elygate.invalidJson'));
			if (draftMode === 'version') await requestJson(`/api/prompt-repo/prompts/${encodeURIComponent(promptId())}/versions`, { method: 'POST', body: JSON.stringify(body) });
			else if (draftMode === 'session') await requestJson(`/api/prompt-repo/prompts/${encodeURIComponent(promptId())}/sessions`, { method: 'POST', body: JSON.stringify(body) });
			else if (selectedSession) await requestJson(`/api/prompt-repo/sessions/${encodeURIComponent(String(selectedSession.id))}`, { method: 'PUT', body: JSON.stringify(body) });
			draftMode = null;
			if (await selectPrompt(selectedPrompt)) notice = i18n.t('elygate.saveSuccess');
			else {
				error = '';
				notice = i18n.t('elygate.saveSuccessRefreshFailed');
			}
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isSaving = false; }
	}

	async function inspectVersion(version: JsonRecord): Promise<void> {
		try {
			inspected = objectPayload(await requestJson(`/api/prompt-repo/versions/${encodeURIComponent(String(version.id))}`), 'version');
			draftMode = null;
		} catch (cause) { error = displayError(cause, i18n.t('elygate.loadFailed')); }
	}

	async function inspectSession(session: JsonRecord): Promise<void> {
		try {
			const detail = objectPayload(await requestJson(`/api/prompt-repo/sessions/${encodeURIComponent(String(session.id))}`), 'session');
			inspected = detail;
			openDraft('edit-session', detail);
		} catch (cause) { error = displayError(cause, i18n.t('elygate.loadFailed')); }
	}

	async function commitSession(session: JsonRecord): Promise<void> {
		error = '';
		notice = '';
		if (!promptSessionHasCommitMessages(session)) {
			error = i18n.t('elygate.promptSessionEmpty');
			return;
		}
		const commitMessage = window.prompt(i18n.t('elygate.commitMessage'))?.trim();
		if (!commitMessage) return;
		try {
			await requestJson(`/api/prompt-repo/sessions/${encodeURIComponent(String(session.id))}/commit`, { method: 'POST', body: JSON.stringify({ commit_message: commitMessage }) });
			if (await selectPrompt(selectedPrompt!)) notice = i18n.t('elygate.saveSuccess');
			else {
				error = '';
				notice = i18n.t('elygate.saveSuccessRefreshFailed');
			}
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
	}

	async function removeChild(kind: 'versions' | 'sessions', id: unknown): Promise<void> {
		if (!window.confirm(i18n.t('elygate.confirmDelete'))) return;
		try {
			await requestJson(`/api/prompt-repo/${kind}/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
			await selectPrompt(selectedPrompt!);
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
	}

	onMount(() => { void load(); });
</script>

<section class="page-shell">
	<header class="page-heading"><div><p class="eyebrow">Elygate / Repository</p><h1>{i18n.t('elygate.prompts')}</h1><p>{i18n.t('elygate.promptsHint')}</p></div><div><button type="button" onclick={() => void createFolder()}>{i18n.t('elygate.newFolder')}</button><button class="primary" type="button" onclick={() => void createPrompt()}>{i18n.t('elygate.newPrompt')}</button></div></header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<div class="workspace">
		<aside class="folders"><button type="button" class:is-active={!selectedFolderId} onclick={() => { selectedFolderId = ''; clearPrompt(); void load(); }}>{i18n.t('elygate.allPrompts')}</button>{#each folders as folder (String(folder.id))}<div><button type="button" class:is-active={selectedFolderId === String(folder.id)} onclick={() => { selectedFolderId = String(folder.id); clearPrompt(); void load(); }}><strong class="folder-name" title={String(folder.name)}>{String(folder.name)}</strong><span>{Number(folder.prompts_count ?? 0)}</span></button><button type="button" title={i18n.t('elygate.edit')} aria-label={`${i18n.t('elygate.edit')} ${String(folder.name)}`} onclick={() => void editFolder(folder)}>✎</button><button type="button" title={i18n.t('elygate.delete')} aria-label={`${i18n.t('elygate.delete')} ${String(folder.name)}`} onclick={() => void deleteFolder(folder)}>×</button></div>{/each}</aside>
		<aside class="prompts">{#each prompts as prompt (String(prompt.id))}<button type="button" class:is-active={selectedPrompt?.id === prompt.id} onclick={() => void selectPrompt(prompt)}><strong>{String(prompt.name)}</strong><span>{prompt.latest_version ? `v${String((prompt.latest_version as JsonRecord).version_number ?? '')}` : i18n.t('elygate.noVersions')}</span></button>{:else}<p>{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</p>{/each}</aside>
		<main class="detail">
			{#if selectedPrompt}
				<header><div><h2>{String(selectedPrompt.name)}</h2><p>{String(selectedPrompt.id)}</p></div><div><button type="button" onclick={() => void editPrompt()}>{i18n.t('elygate.edit')}</button><button class="danger" type="button" onclick={() => void deletePrompt()}>{i18n.t('elygate.delete')}</button></div></header>
				<div class="actions"><button class="primary" type="button" onclick={() => openDraft('version')}>{i18n.t('elygate.newVersion')}</button><button type="button" onclick={() => openDraft('session')}>{i18n.t('elygate.newSession')}</button></div>
				<div class="columns"><section><h3>{i18n.t('elygate.versionHistory')}</h3>{#each versions as version (String(version.id))}<div class="row"><button type="button" onclick={() => void inspectVersion(version)}><strong>v{String(version.version_number)}</strong><span>{String(version.commit_message ?? '')}</span></button><button type="button" onclick={() => void removeChild('versions', version.id)}>×</button></div>{:else}<p>{i18n.t('elygate.noVersions')}</p>{/each}</section><section><h3>{i18n.t('elygate.sessions')}</h3>{#each sessions as session (String(session.id))}<div class="row"><button type="button" onclick={() => void inspectSession(session)}><strong>{String(session.name || `#${session.id}`)}</strong><span>{String(session.provider ?? '')} / {String(session.model ?? '')}</span></button><button type="button" disabled={!promptSessionHasCommitMessages(session)} title={promptSessionHasCommitMessages(session) ? i18n.t('elygate.commit') : i18n.t('elygate.promptSessionEmpty')} onclick={() => void commitSession(session)}>✓</button><button type="button" onclick={() => void removeChild('sessions', session.id)}>×</button></div>{:else}<p>{i18n.t('elygate.noSessions')}</p>{/each}</section></div>
				{#if draftMode}<section class="editor"><h3>{i18n.t(draftMode === 'version' ? 'elygate.newVersion' : draftMode === 'session' ? 'elygate.newSession' : 'elygate.editSession')}</h3><textarea bind:value={draftJson} rows="20"></textarea><footer><button type="button" onclick={() => (draftMode = null)}>{i18n.t('elygate.cancel')}</button><button class="primary" type="button" onclick={() => void saveDraft()} disabled={isSaving}>{i18n.t('elygate.save')}</button></footer></section>{:else if inspected}<section class="editor"><h3>{i18n.t('elygate.inspect')}</h3><pre>{prettyJson(inspected)}</pre></section>{/if}
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
