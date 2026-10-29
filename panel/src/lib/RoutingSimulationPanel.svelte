<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { Download, Import, Play, Square } from '@lucide/svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError } from './forms';
	import { requestJson } from './api';
	import {
		buildSimulationPayload, emptySimulationDraft, importSimulationRules, parseSimulationResponse,
		SimulationInputError, type SimulationField, type SimulationPayload, type SimulationResponse,
	} from './routing-simulation';

	let { active = true }: { active?: boolean } = $props();
	const i18n = useTranslation();
	let draft = $state(emptySimulationDraft());
	let response = $state.raw<SimulationResponse | null>(null);
	let operation = $state<'import' | 'run' | null>(null);
	let error = $state('');
	let errorField = $state<SimulationField | ''>('');
	let status = $state('');
	let lastPayload = $state<SimulationPayload | null>(null);
	let errorElement = $state<HTMLDivElement | undefined>();
	let requestSequence = 0;
	let activeRequest: AbortController | undefined;
	const busy = $derived(operation !== null);

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }

	function cancelRequests(): void {
		requestSequence += 1;
		activeRequest?.abort();
		activeRequest = undefined;
		operation = null;
	}

	function invalidate(): void {
		cancelRequests();
		response = null;
		lastPayload = null;
		error = '';
		errorField = '';
		status = '';
	}

	function errorMessage(cause: unknown): string {
		if (!(cause instanceof SimulationInputError)) return displayError(cause, text('仿真请求失败。', 'Simulation request failed.'));
		switch (cause.code) {
			case 'invalid-json': return text('JSON 格式无效。', 'Invalid JSON.');
			case 'objects': return text('必须是 JSON 对象数组。', 'Expected an array of JSON objects.');
			case 'rule-count': return text('规则最多 32 条，未导入任何截断子集。', 'At most 32 rules are allowed. No truncated subset was imported.');
			case 'sample-count': return text('样本数量必须为 1 至 16。', 'Provide 1 to 16 samples.');
			case 'depth': return text('链最大深度必须为 1 至 20 的整数。', 'Chain depth must be an integer from 1 to 20.');
			case 'size': return text('请求超过 128 KiB。', 'Request exceeds 128 KiB.');
			case 'incomplete-import': return text('服务端未返回完整规则集，原草稿已保留。', 'The server did not return a complete rule set. The draft was preserved.');
			case 'invalid-response': return text('仿真响应与提交的样本不一致。', 'Simulation response does not match the submitted samples.');
		}
	}

	async function reportError(cause: unknown): Promise<void> {
		error = errorMessage(cause);
		errorField = cause instanceof SimulationInputError ? cause.field : 'request';
		await tick();
		if (active) errorElement?.focus();
	}

	async function importRules(): Promise<void> {
		if (busy) return;
		if (draft.rules !== '[]' && !window.confirm(text('替换当前候选规则草稿？样本保持不变。', 'Replace the candidate rules draft? Samples will be kept.'))) return;
		const sequence = ++requestSequence;
		const request = new AbortController();
		activeRequest = request;
		operation = 'import';
		error = '';
		errorField = '';
		status = '';
		try {
			const rules = importSimulationRules(await requestJson<unknown>('/api/routing/rules', { signal: request.signal }));
			if (request.signal.aborted || sequence !== requestSequence) return;
			draft.rules = JSON.stringify(rules, null, 2);
			response = null;
			lastPayload = null;
			status = text(`已导入全部 ${rules.length} 条规则。`, `Imported all ${rules.length} rules.`);
		} catch (cause) {
			if (!request.signal.aborted && sequence === requestSequence) await reportError(cause);
		} finally {
			if (sequence === requestSequence) operation = null;
		}
	}

	async function runSimulation(): Promise<void> {
		if (busy || !active) return;
		error = '';
		errorField = '';
		status = '';
		response = null;
		lastPayload = null;
		let payload: SimulationPayload;
		try { payload = buildSimulationPayload(draft); }
		catch (cause) { await reportError(cause); return; }
		const sequence = ++requestSequence;
		const request = new AbortController();
		activeRequest = request;
		operation = 'run';
		lastPayload = payload;
		try {
			const raw = await requestJson<unknown>('/api/control-plane/routing/simulate', {
				method: 'POST', body: JSON.stringify(payload), signal: request.signal,
			});
			if (request.signal.aborted || sequence !== requestSequence) return;
			response = parseSimulationResponse(raw, payload.samples);
			status = text(`已评估 ${response.results.length} 个样本。`, `Evaluated ${response.results.length} samples.`);
		} catch (cause) {
			if (!request.signal.aborted && sequence === requestSequence) await reportError(cause);
		} finally {
			if (sequence === requestSequence) operation = null;
		}
	}

	function cancel(): void {
		cancelRequests();
		status = text('已取消。', 'Cancelled.');
	}

	function exportResults(): void {
		if (!response || !lastPayload) return;
		const url = URL.createObjectURL(new Blob([JSON.stringify({ input: lastPayload, ...response }, null, 2)], { type: 'application/json' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = 'routing-simulation.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	$effect(() => { if (!active) cancelRequests(); });
	onDestroy(cancelRequests);
</script>

<div class="simulation">
	<div class="toolbar">
		<div class="actions">
			<button type="button" onclick={() => void importRules()} disabled={busy}><Import size={16} aria-hidden="true" />{text('导入全部已存规则', 'Import all stored rules')}</button>
			<button class="primary" type="button" onclick={() => void runSimulation()} disabled={busy}><Play size={16} aria-hidden="true" />{operation === 'run' ? text('运行中', 'Running') : text('运行仿真', 'Run simulation')}</button>
			{#if busy}<button class="icon-button" type="button" onclick={cancel} aria-label={text('取消请求', 'Cancel request')} title={text('取消请求', 'Cancel request')}><Square size={16} aria-hidden="true" /></button>{/if}
			<button class="icon-button" type="button" onclick={exportResults} disabled={!response || busy} aria-label={text('导出结果', 'Export results')} title={text('导出结果', 'Export results')}><Download size={16} aria-hidden="true" /></button>
		</div>
		<span class="mode">{text('离线 · 加权抽样', 'Offline · Weighted sample')}</span>
	</div>
	<div class="status" role="status" aria-live="polite">{operation === 'import' ? text('正在导入全部规则', 'Importing all rules') : status}</div>
	{#if error}<div class="notice error" role="alert" tabindex="-1" bind:this={errorElement}>{error}</div>{/if}
	<form onsubmit={(event) => { event.preventDefault(); void runSimulation(); }}>
		<fieldset disabled={operation === 'import'}>
			<div class="editors">
				<label for="simulation-rules">{text('候选规则 JSON', 'Candidate rules JSON')}
					<textarea id="simulation-rules" rows="20" spellcheck="false" autocomplete="off" bind:value={draft.rules} oninput={invalidate} aria-invalid={errorField === 'rules'} aria-describedby={errorField === 'rules' ? 'simulation-rules-error' : undefined}></textarea>
					{#if errorField === 'rules'}<span class="field-error" id="simulation-rules-error">{error}</span>{/if}
				</label>
				<label for="simulation-samples">{text('样本与用量快照 JSON', 'Samples and usage snapshots JSON')}
					<textarea id="simulation-samples" rows="20" spellcheck="false" autocomplete="off" bind:value={draft.samples} oninput={invalidate} aria-invalid={errorField === 'samples'} aria-describedby={errorField === 'samples' ? 'simulation-samples-error' : undefined}></textarea>
					{#if errorField === 'samples'}<span class="field-error" id="simulation-samples-error">{error}</span>{/if}
				</label>
			</div>
			<label class="depth" for="simulation-depth">{text('最大链深度', 'Maximum chain depth')}<input id="simulation-depth" type="number" min="1" max="20" step="1" bind:value={draft.chainMaxDepth} oninput={invalidate} aria-invalid={errorField === 'depth'} aria-describedby={errorField === 'depth' ? 'simulation-depth-error' : undefined} />{#if errorField === 'depth'}<span class="field-error" id="simulation-depth-error">{error}</span>{/if}</label>
		</fieldset>
	</form>
	<section class="results" aria-labelledby="simulation-results-title" aria-busy={operation === 'run'}>
		<h2 id="simulation-results-title">{text('仿真结果', 'Simulation results')}</h2>
		{#if operation === 'run'}<p role="status">{text('正在评估样本', 'Evaluating samples')}</p>
		{:else if response}
			<div class="result-list">
				{#each response.results as result, index (index)}
					<article class:failed={Boolean(result.error)}>
						<header><h3>{result.name || `${text('样本', 'Sample')} ${index + 1}`}</h3><span class="result-state">{result.error ? text('失败', 'Failed') : result.matched ? text('已匹配', 'Matched') : text('未匹配', 'No match')}</span></header>
						{#if result.error}<p class="field-error">{result.error}</p>{/if}
						{#if result.decision}<dl>
							<div><dt>{text('目标', 'Target')}</dt><dd>{result.decision.provider} / {result.decision.model}</dd></div>
							<div><dt>{text('匹配规则', 'Matched rule')}</dt><dd>{result.decision.rule_name} <code>{result.decision.rule_id}</code></dd></div>
							<div><dt>{text('密钥 ID', 'Key ID')}</dt><dd>{result.decision.key_id || '—'}</dd></div>
							<div><dt>TTFT</dt><dd>{result.decision.ttft_timeout_ms} ms</dd></div>
						</dl>{/if}
						<details><summary>{text('完整决策', 'Full decision')}</summary><pre>{JSON.stringify(result.decision, null, 2)}</pre></details>
						<details><summary>{text('引擎 trace', 'Engine trace')} ({result.logs.length})</summary><pre>{JSON.stringify(result.logs, null, 2)}</pre></details>
					</article>
				{/each}
			</div>
		{:else}<p class="empty">{text('暂无仿真结果', 'No simulation results')}</p>{/if}
	</section>
</div>

<style>
	.simulation { --simulation-error-text: color-mix(in srgb, var(--destructive) 75%, var(--foreground)); display: grid; gap: 1rem; min-width: 0; }
	.toolbar, .actions { align-items: center; display: flex; flex-wrap: wrap; gap: .5rem; }
	.toolbar { justify-content: space-between; }
	button { align-items: center; background: var(--muted); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); cursor: pointer; display: inline-flex; font: inherit; font-size: .85rem; font-weight: 650; gap: .45rem; justify-content: center; min-height: 44px; padding: .5rem .75rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button:disabled { cursor: not-allowed; opacity: .5; }
	.icon-button { height: 44px; padding: 0; width: 44px; }
	button:focus-visible, textarea:focus-visible, input:focus-visible, summary:focus-visible, .notice:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
	.mode, .status, .empty, dt { color: var(--muted-foreground); }
	.mode { font-size: .8rem; }
	.status { font-size: .85rem; min-height: 1.5em; }
	fieldset { border: 0; margin: 0; min-width: 0; padding: 0; }
	.editors { display: grid; gap: 1rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	label { display: grid; font-size: .85rem; font-weight: 650; gap: .5rem; min-width: 0; }
	input, textarea { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; box-sizing: border-box; color: var(--foreground); min-width: 0; padding: .75rem; width: 100%; }
	textarea, pre { font: .85rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size: 2; }
	textarea { min-height: 25rem; resize: vertical; }
	.depth { margin-top: .85rem; max-width: 17rem; }
	input { font: inherit; min-height: 44px; }
	[aria-invalid="true"] { border-color: var(--destructive); }
	.field-error { color: var(--simulation-error-text); font-size: .85rem; font-weight: 400; overflow-wrap: anywhere; }
	.notice { border: 1px solid var(--destructive); border-radius: .5rem; color: var(--simulation-error-text); overflow-wrap: anywhere; padding: .75rem; }
	h2 { font-size: 1.1rem; margin: 0 0 .75rem; }
	h3, p { margin: 0; }
	h3 { font-size: 1rem; min-width: 0; overflow-wrap: anywhere; }
	.results { border-top: 1px solid var(--border); min-width: 0; padding-top: 1rem; }
	.result-list { display: grid; gap: .75rem; }
	article { border: 1px solid var(--border); border-radius: .5rem; display: grid; gap: .75rem; min-width: 0; padding: .9rem; }
	article.failed { border-color: var(--destructive); }
	article > header { align-items: start; display: flex; gap: .75rem; justify-content: space-between; }
	.result-state { flex-shrink: 0; font-size: .85rem; font-weight: 650; }
	dl { display: grid; gap: .75rem; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; }
	dl > div { min-width: 0; }
	dt { font-size: .8rem; }
	dd { font-size: .85rem; margin: .3rem 0 0; overflow-wrap: anywhere; }
	dd code { display: block; font-size: .8rem; }
	summary { cursor: pointer; font-size: .85rem; min-height: 24px; overflow-wrap: anywhere; }
	pre { background: var(--muted); border-radius: .5rem; margin: .65rem 0 0; max-height: 25rem; overflow: auto; overflow-wrap: anywhere; padding: .75rem; white-space: pre-wrap; }
	@media (max-width: 760px) { .editors { grid-template-columns: minmax(0, 1fr); } dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } textarea { font-size: 1rem; min-height: 20rem; } input { font-size: 1rem; } }
	@media (max-width: 400px) { .actions { width: 100%; } .actions button:not(.icon-button) { flex: 1 1 auto; } dl { grid-template-columns: minmax(0, 1fr); } }
</style>
