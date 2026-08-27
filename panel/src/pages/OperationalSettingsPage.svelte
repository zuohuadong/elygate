<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getListPayload, requestJson, type JsonRecord } from '../lib/api';
	import { displayError } from '../lib/forms';
	import { columnValueFor } from '../lib/columns';
	import {
		ALLOWED_LOGO_MIME_TYPES,
		MAX_LOGO_BYTES,
		USER_AGENT_MATCH_TYPES,
		buildUserAgentPayload,
		emptyUserAgentDraft,
		logoDataUrl,
		userAgentDraftFromRecord,
		type UserAgentDraft,
	} from '../lib/operational-settings';

	interface Props { resourceName: string; }

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let records = $state.raw<JsonRecord[]>([]);
	let search = $state('');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let busyId = $state('');
	let error = $state('');
	let notice = $state('');
	let modalOpen = $state(false);
	let editingId = $state('');
	let draft = $state<UserAgentDraft>(emptyUserAgentDraft());
	const isFeatureFlags = $derived(resourceName === 'feature-flags');
	const filtered = $derived.by(() => {
		const query = search.trim().toLowerCase();
		if (!query) return records;
		return records.filter((record) => [record.id, record.display_name, record.description, record.pattern, record.app, record.match_type]
			.some((value) => typeof value === 'string' && value.toLowerCase().includes(query)));
	});

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function idOf(record: JsonRecord): string { return typeof record.id === 'string' ? record.id : ''; }
	function titleOf(record: JsonRecord): string {
		if (typeof record.display_name === 'string' && record.display_name) return record.display_name;
		if (typeof record.app === 'string' && record.app) return record.app;
		return idOf(record);
	}
	function validationMessage(cause: unknown): string {
		if (!(cause instanceof Error)) return text('保存失败。', 'Failed to save.');
		if (cause.message === 'pattern-required') return text('匹配模式不能为空。', 'Pattern is required.');
		if (cause.message === 'app-required') return text('应用名称不能为空。', 'App name is required.');
		if (cause.message === 'regex-invalid') return text('正则表达式无效。', 'The regular expression is invalid.');
		if (cause.message === 'logo-type') return text('Logo 仅支持 PNG、JPEG、WebP 或 GIF。', 'Logo must be PNG, JPEG, WebP, or GIF.');
		return cause.message;
	}

	async function load(): Promise<void> {
		isLoading = true; error = '';
		try { records = getListPayload(await requestJson<unknown>(isFeatureFlags ? '/api/feature-flags' : '/api/logs/user-agent-mappings')); }
		catch (cause) { error = displayError(cause, text('设置加载失败。', 'Failed to load settings.')); }
		finally { isLoading = false; }
	}

	async function toggleFeature(flag: JsonRecord): Promise<void> {
		const id = idOf(flag); if (!id || busyId || flag.locked === true || flag.registered === false) return;
		busyId = id; error = ''; notice = '';
		try {
			await requestJson<unknown>(`/api/feature-flags/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ enabled: flag.enabled !== true }) });
			notice = flag.enabled === true ? text('Feature Flag 已停用。', 'Feature flag disabled.') : text('Feature Flag 已启用。', 'Feature flag enabled.');
			await load();
		} catch (cause) { error = displayError(cause, text('Feature Flag 更新失败。', 'Failed to update feature flag.')); }
		finally { busyId = ''; }
	}

	function openCreate(): void { editingId = ''; draft = emptyUserAgentDraft(); modalOpen = true; error = ''; }
	function openEdit(record: JsonRecord): void { editingId = idOf(record); draft = userAgentDraftFromRecord(record); modalOpen = true; error = ''; }
	async function saveMapping(): Promise<void> {
		if (isSaving) return;
		isSaving = true; error = ''; notice = '';
		try {
			const payload = buildUserAgentPayload(draft);
			await requestJson<unknown>(editingId ? `/api/logs/user-agent-mappings/${encodeURIComponent(editingId)}` : '/api/logs/user-agent-mappings', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
			modalOpen = false; notice = editingId ? text('映射已更新。', 'Mapping updated.') : text('映射已创建。', 'Mapping created.'); await load();
		} catch (cause) { error = validationMessage(cause); }
		finally { isSaving = false; }
	}
	async function toggleMapping(record: JsonRecord): Promise<void> {
		const id = idOf(record); if (!id || busyId) return;
		busyId = id; error = '';
		try {
			const next = userAgentDraftFromRecord(record); next.isActive = !next.isActive;
			await requestJson<unknown>(`/api/logs/user-agent-mappings/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(buildUserAgentPayload(next)) });
			notice = next.isActive ? text('映射已启用。', 'Mapping enabled.') : text('映射已停用。', 'Mapping disabled.'); await load();
		} catch (cause) { error = displayError(cause, text('状态更新失败。', 'Failed to update status.')); }
		finally { busyId = ''; }
	}
	async function removeMapping(record: JsonRecord): Promise<void> {
		const id = idOf(record); if (!id || busyId || !window.confirm(text(`确认删除 ${titleOf(record)} 的映射？`, `Delete the mapping for ${titleOf(record)}?`))) return;
		busyId = id; error = '';
		try { await requestJson<unknown>(`/api/logs/user-agent-mappings/${encodeURIComponent(id)}`, { method: 'DELETE' }); notice = text('映射已删除。', 'Mapping deleted.'); await load(); }
		catch (cause) { error = displayError(cause, text('删除失败。', 'Failed to delete.')); }
		finally { busyId = ''; }
	}

	async function selectLogo(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0]; input.value = '';
		if (!file) return;
		if (file.size > MAX_LOGO_BYTES) { error = text('Logo 不能超过 256 KB。', 'Logo must be 256 KB or smaller.'); return; }
		if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type as typeof ALLOWED_LOGO_MIME_TYPES[number])) { error = text('Logo 仅支持 PNG、JPEG、WebP 或 GIF。', 'Logo must be PNG, JPEG, WebP, or GIF.'); return; }
		try {
			const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result ?? '')); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
			draft.logo = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl; draft.logoMime = file.type;
		} catch { error = text('Logo 文件读取失败。', 'Failed to read logo file.'); }
	}

	onMount(() => { void load(); });
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading"><div><p class="eyebrow">{getAppName()} / {i18n.t(isFeatureFlags ? 'elygate.system' : 'elygate.observability')}</p><h1>{isFeatureFlags ? text('功能开关', 'Feature flags') : text('UA 映射', 'UA mappings')}</h1><p>{isFeatureFlags ? text('查看代码注册、数据库、远程配置与 config.json/Helm 的最终来源；锁定或未注册项不会被误切换。', 'Inspect effective values from code defaults, database, remote config, and config.json/Helm; locked or unregistered flags cannot be toggled.') : text('将请求 User-Agent 识别为日志中的应用名称和安全的栅格 Logo，支持包含、前缀、精确和正则匹配。', 'Map request User-Agent values to app names and safe raster logos in logs using contains, prefix, exact, or regex matching.')}</p></div>{#if !isFeatureFlags}<button class="primary" type="button" onclick={openCreate}>+ {text('添加映射', 'Add mapping')}</button>{/if}</header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<div class="toolbar"><label>{text('搜索', 'Search')}<input bind:value={search} placeholder={isFeatureFlags ? text('名称、ID 或说明', 'Name, ID, or description') : text('模式、应用或类型', 'Pattern, app, or type')} /></label><button type="button" onclick={() => void load()}>{text('刷新', 'Refresh')}</button></div>
	{#if isFeatureFlags}
		<div class="flag-list" class:loading={isLoading}>{#each filtered as flag (idOf(flag))}<article><div class="flag-main"><div class="flag-title"><strong>{titleOf(flag)}</strong>{#if flag.display_name}<code>{idOf(flag)}</code>{/if}<span class="badge">{String(flag.source ?? 'default')}</span>{#if flag.enterprise_only === true}<span class="badge enterprise">Enterprise</span>{/if}{#if flag.locked === true}<span class="badge locked">🔒 {text('已锁定', 'Locked')}</span>{/if}{#if flag.registered === false}<span class="badge stale">{text('未注册', 'Unregistered')}</span>{/if}</div><p>{String(flag.description ?? '')}</p>{#if flag.registered === false}<small>{text('该值已存储但当前没有代码调用 Register；恢复注册或清理外部覆盖。', 'This value is stored but no code currently registers it; restore registration or remove the external override.')}</small>{/if}{#if flag.locked === true}<small>{text('值由 config.json 或 Helm 固定，请修改部署配置。', 'The value is pinned by config.json or Helm; edit deployment configuration.')}</small>{/if}</div><button class:enabled={flag.enabled === true} class="toggle" type="button" disabled={busyId === idOf(flag) || flag.locked === true || flag.registered === false} onclick={() => void toggleFeature(flag)}>{flag.enabled === true ? text('已启用', 'Enabled') : text('已停用', 'Disabled')}</button></article>{:else}<div class="empty">{isLoading ? text('加载中…', 'Loading…') : text('暂无功能开关。', 'No feature flags.')}</div>{/each}</div>
	{:else}
		<div class="table-wrap" class:loading={isLoading}><table><thead><tr><th>{text('模式', 'Pattern')}</th><th>{text('匹配', 'Match')}</th><th>{text('应用', 'App')}</th><th>Logo</th><th>{text('状态', 'Status')}</th><th>{text('操作', 'Actions')}</th></tr></thead><tbody>{#each filtered as mapping (idOf(mapping))}<tr><td><code>{String(mapping.pattern ?? '')}</code></td><td><span class="badge">{columnValueFor(i18n.locale === 'zh-CN' ? 'zh-CN' : 'en', 'match_type', mapping.match_type)}</span></td><td>{titleOf(mapping)}</td><td>{#if logoDataUrl(mapping)}<img class="logo" src={logoDataUrl(mapping)} alt={titleOf(mapping)} />{:else}—{/if}</td><td><button class:enabled={mapping.is_active !== false} class="toggle" type="button" disabled={busyId === idOf(mapping)} onclick={() => void toggleMapping(mapping)}>{mapping.is_active !== false ? text('启用', 'Active') : text('停用', 'Inactive')}</button></td><td><div class="actions"><button type="button" onclick={() => openEdit(mapping)}>{text('编辑', 'Edit')}</button><button class="danger" type="button" disabled={busyId === idOf(mapping)} onclick={() => void removeMapping(mapping)}>{text('删除', 'Delete')}</button></div></td></tr>{:else}<tr><td class="empty" colspan="6">{isLoading ? text('加载中…', 'Loading…') : text('没有匹配的映射。', 'No matching mappings.')}</td></tr>{/each}</tbody></table></div>
	{/if}
</section>

{#if modalOpen}
		<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !isSaving) modalOpen = false; }}><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mapping-modal-title"><header><div><h2 id="mapping-modal-title">{editingId ? text('编辑 UA 映射', 'Edit UA mapping') : text('添加 UA 映射', 'Add UA mapping')}</h2><p>{text('正则在保存前由浏览器校验；不活跃映射会保留但不参与识别。', 'Regex is validated before saving; inactive mappings remain stored but do not participate in detection.')}</p></div><button type="button" aria-label={text('关闭', 'Close')} onclick={() => (modalOpen = false)}>×</button></header><div class="form-grid"><label>{text('匹配模式', 'Pattern')}<input bind:value={draft.pattern} placeholder={draft.matchType === 'regex' ? '^Codex/' : 'Codex'} /></label><label>{text('匹配类型', 'Match type')}<select bind:value={draft.matchType}>{#each USER_AGENT_MATCH_TYPES as type (type)}<option value={type}>{columnValueFor(i18n.locale === 'zh-CN' ? 'zh-CN' : 'en', 'match_type', type)}</option>{/each}</select></label><label class="span-2">{text('应用名称', 'App name')}<input bind:value={draft.app} placeholder="Codex" /></label><label class="check span-2"><input type="checkbox" bind:checked={draft.isActive} /><span><strong>{text('启用映射', 'Active mapping')}</strong><small>{text('停用后仍保存，但日志识别会忽略。', 'When inactive it remains stored but log detection ignores it.')}</small></span></label><fieldset class="span-2"><legend>Logo</legend><div class="logo-editor">{#if draft.logo && draft.logoMime}<img class="logo preview" src={`data:${draft.logoMime};base64,${draft.logo}`} alt="" />{/if}<label class="upload">{text('选择图片', 'Choose image')}<input type="file" accept={ALLOWED_LOGO_MIME_TYPES.join(',')} onchange={(event) => void selectLogo(event)} /></label><button type="button" disabled={!draft.logo} onclick={() => { draft.logo = ''; draft.logoMime = ''; }}>{text('移除', 'Remove')}</button></div><small>{text('最多 256 KB；仅 PNG、JPEG、WebP、GIF，不接受可执行 SVG。', 'Maximum 256 KB; PNG, JPEG, WebP, or GIF only; executable SVG is not accepted.')}</small></fieldset></div><footer><button type="button" onclick={() => (modalOpen = false)}>{text('取消', 'Cancel')}</button><button class="primary" type="button" disabled={isSaving} onclick={() => void saveMapping()}>{isSaving ? text('保存中…', 'Saving…') : text('保存', 'Save')}</button></footer></div></div>
{/if}

<style>
	.page-shell { margin: 0 auto; max-width: 1260px; padding: 1.5rem; }
	.page-heading, .modal > header, .modal > footer, .toolbar, .actions, .flag-title, .logo-editor { align-items: center; display: flex; flex-wrap: wrap; gap: .6rem; justify-content: space-between; }
	.page-heading { align-items: start; }
	.page-heading h1, .modal h2 { margin: 0; }
	.page-heading p, .modal header p { color: var(--muted-foreground); margin: .42rem 0 0; max-width: 850px; }
	.eyebrow { color: var(--primary) !important; font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
	button, input, select, fieldset { border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); font: inherit; }
	button, select { background: var(--muted); cursor: pointer; padding: .55rem .7rem; }
	input { background: var(--background); padding: .6rem .7rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	button:disabled { cursor: not-allowed; opacity: .5; }
	.notice { border-radius: .65rem; margin-top: .8rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 10%, transparent); color: var(--primary); }
	.toolbar { justify-content: start; margin: 1rem 0 .8rem; }
	.toolbar label, .form-grid label { color: var(--muted-foreground); display: grid; font-size: .75rem; gap: .3rem; }
	.toolbar input { min-width: 280px; }
	.flag-list { display: grid; gap: .65rem; opacity: 1; }
	.flag-list.loading, .table-wrap.loading { opacity: .65; }
	.flag-list article { align-items: start; background: var(--card); border: 1px solid var(--border); border-radius: .75rem; display: grid; gap: .8rem; grid-template-columns: minmax(0, 1fr) auto; padding: .9rem; }
	.flag-title { justify-content: start; }
	.flag-main p, .flag-main small { color: var(--muted-foreground); display: block; margin: .35rem 0 0; }
	.flag-main small { font-size: .72rem; }
	.badge { background: var(--muted); border-radius: 999px; font-size: .68rem; padding: .2rem .48rem; }
	.badge.enterprise { color: var(--primary); }
	.badge.stale { color: var(--destructive); }
	.toggle.enabled { color: var(--primary); }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; overflow-x: auto; }
	table { border-collapse: collapse; min-width: 860px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); font-size: .78rem; padding: .7rem .8rem; text-align: left; }
	th { color: var(--muted-foreground); }
	.logo { border: 1px solid var(--border); border-radius: .35rem; height: 2rem; object-fit: contain; width: 2rem; }
	.logo.preview { height: 3rem; width: 3rem; }
	.empty { color: var(--muted-foreground); padding: 2rem; text-align: center; }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .55); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; display: grid; gap: 1rem; max-height: 92vh; max-width: 720px; overflow: auto; padding: 1.15rem; width: 100%; }
	.modal > footer { border-top: 1px solid var(--border); justify-content: end; padding-top: .9rem; }
	.form-grid { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-grid input, .form-grid select { width: 100%; }
	.span-2 { grid-column: 1 / -1; }
	label.check { align-items: start; display: flex; gap: .55rem; }
	label.check input { margin-top: .2rem; width: auto; }
	label.check span, label.check small { display: block; }
	label.check small, fieldset small { color: var(--muted-foreground); }
	fieldset { padding: .8rem; }
	fieldset legend { color: var(--muted-foreground); font-size: .75rem; padding: 0 .3rem; }
	.upload { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; cursor: pointer; padding: .5rem; }
	.upload input { display: none; }
	@media (max-width: 680px) { .page-shell { padding: 1rem; } .page-heading { align-items: stretch; flex-direction: column; } .form-grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } .flag-list article { grid-template-columns: 1fr; } .toolbar label, .toolbar input { width: 100%; } }
</style>
