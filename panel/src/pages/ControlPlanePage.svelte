<script lang="ts">
	import { onMount } from 'svelte';
	import { requestJson, getListPayload, isJsonRecord, type JsonRecord } from '../lib/api';

	interface Props { resourceName?: string; }
	let { resourceName = 'control-plane-projects' }: Props = $props();
	let projects = $state<JsonRecord[]>([]);
	let applications = $state<JsonRecord[]>([]);
	let keys = $state<JsonRecord[]>([]);
	let auditEvents = $state<JsonRecord[]>([]);
	let usageStatus = $state<JsonRecord | null>(null);
	let usage = $state<JsonRecord[]>([]);
	let usageTotal = $state(0);
	let usageOffset = $state(0);
	const usagePageSize = 100;
	let selectedProject = $state('');
	let selectedApplication = $state('');
	let projectName = $state('');
	let applicationName = $state('');
	let virtualKeyId = $state('');
	let keyName = $state('');
	let disclosedKey = $state('');
	let loading = $state(false);
	let saving = $state(false);
	let error = $state('');
	let notice = $state('');
	let projectLoadSeq = 0;
	let keyLoadSeq = 0;
	let disclosureSeq = 0;

	const isProjects = $derived(resourceName === 'control-plane-projects');
	const isApplications = $derived(resourceName === 'control-plane-applications');

	function text(zh: string, en: string): string { return typeof document !== 'undefined' && document.documentElement.lang === 'en' ? en : zh; }
	function idOf(row: JsonRecord): string { return String(row.id ?? row.virtual_key_id ?? row.source_log_id ?? ''); }
	function nameOf(row: JsonRecord): string { return String(row.name ?? row.id ?? ''); }
	function hideDisclosure(): void { disclosureSeq += 1; disclosedKey = ''; }
	function showDisclosure(value: string, message: string): void {
		const sequence = ++disclosureSeq;
		disclosedKey = value;
		notice = message;
		window.setTimeout(() => { if (sequence === disclosureSeq) disclosedKey = ''; }, 10000);
	}

	async function loadProjects(): Promise<void> {
		const payload = await requestJson<unknown>('/api/control-plane/projects');
		projects = getListPayload(payload);
		if (!selectedProject && projects[0]) selectedProject = idOf(projects[0]);
	}
	async function loadApplications(): Promise<void> {
		if (!selectedProject) { applications = []; selectedApplication = ''; keys = []; return; }
		const projectID = selectedProject;
		const sequence = ++projectLoadSeq;
		const payload = await requestJson<unknown>(`/api/control-plane/projects/${encodeURIComponent(projectID)}/applications`);
		if (sequence !== projectLoadSeq || selectedProject !== projectID) return;
		applications = getListPayload(payload);
		if (!selectedApplication && applications[0]) selectedApplication = idOf(applications[0]);
		if (selectedApplication && !applications.some((row) => idOf(row) === selectedApplication)) selectedApplication = applications[0] ? idOf(applications[0]) : '';
		await loadKeys();
	}
	async function loadKeys(): Promise<void> {
		if (!selectedApplication) { keys = []; return; }
		const applicationID = selectedApplication;
		const sequence = ++keyLoadSeq;
		const payload = await requestJson<unknown>(`/api/control-plane/applications/${encodeURIComponent(applicationID)}/keys`);
		if (sequence !== keyLoadSeq || selectedApplication !== applicationID) return;
		keys = getListPayload(payload);
	}
	async function loadUsage(): Promise<void> {
		const payload = await requestJson<unknown>(`/api/control-plane/usage?limit=${usagePageSize}&offset=${usageOffset}`);
		usage = getListPayload(payload);
		if (isJsonRecord(payload) && isJsonRecord(payload.pagination)) usageTotal = Number(payload.pagination.total ?? 0);
		usageStatus = await requestJson<JsonRecord>('/api/control-plane/usage/status');
		auditEvents = getListPayload(await requestJson<unknown>('/api/control-plane/audit-events?limit=50'));
	}
	async function load(): Promise<void> {
		loading = true; error = '';
		try { await loadProjects(); await loadApplications(); if (resourceName === 'control-plane-usage') await loadUsage(); }
		catch (cause) { error = cause instanceof Error ? cause.message : text('加载失败', 'Load failed'); }
		finally { loading = false; }
	}

	function selectProjectAndReload(value: string): void {
		selectedProject = value;
		selectedApplication = '';
		applications = [];
		keys = []; hideDisclosure();
		void loadApplications().catch((cause) => { error = cause instanceof Error ? cause.message : text('加载应用失败', 'Failed to load applications'); });
	}
	function selectApplicationAndReload(value: string): void {
		selectedApplication = value;
		hideDisclosure();
		void loadKeys().catch((cause) => { error = cause instanceof Error ? cause.message : text('加载密钥失败', 'Failed to load keys'); });
	}

	async function createProject(): Promise<void> {
		if (!projectName.trim()) return;
		saving = true; error = ''; notice = '';
		try {
			await requestJson('/api/control-plane/projects', { method: 'POST', body: JSON.stringify({ name: projectName.trim() }) });
			projectName = ''; notice = text('项目已创建', 'Project created'); await load();
		} catch (cause) { error = cause instanceof Error ? cause.message : text('创建项目失败', 'Failed to create project'); }
		finally { saving = false; }
	}
	async function createApplication(): Promise<void> {
		if (!selectedProject || !applicationName.trim()) return;
		saving = true; error = ''; notice = '';
		try {
			await requestJson(`/api/control-plane/projects/${encodeURIComponent(selectedProject)}/applications`, { method: 'POST', body: JSON.stringify({ name: applicationName.trim(), environment: 'production' }) });
			applicationName = ''; notice = text('应用已创建', 'Application created'); await load();
		} catch (cause) { error = cause instanceof Error ? cause.message : text('创建应用失败', 'Failed to create application'); }
		finally { saving = false; }
	}
	async function bindKey(): Promise<void> {
		if (!selectedApplication || !virtualKeyId.trim()) return;
		if (!window.confirm(text('绑定此虚拟密钥？如果它已绑定其他应用，旧绑定会被撤销。', 'Bind this virtual key? Any active binding on another application will be revoked.'))) return;
		saving = true; error = ''; notice = '';
		try {
			await requestJson(`/api/control-plane/applications/${encodeURIComponent(selectedApplication)}/virtual-key-binding`, { method: 'POST', body: JSON.stringify({ virtual_key_id: virtualKeyId.trim() }) });
			virtualKeyId = ''; notice = text('密钥已绑定', 'Key bound'); await load();
		} catch (cause) { error = cause instanceof Error ? cause.message : text('绑定密钥失败', 'Failed to bind key'); }
		finally { saving = false; }
	}
	async function createKey(): Promise<void> {
		if (!selectedApplication || !keyName.trim()) return;
		saving = true; error = ''; notice = ''; disclosedKey = '';
		try {
			const created = await requestJson<JsonRecord>(`/api/control-plane/applications/${encodeURIComponent(selectedApplication)}/keys`, { method: 'POST', body: JSON.stringify({ name: keyName.trim() }) });
			keyName = ''; showDisclosure(String(created.value ?? ''), text('密钥已创建，请立即复制保存（10 秒后隐藏）。', 'Key created. Copy it now; it will be hidden after 10 seconds.')); await loadKeys();
		} catch (cause) { error = cause instanceof Error ? cause.message : text('创建密钥失败', 'Failed to create key'); }
		finally { saving = false; }
	}
	async function rotateKey(row: JsonRecord): Promise<void> {
		const id = String(row.virtual_key_id ?? '');
		if (!id || !selectedApplication || !window.confirm(text('轮换此密钥？旧值会立即失效。', 'Rotate this key? The old value will become invalid immediately.'))) return;
		saving = true; error = ''; notice = ''; disclosedKey = '';
		try {
			const rotated = await requestJson<JsonRecord>(`/api/control-plane/applications/${encodeURIComponent(selectedApplication)}/keys/${encodeURIComponent(id)}/rotate`, { method: 'POST' });
			showDisclosure(String(rotated.value ?? ''), text('密钥已轮换，请立即复制新值（10 秒后隐藏）。', 'Key rotated. Copy the new value now; it will be hidden after 10 seconds.')); await loadKeys();
		} catch (cause) { error = cause instanceof Error ? cause.message : text('轮换密钥失败', 'Failed to rotate key'); }
		finally { saving = false; }
	}
	async function revokeKey(row: JsonRecord): Promise<void> {
		const id = String(row.virtual_key_id ?? '');
		if (!id || !selectedApplication || !window.confirm(text('撤销此密钥？此操作不可恢复。', 'Revoke this key? This cannot be undone.'))) return;
		saving = true; error = ''; notice = '';
		try {
			await requestJson(`/api/control-plane/applications/${encodeURIComponent(selectedApplication)}/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
			notice = text('密钥已撤销', 'Key revoked'); await loadKeys();
		} catch (cause) { error = cause instanceof Error ? cause.message : text('撤销密钥失败', 'Failed to revoke key'); }
		finally { saving = false; }
	}
	async function revokeBinding(): Promise<void> {
		if (!selectedApplication || !window.confirm(text('撤销当前应用绑定？', 'Revoke this application binding?'))) return;
		saving = true; error = ''; notice = '';
		try {
			await requestJson(`/api/control-plane/applications/${encodeURIComponent(selectedApplication)}/virtual-key-binding`, { method: 'DELETE' });
			notice = text('应用绑定已撤销', 'Application binding revoked'); await loadKeys();
		} catch (cause) { error = cause instanceof Error ? cause.message : text('撤销绑定失败', 'Failed to revoke binding'); }
		finally { saving = false; }
	}
	async function exportUsage(): Promise<void> {
		saving = true; error = '';
		try {
			const response = await fetch('/api/control-plane/usage/export', { credentials: 'include' });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'elygate-usage.csv'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
		} catch (cause) { error = cause instanceof Error ? cause.message : text('导出失败', 'Export failed'); }
		finally { saving = false; }
	}
	async function copyDisclosedKey(): Promise<void> {
		if (!disclosedKey) return;
		try {
			await navigator.clipboard.writeText(disclosedKey);
			notice = text('一次性密钥已复制。', 'One-time key copied.');
		} catch {
			error = text('无法访问剪贴板，请手动复制。', 'Clipboard unavailable; copy manually.');
		}
	}
	function changeUsagePage(delta: number): void {
		const next = Math.max(0, usageOffset + delta * usagePageSize);
		if (next === usageOffset || (next >= usageTotal && usageTotal > 0)) return;
		usageOffset = next;
		void loadUsage().catch((cause) => { error = cause instanceof Error ? cause.message : text('加载账本失败', 'Failed to load usage'); });
	}

	onMount(() => { void load(); });
</script>

<main class="page-shell">
	<header class="page-heading"><div><p class="eyebrow">Elygate / {text('企业控制面', 'Enterprise control plane')}</p><h1>{isProjects ? text('项目', 'Projects') : isApplications ? text('应用', 'Applications') : text('Usage Ledger', 'Usage Ledger')}</h1><p>{text('以项目和应用为边界管理模型调用归属与成本。', 'Manage model ownership and cost by project and application.')}</p></div><button type="button" onclick={() => void load()} disabled={loading || saving}>{text('刷新', 'Refresh')}</button></header>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if notice}<p class="notice" role="status">{notice}</p>{/if}
	{#if isProjects}
		<section class="toolbar"><input bind:value={projectName} placeholder={text('项目名称', 'Project name')} /><button class="primary" type="button" onclick={() => void createProject()} disabled={loading || saving || !projectName.trim()}>{text('创建项目', 'Create project')}</button></section>
		<div class="table-wrap"><table><thead><tr><th>{text('名称', 'Name')}</th><th>{text('状态', 'Status')}</th><th>ID</th></tr></thead><tbody>{#each projects as project (idOf(project))}<tr><td>{nameOf(project)}</td><td>{String(project.status ?? 'active')}</td><td><code>{idOf(project)}</code></td></tr>{:else}<tr><td colspan="3">{text('暂无项目', 'No projects')}</td></tr>{/each}</tbody></table></div>
	{:else if isApplications}
		<section class="toolbar"><select bind:value={selectedProject} onchange={(event) => selectProjectAndReload((event.currentTarget as HTMLSelectElement).value)}><option value="">{text('选择项目', 'Select project')}</option>{#each projects as project (idOf(project))}<option value={idOf(project)}>{nameOf(project)}</option>{/each}</select><input bind:value={applicationName} placeholder={text('应用名称', 'Application name')} /><button class="primary" type="button" onclick={() => void createApplication()} disabled={loading || saving || !selectedProject || !applicationName.trim()}>{text('创建应用', 'Create application')}</button></section>
		<section class="toolbar"><select bind:value={selectedApplication} onchange={(event) => selectApplicationAndReload((event.currentTarget as HTMLSelectElement).value)}><option value="">{text('选择应用', 'Select application')}</option>{#each applications as application (idOf(application))}<option value={idOf(application)}>{nameOf(application)}</option>{/each}</select><input bind:value={virtualKeyId} placeholder="Virtual Key ID" /><button type="button" onclick={() => void bindKey()} disabled={loading || saving || !selectedApplication || !virtualKeyId.trim()}>{text('绑定密钥', 'Bind key')}</button><button type="button" onclick={() => void revokeBinding()} disabled={loading || saving || !selectedApplication}>{text('撤销绑定', 'Revoke binding')}</button></section>
		<section class="toolbar"><input bind:value={keyName} placeholder={text('新密钥名称', 'New key name')} /><button class="primary" type="button" onclick={() => void createKey()} disabled={loading || saving || !selectedApplication || !keyName.trim()}>{text('创建应用密钥', 'Create app key')}</button></section>
		{#if disclosedKey}<p class="notice"><strong>{text('请复制一次性密钥：', 'Copy this one-time key:')}</strong> <code>{disclosedKey}</code> <button type="button" onclick={() => void copyDisclosedKey()}>{text('复制', 'Copy')}</button></p>{/if}
		<div class="table-wrap"><table><thead><tr><th>{text('名称', 'Name')}</th><th>{text('环境', 'Environment')}</th><th>{text('状态', 'Status')}</th></tr></thead><tbody>{#each applications as application (idOf(application))}<tr><td>{nameOf(application)}</td><td>{String(application.environment ?? 'production')}</td><td>{String(application.status ?? 'active')}</td></tr>{:else}<tr><td colspan="3">{text('暂无应用', 'No applications')}</td></tr>{/each}</tbody></table></div>
		{#if selectedApplication}<div class="table-wrap"><table><thead><tr><th>Virtual Key</th><th>{text('创建时间', 'Created')}</th><th>{text('状态', 'Status')}</th><th>{text('操作', 'Actions')}</th></tr></thead><tbody>{#each keys as key (idOf(key))}<tr><td><code>{String(key.virtual_key_id ?? '')}</code></td><td>{String(key.created_at ?? '')}</td><td>{key.revoked_at ? text('已撤销', 'Revoked') : text('有效', 'Active')}</td><td><button type="button" onclick={() => void rotateKey(key)} disabled={saving || !!key.revoked_at}>{text('轮换', 'Rotate')}</button><button type="button" onclick={() => void revokeKey(key)} disabled={saving || !!key.revoked_at}>{text('撤销', 'Revoke')}</button></td></tr>{:else}<tr><td colspan="4">{text('暂无应用密钥', 'No application keys')}</td></tr>{/each}</tbody></table></div>{/if}
	{:else}
		<section class="toolbar"><button class="primary" type="button" onclick={() => void exportUsage()} disabled={saving}>{text('导出 CSV', 'Export CSV')}</button>{#if usageStatus}<span>{text('水位：', 'Watermark:')}{String(usageStatus.watermark ?? text('未同步', 'Not synced'))} · {text('延迟：', 'Lag:')}{String(usageStatus.lag_seconds ?? 0)}s</span>{/if}</section>
		<div class="table-wrap"><table><thead><tr><th>{text('时间', 'Time')}</th><th>{text('项目', 'Project')}</th><th>{text('应用', 'Application')}</th><th>{text('模型', 'Model')}</th><th>{text('Tokens', 'Tokens')}</th><th>{text('成本', 'Cost')}</th></tr></thead><tbody>{#each usage as row (idOf(row))}<tr><td>{String(row.occurred_at ?? '')}</td><td><code>{String(row.project_id ?? '')}</code></td><td><code>{String(row.application_id ?? '')}</code></td><td>{String(row.model ?? '')}</td><td>{String(row.total_tokens ?? 0)}</td><td>${Number(row.cost ?? 0).toFixed(6)}</td></tr>{:else}<tr><td colspan="6">{text('暂无账本数据', 'No ledger entries')}</td></tr>{/each}</tbody></table></div>
		<div class="toolbar pagination"><span>{usageTotal ? `${usageOffset + 1}-${Math.min(usageOffset + usage.length, usageTotal)} / ${usageTotal}` : text('暂无账本数据', 'No ledger entries')}</span><button type="button" onclick={() => changeUsagePage(-1)} disabled={saving || loading || usageOffset === 0}>{text('上一页', 'Previous')}</button><button type="button" onclick={() => changeUsagePage(1)} disabled={saving || loading || usageOffset + usage.length >= usageTotal}>{text('下一页', 'Next')}</button></div>
		<div class="table-wrap"><table><thead><tr><th>{text('审计动作', 'Action')}</th><th>{text('资源', 'Resource')}</th><th>{text('操作者', 'Actor')}</th><th>{text('时间', 'Time')}</th></tr></thead><tbody>{#each auditEvents as event (idOf(event))}<tr><td>{String(event.action ?? '')}</td><td>{String(event.resource_type ?? '')} <code>{String(event.resource_id ?? '')}</code></td><td>{String(event.actor_id ?? '')}</td><td>{String(event.created_at ?? '')}</td></tr>{:else}<tr><td colspan="4">{text('暂无审计事件', 'No audit events')}</td></tr>{/each}</tbody></table></div>
	{/if}
</main>

<style>
	.page-shell { display: grid; gap: 1rem; padding: 1.25rem; }
	.page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
	.page-heading h1 { margin: .15rem 0; }
	.eyebrow { color: var(--muted-foreground); font-size: .8rem; margin: 0; }
	.page-heading p { color: var(--muted-foreground); margin: .35rem 0 0; }
	.toolbar { align-items: center; display: flex; flex-wrap: wrap; gap: .6rem; }
	input, select, button { min-height: 2.35rem; padding: .45rem .7rem; }
	input, select { border: 1px solid var(--border); border-radius: .35rem; background: var(--background); color: var(--foreground); }
	button { border: 1px solid var(--border); border-radius: .35rem; background: var(--background); cursor: pointer; }
	button.primary { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
	.table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: .4rem; }
	table { border-collapse: collapse; min-width: 720px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); padding: .7rem .8rem; text-align: left; }
	th { color: var(--muted-foreground); font-size: .78rem; font-weight: 600; }
	.error { color: var(--destructive); }
	.notice { color: var(--primary); }
	code { font-size: .78rem; }
</style>
