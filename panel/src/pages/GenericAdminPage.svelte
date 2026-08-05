<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, parseJsonObject, prettyJson } from '../lib/forms';
	import { displayValue, encodePathSegment, getListPayload, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { columnLabelFor } from '../lib/columns';
	import type { ElygateLocale } from '../lib/i18n';

	interface Props { resourceName: string; }

	interface ResourceAction {
		labelKey: string;
		method: 'POST' | 'DELETE';
		path: (record: JsonRecord) => string;
		confirm?: boolean;
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
		updatePath?: (id: string) => string;
		deletePath?: (id: string) => string;
		actions?: ResourceAction[];
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
			listKey: 'endpoints',
			itemKey: 'webhook',
			idFields: ['id'],
			searchParam: 'search',
			columns: ['name', 'url', 'events', 'disabled', 'include_response', 'failure_count'],
			allowCreate: true,
			allowDelete: true,
			createTemplate: {
				name: '',
				url: '',
				events: [],
				headers: {},
				include_response: false,
				allow_private_network: false,
				disabled: false,
			},
			actions: [
				{ labelKey: 'elygate.test', method: 'POST', path: (record) => `/api/webhooks/${encodePathSegment(String(record.id))}/test` },
				{ labelKey: 'elygate.rotateSecret', method: 'POST', path: (record) => `/api/webhooks/${encodePathSegment(String(record.id))}/rotate-secret`, confirm: true },
			],
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
			listKey: 'plugins',
			itemKey: 'plugin',
			idFields: ['name'],
			columns: ['name', 'actualName', 'enabled', 'isCustom', 'path', 'status'],
			allowCreate: true,
			allowDelete: true,
			createTemplate: { name: '', enabled: true, path: null, config: {}, placement: null, order: null },
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
		if (isJsonRecord(payload) && config.listKey) {
			const candidate = payload[config.listKey];
			if (Array.isArray(candidate)) return candidate.filter(isJsonRecord);
		}
		return getListPayload(payload);
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
		return recordId(record) || `${record.name ?? ''}:${record.created_at ?? ''}:${JSON.stringify(record)}`;
	}

	function editableRecord(record: JsonRecord): JsonRecord {
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
				await requestJson(config.endpoint, { method: 'POST', body: JSON.stringify(body) });
			} else if (editing) {
				const id = recordId(editing);
				if (!id) throw new Error(i18n.t('elygate.missingId'));
				await requestJson(config.updatePath ? config.updatePath(id) : `${config.endpoint}/${encodePathSegment(id)}`, {
					method: 'PUT',
					body: JSON.stringify(body),
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
			const payload = await requestJson<JsonRecord>(action.path(record), { method: action.method });
			notice = typeof payload.message === 'string' && payload.message ? payload.message : i18n.t(action.labelKey);
			await load();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		}
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
			<p>{i18n.t(config.readOnly ? 'elygate.readOnlyHint' : 'elygate.jsonEditorHint')}</p>
		</div>
		<div class="heading-actions">
			<button type="button" onclick={() => void load()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button>
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
							<td title={displayValue(record[column])}>{displayValue(record[column])}</td>
						{/each}
						<td class="actions">
							{#if canEdit}<button type="button" onclick={() => openEdit(record)}>{i18n.t('elygate.edit')}</button>{/if}
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
	.modal > header { align-items: center; display: flex; justify-content: space-between; margin-bottom: 1rem; }
	h2 { margin: 0; }
	form { display: grid; gap: .85rem; }
	label { color: var(--foreground); display: grid; font-size: .85rem; font-weight: 650; gap: .35rem; }
	textarea { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); font: 0.8rem ui-monospace, SFMono-Regular, Menlo, monospace; padding: .75rem; resize: vertical; width: 100%; }
	form footer { justify-content: flex-end; }
	@media (max-width: 760px) { .page-heading, .pagination { align-items: stretch; flex-direction: column; } .filters { grid-template-columns: 1fr; } .heading-actions { width: 100%; } .heading-actions button { flex: 1; } }
</style>
