<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayValue, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { displayError, prettyJson } from '../lib/forms';
	import {
		WEBHOOK_EVENTS,
		buildWebhookPayload,
		buildWebhookQuery,
		emptyWebhookDraft,
		endpointPayload,
		webhookDraftFromEndpoint,
		type WebhookDraft,
		type WebhookEvent,
	} from '../lib/webhooks';

	interface Props { resourceName: string; }
	type ModalKind = 'editor' | 'detail' | 'secret' | null;

	const PAGE_SIZE = 25;
	const DELIVERY_PAGE_SIZE = 50;
	const tuningFields: { key: keyof Pick<WebhookDraft, 'maxRetries' | 'retryBackoffInitialSeconds' | 'retryBackoffMaxSeconds' | 'attemptTimeoutSeconds' | 'maxResponsePayloadKbs' | 'maxConcurrentDeliveries'>; zh: string; en: string; fallback: number }[] = [
		{ key: 'maxRetries', zh: '最大重试次数', en: 'Max retries', fallback: 4 },
		{ key: 'retryBackoffInitialSeconds', zh: '初始重试间隔（秒）', en: 'Initial backoff (seconds)', fallback: 30 },
		{ key: 'retryBackoffMaxSeconds', zh: '最大重试间隔（秒）', en: 'Max backoff (seconds)', fallback: 1800 },
		{ key: 'attemptTimeoutSeconds', zh: '单次投递超时（秒）', en: 'Attempt timeout (seconds)', fallback: 10 },
		{ key: 'maxResponsePayloadKbs', zh: '最大响应载荷（KB）', en: 'Max response payload (KB)', fallback: 256 },
		{ key: 'maxConcurrentDeliveries', zh: '最大并发投递数', en: 'Max concurrent deliveries', fallback: 10 },
	];
	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let endpoints = $state.raw<JsonRecord[]>([]);
	let total = $state(0);
	let offset = $state(0);
	let search = $state('');
	let eventFilters = $state<string[]>([]);
	let statusFilter = $state<'' | 'enabled' | 'disabled'>('');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let busyId = $state('');
	let error = $state('');
	let notice = $state('');
	let modal = $state<ModalKind>(null);
	let selected = $state.raw<JsonRecord | null>(null);
	let editingId = $state('');
	let draft = $state<WebhookDraft>(emptyWebhookDraft());
	let secretName = $state('');
	let secretValue = $state('');
	let testEvent = $state<WebhookEvent>('async_job.completed');
	let deliveries = $state.raw<JsonRecord[]>([]);
	let deliveryTotal = $state(0);
	let deliveryOffset = $state(0);
	let isDeliveryLoading = $state(false);
	const currentPage = $derived(Math.floor(offset / PAGE_SIZE) + 1);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
	const deliveryPage = $derived(Math.floor(deliveryOffset / DELIVERY_PAGE_SIZE) + 1);
	const deliveryPages = $derived(Math.max(1, Math.ceil(deliveryTotal / DELIVERY_PAGE_SIZE)));

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function list(payload: unknown, key: string): JsonRecord[] {
		if (!isJsonRecord(payload) || !Array.isArray(payload[key])) return [];
		return payload[key].filter(isJsonRecord);
	}
	function idOf(record: JsonRecord): string { return typeof record.id === 'string' ? record.id : ''; }
	function date(value: unknown): string {
		if (typeof value !== 'string' || !value) return '—';
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(i18n.locale);
	}
	function eventLabel(event: string): string {
		return event === 'async_job.completed' ? text('异步任务完成', 'Async job completed') : event === 'async_job.failed' ? text('异步任务失败', 'Async job failed') : event;
	}
	function validationMessage(cause: unknown): string {
		if (!(cause instanceof Error)) return text('保存失败。', 'Failed to save.');
		if (cause.message === 'name-required') return text('名称为必填项。', 'Name is required.');
		if (cause.message === 'url-invalid') return text('请输入有效的 HTTP(S) 地址。', 'Enter a valid HTTP(S) URL.');
		if (cause.message === 'http-private-required') return text('HTTP 地址必须显式启用“允许私有网络”。', 'HTTP URLs require “Allow private network”.');
		if (cause.message === 'events-required') return text('至少订阅一个事件。', 'Subscribe to at least one event.');
		if (cause.message.startsWith('header-value:')) return text(`请求头 ${cause.message.slice(13)} 缺少值。`, `Header ${cause.message.slice(13)} requires a value.`);
		if (cause.message.startsWith('invalid:')) return text('投递参数必须是非负整数。', 'Delivery tuning values must be non-negative integers.');
		return cause.message;
	}

	async function load(reset = false): Promise<void> {
		if (reset) offset = 0;
		isLoading = true; error = '';
		try {
			const payload = await requestJson<unknown>(`/api/webhooks?${buildWebhookQuery({ search, events: eventFilters, status: statusFilter, limit: PAGE_SIZE, offset })}`);
			endpoints = list(payload, 'endpoints');
			total = getTotal(payload, endpoints.length);
			if (selected && modal === 'detail') selected = endpoints.find((endpoint) => idOf(endpoint) === idOf(selected!)) ?? selected;
			if (total > 0 && offset >= total) { offset = Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE; await load(); }
		} catch (cause) { error = displayError(cause, text('Webhook 加载失败。', 'Failed to load webhooks.')); }
		finally { isLoading = false; }
	}

	async function loadDeliveries(reset = false): Promise<void> {
		if (!selected) return;
		if (reset) deliveryOffset = 0;
		isDeliveryLoading = true;
		try {
			const payload = await requestJson<unknown>(`/api/webhooks/${encodeURIComponent(idOf(selected))}/deliveries?limit=${DELIVERY_PAGE_SIZE}&offset=${deliveryOffset}`);
			deliveries = list(payload, 'deliveries');
			const pagination = isJsonRecord(payload) && isJsonRecord(payload.pagination) ? payload.pagination : {};
			deliveryTotal = typeof pagination.total_count === 'number' ? pagination.total_count : deliveries.length;
		} catch (cause) { error = displayError(cause, text('投递历史加载失败。', 'Failed to load delivery history.')); }
		finally { isDeliveryLoading = false; }
	}

	function openCreate(): void { editingId = ''; draft = emptyWebhookDraft(); modal = 'editor'; error = ''; }
	function openEdit(endpoint: JsonRecord): void { editingId = idOf(endpoint); draft = webhookDraftFromEndpoint(endpoint); modal = 'editor'; error = ''; }
	async function openDetails(endpoint: JsonRecord): Promise<void> { selected = endpoint; deliveryOffset = 0; testEvent = 'async_job.completed'; modal = 'detail'; error = ''; await loadDeliveries(); }
	function toggleDraftEvent(event: WebhookEvent): void {
		draft.events = draft.events.includes(event) ? draft.events.filter((current) => current !== event) : [...draft.events, event];
	}

	async function save(): Promise<void> {
		if (isSaving) return;
		isSaving = true; error = ''; notice = '';
		try {
			const payload = buildWebhookPayload(draft);
			const response = await requestJson<unknown>(editingId ? `/api/webhooks/${encodeURIComponent(editingId)}` : '/api/webhooks', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
			modal = null;
			if (!editingId && isJsonRecord(response) && typeof response.secret === 'string') revealSecret(isJsonRecord(response.endpoint) ? String(response.endpoint.name ?? draft.name) : draft.name, response.secret);
			else notice = text('Webhook 已更新。', 'Webhook updated.');
			await load();
		} catch (cause) { error = validationMessage(cause); }
		finally { isSaving = false; }
	}

	function revealSecret(name: string, secret: string): void { secretName = name; secretValue = secret; modal = 'secret'; }
	async function copySecret(): Promise<void> {
		try { await navigator.clipboard.writeText(secretValue); notice = text('Secret 已复制。', 'Secret copied.'); }
		catch { error = text('无法访问剪贴板，请手动复制。', 'Clipboard unavailable; copy manually.'); }
	}

	async function toggleEndpoint(endpoint: JsonRecord): Promise<void> {
		const id = idOf(endpoint); if (!id || busyId) return;
		busyId = id; error = '';
		try { await requestJson<unknown>(`/api/webhooks/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(endpointPayload(endpoint, { disabled: endpoint.disabled !== true })) }); notice = endpoint.disabled === true ? text('Webhook 已启用。', 'Webhook enabled.') : text('Webhook 已停用。', 'Webhook disabled.'); await load(); }
		catch (cause) { error = displayError(cause, text('状态更新失败。', 'Failed to update status.')); }
		finally { busyId = ''; }
	}

	async function remove(endpoint: JsonRecord): Promise<void> {
		const id = idOf(endpoint); if (!id || busyId || !window.confirm(text(`确认删除 Webhook ${displayValue(endpoint.name)}？`, `Delete webhook ${displayValue(endpoint.name)}?`))) return;
		busyId = id; error = '';
		try { await requestJson<unknown>(`/api/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (selected && idOf(selected) === id) modal = null; notice = text('Webhook 已删除。', 'Webhook deleted.'); await load(); }
		catch (cause) { error = displayError(cause, text('删除失败。', 'Failed to delete.')); }
		finally { busyId = ''; }
	}

	async function rotateSecret(endpoint: JsonRecord): Promise<void> {
		const id = idOf(endpoint); if (!id || busyId || !window.confirm(text('轮换后旧 Secret 将立即失效，确认继续？', 'The old secret becomes invalid immediately. Continue?'))) return;
		busyId = id; error = '';
		try {
			const response = await requestJson<unknown>(`/api/webhooks/${encodeURIComponent(id)}/rotate-secret`, { method: 'POST' });
			if (!isJsonRecord(response) || typeof response.secret !== 'string') throw new Error(text('服务端未返回 Secret。', 'Server did not return a secret.'));
			revealSecret(String(isJsonRecord(response.endpoint) ? response.endpoint.name ?? endpoint.name : endpoint.name), response.secret);
		} catch (cause) { error = displayError(cause, text('Secret 轮换失败。', 'Failed to rotate secret.')); }
		finally { busyId = ''; }
	}

	async function testEndpoint(): Promise<void> {
		if (!selected || busyId) return;
		const id = idOf(selected); busyId = id; error = '';
		try {
			const response = await requestJson<unknown>(`/api/webhooks/${encodeURIComponent(id)}/test`, { method: 'POST', body: JSON.stringify({ event: testEvent }) });
			if (isJsonRecord(response) && response.delivered === true) notice = text(`测试投递成功，接收端返回 ${displayValue(response.receiver_status_code)}。`, `Test delivered; receiver returned ${displayValue(response.receiver_status_code)}.`);
			else throw new Error(isJsonRecord(response) && typeof response.error === 'string' ? response.error : text('接收端拒绝测试投递。', 'Receiver rejected the test delivery.'));
			await loadDeliveries(true);
		} catch (cause) { error = displayError(cause, text('测试投递失败。', 'Test delivery failed.')); }
		finally { busyId = ''; }
	}

	async function redeliver(delivery: JsonRecord): Promise<void> {
		const id = idOf(delivery); if (!id || busyId || !window.confirm(text('确认重新投递该事件？', 'Redeliver this event?'))) return;
		busyId = id; error = '';
		try { await requestJson<unknown>(`/api/webhooks/deliveries/${encodeURIComponent(id)}/redeliver`, { method: 'POST' }); notice = text('重新投递已入队。', 'Redelivery queued.'); await loadDeliveries(); }
		catch (cause) { error = displayError(cause, text('重新投递失败。', 'Redelivery failed.')); }
		finally { busyId = ''; }
	}

	onMount(() => {
		void load();
		const timer = window.setInterval(() => { if (modal !== 'editor' && modal !== 'secret') { void load(); if (modal === 'detail') void loadDeliveries(); } }, 5000);
		return () => window.clearInterval(timer);
	});
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading"><div><p class="eyebrow">Elygate / Integrations</p><h1>Webhook</h1><p>{text('为异步推理任务注册签名通知端点，并检查每次投递、重试和接收端结果。提交任务时通过 x-bf-async-webhook 指定端点名称。', 'Register signed notification endpoints for async inference jobs and inspect every delivery, retry, and receiver result. Select an endpoint with x-bf-async-webhook.')}</p></div><button class="primary" type="button" onclick={openCreate}>+ {text('添加端点', 'Add endpoint')}</button></header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<form class="toolbar" onsubmit={(event) => { event.preventDefault(); void load(true); }}><label>{text('搜索', 'Search')}<input bind:value={search} placeholder={text('名称或 URL', 'Name or URL')} /></label><label>{text('事件', 'Events')}<select multiple bind:value={eventFilters}>{#each WEBHOOK_EVENTS as event (event)}<option value={event}>{eventLabel(event)}</option>{/each}</select></label><label>{text('状态', 'Status')}<select bind:value={statusFilter}><option value="">{text('全部', 'All')}</option><option value="enabled">{text('启用', 'Enabled')}</option><option value="disabled">{text('停用', 'Disabled')}</option></select></label><button type="submit">{text('应用筛选', 'Apply')}</button><button type="button" onclick={() => { search = ''; eventFilters = []; statusFilter = ''; void load(true); }}>{text('清除', 'Clear')}</button></form>
	<div class="table-wrap" class:loading={isLoading}><table><thead><tr><th>{text('名称', 'Name')}</th><th>URL</th><th>{text('事件', 'Events')}</th><th>{text('状态', 'Status')}</th><th>{text('连续失败', 'Failures')}</th><th>{text('最近成功', 'Last success')}</th><th>{text('操作', 'Actions')}</th></tr></thead><tbody>{#each endpoints as endpoint (idOf(endpoint))}<tr><td><strong>{displayValue(endpoint.name)}</strong><small>{idOf(endpoint)}</small></td><td><code>{displayValue(endpoint.url)}</code></td><td><div class="badges">{#each Array.isArray(endpoint.events) ? endpoint.events : [] as event (String(event))}<span>{eventLabel(String(event))}</span>{/each}</div></td><td><button class:enabled={endpoint.disabled !== true} class="status-button" type="button" disabled={busyId === idOf(endpoint)} onclick={() => void toggleEndpoint(endpoint)}>{endpoint.disabled === true ? text('停用', 'Disabled') : text('启用', 'Enabled')}</button></td><td>{displayValue(endpoint.consecutive_failures || 0)}</td><td>{date(endpoint.last_success_at)}</td><td><div class="actions"><button type="button" onclick={() => void openDetails(endpoint)}>{text('详情', 'Details')}</button><button type="button" onclick={() => openEdit(endpoint)}>{text('编辑', 'Edit')}</button><button type="button" onclick={() => void rotateSecret(endpoint)}>{text('轮换 Secret', 'Rotate secret')}</button><button class="danger" type="button" onclick={() => void remove(endpoint)}>{text('删除', 'Delete')}</button></div></td></tr>{:else}<tr><td class="empty" colspan="7">{isLoading ? text('加载中…', 'Loading…') : text('没有匹配的 Webhook。', 'No matching webhooks.')}</td></tr>{/each}</tbody></table></div>
	<footer class="pagination"><span>{total ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} / ${total}` : '0'}</span><div><button type="button" disabled={offset === 0 || isLoading} onclick={() => { offset = Math.max(0, offset - PAGE_SIZE); void load(); }}>{text('上一页', 'Previous')}</button><span>{currentPage} / {totalPages}</span><button type="button" disabled={offset + PAGE_SIZE >= total || isLoading} onclick={() => { offset += PAGE_SIZE; void load(); }}>{text('下一页', 'Next')}</button></div></footer>
</section>

{#if modal}
	<div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !isSaving) modal = null; }}><div class:wide={modal === 'detail'} class="modal" role="dialog" aria-modal="true" aria-labelledby="webhook-modal-title"><header><div><h2 id="webhook-modal-title">{modal === 'editor' ? (editingId ? text('编辑 Webhook', 'Edit webhook') : text('添加 Webhook', 'Add webhook')) : modal === 'secret' ? text('保存签名 Secret', 'Save signing secret') : displayValue(selected?.name)}</h2>{#if modal === 'detail'}<p>{displayValue(selected?.url)}</p>{/if}</div><button type="button" aria-label={text('关闭', 'Close')} onclick={() => (modal = null)}>×</button></header>
		{#if modal === 'editor'}
			<div class="form-grid"><label>{text('名称', 'Name')}<input bind:value={draft.name} placeholder="billing-service" /></label><label>{text('接收地址', 'Receiver URL')}<input bind:value={draft.url} placeholder="https://example.com/hooks/bifrost" /></label><fieldset class="span-2"><legend>{text('订阅事件', 'Subscribed events')}</legend>{#each WEBHOOK_EVENTS as event (event)}<label class="check"><input type="checkbox" checked={draft.events.includes(event)} onchange={() => toggleDraftEvent(event)} /><span><strong>{eventLabel(event)}</strong><small>{event === 'async_job.completed' ? text('异步任务成功完成。', 'An async job completed successfully.') : text('异步任务达到终态失败。', 'An async job reached a terminal failure.')}</small></span></label>{/each}</fieldset><label class="check"><input type="checkbox" bind:checked={draft.includeResponse} />{text('包含任务响应载荷', 'Include response payload')}</label><label class="check"><input type="checkbox" bind:checked={draft.allowPrivateNetwork} />{text('允许私有网络地址', 'Allow private network')}</label><label class="check"><input type="checkbox" bind:checked={draft.disabled} />{text('创建为停用状态', 'Keep endpoint disabled')}</label><label class="span-2">{text('自定义请求头 JSON', 'Custom headers JSON')}<textarea class="json-editor" rows="7" bind:value={draft.headersJson}></textarea><small>{text('字符串值会保存为 Secret；也可使用 {"type":"env","ref":"NAME"}。', 'String values are stored as secrets; env references may use {"type":"env","ref":"NAME"}.')}</small></label></div>
			<section class="tuning"><h3>{text('投递调优', 'Delivery tuning')}</h3><p>{text('留空或 0 使用投递工作器默认值。', 'Leave blank or use 0 for worker defaults.')}</p><div class="form-grid">{#each tuningFields as field (field.key)}<label>{text(field.zh, field.en)}<input type="number" min="0" bind:value={draft[field.key]} placeholder={String(field.fallback)} /></label>{/each}</div></section>
			<footer><button type="button" onclick={() => (modal = null)}>{text('取消', 'Cancel')}</button><button class="primary" type="button" disabled={isSaving} onclick={() => void save()}>{isSaving ? text('保存中…', 'Saving…') : text('保存', 'Save')}</button></footer>
		{/if}
		{#if modal === 'secret'}<div class="secret-panel"><p>{text('此 Secret 只显示一次。关闭前请复制到接收端配置；之后只能轮换，无法重新读取。', 'This secret is shown once. Copy it into the receiver configuration before closing; it cannot be read again, only rotated.')}</p><label>{text('端点', 'Endpoint')}<input readonly value={secretName} /></label><label>Secret<textarea readonly rows="4" value={secretValue}></textarea></label><button class="primary" type="button" onclick={() => void copySecret()}>{text('复制 Secret', 'Copy secret')}</button></div>{/if}
		{#if modal === 'detail' && selected}
			<div class="detail-actions"><label>{text('测试事件', 'Test event')}<select bind:value={testEvent}>{#each WEBHOOK_EVENTS as event (event)}<option value={event}>{eventLabel(event)}</option>{/each}</select></label><button class="primary" type="button" disabled={busyId === idOf(selected)} onclick={() => void testEndpoint()}>{text('发送测试', 'Send test')}</button><button type="button" onclick={() => { modal = null; openEdit(selected!); }}>{text('编辑配置', 'Edit configuration')}</button><button type="button" onclick={() => void rotateSecret(selected!)}>{text('轮换 Secret', 'Rotate secret')}</button></div>
			<div class="detail-grid"><article><h3>{text('订阅与安全', 'Subscriptions and security')}</h3><dl><div><dt>{text('事件', 'Events')}</dt><dd>{displayValue(selected.events)}</dd></div><div><dt>{text('附带响应', 'Include response')}</dt><dd>{selected.include_response === true ? text('是', 'Yes') : text('否', 'No')}</dd></div><div><dt>{text('私有网络', 'Private network')}</dt><dd>{selected.allow_private_network === true ? text('允许', 'Allowed') : text('禁止', 'Blocked')}</dd></div><div><dt>{text('请求头', 'Headers')}</dt><dd><code>{prettyJson(selected.headers, '{}')}</code></dd></div></dl></article><article><h3>{text('运行状态', 'Runtime status')}</h3><dl><div><dt>{text('状态', 'Status')}</dt><dd>{selected.disabled === true ? text('停用', 'Disabled') : text('启用', 'Enabled')}</dd></div><div><dt>{text('连续失败', 'Consecutive failures')}</dt><dd>{displayValue(selected.consecutive_failures || 0)}</dd></div><div><dt>{text('最近成功', 'Last success')}</dt><dd>{date(selected.last_success_at)}</dd></div><div><dt>{text('最近失败', 'Last failure')}</dt><dd>{date(selected.last_failure_at)}</dd></div></dl></article></div>
			<section class="deliveries"><div class="section-heading"><div><h3>{text('投递历史', 'Delivery history')}</h3><p>{text('查看接收端状态码、重试结果和错误，并可手动重新投递。', 'Inspect receiver status, retry outcome, and errors, and manually redeliver.')}</p></div><button type="button" onclick={() => void loadDeliveries()}>{text('刷新', 'Refresh')}</button></div><div class="table-wrap"><table><thead><tr><th>{text('时间', 'Time')}</th><th>{text('事件', 'Event')}</th><th>{text('请求 ID', 'Request ID')}</th><th>{text('尝试', 'Attempt')}</th><th>{text('结果', 'Outcome')}</th><th>{text('状态码', 'Status')}</th><th>{text('错误', 'Error')}</th><th></th></tr></thead><tbody>{#each deliveries as delivery (idOf(delivery))}<tr><td>{date(delivery.created_at)}</td><td>{eventLabel(String(delivery.event))}</td><td><code>{displayValue(delivery.request_id)}</code></td><td>{displayValue(delivery.attempt_no)}</td><td><span class="badge">{displayValue(delivery.outcome)}</span></td><td>{displayValue(delivery.status_code)}</td><td>{displayValue(delivery.error)}</td><td><button type="button" disabled={busyId === idOf(delivery) || delivery.outcome === 'retryable_failure' || selected.disabled === true} onclick={() => void redeliver(delivery)}>{text('重新投递', 'Redeliver')}</button></td></tr>{:else}<tr><td class="empty" colspan="8">{isDeliveryLoading ? text('加载中…', 'Loading…') : text('暂无投递记录。', 'No deliveries yet.')}</td></tr>{/each}</tbody></table></div><footer class="pagination"><span>{deliveryTotal ? `${deliveryOffset + 1}–${Math.min(deliveryOffset + DELIVERY_PAGE_SIZE, deliveryTotal)} / ${deliveryTotal}` : '0'}</span><div><button type="button" disabled={deliveryOffset === 0} onclick={() => { deliveryOffset = Math.max(0, deliveryOffset - DELIVERY_PAGE_SIZE); void loadDeliveries(); }}>{text('上一页', 'Previous')}</button><span>{deliveryPage} / {deliveryPages}</span><button type="button" disabled={deliveryOffset + DELIVERY_PAGE_SIZE >= deliveryTotal} onclick={() => { deliveryOffset += DELIVERY_PAGE_SIZE; void loadDeliveries(); }}>{text('下一页', 'Next')}</button></div></footer></section>
		{/if}
	</div></div>
{/if}

<style>
	.page-shell { margin: 0 auto; max-width: 1380px; padding: 1.5rem; }
	.page-heading, .modal > header, .modal > footer, .section-heading, .pagination, .detail-actions { align-items: center; display: flex; gap: .75rem; justify-content: space-between; }
	.page-heading { align-items: start; }
	.page-heading h1, .modal h2, .tuning h3, .deliveries h3 { margin: 0; }
	.page-heading p, .modal header p, .tuning p, .section-heading p { color: var(--muted-foreground); margin: .45rem 0 0; max-width: 860px; }
	.eyebrow { color: var(--primary) !important; font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
	button, input, select, textarea, fieldset { border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); font: inherit; }
	button, select { background: var(--muted); cursor: pointer; padding: .55rem .7rem; }
	input, textarea { background: var(--background); padding: .6rem .7rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	button:disabled { cursor: wait; opacity: .5; }
	.toolbar, .actions, .badges, .pagination div, .detail-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
	.toolbar { align-items: end; margin: 1rem 0 .8rem; }
	.toolbar label, .form-grid label, .secret-panel label, .detail-actions label { color: var(--muted-foreground); display: grid; font-size: .75rem; gap: .32rem; }
	.toolbar input { min-width: 260px; }
	.toolbar select[multiple] { min-height: 4.6rem; min-width: 180px; }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; overflow-x: auto; }
	.table-wrap.loading { opacity: .65; }
	table { border-collapse: collapse; min-width: 1080px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); font-size: .78rem; padding: .7rem .8rem; text-align: left; vertical-align: top; }
	th { color: var(--muted-foreground); }
	td strong, td small { display: block; }
	td small { color: var(--muted-foreground); margin-top: .2rem; }
	td code { display: block; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.badges span, .badge { background: var(--muted); border-radius: 999px; font-size: .68rem; padding: .18rem .48rem; }
	.status-button.enabled { color: var(--primary); }
	.empty { color: var(--muted-foreground); padding: 2rem; text-align: center; }
	.pagination { margin-top: .75rem; }
	.notice { border-radius: .65rem; margin-top: .8rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 10%, transparent); color: var(--primary); }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .55); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; display: grid; gap: 1rem; max-height: 92vh; max-width: 820px; overflow: auto; padding: 1.15rem; width: 100%; }
	.modal.wide { max-width: 1180px; }
	.modal > footer { border-top: 1px solid var(--border); justify-content: end; padding-top: .9rem; }
	.form-grid { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-grid input, .form-grid textarea { width: 100%; }
	.span-2 { grid-column: 1 / -1; }
	fieldset { display: grid; gap: .65rem; padding: .85rem; }
	fieldset legend { color: var(--muted-foreground); font-size: .75rem; padding: 0 .35rem; }
	label.check { align-items: start; display: flex; gap: .5rem; }
	label.check input { margin-top: .2rem; width: auto; }
	label.check span, label.check small { display: block; }
	label.check small, label small { color: var(--muted-foreground); margin-top: .15rem; }
	.tuning { border-top: 1px solid var(--border); padding-top: .9rem; }
	.json-editor, .secret-panel textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .76rem; line-height: 1.5; }
	.secret-panel { display: grid; gap: .8rem; }
	.secret-panel p { background: color-mix(in oklch, var(--primary) 9%, transparent); border-radius: .6rem; margin: 0; padding: .8rem; }
	.detail-actions { justify-content: end; }
	.detail-grid { display: grid; gap: .8rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.detail-grid article { border: 1px solid var(--border); border-radius: .75rem; padding: .9rem; }
	.detail-grid h3 { margin: 0 0 .65rem; }
	dl { display: grid; gap: .55rem; margin: 0; }
	dl div { display: grid; gap: .2rem; grid-template-columns: 130px 1fr; }
	dt { color: var(--muted-foreground); font-size: .75rem; }
	dd { font-size: .78rem; margin: 0; overflow-wrap: anywhere; }
	dd code { white-space: pre-wrap; }
	.deliveries { border-top: 1px solid var(--border); padding-top: .9rem; }
	@media (max-width: 760px) { .page-shell { padding: 1rem; } .page-heading, .pagination, .detail-actions { align-items: stretch; flex-direction: column; } .form-grid, .detail-grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } dl div { grid-template-columns: 1fr; } }
</style>
