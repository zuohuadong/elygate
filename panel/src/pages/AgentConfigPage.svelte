<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getAppName } from '../lib/branding';
	import { requestJson } from '../lib/api';
	import { displayError } from '../lib/forms';
	import {
		ACB_FILE_EXTENSION,
		ACB_MIME_TYPE,
		buildBundle,
		bundleToDeepLink,
		bundleToFileString,
		suggestedBundleFilename,
		type AcbBundle,
	} from '../lib/agentconfig';
	import {
		buildAgentConfigPublic,
		type AgentConfigExportResult,
		type AgentConfigExportSource,
		type AgentConfigExportWarningCode,
	} from '../lib/agentconfig-export';

	interface Props { resourceName: string; }

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let label = $state('');
	let source = $state.raw<AgentConfigExportSource>({
		models: { models: [] },
		mcpClients: { clients: [] },
		skills: { skills: [] },
		prompts: { prompts: [] },
		agents: { agents: [] },
	});
	let isLoading = $state(true);
	let isExporting = $state(false);
	let error = $state('');
	let notice = $state('');
	let sourceErrors = $state.raw<string[]>([]);
	let copied = $state(false);

	const exported = $derived<AgentConfigExportResult>(buildAgentConfigPublic(source));
	const hasContent = $derived(Object.values(exported.counts).some((count) => count > 0));
	const warningTexts = $derived(exported.warnings.map((warning) => warningText(warning.code, warning.name)));

	function text(zh: string, en: string): string {
		return i18n.locale === 'zh-CN' ? zh : en;
	}

	function defaultLabel(): string {
		const date = new Date().toISOString().slice(0, 10);
		return `Elygate ${date}`;
	}

	function warningText(code: AgentConfigExportWarningCode, name?: string): string {
		const suffix = name ? ` · ${name}` : '';
		const messages: Record<AgentConfigExportWarningCode, [string, string]> = {
			'mcp-unsupported-transport': ['跳过了 in-process/OpenAPI MCP client（ACB 仅支持 stdio/HTTP/SSE）', 'Skipped an in-process/OpenAPI MCP client (ACB supports stdio/HTTP/SSE only)'],
			'mcp-name-too-long': ['跳过了名称超过 64 字符的 MCP client', 'Skipped an MCP client whose name exceeds 64 characters'],
			'mcp-endpoint-not-public': ['HTTP/SSE 连接地址位于加密区，公共导出只保留名称和传输方式', 'An HTTP/SSE endpoint lives in the encrypted section; the public bundle keeps only its name and transport'],
			'mcp-env-values-omitted': ['MCP 环境变量只导出名称，不导出值', 'Only MCP environment variable names were exported, not values'],
			'model-invalid': ['跳过了缺少有效 provider/id 的模型', 'Skipped a model without a valid provider/id'],
			'skill-invalid': ['跳过了标识无效的 Skill', 'Skipped a skill with an invalid id'],
			'prompt-invalid': ['跳过了标识无效的提示词', 'Skipped a prompt with an invalid id'],
			'prompt-title-truncated': ['提示词标题超过 80 字符，已截断', 'A prompt title exceeded 80 characters and was truncated'],
			'agent-invalid': ['跳过了名称超过 64 字符的 Agent', 'Skipped an agent whose name exceeds 64 characters'],
		};
		const [zh, en] = messages[code];
		return `${text(zh, en)}${suffix}`;
	}

	async function fetchPaged(path: string, key: string, totalKeys: string[]): Promise<unknown> {
		const pageSize = 100;
		const items: unknown[] = [];
		const seen = new Set<string>();
		let offset = 0;
		let total = Number.POSITIVE_INFINITY;
		for (let page = 0; page < 50; page += 1) {
			const separator = path.includes('?') ? '&' : '?';
			const payload = await requestJson<Record<string, unknown>>(`${path}${separator}limit=${pageSize}&offset=${offset}`);
			const rows = Array.isArray(payload[key]) ? payload[key] as unknown[] : [];
			for (const row of rows) {
				const identity = typeof row === 'object' && row !== null
					? JSON.stringify(Object.fromEntries(Object.entries(row).filter(([field]) => field !== 'tools' && field !== 'resources' && field !== 'prompts')))
					: String(row);
				if (seen.has(identity)) continue;
				seen.add(identity);
				items.push(row);
			}
			for (const totalKey of totalKeys) {
				const candidate = payload[totalKey];
				if (typeof candidate === 'number' && Number.isFinite(candidate)) {
					total = candidate;
					break;
				}
			}
			offset += rows.length;
			if (rows.length === 0 || offset >= total || items.length >= 5000) break;
		}
		return { [key]: items };
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		notice = '';
		copied = false;
		sourceErrors = [];
		const results = await Promise.allSettled([
			requestJson<unknown>('/api/models?unfiltered=true&limit=0'),
			fetchPaged('/api/mcp/clients', 'clients', ['total_count', 'total']),
			fetchPaged('/api/skills', 'skills', ['total']),
			requestJson<unknown>('/api/prompt-repo/prompts'),
			requestJson<unknown>('/api/agents'),
		]);
		const names: [string, string][] = [
			['模型', 'models'],
			['MCP', 'MCP'],
			['Skills', 'skills'],
			['提示词', 'prompts'],
			['Agents', 'agents'],
		];
		const failureLabels: string[] = [];
		const values: unknown[] = [];
		results.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				values[index] = result.value;
			} else {
				values[index] = undefined;
				failureLabels.push(text(...names[index]));
			}
		});
		source = {
			models: values[0] ?? { models: [] },
			mcpClients: values[1] ?? { clients: [] },
			skills: values[2] ?? { skills: [] },
			prompts: values[3] ?? { prompts: [] },
			agents: values[4] ?? { agents: [] },
		};
		sourceErrors = failureLabels;
		if (results.every((result) => result.status === 'rejected')) {
			error = text('所有配置数据都加载失败，无法生成配置包。', 'Every configuration source failed to load, so no bundle can be generated.');
		}
		if (!label) label = defaultLabel();
		isLoading = false;
	}

	async function currentBundle(): Promise<AcbBundle> {
		return buildBundle({
			label: label.trim() || defaultLabel(),
			src: 'elygate',
			trust: 'shared',
			pub: exported.pub,
		});
	}

	async function downloadBundle(): Promise<void> {
		if (isExporting || !hasContent) return;
		isExporting = true;
		error = '';
		notice = '';
		copied = false;
		try {
			const bundle = await currentBundle();
			const textValue = bundleToFileString(bundle);
			const objectUrl = URL.createObjectURL(new Blob([textValue], { type: ACB_MIME_TYPE }));
			const anchor = document.createElement('a');
			anchor.href = objectUrl;
			anchor.download = suggestedBundleFilename(bundle);
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(objectUrl);
			notice = text(`已导出 ${anchor.download}（公共配置，不含密钥）。`, `Exported ${anchor.download} as public configuration without secrets.`);
		} catch (cause) {
			error = displayError(cause, text('导出 AgentConfig 失败。', 'Failed to export AgentConfig.'));
		} finally {
			isExporting = false;
		}
	}

	async function copyDeepLink(): Promise<void> {
		if (isExporting || !navigator.clipboard) return;
		isExporting = true;
		error = '';
		notice = '';
		copied = false;
		try {
			const bundle = await currentBundle();
			const link = bundleToDeepLink(bundle);
			await navigator.clipboard.writeText(link);
			copied = true;
			notice = text('AgentConfig 深链已复制。', 'AgentConfig deep link copied.');
		} catch (cause) {
			error = displayError(cause, text('生成深链失败；请改用 .acfg 文件。', 'Failed to build a deep link; use the .acfg file instead.'));
		} finally {
			isExporting = false;
		}
	}

	onMount(() => {
		void load();
	});
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading">
		<div>
			<p class="eyebrow">{getAppName()} / {i18n.t('elygate.integrations')}</p>
			<h1>{text('Agent 配置包', 'AgentConfig bundle')}</h1>
			<p>{text('把 Elygate 中的模型、MCP、Skills、提示词和 Agent 导出为 VibeUnion AgentConfig Bundle（ACB v1），可在支持 agentconfig:// 的客户端中导入。', 'Export models, MCP servers, skills, prompts, and agents from Elygate as a VibeUnion AgentConfig Bundle (ACB v1) that any agentconfig:// capable client can import.')}</p>
		</div>
		<button type="button" onclick={() => void load()} disabled={isLoading || isExporting}>{text('刷新数据', 'Refresh data')}</button>
	</header>

	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	{#if sourceErrors.length > 0}
		<div class="notice warning" role="status">
			{text(`以下数据源加载失败，导出内容会缺失：${sourceErrors.join('、')}`, `These sources failed to load, so the bundle will be incomplete: ${sourceErrors.join(', ')}`)}
		</div>
	{/if}

	<section class="export-panel" aria-labelledby="agentconfig-export-title">
		<header>
			<div>
				<h2 id="agentconfig-export-title">{text('一键导出', 'One-click export')}</h2>
				<p>{text('默认使用 shared 信任模式，只导出可预览的公共配置：不包含 API Key、MCP 环境变量值、HTTP/SSE 地址、供应商端点或提示词正文。', 'Exports in shared trust mode with previewable public configuration only: no API keys, MCP environment values, HTTP/SSE endpoints, provider endpoints, or prompt bodies.')}</p>
			</div>
			<span class="badge">ACB v1 · shared</span>
		</header>

		<div class="form-grid">
			<label class="span-2">{text('配置包名称', 'Bundle label')}<input bind:value={label} maxlength="80" disabled={isLoading || isExporting} placeholder={defaultLabel()} /><small>{text('客户端会在导入预览中显示这个名称。', 'Clients show this label in the import preview.')}</small></label>
		</div>

		<div class="summary-grid" aria-live="polite">
			<div><strong>{exported.counts.models}</strong><span>{text('模型', 'Models')}</span></div>
			<div><strong>{exported.counts.mcp}</strong><span>MCP</span></div>
			<div><strong>{exported.counts.skills}</strong><span>Skills</span></div>
			<div><strong>{exported.counts.prompts}</strong><span>{text('提示词', 'Prompts')}</span></div>
			<div><strong>{exported.counts.agents}</strong><span>Agents</span></div>
			<div><strong>{exported.capabilities.length}</strong><span>{text('能力', 'Capabilities')}</span></div>
		</div>

		{#if exported.capabilities.length > 0}
			<div class="capabilities" aria-label={text('能力列表', 'Capabilities')}>
				{#each exported.capabilities as capability (capability)}<span class="badge">{capability}</span>{/each}
			</div>
		{/if}

		{#if warningTexts.length > 0}
			<details class="warnings" open>
				<summary>{text(`导出提示（${warningTexts.length}）`, `Export notes (${warningTexts.length})`)}</summary>
				<ul>{#each warningTexts as warning, index (index)}<li>{warning}</li>{/each}</ul>
			</details>
		{/if}

		<footer>
			<button class="primary" type="button" onclick={() => void downloadBundle()} disabled={isLoading || isExporting || !hasContent}>
				{isExporting ? text('生成中…', 'Preparing…') : text(`下载 ${ACB_FILE_EXTENSION}`, `Download ${ACB_FILE_EXTENSION}`)}
			</button>
			<button type="button" onclick={() => void copyDeepLink()} disabled={isLoading || isExporting || !hasContent}>{copied ? text('已复制', 'Copied') : text('复制导入深链', 'Copy import deep link')}</button>
			{#if !hasContent && !isLoading}<span class="hint">{text('当前没有可导出的配置。', 'There is no configuration to export yet.')}</span>{/if}
		</footer>
	</section>

	<section class="preview-panel" aria-labelledby="agentconfig-preview-title">
		<header>
			<div>
				<h2 id="agentconfig-preview-title">{text('公共配置预览', 'Public configuration preview')}</h2>
				<p>{text('导入方会在输入密码前看到以下内容；确认后再写入本机配置。', 'An importer sees exactly this before any password prompt and only writes local configuration after confirmation.')}</p>
			</div>
		</header>
		<pre data-testid="agentconfig-public-preview">{JSON.stringify(exported.pub, null, 2)}</pre>
	</section>
</section>

<style>
	.page-shell { display: grid; gap: 1rem; margin: 0 auto; max-width: 1180px; padding: 1.5rem; }
	.page-heading, .export-panel > header, footer { align-items: center; display: flex; flex-wrap: wrap; gap: .7rem; justify-content: space-between; }
	.page-heading { align-items: start; }
	.page-heading h1, h2 { margin: 0; }
	.page-heading p, .export-panel > header p, .preview-panel > header p { color: var(--muted-foreground); margin: .35rem 0 0; max-width: 76ch; }
	.eyebrow { color: var(--muted-foreground); font-size: .75rem; letter-spacing: .08em; margin: 0 0 .35rem; text-transform: uppercase; }
	.export-panel, .preview-panel { background: var(--card); border: 1px solid var(--border); border-radius: .9rem; display: grid; gap: 1rem; padding: 1.1rem; }
	.export-panel > header, .preview-panel > header { align-items: start; }
	.form-grid { display: grid; gap: .9rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-grid label { display: grid; gap: .35rem; }
	.form-grid .span-2 { grid-column: span 2; }
	.form-grid input { background: var(--background); border: 1px solid var(--border); border-radius: .55rem; color: inherit; padding: .55rem .7rem; }
	.form-grid small, .hint { color: var(--muted-foreground); }
	.summary-grid { display: grid; gap: .7rem; grid-template-columns: repeat(6, minmax(0, 1fr)); }
	.summary-grid div { background: var(--muted); border-radius: .7rem; display: grid; gap: .15rem; padding: .8rem; }
	.summary-grid strong { font-size: 1.45rem; line-height: 1; }
	.summary-grid span { color: var(--muted-foreground); font-size: .8rem; }
	.capabilities { display: flex; flex-wrap: wrap; gap: .4rem; }
	.badge { background: var(--muted); border-radius: 999px; font-size: .78rem; padding: .22rem .6rem; }
	.warnings { background: var(--muted); border-radius: .7rem; padding: .7rem .9rem; }
	.warnings summary { cursor: pointer; font-weight: 600; }
	.warnings ul { color: var(--muted-foreground); margin: .55rem 0 0; padding-left: 1.2rem; }
	.warnings li + li { margin-top: .25rem; }
	.notice { border-radius: .65rem; padding: .7rem .9rem; }
	.notice.error { background: color-mix(in srgb, var(--destructive) 12%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in srgb, var(--primary) 12%, transparent); }
	.notice.warning { background: color-mix(in srgb, var(--warning, #d97706) 14%, transparent); }
	footer { justify-content: flex-start; }
	button.primary { background: var(--primary); border-radius: .55rem; color: var(--primary-foreground); }
	button { border: 1px solid var(--border); border-radius: .55rem; background: var(--background); color: inherit; cursor: pointer; padding: .5rem .85rem; }
	button:disabled { cursor: not-allowed; opacity: .55; }
	.preview-panel pre { background: var(--muted); border-radius: .7rem; font-size: .8rem; margin: 0; max-height: 26rem; overflow: auto; padding: .9rem; }
	@media (max-width: 760px) {
		.summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.form-grid { grid-template-columns: 1fr; }
		.form-grid .span-2 { grid-column: span 1; }
	}
</style>