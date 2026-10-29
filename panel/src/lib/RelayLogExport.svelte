<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { Button } from '@svadmin/ui';
	import { Download, X } from '@lucide/svelte';
	import { requestJson, type JsonRecord } from './api';
	import { collectRelayLogExport, exportTargetCount, RELAY_LOG_EXPORT_MAX, relayLogListUrl, relayLogsToCsv } from './relay-log-export';

	interface Props {
		snapshot: { query: string; logs: JsonRecord[]; total: number; sortBy: string; order: string };
		onclose: () => void;
	}
	let { snapshot, onclose }: Props = $props();
	const i18n = useTranslation();
	let scope = $state('current');
	let maxEntries = $state('');
	let error = $state('');
	let progress = $state(0);
	let target = $state(0);
	let exporting = $state(false);
	let controller: AbortController | null = null;
	const bounds = $derived(new URLSearchParams(snapshot.query));
	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function showModal(dialog: HTMLDialogElement): { destroy: () => void } {
		const opener = document.activeElement;
		dialog.showModal();
		return { destroy: () => { dialog.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); } };
	}
	function containTab(event: KeyboardEvent): void {
		if (event.key !== 'Tab') return;
		const controls = (event.currentTarget as HTMLDialogElement).querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
		const first = controls[0], last = controls[controls.length - 1];
		if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
		else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
	}
	function cancel(): void { controller?.abort(); controller = null; exporting = false; progress = 0; }
	function close(): void { cancel(); onclose(); }
	function exportError(cause: unknown): string {
		const messages: Record<string, string> = {
			'invalid-export-limit': text('导出条数必须是 1 到 10,000 的整数。', 'Max entries must be an integer from 1 to 10,000.'),
			'invalid-relay-log-page': text('日志响应无效，未下载文件。', 'Invalid log response. No file was downloaded.'),
			'repeating-relay-log-page': text('服务端返回重复页面，未下载文件。', 'Server returned a repeated page. No file was downloaded.'),
			'relay-log-export-scan-limit': text('重复数据超过读取上限，未下载文件。', 'Overlapping data exceeded the scan limit. No file was downloaded.'),
		};
		return cause instanceof Error ? messages[cause.message] ?? cause.message : text('导出失败。', 'Export failed.');
	}
	function download(records: JsonRecord[]): void {
		const objectUrl = URL.createObjectURL(new Blob(['\ufeff', relayLogsToCsv(records)], { type: 'text/csv;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = objectUrl; link.download = 'relay-logs.csv';
		document.body.append(link); link.click(); link.remove();
		window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
	}
	async function collect(active: AbortController): Promise<JsonRecord[]> {
		return collectRelayLogExport({
			target, signal: active.signal,
			fetchBatch: (offset, limit) => requestJson<unknown>(relayLogListUrl(snapshot.query, { limit, offset, sortBy: snapshot.sortBy, order: snapshot.order }), { signal: active.signal }),
			onProgress: (count) => { progress = count; },
		});
	}
	async function start(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (exporting) return;
		error = '';
		try { target = scope === 'current' ? snapshot.logs.length : exportTargetCount(snapshot.total, maxEntries); }
		catch (cause) { error = exportError(cause); return; }
		if (!target) { error = text('没有可导出的日志。', 'No matching logs to export.'); return; }
		const active = new AbortController();
		controller = active; exporting = true; progress = 0;
		try {
			const records = scope === 'current' ? snapshot.logs : await collect(active);
			if (active.signal.aborted) return;
			if (!records.length) { error = text('没有可导出的日志。', 'No matching logs to export.'); return; }
			download(records);
			close();
		} catch (cause) {
			if (!active.signal.aborted) error = exportError(cause);
		} finally {
			if (controller === active) { controller = null; exporting = false; }
		}
	}
	onMount(() => () => cancel());
</script>

<dialog class="export-dialog" aria-labelledby="relay-export-title" use:showModal onkeydown={containTab} oncancel={(event) => { event.preventDefault(); close(); }}>
	<header><h2 id="relay-export-title">{text('导出 Relay 日志', 'Export relay logs')}</h2><Button variant="ghost" size="icon" type="button" aria-label={text('关闭导出', 'Close export')} title={i18n.t('elygate.close')} onclick={close}><X size={18} aria-hidden="true" /></Button></header>
	<form onsubmit={(event) => void start(event)}>
		<fieldset disabled={exporting}><legend>{text('导出范围', 'Export scope')}</legend>
			<label class="radio"><input type="radio" bind:group={scope} value="current" />{text('当前页', 'Current page')} ({snapshot.logs.length.toLocaleString(i18n.locale)})</label>
			<label class="radio"><input type="radio" bind:group={scope} value="matching" />{text('匹配日志', 'Matching logs')} ({snapshot.total.toLocaleString(i18n.locale)})</label>
			{#if scope === 'matching'}<label class="limit">{text('最大条数', 'Max entries')}<input bind:value={maxEntries} inputmode="numeric" placeholder={String(Math.min(snapshot.total, RELAY_LOG_EXPORT_MAX))} aria-describedby="relay-export-cap" /></label><p id="relay-export-cap">{text('上限 10,000 条', 'Up to 10,000 entries')}</p>{/if}
		</fieldset>
		<p class="window">{new Date(bounds.get('start_time')!).toLocaleString(i18n.locale)} &ndash; {new Date(bounds.get('end_time')!).toLocaleString(i18n.locale)}</p>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if exporting}<div role="status"><progress value={progress} max={target}></progress><p>{text('已读取', 'Collected')} {progress.toLocaleString(i18n.locale)} / {target.toLocaleString(i18n.locale)}</p></div>{/if}
		<footer><Button type="button" variant="outline" onclick={() => exporting ? cancel() : close()}>{exporting ? text('取消导出', 'Cancel export') : i18n.t('elygate.cancel')}</Button><Button type="submit" disabled={exporting}><Download size={16} aria-hidden="true" />{text('导出 CSV', 'Export CSV')}</Button></footer>
	</form>
</dialog>

<style>
	.export-dialog { background: var(--card); border: 1px solid var(--border); border-radius: 8px; color: var(--foreground); margin: auto; max-height: 90dvh; overflow: auto; padding: 1rem; width: min(460px, calc(100% - 2rem)); }
	.export-dialog::backdrop { background: rgb(0 0 0 / .5); }
	header, footer { align-items: center; display: flex; gap: .5rem; justify-content: space-between; }
	h2 { font-size: 1.1rem; margin: 0; } form { display: grid; gap: 1rem; margin-top: 1rem; }
	fieldset { border: 0; display: grid; gap: .6rem; margin: 0; min-width: 0; padding: 0; }
	legend { font-size: .85rem; font-weight: 600; margin-bottom: .65rem; }
	label { align-items: center; display: flex; font-size: .85rem; gap: .5rem; min-height: 44px; }
	label.limit { align-items: stretch; display: grid; }
	input:not([type="radio"]) { background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); font: inherit; min-height: 44px; min-width: 0; padding: .55rem .65rem; width: 100%; }
	input[type="radio"] { height: 16px; width: 16px; }
	p { color: var(--muted-foreground); font-size: .8rem; margin: 0; overflow-wrap: anywhere; }
	.error { color: var(--destructive); } progress { accent-color: var(--primary); width: 100%; }
	footer { justify-content: end; flex-wrap: wrap; } .window { font-variant-numeric: tabular-nums; }
	@media (max-width: 560px) { input:not([type="radio"]) { font-size: 16px; } }
</style>
