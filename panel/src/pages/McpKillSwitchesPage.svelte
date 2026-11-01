<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getAppName } from '../lib/branding';
	import { requestJson } from '../lib/api';
	import { displayError } from '../lib/forms';
	import {
		buildMcpApprovalPayload,
		emptyMcpApprovalDraft,
		mcpApprovalsFromPayload,
		type McpApprovalDraft,
		type McpApprovalRecord,
	} from '../lib/mcp-approval';
	import {
		buildMcpKillSwitchPayload,
		emptyMcpKillSwitchDraft,
		mcpKillSwitchDraftFromRecord,
		mcpKillSwitchesFromPayload,
		MCP_KILL_SWITCH_SCOPES,
		type McpKillSwitchDraft,
		type McpKillSwitchRecord,
		type McpKillSwitchScope,
	} from '../lib/mcp-kill-switch';

	interface Props { resourceName: string; }

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let switches = $state<McpKillSwitchRecord[]>([]);
	let draft = $state<McpKillSwitchDraft>(emptyMcpKillSwitchDraft());
	let editingKey = $state('');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let busyKey = $state('');
	let error = $state('');
	let notice = $state('');
	let approvals = $state<McpApprovalRecord[]>([]);
	let approvalDraft = $state<McpApprovalDraft>(emptyMcpApprovalDraft());
	let isIssuingApproval = $state(false);
	let approvalBusyID = $state('');
	let issuedToken = $state('');

	function text(zh: string, en: string): string {
		return i18n.locale === 'zh-CN' ? zh : en;
	}

	function keyOf(rule: Pick<McpKillSwitchRecord, 'scope' | 'target'>): string {
		return `${rule.scope}:${rule.target}`;
	}

	function scopeLabel(scope: McpKillSwitchScope): string {
		const labels: Record<McpKillSwitchScope, [string, string]> = {
			global: ['全局', 'Global'],
			tenant: ['租户', 'Tenant'],
			agent: ['Agent', 'Agent'],
			application: ['应用', 'Application'],
			tool: ['工具', 'Tool'],
		};
		const [zh, en] = labels[scope];
		return text(zh, en);
	}

	function dateLabel(value: string | null | undefined, emptyLabel = text('永不过期', 'Never')): string {
		if (!value) return emptyLabel;
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString(i18n.locale === 'zh-CN' ? 'zh-CN' : 'en-US');
	}

	function resetDraft(): void {
		draft = emptyMcpKillSwitchDraft();
		editingKey = '';
	}

	function resetApprovalDraft(): void {
		approvalDraft = emptyMcpApprovalDraft();
	}

	function approvalDate(value: string): string {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString(i18n.locale === 'zh-CN' ? 'zh-CN' : 'en-US');
	}

	function editRule(rule: McpKillSwitchRecord): void {
		draft = mcpKillSwitchDraftFromRecord(rule);
		editingKey = keyOf(rule);
		error = '';
		notice = '';
		document.getElementById('mcp-kill-switch-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const [killSwitchPayload, approvalPayload] = await Promise.all([
				requestJson<unknown>('/api/governance/mcp/kill-switches'),
				requestJson<unknown>('/api/governance/mcp/approvals'),
			]);
			switches = mcpKillSwitchesFromPayload(killSwitchPayload);
			approvals = mcpApprovalsFromPayload(approvalPayload);
		} catch (cause) {
			error = displayError(cause, text('MCP 治理数据加载失败。', 'Failed to load MCP governance data.'));
		} finally {
			isLoading = false;
		}
	}

	async function issueApproval(): Promise<void> {
		if (isIssuingApproval) return;
		isIssuingApproval = true;
		error = '';
		notice = '';
		issuedToken = '';
		try {
			const response = await requestJson<{
				approval?: McpApprovalRecord;
				token?: string;
			}>('/api/governance/mcp/approvals', {
				method: 'POST',
				body: JSON.stringify(buildMcpApprovalPayload(approvalDraft)),
			});
			if (!response.approval || typeof response.token !== 'string' || !response.token) throw new Error('malformed-response');
			approvals = [response.approval, ...approvals];
			issuedToken = response.token;
			resetApprovalDraft();
			notice = text('审批已签发。令牌只显示这一次。', 'Approval issued. The token is shown once.');
		} catch (cause) {
			if (cause instanceof Error) {
				const messages: Record<string, [string, string]> = {
					'client-required': ['必须填写 MCP client。', 'MCP client is required.'],
					'tool-required': ['必须填写工具名。', 'Tool name is required.'],
					'target-too-long': ['client 和工具名不能超过 255 个字符。', 'Client and tool names must be 255 characters or fewer.'],
					'ttl-invalid': ['有效期必须是 1 到 900 秒。', 'TTL must be between 1 and 900 seconds.'],
					'reason-too-long': ['原因不能超过 512 个字符。', 'Reason must be 512 characters or fewer.'],
					'malformed-response': ['服务端返回了无效审批。', 'The server returned a malformed approval.'],
				};
				const message = messages[cause.message];
				error = message ? text(...message) : displayError(cause, text('审批签发失败。', 'Failed to issue approval.'));
			} else {
				error = displayError(cause, text('审批签发失败。', 'Failed to issue approval.'));
			}
		} finally {
			isIssuingApproval = false;
		}
	}

	async function revokeApproval(approval: McpApprovalRecord): Promise<void> {
		if (approvalBusyID || isIssuingApproval || !window.confirm(text(`撤销 ${approval.client_name}/${approval.tool_name} 的审批？`, `Revoke approval for ${approval.client_name}/${approval.tool_name}?`))) return;
		approvalBusyID = approval.id;
		error = '';
		notice = '';
		try {
			await requestJson<unknown>(`/api/governance/mcp/approvals/${encodeURIComponent(approval.id)}`, { method: 'DELETE' });
			approvals = approvals.map((entry) => entry.id === approval.id
				? { ...entry, revoked_at: new Date().toISOString(), status: 'revoked' }
				: entry);
			notice = text('审批已撤销。', 'Approval revoked.');
		} catch (cause) {
			error = displayError(cause, text('审批撤销失败。', 'Failed to revoke approval.'));
		} finally {
			approvalBusyID = '';
		}
	}

	async function copyIssuedToken(): Promise<void> {
		if (!issuedToken || !navigator.clipboard) return;
		await navigator.clipboard.writeText(issuedToken);
		notice = text('令牌已复制。', 'Token copied.');
	}

	function validationMessage(cause: unknown): string {
		if (!(cause instanceof Error)) return text('保存失败。', 'Failed to save.');
		const messages: Record<string, [string, string]> = {
			'target-required': ['非全局范围必须填写目标。', 'A target is required for non-global scopes.'],
			'target-too-long': ['目标不能超过 255 个字符。', 'Targets must be 255 characters or fewer.'],
			'reason-too-long': ['原因不能超过 512 个字符。', 'Reasons must be 512 characters or fewer.'],
			'expires-invalid': ['过期时间无效。', 'The expiration time is invalid.'],
		};
		const message = messages[cause.message];
		return message ? text(...message) : cause.message;
	}

	async function save(): Promise<void> {
		if (isSaving) return;
		isSaving = true;
		error = '';
		notice = '';
		try {
			const payload = buildMcpKillSwitchPayload(draft);
			const response = await requestJson<unknown>('/api/governance/mcp/kill-switches', {
				method: 'PUT',
				body: JSON.stringify(payload),
			});
			switches = mcpKillSwitchesFromPayload(response);
			notice = editingKey
				? text('Kill Switch 已更新。', 'Kill switch updated.')
				: text('Kill Switch 已创建。', 'Kill switch created.');
			resetDraft();
		} catch (cause) {
			error = validationMessage(cause);
		} finally {
			isSaving = false;
		}
	}

	async function toggle(rule: McpKillSwitchRecord): Promise<void> {
		const key = keyOf(rule);
		if (busyKey || isSaving) return;
		busyKey = key;
		error = '';
		notice = '';
		try {
			const response = await requestJson<unknown>('/api/governance/mcp/kill-switches', {
				method: 'PUT',
				body: JSON.stringify({
					scope: rule.scope,
					target: rule.target,
					enabled: !rule.enabled,
					reason: rule.reason ?? '',
					...(rule.expires_at ? { expires_at: rule.expires_at } : {}),
				}),
			});
			switches = mcpKillSwitchesFromPayload(response);
			notice = rule.enabled
				? text('Kill Switch 已停用。', 'Kill switch disabled.')
				: text('Kill Switch 已启用。', 'Kill switch enabled.');
		} catch (cause) {
			error = displayError(cause, text('状态更新失败。', 'Failed to update status.'));
		} finally {
			busyKey = '';
		}
	}

	async function remove(rule: McpKillSwitchRecord): Promise<void> {
		const key = keyOf(rule);
		if (busyKey || isSaving || !window.confirm(text(`确认删除 ${scopeLabel(rule.scope)} Kill Switch？`, `Delete the ${scopeLabel(rule.scope)} kill switch?`))) return;
		busyKey = key;
		error = '';
		notice = '';
		try {
			const params = new URLSearchParams({ scope: rule.scope, target: rule.target });
			await requestJson<unknown>(`/api/governance/mcp/kill-switches?${params.toString()}`, { method: 'DELETE' });
			switches = switches.filter((entry) => keyOf(entry) !== key);
			if (editingKey === key) resetDraft();
			notice = text('Kill Switch 已删除。', 'Kill switch deleted.');
		} catch (cause) {
			error = displayError(cause, text('删除失败。', 'Failed to delete.'));
		} finally {
			busyKey = '';
		}
	}

	function setScope(scope: McpKillSwitchScope): void {
		draft.scope = scope;
		if (scope === 'global') draft.target = '*';
		else if (draft.target === '*') draft.target = '';
	}

	onMount(() => { void load(); });
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading">
		<div>
			<p class="eyebrow">{getAppName()} / {i18n.t('elygate.mcp')}</p>
			<h1>{text('MCP Kill Switch', 'MCP kill switches')}</h1>
			<p>{text('按全局、租户、Agent、应用或工具紧急阻断 MCP 执行；停用或设置过期时间可保留审计上下文而不再拦截请求。', 'Emergency-block MCP execution by global, tenant, agent, application, or tool scope. Disable a rule or set an expiry to retain audit context without blocking requests.')}</p>
		</div>
		<button type="button" onclick={() => void load()} disabled={isLoading || !!busyKey}>{text('刷新', 'Refresh')}</button>
	</header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}

	<section class="editor" id="mcp-kill-switch-editor" aria-labelledby="mcp-kill-switch-editor-title">
		<header><div><h2 id="mcp-kill-switch-editor-title">{editingKey ? text('编辑 Kill Switch', 'Edit kill switch') : text('新增 Kill Switch', 'Add kill switch')}</h2><p>{text('目标值必须与请求上下文中的上游 Bifrost 标识一致；全局范围使用 *。', 'Targets must match identifiers from the upstream Bifrost request context; global scope uses *.')}</p></div>{#if editingKey}<button type="button" onclick={resetDraft} disabled={isSaving || !!busyKey}>{text('取消编辑', 'Cancel edit')}</button>{/if}</header>
		<form onsubmit={(event) => { event.preventDefault(); void save(); }}>
			<div class="form-grid">
				<label>{text('范围', 'Scope')}<select value={draft.scope} onchange={(event) => setScope((event.currentTarget as HTMLSelectElement).value as McpKillSwitchScope)} disabled={isSaving || !!busyKey}>{#each MCP_KILL_SWITCH_SCOPES as scope (scope)}<option value={scope}>{scopeLabel(scope)}</option>{/each}</select></label>
				<label>{text('目标', 'Target')}<input bind:value={draft.target} disabled={draft.scope === 'global' || isSaving || !!busyKey} placeholder={draft.scope === 'global' ? '*' : text('输入上游标识', 'Upstream identifier')} /></label>
				<label class="check"><input type="checkbox" bind:checked={draft.enabled} disabled={isSaving || !!busyKey} /><span><strong>{text('启用阻断', 'Blocking enabled')}</strong><small>{text('停用规则仍保留，便于恢复和审计。', 'Disabled rules remain stored for recovery and audit.')}</small></span></label>
				<label>{text('过期时间（可选）', 'Expires at (optional)')}<input type="datetime-local" bind:value={draft.expiresAt} disabled={isSaving || !!busyKey} /><small>{text('留空表示永不过期。', 'Leave blank for no expiry.')}</small></label>
				<label class="span-2">{text('原因', 'Reason')}<textarea rows="3" bind:value={draft.reason} maxlength="512" disabled={isSaving || !!busyKey} placeholder={text('例如：供应商故障，临时阻断写入工具。', 'For example: provider incident; temporarily block write tools.')}></textarea></label>
			</div>
			<footer><button class="primary" type="submit" disabled={isSaving || !!busyKey}>{isSaving ? text('保存中…', 'Saving…') : editingKey ? text('更新', 'Update') : text('创建', 'Create')}</button></footer>
		</form>
	</section>

	<section class="table-wrap" class:loading={isLoading}>
		<table>
			<thead><tr><th>{text('范围', 'Scope')}</th><th>{text('目标', 'Target')}</th><th>{text('状态', 'Status')}</th><th>{text('原因', 'Reason')}</th><th>{text('过期时间', 'Expires')}</th><th>{text('更新时间', 'Updated')}</th><th>{text('操作', 'Actions')}</th></tr></thead>
			<tbody>
				{#each switches as rule (keyOf(rule))}
					{@const key = keyOf(rule)}
					<tr class:disabled-row={!rule.enabled}>
						<td><span class="badge">{scopeLabel(rule.scope)}</span></td>
						<td><code>{rule.target}</code></td>
						<td><button class:enabled={rule.enabled} class="status-button" type="button" disabled={busyKey === key || isSaving} onclick={() => void toggle(rule)}>{rule.enabled ? text('已启用', 'Enabled') : text('已停用', 'Disabled')}</button></td>
						<td class="reason">{rule.reason || '—'}</td>
						<td>{dateLabel(rule.expires_at)}</td>
						<td>{dateLabel(rule.updated_at, '—')}</td>
						<td><div class="actions"><button type="button" disabled={busyKey === key || isSaving} onclick={() => editRule(rule)}>{text('编辑', 'Edit')}</button><button class="danger" type="button" disabled={busyKey === key || isSaving} onclick={() => void remove(rule)}>{text('删除', 'Delete')}</button></div></td>
					</tr>
				{:else}
					<tr><td class="empty" colspan="7">{isLoading ? text('加载中…', 'Loading…') : text('尚未配置 Kill Switch。', 'No kill switches configured.')}</td></tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section class="editor" aria-labelledby="mcp-approval-editor-title">
		<header>
			<div>
				<h2 id="mcp-approval-editor-title">{text('MCP 短期审批', 'MCP short-term approvals')}</h2>
				<p>{text('仅为精确的 client/tool 签发限时令牌；令牌只返回一次，执行请求通过 x-bf-mcp-approval 携带。', 'Issue a time-limited token for one exact client/tool pair. The token is returned once and sent as x-bf-mcp-approval on execution requests.')}</p>
			</div>
		</header>
		<form onsubmit={(event) => { event.preventDefault(); void issueApproval(); }}>
			<div class="form-grid">
				<label>{text('MCP client', 'MCP client')}<input bind:value={approvalDraft.clientName} disabled={isIssuingApproval || !!approvalBusyID} placeholder="client-name" /></label>
				<label>{text('工具名', 'Tool name')}<input bind:value={approvalDraft.toolName} disabled={isIssuingApproval || !!approvalBusyID} placeholder="client-tool" /></label>
				<label>{text('有效期（秒）', 'TTL (seconds)')}<input type="number" min="1" max="900" step="1" bind:value={approvalDraft.ttlSeconds} disabled={isIssuingApproval || !!approvalBusyID} /></label>
				<label>{text('原因（可选）', 'Reason (optional)')}<input bind:value={approvalDraft.reason} maxlength="512" disabled={isIssuingApproval || !!approvalBusyID} /></label>
			</div>
			<footer><button class="primary" type="submit" disabled={isIssuingApproval || !!approvalBusyID}>{isIssuingApproval ? text('签发中…', 'Issuing…') : text('签发审批', 'Issue approval')}</button></footer>
		</form>
		{#if issuedToken}
			<div class="token-box" role="status">
				<strong>{text('一次性令牌', 'One-time token')}</strong>
				<code>{issuedToken}</code>
				<button type="button" onclick={() => void copyIssuedToken()}>{text('复制', 'Copy')}</button>
			</div>
		{/if}
	</section>

	<section class="table-wrap" class:loading={isLoading}>
		<table>
			<thead><tr><th>{text('MCP client', 'MCP client')}</th><th>{text('工具', 'Tool')}</th><th>{text('状态', 'Status')}</th><th>{text('过期时间', 'Expires')}</th><th>{text('原因', 'Reason')}</th><th>{text('操作', 'Actions')}</th></tr></thead>
			<tbody>
				{#each approvals as approval (approval.id)}
					<tr class:disabled-row={approval.status !== 'active'}>
						<td><code>{approval.client_name}</code></td>
						<td><code>{approval.tool_name}</code></td>
						<td><span class="badge">{approval.status === 'active' ? text('有效', 'Active') : approval.status === 'revoked' ? text('已撤销', 'Revoked') : text('已过期', 'Expired')}</span></td>
						<td>{approvalDate(approval.expires_at)}</td>
						<td class="reason">{approval.reason || '—'}</td>
						<td><button class="danger" type="button" disabled={approval.status !== 'active' || approvalBusyID === approval.id || isIssuingApproval} onclick={() => void revokeApproval(approval)}>{text('撤销', 'Revoke')}</button></td>
					</tr>
				{:else}
					<tr><td class="empty" colspan="6">{isLoading ? text('加载中…', 'Loading…') : text('尚未签发短期审批。', 'No short-term approvals issued.')}</td></tr>
				{/each}
			</tbody>
		</table>
	</section>
</section>

<style>
	.page-shell { display: grid; gap: 1rem; margin: 0 auto; max-width: 1380px; padding: 1.5rem; }
	.page-heading, .editor > header, footer, .actions { align-items: center; display: flex; flex-wrap: wrap; gap: .7rem; justify-content: space-between; }
	.page-heading { align-items: start; }
	.page-heading h1, h2 { margin: 0; }
	.page-heading p, .editor header p, small { color: var(--muted-foreground); margin: .45rem 0 0; max-width: 900px; }
	.eyebrow { color: var(--primary); font-size: .72rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
	button, input, select, textarea { border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); font: inherit; }
	button, select { background: var(--muted); cursor: pointer; padding: .55rem .7rem; }
	input, textarea { background: var(--background); padding: .6rem .7rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	button:disabled { cursor: not-allowed; opacity: .5; }
	.notice { border-radius: .65rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 12%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 12%, transparent); color: var(--primary); }
	.token-box { align-items: center; background: color-mix(in oklch, var(--primary) 10%, transparent); border: 1px solid var(--primary); border-radius: .65rem; display: flex; flex-wrap: wrap; gap: .6rem; padding: .75rem; }
	.token-box code { flex: 1 1 18rem; overflow-wrap: anywhere; }
	.editor { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; display: grid; gap: 1rem; padding: 1rem; }
	.form-grid { display: grid; gap: .8rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-grid label { color: var(--muted-foreground); display: grid; font-size: .78rem; gap: .3rem; }
	.form-grid input, .form-grid select, .form-grid textarea { width: 100%; }
	.span-2 { grid-column: 1 / -1; }
	label.check { align-items: start; display: flex; gap: .55rem; }
	label.check input { margin-top: .2rem; width: auto; }
	label.check span, label.check small { display: block; }
	.editor footer { border-top: 1px solid var(--border); justify-content: end; padding-top: .9rem; }
	.table-wrap { border: 1px solid var(--border); border-radius: .8rem; overflow-x: auto; }
	.table-wrap.loading { opacity: .65; }
	table { border-collapse: collapse; min-width: 980px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); font-size: .78rem; padding: .7rem .8rem; text-align: left; vertical-align: top; }
	th { color: var(--muted-foreground); font-size: .72rem; }
	.badge { background: var(--muted); border-radius: 999px; padding: .2rem .5rem; white-space: nowrap; }
	.status-button.enabled { color: var(--primary); }
	.disabled-row { opacity: .7; }
	.reason { max-width: 26rem; overflow-wrap: anywhere; white-space: normal; }
	.empty { color: var(--muted-foreground); padding: 2rem; text-align: center; }
	@media (max-width: 720px) { .page-shell { padding: 1rem; } .page-heading { align-items: stretch; flex-direction: column; } .form-grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } }
</style>
