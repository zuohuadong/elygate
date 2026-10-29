<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '@svadmin/ui';
	import { FileInput, FileSearch, X } from '@lucide/svelte';
	import { ApiError, isJsonRecord, requestJson } from './api';
	import { displayError } from './forms';
	import type { RelayDraft } from './relay-management';
	import {
		applyRelayImport, parseRelayOpenApi, relayOpenApiError, relayOpenApiMaxBytes,
		relayOpenApiWarning, relaySpecUrl, reviewRelayImport,
		type RelayImportReview, type RelayOpenApiImport,
	} from './relay-openapi';

	interface Props {
		draft: RelayDraft;
		locale: string;
		onapply: (next: RelayDraft) => void;
		onclose: () => void;
	}
	let { draft, locale, onapply, onclose }: Props = $props();
	let mode = $state<'paste' | 'file' | 'url'>('paste');
	let specText = $state('');
	let specUrl = $state('');
	let fileName = $state('');
	let busy = $state(false);
	let error = $state('');
	let preview = $state.raw<RelayOpenApiImport | null>(null);
	let review = $state.raw<RelayImportReview | null>(null);
	let previewRoutes = '';
	let useBaseUrl = $state(false);
	let useAuth = $state(false);
	let confirmed = $state(false);
	let sequence = 0;
	let controller: AbortController | undefined;

	function text(zh: string, en: string): string { return locale === 'zh-CN' ? zh : en; }
	function invalidate(): void {
		sequence += 1;
		controller?.abort();
		busy = false;
		preview = null;
		review = null;
		error = '';
		confirmed = false;
		useBaseUrl = false;
		useAuth = false;
	}
	function close(): void { invalidate(); onclose(); }
	function showModal(dialog: HTMLDialogElement): { destroy: () => void } {
		dialog.showModal();
		return { destroy: () => dialog.close() };
	}
	function report(cause: unknown): string {
		return cause instanceof ApiError ? displayError(cause, text('文档获取失败。', 'Document fetch failed.')) : relayOpenApiError(cause, locale);
	}
	async function readFile(event: Event): Promise<void> {
		invalidate();
		specText = '';
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		fileName = file?.name ?? '';
		if (!file) return;
		if (file.size > relayOpenApiMaxBytes) { error = relayOpenApiError(new Error('openapi-too-large'), locale); return; }
		const current = sequence;
		busy = true;
		try { const content = await file.text(); if (current === sequence) specText = content; }
		catch { if (current === sequence) error = text('无法读取文件。', 'Unable to read the file.'); }
		finally { if (current === sequence) busy = false; }
	}
	async function readSource(signal: AbortSignal): Promise<{ source: string; documentUrl?: string }> {
		if (mode !== 'url') return { source: specText };
		const payload = await requestJson<unknown>('/api/relays/openapi-spec', { method: 'POST', signal, body: JSON.stringify({ spec_url: relaySpecUrl(specUrl) }) });
		if (!isJsonRecord(payload) || typeof payload.spec !== 'string' || typeof payload.spec_url !== 'string') throw new Error('openapi-response');
		return { source: payload.spec, documentUrl: relaySpecUrl(payload.spec_url) };
	}
	async function parse(): Promise<void> {
		if (busy) return;
		invalidate();
		const current = sequence;
		controller = new AbortController();
		busy = true;
		try {
			const source = await readSource(controller.signal);
			if (current !== sequence) return;
			const imported = await parseRelayOpenApi(source.source, source.documentUrl);
			if (current !== sequence) return;
			const staged = reviewRelayImport(draft.routesJson, imported);
			previewRoutes = draft.routesJson;
			preview = imported;
			review = staged;
		} catch (cause) { if (current === sequence) error = report(cause); }
		finally { if (current === sequence) busy = false; }
	}
	function apply(): void {
		if (!preview || !review || busy || !confirmed) return;
		if (previewRoutes !== draft.routesJson) { invalidate(); error = text('路由草稿已变化，请重新解析。', 'Routes changed; parse the document again.'); return; }
		onapply(applyRelayImport(draft, { imported: preview, review, useBaseUrl, useAuth }));
		close();
	}
	onMount(() => () => { sequence += 1; controller?.abort(); });
</script>

<dialog class="import-dialog" aria-labelledby="relay-openapi-title" use:showModal oncancel={(event) => { event.preventDefault(); close(); }}>
	<header><h2 id="relay-openapi-title">{text('导入 OpenAPI', 'Import OpenAPI')}</h2><Button variant="ghost" size="icon" type="button" title={text('关闭', 'Close')} aria-label={text('关闭导入', 'Close import')} onclick={close}><X size={18} aria-hidden="true" /></Button></header>
	<form onsubmit={(event) => { event.preventDefault(); void parse(); }}>
		<div class="source-modes" role="group" aria-label={text('文档来源', 'Document source')}>
			{#each [['paste', text('粘贴', 'Paste')], ['file', text('文件', 'File')], ['url', 'URL']] as [key, label]}
				<Button variant={mode === key ? 'default' : 'outline'} type="button" aria-pressed={mode === key} onclick={() => { invalidate(); mode = key as typeof mode; }}>{label}</Button>
			{/each}
		</div>
		{#if mode === 'paste'}
			<label>{text('OpenAPI 文档（JSON / YAML）', 'OpenAPI document (JSON / YAML)')}<textarea rows="8" bind:value={specText} oninput={invalidate} spellcheck="false"></textarea></label>
		{:else if mode === 'file'}
			<label>{text('OpenAPI 文件', 'OpenAPI file')}<input type="file" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" onchange={(event) => void readFile(event)} /></label>
			{#if fileName}<p class="file-name">{fileName}</p>{/if}
		{:else}
			<label>{text('文档 URL', 'Document URL')}<input type="url" bind:value={specUrl} oninput={invalidate} placeholder="https://api.example.com/openapi.yaml" /></label>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="parse-action"><Button variant="outline" type="submit" disabled={busy || (mode === 'url' ? !specUrl.trim() : !specText.trim())}><FileSearch size={16} aria-hidden="true" />{busy ? text('读取中...', 'Reading...') : text('解析文档', 'Parse document')}</Button></div>
	</form>
	{#if preview && review}
		<section class="review" aria-labelledby="relay-import-review">
			<h3 id="relay-import-review">{preview.title || text('未命名文档', 'Untitled document')}{preview.version ? ` (${preview.version})` : ''}</h3>
			<dl><div><dt>{text('导入路由', 'Imported routes')}</dt><dd>{review.routes.length}</dd></div><div><dt>{text('保留已有设置', 'Existing settings retained')}</dt><dd>{review.preserved}</dd></div><div><dt>{text('移除路由', 'Removed routes')}</dt><dd>{review.removed.length}</dd></div></dl>
			{#if preview.warnings.length}<ul class="warnings">{#each preview.warnings as warning}<li>{relayOpenApiWarning(warning, locale)}</li>{/each}</ul>{/if}
			<div class="route-list"><table><thead><tr><th>{text('方法', 'Method')}</th><th>{text('路径 / 请求头', 'Path / headers')}</th></tr></thead><tbody>
				{#each review.routes.slice(0, 40) as route}<tr><td>{route.method}</td><td><code>{route.path}</code>{#each Object.entries(route.headers ?? {}) as [name, matcher]}<small>{name}: {matcher}</small>{/each}</td></tr>{/each}
			</tbody></table>{#if review.routes.length > 40}<p>{text(`另有 ${review.routes.length - 40} 条路由`, `${review.routes.length - 40} more routes`)}</p>{/if}</div>
			{#if review.removed.length}<details><summary>{text(`将移除 ${review.removed.length} 条已有路由`, `${review.removed.length} existing routes will be removed`)}</summary><ul>{#each review.removed as route}<li><code>{route.method} {route.path}</code>{#each Object.entries(route.headers ?? {}) as [name, matcher]}<small>{name}: {matcher}</small>{/each}</li>{/each}</ul></details>{/if}
			{#if preview.baseUrl}<label class="check"><input type="checkbox" bind:checked={useBaseUrl} /><span>{text('采用上游地址', 'Use base URL')} <code>{preview.baseUrl}</code></span></label>{/if}
			{#if preview.auth}<label class="check"><input type="checkbox" bind:checked={useAuth} /><span>{text('采用认证建议', 'Use auth suggestion')}: <code>{preview.auth.type}{preview.auth.headerName ? ` / ${preview.auth.headerName}` : ''}{preview.auth.queryParam ? ` / ${preview.auth.queryParam}` : ''}</code></span></label>{/if}
			<label class="check"><input type="checkbox" bind:checked={confirmed} /><span>{text('确认替换草稿路由列表', 'Confirm replacement of draft routes')}</span></label>
		</section>
	{/if}
	<footer><Button variant="outline" type="button" onclick={close}>{text('取消', 'Cancel')}</Button><Button type="button" disabled={!preview || !review || !confirmed || busy} onclick={apply}><FileInput size={16} aria-hidden="true" />{text('应用到草稿', 'Apply to draft')}</Button></footer>
</dialog>

<style>
	.import-dialog { background: var(--card); color: var(--foreground); border: 1px solid var(--border); border-radius: 8px; display: grid; gap: 1rem; margin: auto; max-height: 92dvh; overflow: auto; padding: 1.1rem; width: min(calc(100% - 2rem), 800px); }
	.import-dialog::backdrop { background: rgb(0 0 0 / .55); }
	header, footer, .source-modes, .parse-action { align-items: center; display: flex; gap: .5rem; } header { justify-content: space-between; } footer, .parse-action { justify-content: end; } footer { flex-wrap: wrap; }
	h2 { font-size: 1.15rem; margin: 0; } h3 { font-size: 1rem; margin: 0; overflow-wrap: anywhere; } form, .review { display: grid; gap: .8rem; min-width: 0; } .review { border-top: 1px solid var(--border); padding-top: 1rem; }
	label { display: grid; gap: .35rem; font-size: .85rem; font-weight: 600; min-width: 0; } input, textarea { background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); font: inherit; min-height: 44px; min-width: 0; padding: .6rem; width: 100%; }
	textarea { font-family: ui-monospace, monospace; font-size: .82rem; resize: vertical; } .check { display: flex; align-items: start; gap: .6rem; font-weight: 400; } .check input { width: 18px; height: 18px; min-height: 18px; flex: 0 0 18px; margin-top: .15rem; }
	.error { color: var(--foreground); background: color-mix(in oklch, var(--destructive) 12%, transparent); border: 1px solid var(--border); border-radius: 6px; padding: .7rem; margin: 0; } .file-name, code, small { overflow-wrap: anywhere; }
	dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; margin: 0; } dt { color: var(--muted-foreground); font-size: .8rem; } dd { margin: .25rem 0 0; font-weight: 600; } .warnings { padding-left: 1.1rem; margin: 0; font-size: .85rem; }
	.route-list { border-block: 1px solid var(--border); max-height: 210px; overflow: auto; } table { border-collapse: collapse; width: 100%; font-size: .85rem; table-layout: fixed; } th, td { padding: .5rem; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); } th:first-child { width: 90px; } th { background: var(--muted); } small { display: block; color: var(--muted-foreground); } details { font-size: .85rem; } summary { cursor: pointer; } details ul { max-height: 160px; overflow: auto; padding-left: 1.2rem; }
	@media (max-width: 560px) { .import-dialog { padding: .85rem; max-height: 96dvh; } .source-modes { flex-wrap: wrap; } dl { gap: .4rem; } }
</style>
