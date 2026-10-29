<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getAppName } from '../lib/branding';
	import { displayError } from '../lib/forms';
	import { formatUsdCost } from '../lib/display-format';
	import { usageTimeRange, type UsageSummary } from '../lib/control-plane-usage';
	import { budgetEndpoint, budgetLimits, type BudgetLimits } from '../lib/control-plane-budgets';
	import BudgetFields from '../lib/fields/BudgetFields.svelte';
	import ControlPlaneBudgetOverview from './ControlPlaneBudgetOverview.svelte';
	import ControlPlaneBudgetHistory from './ControlPlaneBudgetHistory.svelte';
	import { encodePathSegment, getListPayload, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { SaveButton } from '@svadmin/ui';

	interface Props { resourceName: string; }
	interface ControlPlaneTab {
		id: string;
		label: string;
		columns: { key: string; label: string }[];
	}
	interface ProjectRow { id: string; name: string; organization_id: string; status: string; daily_budget?: number | null; monthly_budget?: number | null; }
	interface ApplicationRow { id: string; project_id: string; name: string; environment: string; status: string; daily_budget?: number | null; monthly_budget?: number | null; }
	interface BindingRow { id: string; virtual_key_id: string; application_id: string; expires_at?: string; revoked_at?: string; created_at?: string; }
	interface CreatedKey { virtual_key_id?: string; value?: string; name?: string; }
	interface UsageStatus { watermark?: string; lag_seconds?: number; last_reconciled_at?: string; }
	interface UsageRequestSnapshot {
		offset: number;
		project: string;
		application: string;
		user: string;
		provider: string;
		model: string;
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

	const tabs: ControlPlaneTab[] = $derived([
		{
			id: 'control-plane-projects',
			label: text('项目', 'Projects'),
			columns: [
				{ key: 'name', label: text('名称', 'Name') },
				{ key: 'organization_id', label: text('组织', 'Organization') },
				{ key: 'status', label: text('状态', 'Status') },
			],
		},
		{
			id: 'control-plane-applications',
			label: text('应用', 'Applications'),
			columns: [
				{ key: 'name', label: text('名称', 'Name') },
				{ key: 'environment', label: text('环境', 'Environment') },
				{ key: 'status', label: text('状态', 'Status') },
			],
		},
		{
			id: 'usage-ledger',
			label: text('用量', 'Usage'),
			columns: [
				{ key: 'occurred_at', label: text('时间', 'Time') },
				{ key: 'application_id', label: text('应用', 'Application') },
				{ key: 'user_id', label: text('用户 ID', 'User ID') },
				{ key: 'provider', label: text('提供商', 'Provider') },
				{ key: 'model', label: text('模型', 'Model') },
				{ key: 'status', label: text('状态', 'Status') },
				{ key: 'total_tokens', label: text('Token 数', 'Tokens') },
				{ key: 'cost', label: text('费用', 'Cost') },
			],
		},
	]);

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
	let projectDailyBudget = $state('');
	let projectMonthlyBudget = $state('');
	let applicationName = $state('');
	let applicationEnvironment = $state('production');
	let applicationDailyBudget = $state('');
	let applicationMonthlyBudget = $state('');
	let budgetDailyInput = $state('');
	let budgetMonthlyInput = $state('');
	let budgetSaving = $state(false);
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
		error = cause instanceof Error && cause.message === 'invalid-budget-amount'
			? text('预算必须是大于零的有限 USD 金额，或留空', 'Budgets must be finite USD amounts greater than zero, or empty')
			: displayError(cause, fallback);
	}

	const selectedBudgetScope = $derived.by(() => {
		if (activeTab.id === 'control-plane-projects') {
			const project = projects.find((row) => row.id === selectedProject);
			return project ? { type: 'project' as const, id: project.id, daily_budget: project.daily_budget, monthly_budget: project.monthly_budget } : null;
		}
		if (activeTab.id === 'control-plane-applications') {
			const application = applications.find((row) => row.id === selectedApplication);
			return application ? { type: 'application' as const, id: application.id, daily_budget: application.daily_budget, monthly_budget: application.monthly_budget } : null;
		}
		return null;
	});

	const budgetScopeKey = $derived(selectedBudgetScope ? `${selectedBudgetScope.type}:${selectedBudgetScope.id}` : '');
	const budgetDailyLimit = $derived(selectedBudgetScope?.daily_budget);
	const budgetMonthlyLimit = $derived(selectedBudgetScope?.monthly_budget);
	$effect(() => {
		budgetScopeKey;
		budgetDailyInput = budgetDailyLimit == null ? '' : String(budgetDailyLimit);
		budgetMonthlyInput = budgetMonthlyLimit == null ? '' : String(budgetMonthlyLimit);
	});

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
				daily_budget: typeof row.daily_budget === 'number' ? row.daily_budget : null,
				monthly_budget: typeof row.monthly_budget === 'number' ? row.monthly_budget : null,
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
				daily_budget: typeof row.daily_budget === 'number' ? row.daily_budget : null,
				monthly_budget: typeof row.monthly_budget === 'number' ? row.monthly_budget : null,
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
				body: JSON.stringify({ organization_id: organizationId.trim(), name: projectName.trim(), ...budgetLimits(projectDailyBudget, projectMonthlyBudget) }),
			});
			projectName = '';
			projectDailyBudget = '';
			projectMonthlyBudget = '';
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
				body: JSON.stringify({ name: applicationName.trim(), environment: applicationEnvironment.trim() || 'production', ...budgetLimits(applicationDailyBudget, applicationMonthlyBudget) }),
			});
			applicationName = '';
			applicationDailyBudget = '';
			applicationMonthlyBudget = '';
			notice = text('应用已创建', 'Application created');
			await loadApplications();
		} catch (cause) {
			handleError(cause, text('创建应用失败', 'Failed to create application'));
		} finally {
			saving = false;
		}
	}

	async function replaceBudget(limits: BudgetLimits): Promise<void> {
		const scope = selectedBudgetScope;
		if (!scope || budgetSaving) return;
		budgetSaving = true;
		error = '';
		notice = '';
		try {
			await requestJson<BudgetLimits>(budgetEndpoint(scope.type, scope.id), { method: 'PUT', body: JSON.stringify(limits) });
			if (scope.type === 'project') projects = projects.map((row) => row.id === scope.id ? { ...row, ...limits } : row);
			else applications = applications.map((row) => row.id === scope.id ? { ...row, ...limits } : row);
			if (selectedBudgetScope?.id === scope.id && selectedBudgetScope.type === scope.type) notice = text('预算已保存', 'Budget saved');
		} catch (cause) {
			if (selectedBudgetScope?.id === scope.id && selectedBudgetScope.type === scope.type) handleError(cause, text('保存预算失败', 'Failed to save budget'));
		} finally {
			budgetSaving = false;
		}
	}

	function saveBudget(): void {
		try { void replaceBudget(budgetLimits(budgetDailyInput, budgetMonthlyInput)); }
		catch (cause) { handleError(cause, text('预算金额无效', 'Invalid budget amount')); }
	}

	function clearBudget(): void {
		if (window.confirm(text('清除该资源的日预算和月预算？', 'Clear daily and monthly budgets for this resource?'))) {
			void replaceBudget({ daily_budget: null, monthly_budget: null });
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
	let usageSummary = $state<UsageSummary | null>(null);
	let usageProjectFilter = $state('');
	let usageApplicationFilter = $state('');
	let usageUserFilter = $state('');
	let usageProviderFilter = $state('');
	let usageModelFilter = $state('');
	let usageStartFilter = $state('');
	let usageEndFilter = $state('');
	let usageSessionFilter = $state('');
	let usageParentSessionFilter = $state('');
	let usageAgentFilter = $state('');
	let usageSubagentOnly = $state(false);
	let usageApplicationOptions = $state.raw<{ id: string; name: string }[]>([]);
	let usageLoading = $state(false);
	let usageLoadError = $state('');
	let usageStatusError = $state('');
	let usageAuditError = $state('');
	let usageApplicationError = $state('');
	let usageFilterLoading = $state(false);
	let usageApplicationLoadSeq = 0;
	let usageLoadSeq = 0;
	let usageOffset = $state(0);
	let usageTotal = $state(0);
	const usageLimit = 50;

	function usageRequestSnapshot(): UsageRequestSnapshot {
		return {
			offset: usageOffset,
			project: usageProjectFilter,
			application: usageApplicationFilter,
			user: usageUserFilter,
			provider: usageProviderFilter,
			model: usageModelFilter,
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
			&& left.user === right.user
			&& left.provider === right.provider
			&& left.model === right.model
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
		if (usageUserFilter) params.set('user_id', usageUserFilter);
		if (usageProviderFilter) params.set('provider', usageProviderFilter);
		if (usageModelFilter) params.set('model', usageModelFilter);
		const { start, end } = usageTimeRange(usageStartFilter, usageEndFilter, {
			start: text('开始时间无效', 'Invalid start time'),
			end: text('结束时间无效', 'Invalid end time'),
			range: text('开始时间必须早于结束时间', 'Start time must be before end time'),
		});
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
		usageLoadError = '';
		usageStatusError = '';
		usageAuditError = '';
		usageRows = [];
		usageTotal = 0;
		usageStatus = null;
		auditEvents = [];
		usageSummary = null;
		error = '';
		try {
			const query = usageQueryParams(requested.offset);
			const [usageResult, statusResult, auditResult, summaryResult] = await Promise.allSettled([
				requestJson<unknown>(`/api/control-plane/usage?${query.toString()}`),
				requestJson<UsageStatus>('/api/control-plane/usage/status'),
				requestJson<unknown>('/api/control-plane/audit-events?limit=50'),
				requestJson<UsageSummary>(`/api/control-plane/usage/summary?${query.toString()}`),
			]);
			if (sequence !== usageLoadSeq || !sameUsageRequest(usageRequestSnapshot(), requested)) return;
			usageStatus = statusResult.status === 'fulfilled' ? statusResult.value : null;
			usageSummary = summaryResult.status === 'fulfilled' ? summaryResult.value : null;
			auditEvents = auditResult.status === 'fulfilled' ? getListPayload(auditResult.value) : [];
			if (statusResult.status === 'rejected') usageStatusError = displayError(statusResult.reason, text('同步状态不可用', 'Sync status unavailable'));
			if (auditResult.status === 'rejected') usageAuditError = displayError(auditResult.reason, text('审计事件不可用', 'Audit events unavailable'));
			if (usageResult.status === 'rejected') {
				usageLoadError = displayError(usageResult.reason, text('账本数据不可用', 'Ledger data unavailable'));
				throw usageResult.reason;
			}
			usageRows = getListPayload(usageResult.value);
			usageTotal = readTotal(usageResult.value, usageRows.length);
			if (summaryResult.status === 'rejected') throw summaryResult.reason;
		} catch (cause) {
			if (sequence === usageLoadSeq && sameUsageRequest(usageRequestSnapshot(), requested)) {
				throw cause;
			}
		} finally {
			if (sequence === usageLoadSeq) usageLoading = false;
		}
	}

	function refreshUsage(): void {
		void loadUsage().catch((cause) => handleError(cause, text('加载用量账本失败', 'Failed to load usage ledger')));
	}

	async function loadUsageApplicationOptions(): Promise<void> {
		const sequence = ++usageApplicationLoadSeq;
		const requestedProject = usageProjectFilter;
		usageApplicationOptions = [];
		usageApplicationFilter = '';
		usageApplicationError = '';
		usageFilterLoading = false;
		if (!requestedProject) return;
		usageFilterLoading = true;
		try {
			const payload = await requestJson<unknown>(`/api/control-plane/projects/${encodePathSegment(requestedProject)}/applications`);
			if (sequence !== usageApplicationLoadSeq || usageProjectFilter !== requestedProject) return;
			usageApplicationOptions = getListPayload(payload).map((row) => ({
				id: String(row.id ?? ''),
				name: String(row.name ?? ''),
			})).filter((row) => row.id !== '');
		} catch (cause) {
			if (sequence === usageApplicationLoadSeq && usageProjectFilter === requestedProject) {
				usageApplicationError = displayError(cause, text('加载应用筛选失败', 'Failed to load application filters'));
			}
		} finally {
			if (sequence === usageApplicationLoadSeq) usageFilterLoading = false;
		}
	}

	function reloadUsageFromFilters(): void {
		usageOffset = 0;
		const requestedProject = usageProjectFilter;
		void loadUsageApplicationOptions().then(() => {
			if (usageProjectFilter === requestedProject) refreshUsage();
		});
	}

	function applyUsageFilters(): void {
		if (usageLoading || usageFilterLoading) return;
		usageOffset = 0;
		refreshUsage();
	}

	function resetUsageFilters(): void {
		usageProjectFilter = '';
		usageUserFilter = '';
		usageProviderFilter = '';
		usageModelFilter = '';
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
		error = '';
		try {
			const params = usageQueryParams(0, false);
			const suffix = params.toString();
			const link = document.createElement('a');
			link.href = `/api/control-plane/usage/export${suffix ? `?${suffix}` : ''}`;
			link.download = 'elygate-usage.csv';
			document.body.append(link);
			link.click();
			link.remove();
		} catch (cause) {
			handleError(cause, text('导出用量失败', 'Failed to export usage'));
		}
	}

	let loadedTab = '';
	$effect(() => {
		const tab = activeTab.id;
		if (tab === loadedTab) return;
		loadedTab = tab;
		if (tab === 'usage-ledger') refreshUsage();
	});

	function refreshPage(): void {
		if (activeTab.id === 'usage-ledger') refreshUsage();
		else void loadProjects().catch((cause) => handleError(cause, text('刷新失败', 'Refresh failed')));
	}

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
			<h1>{activeTab.id === 'usage-ledger' ? text('用量账本', 'Usage Ledger') : activeTab.label}</h1>
		</div>
		<button class="secondary" type="button" onclick={refreshPage} disabled={activeTab.id === 'usage-ledger' ? usageLoading : loading}>{text('刷新', 'Refresh')}</button>
	</header>

	{#if error}<div class="error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice" role="status">{notice}</div>{/if}

	{#if activeTab.id === 'control-plane-projects'}
		<div class="grid">
			<form class="card" onsubmit={(event) => { event.preventDefault(); void createProject(); }}>
				<h2>{text('新建项目', 'New project')}</h2>
				<label>{text('组织 ID', 'Organization ID')}<input bind:value={organizationId} placeholder="organization uuid" autocomplete="off" /></label>
				<label>{text('项目名称', 'Project name')}<input bind:value={projectName} placeholder={text('项目名称', 'Project name')} autocomplete="off" /></label>
				<BudgetFields bind:daily={projectDailyBudget} bind:monthly={projectMonthlyBudget} disabled={saving} />
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
		{#if selectedProject}
			<form class="budget-editor" onsubmit={(event) => { event.preventDefault(); saveBudget(); }}>
				<div class="section-heading"><h2>{text('项目预算', 'Project budget')}</h2><span class="scope-id">{selectedBudgetScope?.id}</span></div>
				<BudgetFields bind:daily={budgetDailyInput} bind:monthly={budgetMonthlyInput} disabled={budgetSaving} />
				<div class="budget-actions"><SaveButton loading={budgetSaving} label={text('保存预算', 'Save budget')} /><button class="secondary" type="button" onclick={clearBudget} disabled={budgetSaving}>{text('清除预算', 'Clear budgets')}</button></div>
			</form>
		{/if}
	{:else if activeTab.id === 'control-plane-applications'}
		<div class="grid">
			<form class="card" onsubmit={(event) => { event.preventDefault(); void createApplication(); }}>
				<h2>{text('新建应用', 'New application')}</h2>
				<label>{text('项目', 'Project')}<select value={selectedProject} onchange={(event) => selectProject(event.currentTarget.value)}><option value="">{text('选择项目', 'Select project')}</option>{#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}</select></label>
				<label>{text('应用名称', 'Application name')}<input bind:value={applicationName} placeholder={text('应用名称', 'Application name')} autocomplete="off" /></label>
				<label>{text('环境', 'Environment')}<input bind:value={applicationEnvironment} placeholder="production" autocomplete="off" /></label>
				<BudgetFields bind:daily={applicationDailyBudget} bind:monthly={applicationMonthlyBudget} disabled={saving} />
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
		{#if selectedApplication}
			<form class="budget-editor" onsubmit={(event) => { event.preventDefault(); saveBudget(); }}>
				<div class="section-heading"><h2>{text('应用预算', 'Application budget')}</h2><span class="scope-id">{selectedBudgetScope?.id}</span></div>
				<BudgetFields bind:daily={budgetDailyInput} bind:monthly={budgetMonthlyInput} disabled={budgetSaving} />
				<div class="budget-actions"><SaveButton loading={budgetSaving} label={text('保存预算', 'Save budget')} /><button class="secondary" type="button" onclick={clearBudget} disabled={budgetSaving}>{text('清除预算', 'Clear budgets')}</button></div>
			</form>
		{/if}

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
		<form class="filters" onsubmit={(event) => { event.preventDefault(); applyUsageFilters(); }}>
			<label>{text('项目', 'Project')}<select bind:value={usageProjectFilter} onchange={() => reloadUsageFromFilters()}><option value="">{text('全部项目', 'All projects')}</option>{#each projects as project (project.id)}<option value={project.id}>{project.name}</option>{/each}</select></label>
			<label>{text('应用', 'Application')}<select bind:value={usageApplicationFilter} onchange={() => changeUsageApplication()} disabled={usageLoading || usageFilterLoading || !usageProjectFilter}><option value="">{text('全部应用', 'All applications')}</option>{#each usageApplicationOptions as option (option.id)}<option value={option.id}>{option.name}</option>{/each}</select></label>
			<label>{text('开始时间', 'Start time')}<input type="datetime-local" bind:value={usageStartFilter} /></label>
			<label>{text('结束时间', 'End time')}<input type="datetime-local" bind:value={usageEndFilter} /></label>
			<label>{text('用户 ID', 'User ID')}<input bind:value={usageUserFilter} autocomplete="off" autocapitalize="none" spellcheck={false} /></label>
			<label>{text('提供商', 'Provider')}<input bind:value={usageProviderFilter} autocomplete="off" autocapitalize="none" spellcheck={false} /></label>
			<label>{text('模型', 'Model')}<input bind:value={usageModelFilter} autocomplete="off" autocapitalize="none" spellcheck={false} /></label>
			<label>{text('会话 ID', 'Session ID')}<input bind:value={usageSessionFilter} autocomplete="off" /></label>
			<label>{text('父会话 ID', 'Parent session ID')}<input bind:value={usageParentSessionFilter} autocomplete="off" /></label>
			<label>{text('Agent', 'Agent')}<input bind:value={usageAgentFilter} autocomplete="off" /></label>
			<label class="check"><input type="checkbox" bind:checked={usageSubagentOnly} />{text('仅子 Agent', 'Subagents only')}</label>
			<div class="filter-actions"><button type="submit" disabled={usageLoading || usageFilterLoading}>{text('应用筛选', 'Apply filters')}</button><button type="button" class="secondary" onclick={() => resetUsageFilters()} disabled={usageLoading || usageFilterLoading}>{text('重置', 'Reset')}</button><button type="button" class="secondary" onclick={() => exportUsage()}>{text('导出 CSV', 'Export CSV')}</button></div>
		</form>
		{#if usageApplicationError}<p class="error" role="alert">{usageApplicationError}</p>{/if}

		<section class="status-strip" aria-busy={usageLoading}>
			<div><span>{text('请求数', 'Requests')}</span><strong>{usageSummary?.requests.toLocaleString(i18n.locale) ?? '—'}</strong></div>
			<div><span>{text('成功请求', 'Successful requests')}</span><strong>{usageSummary?.successful_requests.toLocaleString(i18n.locale) ?? '—'}</strong></div>
			<div><span>{text('失败请求', 'Failed requests')}</span><strong>{usageSummary?.failed_requests.toLocaleString(i18n.locale) ?? '—'}</strong></div>
			<div><span>{text('已取消请求', 'Cancelled requests')}</span><strong>{usageSummary?.cancelled_requests.toLocaleString(i18n.locale) ?? '—'}</strong></div>
			<div><span>{text('输入 Token', 'Prompt tokens')}</span><strong>{usageSummary?.prompt_tokens.toLocaleString(i18n.locale) ?? '—'}</strong></div>
			<div><span>{text('输出 Token', 'Output tokens')}</span><strong>{usageSummary?.output_tokens.toLocaleString(i18n.locale) ?? '—'}</strong></div>
			<div><span>{text('总 Token', 'Total tokens')}</span><strong>{usageSummary?.total_tokens.toLocaleString(i18n.locale) ?? '—'}</strong></div>
			<div><span>{text('总成本', 'Total cost')}</span><strong>{formatUsdCost(usageSummary?.cost)}</strong></div>
			<div><span>{text('同步水位', 'Watermark')}</span><strong>{formatDate(usageStatus?.watermark)}</strong></div>
			<div><span>{text('同步延迟', 'Lag')}</span><strong>{usageStatus ? formatDuration(usageStatus.lag_seconds) : '—'}</strong></div>
		</section>
		{#if usageStatusError}<p class="error" role="alert">{usageStatusError}</p>{/if}
		<ControlPlaneBudgetOverview project={usageProjectFilter} application={usageApplicationFilter} />
		<ControlPlaneBudgetHistory project={usageProjectFilter} application={usageApplicationFilter} />

		<section class="ledger-section">
			<h2>{text('用量账本', 'Usage Ledger')}</h2>
			{#if usageLoading}<p class="muted">{text('加载中…', 'Loading…')}</p>{:else if usageRows.length === 0}<p class="muted">{usageLoadError ? text('账本数据不可用', 'Ledger data unavailable') : text('暂无账本数据', 'No ledger data')}</p>{:else}
				<div class="table-wrap"><table><thead><tr>{#each activeTab.columns as column (column.key)}<th>{column.label}</th>{/each}</tr></thead><tbody>
					{#each usageRows as row, index (String(row.id ?? index))}
						<tr><td>{formatDate(row.occurred_at)}</td><td>{String(row.application_id ?? '—')}</td><td>{String(row.user_id ?? '—')}</td><td>{String(row.provider ?? '—')}</td><td>{String(row.model ?? '—')}</td><td>{String(row.status ?? '—')}</td><td>{String(row.total_tokens ?? '—')}</td><td>{formatUsdCost(row.cost)}</td></tr>
					{/each}
				</tbody></table></div>
			{/if}
			<footer class="pagination"><span>{text(`第 ${Math.floor(usageOffset / usageLimit) + 1} 页 · 共 ${usageTotal} 条`, `Page ${Math.floor(usageOffset / usageLimit) + 1} · ${usageTotal} total`)}</span><div><button type="button" disabled={saving || loading || usageLoading || usageOffset === 0} onclick={() => moveUsagePage(usageOffset - usageLimit)}>{text('上一页', 'Previous')}</button><button type="button" disabled={saving || loading || usageLoading || usageOffset + usageLimit >= usageTotal} onclick={() => moveUsagePage(usageOffset + usageLimit)}>{text('下一页', 'Next')}</button></div></footer>
		</section>

		<section class="ledger-section">
			<h2>{text('审计事件', 'Audit events')}</h2>
			{#if usageAuditError}<p class="error" role="alert">{usageAuditError}</p>{:else if usageLoading}<p class="muted">{text('加载中…', 'Loading…')}</p>{:else if auditEvents.length === 0}<p class="muted">{text('暂无审计事件', 'No audit events')}</p>{:else}
				<div class="table-wrap"><table><thead><tr><th>{text('时间', 'Time')}</th><th>{text('操作者', 'Actor')}</th><th>{text('动作', 'Action')}</th><th>{text('资源', 'Resource')}</th><th>ID</th><th>{text('请求关联', 'Correlation')}</th></tr></thead><tbody>
					{#each auditEvents as row, index (String(row.id ?? index))}
						<tr><td>{formatDate(row.created_at)}</td><td>{String(row.actor_id ?? '—')}</td><td>{String(row.action ?? '—')}</td><td>{String(row.resource_type ?? '—')}</td><td>{String(row.resource_id ?? '—')}</td><td class="audit-correlation">
							{#if row.request_id || row.trace_id}
								<dl>
									{#if row.request_id}<div><dt>Request ID</dt><dd><code>{String(row.request_id)}</code></dd></div>{/if}
									{#if row.trace_id}<div><dt>Trace ID</dt><dd><code>{String(row.trace_id)}</code></dd></div>{/if}
								</dl>
							{:else}—{/if}
						</td></tr>
					{/each}
				</tbody></table></div>
			{/if}
		</section>
	{/if}
</section>

<style>
	.page { display: grid; gap: 1rem; min-width: 0; }
	header { display: flex; align-items: end; justify-content: space-between; gap: 1rem; }
	header.row { align-items: center; }
	h1 { font-size: 1.35rem; margin: 0; }
	h2 { font-size: 1rem; margin: 0 0 .75rem; }
	.grid { display: grid; gap: 1rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.card { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; display: grid; gap: .75rem; padding: 1rem; overflow: hidden; }
	.budget-editor { border-top: 1px solid var(--border); display: grid; gap: .75rem; padding-top: 1rem; min-width: 0; }
	.section-heading { align-items: center; display: flex; gap: 1rem; justify-content: space-between; }
	.scope-id { color: var(--muted-foreground); font: .75rem ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
	.budget-actions { align-items: center; display: flex; flex-wrap: wrap; gap: .5rem; }
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
	.audit-correlation { min-width: 16rem; max-width: 24rem; white-space: normal; }
	.audit-correlation dl { margin: 0; display: grid; gap: .35rem; }
	.audit-correlation dl > div { display: grid; grid-template-columns: 5rem minmax(0, 1fr); gap: .5rem; }
	.audit-correlation dt { color: var(--muted-foreground); }
	.audit-correlation dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
	th { color: var(--muted-foreground); font-weight: 600; }
	tr.selected { background: color-mix(in srgb, var(--primary) 8%, transparent); }
	.actions { display: flex; gap: .35rem; }
	.muted { color: var(--muted-foreground); margin: 0; }
	.warn { color: var(--destructive); font-size: .82rem; margin: 0; }
	.notice, .error, .reveal { border: 1px solid var(--border); border-radius: .6rem; padding: .7rem .9rem; }
	.error { background: color-mix(in srgb, var(--destructive) 12%, transparent); border-color: var(--destructive); }
	.reveal { display: grid; gap: .35rem; }
	.reveal code { overflow-wrap: anywhere; }
	.filters { display: grid; gap: .75rem; grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.filters label, .filters input, .filters select { min-width: 0; }
	.filter-actions { align-items: end; display: flex; flex-wrap: wrap; gap: .5rem; grid-column: 1 / -1; }
	.ledger-section { min-width: 0; }
	.status-strip { border-bottom: 1px solid var(--border); border-top: 1px solid var(--border); display: grid; gap: 1rem; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 1rem 0; }
	.status-strip div { display: grid; gap: .3rem; min-width: 0; }
	.status-strip span { color: var(--muted-foreground); font-size: .8rem; }
	.status-strip strong { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
	.pagination { align-items: center; color: var(--muted-foreground); display: flex; font-size: .82rem; justify-content: space-between; }
	.pagination div { display: flex; gap: .5rem; }
	@media (max-width: 900px) {
		.grid, .filters { grid-template-columns: 1fr; }
		.status-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		header { align-items: stretch; flex-direction: column; }
		.pagination { align-items: stretch; flex-direction: column; gap: .5rem; }
	}
</style>
