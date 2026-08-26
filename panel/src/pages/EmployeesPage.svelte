<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getAppName } from '../lib/branding';
	import { displayError } from '../lib/forms';
	import { getListPayload, requestJson, type JsonRecord } from '../lib/api';

	interface Props { resourceName: string; }
	interface EmployeeForm {
		username: string;
		name: string;
		jobTitle: string;
		department: string;
		applications: string;
		accountType: string;
		isActive: boolean;
		virtualKeyId: string;
	}

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let employees = $state.raw<JsonRecord[]>([]);
	let virtualKeys = $state.raw<JsonRecord[]>([]);
	let form = $state<EmployeeForm>(emptyForm());
	let editing = $state.raw<JsonRecord | null>(null);
	let modalOpen = $state(false);
	let loading = $state(true);
	let saving = $state(false);
	let busyId = $state('');
	let error = $state('');
	let notice = $state('');
	let revealedCredential = $state('');
	let search = $state('');
	let modalElement = $state<HTMLDivElement | null>(null);
	let returnFocusElement = $state<HTMLElement | null>(null);
	const filteredEmployees = $derived.by(() => {
		const query = search.trim().toLowerCase();
		if (!query) return employees;
		return employees.filter((employee) => [employee.name, employee.username, employee.department, employee.job_title]
			.some((value) => String(value ?? '').toLowerCase().includes(query)));
	});

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function emptyForm(): EmployeeForm {
		return { username: '', name: '', jobTitle: '', department: '', applications: '', accountType: '', isActive: true, virtualKeyId: '' };
	}
	function stringValue(record: JsonRecord, key: string): string { return typeof record[key] === 'string' ? String(record[key]) : ''; }
	function boolValue(record: JsonRecord, key: string): boolean { return record[key] !== false; }
	function keyList(record: JsonRecord): JsonRecord[] { return Array.isArray(record.virtual_keys) ? record.virtual_keys.filter((key): key is JsonRecord => !!key && typeof key === 'object' && !Array.isArray(key)) : []; }
	function assignedKeyId(record: JsonRecord): string { return stringValue(keyList(record)[0] ?? {}, 'id'); }
	function assignedKeyName(record: JsonRecord): string { return stringValue(keyList(record)[0] ?? {}, 'name') || '—'; }
	function focusableElements(): HTMLElement[] {
		if (!modalElement) return [];
		return Array.from(modalElement.querySelectorAll<HTMLElement>(
			'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
		)).filter((element) => !element.hidden);
	}
	function finishClosingModal(): void {
		modalOpen = false;
		void tick().then(() => {
			returnFocusElement?.focus();
			returnFocusElement = null;
		});
	}
	function closeModal(): void {
		if (!saving) finishClosingModal();
	}
	function openModal(): void {
		if (document.activeElement instanceof HTMLElement) returnFocusElement = document.activeElement;
		modalOpen = true;
		void tick().then(() => (focusableElements()[0] ?? modalElement)?.focus());
	}
	function handleModalKeydown(event: KeyboardEvent): void {
		if (!modalOpen) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			closeModal();
			return;
		}
		if (event.key !== 'Tab') return;
		const elements = focusableElements();
		if (elements.length === 0) {
			event.preventDefault();
			modalElement?.focus();
			return;
		}
		const first = elements[0];
		const last = elements[elements.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			const [employeePayload, keyPayload] = await Promise.all([
				requestJson<unknown>('/api/employees'),
				requestJson<unknown>('/api/governance/virtual-keys'),
			]);
			employees = getListPayload(employeePayload);
			virtualKeys = getListPayload(keyPayload);
		} catch (cause) {
			error = displayError(cause, text('员工数据加载失败。', 'Failed to load employees.'));
		} finally {
			loading = false;
		}
	}

	function openCreate(): void {
		editing = null;
		form = emptyForm();
		error = '';
		openModal();
	}

	function openEdit(employee: JsonRecord): void {
		editing = employee;
		form = {
			username: stringValue(employee, 'username'),
			name: stringValue(employee, 'name'),
			jobTitle: stringValue(employee, 'job_title'),
			department: stringValue(employee, 'department'),
			applications: stringValue(employee, 'applications'),
			accountType: stringValue(employee, 'account_type'),
			isActive: boolValue(employee, 'is_active'),
			virtualKeyId: assignedKeyId(employee),
		};
		error = '';
		openModal();
	}

	function payload(): JsonRecord {
		return {
			username: form.username.trim().toLowerCase(),
			name: form.name.trim(),
			job_title: form.jobTitle.trim(),
			department: form.department.trim(),
			applications: form.applications.trim(),
			account_type: form.accountType.trim(),
			is_active: form.isActive,
			virtual_key_ids: form.virtualKeyId ? [form.virtualKeyId] : [],
		};
	}

	async function save(): Promise<void> {
		saving = true;
		error = '';
		try {
			if (!form.username.trim() || !form.name.trim()) throw new Error(text('用户名和姓名不能为空。', 'Username and name are required.'));
			if (!form.virtualKeyId) throw new Error(text('必须选择一个专属虚拟密钥。', 'A dedicated virtual key is required.'));
			const path = editing ? `/api/employees/${encodeURIComponent(stringValue(editing, 'id'))}` : '/api/employees';
			const response = await requestJson<JsonRecord>(path, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload()) });
			if (typeof response.temporary_password === 'string') revealedCredential = `${form.username.trim().toLowerCase()}\n${response.temporary_password}`;
			const warning = typeof response.warning === 'string' ? response.warning : '';
			notice = warning || (editing ? text('员工信息已更新。', 'Employee updated.') : text('员工已创建，请立即交付一次性凭据。', 'Employee created. Deliver the one-time credential now.'));
			finishClosingModal();
			await load();
		} catch (cause) {
			error = displayError(cause, text('保存员工失败。', 'Failed to save employee.'));
		} finally {
			saving = false;
		}
	}

	async function resetPassword(employee: JsonRecord): Promise<void> {
		if (!window.confirm(text('重置后现有员工会话会立即失效。确认继续？', 'Existing employee sessions will be revoked. Continue?'))) return;
		const id = stringValue(employee, 'id');
		busyId = id;
		error = '';
		try {
			const response = await requestJson<JsonRecord>(`/api/employees/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: '{}' });
			revealedCredential = `${stringValue(employee, 'username')}\n${String(response.temporary_password ?? '')}`;
			notice = text('密码已重置，请立即交付一次性凭据。', 'Password reset. Deliver the one-time credential now.');
			await load();
		} catch (cause) {
			error = displayError(cause, text('重置密码失败。', 'Failed to reset password.'));
		} finally {
			busyId = '';
		}
	}

	async function copyCredential(): Promise<void> {
		if (!revealedCredential) return;
		try {
			await navigator.clipboard.writeText(revealedCredential);
			error = '';
			notice = text('凭据已复制。', 'Credential copied.');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : text('复制凭据失败，请手动复制。', 'Copy failed; copy the credential manually.');
		}
	}

	function submit(event: SubmitEvent): void { event.preventDefault(); void save(); }
	onMount(() => { void load(); });
</script>

<svelte:window onkeydown={handleModalKeydown} />

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading">
		<div><p class="eyebrow">{getAppName()} / Organization</p><h1>{text('员工管理', 'Employees')}</h1><p>{text('管理员工身份、岗位、账号状态和专属虚拟密钥。员工通过独立门户查看本人用量。', 'Manage employee identity, role, status, and dedicated virtual key. Employees use a separate self-service portal.')}</p></div>
		<div class="heading-actions"><a class="secondary" href="/employee" target="_blank" rel="noreferrer">{text('员工门户', 'Employee portal')}</a><button class="secondary" type="button" onclick={() => void load()} disabled={loading}>{text('刷新', 'Refresh')}</button><button class="primary" type="button" onclick={openCreate}>{text('新增员工', 'Add employee')}</button></div>
	</header>

	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	{#if revealedCredential}
		<div class="credential" role="status"><div><strong>{text('一次性登录凭据', 'One-time login credential')}</strong><code>{revealedCredential}</code><small>{text('关闭后无法再次查看密码。', 'The password cannot be viewed again after closing.')}</small></div><button type="button" onclick={() => void copyCredential()}>{text('复制', 'Copy')}</button><button type="button" onclick={() => (revealedCredential = '')}>{text('关闭', 'Close')}</button></div>
	{/if}

	<div class="toolbar"><input type="search" bind:value={search} placeholder={text('搜索姓名、用户名、部门或岗位', 'Search name, username, department, or role')} /><span>{filteredEmployees.length} {text('名员工', 'employees')}</span></div>
	<div class="table-wrap" aria-busy={loading}>
		<table><thead><tr><th>{text('员工', 'Employee')}</th><th>{text('部门 / 岗位', 'Department / role')}</th><th>{text('适用软件', 'Applications')}</th><th>{text('专属密钥', 'Dedicated key')}</th><th>{text('状态', 'Status')}</th><th>{text('操作', 'Actions')}</th></tr></thead>
		<tbody>{#each filteredEmployees as employee (stringValue(employee, 'id'))}<tr><td><strong>{stringValue(employee, 'name')}</strong><small>@{stringValue(employee, 'username')}</small></td><td>{stringValue(employee, 'department') || '—'}<small>{stringValue(employee, 'job_title') || '—'}</small></td><td>{stringValue(employee, 'applications') || '—'}<small>{stringValue(employee, 'account_type') || '—'}</small></td><td>{assignedKeyName(employee)}</td><td><span class:active={boolValue(employee, 'is_active')} class="status">{boolValue(employee, 'is_active') ? text('启用', 'Active') : text('停用', 'Disabled')}</span></td><td class="actions"><button type="button" onclick={() => openEdit(employee)}>{text('编辑', 'Edit')}</button><button type="button" disabled={busyId === stringValue(employee, 'id')} onclick={() => void resetPassword(employee)}>{text('重置密码', 'Reset password')}</button></td></tr>{:else}<tr><td colspan="6" class="empty">{loading ? text('正在加载…', 'Loading…') : text('暂无员工。', 'No employees.')}</td></tr>{/each}</tbody></table>
	</div>
</section>

{#if modalOpen}
	<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.currentTarget === event.target) closeModal(); }}>
		<div bind:this={modalElement} class="modal" role="dialog" aria-modal="true" aria-labelledby="employee-modal-title" tabindex="-1">
			<header><div><p class="eyebrow">IDENTITY</p><h2 id="employee-modal-title">{editing ? text('编辑员工', 'Edit employee') : text('新增员工', 'Add employee')}</h2></div><button class="icon-button" type="button" aria-label={text('关闭', 'Close')} title={text('关闭', 'Close')} onclick={closeModal}>×</button></header>
			<form onsubmit={submit}>
				<div class="form-grid"><label>{text('用户名', 'Username')}<input bind:value={form.username} autocomplete="off" placeholder="name.code" /></label><label>{text('姓名', 'Name')}<input bind:value={form.name} /></label><label>{text('部门', 'Department')}<input bind:value={form.department} /></label><label>{text('职务 / 岗位', 'Job title')}<input bind:value={form.jobTitle} /></label><label>{text('适用软件', 'Applications')}<input bind:value={form.applications} /></label><label>{text('账号类型', 'Account type')}<input bind:value={form.accountType} /></label><label class="wide">{text('专属虚拟密钥', 'Dedicated virtual key')}<select bind:value={form.virtualKeyId} disabled={editing !== null}><option value="">{text('请选择', 'Select')}</option>{#each virtualKeys as key (stringValue(key, 'id'))}<option value={stringValue(key, 'id')}>{stringValue(key, 'name')} · {stringValue(key, 'id')}</option>{/each}</select><small>{editing ? text('创建后不可解绑或转移；如需更换，请由管理员执行受控迁移。', 'Assignments cannot be removed or transferred after creation.') : text('每名员工必须绑定一个专属 Key。', 'Each employee requires one dedicated key.')}</small></label><label class="toggle wide"><input type="checkbox" bind:checked={form.isActive} /><span>{text('账号启用', 'Account active')}</span></label></div>
				<footer><button class="secondary" type="button" onclick={closeModal}>{text('取消', 'Cancel')}</button><button class="primary" type="submit" disabled={saving}>{saving ? text('保存中…', 'Saving…') : text('保存', 'Save')}</button></footer>
			</form>
		</div>
	</div>
{/if}

<style>
	.page-shell { display: grid; gap: 1rem; padding: 1.25rem; }
	.page-heading { align-items: flex-start; display: flex; gap: 1rem; justify-content: space-between; }
	.page-heading h1 { font-size: 1.45rem; margin: .15rem 0 .3rem; }
	.page-heading p { color: var(--muted-foreground); margin: 0; max-width: 52rem; }
	.eyebrow { color: var(--primary) !important; font-size: .7rem; font-weight: 800; text-transform: uppercase; }
	.heading-actions, .actions, .modal footer { display: flex; flex-wrap: wrap; gap: .5rem; }
	button, a.secondary { border: 1px solid var(--border); border-radius: .45rem; cursor: pointer; font: inherit; font-weight: 650; padding: .55rem .75rem; text-decoration: none; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.secondary, a.secondary, td button { background: var(--background); color: var(--foreground); }
	button:disabled { cursor: not-allowed; opacity: .55; }
	.notice, .credential { border: 1px solid var(--border); border-radius: .5rem; padding: .8rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, #16824b 10%, transparent); color: #11683c; }
	.credential { align-items: center; background: color-mix(in oklch, var(--primary) 8%, var(--background)); display: flex; gap: .75rem; }
	.credential > div { display: grid; flex: 1; gap: .25rem; }
	.credential code { white-space: pre-line; }
	.credential small, td small { color: var(--muted-foreground); display: block; margin-top: .2rem; }
	.toolbar { align-items: center; display: flex; gap: 1rem; justify-content: space-between; }
	.toolbar input { max-width: 32rem; width: 100%; }
	input, select { background: var(--background); border: 1px solid var(--border); border-radius: .45rem; color: var(--foreground); min-height: 2.45rem; padding: .5rem .65rem; }
	.table-wrap { border: 1px solid var(--border); border-radius: .5rem; overflow: auto; }
	table { border-collapse: collapse; min-width: 920px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); padding: .75rem; text-align: left; vertical-align: middle; }
	th { background: var(--muted); font-size: .75rem; }
	.status { color: var(--muted-foreground); font-weight: 700; }
	.status.active { color: #16824b; }
	.empty { color: var(--muted-foreground); text-align: center; }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .48); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 50; }
	.modal { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; max-height: calc(100vh - 2rem); max-width: 760px; overflow: auto; padding: 1rem; width: 100%; }
	.modal header { align-items: center; display: flex; justify-content: space-between; }
	.modal h2 { font-size: 1.15rem; margin: .1rem 0; }
	.icon-button { align-items: center; background: transparent; display: inline-flex; font-size: 1.25rem; height: 2.25rem; justify-content: center; padding: 0; width: 2.25rem; }
	.form-grid { display: grid; gap: .8rem; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 1rem; }
	.form-grid label { display: grid; font-size: .8rem; font-weight: 700; gap: .35rem; }
	.form-grid .wide { grid-column: 1 / -1; }
	.toggle { align-items: center; display: flex !important; grid-template-columns: auto 1fr; }
	.toggle input { min-height: auto; }
	.modal footer { justify-content: flex-end; margin-top: 1rem; }
	@media (max-width: 760px) { .page-heading { display: grid; } .form-grid { grid-template-columns: 1fr; } .form-grid .wide { grid-column: auto; } .credential { align-items: stretch; display: grid; } }
</style>
