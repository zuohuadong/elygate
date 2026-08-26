<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayValue, getListPayload, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { displayError } from '../lib/forms';
	import { formatPagination } from '../lib/display-format';
	import {
		PRICING_SCOPE_KINDS,
		REQUEST_TYPES,
		RESET_DURATIONS,
		buildGovernancePayload,
		buildPricingOverridePayload,
		buildPricingOverrideQuery,
		emptyGovernanceDraft,
		emptyPricingOverrideDraft,
		governanceDraftFromRecord,
		pricingOverrideDraftFromRecord,
		type GovernanceDraft,
		type GovernanceEntityKind,
		type PricingOverrideDraft,
		type PricingScopeKind,
	} from '../lib/governance-management';

	interface Props { resourceName: string; }

	const PAGE_SIZE = 25;
	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let records = $state.raw<JsonRecord[]>([]);
	let customers = $state.raw<JsonRecord[]>([]);
	let providers = $state.raw<JsonRecord[]>([]);
	let virtualKeys = $state.raw<JsonRecord[]>([]);
	let providerKeys = $state.raw<JsonRecord[]>([]);
	let total = $state(0);
	let offset = $state(0);
	let search = $state('');
	let customerFilter = $state('');
	let scopeFilter = $state('');
	let providerFilter = $state('');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let busyId = $state('');
	let error = $state('');
	let notice = $state('');
	let modalOpen = $state(false);
	let editingRecord = $state.raw<JsonRecord | null>(null);
	let governanceDraft = $state<GovernanceDraft>(emptyGovernanceDraft('team'));
	let pricingDraft = $state<PricingOverrideDraft>(emptyPricingOverrideDraft());
	const isPricing = $derived(resourceName === 'pricing-overrides');
	const entityKind = $derived<GovernanceEntityKind>(resourceName === 'provider-governance' ? 'provider' : resourceName === 'customers' ? 'customer' : 'team');
	const currentPage = $derived(Math.floor(offset / PAGE_SIZE) + 1);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
	const displayedRecords = $derived(entityKind === 'provider' && !isPricing
		? records.filter((record) => !search.trim() || String(record.provider ?? '').toLowerCase().includes(search.trim().toLowerCase()))
		: records);

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function idOf(record: JsonRecord): string {
		if (typeof record.id === 'string') return record.id;
		return typeof record.provider === 'string' ? record.provider : '';
	}
	function nameOf(record: JsonRecord): string { return typeof record.name === 'string' ? record.name : typeof record.provider === 'string' ? record.provider : ''; }
	function countOf(record: JsonRecord, key: string): number { return typeof record[key] === 'number' ? record[key] as number : 0; }
	function pricingFieldCount(record: JsonRecord): number | string {
		if (isJsonRecord(record.patch)) return Object.keys(record.patch).length;
		if (typeof record.pricing_patch !== 'string') return '—';
		try { const parsed: unknown = JSON.parse(record.pricing_patch); return isJsonRecord(parsed) ? Object.keys(parsed).length : '—'; }
		catch { return '—'; }
	}
	function objectList(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.filter(isJsonRecord) : []; }
	function relationName(record: JsonRecord, key: string, fallbackKey: string): string {
		return isJsonRecord(record[key]) && typeof record[key].name === 'string' ? record[key].name : typeof record[fallbackKey] === 'string' ? String(record[fallbackKey]) : '—';
	}
	function title(): string {
		if (resourceName === 'teams') return text('团队治理', 'Team governance');
		if (resourceName === 'customers') return text('客户治理', 'Customer governance');
		if (resourceName === 'provider-governance') return text('Provider 治理', 'Provider governance');
		return text('价格覆盖', 'Pricing overrides');
	}
	function description(): string {
		if (resourceName === 'teams') return text('管理团队归属、多周期预算、Token/请求限流和日历对齐重置。', 'Manage customer assignment, multi-window budgets, token/request limits, and calendar-aligned resets.');
		if (resourceName === 'customers') return text('管理客户级预算和限流，作为其团队与 Virtual Key 的上层治理边界。', 'Manage customer-level budgets and limits as the parent governance boundary for teams and virtual keys.');
		if (resourceName === 'provider-governance') return text('为每个 Provider 设置全模型预算和限流；未配置的 Provider 也可直接启用治理。', 'Set all-model budgets and limits per provider; governance can be enabled for providers without existing settings.');
		return text('按全局、Provider、Key、Virtual Key 或用户范围覆盖模型定价，并精确限定请求类型和模型模式。', 'Override model pricing by global, provider, key, virtual-key, or user scope with request-type and model-pattern matching.');
	}
	function validationMessage(cause: unknown): string {
		if (!(cause instanceof Error)) return text('保存失败。', 'Failed to save.');
		const messages: Record<string, string> = {
			'name-required': text('名称不能为空。', 'Name is required.'),
			'provider-required': text('请选择 Provider。', 'Provider is required.'),
			'user-required': text('该范围必须填写用户 ID。', 'This scope requires a user ID.'),
			'virtual-key-required': text('该范围必须填写 Virtual Key ID。', 'This scope requires a virtual-key ID.'),
			'provider-key-required': text('该范围必须填写 Provider Key ID。', 'This scope requires a provider-key ID.'),
			'budget-duration-duplicate': text('每个预算必须使用不同的重置周期。', 'Each budget must use a distinct reset window.'),
			'token-limit-invalid': text('Token 上限必须是至少 1 的整数。', 'Token limit must be an integer of at least 1.'),
			'request-limit-invalid': text('请求上限必须是至少 1 的整数。', 'Request limit must be an integer of at least 1.'),
			'pattern-required': text('模型模式不能为空。', 'Model pattern is required.'),
			'pattern-exact': text('精确模式不能包含 *。', 'Exact patterns cannot contain *.'),
			'pattern-wildcard': text('通配模式只能包含一个结尾的 *。', 'Wildcard patterns require exactly one trailing *.'),
			'request-types-required': text('至少选择一个请求类型。', 'Select at least one request type.'),
			'patch-object': text('价格补丁必须是 JSON 对象。', 'Pricing patch must be a JSON object.'),
			'patch-required': text('价格补丁至少包含一个字段。', 'Pricing patch requires at least one field.'),
		};
		if (messages[cause.message]) return messages[cause.message];
		if (cause.message.startsWith('budget-')) return text('预算金额必须至少为 0.01。', 'Budget amount must be at least 0.01.');
		if (cause.message.startsWith('patch-field:')) return text(`价格字段 ${cause.message.slice(12)} 必须是非负数。`, `Pricing field ${cause.message.slice(12)} must be a non-negative number.`);
		if (cause instanceof SyntaxError) return text('JSON 格式无效。', 'Invalid JSON.');
		return cause.message;
	}

	async function loadReferences(): Promise<void> {
		const [customerResult, providerResult, virtualKeyResult] = await Promise.allSettled([
			requestJson<unknown>('/api/governance/customers'),
			requestJson<unknown>('/api/providers'),
			requestJson<unknown>('/api/governance/virtual-keys'),
		]);
		if (customerResult.status === 'fulfilled') customers = getListPayload(customerResult.value);
		if (providerResult.status === 'fulfilled') providers = getListPayload(providerResult.value);
		if (virtualKeyResult.status === 'fulfilled') virtualKeys = getListPayload(virtualKeyResult.value);
	}

	async function loadProviderKeys(provider: string): Promise<void> {
		providerKeys = [];
		if (!provider.trim()) return;
		try { providerKeys = getListPayload(await requestJson<unknown>(`/api/providers/${encodeURIComponent(provider.trim())}/keys`)); }
		catch { providerKeys = []; }
	}

	async function load(reset = false): Promise<void> {
		if (reset) offset = 0;
		isLoading = true; error = '';
		try {
			if (entityKind === 'provider' && !isPricing) {
				const payload = await requestJson<unknown>('/api/governance/providers');
				const configured = getListPayload(payload);
				const byName = new Map(configured.map((record) => [String(record.provider ?? ''), record]));
				const providerNames = providers.map((provider) => String(provider.name ?? provider.provider ?? '')).filter(Boolean);
				records = [...new Set([...providerNames, ...byName.keys()])].sort().map((provider) => byName.get(provider) ?? { provider, budgets: [], rate_limit: null, calendar_aligned: false });
				total = records.length;
				return;
			}
			let path: string;
			if (isPricing) path = `/api/governance/pricing-overrides?${buildPricingOverrideQuery({ search, scopeKind: scopeFilter, providerId: providerFilter, limit: PAGE_SIZE, offset })}`;
			else {
				const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
				if (search.trim()) query.set('search', search.trim());
				if (entityKind === 'team' && customerFilter) query.set('customer_id', customerFilter);
				path = `/api/governance/${resourceName}?${query}`;
			}
			const payload = await requestJson<unknown>(path);
			records = getListPayload(payload);
			total = getTotal(payload, records.length);
			if (total > 0 && offset >= total) { offset = Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE; await load(); }
		} catch (cause) { error = displayError(cause, text('治理数据加载失败。', 'Failed to load governance data.')); }
		finally { isLoading = false; }
	}

	function openCreate(): void {
		editingRecord = null;
		if (isPricing) pricingDraft = emptyPricingOverrideDraft();
		else governanceDraft = emptyGovernanceDraft(entityKind, entityKind === 'provider' ? String(providers[0]?.name ?? '') : '');
		modalOpen = true; error = '';
	}
	function openEdit(record: JsonRecord): void {
		editingRecord = record;
		if (isPricing) {
			pricingDraft = pricingOverrideDraftFromRecord(record);
			void loadProviderKeys(pricingDraft.providerId);
		} else governanceDraft = governanceDraftFromRecord(record, entityKind);
		modalOpen = true; error = '';
	}
	function addBudget(): void {
		governanceDraft.budgets = [...governanceDraft.budgets, { key: `new-${Date.now()}-${governanceDraft.budgets.length}`, maxLimit: '', resetDuration: '1M' }];
	}
	function removeBudget(key: string): void { governanceDraft.budgets = governanceDraft.budgets.filter((budget) => budget.key !== key); }
	function toggleRequestType(requestType: string): void {
		pricingDraft.requestTypes = pricingDraft.requestTypes.includes(requestType) ? pricingDraft.requestTypes.filter((type) => type !== requestType) : [...pricingDraft.requestTypes, requestType];
	}
	function changePricingProvider(provider: string): void { pricingDraft.providerId = provider; pricingDraft.providerKeyId = ''; void loadProviderKeys(provider); }

	async function save(): Promise<void> {
		if (isSaving) return;
		isSaving = true; error = ''; notice = '';
		try {
			let path: string; let method: 'POST' | 'PUT'; let payload: JsonRecord;
			if (isPricing) {
				payload = buildPricingOverridePayload(pricingDraft);
				path = editingRecord ? `/api/governance/pricing-overrides/${encodeURIComponent(idOf(editingRecord))}` : '/api/governance/pricing-overrides';
				method = editingRecord ? 'PUT' : 'POST';
			} else {
				const wasAligned = editingRecord?.calendar_aligned === true;
				if (editingRecord && !wasAligned && governanceDraft.calendarAligned && !window.confirm(text('启用日历对齐会把当前周期重置到日/周/月边界，确认继续？', 'Enabling calendar alignment snaps the current period to a day/week/month boundary. Continue?'))) return;
				payload = buildGovernancePayload(governanceDraft, entityKind, Boolean(editingRecord) || entityKind === 'provider');
				if (entityKind === 'provider') { path = `/api/governance/providers/${encodeURIComponent(governanceDraft.provider)}`; method = 'PUT'; }
				else { path = editingRecord ? `/api/governance/${resourceName}/${encodeURIComponent(idOf(editingRecord))}` : `/api/governance/${resourceName}`; method = editingRecord ? 'PUT' : 'POST'; }
			}
			await requestJson<unknown>(path, { method, body: JSON.stringify(payload) });
			modalOpen = false; notice = text('治理配置已保存并同步到运行时。', 'Governance configuration saved and synced to runtime.'); await load();
		} catch (cause) { error = validationMessage(cause); }
		finally { isSaving = false; }
	}

	async function remove(record: JsonRecord): Promise<void> {
		const id = idOf(record); if (!id || busyId || !window.confirm(text(`确认删除 ${nameOf(record)} 的治理配置？`, `Delete governance configuration for ${nameOf(record)}?`))) return;
		busyId = id; error = ''; notice = '';
		try {
			const path = isPricing ? `/api/governance/pricing-overrides/${encodeURIComponent(id)}` : entityKind === 'provider' ? `/api/governance/providers/${encodeURIComponent(id)}` : `/api/governance/${resourceName}/${encodeURIComponent(id)}`;
			await requestJson<unknown>(path, { method: 'DELETE' });
			notice = entityKind === 'provider' ? text('Provider 治理已重置。', 'Provider governance reset.') : text('记录已删除。', 'Record deleted.'); await load();
		} catch (cause) { error = displayError(cause, text('删除失败。', 'Failed to delete.')); }
		finally { busyId = ''; }
	}

	onMount(() => { void (async () => { await loadReferences(); await load(); })(); });
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading"><div><p class="eyebrow">{getAppName()} / Governance</p><h1>{title()}</h1><p>{description()}</p></div>{#if entityKind !== 'provider' || isPricing}<button class="primary" type="button" onclick={openCreate}>+ {isPricing ? text('添加价格覆盖', 'Add pricing override') : entityKind === 'team' ? text('创建团队', 'Create team') : text('创建客户', 'Create customer')}</button>{/if}</header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<form class="toolbar" onsubmit={(event) => { event.preventDefault(); void load(true); }}><label>{text('搜索', 'Search')}<input bind:value={search} placeholder={isPricing ? text('名称或模型模式', 'Name or model pattern') : text('名称', 'Name')} /></label>{#if entityKind === 'team' && !isPricing}<label>{text('客户', 'Customer')}<select bind:value={customerFilter}><option value="">{text('全部', 'All')}</option>{#each customers as customer (idOf(customer))}<option value={idOf(customer)}>{nameOf(customer)}</option>{/each}</select></label>{/if}{#if isPricing}<label>{text('范围', 'Scope')}<select bind:value={scopeFilter}><option value="">{text('全部', 'All')}</option>{#each PRICING_SCOPE_KINDS as scope (scope)}<option value={scope}>{scope}</option>{/each}</select></label><label>Provider<input list="governance-providers" bind:value={providerFilter} /></label>{/if}<button type="submit">{text('应用筛选', 'Apply')}</button><button type="button" onclick={() => { search = ''; customerFilter = ''; scopeFilter = ''; providerFilter = ''; void load(true); }}>{text('清除', 'Clear')}</button></form>

	<div class="table-wrap" class:loading={isLoading}><table><thead>{#if isPricing}<tr><th>{text('名称', 'Name')}</th><th>{text('范围', 'Scope')}</th><th>{text('目标', 'Target')}</th><th>{text('模型模式', 'Model pattern')}</th><th>{text('请求类型', 'Request types')}</th><th>{text('价格字段', 'Pricing fields')}</th><th>{text('操作', 'Actions')}</th></tr>{:else}<tr><th>{entityKind === 'provider' ? 'Provider' : text('名称', 'Name')}</th>{#if entityKind === 'team'}<th>{text('客户', 'Customer')}</th>{/if}<th>{text('预算', 'Budgets')}</th><th>{text('限流', 'Rate limit')}</th><th>{text('日历对齐', 'Calendar aligned')}</th>{#if entityKind !== 'provider'}<th>Virtual Keys</th>{/if}<th>{text('操作', 'Actions')}</th></tr>{/if}</thead><tbody>{#each displayedRecords as record (idOf(record))}{#if isPricing}<tr><td><strong>{nameOf(record)}</strong><small>{idOf(record)}</small></td><td><span class="badge">{displayValue(record.scope_kind)}</span></td><td>{displayValue(record.user_id ?? record.virtual_key_id ?? record.provider_key_id ?? record.provider_id)}</td><td><code>{displayValue(record.pattern)}</code><small>{displayValue(record.match_type)}</small></td><td>{displayValue(record.request_types)}</td><td>{pricingFieldCount(record)}</td><td><div class="actions"><button type="button" onclick={() => openEdit(record)}>{text('编辑', 'Edit')}</button><button class="danger" type="button" disabled={busyId === idOf(record)} onclick={() => void remove(record)}>{text('删除', 'Delete')}</button></div></td></tr>{:else}<tr><td><strong>{nameOf(record)}</strong></td>{#if entityKind === 'team'}<td>{relationName(record, 'customer', 'customer_id')}</td>{/if}<td><div class="budget-list">{#each objectList(record.budgets) as budget (String(budget.id ?? budget.reset_duration))}<span>{displayValue(budget.max_limit)} / {displayValue(budget.reset_duration)}</span>{:else}<span>—</span>{/each}</div></td><td>{#if isJsonRecord(record.rate_limit)}<span>{text('Token', 'Token')}: {displayValue(record.rate_limit.token_max_limit)}</span><br /><span>{text('请求', 'Requests')}: {displayValue(record.rate_limit.request_max_limit)}</span>{:else}—{/if}</td><td>{record.calendar_aligned === true ? text('是', 'Yes') : text('否', 'No')}</td>{#if entityKind !== 'provider'}<td>{countOf(record, 'virtual_key_count')}</td>{/if}<td><div class="actions"><button type="button" onclick={() => openEdit(record)}>{entityKind === 'provider' && objectList(record.budgets).length === 0 && !isJsonRecord(record.rate_limit) ? text('配置', 'Configure') : text('编辑', 'Edit')}</button><button class="danger" type="button" disabled={busyId === idOf(record)} onclick={() => void remove(record)}>{entityKind === 'provider' ? text('重置', 'Reset') : text('删除', 'Delete')}</button></div></td></tr>{/if}{:else}<tr><td class="empty" colspan="8">{isLoading ? text('加载中…', 'Loading…') : text('没有匹配记录。', 'No matching records.')}</td></tr>{/each}</tbody></table></div>
	{#if entityKind !== 'provider' || isPricing}<footer class="pagination"><span>{formatPagination(currentPage, totalPages, total, i18n.locale)}</span><div><button type="button" disabled={offset === 0 || isLoading} onclick={() => { offset = Math.max(0, offset - PAGE_SIZE); void load(); }}>{text('上一页', 'Previous')}</button><button type="button" disabled={offset + PAGE_SIZE >= total || isLoading} onclick={() => { offset += PAGE_SIZE; void load(); }}>{text('下一页', 'Next')}</button></div></footer>{/if}
</section>

<datalist id="governance-providers">{#each providers as provider (nameOf(provider))}<option value={nameOf(provider)}></option>{/each}</datalist>
<datalist id="governance-virtual-keys">{#each virtualKeys as key (idOf(key))}<option value={idOf(key)}>{nameOf(key)}</option>{/each}</datalist>
<datalist id="governance-provider-keys">{#each providerKeys as key (idOf(key))}<option value={idOf(key)}>{nameOf(key)}</option>{/each}</datalist>

{#if modalOpen}
	<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !isSaving) modalOpen = false; }}><div class="modal" role="dialog" aria-modal="true" aria-labelledby="governance-modal-title"><header><div><h2 id="governance-modal-title">{editingRecord ? text('编辑', 'Edit') : text('创建', 'Create')} {title()}</h2><p>{isPricing ? text('价格补丁完整替换；未选范围字段会显式清空。', 'The pricing patch is replaced in full; unused scope IDs are explicitly cleared.') : text('预算数组是完整期望状态，删除预算行会在保存后移除对应周期。', 'Budgets are the full desired state; removing a row removes that window on save.')}</p></div><button type="button" aria-label={text('关闭', 'Close')} onclick={() => (modalOpen = false)}>×</button></header>
		{#if isPricing}
			<div class="form-grid"><label>{text('名称', 'Name')}<input bind:value={pricingDraft.name} placeholder="gpt-5-team-pricing" /></label><label>{text('范围', 'Scope')}<select bind:value={pricingDraft.scopeKind}>{#each PRICING_SCOPE_KINDS as scope (scope)}<option value={scope}>{scope}</option>{/each}</select></label>{#if pricingDraft.scopeKind.startsWith('user')}<label>{text('用户 ID', 'User ID')}<input bind:value={pricingDraft.userId} /></label>{/if}{#if pricingDraft.scopeKind.startsWith('virtual_key')}<label>Virtual Key ID<input list="governance-virtual-keys" bind:value={pricingDraft.virtualKeyId} /></label>{/if}{#if pricingDraft.scopeKind.includes('provider')}<label>Provider<input list="governance-providers" value={pricingDraft.providerId} onchange={(event) => changePricingProvider(event.currentTarget.value)} /></label>{/if}{#if pricingDraft.scopeKind.endsWith('provider_key')}<label>Provider Key ID<input list="governance-provider-keys" bind:value={pricingDraft.providerKeyId} /></label>{/if}<label>{text('匹配方式', 'Match type')}<select bind:value={pricingDraft.matchType}><option value="exact">exact</option><option value="wildcard">wildcard</option></select></label><label>{text('模型模式', 'Model pattern')}<input bind:value={pricingDraft.pattern} placeholder={pricingDraft.matchType === 'wildcard' ? 'gpt-5*' : 'gpt-5'} /></label><fieldset class="span-2"><legend>{text('请求类型（至少选择一个）', 'Request types (select at least one)')}</legend><div class="request-types">{#each REQUEST_TYPES as requestType (requestType)}<label class="check"><input type="checkbox" checked={pricingDraft.requestTypes.includes(requestType)} onchange={() => toggleRequestType(requestType)} />{requestType}</label>{/each}</div></fieldset><label class="span-2">{text('价格补丁 JSON', 'Pricing patch JSON')}<textarea class="json-editor" rows="18" bind:value={pricingDraft.patchJson}></textarea><small>{text('支持后端 PricingOptions 的全部非负数值字段，例如 input_cost_per_token、cache_read_input_token_cost、output_cost_per_image。', 'Supports every non-negative backend PricingOptions field, such as input_cost_per_token, cache_read_input_token_cost, and output_cost_per_image.')}</small></label></div>
		{:else}
			<div class="form-grid">{#if entityKind !== 'provider'}<label>{entityKind === 'team' ? text('团队名称', 'Team name') : text('客户名称', 'Customer name')}<input bind:value={governanceDraft.name} maxlength="50" /></label>{:else}<label>Provider<input value={governanceDraft.provider} disabled /></label>{/if}{#if entityKind === 'team'}<label>{text('所属客户（可选）', 'Customer (optional)')}<select bind:value={governanceDraft.customerId}><option value="">{text('无', 'None')}</option>{#each customers as customer (idOf(customer))}<option value={idOf(customer)}>{nameOf(customer)}</option>{/each}</select></label>{/if}<label class="check span-2"><input type="checkbox" bind:checked={governanceDraft.calendarAligned} /><span><strong>{text('日历对齐重置', 'Calendar-aligned resets')}</strong><small>{text('仅日/周/月等周期支持；首次启用会重置当前周期。', 'Supported for day/week/month windows; enabling it initially resets the current period.')}</small></span></label></div>
			<section class="editor-section"><div class="section-heading"><div><h3>{text('多周期预算', 'Multi-window budgets')}</h3><p>{text('每个重置周期只能有一个预算。', 'Each reset window may appear only once.')}</p></div><button type="button" onclick={addBudget}>+ {text('添加预算', 'Add budget')}</button></div><div class="budget-editor">{#each governanceDraft.budgets as budget (budget.key)}<div><label>{text('金额', 'Amount')}<input type="number" min="0.01" step="0.01" bind:value={budget.maxLimit} /></label><label>{text('周期', 'Window')}<select bind:value={budget.resetDuration}>{#each RESET_DURATIONS as duration (duration)}<option value={duration}>{duration}</option>{/each}</select></label><button class="danger" type="button" onclick={() => removeBudget(budget.key)}>{text('移除', 'Remove')}</button></div>{:else}<p class="empty-inline">{text('未设置预算。', 'No budgets configured.')}</p>{/each}</div></section>
			<section class="editor-section"><h3>{text('限流', 'Rate limits')}</h3><div class="form-grid"><label>{text('Token 上限', 'Token limit')}<input type="number" min="1" step="1" bind:value={governanceDraft.tokenMaxLimit} /></label><label>{text('Token 周期', 'Token window')}<select bind:value={governanceDraft.tokenResetDuration}>{#each RESET_DURATIONS as duration (duration)}<option value={duration}>{duration}</option>{/each}</select></label><label>{text('请求上限', 'Request limit')}<input type="number" min="1" step="1" bind:value={governanceDraft.requestMaxLimit} /></label><label>{text('请求周期', 'Request window')}<select bind:value={governanceDraft.requestResetDuration}>{#each RESET_DURATIONS as duration (duration)}<option value={duration}>{duration}</option>{/each}</select></label></div><p>{text('同时清空 Token 和请求上限会移除已有 Rate Limit。', 'Clearing both token and request limits removes the existing rate limit.')}</p></section>
		{/if}
		<footer><button type="button" onclick={() => (modalOpen = false)}>{text('取消', 'Cancel')}</button><button class="primary" type="button" disabled={isSaving} onclick={() => void save()}>{isSaving ? text('保存中…', 'Saving…') : text('保存', 'Save')}</button></footer></div></div>
{/if}

<style>
	.page-shell { margin: 0 auto; max-width: 1380px; padding: 1.5rem; }
	.page-heading, .modal > header, .modal > footer, .section-heading, .pagination, .toolbar, .actions { align-items: center; display: flex; flex-wrap: wrap; gap: .65rem; justify-content: space-between; }
	.page-heading { align-items: start; }
	.page-heading h1, .modal h2, h3 { margin: 0; }
	.page-heading p, .modal header p, .section-heading p, .editor-section > p { color: var(--muted-foreground); margin: .42rem 0 0; max-width: 880px; }
	.eyebrow { color: var(--primary) !important; font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
	button, input, select, textarea, fieldset { border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); font: inherit; }
	button, select { background: var(--muted); cursor: pointer; padding: .55rem .7rem; }
	input, textarea { background: var(--background); padding: .6rem .7rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	button:disabled { cursor: not-allowed; opacity: .5; }
	.notice { border-radius: .65rem; margin-top: .8rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 10%, transparent); color: var(--primary); }
	.toolbar { justify-content: start; margin: 1rem 0 .8rem; }
	.toolbar label, .form-grid label, .budget-editor label { color: var(--muted-foreground); display: grid; font-size: .75rem; gap: .3rem; }
	.toolbar input { min-width: 240px; }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; overflow-x: auto; }
	.table-wrap.loading { opacity: .65; }
	table { border-collapse: collapse; min-width: 1050px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); font-size: .78rem; padding: .7rem .8rem; text-align: left; vertical-align: top; }
	th { color: var(--muted-foreground); }
	td strong, td small { display: block; }
	td small { color: var(--muted-foreground); margin-top: .2rem; }
	.badge, .budget-list span { background: var(--muted); border-radius: 999px; display: inline-block; font-size: .68rem; margin: .1rem; padding: .2rem .48rem; }
	.empty { color: var(--muted-foreground); padding: 2rem; text-align: center; }
	.pagination { margin-top: .75rem; }
	.pagination div { display: flex; gap: .5rem; }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .55); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; display: grid; gap: 1rem; max-height: 92vh; max-width: 920px; overflow: auto; padding: 1.15rem; width: 100%; }
	.modal > footer { border-top: 1px solid var(--border); justify-content: end; padding-top: .9rem; }
	.form-grid { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-grid input, .form-grid select, .form-grid textarea { width: 100%; }
	.form-grid small, label.check small { color: var(--muted-foreground); }
	.span-2 { grid-column: 1 / -1; }
	label.check { align-items: start; display: flex; gap: .55rem; }
	label.check input { margin-top: .2rem; width: auto; }
	label.check span, label.check small { display: block; }
	fieldset { padding: .8rem; }
	fieldset legend { color: var(--muted-foreground); font-size: .75rem; padding: 0 .3rem; }
	.request-types { display: grid; gap: .45rem; grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.json-editor { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .76rem; line-height: 1.5; }
	.editor-section { border-top: 1px solid var(--border); padding-top: .9rem; }
	.budget-editor { display: grid; gap: .55rem; margin-top: .65rem; }
	.budget-editor > div { align-items: end; display: grid; gap: .55rem; grid-template-columns: 1fr 1fr auto; }
	.empty-inline { color: var(--muted-foreground); margin: .5rem 0; }
	@media (max-width: 720px) { .page-shell { padding: 1rem; } .page-heading, .pagination { align-items: stretch; flex-direction: column; } .form-grid, .request-types { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } .budget-editor > div { grid-template-columns: 1fr; } .toolbar label, .toolbar input { width: 100%; } }
</style>
