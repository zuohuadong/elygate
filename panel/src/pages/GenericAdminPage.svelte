<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, parseJsonObject, prettyJson } from '../lib/forms';
	import { encodePathSegment, getListPayload, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { columnLabelFor, columnValueFor } from '../lib/columns';
	import type { ElygateLocale } from '../lib/i18n';

	interface Props { resourceName: string; }

	interface ResourceAction {
		labelKey: string;
		method: 'POST' | 'DELETE';
		path: (record: JsonRecord) => string;
		body?: (record: JsonRecord) => unknown;
		confirm?: boolean;
	}

	interface ChildCollectionConfig {
		labelKey: string;
		path: (record: JsonRecord) => string;
		listKey: string;
		columns: string[];
		action?: ResourceAction;
	}

	interface ResourceConfig {
		titleKey: string;
		eyebrow: string;
		endpoint: string;
		listKey?: string;
		itemKey?: string;
		idFields: string[];
		searchParam?: string;
		columns: string[];
		createTemplate?: JsonRecord;
		allowCreate?: boolean;
		allowEdit?: boolean;
		allowDelete?: boolean;
		readOnly?: boolean;
		helpKey?: string;
		createPath?: string;
		updatePath?: (id: string) => string;
		deletePath?: (id: string) => string;
		mapRecord?: (record: JsonRecord) => JsonRecord;
		editRecord?: (record: JsonRecord) => JsonRecord;
		updateBody?: (body: JsonRecord, record: JsonRecord) => unknown;
		actions?: ResourceAction[];
		collectionActions?: ResourceAction[];
		childCollection?: ChildCollectionConfig;
	}

	function pickRecordFields(record: JsonRecord, fields: string[]): JsonRecord {
		return Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, record[field]]));
	}

	function flattenMcpClient(record: JsonRecord): JsonRecord {
		if (!isJsonRecord(record.config)) return record;
		return {
			...record.config,
			state: record.state,
			tools: record.tools,
			vk_configs: record.vk_configs,
		};
	}

	function editableMcpClient(record: JsonRecord): JsonRecord {
		return pickRecordFields(record, [
			'name',
			'is_code_mode_client',
			'headers',
			'per_user_header_keys',
			'tools_to_execute',
			'tools_to_auto_execute',
			'is_ping_available',
			'tool_pricing',
			'allowed_extra_headers',
			'allow_on_all_virtual_keys',
			'disabled',
			'tls_config',
			'vk_configs',
		]);
	}

	const resourceConfigs: Record<string, ResourceConfig> = {
		teams: {
			titleKey: 'elygate.teams',
			eyebrow: 'Elygate / Enterprise Governance',
			endpoint: '/api/governance/teams',
			listKey: 'teams',
			itemKey: 'team',
			idFields: ['id'],
			columns: ['name', 'customer_id', 'calendar_aligned', 'budgets', 'rate_limit'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: { name: '', customer_id: null, calendar_aligned: false, budgets: [], rate_limit: null },
		},
		customers: {
			titleKey: 'elygate.customers',
			eyebrow: 'Elygate / Enterprise Governance',
			endpoint: '/api/governance/customers',
			listKey: 'customers',
			itemKey: 'customer',
			idFields: ['id'],
			columns: ['name', 'calendar_aligned', 'budgets', 'rate_limit'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: { name: '', calendar_aligned: false, budgets: [], rate_limit: null },
		},
		'routing-rules': {
			titleKey: 'elygate.routingRules',
			eyebrow: 'Elygate / Bifrost Routing',
			endpoint: '/api/governance/routing-rules',
			helpKey: 'elygate.routingRulesHelp',
			listKey: 'rules',
			itemKey: 'rule',
			idFields: ['id'],
			columns: ['name', 'enabled', 'scope', 'scope_id', 'priority', 'cel_expression', 'targets'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: {
				name: '',
				description: '',
				enabled: true,
				chain_rule: false,
				scope: 'global',
				scope_id: null,
				priority: 100,
				cel_expression: 'true',
				targets: [{ provider: '', model: '', key_id: '', weight: 1 }],
				fallbacks: [],
				query: null,
			},
		},
		'model-configs': {
			titleKey: 'elygate.modelConfigs',
			eyebrow: 'Elygate / Governance',
			endpoint: '/api/governance/model-configs',
			helpKey: 'elygate.modelConfigsHelp',
			listKey: 'model_configs',
			itemKey: 'model_config',
			idFields: ['id'],
			columns: ['model_name', 'provider', 'scope', 'scope_id', 'budgets', 'rate_limit'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: { model_name: '*', provider: null, scope: 'global', scope_id: null, budgets: [], rate_limit: null },
		},
		'provider-governance': {
			titleKey: 'elygate.providerGovernance',
			eyebrow: 'Elygate / Governance',
			endpoint: '/api/governance/providers',
			listKey: 'providers',
			idFields: ['provider', 'name'],
			columns: ['provider', 'calendar_aligned', 'budgets', 'rate_limit'],
			allowEdit: true,
			allowDelete: true,
			updatePath: (id) => `/api/governance/providers/${encodePathSegment(id)}`,
			deletePath: (id) => `/api/governance/providers/${encodePathSegment(id)}`,
		},
		'pricing-overrides': {
			titleKey: 'elygate.pricingOverrides',
			eyebrow: 'Elygate / Custom Pricing',
			endpoint: '/api/governance/pricing-overrides',
			listKey: 'pricing_overrides',
			itemKey: 'pricing_override',
			idFields: ['id'],
			searchParam: 'search',
			columns: ['name', 'scope_kind', 'provider_id', 'virtual_key_id', 'match_type', 'pattern', 'request_types'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: {
				name: '',
				scope_kind: 'global',
				virtual_key_id: null,
				provider_id: null,
				provider_key_id: null,
				match_type: 'exact',
				pattern: '',
				request_types: [],
				patch: {},
			},
		},
		budgets: {
			titleKey: 'elygate.budgetList',
			eyebrow: 'Elygate / Governance',
			endpoint: '/api/governance/budgets',
			listKey: 'budgets',
			idFields: ['id'],
			columns: ['id', 'max_limit', 'current_usage', 'reset_duration', 'last_reset'],
			readOnly: true,
		},
		'rate-limits': {
			titleKey: 'elygate.rateLimits',
			eyebrow: 'Elygate / Governance',
			endpoint: '/api/governance/rate-limits',
			listKey: 'rate_limits',
			idFields: ['id'],
			columns: ['id', 'token_max_limit', 'token_current_usage', 'request_max_limit', 'request_current_usage'],
			readOnly: true,
		},
		webhooks: {
			titleKey: 'elygate.webhooks',
			eyebrow: 'Elygate / Integrations',
			endpoint: '/api/webhooks',
			helpKey: 'elygate.webhooksHelp',
			listKey: 'endpoints',
			itemKey: 'webhook',
			idFields: ['id'],
			searchParam: 'search',
			columns: ['name', 'url', 'events', 'disabled', 'include_response', 'failure_count'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: {
				name: '',
				url: '',
				events: ['async_job.completed'],
				headers: {},
				include_response: false,
				allow_private_network: false,
				disabled: false,
				max_retries: 0,
				retry_backoff_initial_seconds: 0,
				retry_backoff_max_seconds: 0,
				attempt_timeout_seconds: 0,
				max_response_payload_kbs: 0,
				max_concurrent_deliveries: 0,
			},
			editRecord: (record) => ({
				name: record.name ?? '',
				url: record.url ?? '',
				events: record.events ?? [],
				headers: record.headers ?? {},
				include_response: record.include_response === true,
				allow_private_network: record.allow_private_network === true,
				disabled: record.disabled === true,
				max_retries: record.max_retries ?? 0,
				retry_backoff_initial_seconds: record.retry_backoff_initial_seconds ?? 0,
				retry_backoff_max_seconds: record.retry_backoff_max_seconds ?? 0,
				attempt_timeout_seconds: record.attempt_timeout_seconds ?? 0,
				max_response_payload_kbs: record.max_response_payload_kbs ?? 0,
				max_concurrent_deliveries: record.max_concurrent_deliveries ?? 0,
			}),
			actions: [
				{
					labelKey: 'elygate.test',
					method: 'POST',
					path: (record) => `/api/webhooks/${encodePathSegment(String(record.id))}/test`,
					body: (record) => ({ event: Array.isArray(record.events) && typeof record.events[0] === 'string' ? record.events[0] : 'async_job.completed' }),
				},
				{ labelKey: 'elygate.rotateSecret', method: 'POST', path: (record) => `/api/webhooks/${encodePathSegment(String(record.id))}/rotate-secret`, confirm: true },
			],
			childCollection: {
				labelKey: 'elygate.deliveries',
				path: (record) => `/api/webhooks/${encodePathSegment(String(record.id))}/deliveries?limit=100`,
				listKey: 'deliveries',
				columns: ['created_at', 'event', 'outcome', 'status_code', 'attempt_no', 'error'],
				action: {
					labelKey: 'elygate.redeliver',
					method: 'POST',
					path: (record) => `/api/webhooks/deliveries/${encodePathSegment(String(record.id))}/redeliver`,
					confirm: true,
				},
			},
		},
		'mcp-sessions': {
			titleKey: 'elygate.mcpSessions',
			eyebrow: 'Elygate / MCP',
			endpoint: '/api/mcp/sessions',
			listKey: 'sessions',
			idFields: ['id'],
			searchParam: 'q',
			columns: ['kind', 'auth_kind', 'auth_mode', 'status', 'user_id', 'virtual_key', 'mcp_client', 'created_at', 'expires_at'],
			readOnly: true,
			actions: [
				{ labelKey: 'elygate.reauth', method: 'POST', path: (record) => `/api/mcp/sessions/${encodePathSegment(String(record.id))}/reauth` },
				{ labelKey: 'elygate.revoke', method: 'DELETE', path: (record) => `/api/mcp/sessions/${encodePathSegment(String(record.id))}`, confirm: true },
			],
		},
		'mcp-logs': {
			titleKey: 'elygate.mcpLogs',
			eyebrow: 'Elygate / Observability',
			endpoint: '/api/mcp-logs',
			listKey: 'logs',
			idFields: ['id'],
			searchParam: 'content_search',
			columns: ['id', 'timestamp', 'server_label', 'tool_name', 'status', 'latency', 'cost', 'virtual_key'],
			readOnly: true,
		},
		plugins: {
			titleKey: 'elygate.plugins',
			eyebrow: 'Elygate / Integrations',
			endpoint: '/api/plugins',
			helpKey: 'elygate.pluginsHelp',
			listKey: 'plugins',
			itemKey: 'plugin',
			idFields: ['name'],
			columns: ['name', 'actualName', 'enabled', 'isCustom', 'path', 'status'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: { name: '', enabled: true, path: null, config: {}, placement: null, order: null },
			editRecord: (record) => pickRecordFields(record, ['enabled', 'path', 'config', 'placement', 'order']),
		},
		skills: {
			titleKey: 'elygate.skills',
			eyebrow: 'Elygate / Skills',
			endpoint: '/api/skills',
			listKey: 'skills',
			itemKey: 'skill',
			idFields: ['id'],
			searchParam: 'search',
			columns: ['name', 'description', 'version', 'license', 'compatibility', 'created_at', 'updated_at'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: { name: '', description: '', version: '0.1.0', skill_md_body: '', files: [] },
		},
		'prompt-folders': {
			titleKey: 'elygate.promptFolders',
			eyebrow: 'Elygate / Prompt Repo',
			endpoint: '/api/prompt-repo/folders',
			listKey: 'folders',
			itemKey: 'folder',
			idFields: ['id'],
			columns: ['name', 'description', 'created_at', 'updated_at'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: { name: '', description: null },
		},
		prompts: {
			titleKey: 'elygate.prompts',
			eyebrow: 'Elygate / Prompt Repo',
			endpoint: '/api/prompt-repo/prompts',
			listKey: 'prompts',
			itemKey: 'prompt',
			idFields: ['id'],
			columns: ['name', 'folder_id', 'created_at', 'updated_at'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: { name: '', folder_id: null },
		},
		'mcp-clients': {
			titleKey: 'elygate.mcpClients',
			eyebrow: 'Elygate / MCP Gateway',
			endpoint: '/api/mcp/clients',
			listKey: 'clients',
			itemKey: 'client',
			idFields: ['client_id'],
			searchParam: 'search',
			columns: ['name', 'client_id', 'connection_type', 'auth_type', 'state', 'disabled', 'tools', 'vk_configs'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: {
				name: '',
				connection_type: 'stdio',
				stdio_config: { command: '', args: [], envs: [] },
				auth_type: 'none',
				is_code_mode_client: false,
			},
			createPath: '/api/mcp/client',
			updatePath: (id) => `/api/mcp/client/${encodePathSegment(id)}`,
			deletePath: (id) => `/api/mcp/client/${encodePathSegment(id)}`,
			mapRecord: flattenMcpClient,
			editRecord: editableMcpClient,
			actions: [
				{ labelKey: 'elygate.reconnect', method: 'POST', path: (record) => `/api/mcp/client/${encodePathSegment(String(record.client_id))}/reconnect` },
			],
		},
		'mcp-library': {
			titleKey: 'elygate.mcpLibrary',
			eyebrow: 'Elygate / MCP Gateway',
			endpoint: '/api/mcp/library',
			listKey: 'servers',
			itemKey: 'entry',
			idFields: ['id', 'name'],
			searchParam: 'search',
			columns: ['name', 'description', 'category', 'connection_type', 'auth_type', 'source', 'updated_at'],
			allowCreate: true,
			allowDelete: true,
			createTemplate: {
				name: '',
				description: '',
				category: '',
				connection_type: 'stdio',
				stdio_config: { command: '', args: [], envs: [] },
				auth_type: 'none',
				tags: [],
			},
			deletePath: (id) => `/api/mcp/library/${encodePathSegment(id)}`,
			collectionActions: [
				{ labelKey: 'elygate.sync', method: 'POST', path: () => '/api/mcp/library/force-sync' },
			],
		},
		'oauth2-sessions': {
			titleKey: 'elygate.oauth2Sessions',
			eyebrow: 'Elygate / MCP OAuth2',
			endpoint: '/api/oauth2/sessions',
			listKey: 'sessions',
			idFields: ['id'],
			searchParam: 'q',
			columns: ['client_name', 'client_id', 'bf_mode', 'bf_sub_display', 'scope', 'created_at', 'last_used_at'],
			readOnly: true,
			actions: [
				{ labelKey: 'elygate.revoke', method: 'DELETE', path: (record) => `/api/oauth2/sessions/${encodePathSegment(String(record.id))}`, confirm: true },
			],
		},
		'oauth-grants': {
			titleKey: 'elygate.oauthGrants',
			eyebrow: 'Elygate / MCP OAuth2',
			endpoint: '/api/oauth2/sessions',
			listKey: 'sessions',
			idFields: ['id'],
			searchParam: 'q',
			columns: ['client_name', 'client_id', 'bf_mode', 'bf_sub_display', 'scope', 'created_at', 'last_used_at'],
			readOnly: true,
			actions: [
				{ labelKey: 'elygate.revoke', method: 'DELETE', path: (record) => `/api/oauth2/sessions/${encodePathSegment(String(record.id))}`, confirm: true },
			],
		},
		'feature-flags': {
			titleKey: 'elygate.featureFlags',
			eyebrow: 'Elygate / System',
			endpoint: '/api/feature-flags',
			listKey: 'flags',
			itemKey: 'flag',
			idFields: ['id'],
			columns: ['display_name', 'id', 'enabled', 'source', 'locked', 'registered', 'enterprise_only'],
			allowEdit: true,
			updatePath: (id) => `/api/feature-flags/${encodePathSegment(id)}`,
			editRecord: (record) => pickRecordFields(record, ['enabled']),
		},
		'user-agent-mappings': {
			titleKey: 'elygate.userAgentMappings',
			eyebrow: 'Elygate / Observability',
			endpoint: '/api/logs/user-agent-mappings',
			listKey: 'mappings',
			itemKey: 'mapping',
			idFields: ['id'],
			columns: ['pattern', 'match_type', 'app', 'is_active', 'created_at', 'updated_at'],
			allowCreate: true,
			allowEdit: true,
			allowDelete: true,
			createTemplate: { pattern: '', match_type: 'contains', app: '', is_active: true },
		},
		'provider-keys': {
			titleKey: 'elygate.providerKeys',
			eyebrow: 'Elygate / Models',
			endpoint: '/api/keys',
			idFields: ['id', 'key_id'],
			columns: ['name', 'provider', 'key_id', 'models', 'blacklisted_models', 'weight', 'enabled'],
			readOnly: true,
		},
		'model-catalog': {
			titleKey: 'elygate.modelCatalog',
			eyebrow: 'Elygate / Models',
			endpoint: '/api/models/details',
			listKey: 'models',
			idFields: ['name'],
			searchParam: 'query',
			columns: ['name', 'provider', 'context_length', 'max_input_tokens', 'max_output_tokens', 'is_deprecated', 'additional_attributes'],
			allowEdit: true,
			updatePath: () => '/api/models/catalog',
			editRecord: (record) => ({
				model: record.name,
				provider: record.provider,
				additional_attributes: record.additional_attributes ?? {},
			}),
			updateBody: (body) => [body],
		},
	};

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	const config = $derived(resourceConfigs[resourceName] ?? resourceConfigs.teams);
	const pageTitle = $derived(i18n.t(config.titleKey));
	let records = $state.raw<JsonRecord[]>([]);
	let error = $state('');
	let notice = $state('');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let query = $state('');
	let page = $state(1);
	let pageSize = $state('50');
	let total = $state(0);
	let modal = $state<'create' | 'edit' | null>(null);
	let editing = $state<JsonRecord | null>(null);
	let formJson = $state('');
	let childModal = $state<ChildCollectionConfig | null>(null);
	let childRecords = $state.raw<JsonRecord[]>([]);
	let childParent = $state.raw<JsonRecord | null>(null);
	let isChildLoading = $state(false);
	const columns = $derived(config.columns.length ? config.columns : Array.from(new Set(records.flatMap((record) => Object.keys(record)))).slice(0, 8));
	const hasNext = $derived(page * Number(pageSize) < total);
	const canCreate = $derived(!config.readOnly && config.allowCreate === true);
	const canEdit = $derived(!config.readOnly && config.allowEdit === true);
	const canDelete = $derived(config.allowDelete === true);

	function endpoint(): string {
		const params = new URLSearchParams({ limit: pageSize, offset: String((page - 1) * Number(pageSize)) });
		if (query.trim()) params.set(config.searchParam ?? 'search', query.trim());
		return `${config.endpoint}?${params.toString()}`;
	}

	function responseRecords(payload: unknown): JsonRecord[] {
		let loadedRecords: JsonRecord[];
		if (isJsonRecord(payload) && config.listKey) {
			const candidate = payload[config.listKey];
			loadedRecords = Array.isArray(candidate) ? candidate.filter(isJsonRecord) : getListPayload(payload);
		} else {
			loadedRecords = getListPayload(payload);
		}
		return config.mapRecord ? loadedRecords.map(config.mapRecord) : loadedRecords;
	}

	function responseTotal(payload: unknown, count: number): number {
		const direct = getTotal(payload, -1);
		if (direct >= 0) return direct;
		if (isJsonRecord(payload) && isJsonRecord(payload.pagination)) return getTotal(payload.pagination, count);
		return count;
	}

	function recordId(record: JsonRecord): string {
		for (const field of config.idFields) {
			const value = record[field];
			if (typeof value === 'string' || typeof value === 'number') return String(value);
		}
		return '';
	}

	function rowKey(record: JsonRecord): string {
		const id = recordId(record);
		return id ? `${id}:${record.provider ?? ''}` : `${record.name ?? ''}:${record.created_at ?? ''}:${JSON.stringify(record)}`;
	}

	function editableRecord(record: JsonRecord): JsonRecord {
		if (config.editRecord) return config.editRecord(record);
		const clone: JsonRecord = { ...record };
		for (const key of ['id', 'created_at', 'updated_at', 'deleted_at', 'current_usage', 'token_current_usage', 'request_current_usage']) {
			delete clone[key];
		}
		return clone;
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const payload: unknown = await requestJson(endpoint());
			records = responseRecords(payload);
			total = responseTotal(payload, records.length);
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	function openCreate(): void {
		editing = null;
		formJson = prettyJson(config.createTemplate ?? {});
		error = '';
		notice = '';
		modal = 'create';
	}

	function openEdit(record: JsonRecord): void {
		editing = record;
		formJson = prettyJson(editableRecord(record));
		error = '';
		notice = '';
		modal = 'edit';
	}

	async function save(): Promise<void> {
		isSaving = true;
		error = '';
		try {
			const body = parseJsonObject(formJson, pageTitle, i18n.t('elygate.invalidJson'));
			if (modal === 'create') {
				await requestJson(config.createPath ?? config.endpoint, { method: 'POST', body: JSON.stringify(body) });
			} else if (editing) {
				const id = recordId(editing);
				if (!id) throw new Error(i18n.t('elygate.missingId'));
				await requestJson(config.updatePath ? config.updatePath(id) : `${config.endpoint}/${encodePathSegment(id)}`, {
					method: 'PUT',
					body: JSON.stringify(config.updateBody ? config.updateBody(body, editing) : body),
				});
			}
			modal = null;
			notice = i18n.t('elygate.save');
			await load();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isSaving = false;
		}
	}

	async function remove(record: JsonRecord): Promise<void> {
		const id = recordId(record);
		if (!id || !window.confirm(i18n.t('elygate.confirmDelete'))) return;
		error = '';
		try {
			await requestJson(config.deletePath ? config.deletePath(id) : `${config.endpoint}/${encodePathSegment(id)}`, { method: 'DELETE' });
			notice = i18n.t('elygate.delete');
			await load();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		}
	}

	async function runAction(action: ResourceAction, record: JsonRecord): Promise<void> {
		if (action.confirm && !window.confirm(i18n.t('elygate.confirmAction'))) return;
		error = '';
		try {
			const body = action.body?.(record);
			const payload = await requestJson<unknown>(action.path(record), {
				method: action.method,
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
			notice = isJsonRecord(payload) && typeof payload.secret === 'string'
				? `${i18n.t('elygate.newSecretValue')} ${payload.secret}`
				: isJsonRecord(payload) && typeof payload.message === 'string' && payload.message
					? payload.message
					: i18n.t(action.labelKey);
			await load();
			if (childModal && childParent) await openChildCollection(childModal, childParent);
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		}
	}

	async function openChildCollection(child: ChildCollectionConfig, record: JsonRecord): Promise<void> {
		childModal = child;
		childParent = record;
		isChildLoading = true;
		error = '';
		try {
			const payload = await requestJson<unknown>(child.path(record));
			const candidate = isJsonRecord(payload) ? payload[child.listKey] : undefined;
			childRecords = Array.isArray(candidate) ? candidate.filter(isJsonRecord) : getListPayload(payload);
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
			childRecords = [];
		} finally {
			isChildLoading = false;
		}
	}

	function runCollectionAction(action: ResourceAction): void {
		void runAction(action, {});
	}

	function submitSearch(event: SubmitEvent): void {
		event.preventDefault();
		page = 1;
		void load();
	}

	function submitForm(event: SubmitEvent): void {
		event.preventDefault();
		void save();
	}

	function movePage(nextPage: number): void {
		page = Math.max(1, nextPage);
		void load();
	}

	onMount(() => {
		void load();
	});
</script>

<section class="page-shell">
	<header class="page-heading">
		<div>
			<p class="eyebrow">{config.eyebrow}</p>
			<h1>{pageTitle}</h1>
			<p>{i18n.t(config.helpKey ?? (config.readOnly ? 'elygate.readOnlyHint' : 'elygate.jsonEditorHint'))}</p>
		</div>
		<div class="heading-actions">
			<button class="primary" type="button" onclick={() => void load()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button>
			{#each config.collectionActions ?? [] as action (action.labelKey)}
				<button type="button" onclick={() => runCollectionAction(action)}>{i18n.t(action.labelKey)}</button>
			{/each}
			{#if canCreate}
				<button class="primary" type="button" onclick={openCreate}>{i18n.t('elygate.create')}</button>
			{/if}
		</div>
	</header>

	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}

	<form class="filters" onsubmit={submitSearch}>
		<label>{i18n.t('elygate.search')}<input bind:value={query} /></label>
		<label>{i18n.t('elygate.pageSize')}<select bind:value={pageSize} onchange={() => { page = 1; void load(); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
		<button type="submit" disabled={isLoading}>{i18n.t('elygate.search')}</button>
	</form>

	<div class="table-wrap" aria-busy={isLoading}>
		<table>
			<thead><tr>{#each columns as column (column)}<th>{columnLabelFor(i18n.locale as ElygateLocale, column)}</th>{/each}<th>{i18n.t('elygate.actions')}</th></tr></thead>
			<tbody>
				{#each records as record (rowKey(record))}
					<tr>
						{#each columns as column (column)}
							<td title={columnValueFor(i18n.locale as ElygateLocale, column, record[column])}>{columnValueFor(i18n.locale as ElygateLocale, column, record[column])}</td>
						{/each}
						<td class="actions">
							{#if canEdit}<button type="button" onclick={() => openEdit(record)}>{i18n.t('elygate.edit')}</button>{/if}
							{#if config.childCollection}<button type="button" onclick={() => void openChildCollection(config.childCollection!, record)}>{i18n.t(config.childCollection.labelKey)}</button>{/if}
							{#each config.actions ?? [] as action (action.labelKey)}
								<button type="button" onclick={() => void runAction(action, record)}>{i18n.t(action.labelKey)}</button>
							{/each}
							{#if canDelete}<button class="danger" type="button" onclick={() => void remove(record)}>{i18n.t('elygate.delete')}</button>{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan={columns.length + 1} class="empty">{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.noResults')}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>

	<footer class="pagination">
		<span>{i18n.t('elygate.page').replace('{page}', String(page))} · {total}</span>
		<div><button type="button" onclick={() => movePage(page - 1)} disabled={page <= 1 || isLoading}>{i18n.t('elygate.previous')}</button><button type="button" onclick={() => movePage(page + 1)} disabled={!hasNext || isLoading}>{i18n.t('elygate.next')}</button></div>
	</footer>
</section>

{#if modal}
	<div class="modal-backdrop">
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="generic-dialog-title">
			<header>
				<h2 id="generic-dialog-title">{modal === 'create' ? i18n.t('elygate.create') : i18n.t('elygate.edit')} {pageTitle}</h2>
				<button type="button" onclick={() => (modal = null)}>{i18n.t('elygate.close')}</button>
			</header>
			<form onsubmit={submitForm}>
				<label>{i18n.t('elygate.requestJson')}<textarea bind:value={formJson} rows="18" spellcheck="false"></textarea></label>
				<footer>
					<button type="button" onclick={() => (modal = null)}>{i18n.t('elygate.cancel')}</button>
					<button class="primary" type="submit" disabled={isSaving}>{i18n.t('elygate.save')}</button>
				</footer>
			</form>
		</div>
	</div>
{/if}

{#if childModal}
	<div class="modal-backdrop">
		<div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="child-dialog-title">
			<header><h2 id="child-dialog-title">{i18n.t(childModal.labelKey)}</h2><button type="button" onclick={() => (childModal = null)}>{i18n.t('elygate.close')}</button></header>
			<div class="table-wrap" aria-busy={isChildLoading}><table><thead><tr>{#each childModal.columns as column (column)}<th>{columnLabelFor(i18n.locale as ElygateLocale, column)}</th>{/each}{#if childModal.action}<th>{i18n.t('elygate.actions')}</th>{/if}</tr></thead><tbody>
				{#each childRecords as record (rowKey(record))}<tr>{#each childModal.columns as column (column)}<td title={columnValueFor(i18n.locale as ElygateLocale, column, record[column])}>{columnValueFor(i18n.locale as ElygateLocale, column, record[column])}</td>{/each}{#if childModal.action}<td><button type="button" onclick={() => void runAction(childModal!.action!, record)}>{i18n.t(childModal.action.labelKey)}</button></td>{/if}</tr>{:else}<tr><td colspan={childModal.columns.length + (childModal.action ? 1 : 0)} class="empty">{isChildLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</td></tr>{/each}
			</tbody></table></div>
		</div>
	</div>
{/if}

<style>
	.page-shell { max-width: 1280px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: flex-start; display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .45rem; text-transform: uppercase; }
	h1 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.15rem); }
	.page-heading p { color: var(--muted-foreground); margin: .55rem 0 0; max-width: 760px; }
	.heading-actions, .actions, footer { align-items: center; display: flex; gap: .5rem; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); cursor: pointer; font-weight: 600; padding: .55rem .75rem; white-space: nowrap; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	button:disabled { cursor: wait; opacity: .55; }
	.filters { align-items: end; display: grid; gap: .75rem; grid-template-columns: minmax(240px, 1fr) 130px auto; margin-bottom: 1rem; }
	.filters label { color: var(--muted-foreground); display: grid; font-size: .8rem; font-weight: 650; gap: .35rem; }
	.filters input, .filters select { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); font: inherit; padding: .6rem .7rem; }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .9rem; overflow-x: auto; }
	table { border-collapse: collapse; min-width: 960px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); max-width: 320px; overflow: hidden; padding: .8rem 1rem; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
	th { background: var(--muted); color: var(--muted-foreground); font-size: .75rem; text-transform: uppercase; }
	.notice { border-radius: .65rem; margin-bottom: 1rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 12%, transparent); color: var(--primary); }
	.empty { color: var(--muted-foreground); text-align: center; }
	.pagination { align-items: center; color: var(--muted-foreground); display: flex; justify-content: space-between; margin-top: 1rem; }
	.pagination div { display: flex; gap: .5rem; }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .45); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; max-height: calc(100vh - 2rem); max-width: 920px; overflow: auto; padding: 1.25rem; width: 100%; }
	.modal.wide { max-width: 1180px; }
	.modal > header { align-items: center; display: flex; justify-content: space-between; margin-bottom: 1rem; }
	h2 { margin: 0; }
	form { display: grid; gap: .85rem; }
	label { color: var(--foreground); display: grid; font-size: .85rem; font-weight: 650; gap: .35rem; }
	textarea { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); font: 0.8rem ui-monospace, SFMono-Regular, Menlo, monospace; padding: .75rem; resize: vertical; width: 100%; }
	form footer { justify-content: flex-end; }
	@media (max-width: 760px) { .page-heading, .pagination { align-items: stretch; flex-direction: column; } .filters { grid-template-columns: 1fr; } .heading-actions { width: 100%; } .heading-actions button { flex: 1; } }
</style>
