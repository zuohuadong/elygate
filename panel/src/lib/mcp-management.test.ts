import { describe, expect, test } from 'bun:test';
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
} from './mcp-management';

describe('MCP management helpers', () => {
	test('encodes client facets and keeps explicit false values', () => {
		const query = buildMcpClientQuery({
			search: ' github ', connectionTypes: ['http', 'sse'], authTypes: ['oauth'], states: ['healthy'],
			codeMode: false, disabled: true, allVirtualKeys: true, limit: 25, offset: 50,
		});
		expect(query).toContain('search=github');
		expect(query).toContain('connection_type=http%2Csse');
		expect(query).toContain('state=healthy');
		expect(query).toContain('code_mode=false');
		expect(query).toContain('disabled=true');
		expect(query).toContain('all_virtual_keys=true');
	});

	test('encodes library, session and grant filters', () => {
		expect(buildMcpLibraryQuery({ categories: ['dev'], tags: ['git'], connectionTypes: ['stdio'], authTypes: ['none'], sortBy: 'name', order: 'asc', limit: 24, offset: 0 })).toContain('category=dev');
		expect(buildMcpSessionQuery({ search: 'alice', identity: 'u-1', kinds: ['token'], statuses: ['active'], authModes: ['user'], clientIds: ['m-1'], limit: 50, offset: 0 })).toContain('mcp_client_id=m-1');
		expect(buildOAuthGrantQuery('client', ['vk', 'user'], 50, 0)).toContain('bf_mode=vk%2Cuser');
	});

	test('builds a complete stdio client payload', () => {
		const draft = createEmptyMcpClientDraft();
		draft.name = 'github_server';
		draft.connectionType = 'stdio';
		draft.command = 'npx';
		draft.args = '-y, @modelcontextprotocol/server-github';
		draft.envs = 'GITHUB_TOKEN';
		const payload = buildMcpClientPayload(draft, false);
		expect(payload.connection_type).toBe('stdio');
		expect(payload.auth_type).toBe('none');
		expect(payload.stdio_config).toEqual({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envs: ['GITHUB_TOKEN'] });
		expect(payload.tools_to_execute).toEqual(['*']);
	});

	test('builds per-user header verification payload', () => {
		const draft = createEmptyMcpClientDraft();
		draft.name = 'private_api';
		draft.connectionValue = 'https://mcp.example.com';
		draft.authType = 'per_user_headers';
		draft.perUserHeaderKeys = 'X-Api-Key, X-Tenant';
		draft.userHeadersJson = '{"X-Api-Key":"sample"}';
		const payload = buildMcpClientPayload(draft, false);
		expect(payload.per_user_header_keys).toEqual(['X-Api-Key', 'X-Tenant']);
		expect(payload.user_headers).toEqual({ 'X-Api-Key': 'sample' });
	});

	test('merges advanced edit fields without resending connection secrets', () => {
		const draft = createEmptyMcpClientDraft();
		draft.name = 'server';
		draft.disabled = true;
		draft.toolSyncMinutes = 15;
		draft.advancedJson = '{"tools_to_execute":["search"]}';
		const payload = buildMcpClientPayload(draft, true);
		expect(payload.tools_to_execute).toEqual(['search']);
		expect(payload.disabled).toBe(true);
		expect(payload.tool_sync_interval).toBe(15);
		expect(payload.connection_string).toBeUndefined();
	});

	test('turns a catalog entry into an install payload', () => {
		const payload = buildLibraryClientPayload({ connection_type: 'http', connection_url: 'https://mcp.example.com', auth_type: 'oauth' }, 'catalog_server', { oauth_config: { client_id: { value: 'id', ref: '' } } });
		expect(payload.connection_string).toEqual({ value: 'https://mcp.example.com', ref: '' });
		expect(payload.oauth_config).toEqual({ client_id: { value: 'id', ref: '' } });
	});

	test('localizes MCP catalog metadata without changing filter values', () => {
		expect(localizeMcpCatalogValue('zh-CN', 'category', 'Marketing')).toBe('营销');
		expect(localizeMcpCatalogValue('zh-CN', 'source', 'remote')).toBe('远程目录');
		expect(localizeMcpCatalogValue('zh-CN', 'tag', 'journey-optimizer')).toBe('旅程优化');
		expect(localizeMcpCatalogValue('zh-CN', 'tag', 'adobe')).toBe('Adobe');
		expect(localizeMcpCatalogValue('zh-CN', 'tag', 'customer-support')).toBe('客户支持');
		expect(localizeMcpCatalogValue('zh-CN', 'tag', 'untranslated-product')).toBe('专有标签：untranslated product');
		expect(localizeMcpCatalogValue('en', 'category', 'Marketing')).toBe('Marketing');
	});

	test('provides a truthful bilingual fallback for English catalog descriptions', () => {
		const original = 'Connect AI tools to an example marketing service.';
		const localized = localizeMcpCatalogDescription('zh-CN', 'Example Marketing Server', 'Marketing', original);
		expect(localized).toContain('Example Marketing Server');
		expect(localized).toContain('中文分类摘要');
		expect(localized).toContain('目录分类：营销');
		expect(localized).toContain(original);
		expect(localizeMcpCatalogDescription('en', 'Example Marketing Server', 'Marketing', original)).toBe(original);
	});

	test('provides factual Chinese descriptions for the catalog entries reported in the issue', () => {
		const original = 'Connect AI tools to Adobe for marketing campaign and audience insights. Hosted remotely by Adobe.';
		const localized = localizeMcpCatalogDescription('zh-CN', 'Adobe Marketing Agent', 'Marketing', original);
		expect(localized).toContain('营销活动和受众洞察');
		expect(localized).toContain(`英文原文：${original}`);
	});

	test('prefers server-provided Chinese catalog metadata while preserving English source text', () => {
		const original = 'Search official product documentation.';
		const localized = localizeMcpCatalogDescription('zh-CN', 'Docs', 'Research', original, {
			i18n: { 'zh-CN': { description: '搜索官方产品文档。' } },
		});
		expect(localized).toBe(`搜索官方产品文档。\n英文原文：${original}`);
	});

	test('refreshes metadata before records', async () => {
		const events: string[] = [];
		await refreshMcpData(true, async () => { events.push('metadata'); }, async (reset) => { events.push(`records:${reset}`); });
		expect(events).toEqual(['metadata', 'records:true']);
	});

	test('coalesces overlapping refreshes and preserves a pending reset', async () => {
		let releaseFirst!: () => void;
		let activeRuns = 0;
		let maxActiveRuns = 0;
		const resets: boolean[] = [];
		const refresh = createCoalescedRefresh(async (reset) => {
			activeRuns += 1;
			maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
			resets.push(reset);
			if (resets.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
			activeRuns -= 1;
		});

		const first = refresh();
		await Promise.resolve();
		const second = refresh();
		const third = refresh(true);
		releaseFirst();
		await Promise.all([first, second, third]);

		expect(resets).toEqual([false, true]);
		expect(maxActiveRuns).toBe(1);
	});

	test('loads server-provided MCP facets and keeps client checkboxes compact', async () => {
		const source = await Bun.file(new URL('../pages/McpManagementPage.svelte', import.meta.url)).text();
		expect(source).toContain("requestJson<unknown>('/api/mcp/clients/filterdata')");
		expect(source).toContain("facet('connection_types')");
		expect(source).toContain("facet('auth_types')");
		expect(source).toContain("facet('states')");
		expect(source).not.toContain('<option value="connected">Connected</option>');
		expect(source).toContain('<fieldset class="client-options span-2">');
		expect(source).toMatch(/\.client-options input\[type=['"]checkbox['"]\][^{]*\{[^}]*width:\s*auto/);
	});

	test('keeps library view controls out of the filter form', async () => {
		const source = await Bun.file(new URL('../pages/McpManagementPage.svelte', import.meta.url)).text();
		const headingActions = source.slice(source.indexOf('<div class="heading-actions">'), source.indexOf('</header>'));
		const toolbar = source.slice(source.indexOf('<form class="toolbar"'), source.indexOf('</form>'));
		expect(headingActions).toContain('view-toggle');
		expect(toolbar).not.toContain('view-toggle');
	});
});
