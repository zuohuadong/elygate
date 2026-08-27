<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { isJsonRecord, requestJson } from '../lib/api';
	import { displayError } from '../lib/forms';
	import {
		buildCreatePluginPayload,
		buildPluginMutationPayload,
		buildPluginSequence,
		buildPluginSequenceUpdates,
		emptyPluginDraft,
		managedPluginFromRecord,
		movePluginSequence,
		PLUGIN_CAPABILITIES_CHANGED_EVENT,
		pluginDraftFromRecord,
		shouldClosePluginModalFromBackdrop,
		type ManagedPlugin,
		type PluginDraft,
		type PluginKind,
		type PluginSequenceItem,
	} from '../lib/plugin-management';

	interface Props { resourceName: string; }
	type ModalKind = 'editor' | 'sequence' | null;
	type StatusFilter = 'all' | 'active' | 'attention' | 'disabled';

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let plugins = $state.raw<ManagedPlugin[]>([]);
	let builtinNames = $state.raw<string[]>([]);
	let loadedNames = $state.raw<string[]>([]);
	let selectedName = $state('');
	let search = $state('');
	let statusFilter = $state<StatusFilter>('all');
	let typeFilter = $state('');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let busyName = $state('');
	let error = $state('');
	let notice = $state('');
	let modal = $state<ModalKind>(null);
	let editing = $state(false);
	let draft = $state<PluginDraft>(emptyPluginDraft());
	let sequenceItems = $state.raw<PluginSequenceItem[]>([]);
	const featureScoped = $derived(resourceName !== 'plugins');
	const selected = $derived(plugins.find((plugin) => plugin.name === selectedName));
	const selectedDescription = $derived(selected ? pluginDescription(selected) : '');
	const customCount = $derived(plugins.filter((plugin) => plugin.isCustom).length);
	const activeCount = $derived(plugins.filter((plugin) => plugin.status.status === 'active').length);
	const typeOptions = $derived([...new Set(plugins.flatMap((plugin) => plugin.status.types))].sort());
	const availableBuiltinNames = $derived(builtinNames.filter((name) => !plugins.some((plugin) => plugin.name === name)));
	const filteredPlugins = $derived.by(() => {
		const query = search.trim().toLowerCase();
		return plugins.filter((plugin) => {
			const matchesSearch = !query || [plugin.name, plugin.actualName, plugin.description, plugin.descriptionZh, plugin.path, ...plugin.status.types].some((value) => value.toLowerCase().includes(query));
			const bucket = statusBucket(plugin);
			const matchesFeature = !featureScoped || plugin.features.includes(resourceName);
			return matchesFeature && matchesSearch && (statusFilter === 'all' || statusFilter === bucket) && (!typeFilter || plugin.status.types.includes(typeFilter));
		});
	});

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function pluginDescription(plugin: ManagedPlugin): string {
		return i18n.locale === 'zh-CN'
			? plugin.descriptionZh || plugin.description
			: plugin.description || plugin.descriptionZh;
	}
	function stringArray(payload: unknown, key: string): string[] {
		if (!isJsonRecord(payload) || !Array.isArray(payload[key])) return [];
		return payload[key].filter((value): value is string => typeof value === 'string');
	}
	function statusBucket(plugin: ManagedPlugin): Exclude<StatusFilter, 'all'> {
		if (!plugin.enabled || plugin.status.status === 'disabled') return 'disabled';
		return plugin.status.status === 'active' ? 'active' : 'attention';
	}
	function statusLabel(plugin: ManagedPlugin): string {
		if (!plugin.enabled || plugin.status.status === 'disabled') return text('已停用', 'Disabled');
		if (plugin.status.status === 'active') return text('运行中', 'Active');
		if (plugin.status.status === 'uninitialized') return text('未初始化', 'Uninitialized');
		return plugin.status.status || text('需关注', 'Attention');
	}
	function isLoaded(plugin: ManagedPlugin): boolean {
		return loadedNames.includes(plugin.actualName) || loadedNames.includes(plugin.name) || plugin.status.status === 'active';
	}
	function validationMessage(cause: unknown): string {
		if (!(cause instanceof Error)) return text('插件保存失败。', 'Failed to save plugin.');
		if (cause.message === 'name-required') return text('插件名称不能为空。', 'Plugin name is required.');
		if (cause.message === 'name-invalid') return text('名称只能包含字母、数字、连字符和下划线。', 'Name may only contain letters, numbers, hyphens, and underscores.');
		if (cause.message === 'path-required') return text('自定义插件必须填写绝对路径或 HTTP(S) URL。', 'Custom plugins require an absolute path or HTTP(S) URL.');
		if (cause.message === 'path-invalid') return text('插件路径必须以 /、http:// 或 https:// 开头。', 'Plugin path must start with /, http://, or https://.');
		if (cause.message === 'config-object') return text('插件配置必须是 JSON 对象。', 'Plugin configuration must be a JSON object.');
		if (cause.message === 'order-invalid') return text('顺序必须是非负整数。', 'Order must be a non-negative integer.');
		if (cause instanceof SyntaxError) return text('插件配置不是有效 JSON。', 'Plugin configuration is not valid JSON.');
		return cause.message;
	}

	async function load(): Promise<void> {
		isLoading = true; error = '';
		try {
			const [pluginsPayload, builtinsPayload, loadedPayload] = await Promise.all([
				requestJson<unknown>('/api/plugins'),
				requestJson<unknown>('/api/plugins/builtins'),
				requestJson<unknown>('/api/plugins/loaded'),
			]);
			const records = isJsonRecord(pluginsPayload) && Array.isArray(pluginsPayload.plugins) ? pluginsPayload.plugins.filter(isJsonRecord) : [];
			plugins = records.map(managedPluginFromRecord).filter((plugin) => plugin.name);
			builtinNames = stringArray(builtinsPayload, 'plugins').sort();
			loadedNames = stringArray(loadedPayload, 'plugins').sort();
			const scopedPlugins = featureScoped ? plugins.filter((plugin) => plugin.features.includes(resourceName)) : plugins;
			if (!scopedPlugins.some((plugin) => plugin.name === selectedName)) selectedName = scopedPlugins.find((plugin) => plugin.isCustom)?.name ?? scopedPlugins[0]?.name ?? '';
		} catch (cause) { error = displayError(cause, text('插件列表加载失败。', 'Failed to load plugins.')); }
		finally { isLoading = false; }
	}

	function selectPlugin(plugin: ManagedPlugin): void {
		selectedName = plugin.name;
		draft = pluginDraftFromRecord(plugin);
		error = '';
	}
	function notifyCapabilitiesChanged(): void {
		window.dispatchEvent(new Event(PLUGIN_CAPABILITIES_CHANGED_EVENT));
	}
	function openCreate(kind: PluginKind): void {
		editing = false;
		draft = emptyPluginDraft(kind === 'builtin' ? availableBuiltinNames : []);
		draft.kind = kind;
		if (kind === 'custom') draft.name = '';
		modal = 'editor'; error = '';
	}
	function openEdit(plugin: ManagedPlugin): void {
		editing = true; selectedName = plugin.name; draft = pluginDraftFromRecord(plugin); modal = 'editor'; error = '';
	}
	function changeKind(kind: PluginKind): void {
		draft.kind = kind;
		draft.name = kind === 'builtin' ? availableBuiltinNames[0] ?? '' : '';
		draft.path = '';
	}

	async function save(): Promise<void> {
		if (isSaving) return;
		isSaving = true; error = ''; notice = '';
		try {
			const path = editing ? `/api/plugins/${encodeURIComponent(selectedName)}` : '/api/plugins';
			const payload = editing ? buildPluginMutationPayload(draft) : buildCreatePluginPayload(draft);
			await requestJson<unknown>(path, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
			selectedName = editing ? selectedName : draft.name.trim();
			modal = null;
			notice = editing ? text('插件配置已保存并重新加载。', 'Plugin configuration saved and reloaded.') : text('插件已安装。', 'Plugin installed.');
			await load();
			notifyCapabilitiesChanged();
		} catch (cause) { error = validationMessage(cause); }
		finally { isSaving = false; }
	}

	async function toggle(plugin: ManagedPlugin): Promise<void> {
		if (busyName) return;
		busyName = plugin.name; error = ''; notice = '';
		try {
			const next = pluginDraftFromRecord(plugin); next.enabled = !plugin.enabled;
			await requestJson<unknown>(`/api/plugins/${encodeURIComponent(plugin.name)}`, { method: 'PUT', body: JSON.stringify(buildPluginMutationPayload(next)) });
			notice = plugin.enabled ? text('插件已停用。', 'Plugin disabled.') : text('插件已启用并重新加载。', 'Plugin enabled and reloaded.');
			await load();
			notifyCapabilitiesChanged();
		} catch (cause) { error = displayError(cause, text('插件状态更新失败。', 'Failed to update plugin status.')); }
		finally { busyName = ''; }
	}

	async function remove(plugin: ManagedPlugin): Promise<void> {
		if (!plugin.isCustom || busyName || !window.confirm(text(`确认删除自定义插件 ${plugin.name}？`, `Delete custom plugin ${plugin.name}?`))) return;
		busyName = plugin.name; error = ''; notice = '';
		try {
			await requestJson<unknown>(`/api/plugins/${encodeURIComponent(plugin.name)}`, { method: 'DELETE' });
			notice = text('插件已删除并从运行时卸载。', 'Plugin deleted and unloaded.');
			await load();
			notifyCapabilitiesChanged();
		} catch (cause) { error = displayError(cause, text('插件删除失败。', 'Failed to delete plugin.')); }
		finally { busyName = ''; }
	}

	function openSequence(): void {
		sequenceItems = buildPluginSequence(plugins);
		modal = 'sequence'; error = '';
	}
	function moveSequence(id: string, direction: -1 | 1): void { sequenceItems = movePluginSequence(sequenceItems, id, direction); }
	async function saveSequence(): Promise<void> {
		if (isSaving) return;
		isSaving = true; error = ''; notice = '';
		try {
			const updates = buildPluginSequenceUpdates(sequenceItems);
			for (const update of updates) {
				await requestJson<unknown>(`/api/plugins/${encodeURIComponent(update.name)}`, { method: 'PUT', body: JSON.stringify(update.payload) });
			}
			modal = null;
			notice = updates.length ? text('插件执行顺序已更新。', 'Plugin execution sequence updated.') : text('插件顺序没有变化。', 'Plugin sequence was unchanged.');
			await load();
		} catch (cause) { error = displayError(cause, text('执行顺序保存失败。', 'Failed to save plugin sequence.')); }
		finally { isSaving = false; }
	}

	onMount(() => { void load(); });
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading">
		<div><p class="eyebrow">{getAppName()} / {i18n.t('elygate.integrations')}</p><h1>{featureScoped ? text('插件能力配置', 'Plugin capability') : text('插件管理', 'Plugin management')}</h1><p>{featureScoped ? text('此页面由当前运行插件声明的能力自动提供；配置保存后插件会立即重新加载。', 'This page is provided by a capability declared by the active plugin; saving configuration reloads it immediately.') : text('安装和配置内置、自定义及企业插件，检查运行状态、钩子类型和加载日志，并控制自定义插件相对内置插件的执行顺序。', 'Install and configure built-in, custom, and enterprise plugins, inspect runtime status, hook types, and load logs, and control custom plugin execution around built-ins.')}</p></div>
		<div class="heading-actions"><button type="button" onclick={openSequence} disabled={customCount === 0}>{text('执行顺序', 'Execution order')}</button><button type="button" onclick={() => openCreate('builtin')} disabled={availableBuiltinNames.length === 0}>+ {text('启用内置插件', 'Enable built-in')}</button><button class="primary" type="button" onclick={() => openCreate('custom')}>+ {text('安装自定义插件', 'Install custom')}</button></div>
	</header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<div class="summary-grid"><article><strong>{plugins.length}</strong><span>{text('已配置插件', 'Configured')}</span></article><article><strong>{activeCount}</strong><span>{text('运行中', 'Active')}</span></article><article><strong>{customCount}</strong><span>{text('自定义 / 企业插件', 'Custom / enterprise')}</span></article><article><strong>{loadedNames.length}</strong><span>{text('运行时已加载', 'Runtime loaded')}</span></article></div>
	<div class="toolbar"><label>{text('搜索', 'Search')}<input bind:value={search} placeholder={text('名称、路径或类型', 'Name, path, or type')} /></label><label>{text('状态', 'Status')}<select bind:value={statusFilter}><option value="all">{text('全部', 'All')}</option><option value="active">{text('运行中', 'Active')}</option><option value="attention">{text('需关注', 'Attention')}</option><option value="disabled">{text('已停用', 'Disabled')}</option></select></label><label>{text('钩子类型', 'Hook type')}<select bind:value={typeFilter}><option value="">{text('全部', 'All')}</option>{#each typeOptions as type (type)}<option value={type}>{type.toUpperCase()}</option>{/each}</select></label><button type="button" onclick={() => void load()}>{text('刷新运行状态', 'Refresh runtime')}</button></div>

	<div class="workspace" class:loading={isLoading}>
		<aside class="plugin-list" aria-label={text('插件列表', 'Plugin list')}>
			{#each filteredPlugins as plugin (plugin.name)}
				<button class:selected={selectedName === plugin.name} type="button" onclick={() => selectPlugin(plugin)}>
					<span class={`status-dot ${statusBucket(plugin)}`}></span><span class="plugin-name"><strong>{plugin.name}</strong><small>{plugin.isCustom ? text('自定义插件', 'Custom plugin') : text('内置插件', 'Built-in plugin')}</small>{#if pluginDescription(plugin)}<small class="plugin-description">{pluginDescription(plugin)}</small>{/if}</span><span class="runtime">{isLoaded(plugin) ? text('已加载', 'Loaded') : text('未加载', 'Not loaded')}</span>
				</button>
			{:else}<p class="empty">{isLoading ? text('加载中…', 'Loading…') : featureScoped ? text('当前没有运行中的插件声明此能力。', 'No active plugin currently declares this capability.') : text('没有匹配的插件。', 'No matching plugins.')}</p>{/each}
		</aside>

		<main class="plugin-detail">
			{#if selected}
				<header class="detail-heading"><div><div class="title-row"><h2>{selected.name}</h2><span class={`status-pill ${statusBucket(selected)}`}>{statusLabel(selected)}</span>{#if selected.isCustom}<span class="type-pill">{text('自定义 / 企业', 'Custom / enterprise')}</span>{/if}</div>{#if selectedDescription}<p class="plugin-description">{selectedDescription}</p>{/if}<p class="plugin-path">{selected.path || text(`随 ${getAppName()} 分发的内置插件`, `Built into the ${getAppName()} distribution`)}</p></div><div class="actions"><button type="button" disabled={busyName === selected.name} onclick={() => void toggle(selected)}>{selected.enabled ? text('停用', 'Disable') : text('启用', 'Enable')}</button><button class="primary" type="button" onclick={() => openEdit(selected)}>{text('编辑配置', 'Edit configuration')}</button>{#if selected.isCustom}<button class="danger" type="button" disabled={busyName === selected.name} onclick={() => void remove(selected)}>{text('删除', 'Delete')}</button>{/if}</div></header>
				<div class="detail-grid"><article><h3>{text('运行信息', 'Runtime')}</h3><dl><div><dt>{text('实际名称', 'Actual name')}</dt><dd>{selected.actualName || '—'}</dd></div><div><dt>{text('状态', 'Status')}</dt><dd>{selected.status.status}</dd></div><div><dt>{text('加载状态', 'Loaded')}</dt><dd>{isLoaded(selected) ? text('是', 'Yes') : text('否', 'No')}</dd></div><div><dt>{text('位置 / 顺序', 'Placement / order')}</dt><dd>{selected.placement} / {selected.order}</dd></div></dl></article><article><h3>{text('钩子能力', 'Hook capabilities')}</h3><div class="badges">{#each [...selected.status.types, ...selected.features] as type (type)}<span>{type.toUpperCase()}</span>{:else}<span>{text('服务端未报告类型', 'No types reported')}</span>{/each}</div><p>{text('企业插件返回的钩子类型、功能标识和运行状态会在此自动显示，无需在面板硬编码插件名称。', 'Hook types, feature identifiers, and runtime status reported by enterprise plugins appear here without hard-coded plugin names.')}</p></article></div>
				<section class="config-preview"><div><h3>{text('生效配置', 'Effective configuration')}</h3><p>{text('Secret 已由服务端脱敏；原样保存脱敏占位符时，后端保留已存储凭据。', 'Secrets are server-redacted; saving placeholders unchanged preserves stored credentials on the backend.')}</p></div><pre>{JSON.stringify(selected.config, null, 2)}</pre></section>
				<section class="logs"><h3>{text('加载日志', 'Load logs')}</h3>{#each selected.status.logs as log, index (`${index}-${log}`)}<code class:error-log={/(error|failed|exception|panic|fatal)/i.test(log)}>{log}</code>{:else}<p>{text('没有运行时日志。', 'No runtime logs.')}</p>{/each}</section>
			{:else}<div class="empty-detail">{text('选择一个插件查看配置和运行状态。', 'Select a plugin to inspect configuration and runtime state.')}</div>{/if}
		</main>
	</div>
</section>

{#if modal}
	<div class="modal-backdrop" role="presentation" onpointerdown={(event) => {
		if (shouldClosePluginModalFromBackdrop({
			targetIsBackdrop: event.target === event.currentTarget,
			button: event.button,
			isSaving,
		})) modal = null;
	}}>
		<div class:sequence-modal={modal === 'sequence'} class="modal" role="dialog" aria-modal="true" aria-labelledby="plugin-modal-title">
			<header><div><h2 id="plugin-modal-title">{modal === 'sequence' ? text('插件执行顺序', 'Plugin execution order') : editing ? text('编辑插件', 'Edit plugin') : text('安装插件', 'Install plugin')}</h2><p>{modal === 'sequence' ? text('把自定义插件移动到内置插件块之前或之后，并调整同组顺序。', 'Move custom plugins before or after the built-in block and order them within each group.') : text('配置保存后，启用的插件会立即重新加载。', 'Enabled plugins reload immediately after saving.')}</p></div><button type="button" aria-label={text('关闭', 'Close')} onclick={() => (modal = null)}>×</button></header>
			{#if modal === 'editor'}
				<div class="form-grid">
					{#if !editing}<label>{text('插件来源', 'Plugin source')}<select value={draft.kind} onchange={(event) => changeKind(event.currentTarget.value as PluginKind)}><option value="builtin">{text('内置插件', 'Built-in')}</option><option value="custom">{text('自定义 / 企业插件', 'Custom / enterprise')}</option></select></label>{/if}
					<label>{text('插件名称', 'Plugin name')}{#if !editing && draft.kind === 'builtin'}<select bind:value={draft.name}>{#each availableBuiltinNames as name (name)}<option value={name}>{name}</option>{/each}</select>{:else}<input bind:value={draft.name} disabled={editing} placeholder="governance" />{/if}</label>
					{#if draft.kind === 'custom'}<label class="span-2">{text('插件路径或 URL', 'Plugin path or URL')}<input bind:value={draft.path} placeholder="/opt/elygate/plugins/governance.so" /><small>{text(`这是会在 ${getAppName()} 进程内加载的原生代码；后端要求真实管理员认证。`, `This native code loads inside the ${getAppName()} process; the backend requires genuine admin authentication.`)}</small></label>{/if}
					<label>{text('执行位置', 'Placement')}<select bind:value={draft.placement}><option value="pre_builtin">{text('内置插件之前', 'Before built-ins')}</option><option value="post_builtin">{text('内置插件之后', 'After built-ins')}</option></select></label><label>{text('组内顺序', 'Order in group')}<input type="number" min="0" bind:value={draft.order} /></label>
					<label class="check span-2"><input type="checkbox" bind:checked={draft.enabled} /><span><strong>{text('启用插件', 'Enable plugin')}</strong><small>{text('保存后立即加载；停用时仅持久化配置。', 'Load immediately after saving; disabled plugins only persist configuration.')}</small></span></label>
					<label class="span-2">{text('插件配置 JSON', 'Plugin configuration JSON')}<textarea class="json-editor" rows="16" bind:value={draft.configJson}></textarea><small>{text('企业插件可在后端实现类型化配置解析与 Secret 脱敏；面板完整回传未知字段。', 'Enterprise plugins may implement typed parsing and secret redaction on the backend; the panel round-trips unknown fields.')}</small></label>
				</div>
				<footer><button type="button" onclick={() => (modal = null)}>{text('取消', 'Cancel')}</button><button class="primary" type="button" disabled={isSaving || (!editing && draft.kind === 'builtin' && !draft.name)} onclick={() => void save()}>{isSaving ? text('保存中…', 'Saving…') : editing ? text('保存并重新加载', 'Save and reload') : text('安装', 'Install')}</button></footer>
			{/if}
			{#if modal === 'sequence'}
				<div class="sequence-list">{#each sequenceItems as item, index (item.id)}{#if item.kind === 'builtin'}<div class="builtin-block"><span>🔒</span><strong>{text('内置插件', 'Built-in plugins')}</strong><small>{text('固定分界，不改变内置插件内部顺序', 'Fixed boundary; built-in internal order is unchanged')}</small></div>{:else}<div class="sequence-item"><span class={`status-dot ${statusBucket(item.plugin)}`}></span><div><strong>{item.plugin.name}</strong><small>{item.plugin.placement} / {item.plugin.order}</small></div><div class="sequence-actions"><button type="button" aria-label={text('上移', 'Move up')} disabled={index === 0} onclick={() => moveSequence(item.id, -1)}>↑</button><button type="button" aria-label={text('下移', 'Move down')} disabled={index === sequenceItems.length - 1} onclick={() => moveSequence(item.id, 1)}>↓</button></div></div>{/if}{/each}</div>
				<div class="sequence-note">{text(`提示：config.json 中显式声明的插件顺序可能在 ${getAppName()} 重启后覆盖数据库顺序。`, `Note: an explicit plugin sequence in config.json may override database order after ${getAppName()} restarts.`)}</div>
				<footer><button type="button" onclick={() => (modal = null)}>{text('取消', 'Cancel')}</button><button class="primary" type="button" disabled={isSaving} onclick={() => void saveSequence()}>{isSaving ? text('保存中…', 'Saving…') : text('保存顺序', 'Save order')}</button></footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.page-shell { margin: 0 auto; max-width: 1380px; padding: 1.5rem; }
	.page-heading, .detail-heading, .modal > header, .modal > footer, .title-row, .heading-actions, .actions, .toolbar, .badges { align-items: center; display: flex; flex-wrap: wrap; gap: .65rem; justify-content: space-between; }
	.page-heading { align-items: start; }
	.page-heading h1, .detail-heading h2, h3, .modal h2 { margin: 0; }
	.page-heading p, .detail-heading p, .modal header p, .detail-grid p, .config-preview p { color: var(--muted-foreground); margin: .42rem 0 0; max-width: 860px; }
	.eyebrow { color: var(--primary) !important; font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
	button, input, select, textarea { border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); font: inherit; }
	button, select { background: var(--muted); cursor: pointer; padding: .55rem .7rem; }
	input, textarea { background: var(--background); padding: .6rem .7rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	button:disabled { cursor: not-allowed; opacity: .5; }
	.notice { border-radius: .65rem; margin-top: .8rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 10%, transparent); color: var(--primary); }
	.summary-grid { display: grid; gap: .75rem; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 1rem 0; }
	.summary-grid article { background: var(--card); border: 1px solid var(--border); border-radius: .75rem; display: grid; padding: .85rem; }
	.summary-grid strong { font-size: 1.45rem; }
	.summary-grid span { color: var(--muted-foreground); font-size: .75rem; }
	.toolbar { justify-content: start; margin-bottom: .85rem; }
	.toolbar label, .form-grid label { color: var(--muted-foreground); display: grid; font-size: .75rem; gap: .32rem; }
	.toolbar input { min-width: 260px; }
	.workspace { display: grid; gap: .85rem; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); opacity: 1; }
	.workspace.loading { opacity: .65; }
	.plugin-list, .plugin-detail { background: var(--card); border: 1px solid var(--border); border-radius: .85rem; min-height: 540px; overflow: hidden; }
	.plugin-list { align-content: start; display: grid; }
	.plugin-list > button { align-items: center; background: transparent; border: 0; border-bottom: 1px solid var(--border); border-radius: 0; display: grid; gap: .65rem; grid-template-columns: auto minmax(0, 1fr) auto; padding: .8rem; text-align: left; }
	.plugin-list > button.selected { background: color-mix(in oklch, var(--primary) 10%, transparent); box-shadow: inset 3px 0 var(--primary); }
	.plugin-name strong, .plugin-name small { display: block; }
	.plugin-name small, .runtime { color: var(--muted-foreground); font-size: .68rem; }
	.plugin-name .plugin-description { line-height: 1.35; margin-top: .18rem; }
	.detail-heading .plugin-description { color: var(--foreground); }
	.detail-heading .plugin-path { font-size: .75rem; }
	.status-dot { border-radius: 999px; display: inline-block; height: .55rem; width: .55rem; }
	.status-dot.active, .status-pill.active { background: color-mix(in oklch, var(--primary) 18%, transparent); color: var(--primary); }
	.status-dot.attention, .status-pill.attention { background: color-mix(in oklch, orange 20%, transparent); color: orange; }
	.status-dot.disabled, .status-pill.disabled { background: var(--muted); color: var(--muted-foreground); }
	.plugin-detail { padding: 1rem; }
	.detail-heading { align-items: start; border-bottom: 1px solid var(--border); padding-bottom: .9rem; }
	.title-row { justify-content: start; }
	.status-pill, .type-pill, .badges span { border-radius: 999px; font-size: .68rem; padding: .22rem .5rem; }
	.type-pill, .badges span { background: var(--muted); }
	.detail-grid { display: grid; gap: .8rem; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: .9rem; }
	.detail-grid article, .config-preview, .logs { border: 1px solid var(--border); border-radius: .75rem; padding: .9rem; }
	dl { display: grid; gap: .5rem; margin: .7rem 0 0; }
	dl div { display: grid; grid-template-columns: 120px minmax(0, 1fr); }
	dt { color: var(--muted-foreground); font-size: .75rem; }
	dd { font-size: .8rem; margin: 0; overflow-wrap: anywhere; }
	.config-preview, .logs { margin-top: .8rem; }
	.config-preview pre { background: var(--background); border-radius: .55rem; font-size: .75rem; max-height: 320px; overflow: auto; padding: .75rem; white-space: pre-wrap; }
	.logs { display: grid; gap: .4rem; }
	.logs code { background: var(--background); border-radius: .4rem; color: var(--primary); padding: .5rem; white-space: pre-wrap; }
	.logs code.error-log { color: var(--destructive); }
	.empty, .empty-detail { color: var(--muted-foreground); padding: 2rem; text-align: center; }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .55); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; display: grid; gap: 1rem; max-height: 92vh; max-width: 820px; overflow: auto; padding: 1.15rem; width: 100%; }
	.modal.sequence-modal { max-width: 680px; }
	.modal > footer { border-top: 1px solid var(--border); justify-content: end; padding-top: .9rem; }
	.form-grid { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-grid input, .form-grid select, .form-grid textarea { width: 100%; }
	.form-grid small, label.check small { color: var(--muted-foreground); }
	.span-2 { grid-column: 1 / -1; }
	label.check { align-items: start; display: flex; gap: .55rem; }
	label.check input { margin-top: .2rem; width: auto; }
	label.check span, label.check small { display: block; }
	.json-editor { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .76rem; line-height: 1.5; }
	.sequence-list { display: grid; gap: .55rem; }
	.sequence-item, .builtin-block { align-items: center; border: 1px solid var(--border); border-radius: .65rem; display: grid; gap: .65rem; grid-template-columns: auto minmax(0, 1fr) auto; padding: .7rem; }
	.sequence-item small, .builtin-block small { color: var(--muted-foreground); display: block; font-size: .68rem; }
	.builtin-block { background: var(--muted); border-style: dashed; }
	.sequence-actions { display: flex; gap: .35rem; }
	.sequence-actions button { padding: .35rem .55rem; }
	.sequence-note { background: color-mix(in oklch, var(--primary) 8%, transparent); border-radius: .6rem; color: var(--muted-foreground); font-size: .75rem; padding: .7rem; }
	@media (max-width: 900px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .workspace { grid-template-columns: 1fr; } .plugin-list { max-height: 360px; min-height: 0; overflow-y: auto; } }
	@media (max-width: 650px) { .page-shell { padding: 1rem; } .page-heading, .detail-heading { align-items: stretch; flex-direction: column; } .heading-actions, .actions { justify-content: start; } .summary-grid, .detail-grid, .form-grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } dl div { grid-template-columns: 1fr; } .toolbar label, .toolbar input { width: 100%; } }
</style>
