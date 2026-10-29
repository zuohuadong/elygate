<script lang="ts">
	import { onMount } from 'svelte';
	import { Button, ContentPageShell, ContentPageHeader } from '@svadmin/ui';
	import { Plus, RefreshCw, Pencil, Trash2, FlaskConical, X } from '@lucide/svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError } from '../lib/forms';
	import { encodePathSegment, getListPayload, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { formatPagination } from '../lib/display-format';
	import {
		buildRelayPayload,
		emptyRelayDraft,
		relayAuthTypes,
		relayDraftFromConfig,
		relayValidationMessage,
		type RelayDraft,
	} from '../lib/relay-management';

	interface Props { resourceName: string; }
	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let records = $state.raw<JsonRecord[]>([]);
	let total = $state(0);
	let page = $state(1);
	let search = $state('');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let error = $state('');
	let selected = $state.raw<JsonRecord | null>(null);
	let draft = $state<RelayDraft>(emptyRelayDraft());
	let editingName = $state('');
	let modal = $state<'editor' | 'preview' | null>(null);
	let previewDraft = $state({ method: 'POST', path: '/', headersJson: '{}', accept: '', requestContentType: 'application/json', requestBody: '{}', responseBody: '{}', responseContentType: 'application/json', statusCode: 200, result: '' });
	let loadSeq = 0;
	let editorSeq = 0;
	let isReading = $state(false);
	let isPreviewing = $state(false);
	let previewReturnToEditor = $state(false);
	const pageSize = 25;
	const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function value(record: JsonRecord, key: string): string {
		const candidate = record[key];
		return candidate === null || candidate === undefined ? '' : String(candidate);
	}
	function authLabel(type: string): string {
		const labels: Record<string, [string, string]> = {
			bearer: ['Bearer', 'Bearer'], header: ['请求头', 'Header'], query: ['Query 参数', 'Query parameter'],
			basic: ['Basic', 'Basic'], aws_sigv4: ['AWS SigV4', 'AWS SigV4'], none: ['无认证', 'None'],
		};
		return labels[type]?.[i18n.locale === 'zh-CN' ? 0 : 1] ?? type;
	}
	function errorMessage(cause: unknown): string {
		return cause instanceof Error && cause.message.startsWith('HTTP ') ? displayError(cause, text('操作失败。', 'Operation failed.')) : relayValidationMessage(cause, i18n.locale === 'zh-CN' ? 'zh-CN' : 'en');
	}

	async function load(): Promise<void> {
		const sequence = ++loadSeq;
		isLoading = true;
		error = '';
		try {
			const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
			if (search.trim()) params.set('search', search.trim());
			const payload = await requestJson<unknown>(`/api/relays?${params.toString()}`);
			if (sequence !== loadSeq) return;
			records = getListPayload(payload);
			total = getTotal(payload, records.length);
			if (total > 0 && page > totalPages) { page = totalPages; await load(); }
			else if (total === 0 && page !== 1) { page = 1; await load(); }
		} catch (cause) {
			if (sequence === loadSeq) { records = []; total = 0; error = displayError(cause, text('无法加载 Relay 端点。', 'Unable to load relay endpoints.')); }
		} finally {
			if (sequence === loadSeq) isLoading = false;
		}
	}

	function openCreate(): void {
		if (isSaving) return;
		editorSeq += 1;
		isReading = false;
		selected = null;
		editingName = '';
		draft = emptyRelayDraft();
		error = '';
		modal = 'editor';
	}
	async function openEdit(record: JsonRecord): Promise<void> {
		if (isSaving || isReading) return;
		const sequence = ++editorSeq;
		isReading = true;
		const name = value(record, 'name');
		editingName = name;
		selected = record;
		error = '';
		try {
			const full = await requestJson<JsonRecord>(`/api/relays/${encodePathSegment(name)}`);
			if (sequence !== editorSeq) return;
			if (!isJsonRecord(full) || full.name !== name || typeof full.base_url !== 'string') throw new Error(text('Relay 配置响应格式错误。', 'Invalid relay configuration response.'));
			selected = full;
			draft = relayDraftFromConfig(full);
			modal = 'editor';
		} catch (cause) {
			if (sequence === editorSeq) error = displayError(cause, text('无法读取 Relay 配置。', 'Unable to read relay configuration.'));
		} finally { if (sequence === editorSeq) isReading = false; }
	}
	function closeModal(): void { if (!isSaving && !isPreviewing) { editorSeq += 1; modal = modal === 'preview' && previewReturnToEditor ? 'editor' : null; error = ''; } }
	function showModal(dialog: HTMLDialogElement): { destroy: () => void } {
		dialog.showModal();
		return { destroy: () => dialog.close() };
	}
	function submit(event: SubmitEvent): void { event.preventDefault(); void save(); }

	async function save(): Promise<void> {
		if (isSaving) return;
		isSaving = true;
		error = '';
		try {
			const payload = buildRelayPayload(draft, editingName);
			const path = editingName ? `/api/relays/${encodePathSegment(editingName)}` : '/api/relays';
			await requestJson(path, { method: editingName ? 'PUT' : 'POST', body: JSON.stringify(payload) });
			modal = null;
			selected = null;
			draft = emptyRelayDraft();
			await load();
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			isSaving = false;
		}
	}

	async function remove(record: JsonRecord): Promise<void> {
		if (isSaving) return;
		const name = value(record, 'name');
		if (!name || !window.confirm(text(`确认删除 Relay 端点“${name}”？关联的 Virtual Key 授权也会被移除。`, `Delete relay endpoint “${name}”? Related Virtual Key grants will also be removed.`))) return;
		isSaving = true;
		try {
			await requestJson(`/api/relays/${encodePathSegment(name)}`, { method: 'DELETE' });
			await load();
		} catch (cause) {
			error = displayError(cause, text('删除失败。', 'Delete failed.'));
		} finally { isSaving = false; }
	}

	function openPreview(record?: JsonRecord): void {
		if (isSaving || isReading || isPreviewing) return;
		previewReturnToEditor = modal === 'editor';
		previewDraft = { ...previewDraft, result: '' };
		if (record) {
			previewDraft = { ...previewDraft, path: '/', result: '' };
			selected = record;
		}
		modal = 'preview';
		error = '';
	}
	async function runPreview(): Promise<void> {
		if (isPreviewing) return;
		const sequence = editorSeq;
		isPreviewing = true;
		error = '';
		previewDraft.result = '';
		try {
			const headers: unknown = JSON.parse(previewDraft.headersJson);
			if (!isJsonRecord(headers) || Object.values(headers).some((value) => typeof value !== 'string')) throw new Error(text('预览请求头必须是字符串值 JSON 对象。', 'Preview headers must be a JSON object with string values.'));
			const body: JsonRecord = {
				method: previewDraft.method,
				path: previewDraft.path,
				request_body: previewDraft.requestBody,
				response_body: previewDraft.responseBody,
				response_content_type: previewDraft.responseContentType,
				status_code: Number(previewDraft.statusCode) || 200,
				headers,
				accept: previewDraft.accept,
				request_content_type: previewDraft.requestContentType,
			};
			const payload = !previewReturnToEditor && selected?.name
				? { name: value(selected, 'name'), sample: body }
				: { config: buildRelayPayload(draft, editingName), sample: body };
			const result = await requestJson<unknown>('/api/relays/usage-preview', { method: 'POST', body: JSON.stringify(payload) });
			if (sequence === editorSeq) previewDraft.result = JSON.stringify(result, null, 2);
		} catch (cause) {
			if (sequence === editorSeq) error = errorMessage(cause);
		} finally { isPreviewing = false; }
	}

	function switchPage(next: number): void { page = Math.max(1, Math.min(totalPages, next)); void load(); }
	onMount(() => { void load(); return () => { loadSeq += 1; editorSeq += 1; }; });
</script>

<ContentPageShell pageId="relay-endpoints" width="wide">
	<ContentPageHeader title={text('Relay 端点', 'Relay endpoints')} />
	<div class="heading-actions"><Button variant="outline" type="button" title={i18n.t('elygate.refresh')} aria-label={i18n.t('elygate.refresh')} onclick={() => void load()} disabled={isLoading}><RefreshCw size={16} aria-hidden="true" /></Button><Button type="button" onclick={openCreate} disabled={isSaving || isReading}><Plus size={16} aria-hidden="true" />{i18n.t('elygate.create')}</Button></div>
	{#if error && !modal}<div class="notice error" role="alert">{error}</div>{/if}
	<form class="filters" onsubmit={(event) => { event.preventDefault(); page = 1; void load(); }}>
		<label>{i18n.t('elygate.search')}<input bind:value={search} placeholder={text('按名称或描述搜索', 'Search name or description')} /></label>
		<button type="submit" disabled={isLoading}>{i18n.t('elygate.search')}</button>
	</form>
	<div class="table-wrap" aria-busy={isLoading}>
		<table><thead><tr><th>{i18n.t('elygate.name')}</th><th>{text('上游地址', 'Base URL')}</th><th>{text('认证', 'Auth')}</th><th>{text('调用地址', 'Gateway path')}</th><th>{text('路由', 'Routes')}</th><th>{i18n.t('elygate.actions')}</th></tr></thead>
			<tbody>{#each records as record (value(record, 'name'))}<tr>
				<td><strong>{value(record, 'name')}</strong>{#if value(record, 'description')}<small>{value(record, 'description')}</small>{/if}</td>
				<td><code>{value(record, 'base_url')}</code></td><td>{authLabel(value(isJsonRecord(record.auth) ? record.auth : {}, 'type'))}</td><td><code>{value(record, 'url')}</code></td><td>{Array.isArray(record.routes) ? record.routes.length : 0}</td>
				<td class="actions"><Button variant="ghost" size="icon" type="button" disabled={isSaving || isReading} title={i18n.t('elygate.edit')} aria-label={`${i18n.t('elygate.edit')} ${value(record, 'name')}`} onclick={() => void openEdit(record)}><Pencil size={16} aria-hidden="true" /></Button><Button variant="ghost" size="icon" type="button" disabled={isSaving} title={text('预览计费', 'Preview usage')} aria-label={`${text('预览计费', 'Preview usage')} ${value(record, 'name')}`} onclick={() => openPreview(record)}><FlaskConical size={16} aria-hidden="true" /></Button><Button variant="ghost" size="icon" type="button" disabled={isSaving} title={i18n.t('elygate.delete')} aria-label={`${i18n.t('elygate.delete')} ${value(record, 'name')}`} onclick={() => void remove(record)}><Trash2 size={16} aria-hidden="true" /></Button></td>
			</tr>{:else}<tr><td colspan="6" class="empty">{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</td></tr>{/each}</tbody>
		</table>
	</div>
	<footer class="pagination"><span>{formatPagination(page, totalPages, total, i18n.locale)}</span><div><button type="button" disabled={page <= 1 || isLoading} onclick={() => switchPage(page - 1)}>{i18n.t('elygate.previous')}</button><button type="button" disabled={page >= totalPages || isLoading} onclick={() => switchPage(page + 1)}>{i18n.t('elygate.next')}</button></div></footer>
</ContentPageShell>

{#if modal === 'editor'}
		<dialog class="modal" aria-labelledby="relay-editor-title" use:showModal oncancel={(event) => { event.preventDefault(); closeModal(); }}>
			<header><h2 id="relay-editor-title">{editingName ? text('编辑 Relay 端点', 'Edit relay endpoint') : text('新建 Relay 端点', 'New relay endpoint')}</h2><Button variant="ghost" size="icon" type="button" title={i18n.t('elygate.close')} aria-label={i18n.t('elygate.close')} disabled={isSaving} onclick={closeModal}><X size={18} aria-hidden="true" /></Button></header>
			{#if error}<div class="notice error" role="alert">{error}</div>{/if}
			<form onsubmit={submit} novalidate><fieldset disabled={isSaving}>
				<div class="grid-two"><label>{i18n.t('elygate.name')}<input bind:value={draft.name} disabled={Boolean(editingName)} /></label><label>{i18n.t('elygate.description')}<input bind:value={draft.description} /></label></div>
				<label>{text('上游 Base URL', 'Upstream Base URL')}<input type="url" bind:value={draft.baseUrl} placeholder="https://api.example.com/v1" /></label>
				<div class="grid-two"><label>{text('认证方式', 'Auth type')}<select bind:value={draft.authType}>{#each relayAuthTypes as type}<option value={type}>{authLabel(type)}</option>{/each}</select></label>{#if draft.authType === 'header'}<label>{text('请求头名称', 'Header name')}<input bind:value={draft.headerName} placeholder="X-Api-Key" /></label>{:else if draft.authType === 'query'}<label>{text('Query 参数名称', 'Query parameter')}<input bind:value={draft.queryParam} placeholder="api_key" /></label>{:else if draft.authType === 'aws_sigv4'}<label>{text('AWS 服务名', 'AWS service')}<input bind:value={draft.awsService} placeholder="textract" /></label>{:else}<label>{text('值前缀', 'Value prefix')}<input bind:value={draft.valuePrefix} placeholder="Bearer " /></label>{/if}</div>
				{#if draft.authType === 'header'}<label>{text('值前缀', 'Value prefix')}<input bind:value={draft.valuePrefix} /></label>{/if}
				{#if draft.authType === 'aws_sigv4'}<label>{text('AWS 签名区域', 'AWS signing region')}<input bind:value={draft.awsRegion} placeholder="us-east-1" /></label>{/if}
				{#if draft.authType !== 'none' && draft.authType !== 'aws_sigv4'}<label>{text('凭据值（留空保留已有脱敏值）', 'Credential value (empty keeps the redacted value)')}<input type="password" bind:value={draft.credentialValue} autocomplete="new-password" /></label>{/if}
				{#if draft.authType !== 'none'}<details><summary>{text('凭据 JSON / 引用', 'Credential JSON / reference')}</summary><label>{text('完整凭据 JSON', 'Complete credential JSON')}<textarea rows="5" bind:value={draft.credentialJson} spellcheck="false"></textarea></label></details>{/if}
				<label>{text('额外请求头 JSON', 'Extra headers JSON')}<textarea rows="3" bind:value={draft.extraHeadersJson} spellcheck="false"></textarea></label>
				<div class="checks"><label><input type="checkbox" bind:checked={draft.skipRouteCheck} />{text('未匹配路由时仍转发', 'Relay requests without a matching route')}</label><label><input type="checkbox" bind:checked={draft.ignoreUpstreamCost} />{text('忽略上游成本字段', 'Ignore upstream cost fields')}</label></div>
				<details><summary>{text('网络与代理', 'Network and proxy')}</summary><div class="grid-two"><label>{text('Network JSON', 'Network JSON')}<textarea rows="5" bind:value={draft.networkJson} spellcheck="false"></textarea></label><label>{text('Proxy JSON', 'Proxy JSON')}<textarea rows="5" bind:value={draft.proxyConfigJson} spellcheck="false"></textarea></label></div></details>
				<details><summary>{text('用量、流式和路由', 'Usage, streaming and routes')}</summary><label>{text('Usage JSON', 'Usage JSON')}<textarea rows="7" bind:value={draft.usageJson} spellcheck="false"></textarea></label><label>{text('Streaming JSON', 'Streaming JSON')}<textarea rows="4" bind:value={draft.streamingJson} spellcheck="false"></textarea></label><label>{text('Routes JSON（首个匹配优先）', 'Routes JSON (first match wins)')}<textarea rows="10" bind:value={draft.routesJson} spellcheck="false"></textarea></label></details>
				<footer><button type="button" disabled={isSaving} onclick={closeModal}>{i18n.t('elygate.cancel')}</button><button type="button" disabled={isSaving} onclick={() => openPreview()}>{text('预览计费', 'Preview usage')}</button><button class="primary" type="submit" disabled={isSaving}>{isSaving ? text('保存中…', 'Saving…') : i18n.t('elygate.save')}</button></footer></fieldset>
			</form>
		</dialog>
{/if}

{#if modal === 'preview'}
		<dialog class="modal preview-modal" aria-labelledby="relay-preview-title" use:showModal oncancel={(event) => { event.preventDefault(); closeModal(); }}>
			<header><div><h2 id="relay-preview-title">{text('用量与计费预览', 'Usage and billing preview')}</h2><p>{text('这是本地配置预览，不会向上游发送请求。', 'This is a local config preview; no upstream request is sent.')}</p></div><button type="button" onclick={closeModal}>{i18n.t('elygate.close')}</button></header>
			{#if error}<div class="notice error" role="alert">{error}</div>{/if}
			<fieldset disabled={isPreviewing}><div class="grid-two"><label>{text('方法', 'Method')}<select bind:value={previewDraft.method}>{#each ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as method}<option value={method}>{method}</option>{/each}</select></label><label>{text('状态码', 'Status code')}<input type="number" min="100" max="599" bind:value={previewDraft.statusCode} /></label></div>
			<label>{text('请求路径', 'Request path')}<input bind:value={previewDraft.path} /></label>
			<label>{text('请求头 JSON', 'Request headers JSON')}<textarea rows="3" bind:value={previewDraft.headersJson}></textarea></label>
			<div class="grid-two"><label>Accept<input bind:value={previewDraft.accept} /></label><label>{text('请求 Content-Type', 'Request Content-Type')}<input bind:value={previewDraft.requestContentType} /></label></div>
			<div class="grid-two"><label>{text('请求正文', 'Request body')}<textarea rows="7" bind:value={previewDraft.requestBody} spellcheck="false"></textarea></label><label>{text('响应正文', 'Response body')}<textarea rows="7" bind:value={previewDraft.responseBody} spellcheck="false"></textarea></label></div>
			<label>{text('响应 Content-Type', 'Response Content-Type')}<input bind:value={previewDraft.responseContentType} /></label>
			<footer><button type="button" disabled={isPreviewing} onclick={closeModal}>{i18n.t('elygate.cancel')}</button><button class="primary" type="button" disabled={isPreviewing} onclick={() => void runPreview()}>{text('运行预览', 'Run preview')}</button></footer></fieldset>
			{#if previewDraft.result}<pre class="json-view">{previewDraft.result}</pre>{/if}
		</dialog>
{/if}

<style>
	.heading-actions, .actions, footer, .checks, .pagination, .pagination div { align-items: center; display: flex; gap: .5rem; }
	.heading-actions { justify-content: end; margin-bottom: 1rem; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); cursor: pointer; font: inherit; font-weight: 600; min-height: 42px; padding: .55rem .75rem; white-space: nowrap; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button:disabled { cursor: not-allowed; opacity: .55; } input, select, textarea { background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); font: inherit; min-width: 0; padding: .6rem .7rem; width: 100%; }
	.filters { align-items: end; display: flex; gap: .7rem; margin-bottom: 1rem; } .filters label { max-width: 420px; flex: 1; }
	label { display: grid; gap: .35rem; font-size: .82rem; font-weight: 600; } textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; resize: vertical; }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow-x: auto; } table { border-collapse: collapse; min-width: 1050px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); padding: .75rem .85rem; text-align: left; vertical-align: top; } th { background: var(--muted); color: var(--muted-foreground); font-size: .75rem; } td small { color: var(--muted-foreground); display: block; margin-top: .25rem; } code { overflow-wrap: anywhere; }
	.notice { border-radius: 6px; margin-bottom: 1rem; padding: .7rem .9rem; } .notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.empty { color: var(--muted-foreground); text-align: center; } .pagination { justify-content: space-between; margin-top: 1rem; }
	.modal { background: var(--card); color: var(--foreground); border: 1px solid var(--border); border-radius: 8px; margin: auto; max-height: 92dvh; overflow: auto; padding: 1.1rem; width: min(calc(100% - 2rem), 920px); } .modal::backdrop { background: rgb(0 0 0 / .5); } .modal > header { align-items: start; display: flex; gap: 1rem; justify-content: space-between; margin-bottom: 1rem; } .modal h2 { margin: 0; font-size: 1.15rem; } .modal header p { color: var(--muted-foreground); margin: .4rem 0 0; }
	.modal form, .modal, fieldset { display: grid; gap: .85rem; } fieldset { border: 0; margin: 0; min-width: 0; padding: 0; } .checks { flex-wrap: wrap; } .checks label { display: flex; align-items: center; } .checks input { width: auto; } .grid-two { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); } details { border-top: 1px solid var(--border); padding-top: .75rem; } details > label + label { margin-top: .75rem; } summary { cursor: pointer; font-weight: 700; padding: .25rem 0; } .json-view { background: var(--muted); border-radius: 6px; margin: 0; max-height: 36vh; overflow: auto; overflow-wrap: anywhere; padding: .8rem; white-space: pre-wrap; } footer { justify-content: end; margin-top: .2rem; }
	@media (max-width: 760px) { .filters { align-items: stretch; flex-direction: column; } .heading-actions { width: 100%; } .grid-two { grid-template-columns: 1fr; } table { min-width: 860px; } .modal { max-height: 96dvh; padding: .85rem; } footer { flex-wrap: wrap; } footer button { flex: 1 1 auto; } }
</style>
