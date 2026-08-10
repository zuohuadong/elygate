import { describe, expect, test } from 'bun:test';
import {
	buildLibraryClientPayload,
	buildMcpClientPayload,
	buildMcpClientQuery,
	buildMcpLibraryQuery,
	buildMcpSessionQuery,
	buildOAuthGrantQuery,
	createEmptyMcpClientDraft,
} from './mcp-management';

describe('MCP management helpers', () => {
	test('encodes client facets and keeps explicit false values', () => {
		const query = buildMcpClientQuery({
			search: ' github ', connectionTypes: ['http', 'sse'], authTypes: ['oauth'], states: ['connected'],
			codeMode: false, disabled: true, allVirtualKeys: true, limit: 25, offset: 50,
		});
		expect(query).toContain('search=github');
		expect(query).toContain('connection_type=http%2Csse');
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
});
