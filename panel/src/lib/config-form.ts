import { isJsonRecord, type JsonRecord } from './api';
import { csv } from './forms';

export interface ConfigForm {
	authEnabled: boolean;
	adminUsername: string;
	adminPassword: string;
	dropExcessRequests: boolean;
	initialPoolSize: number;
	prometheusLabels: string;
	enableLogging: boolean;
	disableContentLogging: boolean;
	retainContentInObjectStorage: boolean;
	allowPerRequestContentStorageOverride: boolean;
	allowPerRequestRawOverride: boolean;
	allowDirectKeys: boolean;
	disableDbPingsInHealth: boolean;
	logRetentionDays: number;
	enforceAuthOnInference: boolean;
	dualCredentialConflictBehavior: string;
	allowedOrigins: string;
	maxRequestBodySizeMb: number;
	compatConvertTextToChat: boolean;
	compatConvertChatToResponses: boolean;
	compatShouldDropParams: boolean;
	compatShouldConvertParams: boolean;
	mcpAgentDepth: number;
	mcpToolExecutionTimeout: number;
	mcpCodeModeBindingLevel: string;
	mcpToolSyncInterval: number;
	mcpDisableAutoToolInject: boolean;
	mcpEnableTempTokenAuth: boolean;
	asyncJobResultTtl: number;
	hideDeletedVirtualKeysInFilters: boolean;
	routingChainMaxDepth: number;
	mcpExternalClientUrl: string;
	mcpServerAuthMode: string;
	dumpErrorsInConsoleLogs: boolean;
	pricingUrl: string;
	pricingSyncInterval: number;
	modelParametersUrl: string;
	mcpLibraryUrl: string;
	mcpLibrarySyncInterval: number;
}

export const DUAL_CREDENTIAL_BEHAVIORS = ['prefer_idp', 'prefer_vk', 'error'] as const;
export const MCP_SERVER_AUTH_MODES = ['headers', 'both', 'oauth'] as const;
export const MCP_CODE_MODE_BINDING_LEVELS = ['server', 'tool'] as const;

export interface PersistReloadConfigResult {
	document: JsonRecord | null;
	reloadError?: unknown;
}

export async function persistAndReloadConfigDocument(
	document: JsonRecord,
	persist: (document: JsonRecord) => Promise<unknown>,
	reload: () => Promise<unknown>,
): Promise<PersistReloadConfigResult> {
	await persist(document);
	try {
		const refreshed = await reload();
		if (!isJsonRecord(refreshed)) throw new Error('invalid-config-document');
		return { document: refreshed };
	} catch (reloadError) {
		return { document: null, reloadError };
	}
}

function boolOf(source: JsonRecord, key: string, fallback = false): boolean {
	const value = source[key];
	return typeof value === 'boolean' ? value : fallback;
}

function numOf(source: JsonRecord, key: string, fallback = 0): number {
	const value = source[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function strOf(source: JsonRecord, key: string, fallback = ''): string {
	const value = source[key];
	return typeof value === 'string' ? value : fallback;
}

function csvOf(source: JsonRecord, key: string): string {
	const value = source[key];
	if (!Array.isArray(value)) return '';
	return value.filter((item): item is string => typeof item === 'string').join(', ');
}

function secretValueOf(source: JsonRecord, key: string): string {
	const value = source[key];
	if (isJsonRecord(value)) return typeof value.value === 'string' ? value.value : '';
	return typeof value === 'string' ? value : '';
}

function toNumber(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

function ensureRecord(container: JsonRecord, key: string): JsonRecord {
	const existing = container[key];
	if (isJsonRecord(existing)) return existing;
	const created: JsonRecord = {};
	container[key] = created;
	return created;
}

function setSecretValue(container: JsonRecord, key: string, value: string): void {
	const target = ensureRecord(container, key);
	target.value = value;
}

export function emptyConfigForm(): ConfigForm {
	return {
		authEnabled: false,
		adminUsername: '',
		adminPassword: '',
		dropExcessRequests: false,
		initialPoolSize: 0,
		prometheusLabels: '',
		enableLogging: false,
		disableContentLogging: false,
		retainContentInObjectStorage: false,
		allowPerRequestContentStorageOverride: false,
		allowPerRequestRawOverride: false,
		allowDirectKeys: false,
		disableDbPingsInHealth: false,
		logRetentionDays: 0,
		enforceAuthOnInference: false,
		dualCredentialConflictBehavior: 'prefer_idp',
		allowedOrigins: '',
		maxRequestBodySizeMb: 0,
		compatConvertTextToChat: false,
		compatConvertChatToResponses: false,
		compatShouldDropParams: false,
		compatShouldConvertParams: false,
		mcpAgentDepth: 0,
		mcpToolExecutionTimeout: 0,
		mcpCodeModeBindingLevel: 'server',
		mcpToolSyncInterval: 0,
		mcpDisableAutoToolInject: false,
		mcpEnableTempTokenAuth: false,
		asyncJobResultTtl: 0,
		hideDeletedVirtualKeysInFilters: false,
		routingChainMaxDepth: 0,
		mcpExternalClientUrl: '',
		mcpServerAuthMode: 'headers',
		dumpErrorsInConsoleLogs: false,
		pricingUrl: '',
		pricingSyncInterval: 0,
		modelParametersUrl: '',
		mcpLibraryUrl: '',
		mcpLibrarySyncInterval: 0,
	};
}

export function configFormFromDocument(doc: JsonRecord): ConfigForm {
	const form = emptyConfigForm();
	const auth = isJsonRecord(doc.auth_config) ? doc.auth_config : {};
	const client = isJsonRecord(doc.client_config) ? doc.client_config : {};
	const compat = isJsonRecord(client.compat) ? client.compat : {};
	const framework = isJsonRecord(doc.framework_config) ? doc.framework_config : {};

	form.authEnabled = boolOf(auth, 'is_enabled');
	form.adminUsername = secretValueOf(auth, 'admin_username');
	form.adminPassword = secretValueOf(auth, 'admin_password');

	form.dropExcessRequests = boolOf(client, 'drop_excess_requests');
	form.initialPoolSize = numOf(client, 'initial_pool_size');
	form.prometheusLabels = csvOf(client, 'prometheus_labels');
	form.enableLogging = boolOf(client, 'enable_logging');
	form.disableContentLogging = boolOf(client, 'disable_content_logging');
	form.retainContentInObjectStorage = boolOf(client, 'retain_content_in_object_storage');
	form.allowPerRequestContentStorageOverride = boolOf(client, 'allow_per_request_content_storage_override');
	form.allowPerRequestRawOverride = boolOf(client, 'allow_per_request_raw_override');
	form.allowDirectKeys = boolOf(client, 'allow_direct_keys');
	form.disableDbPingsInHealth = boolOf(client, 'disable_db_pings_in_health');
	form.logRetentionDays = numOf(client, 'log_retention_days');
	form.enforceAuthOnInference = boolOf(client, 'enforce_auth_on_inference');
	form.dualCredentialConflictBehavior = strOf(client, 'dual_credential_conflict_behavior', 'prefer_idp');
	form.allowedOrigins = csvOf(client, 'allowed_origins');
	form.maxRequestBodySizeMb = numOf(client, 'max_request_body_size_mb');
	form.compatConvertTextToChat = boolOf(compat, 'convert_text_to_chat');
	form.compatConvertChatToResponses = boolOf(compat, 'convert_chat_to_responses');
	form.compatShouldDropParams = boolOf(compat, 'should_drop_params');
	form.compatShouldConvertParams = boolOf(compat, 'should_convert_params');
	form.mcpAgentDepth = numOf(client, 'mcp_agent_depth');
	form.mcpToolExecutionTimeout = numOf(client, 'mcp_tool_execution_timeout');
	form.mcpCodeModeBindingLevel = strOf(client, 'mcp_code_mode_binding_level', 'server');
	form.mcpToolSyncInterval = numOf(client, 'mcp_tool_sync_interval');
	form.mcpDisableAutoToolInject = boolOf(client, 'mcp_disable_auto_tool_inject');
	form.mcpEnableTempTokenAuth = boolOf(client, 'mcp_enable_temp_token_auth');
	form.asyncJobResultTtl = numOf(client, 'async_job_result_ttl');
	form.hideDeletedVirtualKeysInFilters = boolOf(client, 'hide_deleted_virtual_keys_in_filters');
	form.routingChainMaxDepth = numOf(client, 'routing_chain_max_depth');
	form.mcpExternalClientUrl = secretValueOf(client, 'mcp_external_client_url');
	form.mcpServerAuthMode = strOf(client, 'mcp_server_auth_mode', 'headers');
	form.dumpErrorsInConsoleLogs = boolOf(client, 'dump_errors_in_console_logs');

	form.pricingUrl = strOf(framework, 'pricing_url');
	form.pricingSyncInterval = numOf(framework, 'pricing_sync_interval');
	form.modelParametersUrl = strOf(framework, 'model_parameters_url');
	form.mcpLibraryUrl = strOf(framework, 'mcp_library_url');
	form.mcpLibrarySyncInterval = numOf(framework, 'mcp_library_sync_interval');
	return form;
}

// 将表单值合并回原始文档：仅覆盖表单管理的字段，其余字段（含状态位、未知新字段）原样保留。
export function mergeConfigForm(base: JsonRecord, form: ConfigForm): JsonRecord {
	// 配置文档是纯 JSON；不能用 structuredClone，因为传入的可能是 Svelte $state 代理对象。
	const doc = JSON.parse(JSON.stringify(base)) as JsonRecord;

	const auth = ensureRecord(doc, 'auth_config');
	auth.is_enabled = form.authEnabled;
	setSecretValue(auth, 'admin_username', form.adminUsername);
	setSecretValue(auth, 'admin_password', form.adminPassword);

	const client = ensureRecord(doc, 'client_config');
	client.drop_excess_requests = form.dropExcessRequests;
	client.initial_pool_size = toNumber(form.initialPoolSize, numOf(client, 'initial_pool_size'));
	client.prometheus_labels = csv(form.prometheusLabels);
	client.enable_logging = form.enableLogging;
	client.disable_content_logging = form.disableContentLogging;
	client.retain_content_in_object_storage = form.retainContentInObjectStorage;
	client.allow_per_request_content_storage_override = form.allowPerRequestContentStorageOverride;
	client.allow_per_request_raw_override = form.allowPerRequestRawOverride;
	client.allow_direct_keys = form.allowDirectKeys;
	client.disable_db_pings_in_health = form.disableDbPingsInHealth;
	client.log_retention_days = toNumber(form.logRetentionDays, numOf(client, 'log_retention_days'));
	client.enforce_auth_on_inference = form.enforceAuthOnInference;
	client.dual_credential_conflict_behavior = form.dualCredentialConflictBehavior || 'prefer_idp';
	client.allowed_origins = csv(form.allowedOrigins);
	client.max_request_body_size_mb = toNumber(form.maxRequestBodySizeMb, numOf(client, 'max_request_body_size_mb'));
	client.mcp_agent_depth = toNumber(form.mcpAgentDepth, numOf(client, 'mcp_agent_depth'));
	client.mcp_tool_execution_timeout = toNumber(form.mcpToolExecutionTimeout, numOf(client, 'mcp_tool_execution_timeout'));
	client.mcp_code_mode_binding_level = form.mcpCodeModeBindingLevel || 'server';
	client.mcp_tool_sync_interval = toNumber(form.mcpToolSyncInterval, numOf(client, 'mcp_tool_sync_interval'));
	client.mcp_disable_auto_tool_inject = form.mcpDisableAutoToolInject;
	client.mcp_enable_temp_token_auth = form.mcpEnableTempTokenAuth;
	client.async_job_result_ttl = toNumber(form.asyncJobResultTtl, numOf(client, 'async_job_result_ttl'));
	client.hide_deleted_virtual_keys_in_filters = form.hideDeletedVirtualKeysInFilters;
	client.routing_chain_max_depth = toNumber(form.routingChainMaxDepth, numOf(client, 'routing_chain_max_depth'));
	setSecretValue(client, 'mcp_external_client_url', form.mcpExternalClientUrl);
	client.mcp_server_auth_mode = form.mcpServerAuthMode || 'headers';
	client.dump_errors_in_console_logs = form.dumpErrorsInConsoleLogs;

	const compat = ensureRecord(client, 'compat');
	compat.convert_text_to_chat = form.compatConvertTextToChat;
	compat.convert_chat_to_responses = form.compatConvertChatToResponses;
	compat.should_drop_params = form.compatShouldDropParams;
	compat.should_convert_params = form.compatShouldConvertParams;

	const framework = ensureRecord(doc, 'framework_config');
	framework.pricing_url = form.pricingUrl;
	framework.pricing_sync_interval = toNumber(form.pricingSyncInterval, numOf(framework, 'pricing_sync_interval'));
	framework.model_parameters_url = form.modelParametersUrl;
	framework.mcp_library_url = form.mcpLibraryUrl;
	framework.mcp_library_sync_interval = toNumber(form.mcpLibrarySyncInterval, numOf(framework, 'mcp_library_sync_interval'));

	return doc;
}
