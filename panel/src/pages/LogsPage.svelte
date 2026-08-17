<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, prettyJson } from '../lib/forms';
	import { getListPayload, getTotal, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';

	interface Props { resourceName: string; }
	interface LogStats { total_requests?: number; success_rate?: number; average_latency?: number; total_tokens?: number; total_cost?: number; }

	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let logs = $state.raw<JsonRecord[]>([]);
	let filterData = $state.raw<JsonRecord>({});
	let stats = $state.raw<LogStats>({});
	let selectedLog = $state.raw<JsonRecord | null>(null);
	let selectedIds = $state.raw<string[]>([]);
	let isDetailLoading = $state(false);
	let isLoading = $state(true);
	let isMutating = $state(false);
	let error = $state('');
	let notice = $state('');
	let query = $state('');
	let provider = $state('');
	let model = $state('');
	let status = $state('');
	let period = $state('24h');
	let page = $state(1);
	let pageSize = $state('50');
	let total = $state(0);
	let liveConnected = $state(false);
	let websocket: WebSocket | null = null;
	let reconnectTimer: number | null = null;
	let reloadTimer: number | null = null;
	let stopped = false;

	const hasNext = $derived(page * Number(pageSize) < total);
	const providers = $derived(stringList(filterData.providers));
	const models = $derived(stringList(filterData.models));
	const selectedVideoSources = $derived(selectedLog ? videoSources(selectedLog) : []);
	const selectedTranscription = $derived(selectedLog && isJsonRecord(selectedLog.transcription_output) ? selectedLog.transcription_output : null);
	const selectedOcrInput = $derived(selectedLog && isJsonRecord(selectedLog.ocr_input) ? selectedLog.ocr_input : null);
	const selectedOcrOutput = $derived(selectedLog && isJsonRecord(selectedLog.ocr_output) ? selectedLog.ocr_output : null);
	const selectedOcrPages = $derived(selectedOcrOutput && Array.isArray(selectedOcrOutput.pages) ? selectedOcrOutput.pages.filter(isJsonRecord) : []);

	function stringList(value: unknown): string[] {
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
	}

	function value(record: JsonRecord, key: string): string {
		const candidate = record[key];
		return candidate === null || candidate === undefined ? '—' : String(candidate);
	}

	function filterParams(): URLSearchParams {
		const params = new URLSearchParams({ period });
		if (query.trim()) params.set('content_search', query.trim());
		if (provider) params.set('providers', provider);
		if (model) params.set('models', model);
		if (status) params.set('status', status);
		return params;
	}

	function endpoint(): string {
		const params = filterParams();
		params.set('limit', pageSize);
		params.set('offset', String((page - 1) * Number(pageSize)));
		params.set('sort_by', 'timestamp');
		params.set('order', 'desc');
		return `/api/logs?${params.toString()}`;
	}

	function statsEndpoint(): string {
		return `/api/logs/stats?${filterParams().toString()}`;
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const [payload, statsPayload] = await Promise.all([
				requestJson<unknown>(endpoint()),
				requestJson<LogStats>(statsEndpoint()).catch(() => ({})),
			]);
			logs = getListPayload(payload);
			stats = isJsonRecord(statsPayload) ? statsPayload as LogStats : {};
			if (isJsonRecord(payload)) {
				total = isJsonRecord(payload.pagination) ? getTotal(payload.pagination, logs.length) : getTotal(payload, logs.length);
			} else {
				total = logs.length;
			}
			selectedIds = selectedIds.filter((id) => logs.some((log) => String(log.id) === id));
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	async function loadFilters(): Promise<void> {
		try {
			const payload = await requestJson<JsonRecord>('/api/logs/filterdata?dimensions=models,providers');
			filterData = payload;
		} catch {
			filterData = {};
		}
	}

	async function openDetail(record: JsonRecord): Promise<void> {
		selectedLog = record;
		isDetailLoading = true;
		try {
			selectedLog = await requestJson<JsonRecord>(`/api/logs/${encodeURIComponent(String(record.id))}`);
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isDetailLoading = false;
		}
	}

	async function recalculateCosts(): Promise<void> {
		if (!window.confirm(i18n.t('elygate.confirmAction'))) return;
		isMutating = true;
		error = '';
		try {
			await requestJson('/api/logs/recalculate-cost', { method: 'POST', body: JSON.stringify({ filters: { period } }) });
			notice = i18n.t('elygate.costRecalculationStarted');
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isMutating = false;
		}
	}

	async function clearLogs(): Promise<void> {
		if (selectedIds.length === 0 || !window.confirm(i18n.t('elygate.confirmClearLogs'))) return;
		isMutating = true;
		error = '';
		try {
			await requestJson('/api/logs', { method: 'DELETE', body: JSON.stringify({ ids: selectedIds }) });
			selectedIds = [];
			notice = i18n.t('elygate.logsCleared');
			await load();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isMutating = false;
		}
	}

	function toggleSelected(id: string, checked: boolean): void {
		selectedIds = checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((item) => item !== id);
	}

	function scheduleReload(): void {
		if (reloadTimer !== null) window.clearTimeout(reloadTimer);
		reloadTimer = window.setTimeout(() => {
			page = 1;
			void load();
		}, 350);
	}

	async function connectWebSocket(): Promise<void> {
		if (stopped) return;
		try {
			const ticketResponse = await requestJson<{ ticket?: string }>('/api/session/ws-ticket', { method: 'POST' });
			const url = new URL('/ws', window.location.href);
			url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			if (ticketResponse.ticket) url.searchParams.set('ticket', ticketResponse.ticket);
			websocket = new WebSocket(url);
			websocket.onopen = () => {
				liveConnected = true;
			};
			websocket.onmessage = (event) => {
				try {
					const message = JSON.parse(String(event.data)) as JsonRecord;
					if (message.type === 'store_update' && Array.isArray(message.tags) && message.tags.includes('Logs')) scheduleReload();
				} catch {
					// 忽略非 JSON 心跳帧。
				}
			};
			websocket.onclose = () => {
				liveConnected = false;
				if (!stopped) reconnectTimer = window.setTimeout(() => void connectWebSocket(), 2_000);
			};
			websocket.onerror = () => websocket?.close();
		} catch {
			liveConnected = false;
			if (!stopped) reconnectTimer = window.setTimeout(() => void connectWebSocket(), 4_000);
		}
	}

	function submitFilters(event: SubmitEvent): void {
		event.preventDefault();
		page = 1;
		void load();
	}

	function movePage(next: number): void {
		page = Math.max(1, next);
		void load();
	}

	function formatted(value: unknown): string {
		if (typeof value === 'string') {
			try { return prettyJson(JSON.parse(value), value); } catch { return value; }
		}
		return prettyJson(value, '—');
	}

	function imageSources(record: JsonRecord): string[] {
		const output = isJsonRecord(record.image_generation_output) ? record.image_generation_output : {};
		const items = Array.isArray(output.data) ? output.data : [];
		return items.flatMap((item) => {
			if (!isJsonRecord(item)) return [];
			if (typeof item.url === 'string') return [item.url];
			if (typeof item.b64_json === 'string') return [`data:image/png;base64,${item.b64_json}`];
			return [];
		});
	}

	function audioSource(record: JsonRecord): string {
		const output = isJsonRecord(record.speech_output) ? record.speech_output : {};
		return mediaSource(output.audio, 'audio/mpeg');
	}

	function transcriptionAudioSource(record: JsonRecord): string {
		const input = isJsonRecord(record.transcription_input) ? record.transcription_input : {};
		return mediaSource(input.file, 'audio/mpeg');
	}

	function mediaSource(value: unknown, mimeType: string): string {
		if (typeof value !== 'string' || !value) return '';
		return /^(data:|https?:|blob:)/i.test(value) ? value : `data:${mimeType};base64,${value}`;
	}

	function videoSources(record: JsonRecord): Array<{ src: string; type: string }> {
		const outputs = [record.video_generation_output, record.video_retrieve_output].filter(isJsonRecord);
		const result: Array<{ src: string; type: string }> = [];
		for (const output of outputs) {
			const videos = Array.isArray(output.videos) ? output.videos : [];
			for (const video of videos) {
				if (!isJsonRecord(video)) continue;
				const type = typeof video.content_type === 'string' ? video.content_type : 'video/mp4';
				const src = typeof video.url === 'string' ? video.url : mediaSource(video.base64, type);
				if (src) result.push({ src, type });
			}
		}
		const listOutput = isJsonRecord(record.video_list_output) ? record.video_list_output : {};
		for (const video of Array.isArray(listOutput.data) ? listOutput.data : []) {
			if (isJsonRecord(video) && typeof video.url === 'string') result.push({ src: video.url, type: 'video/mp4' });
		}
		return result;
	}

	function ocrImageSource(value: unknown): string {
		if (typeof value !== 'string' || !value) return '';
		if (/^(data:|https?:)/i.test(value)) return value;
		const mime = value.startsWith('/9j/') ? 'image/jpeg' : value.startsWith('UklGR') ? 'image/webp' : value.startsWith('R0lGO') ? 'image/gif' : 'image/png';
		return `data:${mime};base64,${value}`;
	}

	onMount(() => {
		void Promise.all([load(), loadFilters()]);
		void connectWebSocket();
		return () => {
			stopped = true;
			websocket?.close();
			if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
			if (reloadTimer !== null) window.clearTimeout(reloadTimer);
		};
	});
</script>

<section class="page-shell">
	<header class="page-heading">
		<div>
			<p class="eyebrow">Elygate / Observability</p>
			<h1>{i18n.t('elygate.logs')}</h1>
			<p><span class={['live-dot', liveConnected ? 'connected' : 'disconnected']}></span>{liveConnected ? i18n.t('elygate.liveConnected') : i18n.t('elygate.liveDisconnected')}</p>
		</div>
		<div class="heading-actions">
			<button type="button" onclick={() => void recalculateCosts()} disabled={isMutating}>{i18n.t('elygate.recalculateCosts')}</button>
			<button class="danger" type="button" onclick={() => void clearLogs()} disabled={isMutating || selectedIds.length === 0}>{i18n.t('elygate.clearLogs')} ({selectedIds.length})</button>
			<button class="primary" type="button" onclick={() => void load()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button>
		</div>
	</header>

	<div class="metric-grid">
		<article><span>{i18n.t('elygate.totalRequests')}</span><strong>{(stats.total_requests ?? total).toLocaleString()}</strong></article>
		<article><span>{i18n.t('elygate.successRate')}</span><strong>{(stats.success_rate ?? 0).toFixed(1)}%</strong></article>
		<article><span>{i18n.t('elygate.averageLatency')}</span><strong>{(stats.average_latency ?? 0).toFixed(0)} ms</strong></article>
		<article><span>{i18n.t('elygate.tokenUsage')}</span><strong>{(stats.total_tokens ?? 0).toLocaleString()}</strong></article>
		<article><span>{i18n.t('elygate.totalCost')}</span><strong>${(stats.total_cost ?? 0).toFixed(4)}</strong></article>
	</div>

	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}

	<form class="filters" onsubmit={submitFilters}>
		<label>{i18n.t('elygate.search')}<input bind:value={query} /></label>
		<label>{i18n.t('elygate.provider')}<select bind:value={provider}><option value="">{i18n.t('elygate.all')}</option>{#each providers as item (item)}<option value={item}>{item}</option>{/each}</select></label>
		<label>{i18n.t('elygate.model')}<select bind:value={model}><option value="">{i18n.t('elygate.all')}</option>{#each models as item (item)}<option value={item}>{item}</option>{/each}</select></label>
		<label>{i18n.t('elygate.status')}<select bind:value={status}><option value="">{i18n.t('elygate.all')}</option><option value="success">success</option><option value="error">error</option><option value="cancelled">cancelled</option><option value="processing">processing</option></select></label>
		<label>{i18n.t('elygate.timeRange')}<select bind:value={period}><option value="1h">1h</option><option value="24h">24h</option><option value="7d">7d</option><option value="30d">30d</option></select></label>
		<label>{i18n.t('elygate.pageSize')}<select bind:value={pageSize}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
		<button type="submit" disabled={isLoading}>{i18n.t('elygate.search')}</button>
	</form>

	<div class="table-wrap" aria-busy={isLoading}>
		<table><thead><tr><th></th><th>{i18n.t('elygate.timestamp')}</th><th>{i18n.t('elygate.provider')}</th><th>{i18n.t('elygate.model')}</th><th>{i18n.t('elygate.status')}</th><th>{i18n.t('elygate.latency')}</th><th>{i18n.t('elygate.totalCost')}</th><th>{i18n.t('elygate.app')}</th><th>{i18n.t('elygate.description')}</th><th>{i18n.t('elygate.actions')}</th></tr></thead><tbody>
			{#each logs as log (String(log.id))}
				<tr>
					<td><input type="checkbox" checked={selectedIds.includes(String(log.id))} onchange={(event) => toggleSelected(String(log.id), event.currentTarget.checked)} aria-label={i18n.t('elygate.select')} /></td><td>{new Date(value(log, 'timestamp')).toLocaleString(i18n.locale)}</td><td>{value(log, 'provider')}</td><td>{value(log, 'model')}</td><td><span class={['status', value(log, 'status')]}>{value(log, 'status')}</span></td><td>{Number(log.latency ?? 0).toFixed(0)} ms</td><td>${Number(log.cost ?? 0).toFixed(5)}</td><td>{value(log, 'app')}</td><td>{value(log, 'content_summary')}</td><td><button type="button" onclick={() => void openDetail(log)}>{i18n.t('elygate.inspect')}</button></td>
				</tr>
			{:else}<tr><td colspan="10">{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</td></tr>{/each}
		</tbody></table>
	</div>
	<footer class="pagination"><span>{i18n.t('elygate.page').replace('{page}', String(page))} · {total}</span><div><button type="button" onclick={() => movePage(page - 1)} disabled={page <= 1 || isLoading}>{i18n.t('elygate.previous')}</button><button type="button" onclick={() => movePage(page + 1)} disabled={!hasNext || isLoading}>{i18n.t('elygate.next')}</button></div></footer>
</section>

{#if selectedLog}
	<div class="drawer-backdrop" onclick={(event) => event.currentTarget === event.target && (selectedLog = null)} role="presentation">
		<aside class="drawer" aria-label={i18n.t('elygate.logDetails')}>
			<header><div><p class="eyebrow">{value(selectedLog, 'object')}</p><h2>{value(selectedLog, 'provider')} / {value(selectedLog, 'model')}</h2></div><button type="button" onclick={() => (selectedLog = null)}>{i18n.t('elygate.close')}</button></header>
			{#if isDetailLoading}<p>{i18n.t('elygate.loading')}</p>{:else}
				<div class="detail-badges"><span>{value(selectedLog, 'status')}</span><span>{Number(selectedLog.latency ?? 0).toFixed(0)} ms</span><span>${Number(selectedLog.cost ?? 0).toFixed(5)}</span><span>{value(selectedLog, 'id')}</span></div>
				{#if selectedLog.content_hidden === true}<div class="notice">{i18n.t('elygate.contentHidden')}</div>{/if}
				{#if isJsonRecord(selectedLog.speech_input) && typeof selectedLog.speech_input.input === 'string'}<section><h3>{i18n.t('elygate.speechInput')}</h3><p class="prose-output">{selectedLog.speech_input.input}</p></section>{/if}
				{#if imageSources(selectedLog).length}<section><h3>{i18n.t('elygate.mediaOutput')}</h3><div class="media-grid">{#each imageSources(selectedLog) as source (source)}<img src={source} alt={i18n.t('elygate.mediaOutput')} />{/each}</div></section>{/if}
				{#if audioSource(selectedLog)}<section><h3>{i18n.t('elygate.mediaOutput')}</h3><audio controls src={audioSource(selectedLog)}></audio></section>{/if}
				{#if transcriptionAudioSource(selectedLog) || selectedTranscription}<section><h3>{i18n.t('elygate.transcription')}</h3>{#if transcriptionAudioSource(selectedLog)}<audio controls src={transcriptionAudioSource(selectedLog)}></audio>{/if}{#if selectedTranscription}<div class="media-meta">{#if selectedTranscription.language}<span>{i18n.t('elygate.detectedLanguage')}: {String(selectedTranscription.language)}</span>{/if}{#if selectedTranscription.duration}<span>{i18n.t('elygate.duration')}: {Number(selectedTranscription.duration).toFixed(1)}s</span>{/if}{#if selectedTranscription.task}<span>{String(selectedTranscription.task)}</span>{/if}</div><p class="prose-output">{String(selectedTranscription.text ?? '')}</p>{#if Array.isArray(selectedTranscription.segments)}<div class="segment-list">{#each selectedTranscription.segments.filter(isJsonRecord) as segment, segmentIndex (segmentIndex)}<div><small>{Number(segment.start ?? 0).toFixed(1)}s – {Number(segment.end ?? 0).toFixed(1)}s</small><span>{String(segment.text ?? '')}</span></div>{/each}</div>{/if}{/if}</section>{/if}
				{#if selectedVideoSources.length || isJsonRecord(selectedLog.video_generation_input)}<section><h3>{i18n.t('elygate.videoOutput')}</h3>{#if isJsonRecord(selectedLog.video_generation_input) && typeof selectedLog.video_generation_input.prompt === 'string'}<p class="prose-output">{selectedLog.video_generation_input.prompt}</p>{/if}<div class="video-grid">{#each selectedVideoSources as video (video.src)}<video controls preload="metadata" src={video.src}><track kind="captions" /></video>{/each}</div>{#if selectedLog.video_download_output}<pre>{formatted(selectedLog.video_download_output)}</pre>{/if}</section>{/if}
				{#if selectedOcrInput || selectedOcrOutput}<section><h3>{i18n.t('elygate.ocr')}</h3>{#if selectedOcrInput}<div class="media-meta"><span>{String(selectedOcrInput.type ?? 'OCR')}</span>{#if selectedOcrInput.document_url || selectedOcrInput.image_url}<a href={String(selectedOcrInput.document_url ?? selectedOcrInput.image_url)} target="_blank" rel="noopener noreferrer">{String(selectedOcrInput.document_url ?? selectedOcrInput.image_url)}</a>{/if}</div>{/if}{#if selectedOcrOutput?.document_annotation}<p class="prose-output"><strong>{i18n.t('elygate.documentAnnotation')}:</strong> {String(selectedOcrOutput.document_annotation)}</p>{/if}{#each selectedOcrPages as page, pageIndex (String(page.index ?? pageIndex))}<article class="ocr-page"><header><strong>{i18n.t('elygate.ocrPage')} {Number(page.index ?? pageIndex) + 1}</strong>{#if isJsonRecord(page.dimensions)}<span>{Number(page.dimensions.width ?? 0)} × {Number(page.dimensions.height ?? 0)} px · {Number(page.dimensions.dpi ?? 0)} DPI</span>{/if}</header><pre>{String(page.markdown ?? '')}</pre>{#if Array.isArray(page.images)}<div class="media-grid">{#each page.images.filter(isJsonRecord) as image, imageIndex (String(image.id ?? imageIndex))}{#if ocrImageSource(image.image_base64)}<img src={ocrImageSource(image.image_base64)} alt={`${i18n.t('elygate.extractedImage')} ${imageIndex + 1}`} />{/if}{/each}</div>{/if}</article>{/each}</section>{/if}
				{#each [['input_history', 'elygate.request'], ['responses_input_history', 'elygate.request'], ['output_message', 'elygate.response'], ['responses_output', 'elygate.response'], ['error_details', 'elygate.errorDetails'], ['plugin_logs', 'elygate.pluginLogs'], ['routing_engine_logs', 'elygate.routingLogs'], ['token_usage', 'elygate.tokenUsage'], ['metadata', 'elygate.metadata'], ['raw_request', 'elygate.rawRequest'], ['raw_response', 'elygate.rawResponse']] as item (item[0])}
					{#if selectedLog[item[0]] !== undefined && selectedLog[item[0]] !== ''}<section><h3>{i18n.t(item[1])}</h3><pre>{formatted(selectedLog[item[0]])}</pre></section>{/if}
				{/each}
			{/if}
		</aside>
	</div>
{/if}

<style>
	.page-shell { max-width: 1320px; margin: 0 auto; padding: 1.5rem; }
	.page-heading, .heading-actions, .pagination, .pagination div, .drawer header, .detail-badges { align-items: center; display: flex; gap: .5rem; }
	.page-heading { align-items: start; justify-content: space-between; margin-bottom: 1rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .4rem; text-transform: uppercase; }
	h1, h2 { margin: 0; }
	h1 { font-size: clamp(1.5rem, 3vw, 2.15rem); }
	.page-heading p { color: var(--muted-foreground); margin: .5rem 0 0; }
	.live-dot { border-radius: 50%; display: inline-block; height: .55rem; margin-right: .4rem; width: .55rem; }
	.live-dot.connected { background: #22c55e; }
	.live-dot.disconnected { background: var(--muted-foreground); }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); cursor: pointer; font-weight: 650; padding: .55rem .7rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	button:disabled { cursor: wait; opacity: .55; }
	.metric-grid { display: grid; gap: .7rem; grid-template-columns: repeat(5, minmax(0, 1fr)); margin-bottom: 1rem; }
	.metric-grid article { background: var(--card); border: 1px solid var(--border); border-radius: .75rem; padding: .85rem; }
	.metric-grid span { color: var(--muted-foreground); font-size: .75rem; }
	.metric-grid strong { display: block; font-size: 1.25rem; margin-top: .3rem; }
	.filters { align-items: end; display: grid; gap: .6rem; grid-template-columns: minmax(180px, 1.5fr) repeat(5, minmax(110px, .7fr)) auto; margin-bottom: .85rem; }
	.filters label { color: var(--muted-foreground); display: grid; font-size: .75rem; font-weight: 650; gap: .3rem; }
	.filters input, .filters select { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); min-width: 0; padding: .55rem; }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; overflow-x: auto; }
	table { border-collapse: collapse; min-width: 1050px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); font-size: .78rem; max-width: 260px; overflow: hidden; padding: .7rem .8rem; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
	th { color: var(--muted-foreground); }
	tbody tr { cursor: pointer; }
	tbody tr:hover { background: var(--muted); }
	.status { border-radius: 999px; padding: .2rem .45rem; }
	.status.success { background: color-mix(in oklch, #22c55e 14%, transparent); color: #15803d; }
	.status.error { background: color-mix(in oklch, var(--destructive) 12%, transparent); color: var(--destructive); }
	.pagination { color: var(--muted-foreground); justify-content: space-between; margin-top: .8rem; }
	.notice { border-radius: .65rem; margin-bottom: .8rem; padding: .7rem .85rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 12%, transparent); color: var(--primary); }
	.drawer-backdrop { background: rgb(0 0 0 / .4); inset: 0; position: fixed; z-index: 100; }
	.drawer { background: var(--background); border-left: 1px solid var(--border); height: 100%; margin-left: auto; max-width: 760px; overflow: auto; padding: 1rem; width: min(92vw, 760px); }
	.drawer header { justify-content: space-between; }
	.drawer h2 { font-size: 1.15rem; }
	.detail-badges { flex-wrap: wrap; margin: .8rem 0; }
	.detail-badges span { background: var(--muted); border-radius: 999px; font-size: .75rem; padding: .3rem .5rem; }
	.drawer section { border-top: 1px solid var(--border); padding: .8rem 0; }
	h3 { font-size: .9rem; margin: 0 0 .5rem; }
	pre { background: var(--muted); border-radius: .55rem; max-height: 360px; overflow: auto; padding: .7rem; white-space: pre-wrap; word-break: break-word; }
	.media-grid { display: grid; gap: .6rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.media-grid img { border-radius: .55rem; max-width: 100%; }
	.video-grid { display: grid; gap: .6rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.video-grid video { background: #000; border-radius: .55rem; max-height: 360px; width: 100%; }
	.media-meta { align-items: center; display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: .6rem; }
	.media-meta span, .media-meta a { background: var(--muted); border-radius: 999px; color: var(--foreground); font-size: .72rem; max-width: 100%; overflow: hidden; padding: .25rem .45rem; text-overflow: ellipsis; }
	.prose-output { line-height: 1.65; white-space: pre-wrap; }
	.segment-list { display: grid; gap: .35rem; margin-top: .6rem; }
	.segment-list div { background: var(--muted); border-radius: .45rem; display: grid; gap: .15rem; padding: .45rem .55rem; }
	.segment-list small { color: var(--muted-foreground); }
	.ocr-page { border: 1px solid var(--border)!important; border-radius: .6rem; margin-top: .6rem; padding: .7rem!important; }
	.ocr-page header { align-items: center; display: flex; justify-content: space-between; }
	.ocr-page header span { color: var(--muted-foreground); font-size: .7rem; }
	audio { width: 100%; }
	@media (max-width: 1050px) { .filters { grid-template-columns: repeat(3, minmax(0, 1fr)); } .metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	@media (max-width: 680px) { .page-heading { flex-direction: column; } .filters, .metric-grid { grid-template-columns: 1fr 1fr; } }
</style>
