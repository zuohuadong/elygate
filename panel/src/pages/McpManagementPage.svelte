<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayValue, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { displayError, parseJsonObject, prettyJson, csv } from '../lib/forms';
	import { isSafeOAuthRedirect } from '../lib/oauth-consent';
	import { columnValueFor } from '../lib/columns';
	import {
		buildLibraryClientPayload,
		buildMcpClientPayload,
		buildMcpClientQuery,
		buildMcpLibraryQuery,
		buildMcpSessionQuery,
		buildOAuthGrantQuery,
		createCoalescedRefresh,
		createEmptyMcpClientDraft,
		localizeMcpCatalogDescription,
		localizeMcpCatalogValue,
		refreshMcpData,
		type McpClientDraft,
	} from '../lib/mcp-management';

	interface Props { resourceName: string; }
	type ModalKind = 'client' | 'detail' | 'library-create' | 'library-install' | 'library-settings' | null;

	const CLIENT_PAGE_SIZE = 25;
	const LIBRARY_PAGE_SIZE = 24;
	const SESSION_PAGE_SIZE = 50;
	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	const mode = $derived(resourceName === 'mcp-clients' ? 'clients' : resourceName === 'mcp-library' ? 'library' : resourceName === 'mcp-sessions' ? 'sessions' : 'grants');
	const pageSize = $derived(mode === 'clients' ? CLIENT_PAGE_SIZE : mode === 'library' ? LIBRARY_PAGE_SIZE : SESSION_PAGE_SIZE);
	let records = $state.raw<JsonRecord[]>([]);
	let total = $state(0);
	let offset = $state(0);
	let search = $state('');
	let identity = $state('');
	let connectionTypes = $state<string[]>([]);
	let authTypes = $state<string[]>([]);
	let states = $state<string[]>([]);
	let kinds = $state<string[]>([]);
	let statuses = $state<string[]>([]);
	let authModes = $state<string[]>([]);
	let categories = $state<string[]>([]);
	let tags = $state<string[]>([]);
	let codeMode = $state('');
	let disabled = $state('');
	let allVirtualKeys = $state(false);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let busyId = $state('');
	let error = $state('');
	let notice = $state('');
	let modal = $state<ModalKind>(null);
	let selected = $state.raw<JsonRecord | null>(null);
	let editingClientId = $state('');
	let clientDraft = $state<McpClientDraft>(createEmptyMcpClientDraft());
	let viewMode = $state<'table' | 'grid'>('table');
	let searchTimer: number | undefined;
	let installedNames = $state.raw<Set<string>>(new Set());
	let filterData = $state.raw<JsonRecord>({});
	let installName = $state('');
	let installOverrides = $state('{}');
	let configDocument = $state.raw<JsonRecord>({});
	let libraryUrl = $state('');
	let librarySyncHours = $state('24');
	let libraryDraft = $state({
		name: '', description: '', category: '', connectionType: 'http', connectionUrl: '', command: '', args: '', envs: '',
		authType: 'none', requiredHeaders: '', iconUrl: '', docsUrl: '', publisher: '', tags: '',
	});
	const currentPage = $derived(Math.floor(offset / pageSize) + 1);
	const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function recordList(payload: unknown, key: string): JsonRecord[] {
		if (!isJsonRecord(payload) || !Array.isArray(payload[key])) return [];
		return payload[key].filter(isJsonRecord);
	}
	function clientConfig(record: JsonRecord): JsonRecord { return isJsonRecord(record.config) ? record.config : record; }
	function clientId(record: JsonRecord): string { return String(clientConfig(record).client_id ?? record.client_id ?? ''); }
	function recordId(record: JsonRecord): string { return String(record.id ?? clientId(record) ?? record.slug ?? record.name ?? ''); }
	function displayDate(value: unknown): string {
		if (typeof value !== 'string' || !value) return '—';
		const timestamp = new Date(value);
		return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString(i18n.locale);
	}
	function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
	function booleanParam(value: string): boolean | undefined { return value === 'true' ? true : value === 'false' ? false : undefined; }
	function facet(key: string): string[] {
		const value = filterData[key];
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
	}
	function locale(): 'zh-CN' | 'en' { return i18n.locale === 'zh-CN' ? 'zh-CN' : 'en'; }
	function enumLabel(column: string, value: unknown): string { return columnValueFor(locale(), column, value); }
	function catalogValue(field: 'category' | 'source' | 'tag', value: unknown): string { return localizeMcpCatalogValue(locale(), field, value); }
	function catalogDescription(record: JsonRecord): string { return localizeMcpCatalogDescription(locale(), record.name, record.category, record.description, record.metadata); }
	function catalogTags(value: unknown): string {
		return Array.isArray(value) ? value.map((item) => catalogValue('tag', item)).join(', ') : catalogValue('tag', value);
	}
	function normalizeName(value: string): string {
		const normalized = value.trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]+/, 'server_').slice(0, 50);
		return normalized.length >= 3 ? normalized : `mcp_${normalized || 'server'}`;
	}
	function isLibraryInstalled(record: JsonRecord): boolean {
		return installedNames.has(stringValue(record.name).toLowerCase()) || installedNames.has(stringValue(record.connection_url).toLowerCase());
	}

	async function load(reset = false): Promise<void> {
		if (reset) offset = 0;
		isLoading = true;
		error = '';
		try {
			let path = '';
			let key = '';
			if (mode === 'clients') {
				path = `/api/mcp/clients?${buildMcpClientQuery({ search, connectionTypes, authTypes, states, codeMode: booleanParam(codeMode), disabled: booleanParam(disabled), allVirtualKeys, limit: pageSize, offset })}`;
				key = 'clients';
			} else if (mode === 'library') {
				path = `/api/mcp/library?${buildMcpLibraryQuery({ search, categories, connectionTypes, authTypes, tags, sortBy: 'name', order: 'asc', limit: pageSize, offset })}`;
				key = 'servers';
			} else if (mode === 'sessions') {
				path = `/api/mcp/sessions?${buildMcpSessionQuery({ search, identity, kinds, statuses, authModes, limit: pageSize, offset })}`;
				key = 'sessions';
			} else {
				path = `/api/oauth2/sessions?${buildOAuthGrantQuery(search, authModes, pageSize, offset)}`;
				key = 'sessions';
			}
			const payload = await requestJson<unknown>(path);
			records = recordList(payload, key);
			total = getTotal(payload, records.length);
			if (total > 0 && offset >= total) { offset = Math.floor((total - 1) / pageSize) * pageSize; await load(); }
		} catch (cause) {
			error = displayError(cause, text('加载失败。', 'Failed to load.'));
		} finally {
			isLoading = false;
		}
	}

	async function loadAllMcpClients(): Promise<JsonRecord[]> {
		const clients: JsonRecord[] = [];
		const limit = 100;
		let clientOffset = 0;
		while (true) {
			const payload = await requestJson<unknown>(`/api/mcp/clients?limit=${limit}&offset=${clientOffset}`);
			const page = recordList(payload, 'clients');
			clients.push(...page);
			const expectedTotal = getTotal(payload, clients.length);
			if (page.length === 0 || clients.length >= expectedTotal || page.length < limit) return clients;
			clientOffset += page.length;
		}
	}

	async function loadFilterMetadata(): Promise<void> {
		const requestedMode = mode;
		if (mode === 'clients') {
			let filtersPayload: unknown;
			try {
				filtersPayload = await requestJson<unknown>('/api/mcp/clients/filterdata');
			} catch {
				return;
			}
			if (mode !== requestedMode) return;
			if (!isJsonRecord(filtersPayload)) return;
			filterData = filtersPayload;
			connectionTypes = connectionTypes.filter((item) => facet('connection_types').includes(item));
			authTypes = authTypes.filter((item) => facet('auth_types').includes(item));
			states = states.filter((item) => facet('states').includes(item));
			return;
		}
		if (mode !== 'library') { filterData = {}; return; }
		const [filtersResult, clientsResult] = await Promise.allSettled([
			requestJson<unknown>('/api/mcp/library/filterdata'),
			loadAllMcpClients(),
		]);
		if (mode !== requestedMode) return;
		if (filtersResult.status === 'fulfilled' && isJsonRecord(filtersResult.value)) {
			filterData = filtersResult.value;
			connectionTypes = connectionTypes.filter((item) => facet('connection_types').includes(item));
			authTypes = authTypes.filter((item) => facet('auth_types').includes(item));
			categories = categories.filter((item) => facet('categories').includes(item));
			tags = tags.filter((item) => facet('tags').includes(item));
		}
		if (clientsResult.status === 'fulfilled') {
			installedNames = new Set(clientsResult.value.flatMap((record) => {
				const config = clientConfig(record);
				return [stringValue(config.name).toLowerCase(), stringValue(isJsonRecord(config.connection_string) ? config.connection_string.value : '').toLowerCase()].filter(Boolean);
			}));
		}
	}

	const refreshData = createCoalescedRefresh((reset) => refreshMcpData(reset, loadFilterMetadata, load));

	function resetFilters(): void {
		search = ''; identity = ''; connectionTypes = []; authTypes = []; states = []; kinds = []; statuses = []; authModes = []; categories = []; tags = [];
		codeMode = ''; disabled = ''; allVirtualKeys = false;
		void refreshData(true);
	}
	function scheduleSearch(): void {
		if (mode !== 'library') return;
		window.clearTimeout(searchTimer);
		searchTimer = window.setTimeout(() => void refreshData(true), 250);
	}

	function openCreateClient(): void {
		editingClientId = '';
		clientDraft = createEmptyMcpClientDraft();
		modal = 'client';
		error = '';
	}

	function openEditClient(record: JsonRecord): void {
		const config = clientConfig(record);
		const connection = isJsonRecord(config.connection_string) ? config.connection_string : {};
		const stdio = isJsonRecord(config.stdio_config) ? config.stdio_config : {};
		editingClientId = clientId(record);
		clientDraft = {
			...createEmptyMcpClientDraft(),
			name: stringValue(config.name),
			connectionType: config.connection_type === 'stdio' || config.connection_type === 'sse' ? config.connection_type : 'http',
			connectionValue: stringValue(connection.value || connection.ref),
			command: stringValue(stdio.command),
			args: Array.isArray(stdio.args) ? stdio.args.join(', ') : '',
			envs: Array.isArray(stdio.envs) ? stdio.envs.join(', ') : '',
			authType: ['headers', 'oauth', 'per_user_oauth', 'per_user_headers'].includes(String(config.auth_type)) ? config.auth_type as McpClientDraft['authType'] : 'none',
			headersJson: prettyJson(config.headers, '{}'),
			perUserHeaderKeys: Array.isArray(config.per_user_header_keys) ? config.per_user_header_keys.join(', ') : '',
			codeMode: config.is_code_mode_client === true,
			ping: config.is_ping_available !== false,
			disabled: config.disabled === true,
			allVirtualKeys: config.allow_on_all_virtual_keys === true,
			toolSyncMinutes: typeof config.tool_sync_interval === 'number' ? String(config.tool_sync_interval / 60_000_000_000) : '',
			toolExecutionSeconds: typeof config.tool_execution_timeout === 'number' ? String(config.tool_execution_timeout) : '',
			allowedExtraHeaders: Array.isArray(config.allowed_extra_headers) ? config.allowed_extra_headers.join(', ') : '',
			advancedJson: prettyJson({ tools_to_execute: config.tools_to_execute, tools_to_auto_execute: config.tools_to_auto_execute, tool_pricing: config.tool_pricing, vk_configs: record.vk_configs }, '{}'),
		};
		modal = 'client';
		error = '';
	}

	function validationMessage(cause: unknown): string {
		if (!(cause instanceof Error)) return text('保存失败。', 'Failed to save.');
		const messages: Record<string, string> = {
			'name-required': text('名称为必填项。', 'Name is required.'),
			'name-invalid': text('名称需为 3–50 位字母、数字或下划线，且不能以数字开头。', 'Name must be 3–50 letters, numbers, or underscores and cannot start with a number.'),
			'command-required': text('STDIO 命令为必填项。', 'STDIO command is required.'),
			'connection-required': text('连接地址为必填项。', 'Connection URL is required.'),
			'header-keys-required': text('按用户请求头认证至少需要一个请求头名称。', 'Per-user headers require at least one header name.'),
			'invalid-number': text('时间间隔必须是非负数字。', 'Intervals must be non-negative numbers.'),
		};
		return messages[cause.message] ?? cause.message;
	}

	async function saveClient(): Promise<void> {
		if (isSaving) return;
		isSaving = true; error = ''; notice = '';
		try {
			const payload = buildMcpClientPayload(clientDraft, !!editingClientId);
			const path = editingClientId ? `/api/mcp/client/${encodeURIComponent(editingClientId)}` : '/api/mcp/client';
			const response = await requestJson<unknown>(path, { method: editingClientId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
			modal = null;
			notice = editingClientId ? text('MCP 客户端已更新。', 'MCP client updated.') : text('MCP 客户端已创建。', 'MCP client created.');
			if (isJsonRecord(response) && typeof response.authorize_url === 'string' && isSafeOAuthRedirect(response.authorize_url, window.location.href)) window.location.assign(response.authorize_url);
			else await refreshData();
		} catch (cause) {
			error = validationMessage(cause);
		} finally { isSaving = false; }
	}

	async function clientAction(record: JsonRecord, action: 'reconnect' | 'toggle' | 'delete'): Promise<void> {
		const id = clientId(record);
		if (!id || busyId) return;
		const config = clientConfig(record);
		if (action === 'delete' && !window.confirm(text(`确认删除 MCP 客户端 ${stringValue(config.name)}？`, `Delete MCP client ${stringValue(config.name)}?`))) return;
		busyId = id; error = ''; notice = '';
		try {
			if (action === 'reconnect') await requestJson<unknown>(`/api/mcp/client/${encodeURIComponent(id)}/reconnect`, { method: 'POST' });
			else if (action === 'toggle') await requestJson<unknown>(`/api/mcp/client/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ disabled: config.disabled !== true }) });
			else await requestJson<unknown>(`/api/mcp/client/${encodeURIComponent(id)}`, { method: 'DELETE' });
			notice = action === 'delete' ? text('客户端已删除。', 'Client deleted.') : action === 'toggle' ? text('客户端状态已更新。', 'Client status updated.') : text('已请求重新连接。', 'Reconnect requested.');
			await refreshData();
		} catch (cause) { error = displayError(cause, text('操作失败。', 'Action failed.')); }
		finally { busyId = ''; }
	}

	function openDetail(record: JsonRecord): void { selected = record; modal = 'detail'; }
	function openLibraryCreate(): void {
		libraryDraft = { name: '', description: '', category: '', connectionType: 'http', connectionUrl: '', command: '', args: '', envs: '', authType: 'none', requiredHeaders: '', iconUrl: '', docsUrl: '', publisher: '', tags: '' };
		modal = 'library-create'; error = '';
	}
	function openInstall(record: JsonRecord): void {
		selected = record;
		installName = normalizeName(stringValue(record.name));
		const authType = stringValue(record.auth_type);
		installOverrides = prettyJson(authType === 'oauth' || authType === 'per_user_oauth'
			? { oauth_config: { client_id: { value: '', ref: '' }, scopes: [] } }
			: authType === 'headers' ? { headers: {} } : authType === 'per_user_headers' ? { user_headers: {} } : {}, '{}');
		modal = 'library-install'; error = '';
	}
	async function openLibrarySettings(): Promise<void> {
		error = '';
		try {
			const payload = await requestJson<unknown>('/api/config?from_db=true');
			configDocument = isJsonRecord(payload) ? payload : {};
			const framework = isJsonRecord(configDocument.framework_config) ? configDocument.framework_config : {};
			libraryUrl = stringValue(framework.mcp_library_url);
			librarySyncHours = String(Math.round((typeof framework.mcp_library_sync_interval === 'number' ? framework.mcp_library_sync_interval : 86400) / 3600));
			modal = 'library-settings';
		} catch (cause) { error = displayError(cause, text('无法加载 MCP 目录设置。', 'Unable to load MCP library settings.')); }
	}
	async function saveLibrarySettings(): Promise<void> {
		if (isSaving) return;
		const hours = Number(librarySyncHours);
		if (!Number.isFinite(hours) || hours < 1 || hours > 8760) { error = text('同步周期必须为 1–8760 小时。', 'Sync interval must be between 1 and 8760 hours.'); return; }
		if (libraryUrl.trim() && !/^https?:\/\//i.test(libraryUrl.trim())) { error = text('同步地址必须以 http:// 或 https:// 开头。', 'Sync URL must start with http:// or https://.'); return; }
		isSaving = true; error = '';
		try {
			const framework = isJsonRecord(configDocument.framework_config) ? configDocument.framework_config : {};
			await requestJson<unknown>('/api/config', { method: 'PUT', body: JSON.stringify({ ...configDocument, framework_config: { ...framework, mcp_library_url: libraryUrl.trim(), mcp_library_sync_interval: hours * 3600 } }) });
			modal = null; notice = text('MCP 目录设置已更新。', 'MCP library settings updated.');
		} catch (cause) { error = displayError(cause, text('设置保存失败。', 'Failed to save settings.')); }
		finally { isSaving = false; }
	}

	async function saveLibraryEntry(): Promise<void> {
		if (isSaving) return;
		isSaving = true; error = ''; notice = '';
		try {
			if (!libraryDraft.name.trim()) throw new Error(text('名称为必填项。', 'Name is required.'));
			const payload: JsonRecord = {
				name: libraryDraft.name.trim(), description: libraryDraft.description.trim() || undefined, category: libraryDraft.category.trim() || undefined,
				connection_type: libraryDraft.connectionType, auth_type: libraryDraft.connectionType === 'stdio' ? 'none' : libraryDraft.authType,
				required_header_keys: csv(libraryDraft.requiredHeaders), icon_url: libraryDraft.iconUrl.trim() || undefined,
				docs_url: libraryDraft.docsUrl.trim() || undefined, publisher: libraryDraft.publisher.trim() || undefined, tags: csv(libraryDraft.tags),
			};
			if (libraryDraft.connectionType === 'stdio') payload.stdio_config = { command: libraryDraft.command.trim(), args: csv(libraryDraft.args), envs: csv(libraryDraft.envs) };
			else payload.connection_url = libraryDraft.connectionUrl.trim();
			await requestJson<unknown>('/api/mcp/library', { method: 'POST', body: JSON.stringify(payload) });
			modal = null; notice = text('自定义 MCP 目录项已发布。', 'Custom MCP library entry published.'); await refreshData();
		} catch (cause) { error = displayError(cause, text('发布失败。', 'Failed to publish.')); }
		finally { isSaving = false; }
	}

	async function installLibraryEntry(): Promise<void> {
		if (!selected || isSaving) return;
		isSaving = true; error = ''; notice = '';
		try {
			const payload = buildLibraryClientPayload(selected, normalizeName(installName), parseJsonObject(installOverrides, 'install'));
			const response = await requestJson<unknown>('/api/mcp/client', { method: 'POST', body: JSON.stringify(payload) });
			modal = null; notice = text('MCP 服务已安装。', 'MCP server installed.');
			if (isJsonRecord(response) && typeof response.authorize_url === 'string' && isSafeOAuthRedirect(response.authorize_url, window.location.href)) window.location.assign(response.authorize_url);
			else await refreshData();
		} catch (cause) { error = displayError(cause, text('安装失败。', 'Failed to install.')); }
		finally { isSaving = false; }
	}

	async function libraryAction(record: JsonRecord | null, action: 'sync' | 'delete'): Promise<void> {
		const id = record ? recordId(record) : 'sync';
		if (busyId) return;
		if (action === 'delete' && record && !window.confirm(text(`从目录移除 ${stringValue(record.name)}？已安装实例不受影响。`, `Remove ${stringValue(record.name)} from the library? Installed instances are unaffected.`))) return;
		busyId = id; error = '';
		try {
			await requestJson<unknown>(action === 'sync' ? '/api/mcp/library/force-sync' : `/api/mcp/library/${encodeURIComponent(id)}`, { method: action === 'sync' ? 'POST' : 'DELETE' });
			notice = action === 'sync' ? text('目录同步已启动。', 'Library sync started.') : text('目录项已移除。', 'Library entry removed.');
			await refreshData();
		} catch (cause) { error = displayError(cause, text('操作失败。', 'Action failed.')); }
		finally { busyId = ''; }
	}

	async function sessionAction(record: JsonRecord, action: 'reauth' | 'revoke'): Promise<void> {
		const id = recordId(record);
		if (!id || busyId) return;
		if (record.kind === 'flow' && action === 'reauth') {
			const suffix = record.auth_kind === 'headers' ? '&kind=headers' : '';
			window.location.assign(`/workspace/mcp-sessions/auth?flow=${encodeURIComponent(id)}${suffix}`);
			return;
		}
		if (action === 'revoke' && !window.confirm(text('确认撤销该 MCP 凭据？', 'Revoke this MCP credential?'))) return;
		busyId = id; error = '';
		try {
			if (action === 'reauth') {
				const response = await requestJson<unknown>(`/api/mcp/sessions/${encodeURIComponent(id)}/reauth`, { method: 'POST' });
				if (isJsonRecord(response) && typeof response.authorize_url === 'string' && isSafeOAuthRedirect(response.authorize_url, window.location.href)) window.location.assign(response.authorize_url);
				else throw new Error(text('服务端未返回有效授权地址。', 'Server did not return a valid authorization URL.'));
			} else {
				await requestJson<unknown>(`/api/mcp/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
				notice = text('MCP 凭据已撤销。', 'MCP credential revoked.'); await refreshData();
			}
		} catch (cause) { error = displayError(cause, text('操作失败。', 'Action failed.')); }
		finally { busyId = ''; }
	}

	async function revokeGrant(record: JsonRecord): Promise<void> {
		const id = recordId(record);
		if (!id || busyId || !window.confirm(text('确认撤销该 OAuth 授权？', 'Revoke this OAuth grant?'))) return;
		busyId = id; error = '';
		try { await requestJson<unknown>(`/api/oauth2/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); notice = text('OAuth 授权已撤销。', 'OAuth grant revoked.'); await refreshData(); }
		catch (cause) { error = displayError(cause, text('撤销失败。', 'Failed to revoke.')); }
		finally { busyId = ''; }
	}

	function setViewMode(next: 'table' | 'grid'): void {
		viewMode = next;
		try { window.localStorage.setItem('mcp-library-view-mode', next); } catch { /* 保留内存偏好 */ }
	}

	onMount(() => {
		try { const saved = window.localStorage.getItem('mcp-library-view-mode'); if (saved === 'grid' || saved === 'table') viewMode = saved; } catch { /* 使用默认值 */ }
		void refreshData();
		const timer = window.setInterval(() => { if (!modal && (mode === 'clients' || mode === 'sessions')) void refreshData(); }, 5000);
		return () => { window.clearInterval(timer); window.clearTimeout(searchTimer); };
	});
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading">
		<div><p class="eyebrow">Elygate / MCP</p><h1>{mode === 'clients' ? text('MCP 客户端', 'MCP Clients') : mode === 'library' ? text('MCP 服务库', 'MCP Server Library') : mode === 'sessions' ? text('MCP 认证会话', 'MCP Auth Sessions') : text('OAuth 授权', 'OAuth Grants')}</h1><p>{mode === 'clients' ? text('管理 MCP 连接、认证、工具、虚拟密钥范围和运行状态。', 'Manage MCP connections, authentication, tools, virtual-key scope, and runtime state.') : mode === 'library' ? text('浏览、筛选、发布并安装同步的 MCP 服务目录。', 'Browse, filter, publish, and install servers from the synced MCP catalog.') : mode === 'sessions' ? text('查看按用户、虚拟密钥或会话绑定的 OAuth 与请求头凭据。', 'Inspect OAuth and header credentials bound to users, virtual keys, or sessions.') : text('管理通过 MCP OAuth 同意流程签发的下游授权。', 'Manage downstream grants issued through the MCP OAuth consent flow.')}</p></div>
		<div class="heading-actions">
			{#if mode === 'clients'}<button class="primary" type="button" onclick={openCreateClient}>+ {text('新增客户端', 'New client')}</button>{/if}
			{#if mode === 'library'}<div class="view-toggle"><button class:active={viewMode === 'table'} type="button" onclick={() => setViewMode('table')}>{text('表格', 'Table')}</button><button class:active={viewMode === 'grid'} type="button" onclick={() => setViewMode('grid')}>{text('卡片', 'Grid')}</button></div><button type="button" onclick={() => void openLibrarySettings()}>{text('目录设置', 'Library settings')}</button><button type="button" onclick={() => void libraryAction(null, 'sync')}>{text('立即同步', 'Sync now')}</button><button class="primary" type="button" onclick={openLibraryCreate}>+ {text('发布服务', 'Publish server')}</button>{/if}
		</div>
	</header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}

	<form class="toolbar" onsubmit={(event) => { event.preventDefault(); void refreshData(true); }}>
		<label>{text('搜索', 'Search')}<input bind:value={search} oninput={scheduleSearch} placeholder={mode === 'library' ? text('名称、描述或标签', 'Name, description, or tag') : text('名称、身份或客户端', 'Name, identity, or client')} /></label>
		{#if mode === 'sessions'}<label>{text('精确身份', 'Exact identity')}<input bind:value={identity} placeholder="user / vk / session id" /></label>{/if}
		{#if mode === 'clients' || mode === 'library'}
			<label>{text('连接类型', 'Connection')}<select multiple bind:value={connectionTypes}>{#each facet('connection_types') as item (item)}<option value={item}>{enumLabel('connection_type', item)}</option>{/each}</select></label>
			<label>{text('认证类型', 'Authentication')}<select multiple bind:value={authTypes}>{#each facet('auth_types') as item (item)}<option value={item}>{enumLabel('auth_type', item)}</option>{/each}</select></label>
		{/if}
		{#if mode === 'clients'}
			<label>{text('连接状态', 'State')}<select multiple bind:value={states}>{#each facet('states') as item (item)}<option value={item}>{enumLabel('mcp_state', item)}</option>{/each}</select></label>
			<label>{text('代码模式', 'Code mode')}<select bind:value={codeMode}><option value="">{text('全部', 'All')}</option><option value="true">{text('是', 'Yes')}</option><option value="false">{text('否', 'No')}</option></select></label>
			<label>{text('启用状态', 'Enabled')}<select bind:value={disabled}><option value="">{text('全部', 'All')}</option><option value="false">{text('启用', 'Enabled')}</option><option value="true">{text('停用', 'Disabled')}</option></select></label>
			<label class="check"><input type="checkbox" bind:checked={allVirtualKeys} />{text('仅全部虚拟密钥可用', 'Only available to all virtual keys')}</label>
		{/if}
		{#if mode === 'library'}
			<label>{text('分类', 'Category')}<select multiple bind:value={categories} onchange={() => void refreshData(true)}>{#each facet('categories') as item (item)}<option value={item}>{catalogValue('category', item)}</option>{/each}</select></label>
			<label>{text('标签', 'Tags')}<select multiple bind:value={tags} onchange={() => void refreshData(true)}>{#each facet('tags') as item (item)}<option value={item}>{catalogValue('tag', item)}</option>{/each}</select></label>
		{/if}
		{#if mode === 'sessions'}
			<label>{text('凭据类型', 'Kind')}<select multiple bind:value={kinds}><option value="token">OAuth token</option><option value="flow">Pending flow</option><option value="header">Headers</option></select></label>
			<label>{text('状态', 'Status')}<select multiple bind:value={statuses}><option value="active">Active</option><option value="pending">Pending</option><option value="orphaned">Orphaned</option><option value="needs_reauth">Needs reauth</option><option value="needs_update">Needs update</option></select></label>
		{/if}
		{#if mode === 'sessions' || mode === 'grants'}
			<label>{text('绑定方式', 'Binding mode')}<select multiple bind:value={authModes}><option value="user">User</option><option value="vk">Virtual key</option><option value="session">Session</option></select></label>
		{/if}
		<button type="submit">{text('应用筛选', 'Apply')}</button><button type="button" onclick={resetFilters}>{text('清除', 'Clear')}</button>
	</form>

	{#if mode === 'library' && viewMode === 'grid'}
		<div class="card-grid">
			{#each records as record (recordId(record))}
				<article class="server-card"><div class="server-card-head"><div><h2>{displayValue(record.name)}</h2><p>{record.publisher ? displayValue(record.publisher) : catalogValue('category', record.category)}</p></div><span class="badge">{enumLabel('connection_type', record.connection_type)}</span></div><p>{catalogDescription(record)}</p><div class="tag-row">{#each Array.isArray(record.tags) ? record.tags : [] as tag (String(tag))}<span>{catalogValue('tag', tag)}</span>{/each}</div><footer><span>{isLibraryInstalled(record) ? text('已安装', 'Installed') : text('未安装', 'Not installed')}</span><div><button type="button" onclick={() => openDetail(record)}>{text('详情', 'Details')}</button><button class="primary" type="button" onclick={() => openInstall(record)}>{text('安装', 'Install')}</button><button class="danger" type="button" onclick={() => void libraryAction(record, 'delete')}>{text('移除', 'Remove')}</button></div></footer></article>
			{:else}<div class="empty">{isLoading ? text('加载中…', 'Loading…') : text('没有匹配的目录项。', 'No matching catalog entries.')}</div>{/each}
		</div>
	{:else}
		<div class="table-wrap" class:loading={isLoading}><table><thead><tr>
			{#if mode === 'clients'}<th>{text('名称', 'Name')}</th><th>{text('连接', 'Connection')}</th><th>{text('认证', 'Authentication')}</th><th>{text('状态', 'State')}</th><th>{text('工具', 'Tools')}</th><th>{text('访问范围', 'Scope')}</th>{/if}
			{#if mode === 'library'}<th>{text('服务', 'Server')}</th><th>{text('分类', 'Category')}</th><th>{text('连接', 'Connection')}</th><th>{text('认证', 'Authentication')}</th><th>{text('标签', 'Tags')}</th><th>{text('来源', 'Source')}</th>{/if}
			{#if mode === 'sessions'}<th>{text('MCP 服务', 'MCP server')}</th><th>{text('类型', 'Type')}</th><th>{text('绑定到', 'Bound to')}</th><th>{text('状态', 'Status')}</th><th>{text('过期时间', 'Expires')}</th><th>{text('创建时间', 'Created')}</th>{/if}
			{#if mode === 'grants'}<th>{text('客户端', 'Client')}</th><th>{text('绑定到', 'Bound to')}</th><th>{text('权限范围', 'Scope')}</th><th>{text('创建时间', 'Created')}</th><th>{text('最近使用', 'Last used')}</th>{/if}
			<th>{text('操作', 'Actions')}</th></tr></thead><tbody>
			{#each records as record (recordId(record))}
				<tr>
					{#if mode === 'clients'}{@const config = clientConfig(record)}<td><strong>{displayValue(config.name)}</strong><small>{displayValue(config.client_id)}</small></td><td>{enumLabel('connection_type', config.connection_type)}</td><td>{enumLabel('auth_type', config.auth_type || 'none')}</td><td><span class:danger-badge={record.state === 'error'} class="badge">{enumLabel('mcp_state', config.disabled === true ? 'disabled' : record.state)}</span></td><td>{Array.isArray(record.tools) ? record.tools.length : 0}</td><td>{config.allow_on_all_virtual_keys === true ? text('全部虚拟密钥', 'All virtual keys') : `${Array.isArray(record.vk_configs) ? record.vk_configs.length : 0} VK`}</td><td><div class="actions"><button type="button" onclick={() => openDetail(record)}>{text('详情', 'Details')}</button><button type="button" onclick={() => openEditClient(record)}>{text('编辑', 'Edit')}</button><button type="button" disabled={busyId === clientId(record)} onclick={() => void clientAction(record, 'reconnect')}>{text('重连', 'Reconnect')}</button><button type="button" onclick={() => void clientAction(record, 'toggle')}>{config.disabled === true ? text('启用', 'Enable') : text('停用', 'Disable')}</button><button class="danger" type="button" onclick={() => void clientAction(record, 'delete')}>{text('删除', 'Delete')}</button></div></td>{/if}
					{#if mode === 'library'}<td><strong>{displayValue(record.name)}</strong><small class="catalog-description">{catalogDescription(record)}</small></td><td>{catalogValue('category', record.category)}</td><td>{enumLabel('connection_type', record.connection_type)}</td><td>{enumLabel('auth_type', record.auth_type)}</td><td>{catalogTags(record.tags)}</td><td>{catalogValue('source', record.source)}</td><td><div class="actions"><button type="button" onclick={() => openDetail(record)}>{text('详情', 'Details')}</button><button class="primary" type="button" onclick={() => openInstall(record)}>{isLibraryInstalled(record) ? text('再次安装', 'Install again') : text('安装', 'Install')}</button><button class="danger" type="button" onclick={() => void libraryAction(record, 'delete')}>{text('移除', 'Remove')}</button></div></td>{/if}
					{#if mode === 'sessions'}<td><strong>{displayValue(isJsonRecord(record.mcp_client) ? record.mcp_client.name || record.mcp_client.client_id : '—')}</strong></td><td>{record.kind === 'header' || record.auth_kind === 'headers' ? 'Headers' : 'OAuth'} · {displayValue(record.kind)}</td><td>{record.auth_mode === 'user' ? displayValue(isJsonRecord(record.user) ? record.user.name || record.user.email || record.user_id : record.user_id) : record.auth_mode === 'vk' ? displayValue(isJsonRecord(record.virtual_key) ? record.virtual_key.name || record.virtual_key.id : '—') : displayValue(record.session_id)}</td><td><span class="badge">{displayValue(record.status)}</span></td><td>{displayDate(record.expires_at)}</td><td>{displayDate(record.created_at)}</td><td><div class="actions"><button type="button" onclick={() => openDetail(record)}>{text('详情', 'Details')}</button>{#if record.kind === 'flow' || (record.status !== 'orphaned' && record.can_reauth === true)}<button class="primary" type="button" onclick={() => void sessionAction(record, 'reauth')}>{record.kind === 'header' ? text('编辑值', 'Edit values') : record.kind === 'flow' ? text('完成认证', 'Complete auth') : text('重新认证', 'Reauthenticate')}</button>{/if}<button class="danger" type="button" onclick={() => void sessionAction(record, 'revoke')}>{text('撤销', 'Revoke')}</button></div></td>{/if}
					{#if mode === 'grants'}<td><strong>{displayValue(record.client_name || record.client_id)}</strong><small>{displayValue(record.client_id)}</small></td><td>{displayValue(record.bf_sub_display || record.bf_sub)} · {displayValue(record.bf_mode)}</td><td>{displayValue(record.scope)}</td><td>{displayDate(record.created_at)}</td><td>{displayDate(record.last_used_at || record.created_at)}</td><td><div class="actions"><button type="button" onclick={() => openDetail(record)}>{text('详情', 'Details')}</button><button class="danger" type="button" onclick={() => void revokeGrant(record)}>{text('撤销', 'Revoke')}</button></div></td>{/if}
				</tr>
			{:else}<tr><td class="empty" colspan="8">{isLoading ? text('加载中…', 'Loading…') : text('没有匹配结果。', 'No matching results.')}</td></tr>{/each}
		</tbody></table></div>
	{/if}

	<footer class="pagination"><span>{total ? `${offset + 1}–${Math.min(offset + pageSize, total)} / ${total}` : '0'}</span><div><button type="button" disabled={offset === 0 || isLoading} onclick={() => { offset = Math.max(0, offset - pageSize); void refreshData(); }}>{text('上一页', 'Previous')}</button><span>{currentPage} / {totalPages}</span><button type="button" disabled={offset + pageSize >= total || isLoading} onclick={() => { offset += pageSize; void refreshData(); }}>{text('下一页', 'Next')}</button></div></footer>
</section>

{#if modal}
	<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !isSaving) modal = null; }}>
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mcp-modal-title">
			<header><div><h2 id="mcp-modal-title">{modal === 'client' ? (editingClientId ? text('编辑 MCP 客户端', 'Edit MCP client') : text('新增 MCP 客户端', 'New MCP client')) : modal === 'library-create' ? text('发布 MCP 服务', 'Publish MCP server') : modal === 'library-install' ? text('安装 MCP 服务', 'Install MCP server') : modal === 'library-settings' ? text('MCP 目录设置', 'MCP Library Settings') : text('完整详情', 'Full details')}</h2>{#if selected && modal !== 'client' && modal !== 'library-settings'}<p>{displayValue(selected.name || clientConfig(selected).name || selected.client_name)}</p>{/if}</div><button type="button" aria-label={text('关闭', 'Close')} onclick={() => (modal = null)}>×</button></header>
			{#if modal === 'detail' && selected}<pre class="json-view">{prettyJson(selected, '{}')}</pre>{/if}
			{#if modal === 'client'}
				<div class="form-grid">
					<label>{text('名称', 'Name')}<input bind:value={clientDraft.name} disabled={!!editingClientId} placeholder="github_server" /></label>
					<label>{text('连接类型', 'Connection type')}<select bind:value={clientDraft.connectionType} disabled={!!editingClientId}><option value="http">{enumLabel('connection_type', 'http')}</option><option value="sse">{enumLabel('connection_type', 'sse')}</option><option value="stdio">{enumLabel('connection_type', 'stdio')}</option></select></label>
					{#if clientDraft.connectionType === 'stdio'}<label>{text('命令', 'Command')}<input bind:value={clientDraft.command} disabled={!!editingClientId} placeholder="npx" /></label><label>{text('参数（逗号分隔）', 'Arguments (comma-separated)')}<input bind:value={clientDraft.args} disabled={!!editingClientId} /></label><label class="span-2">{text('环境变量（NAME 或 NAME=value）', 'Environment (NAME or NAME=value)')}<input bind:value={clientDraft.envs} disabled={!!editingClientId} /></label>{:else}<label class="span-2">{text('连接地址', 'Connection URL')}<input bind:value={clientDraft.connectionValue} disabled={!!editingClientId} placeholder="https://mcp.example.com" /></label>{/if}
					<label>{text('认证类型', 'Authentication')}<select bind:value={clientDraft.authType} disabled={!!editingClientId}><option value="none">{enumLabel('auth_type', 'none')}</option><option value="headers">{enumLabel('auth_type', 'headers')}</option><option value="oauth">{enumLabel('auth_type', 'oauth')}</option><option value="per_user_oauth">{enumLabel('auth_type', 'per_user_oauth')}</option><option value="per_user_headers">{enumLabel('auth_type', 'per_user_headers')}</option></select></label>
					<label>{text('工具同步间隔（分钟）', 'Tool sync interval (minutes)')}<input type="number" min="0" bind:value={clientDraft.toolSyncMinutes} /></label>
					<label>{text('工具超时（秒）', 'Tool timeout (seconds)')}<input type="number" min="0" bind:value={clientDraft.toolExecutionSeconds} /></label>
					<label>{text('额外请求头白名单', 'Extra-header allowlist')}<input bind:value={clientDraft.allowedExtraHeaders} placeholder="x-tenant-id, x-trace-id" /></label>
					<fieldset class="client-options span-2"><legend>{text('客户端选项', 'Client options')}</legend><div class="client-option-grid"><label class="check"><input type="checkbox" bind:checked={clientDraft.codeMode} />{text('代码模式', 'Code mode')}</label><label class="check"><input type="checkbox" bind:checked={clientDraft.ping} />{text('启用 Ping', 'Enable ping')}</label><label class="check"><input type="checkbox" bind:checked={clientDraft.disabled} />{text('停用客户端', 'Disable client')}</label><label class="check"><input type="checkbox" bind:checked={clientDraft.allVirtualKeys} />{text('全部虚拟密钥可用', 'Available to all virtual keys')}</label>{#if clientDraft.connectionType !== 'stdio'}<label class="check"><input type="checkbox" bind:checked={clientDraft.tlsSkipVerify} />{text('跳过 TLS 校验', 'Skip TLS verification')}</label>{/if}</div></fieldset>
					{#if clientDraft.connectionType !== 'stdio'}<label class="span-2">{text('CA 证书 PEM', 'CA certificate PEM')}<textarea rows="3" bind:value={clientDraft.caCert}></textarea></label>{/if}
					{#if clientDraft.authType === 'headers' || clientDraft.authType === 'per_user_headers'}<label class="span-2">{text('共享请求头 JSON', 'Shared headers JSON')}<textarea rows="5" bind:value={clientDraft.headersJson}></textarea></label>{/if}
					{#if clientDraft.authType === 'per_user_headers'}<label class="span-2">{text('每用户必填请求头名称', 'Required per-user header names')}<input bind:value={clientDraft.perUserHeaderKeys} placeholder="X-Api-Key, X-Tenant" /></label>{#if !editingClientId}<label class="span-2">{text('验证用示例值 JSON', 'Sample values for verification')}<textarea rows="4" bind:value={clientDraft.userHeadersJson}></textarea></label>{/if}{/if}
					{#if (clientDraft.authType === 'oauth' || clientDraft.authType === 'per_user_oauth')}<label>{text('OAuth Client ID', 'OAuth Client ID')}<input bind:value={clientDraft.oauthClientId} /></label><label>{text('OAuth Client Secret', 'OAuth Client Secret')}<input type="password" bind:value={clientDraft.oauthClientSecret} /></label>{#if !editingClientId}<label class="span-2">{text('授权地址（可自动发现）', 'Authorize URL (optional discovery)')}<input bind:value={clientDraft.authorizeUrl} /></label><label class="span-2">{text('Token 地址（可自动发现）', 'Token URL (optional discovery)')}<input bind:value={clientDraft.tokenUrl} /></label><label>{text('注册地址', 'Registration URL')}<input bind:value={clientDraft.registrationUrl} /></label><label>{text('Scopes', 'Scopes')}<input bind:value={clientDraft.scopes} /></label><label class="span-2">{text('OAuth Resource URI', 'OAuth Resource URI')}<input bind:value={clientDraft.resource} /></label>{/if}{/if}
				</div>
				<details><summary>{text('高级字段 JSON', 'Advanced fields JSON')}</summary><p>{text('用于工具白名单、自动执行、定价和虚拟密钥分配。结构化字段会覆盖同名值。', 'Use for tool allowlists, auto-execution, pricing, and virtual-key assignments. Structured fields override matching keys.')}</p><textarea class="json-editor" rows="10" bind:value={clientDraft.advancedJson}></textarea></details>
			{/if}
			{#if modal === 'library-create'}
				<div class="form-grid"><label>{text('名称', 'Name')}<input bind:value={libraryDraft.name} /></label><label>{text('分类', 'Category')}<input bind:value={libraryDraft.category} /></label><label class="span-2">{text('描述', 'Description')}<textarea rows="3" bind:value={libraryDraft.description}></textarea></label><label>{text('连接类型', 'Connection type')}<select bind:value={libraryDraft.connectionType}><option value="http">{enumLabel('connection_type', 'http')}</option><option value="sse">{enumLabel('connection_type', 'sse')}</option><option value="stdio">{enumLabel('connection_type', 'stdio')}</option></select></label><label>{text('认证类型', 'Authentication')}<select bind:value={libraryDraft.authType}><option value="none">{enumLabel('auth_type', 'none')}</option><option value="headers">{enumLabel('auth_type', 'headers')}</option><option value="oauth">{enumLabel('auth_type', 'oauth')}</option><option value="per_user_oauth">{enumLabel('auth_type', 'per_user_oauth')}</option><option value="per_user_headers">{enumLabel('auth_type', 'per_user_headers')}</option></select></label>{#if libraryDraft.connectionType === 'stdio'}<label>{text('命令', 'Command')}<input bind:value={libraryDraft.command} /></label><label>{text('参数', 'Arguments')}<input bind:value={libraryDraft.args} /></label><label class="span-2">{text('环境变量名称', 'Environment names')}<input bind:value={libraryDraft.envs} /></label>{:else}<label class="span-2">{text('连接地址', 'Connection URL')}<input bind:value={libraryDraft.connectionUrl} /></label>{/if}<label class="span-2">{text('所需请求头名称', 'Required header names')}<input bind:value={libraryDraft.requiredHeaders} /></label><label>{text('发布者', 'Publisher')}<input bind:value={libraryDraft.publisher} /></label><label>{text('标签', 'Tags')}<input bind:value={libraryDraft.tags} /></label><label>{text('图标 URL', 'Icon URL')}<input bind:value={libraryDraft.iconUrl} /></label><label>{text('文档 URL', 'Docs URL')}<input bind:value={libraryDraft.docsUrl} /></label></div>
			{/if}
			{#if modal === 'library-install' && selected}<div class="form-grid"><label class="span-2">{text('客户端名称', 'Client name')}<input bind:value={installName} /></label><label class="span-2">{text('安装覆盖 JSON', 'Install overrides JSON')}<textarea class="json-editor" rows="14" bind:value={installOverrides}></textarea><small>{text('填写 OAuth 客户端、共享请求头、按用户验证值、TLS 或其他高级配置。', 'Provide OAuth client settings, shared headers, per-user verification values, TLS, or other advanced options.')}</small></label></div>{/if}
			{#if modal === 'library-settings'}<div class="form-grid"><label class="span-2">{text('目录同步地址', 'Library sync URL')}<input bind:value={libraryUrl} placeholder="https://getbifrost.ai/mcp-library" /><small>{text('留空使用 Elygate 默认目录。', 'Leave empty to use the default Elygate catalog.')}</small></label><label>{text('同步周期（小时）', 'Sync interval (hours)')}<input type="number" min="1" max="8760" bind:value={librarySyncHours} /></label></div>{/if}
			{#if modal !== 'detail'}<footer><button type="button" onclick={() => (modal = null)}>{text('取消', 'Cancel')}</button><button class="primary" type="button" disabled={isSaving} onclick={() => void (modal === 'client' ? saveClient() : modal === 'library-create' ? saveLibraryEntry() : modal === 'library-settings' ? saveLibrarySettings() : installLibraryEntry())}>{isSaving ? text('保存中…', 'Saving…') : modal === 'library-install' ? text('安装', 'Install') : text('保存', 'Save')}</button></footer>{/if}
		</div>
	</div>
{/if}

<style>
	.page-shell { margin: 0 auto; max-width: 1440px; padding: 1.5rem; }
	.page-heading { align-items: start; display: flex; gap: 1rem; justify-content: space-between; }
	.page-heading h1 { margin: 0; }
	.page-heading p { color: var(--muted-foreground); margin: .45rem 0 0; max-width: 820px; }
	.eyebrow { color: var(--primary) !important; font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
	.heading-actions, .actions, .view-toggle, .pagination div, .server-card footer, .server-card footer div { align-items: center; display: flex; flex-wrap: wrap; gap: .45rem; }
	button, input, select, textarea { border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); font: inherit; }
	button, select { background: var(--muted); cursor: pointer; padding: .55rem .7rem; }
	input, textarea { background: var(--background); padding: .6rem .7rem; }
	button.primary, .view-toggle button.active { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	button:disabled { cursor: wait; opacity: .55; }
	.toolbar { align-items: end; display: flex; flex-wrap: wrap; gap: .65rem; margin: 1rem 0 .8rem; }
	.toolbar label, .form-grid label { color: var(--muted-foreground); display: grid; font-size: .75rem; gap: .32rem; }
	.toolbar input { min-width: 220px; }
	.toolbar select[multiple] { min-height: 5.25rem; min-width: 145px; padding: .35rem; }
	label.check { align-items: center; display: flex; gap: .45rem; min-height: 2.5rem; }
	label.check input { min-width: auto; }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; overflow-x: auto; }
	.table-wrap.loading { opacity: .65; }
	table { border-collapse: collapse; min-width: 1120px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); font-size: .78rem; padding: .72rem .8rem; text-align: left; vertical-align: top; }
	th { color: var(--muted-foreground); }
	td strong, td small { display: block; }
	td small { color: var(--muted-foreground); margin-top: .2rem; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	td small.catalog-description { line-height: 1.45; max-width: 440px; overflow: visible; text-overflow: clip; white-space: pre-line; }
	.badge, .tag-row span { background: var(--muted); border-radius: 999px; display: inline-block; font-size: .7rem; padding: .18rem .48rem; }
	.danger-badge { color: var(--destructive); }
	.empty { color: var(--muted-foreground); padding: 2rem; text-align: center; }
	.pagination { align-items: center; display: flex; justify-content: space-between; margin-top: .75rem; }
	.notice { border-radius: .65rem; margin-top: .8rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 10%, transparent); color: var(--primary); }
	.card-grid { display: grid; gap: .8rem; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); }
	.server-card { background: var(--card); border: 1px solid var(--border); border-radius: .85rem; display: grid; gap: .75rem; padding: 1rem; }
	.server-card h2, .server-card p { margin: 0; }
	.server-card > p, .server-card-head p { color: var(--muted-foreground); font-size: .78rem; }
	.server-card-head { align-items: start; display: flex; gap: .6rem; justify-content: space-between; }
	.server-card footer { border-top: 1px solid var(--border); justify-content: space-between; padding-top: .75rem; }
	.tag-row { display: flex; flex-wrap: wrap; gap: .3rem; }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .55); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; display: grid; gap: 1rem; max-height: 92vh; max-width: 900px; overflow: auto; padding: 1.15rem; width: 100%; }
	.modal > header, .modal > footer { align-items: center; display: flex; gap: .7rem; justify-content: space-between; }
	.modal h2 { margin: 0; }
	.modal header p { color: var(--muted-foreground); margin: .3rem 0 0; }
	.modal > footer { border-top: 1px solid var(--border); justify-content: end; padding-top: .9rem; }
	.form-grid { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-grid input, .form-grid select, .form-grid textarea { width: 100%; }
	.client-options { border: 1px solid var(--border); border-radius: .65rem; margin: 0; padding: .65rem .75rem .75rem; }
	.client-options legend { color: var(--muted-foreground); font-size: .75rem; padding: 0 .25rem; }
	.client-option-grid { display: grid; gap: .45rem .9rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.client-options input[type='checkbox'] { flex: 0 0 auto; margin: 0; min-width: 0; width: auto; }
	.span-2 { grid-column: 1 / -1; }
	details { border-top: 1px solid var(--border); padding-top: .8rem; }
	details summary { cursor: pointer; font-weight: 600; }
	details p, label small { color: var(--muted-foreground); font-size: .75rem; }
	.json-editor, .json-view { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .75rem; line-height: 1.55; width: 100%; }
	.json-view { background: var(--muted); border-radius: .65rem; margin: 0; max-height: 68vh; overflow: auto; padding: 1rem; white-space: pre-wrap; }
	@media (max-width: 760px) { .page-shell { padding: 1rem; } .page-heading { flex-direction: column; } .heading-actions { width: 100%; } .form-grid, .client-option-grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } .pagination { align-items: stretch; flex-direction: column; gap: .6rem; } }
</style>
