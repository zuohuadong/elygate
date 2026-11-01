<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getAppName } from '../lib/branding';
	import { requestJson } from '../lib/api';
	import { displayError } from '../lib/forms';
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
			switches = mcpKillSwitchesFromPayload(await requestJson<unknown>('/api/governance/mcp/kill-switches'));
		} catch (cause) {
			error = displayError(cause, text('Kill Switch 加载失败。', 'Failed to load kill switches.'));
		} finally {
			isLoading = false;
		}
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
