import { csv, parseJsonObject } from './forms';
import type { JsonRecord } from './api';

export type McpConnectionType = 'http' | 'sse' | 'stdio';
export type McpAuthType = 'none' | 'headers' | 'oauth' | 'per_user_oauth' | 'per_user_headers';

export interface McpClientDraft {
	name: string;
	connectionType: McpConnectionType;
	connectionValue: string;
	command: string;
	args: string;
	envs: string;
	authType: McpAuthType;
	headersJson: string;
	perUserHeaderKeys: string;
	userHeadersJson: string;
	oauthClientId: string;
	oauthClientSecret: string;
	authorizeUrl: string;
	tokenUrl: string;
	registrationUrl: string;
	scopes: string;
	resource: string;
	tlsSkipVerify: boolean;
	caCert: string;
	codeMode: boolean;
	ping: boolean;
	disabled: boolean;
	allVirtualKeys: boolean;
	toolSyncMinutes: string | number;
	toolExecutionSeconds: string | number;
	allowedExtraHeaders: string;
	advancedJson: string;
}

export interface McpClientFilters {
	search?: string;
	server?: string;
	connectionTypes?: string[];
	authTypes?: string[];
	states?: string[];
	virtualKeys?: string[];
	codeMode?: boolean;
	disabled?: boolean;
	allVirtualKeys?: boolean;
	limit: number;
	offset: number;
}

export interface McpLibraryFilters {
	search?: string;
	categories?: string[];
	connectionTypes?: string[];
	authTypes?: string[];
	tags?: string[];
	sortBy?: string;
	order?: 'asc' | 'desc';
	limit: number;
	offset: number;
}

export interface McpSessionFilters {
	search?: string;
	identity?: string;
	kinds?: string[];
	statuses?: string[];
	authModes?: string[];
	clientIds?: string[];
	limit: number;
	offset: number;
}

function positiveNumber(value: string | number | undefined): number | undefined {
	if (value === undefined || String(value).trim() === '') return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) throw new Error('invalid-number');
	return parsed;
}

function setCsv(params: URLSearchParams, key: string, values?: string[]): void {
	if (values?.length) params.set(key, values.join(','));
}

export function buildMcpClientQuery(filters: McpClientFilters): string {
	const params = new URLSearchParams({ limit: String(filters.limit), offset: String(filters.offset) });
	if (filters.search?.trim()) params.set('search', filters.search.trim());
	if (filters.server?.trim()) params.set('server', filters.server.trim());
	setCsv(params, 'connection_type', filters.connectionTypes);
	setCsv(params, 'auth_type', filters.authTypes);
	setCsv(params, 'state', filters.states);
	setCsv(params, 'virtual_keys', filters.virtualKeys);
	if (filters.codeMode !== undefined) params.set('code_mode', String(filters.codeMode));
	if (filters.disabled !== undefined) params.set('disabled', String(filters.disabled));
	if (filters.allVirtualKeys) params.set('all_virtual_keys', 'true');
	return params.toString();
}

export function buildMcpLibraryQuery(filters: McpLibraryFilters): string {
	const params = new URLSearchParams({ limit: String(filters.limit), offset: String(filters.offset) });
	if (filters.search?.trim()) params.set('search', filters.search.trim());
	setCsv(params, 'category', filters.categories);
	setCsv(params, 'connection_type', filters.connectionTypes);
	setCsv(params, 'auth_type', filters.authTypes);
	setCsv(params, 'tags', filters.tags);
	if (filters.sortBy) params.set('sort_by', filters.sortBy);
	if (filters.order) params.set('order', filters.order);
	return params.toString();
}

export function buildMcpSessionQuery(filters: McpSessionFilters): string {
	const params = new URLSearchParams({ limit: String(filters.limit), offset: String(filters.offset) });
	if (filters.search?.trim()) params.set('q', filters.search.trim());
	if (filters.identity?.trim()) params.set('identity', filters.identity.trim());
	setCsv(params, 'kind', filters.kinds);
	setCsv(params, 'status', filters.statuses);
	setCsv(params, 'auth_mode', filters.authModes);
	setCsv(params, 'mcp_client_id', filters.clientIds);
	return params.toString();
}

export function buildOAuthGrantQuery(search: string, modes: string[], limit: number, offset: number): string {
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (search.trim()) params.set('q', search.trim());
	setCsv(params, 'bf_mode', modes);
	return params.toString();
}

export function createEmptyMcpClientDraft(): McpClientDraft {
	return {
		name: '',
		connectionType: 'http',
		connectionValue: '',
		command: '',
		args: '',
		envs: '',
		authType: 'none',
		headersJson: '{}',
		perUserHeaderKeys: '',
		userHeadersJson: '{}',
		oauthClientId: '',
		oauthClientSecret: '',
		authorizeUrl: '',
		tokenUrl: '',
		registrationUrl: '',
		scopes: '',
		resource: '',
		tlsSkipVerify: false,
		caCert: '',
		codeMode: false,
		ping: true,
		disabled: false,
		allVirtualKeys: false,
		toolSyncMinutes: '',
		toolExecutionSeconds: '',
		allowedExtraHeaders: '',
		advancedJson: '{}',
	};
}

function optionalSecret(value: string): JsonRecord | undefined {
	return value.trim() ? { value: value.trim(), ref: '' } : undefined;
}

function compactRecord(value: JsonRecord): JsonRecord {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function buildMcpClientPayload(draft: McpClientDraft, editing: boolean): JsonRecord {
	const name = draft.name.trim();
	if (!name) throw new Error('name-required');
	if (!editing && !/^[a-zA-Z_][a-zA-Z0-9_]{2,49}$/.test(name)) throw new Error('name-invalid');
	const advanced = parseJsonObject(draft.advancedJson, 'advanced');
	const headers = parseJsonObject(draft.headersJson, 'headers');
	const userHeaders = parseJsonObject(draft.userHeadersJson, 'user_headers');
	const perUserHeaderKeys = csv(draft.perUserHeaderKeys);
	if (draft.authType === 'per_user_headers' && perUserHeaderKeys.length === 0) throw new Error('header-keys-required');

	const base: JsonRecord = {
		...advanced,
		name,
		is_code_mode_client: draft.codeMode,
		is_ping_available: draft.ping,
		disabled: draft.disabled,
		allow_on_all_virtual_keys: draft.allVirtualKeys,
		tool_sync_interval: positiveNumber(draft.toolSyncMinutes),
		tool_execution_timeout: positiveNumber(draft.toolExecutionSeconds),
		allowed_extra_headers: csv(draft.allowedExtraHeaders),
	};

	if (editing) {
		if (Object.keys(headers).length) base.headers = headers;
		if (draft.authType === 'per_user_headers') base.per_user_header_keys = perUserHeaderKeys;
		if (draft.caCert.trim() || draft.tlsSkipVerify) base.tls_config = compactRecord({ insecure_skip_verify: draft.tlsSkipVerify, ca_cert_pem: optionalSecret(draft.caCert) });
		if ((draft.authType === 'oauth' || draft.authType === 'per_user_oauth') && (draft.oauthClientId.trim() || draft.oauthClientSecret.trim())) {
			base.oauth_config = compactRecord({ client_id: optionalSecret(draft.oauthClientId), client_secret: optionalSecret(draft.oauthClientSecret) });
		}
		return compactRecord(base);
	}

	base.connection_type = draft.connectionType;
	base.auth_type = draft.connectionType === 'stdio' ? 'none' : draft.authType;
	base.tools_to_execute = ['*'];
	if (draft.connectionType === 'stdio') {
		if (!draft.command.trim()) throw new Error('command-required');
		base.stdio_config = { command: draft.command.trim(), args: csv(draft.args), envs: csv(draft.envs) };
	} else {
		if (!draft.connectionValue.trim()) throw new Error('connection-required');
		base.connection_string = { value: draft.connectionValue.trim(), ref: '' };
		if (draft.caCert.trim() || draft.tlsSkipVerify) base.tls_config = compactRecord({ insecure_skip_verify: draft.tlsSkipVerify, ca_cert_pem: optionalSecret(draft.caCert) });
	}
	if (draft.authType === 'headers' || draft.authType === 'per_user_headers') {
		if (Object.keys(headers).length) base.headers = headers;
	}
	if (draft.authType === 'per_user_headers') {
		base.per_user_header_keys = perUserHeaderKeys;
		if (Object.keys(userHeaders).length) base.user_headers = userHeaders;
	}
	if (draft.authType === 'oauth' || draft.authType === 'per_user_oauth') {
		base.oauth_config = compactRecord({
			client_id: optionalSecret(draft.oauthClientId) ?? { value: '', ref: '' },
			client_secret: optionalSecret(draft.oauthClientSecret),
			authorize_url: draft.authorizeUrl.trim() || undefined,
			token_url: draft.tokenUrl.trim() || undefined,
			registration_url: draft.registrationUrl.trim() || undefined,
			scopes: csv(draft.scopes),
			server_url: draft.connectionValue.trim() || undefined,
			resource: draft.resource.trim() || undefined,
		});
	}
	return compactRecord(base);
}

export function buildLibraryClientPayload(server: JsonRecord, name: string, overrides: JsonRecord = {}): JsonRecord {
	const connectionType = server.connection_type === 'stdio' || server.connection_type === 'sse' ? server.connection_type : 'http';
	const payload: JsonRecord = {
		...overrides,
		name: name.trim(),
		connection_type: connectionType,
		auth_type: typeof server.auth_type === 'string' ? server.auth_type : 'none',
		is_code_mode_client: false,
		is_ping_available: true,
		tools_to_execute: ['*'],
	};
	if (!payload.name) throw new Error('name-required');
	if (connectionType === 'stdio') {
		payload.stdio_config = server.stdio_config ?? { command: '', args: [], envs: [] };
	} else {
		payload.connection_string = { value: typeof server.connection_url === 'string' ? server.connection_url : '', ref: '' };
	}
	if (Array.isArray(server.required_header_keys) && server.auth_type === 'per_user_headers') payload.per_user_header_keys = server.required_header_keys;
	return payload;
}
