<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getAppName } from '../lib/branding';
	import { displayError } from '../lib/forms';
	import { formatUsdCost } from '../lib/display-format';
	import { encodePathSegment, getListPayload, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';

	interface Props { resourceName: string; }
	interface ControlPlaneTab {
		id: string;
		label: string;
		columns: { key: string; label: string }[];
	}
	interface ProjectRow { id: string; name: string; organization_id: string; status: string; }
	interface ApplicationRow { id: string; project_id: string; name: string; environment: string; status: string; }
	interface BindingRow { id: string; virtual_key_id: string; application_id: string; expires_at?: string; revoked_at?: string; created_at?: string; }
	interface CreatedKey { virtual_key_id?: string; value?: string; name?: string; }
	interface UsageStatus { watermark?: string; lag_seconds?: number; last_reconciled_at?: string; }
	interface UsageRequestSnapshot {
		offset: number;
		project: string;
		application: string;
		start: string;
		end: string;
		session: string;
		parentSession: string;
		agent: string;
		subagent: boolean;
	}

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	const appName = getAppName();

	const tabs: ControlPlaneTab[] = [
		{
			id: 'control-plane-projects',
			label: 'Projects',
			columns: [
				{ key: 'name', label: 'Name' },
				{ key: 'organization_id', label: 'Organization' },
				{ key: 'status', label: 'Status' },
			],
		},
		{
			id: 'control-plane-applications',
			label: 'Applications',
			columns: [
				{ key: 'name', label: 'Name' },
				{ key: 'environment', label: 'Environment' },
				{ key: 'status', label: 'Status' },
			],
		},
		{
			id: 'control-plane-usage',
			label: 'Usage',
			columns: [
				{ key: 'occurred_at', label: 'Time' },
				{ key: 'application_id', label: 'Application' },
				{ key: 'provider', label: 'Provider' },
				{ key: 'model', label: 'Model' },
				{ key: 'status', label: 'Status' },
				{ key: 'total_tokens', label: 'Tokens' },
				{ key: 'cost', label: 'Cost' },
			],
		},
	];

	const activeTab = $derived(tabs.find((tab) => tab.id === resourceName) ?? tabs[0]);

	function text(zh: string, en: string): string {
		return i18n.locale === 'zh-CN' ? zh : en;
	}

	function readTotal(payload: unknown, fallback: number): number {
		if (isJsonRecord(payload) && isJsonRecord(payload.pagination)) {
			return getTotal(payload.pagination, fallback);
		}
		return getTotal(payload, fallback);
	}

	function formatDate(value: unknown): string {
		if (!value) return '—';
		const date = new Date(String(value));
		return Number.isNaN(date.getTime())
			? String(value)
			: new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
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

	// ---------------------------------------------------------------------
	// Projects and applications
	// ---------------------------------------------------------------------
	let projects = $state.raw<ProjectRow[]>([]);
	let applications = $state.raw<ApplicationRow[]>([]);
	let bindings = $state.raw<BindingRow[]>([]);
	let selectedProject = $state('');
	let selectedApplication = $state('');
	let organizationId = $state('');
	let projectName = $state('');
	let applicationName = $state('');
	let applicationEnvironment = $state('production');
	let keyName = $state('');
	let virtualKeyId = $state('');
	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let notice = $state('');
	let revealedKey = $state<CreatedKey | null>(null);
	let projectLoadSeq = 0;
	let keyLoadSeq = 0;
	let disclosureSeq = 0;
	let disclosedApplication = $state('');

	function handleError(cause: unknown, fallback: string): void {
		error = displayError(cause, fallback);
	}

	async function loadProjects(): Promise<void> {
		loading = true;
		error = '';
		try {
			const payload = await requestJson<unknown>('/api/control-plane/projects');
			projects = getListPayload(payload).map((row) => ({
				id: String(row.id ?? ''),
				name: String(row.name ?? ''),
				organization_id: String(row.organization_id ?? ''),
				status: String(row.status ?? ''),
			})).filter((row) => row.id !== '');
			if (!selectedProject && projects.length > 0) {
				selectedProject = projects[0].id;
			}
			if (selectedProject) {
				await loadApplications();
			}
		} catch (cause) {
			handleError(cause, text('加载项目失败', 'Failed to load projects'));
			projects = [];
		} finally {
			loading = false;
		}
	}

	async function loadApplications(): Promise<void> {
		const sequence = ++projectLoadSeq;
		const requestedProject = selectedProject;
		applications = [];
		bindings = [];
		if (!requestedProject) return;
		try {
			const payload = await requestJson<unknown>(`/api/control-plane/projects/${encodePathSegment(requestedProject)}/applications`);
			if (sequence !== projectLoadSeq || selectedProject !== requestedProject) return;
			applications = getListPayload(payload).map((row) => ({
				id: String(row.id ?? ''),
				project_id: String(row.project_id ?? requestedProject),
				name: String(row.name ?? ''),
				environment: String(row.environment ?? ''),
				status: String(row.status ?? ''),
			})).filter((row) => row.id !== '');
			if (!applications.some((application) => application.id === selectedApplication)) {
				selectedApplication = '';
				bindings = [];
			}
		} catch (cause) {
			if (sequence === projectLoadSeq && selectedProject === requestedProject) throw cause;
		}
	}

	async function loadBindings(): Promise<void> {
		const sequence = ++keyLoadSeq;
		const requestedApplication = selectedApplication;
		bindings = [];
		if (!requestedApplication) return;
		try {
			const payload = await requestJson<unknown>(`/api/control-plane/applications/${encodePathSegment(requestedApplication)}/keys`);
			if (sequence !== keyLoadSeq || selectedApplication !== requestedApplication) return;
			bindings = getListPayload(payload).map((row) => ({
				id: String(row.id ?? ''),
				virtual_key_id: String(row.virtual_key_id ?? ''),
				application_id: String(row.application_id ?? requestedApplication),
				expires_at: row.expires_at ? String(row.expires_at) : undefined,
				revoked_at: row.revoked_at ? String(row.revoked_at) : undefined,
				created_at: row.created_at ? String(row.created_at) : undefined,
			})).filter((row) => row.virtual_key_id !== '');
		} catch (cause) {
			if (sequence === keyLoadSeq && selectedApplication === requestedApplication) throw cause;
		}
	}

	function selectProject(projectID: string): void {
		selectedProject = projectID;
		selectedApplication = '';
		applications = [];
		bindings = [];
		void loadApplications().catch((cause) => handleError(cause, text('加载应用失败', 'Failed to load applications')));
	}

	function selectApplication(applicationID: string): void {
		selectedApplication = applicationID;
		bindings = [];
		virtualKeyId = '';
		revealedKey = null;
		hideDisclosure();
		void loadBindings().catch((cause) => handleError(cause, text('加载应用密钥失败', 'Failed to load application keys')));
	}

	function showDisclosure(applicationID: string): void {
		const sequence = ++disclosureSeq;
		disclosedApplication = applicationID;
		window.setTimeout(() => {
			if (sequence === disclosureSeq) hideDisclosure();
		}, 12_000);
	}

	function hideDisclosure(): void {
		disclosureSeq += 1;
		disclosedApplication = '';
	}

	async function createProject(): Promise<void> {
		saving = true;
		error = '';
		notice = '';
		try {
			const created = await requestJson<JsonRecord>('/api/control-plane/projects', {
				method: 'POST',
				body: JSON.stringify({ organization_id: organizationId.trim(), name: projectName.trim() }),
			});
			projectName = '';
			notice = text('项目已创建', 'Project created');
			await loadProjects();
			if (typeof created.id === 'string') {
				selectProject(created.id);
			}
		} catch (cause) {
			handleError(cause, text('创建项目失败', 'Failed to create project'));
		} finally {
			saving = false;
		}
	}

	async function createApplication(): Promise<void> {
		saving = true;
		error = '';
		notice = '';
		try {
			await requestJson<JsonRecord>(`/api/control-plane/projects/${encodePathSegment(selectedProject)}/applications`, {
				method: 'POST',
				body: JSON.stringify({ name: applicationName.trim(), environment: applicationEnvironment.trim() || 'production' }),
			});
			applicationName = '';
			notice = text('应用已创建', 'Application created');
			await loadApplications();
		} catch (cause) {
			handleError(cause, text('创建应用失败', 'Failed to create application'));
		} finally {
			saving = false;
		}
	}

	async function createApplicationKey(): Promise<void> {
		saving = true;
		error = '';
		notice = '';
		try {
			const created = await requestJson<CreatedKey>(`/api/control-plane/applications/${encodePathSegment(selectedApplication)}/keys`, {
				method: 'POST',
				body: JSON.stringify({ name: keyName.trim() }),
			});
			keyName = '';
			revealedKey = created;
			showDisclosure(selectedApplication);
			notice = text('应用密钥已创建，请立即保存', 'Application key created; save it now');
			await loadBindings();
		} catch (cause) {
			handleError(cause, text('创建应用密钥失败', 'Failed to create application key'));
		} finally {
			saving = false;
		}
	}

	async function bindVirtualKey(): Promise<void> {
		saving = true;
		error = '';
		notice = '';
		try {
			await requestJson<JsonRecord>(`/api/control-plane/applications/${encodePathSegment(selectedApplication)}/virtual-key-binding`, {
				method: 'POST',
				body: JSON.stringify({ virtual_key_id: virtualKeyId.trim() }),
			});
			virtualKeyId = '';
			notice = text('虚拟密钥已绑定', 'Virtual key bound');
			await loadBindings();
		} catch (cause) {
			handleError(cause, text('绑定虚拟密钥失败', 'Failed to bind virtual key'));
		} finally {
			saving = false;
		}
	}

	async function rotateBinding(binding: BindingRow): Promise<void> {
		saving = true;
		error = '';
		notice = '';
		try {
			const rotated = await requestJson<CreatedKey>(`/api/control-plane/applications/${encodePathSegment(binding.application_id)}/keys/${encodePathSegment(binding.virtual_key_id)}/rotate`, { method: 'POST' });
			revealedKey = rotated;
			showDisclosure(binding.application_id);
			notice = text('密钥已轮换，请立即保存新值', 'Key rotated; save the new value now');
			await loadBindings();
		} catch (cause) {
			handleError(cause, text('轮换密钥失败', 'Failed to rotate key'));
		} finally {
			saving = false;
		}
	}

	async function revokeBinding(binding: BindingRow): Promise<void> {
		if (!window.confirm(text('撤销后该密钥立即失效，是否继续？', 'Revoking invalidates this key immediately. Continue?'))) return;
		saving = true;
		error = '';
		notice = '';
		try {
			await requestJson<unknown>(`/api/control-plane/applications/${encodePathSegment(binding.application_id)}/keys/${encodePathSegment(binding.virtual_key_id)}`, { method: 'DELETE' });
			notice = text('密钥已撤销', 'Key revoked');
			await loadBindings();
		} catch (cause) {
			handleError(cause, text('撤销密钥失败', 'Failed to revoke key'));
		} finally {
			saving = false;
		}
	}

	// ---------------------------------------------------------------------
	// Usage ledger
	// ---------------------------------------------------------------------
	let usageRows = $state.raw<JsonRecord[]>([]);
	let auditEvents = $state.raw<JsonRecord[]>([]);
	let usageStatus = $state<UsageStatus | null>(null);
	let usageProjectFilter = $state('');
	let usageApplicationFilter = $state('');
	let usageStartFilter = $state('');
	let usageEndFilter = $state('');
	let usageSessionFilter = $state('');
	let usageParentSessionFilter = $state('');
	let usageAgentFilter = $state('');
	let usageSubagentOnly = $state(false);
	let usageApplicationOptions = $state.raw<{ id: string; name: string }[]>([]);
	let usageLoading = $state(false);
	let usageFilterLoading = $state(false);
	let usageLoadSeq = 0;
	let usageOffset = $state(0);
	let usageTotal = $state(0);
	const usageLimit = 50;

	function usageRequestSnapshot(): UsageRequestSnapshot {
		return {
			offset: usageOffset,
			project: usageProjectFilter,
			application: usageApplicationFilter,
			start: usageStartFilter,
			end: usageEndFilter,
			session: usageSessionFilter,
			parentSession: usageParentSessionFilter,
			agent: usageAgentFilter,
			subagent: usageSubagentOnly,
		};
	}

	function sameUsageRequest(left: UsageRequestSnapshot, right: UsageRequestSnapshot): boolean {
		return left.offset === right.offset
			&& left.project === right.project
			&& left.application === right.application
			&& left.start === right.start
			&& left.end === right.end
			&& left.session === right.session
			&& left.parentSession === right.parentSession
			&& left.agent === right.agent
			&& left.subagent === right.subagent;
	}

	function usageQueryParams(offset = usageOffset, includePaging = true): URLSearchParams {
		const params = new URLSearchParams();
		if (usageProjectFilter) params.set('project_id', usageProjectFilter);
		if (usageApplicationFilter) params.set('application_id', usageApplicationFilter);
		const start = usageStartFilter.trim();
		const end = usageEndFilter.trim();
		if (start) params.set('start_time', start);
		if (end) params.set('end_time', end);
		if (usageSessionFilter.trim()) params.set('session_id', usageSessionFilter.trim());
		if (usageParentSessionFilter.trim()) params.set('parent_session_id', usageParentSessionFilter.trim());
		if (usageAgentFilter.trim()) params.set('agent_name', usageAgentFilter.trim());
		if (usageSubagentOnly) params.set('is_subagent', 'true');
		if (includePaging) {
			params.set('limit', String(usageLimit));
			params.set('offset', String(offset));
		}
		return params;
	}

	async function loadUsage(): Promise<void> {
		const sequence = ++usageLoadSeq;
		const requested = usageRequestSnapshot();
		usageLoading = true;
		error = '';
		try {
			const query = usageQueryParams(requested.offset);
			const [usageResult, statusResult, auditResult] = await Promise.allSettled([
				requestJson<unknown>(`/api/control-plane/usage?${query.toString()}`),
				requestJson<UsageStatus>('/api/control-plane/usage/status'),
				requestJson<unknown>('/api/control-plane/audit-events?limit=50'),
			]);
			if (sequence !== usageLoadSeq || !sameUsageRequest(usageRequestSnapshot(), requested)) return;
			if (usageResult.status === 'rejected') throw usageResult.reason;
			usageRows = getListPayload(usageResult.value);
			usageTotal = readTotal(usageResult.value, usageRows.length);
			usageStatus = statusResult.status === 'fulfilled' ? statusResult.value : null;
			auditEvents = auditResult.status === 'fulfilled' ? getListPayload(auditResult.value) : [];
		} catch (cause) {
			if (sequence === usageLoadSeq && sameUsageRequest(usageRequestSnapshot(), requested)) throw cause;
		} finally {
			if (sequence === usageLoadSeq) usageLoading = false;
		}
	}

	function refreshUsage(): void {
		void loadUsage().catch((cause) => handleError(cause, text('加载用量账本失败', 'Failed to load usage ledger')));
	}

	async function loadUsageApplicationOptions(): Promise<void> {
		usageApplicationOptions = [];
		usageApplicationFilter = '';
		if (!usageProjectFilter) return;
		usageFilterLoading = true;
		try {
			const payload = await requestJson<unknown>(`/api/control-plane/projects/${encodePathSegment(usageProjectFilter)}/applications`);
			usageApplicationOptions = getListPayload(payload).map((row) => ({
				id: String(row.id ?? ''),
				name: String(row.name ?? ''),
			})).filter((row) => row.id !== '');
		} catch (cause) {
			handleError(cause, text('加载应用筛选失败', 'Failed to load application filters'));
		} finally {
			usageFilterLoading = false;
		}
	}

	function reloadUsageFromFilters(): void {
		usageOffset = 0;
		usageApplicationFilter = '';
		usageApplicationOptions = [];
		if (usageProjectFilter) {
			void loadUsageApplicationOptions().then(() => refreshUsage());
		} else {
			refreshUsage();
		}
	}

	function applyUsageFilters(): void {
		usageOffset = 0;
		refreshUsage();
	}

	function resetUsageFilters(): void {
		usageProjectFilter = '';
		usageSessionFilter = '';
		usageParentSessionFilter = '';
		usageAgentFilter = '';
		usageStartFilter = '';
		usageEndFilter = '';
		usageSubagentOnly = false;
		reloadUsageFromFilters();
	}

	function changeUsageApplication(): void {
		usageOffset = 0;
		refreshUsage();
	}

	function moveUsagePage(nextOffset: number): void {
		usageOffset = Math.max(0, nextOffset);
		refreshUsage();
	}

	function exportUsage(): void {
		const params = usageQueryParams(0, false);
		const suffix = params.toString();
		const link = document.createElement('a');
		link.href = `/api/control-plane/usage/export${suffix ? `?${suffix}` : ''}`;
		link.download = 'elygate-usage.csv';
		document.body.append(link);
		link.click();
		link.remove();
	}

	let loadedTab = '';
	$effect(() => {
		const tab = activeTab.id;
		if (tab === loadedTab) return;
		loadedTab = tab;
		if (tab === 'control-plane-usage') refreshUsage();
	});

	onMount(() => {
		void loadProjects().catch((cause) => handleError(cause, text('加载控制平面数据失败', 'Failed to load control-plane data')));
	});
</script>

<svelte:head>
	<title>{activeTab.label} · {appName}</title>
</svelte:head>

<section class="page">
	<header>
		<div>
			<h1>{activeTab.id === 'control-plane-usage' ? text('用量账本', 'Usage Ledger') : activeTab.label}</h1>
			<p>{i18n.t('elygate.controlPlaneHint') || 'Control-plane projects, applications and usage ledger.'}</p>
		</div>
		<button class="secondary" type="button" onclick={() => void loadProjects().catch((cause) => handleError(cause, text('刷新失败', 'Refresh failed')))} disabled={loading}>{text('刷新', 'Refresh')}</button>
	</header>

	{#if error}<div class="error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice" role="status">{notice}</div>{/if}

	{#if activeTab.id === 'control-plane-projects'}
		<div class="grid">
			<form class="card" onsubmit={(event) => { event.preventDefault(); void createProject(); }}>
				<h2>{text('新建项目', 'New project')}</h2>
				<label>{text('组织 ID', 'Organization ID')}<input bind:value={organizationId} placeholder="organization uuid" autocomplete="off" /></label>
				<label>{text('项目名称', 'Project name')}<input bind:value={projectName} placeholder={text('项目名称', 'Project name')} autocomplete="off" /></label>
				<button type="submit" disabled={saving || !organizationId.trim() || !projectName.trim()}>{saving ? text('创建中…', 'Creating…') : text('创建项目', 'Create project')}</button>
			</form>
			<div class="card">
				<h2>{text('项目列表', 'Projects')}</h2>
				{#if loading}<p class="muted">{text('加载中…', 'Loading…')}</p>{:else if projects.length === 0}<p class="muted">{text('暂无项目', 'No projects yet')}</p>{:else}
					<div class="table-wrap"><table><thead><tr>{#each activeTab.columns as column (column.key)}<th>{column.label}</th>{/each}<th></th></tr></thead><tbody>
						{#each projects as project (project.id)}
							<tr class:selected={project.id === selectedProject}><td>{project.name}</td><td>{project.organization_id}</td><td>{project.status}</td><td><button type="button" class="link" onclick={() => selectProject(project.id)}>{text('选择', 'Select')}</button></td></tr>
						{/each}
					</tbody></table></div>
				{/if}
			</div>
		</div>
	{:else if activeTab.id === 'control-plane-applications'}
		<div class="grid">
			<form class="card" onsubmit={(event) => { event.preventDefault(); void createApplication(); }}>
				<h2>{text('新建应用', 'New application')}</h2>
				<label>{text('项目', 'Project')}<select value={selectedProject} onchange={(event) => selectProject(event.currentTarget.value)}><option value="">{text('选择项目', 'Select project')}</option>{#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}</select></label>
				<label>{text('应用名称', 'Application name')}<input bind:value={applicationName} placeholder={text('应用名称', 'Application name')} autocomplete="off" /></label>
				<label>{text('环境', 'Environment')}<input bind:value={applicationEnvironment} placeholder="production" autocomplete="off" /></label>
				<button type="submit" disabled={loading || saving || !selectedProject || !applicationName.trim()}>{saving ? text('创建中…', 'Creating…') : text('创建应用', 'Create application')}</button>
			</form>

			<div class="card">
				<h2>{text('应用列表', 'Applications')}</h2>
				{#if applications.length === 0}<p class="muted">{text('当前项目暂无应用', 'No applications in this project')}</p>{:else}
					<div class="table-wrap"><table><thead><tr>{#each activeTab.columns as column (column.key)}<th>{column.label}</th>{/each}<th></th></tr></thead><tbody>
						{#each applications as application (application.id)}
							<tr class:selected={application.id === selectedApplication}><td>{application.name}</td><td>{application.environment}</td><td>{application.status}</td><td><button type="button" class="link" onclick={() => selectApplication(application.id)}>{text('选择', 'Select')}</button></td></tr>
						{/each}
					</tbody></table></div>
				{/if}
			</div>
		</div>

		<div class="grid">
			<form class="card" onsubmit={(event) => { event.preventDefault(); void createApplicationKey(); }}>
				<h2>{text('新建应用密钥', 'New application key')}</h2>
				<p class="muted">{text('创建后仅显示一次密钥值。', 'The key value is shown only once after creation.')}</p>
				<label>{text('密钥名称', 'Key name')}<input bind:value={keyName} placeholder={text('密钥名称', 'Key name')} autocomplete="off" /></label>
				<button type="submit" disabled={saving || !selectedApplication || !keyName.trim()}>{saving ? text('创建中…', 'Creating…') : text('创建密钥', 'Create key')}</button>
			</form>

			<form class="card" onsubmit={(event) => { event.preventDefault(); void bindVirtualKey(); }}>
				<h2>{text('绑定已有虚拟密钥', 'Bind an existing virtual key')}</h2>
				<p class="warn">{text('绑定会撤销该虚拟密钥在其他应用上的有效绑定。Any active binding on another application will be revoked.', 'Any active binding on another application will be revoked.')}</p>
				<label>{text('虚拟密钥 ID', 'Virtual key ID')}<input bind:value={virtualKeyId} placeholder="virtual key uuid" autocomplete="off" /></label>
				<button type="submit" disabled={loading || saving || !selectedApplication || !virtualKeyId.trim()}>{saving ? text('绑定中…', 'Binding…') : text('绑定密钥', 'Bind key')}</button>
			</form>
		</div>

		{#if selectedApplication}
			<section class="card">
				<header class="row"><h2>{text('当前应用的密钥', 'Keys for this application')}</h2><button type="button" class="secondary" onclick={() => showDisclosure(selectedApplication)}>{text('查看密钥引用', 'Show key reference')}</button></header>
				{#if disclosedApplication === selectedApplication && revealedKey?.value}
					<div class="reveal" role="status"><span>{revealedKey.name || revealedKey.virtual_key_id}</span><code>{revealedKey.value}</code></div>
				{/if}
				{#if bindings.length === 0}<p class="muted">{text('暂无绑定密钥', 'No bound keys')}</p>{:else}
					<div class="table-wrap"><table><thead><tr><th>{text('虚拟密钥 ID', 'Virtual key ID')}</th><th>{text('创建时间', 'Created')}</th><th>{text('过期时间', 'Expires')}</th><th></th></tr></thead><tbody>
						{#each bindings as binding (binding.id)}
							<tr><td><code>{binding.virtual_key_id}</code></td><td>{formatDate(binding.created_at)}</td><td>{binding.expires_at ? formatDate(binding.expires_at) : text('永不过期', 'Never')}</td><td class="actions"><button type="button" class="link" onclick={() => void rotateBinding(binding)}>{text('轮换', 'Rotate')}</button><button type="button" class="link danger" onclick={() => void revokeBinding(binding)}>{text('撤销', 'Revoke')}</button></td></tr>
						{/each}
					</tbody></table></div>
				{/if}
			</section>
		{/if}
	{:else}
		<section class="card filters">
			<label>{text('项目', 'Project')}<select bind:value={usageProjectFilter} onchange={() => reloadUsageFromFilters()}><option value="">{text('全部项目', 'All projects')}</option>{#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}</select></label>
			<label>{text('应用', 'Application')}<select bind:value={usageApplicationFilter} onchange={() => changeUsageApplication()} disabled={usageLoading || usageFilterLoading || !usageProjectFilter}><option value="">{text('全部应用', 'All applications')}</option>{#each usageApplicationOptions as option (option.id)}<option value={option.id}>{option.name}</option>{/each}</select></label>
			<label>{text('开始时间', 'Start time')}<input type="datetime-local" bind:value={usageStartFilter} /></label>
			<label>{text('结束时间', 'End time')}<input type="datetime-local" bind:value={usageEndFilter} /></label>
			<label>{text('会话 ID', 'Session ID')}<input bind:value={usageSessionFilter} autocomplete="off" /></label>
			<label>{text('父会话 ID', 'Parent session ID')}<input bind:value={usageParentSessionFilter} autocomplete="off" /></label>
			<label>{text('Agent', 'Agent')}<input bind:value={usageAgentFilter} autocomplete="off" /></label>
			<label class="check"><input type="checkbox" bind:checked={usageSubagentOnly} />{text('仅子 Agent', 'Subagents only')}</label>
			<div class="filter-actions"><button type="button" onclick={() => applyUsageFilters()} disabled={usageLoading || usageFilterLoading}>{text('应用筛选', 'Apply filters')}</button><button type="button" class="secondary" onclick={() => resetUsageFilters()} disabled={usageLoading || usageFilterLoading}>{text('重置', 'Reset')}</button><button type="button" class="secondary" onclick={() => exportUsage()}>{text('导出 CSV', 'Export CSV')}</button></div>
		</section>

		<section class="status-strip" aria-busy={usageLoading}>
			<div><span>{text('同步水位', 'Watermark')}</span><strong>{formatDate(usageStatus?.watermark)}</strong></div>
			<div><span>{text('同步延迟', 'Lag')}</span><strong>{formatDuration(usageStatus?.lag_seconds)}</strong></div>
			<div><span>{text('账本条数', 'Ledger rows')}</span><strong>{usageTotal.toLocaleString(i18n.locale)}</strong></div>
			<div><span>{text('审计事件', 'Audit events')}</span><strong>{auditEvents.length.toLocaleString(i18n.locale)}</strong></div>
		</section>

		<section class="card">
			<h2>{text('用量账本', 'Usage Ledger')}</h2>
			{#if usageLoading}<p class="muted">{text('加载中…', 'Loading…')}</p>{:else if usageRows.length === 0}<p class="muted">{text('暂无账本数据', 'No ledger data')}</p>{:else}
				<div class="table-wrap"><table><thead><tr>{#each activeTab.columns as column (column.key)}<th>{column.label}</th>{/each}</tr></thead><tbody>
					{#each usageRows as row, index (String(row.id ?? index))}
						<tr><td>{formatDate(row.occurred_at)}</td><td>{String(row.application_id ?? '—')}</td><td>{String(row.provider ?? '—')}</td><td>{String(row.model ?? '—')}</td><td>{String(row.status ?? '—')}</td><td>{String(row.total_tokens ?? '—')}</td><td>{formatUsdCost(row.cost)}</td></tr>
					{/each}
				</tbody></table></div>
			{/if}
			<footer class="pagination"><span>{text(`第 ${Math.floor(usageOffset / usageLimit) + 1} 页 · 共 ${usageTotal} 条`, `Page ${Math.floor(usageOffset / usageLimit) + 1} · ${usageTotal} total`)}</span><div><button type="button" disabled={saving || loading || usageLoading || usageOffset === 0} onclick={() => moveUsagePage(usageOffset - usageLimit)}>{text('上一页', 'Previous')}</button><button type="button" disabled={saving || loading || usageLoading || usageOffset + usageLimit >= usageTotal} onclick={() => moveUsagePage(usageOffset + usageLimit)}>{text('下一页', 'Next')}</button></div></footer>
		</section>

		<section class="card">
			<h2>{text('审计事件', 'Audit events')}</h2>
			{#if auditEvents.length === 0}<p class="muted">{text('暂无审计事件', 'No audit events')}</p>{:else}
				<div class="table-wrap"><table><thead><tr><th>{text('时间', 'Time')}</th><th>{text('操作者', 'Actor')}</th><th>{text('动作', 'Action')}</th><th>{text('资源', 'Resource')}</th><th>ID</th></tr></thead><tbody>
					{#each auditEvents as row, index (String(row.id ?? index))}
						<tr><td>{formatDate(row.created_at)}</td><td>{String(row.actor_id ?? '—')}</td><td>{String(row.action ?? '—')}</td><td>{String(row.resource_type ?? '—')}</td><td>{String(row.resource_id ?? '—')}</td></tr>
					{/each}
				</tbody></table></div>
			{/if}
		</section>
	{/if}
</section>

<style>
	.page { display: grid; gap: 1rem; }
	header { display: flex; align-items: end; justify-content: space-between; gap: 1rem; }
	header.row { align-items: center; }
	h1 { font-size: 1.35rem; margin: 0; }
	h2 { font-size: 1rem; margin: 0 0 .75rem; }
	header p { color: var(--muted-foreground); margin: .35rem 0 0; }
	.grid { display: grid; gap: 1rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.card { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; display: grid; gap: .75rem; padding: 1rem; overflow: hidden; }
	label { display: grid; gap: .35rem; font-size: .85rem; }
	label.check { align-items: center; display: flex; gap: .5rem; }
	input, select { background: var(--background); border: 1px solid var(--border); border-radius: .45rem; color: inherit; font: inherit; padding: .5rem .6rem; }
	button { background: var(--primary); border: 1px solid var(--primary); border-radius: .45rem; color: var(--primary-foreground); cursor: pointer; font: inherit; font-weight: 600; padding: .5rem .75rem; }
	button:disabled { cursor: not-allowed; opacity: .55; }
	button.secondary { background: transparent; border-color: var(--border); color: inherit; }
	button.link { background: transparent; border: 0; color: var(--primary); padding: .15rem .25rem; }
	button.link.danger { color: var(--destructive); }
	.table-wrap { overflow: auto; }
	table { border-collapse: collapse; width: 100%; font-size: .85rem; }
	th, td { text-align: left; padding: .55rem .65rem; border-bottom: 1px solid var(--border); white-space: nowrap; }
	th { color: var(--muted-foreground); font-weight: 600; }
	tr.selected { background: color-mix(in srgb, var(--primary) 8%, transparent); }
	.actions { display: flex; gap: .35rem; }
	.muted { color: var(--muted-foreground); margin: 0; }
	.warn { color: var(--destructive); font-size: .82rem; margin: 0; }
	.notice, .error, .reveal { border: 1px solid var(--border); border-radius: .6rem; padding: .7rem .9rem; }
	.error { background: color-mix(in srgb, var(--destructive) 12%, transparent); border-color: var(--destructive); }
	.reveal { display: grid; gap: .35rem; }
	.reveal code { overflow-wrap: anywhere; }
	.filters { grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.filter-actions { align-items: end; display: flex; gap: .5rem; }
	.status-strip { border-bottom: 1px solid var(--border); border-top: 1px solid var(--border); display: grid; gap: 1rem; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 1rem 0; }
	.status-strip div { display: grid; gap: .3rem; min-width: 0; }
	.status-strip span { color: var(--muted-foreground); font-size: .8rem; }
	.pagination { align-items: center; color: var(--muted-foreground); display: flex; font-size: .82rem; justify-content: space-between; }
	.pagination div { display: flex; gap: .5rem; }
	@media (max-width: 900px) {
		.grid, .filters { grid-template-columns: 1fr; }
		.status-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		header { align-items: stretch; flex-direction: column; }
		.pagination { align-items: stretch; flex-direction: column; gap: .5rem; }
	}
</style>