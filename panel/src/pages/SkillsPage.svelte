<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, parseJsonArray, parseJsonObject, prettyJson } from '../lib/forms';
	import { getListPayload, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';

	interface Props { resourceName: string; }
	interface SkillForm { name: string; description: string; license: string; compatibility: string; allowedTools: string; version: string; skillBody: string; metadata: string; extraFrontmatter: string; files: string; serve: boolean; }

	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let skills = $state.raw<JsonRecord[]>([]);
	let versions = $state.raw<JsonRecord[]>([]);
	let selected = $state.raw<JsonRecord | null>(null);
	let form = $state<SkillForm>(emptyForm());
	let query = $state('');
	let globalVersion = $state('');
	let uploadPath = $state('');
	let pendingUpload = $state<File | undefined>();
	let uploadRevision = $state(0);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let isUploading = $state(false);
	let isActionBusy = $state(false);
	let error = $state('');
	let notice = $state('');
	let listLoadSeq = 0;
	let detailSeq = 0;
	let versionInspectSeq = 0;
	let actionSeq = 0;
	let mutationSeq = 0;

	function emptyForm(): SkillForm {
		return { name: '', description: '', license: '', compatibility: '', allowedTools: '', version: '0.1.0', skillBody: '', metadata: '{}', extraFrontmatter: '{}', files: '[]', serve: true };
	}

	function nextVersion(value: unknown): string {
		const match = String(value ?? '').match(/^(\d+)\.(\d+)\.(\d+)/);
		return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : '0.1.0';
	}

	function stringValue(record: JsonRecord, key: string): string {
		return typeof record[key] === 'string' ? String(record[key]) : '';
	}

	function objectPayload(payload: unknown, key: string): JsonRecord {
		return isJsonRecord(payload) && isJsonRecord(payload[key]) ? payload[key] : isJsonRecord(payload) ? payload : {};
	}

	function applySkill(skill: JsonRecord, createNextVersion = true): void {
		selected = skill;
		form = {
			name: stringValue(skill, 'name'),
			description: stringValue(skill, 'description'),
			license: stringValue(skill, 'license'),
			compatibility: stringValue(skill, 'compatibility'),
			allowedTools: stringValue(skill, 'allowed_tools'),
			version: createNextVersion ? nextVersion(skill.highest_version ?? skill.latest_version) : stringValue(skill, 'latest_version'),
			skillBody: stringValue(skill, 'skill_md_body'),
			metadata: prettyJson(skill.metadata, '{}'),
			extraFrontmatter: prettyJson(skill.extra_frontmatter, '{}'),
			files: prettyJson(skill.files, '[]'),
			serve: true,
		};
	}

	async function load(): Promise<void> {
		const sequence = ++listLoadSeq;
		const selectedId = selected?.id;
		const detailSequence = detailSeq;
		const mutationSequence = mutationSeq;
		isLoading = true;
		error = '';
		try {
			const params = new URLSearchParams({ limit: '100', search: query.trim() });
			const [skillsPayload, versionPayload] = await Promise.all([
				requestJson(`/api/skills?${params.toString()}`),
				requestJson<{ version?: string }>('/api/skills/all/version'),
			]);
			if (sequence !== listLoadSeq) return;
			skills = getListPayload(skillsPayload);
			globalVersion = versionPayload.version ?? '';
			if (selected && selected.id === selectedId && detailSeq === detailSequence && mutationSeq === mutationSequence && !isSaving && !isUploading && !isActionBusy) {
				const refreshed = skills.find((skill) => skill.id === selectedId);
				if (refreshed) await selectSkill(refreshed, { invalidateAction: false });
			}
		} catch (cause) {
			if (sequence === listLoadSeq) error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			if (sequence === listLoadSeq && detailSeq === detailSequence) isLoading = false;
		}
	}

	async function selectSkill(skill: JsonRecord, options: { invalidateAction?: boolean } = {}): Promise<void> {
		if (options.invalidateAction !== false) actionSeq += 1;
		versionInspectSeq += 1;
		const sequence = ++detailSeq;
		const mutationSequence = mutationSeq;
		selected = skill;
		isLoading = true;
		error = '';
		try {
			const id = encodeURIComponent(String(skill.id));
			const [detailPayload, versionsPayload] = await Promise.all([
				requestJson(`/api/skills/${id}`),
				requestJson(`/api/skills/${id}/versions?limit=100`),
			]);
			if (sequence !== detailSeq || mutationSequence !== mutationSeq) return;
			applySkill(objectPayload(detailPayload, 'skill'));
			versions = isJsonRecord(versionsPayload) && Array.isArray(versionsPayload.versions) ? versionsPayload.versions.filter(isJsonRecord) : [];
		} catch (cause) {
			if (sequence === detailSeq && mutationSequence === mutationSeq) error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			if (sequence === detailSeq) isLoading = false;
		}
	}

	function newSkill(): void {
		mutationSeq += 1;
		actionSeq += 1;
		detailSeq += 1;
		versionInspectSeq += 1;
		selected = null;
		versions = [];
		form = emptyForm();
		isLoading = false;
		error = '';
		notice = '';
	}

	async function save(): Promise<void> {
		if (isSaving) return;
		const saveActionSeq = actionSeq;
		const saveSelectedId = selected?.id;
		const saveMutationSeq = ++mutationSeq;
		isSaving = true;
		error = '';
		notice = '';
		try {
			if (!form.name.trim() || !form.description.trim() || !form.skillBody.trim() || !form.version.trim()) throw new Error(i18n.t('elygate.skillRequiredFields'));
			const invalid = i18n.t('elygate.invalidJson');
			const payload: JsonRecord = {
				description: form.description.trim(),
				license: form.license.trim() || null,
				compatibility: form.compatibility.trim() || null,
				allowed_tools: form.allowedTools.trim() || null,
				version: form.version.trim(),
				skill_md_body: form.skillBody,
				metadata: parseJsonObject(form.metadata, i18n.t('elygate.metadata'), invalid),
				extra_frontmatter: parseJsonObject(form.extraFrontmatter, i18n.t('elygate.extraFrontmatter'), invalid),
				files: parseJsonArray(form.files, i18n.t('elygate.files'), invalid),
				serve: form.serve,
			};
			let response: unknown;
			if (selected) {
				response = await requestJson(`/api/skills/${encodeURIComponent(String(selected.id))}`, { method: 'PUT', body: JSON.stringify(payload) });
			} else {
				response = await requestJson('/api/skills', { method: 'POST', body: JSON.stringify({ ...payload, name: form.name.trim() }) });
			}
			const saved = objectPayload(response, 'skill');
			const contextMatches = saveMutationSeq === mutationSeq && saveActionSeq === actionSeq && selected?.id === saveSelectedId;
			if (!contextMatches) return;
			applySkill(saved);
			notice = i18n.t('elygate.saveSuccess');
			await load();
		} catch (cause) {
			if (saveMutationSeq === mutationSeq && saveActionSeq === actionSeq && selected?.id === saveSelectedId) error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isSaving = false;
		}
	}

	async function uploadFile(): Promise<void> {
		const file = pendingUpload;
		if (!file) return;
		const uploadActionSeq = actionSeq;
		const uploadSelectedId = selected?.id;
		const uploadMutationSeq = ++mutationSeq;
		isUploading = true;
		error = '';
		try {
			const body = new FormData();
			body.append('file', file);
			body.append('path', uploadPath.trim() || file.name);
			const response = await fetch('/api/skills/files/upload', { method: 'POST', body, credentials: 'same-origin', headers: { Accept: 'application/json' } });
			const payload: unknown = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(isJsonRecord(payload) && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`);
			if (!isJsonRecord(payload)) throw new Error(i18n.t('elygate.operationFailed'));
			if (uploadMutationSeq !== mutationSeq || uploadActionSeq !== actionSeq || selected?.id !== uploadSelectedId) return;
			const files = parseJsonArray(form.files, i18n.t('elygate.files'), i18n.t('elygate.invalidJson'));
			files.push({ path: payload.path, source_type: 'upload', upload_id: payload.upload_id, storage_key: payload.storage_key, blob_id: payload.blob_id, mime_type: payload.mime_type });
			form.files = prettyJson(files, '[]');
			uploadPath = '';
			pendingUpload = undefined;
			uploadRevision += 1;
			notice = i18n.t('elygate.fileUploaded');
		} catch (cause) {
			if (uploadMutationSeq === mutationSeq && uploadActionSeq === actionSeq && selected?.id === uploadSelectedId) error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isUploading = false;
		}
	}

	async function shiftVersion(version: string): Promise<void> {
		if (!selected || isActionBusy || isSaving || isUploading || !window.confirm(i18n.t('elygate.confirmAction'))) return;
		const skillId = String(selected.id);
		isActionBusy = true;
		const sequence = ++actionSeq;
		const mutationSequence = ++mutationSeq;
		versionInspectSeq += 1;
		try {
			await requestJson(`/api/skills/${encodeURIComponent(skillId)}/shift-version`, { method: 'POST', body: JSON.stringify({ version }) });
			if (mutationSequence !== mutationSeq || sequence !== actionSeq || !selected || String(selected.id) !== skillId) return;
			notice = i18n.t('elygate.servingVersionChanged');
			await selectSkill(selected);
		} catch (cause) {
			if (mutationSequence === mutationSeq && sequence === actionSeq && selected && String(selected.id) === skillId) error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally { isActionBusy = false; }
	}

	async function inspectVersion(version: string): Promise<void> {
		if (!selected) return;
		const skillId = String(selected.id);
		const sequence = ++versionInspectSeq;
		try {
			const payload = await requestJson(`/api/skills/${encodeURIComponent(skillId)}?version=${encodeURIComponent(version)}`);
			if (sequence !== versionInspectSeq || !selected || String(selected.id) !== skillId) return;
			applySkill(objectPayload(payload, 'skill'));
			form.version = nextVersion(selected.highest_version ?? selected.latest_version);
		} catch (cause) {
			if (sequence === versionInspectSeq && selected && String(selected.id) === skillId) error = displayError(cause, i18n.t('elygate.loadFailed'));
		}
	}

	async function bumpGlobalVersion(bump: 'major' | 'minor' | 'patch'): Promise<void> {
		if (isActionBusy || isSaving || isUploading) return;
		isActionBusy = true;
		try {
			const payload = await requestJson<{ version: string }>('/api/skills/all/version', { method: 'PUT', body: JSON.stringify({ bump }) });
			globalVersion = payload.version;
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isActionBusy = false; }
	}

	async function cleanupOrphans(): Promise<void> {
		if (isActionBusy || isSaving || isUploading || !window.confirm(i18n.t('elygate.confirmAction'))) return;
		isActionBusy = true;
		try {
			const payload = await requestJson<JsonRecord>('/api/skills/files/orphans', { method: 'DELETE' });
			notice = typeof payload.message === 'string' ? payload.message : i18n.t('elygate.cleanupComplete');
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isActionBusy = false; }
	}

	async function removeSkill(): Promise<void> {
		if (!selected || isActionBusy || isSaving || isUploading || !window.confirm(i18n.t('elygate.confirmDelete'))) return;
		const skillId = String(selected.id);
		isActionBusy = true;
		const sequence = ++actionSeq;
		const mutationSequence = ++mutationSeq;
		versionInspectSeq += 1;
		try {
			await requestJson(`/api/skills/${encodeURIComponent(skillId)}`, { method: 'DELETE' });
			if (mutationSequence !== mutationSeq || sequence !== actionSeq || !selected || String(selected.id) !== skillId) return;
			newSkill();
			await load();
		} catch (cause) {
			if (mutationSequence === mutationSeq && sequence === actionSeq && selected && String(selected.id) === skillId) error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally { isActionBusy = false; }
	}

	onMount(() => { void load(); });
</script>

<section class="page-shell">
		<header class="page-heading"><div><p class="eyebrow">{getAppName()} / {i18n.t('elygate.integrations')}</p><h1>{i18n.t('elygate.skills')}</h1><p>{i18n.t('elygate.skillsHint')}</p></div><div class="heading-actions"><span>{i18n.t('elygate.marketplaceVersion')}: <strong>{globalVersion || '—'}</strong></span><button type="button" disabled={isActionBusy || isSaving || isUploading} onclick={() => void bumpGlobalVersion('patch')}>+ {i18n.locale === 'zh-CN' ? '补丁版本' : 'Patch'}</button><button type="button" disabled={isActionBusy || isSaving || isUploading} onclick={() => void cleanupOrphans()}>{i18n.t('elygate.cleanupFiles')}</button><button class="primary" type="button" disabled={isActionBusy || isSaving || isUploading} onclick={newSkill}>{i18n.t('elygate.create')}</button></div></header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<div class="workspace">
		<aside class="skill-list">
				<form onsubmit={(event) => { event.preventDefault(); void load(); }}><input bind:value={query} placeholder={i18n.t('elygate.search')} disabled={isSaving || isUploading || isActionBusy} /><button type="submit" disabled={isSaving || isUploading || isActionBusy}>{i18n.t('elygate.search')}</button></form>
				{#each skills as skill (String(skill.id))}<button type="button" disabled={isSaving || isUploading || isActionBusy} class:is-active={selected?.id === skill.id} onclick={() => void selectSkill(skill)}><strong>{String(skill.name)}</strong><span>v{String(skill.latest_version ?? '—')} · {Number(skill.file_count ?? 0)} {i18n.t('elygate.files')}</span></button>{:else}<p>{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</p>{/each}
		</aside>
		<main class="editor">
			<form onsubmit={(event) => { event.preventDefault(); void save(); }}>
				<div class="form-grid"><label>{i18n.t('elygate.name')}<input bind:value={form.name} disabled={!!selected || isSaving || isUploading || isActionBusy} /></label><label>{i18n.t('elygate.version')}<input bind:value={form.version} disabled={isSaving || isUploading || isActionBusy} /></label><label class="wide">{i18n.t('elygate.description')}<input bind:value={form.description} disabled={isSaving || isUploading || isActionBusy} /></label><label>{i18n.t('elygate.license')}<input bind:value={form.license} disabled={isSaving || isUploading || isActionBusy} /></label><label>{i18n.t('elygate.compatibility')}<input bind:value={form.compatibility} disabled={isSaving || isUploading || isActionBusy} /></label><label class="wide">{i18n.t('elygate.allowedTools')}<input bind:value={form.allowedTools} disabled={isSaving || isUploading || isActionBusy} /></label></div>
				<label>{i18n.t('elygate.skillMarkdown')}<textarea bind:value={form.skillBody} rows="16" disabled={isSaving || isUploading || isActionBusy}></textarea></label>
				<div class="json-grid"><label>{i18n.t('elygate.metadata')}<textarea bind:value={form.metadata} rows="8" disabled={isSaving || isUploading || isActionBusy}></textarea></label><label>{i18n.t('elygate.extraFrontmatter')}<textarea bind:value={form.extraFrontmatter} rows="8" disabled={isSaving || isUploading || isActionBusy}></textarea></label></div>
				<label>{i18n.t('elygate.files')} JSON<textarea bind:value={form.files} rows="9" disabled={isSaving || isUploading || isActionBusy}></textarea></label>
				<div class="upload-row">{#key uploadRevision}<input type="file" disabled={isSaving || isUploading || isActionBusy} onchange={(event) => (pendingUpload = event.currentTarget.files?.[0])} />{/key}<input bind:value={uploadPath} placeholder={i18n.t('elygate.filePath')} disabled={isSaving || isUploading || isActionBusy} /><button type="button" onclick={() => void uploadFile()} disabled={isUploading || isSaving || isActionBusy}>{i18n.t('elygate.upload')}</button></div>
				<footer><label class="serve"><input type="checkbox" bind:checked={form.serve} disabled={isSaving || isUploading || isActionBusy} />{i18n.t('elygate.serveVersion')}</label>{#if selected}<button class="danger" type="button" disabled={isSaving || isUploading || isActionBusy} onclick={() => void removeSkill()}>{i18n.t('elygate.delete')}</button>{/if}<button class="primary" type="submit" disabled={isSaving || isUploading || isActionBusy}>{isSaving ? i18n.t('elygate.saving') : i18n.t('elygate.save')}</button></footer>
			</form>
				{#if selected}<section class="versions"><h2>{i18n.t('elygate.versionHistory')}</h2>{#each versions as version (String(version.id))}<div><span><strong>v{String(version.version)}</strong><small>{new Date(String(version.created_at)).toLocaleString(i18n.locale)}</small></span><button type="button" disabled={isSaving || isUploading || isActionBusy} onclick={() => void inspectVersion(String(version.version))}>{i18n.t('elygate.inspect')}</button>{#if version.version !== selected.latest_version}<button type="button" disabled={isSaving || isUploading || isActionBusy} onclick={() => void shiftVersion(String(version.version))}>{i18n.t('elygate.serve')}</button>{/if}</div>{:else}<p>{i18n.t('elygate.empty')}</p>{/each}</section>{/if}
		</main>
	</div>
</section>

<style>
	.page-shell { max-width: 1320px; margin: 0 auto; padding: 1.5rem; }
	.page-heading, .heading-actions, footer, .upload-row, .versions > div { align-items: center; display: flex; gap: .5rem; }
	.page-heading { align-items: start; justify-content: space-between; margin-bottom: 1rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .4rem; text-transform: uppercase; }
	h1 { margin: 0; } .page-heading p { color: var(--muted-foreground); margin: .5rem 0 0; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); cursor: pointer; font-weight: 650; padding: .5rem .65rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); } button.danger { color: var(--destructive); }
	.workspace { display: grid; gap: 1rem; grid-template-columns: 270px minmax(0, 1fr); }
	.skill-list, .editor, .versions { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; padding: .8rem; }
	.skill-list form { display: flex; gap: .35rem; margin-bottom: .6rem; }
	.skill-list input { min-width: 0; width: 100%; }
	.skill-list > button { display: grid; margin: .35rem 0; text-align: left; width: 100%; }
	.skill-list > button.is-active { border-color: var(--primary); }
	.skill-list span, small { color: var(--muted-foreground); font-size: .72rem; margin-top: .2rem; }
	.editor form, label { display: grid; gap: .4rem; }
	.editor form { gap: .8rem; }
	.form-grid, .json-grid { display: grid; gap: .7rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-grid .wide { grid-column: 1 / -1; }
	label { font-size: .8rem; font-weight: 650; }
	input, textarea { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); padding: .6rem; }
	textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
	.upload-row input:first-child { flex: 1; }
	.upload-row input:nth-child(2) { flex: 1; }
	footer { justify-content: flex-end; }
	.serve { align-items: center; display: flex; margin-right: auto; }
	.versions { margin-top: .8rem; }
	.versions h2 { font-size: 1rem; margin: 0 0 .5rem; }
	.versions > div { border-top: 1px solid var(--border); padding: .55rem 0; }
	.versions > div > span { display: grid; margin-right: auto; }
	.notice { border-radius: .65rem; margin-bottom: .8rem; padding: .7rem .85rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 12%, transparent); color: var(--primary); }
	@media (max-width: 820px) { .page-heading { flex-direction: column; } .workspace { grid-template-columns: 1fr; } .skill-list { max-height: 300px; overflow: auto; } }
	@media (max-width: 560px) { .form-grid, .json-grid { grid-template-columns: 1fr; } .form-grid .wide { grid-column: auto; } .upload-row { align-items: stretch; flex-direction: column; } }
</style>
