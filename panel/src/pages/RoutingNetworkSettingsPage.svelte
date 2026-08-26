<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { displayError } from '../lib/forms';
	import {
		COMPLEXITY_KEYWORD_KEYS,
		buildComplexityPayload,
		buildProxyPayload,
		complexityDraftFromRecord,
		emptyProxyDraft,
		proxyDraftFromRecord,
		type ComplexityDraft,
		type ComplexityKeywordKey,
		type ProxyDraft,
	} from '../lib/routing-network-settings';

	interface Props { resourceName: string; }

	const keywordMeta: Record<ComplexityKeywordKey, { zh: string; en: string; helpZh: string; helpEn: string }> = {
		simple_keywords: { zh: '简单关键词', en: 'Simple keywords', helpZh: '问候、常识、简短请求等降低复杂度的信号。', helpEn: 'Greetings, trivia, and short requests that bias toward SIMPLE.' },
		code_keywords: { zh: '代码关键词', en: 'Code keywords', helpZh: '代码、调试、API、数据库等开发信号。', helpEn: 'Code, debugging, API, and database signals.' },
		technical_keywords: { zh: '技术关键词', en: 'Technical keywords', helpZh: '架构、基础设施、安全和运维信号。', helpEn: 'Architecture, infrastructure, security, and operations signals.' },
		reasoning_keywords: { zh: '推理关键词', en: 'Reasoning keywords', helpZh: '需要权衡、论证、根因分析等强推理触发语。', helpEn: 'Strong reasoning triggers such as tradeoffs, justification, and root-cause analysis.' },
	};

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let complexityDraft = $state<ComplexityDraft>(complexityDraftFromRecord({}));
	let proxyDraft = $state<ProxyDraft>(emptyProxyDraft());
	let isLoading = $state(true);
	let isSaving = $state(false);
	let error = $state('');
	let notice = $state('');
	const isComplexity = $derived(resourceName === 'complexity-analyzer' || resourceName === 'complexity-router');
	const spectrum = $derived.by(() => {
		const simple = Math.min(1, Math.max(0, Number(complexityDraft.simpleMedium) || 0));
		const mediumBoundary = Math.min(1, Math.max(simple, Number(complexityDraft.mediumComplex) || simple));
		const complexBoundary = Math.min(1, Math.max(mediumBoundary, Number(complexityDraft.complexReasoning) || mediumBoundary));
		return { simple: simple * 100, medium: (mediumBoundary - simple) * 100, complex: (complexBoundary - mediumBoundary) * 100, reasoning: (1 - complexBoundary) * 100 };
	});

	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function validationMessage(cause: unknown): string {
		if (!(cause instanceof Error)) return text('保存失败。', 'Failed to save.');
		if (cause.message.startsWith('boundary:')) return text('阈值必须是 0 与 1 之间的数字。', 'Thresholds must be numbers between 0 and 1.');
		if (cause.message === 'boundary-order') return text('阈值必须满足简单（SIMPLE）< 中等（MEDIUM）< 复杂（COMPLEX）< 推理（REASONING）。', 'Thresholds must increase from Simple to Medium to Complex to Reasoning.');
		if (cause.message.startsWith('keywords:')) return text('四组关键词都至少保留一个条目。', 'Every keyword group must contain at least one entry.');
		if (cause.message === 'url-required') return text('启用代理时必须填写 URL。', 'Proxy URL is required when enabled.');
		if (cause.message === 'url-invalid') return text('代理 URL 必须是有效的 HTTP(S) 地址。', 'Proxy URL must be a valid HTTP(S) URL.');
		if (cause.message === 'timeout-invalid') return text('连接超时必须是 0–300 秒的整数。', 'Connection timeout must be an integer from 0 to 300 seconds.');
		return cause.message;
	}
	function keywordCount(value: string): number { return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).length; }

	async function load(): Promise<void> {
		isLoading = true; error = '';
		try {
			const payload = await requestJson<unknown>(isComplexity ? '/api/governance/complexity-analyzer-config' : '/api/proxy-config');
			const record: JsonRecord = isJsonRecord(payload) ? payload : {};
			if (isComplexity) complexityDraft = complexityDraftFromRecord(record); else proxyDraft = proxyDraftFromRecord(record);
		} catch (cause) { error = displayError(cause, text('配置加载失败。', 'Failed to load configuration.')); }
		finally { isLoading = false; }
	}

	async function save(): Promise<void> {
		if (isSaving) return;
		isSaving = true; error = ''; notice = '';
		try {
			const payload = isComplexity ? buildComplexityPayload(complexityDraft) : buildProxyPayload(proxyDraft);
			const response = await requestJson<unknown>(isComplexity ? '/api/governance/complexity-analyzer-config' : '/api/proxy-config', { method: 'PUT', body: JSON.stringify(payload) });
			if (isJsonRecord(response)) { if (isComplexity) complexityDraft = complexityDraftFromRecord(response); else proxyDraft = proxyDraftFromRecord(response); }
			notice = isComplexity ? text('复杂度分析配置已保存并热重载。', 'Complexity configuration saved and hot-reloaded.') : text('代理配置已保存并重载；部分连接可能需要重启后完全生效。', 'Proxy configuration saved and reloaded; some connections may require a restart to fully apply.');
		} catch (cause) { error = validationMessage(cause); }
		finally { isSaving = false; }
	}

	async function resetComplexity(): Promise<void> {
		if (!window.confirm(text('确认恢复内置阈值和全部默认关键词？', 'Restore built-in thresholds and all default keywords?'))) return;
		isSaving = true; error = ''; notice = '';
		try {
			const response = await requestJson<unknown>('/api/governance/complexity-analyzer-config/reset', { method: 'POST' });
			complexityDraft = complexityDraftFromRecord(isJsonRecord(response) ? response : {});
			notice = text('已恢复默认配置并热重载。', 'Defaults restored and hot-reloaded.');
		} catch (cause) { error = displayError(cause, text('恢复默认配置失败。', 'Failed to restore defaults.')); }
		finally { isSaving = false; }
	}

	onMount(() => { void load(); });
</script>

<section class="page-shell" data-resource={resourceName}>
		<header class="page-heading"><div><p class="eyebrow">{getAppName()} / {isComplexity ? text('治理', 'Governance') : text('系统', 'System')}</p><h1>{isComplexity ? text('复杂度路由', 'Complexity router') : text('全局代理', 'Global proxy')}</h1><p>{isComplexity ? text('配置四级复杂度阈值和关键词库，生成可供路由规则匹配的复杂度层级（complexity_tier）。', 'Tune four complexity tiers and keyword dictionaries that produce complexity_tier for routing rules.') : text('控制 SCIM、推理和外部 API 请求的全局 HTTP(S) 代理、认证、绕过列表和 TLS 行为。', 'Control the global HTTP(S) proxy, authentication, bypass list, and TLS behavior for SCIM, inference, and external API requests.')}</p></div><div class="heading-actions"><button type="button" onclick={() => void load()} disabled={isLoading}>{text('刷新', 'Refresh')}</button>{#if isComplexity}<button type="button" onclick={() => void resetComplexity()} disabled={isSaving}>{text('恢复默认', 'Restore defaults')}</button>{/if}<button class="primary" type="button" onclick={() => void save()} disabled={isSaving || isLoading}>{isSaving ? text('保存中…', 'Saving…') : text('保存', 'Save')}</button></div></header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	{#if isComplexity}
			<section class="spectrum-card"><div class="section-heading"><div><h2>{text('复杂度光谱', 'Complexity spectrum')}</h2><p>{text('阈值变化会实时反映四个分类区间。', 'Threshold changes update all four classification ranges in real time.')}</p></div><div class="legend"><span>{text('简单（SIMPLE）', 'Simple')}</span><span>{text('中等（MEDIUM）', 'Medium')}</span><span>{text('复杂（COMPLEX）', 'Complex')}</span><span>{text('推理（REASONING）', 'Reasoning')}</span></div></div><div class="spectrum"><div class="simple" style:width={`${spectrum.simple}%`}>SIMPLE</div><div class="medium" style:width={`${spectrum.medium}%`}>MEDIUM</div><div class="complex" style:width={`${spectrum.complex}%`}>COMPLEX</div><div class="reasoning" style:width={`${spectrum.reasoning}%`}>REASONING</div></div><div class="axis"><span>0</span><span>{Number(complexityDraft.simpleMedium).toFixed(2)}</span><span>{Number(complexityDraft.mediumComplex).toFixed(2)}</span><span>{Number(complexityDraft.complexReasoning).toFixed(2)}</span><span>1</span></div></section>
			<section class="settings-card"><div class="section-heading"><div><h2>{text('分级阈值', 'Tier boundaries')}</h2><p>{text('必须严格递增，且每个值位于 0 与 1 之间。', 'Values must increase strictly and remain between 0 and 1.')}</p></div></div><div class="boundary-grid"><label><span>{text('简单 → 中等', 'Simple → Medium')}</span><input type="number" min="0.01" max="0.99" step="0.01" bind:value={complexityDraft.simpleMedium} /></label><label><span>{text('中等 → 复杂', 'Medium → Complex')}</span><input type="number" min="0.01" max="0.99" step="0.01" bind:value={complexityDraft.mediumComplex} /></label><label><span>{text('复杂 → 推理', 'Complex → Reasoning')}</span><input type="number" min="0.01" max="0.99" step="0.01" bind:value={complexityDraft.complexReasoning} /></label></div></section>
			<section class="keywords"><div class="section-heading"><div><h2>{text('关键词库', 'Keyword dictionaries')}</h2><p>{text('支持中文和英文关键词；每行或逗号分隔一个短语，保存时自动去重和清理空白。', 'Chinese and English keywords are supported. Enter one phrase per line or comma-separated; saving de-duplicates and trims values.')}</p></div></div><div class="keyword-grid">{#each COMPLEXITY_KEYWORD_KEYS as key (key)}<article><div><h3>{text(keywordMeta[key].zh, keywordMeta[key].en)}</h3><span>{keywordCount(complexityDraft.keywords[key])}</span></div><p>{text(keywordMeta[key].helpZh, keywordMeta[key].helpEn)}</p><textarea aria-label={text(keywordMeta[key].zh, keywordMeta[key].en)} rows="12" bind:value={complexityDraft.keywords[key]}></textarea></article>{/each}</div></section>
	{:else}
		<div class:disabled={!proxyDraft.enabled} class="proxy-grid"><section class="settings-card enable-card"><div><h2>{text('启用全局代理', 'Enable global proxy')}</h2><p>{text('关闭时仍保留配置，但网络请求不会使用代理。', 'When disabled, configuration is retained but requests bypass the proxy.')}</p></div><label class="switch"><input type="checkbox" bind:checked={proxyDraft.enabled} /><span>{proxyDraft.enabled ? text('已启用', 'Enabled') : text('已停用', 'Disabled')}</span></label></section><section class="settings-card"><h2>{text('连接', 'Connection')}</h2><div class="form-grid"><label>{text('代理类型', 'Proxy type')}<select bind:value={proxyDraft.type} disabled={!proxyDraft.enabled}><option value="http">HTTP / HTTPS</option></select><small>{text('后端当前仅支持 HTTP 代理；SOCKS5/TCP 会被拒绝。', 'The backend currently supports HTTP proxy only; SOCKS5/TCP are rejected.')}</small></label><label>{text('代理 URL', 'Proxy URL')}<input bind:value={proxyDraft.url} disabled={!proxyDraft.enabled} placeholder="http://proxy.example.com:8080" /></label><label>{text('用户名', 'Username')}<input bind:value={proxyDraft.username} disabled={!proxyDraft.enabled} autocomplete="username" /></label><label>{text('密码', 'Password')}<input type="password" bind:value={proxyDraft.password} disabled={!proxyDraft.enabled} autocomplete="current-password" /><small>{proxyDraft.password === '<redacted>' ? text('当前密码已脱敏；原样保存会保留服务端凭据。', 'The current password is redacted; leaving it unchanged preserves the server credential.') : text('留空会清除已有密码。', 'Leaving this empty clears the stored password.')}</small></label></div></section><section class="settings-card"><h2>{text('高级设置', 'Advanced settings')}</h2><div class="form-grid"><label class="span-2">No Proxy<textarea rows="4" bind:value={proxyDraft.noProxy} disabled={!proxyDraft.enabled} placeholder="localhost, 127.0.0.1, .internal.example.com"></textarea><small>{text('逗号分隔；这些主机绕过代理。', 'Comma-separated hosts that bypass the proxy.')}</small></label><label>{text('连接超时（秒）', 'Connection timeout (seconds)')}<input type="number" min="0" max="300" step="1" bind:value={proxyDraft.timeout} disabled={!proxyDraft.enabled} /></label><label class="check"><input type="checkbox" bind:checked={proxyDraft.skipTlsVerify} disabled={!proxyDraft.enabled} /><span><strong>{text('跳过 TLS 验证', 'Skip TLS verification')}</strong><small>{text('仅用于受控调试环境，不建议生产启用。', 'Use only in controlled debugging environments; not recommended in production.')}</small></span></label></div></section><section class="settings-card"><h2>{text('使用代理的组件', 'Proxy-enabled components')}</h2><div class="entity-list"><label class="check"><input type="checkbox" bind:checked={proxyDraft.enableForScim} disabled={!proxyDraft.enabled} /><span><strong>SCIM <em>Enterprise</em></strong><small>{text('企业目录同步和身份提供商请求。', 'Enterprise directory sync and identity-provider requests.')}</small></span></label><label class="check"><input type="checkbox" bind:checked={proxyDraft.enableForInference} disabled={!proxyDraft.enabled} /><span><strong>{text('推理请求', 'Inference')}</strong><small>{text('发送到模型 Provider 的请求。', 'Requests sent to model providers.')}</small></span></label><label class="check"><input type="checkbox" bind:checked={proxyDraft.enableForApi} disabled={!proxyDraft.enabled} /><span><strong>{text('外部 API / Webhook', 'External API / webhooks')}</strong><small>{text('外部 API、Webhook 和其他平台集成。', 'External APIs, webhooks, and platform integrations.')}</small></span></label></div></section></div>
	{/if}
</section>

<style>
	.page-shell { margin: 0 auto; max-width: 1260px; padding: 1.5rem; }
	.page-heading, .section-heading, .heading-actions, .legend, .enable-card { align-items: center; display: flex; flex-wrap: wrap; gap: .65rem; justify-content: space-between; }
	.page-heading { align-items: start; }
	.page-heading h1, h2, h3 { margin: 0; }
	.page-heading p, .section-heading p, .settings-card p, .keyword-grid p { color: var(--muted-foreground); margin: .42rem 0 0; max-width: 850px; }
	.eyebrow { color: var(--primary) !important; font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
	button, input, select, textarea { border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); font: inherit; }
	button, select { background: var(--muted); cursor: pointer; padding: .55rem .7rem; }
	input, textarea { background: var(--background); padding: .6rem .7rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button:disabled { cursor: not-allowed; opacity: .5; }
	.notice { border-radius: .65rem; margin-top: .8rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 10%, transparent); color: var(--primary); }
	.spectrum-card, .settings-card, .keyword-grid article { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; margin-top: 1rem; padding: 1rem; }
	.legend span { color: var(--muted-foreground); font-size: .68rem; text-transform: uppercase; }
	.spectrum { border-radius: .55rem; display: flex; height: 2.8rem; margin-top: 1rem; overflow: hidden; }
	.spectrum div { align-items: center; color: white; display: flex; font-size: .62rem; font-weight: 800; justify-content: center; min-width: 0; overflow: hidden; transition: width .2s; }
	.spectrum .simple { background: color-mix(in oklch, var(--primary) 35%, transparent); }
	.spectrum .medium { background: color-mix(in oklch, var(--primary) 55%, transparent); }
	.spectrum .complex { background: color-mix(in oklch, var(--primary) 75%, transparent); }
	.spectrum .reasoning { background: var(--primary); }
	.axis { color: var(--muted-foreground); display: flex; font-family: ui-monospace, monospace; font-size: .68rem; justify-content: space-between; margin-top: .35rem; }
	.boundary-grid, .form-grid { display: grid; gap: .8rem; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: .9rem; }
	.boundary-grid label, .form-grid label { color: var(--muted-foreground); display: grid; font-size: .75rem; gap: .3rem; }
	.boundary-grid input, .form-grid input, .form-grid select, .form-grid textarea { width: 100%; }
	.keywords { margin-top: 1rem; }
	.keyword-grid { display: grid; gap: .8rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.keyword-grid article > div { align-items: center; display: flex; justify-content: space-between; }
	.keyword-grid article > div span { background: var(--muted); border-radius: 999px; font-size: .68rem; padding: .2rem .48rem; }
	.keyword-grid textarea { font: .75rem ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: .65rem; width: 100%; }
	.proxy-grid { opacity: 1; }
	.proxy-grid.disabled > section:not(.enable-card) { opacity: .58; }
	.form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-grid small, label.check small { color: var(--muted-foreground); }
	.span-2 { grid-column: 1 / -1; }
	label.check, label.switch { align-items: start; display: flex; gap: .55rem; }
	label.check input, label.switch input { margin-top: .2rem; width: auto; }
	label.check span, label.check small { display: block; }
	.entity-list { display: grid; gap: .65rem; margin-top: .8rem; }
	.entity-list label { border: 1px solid var(--border); border-radius: .6rem; padding: .75rem; }
	.entity-list em { color: var(--primary); font-size: .68rem; font-style: normal; }
	@media (max-width: 760px) { .page-shell { padding: 1rem; } .page-heading { align-items: stretch; flex-direction: column; } .boundary-grid, .form-grid, .keyword-grid { grid-template-columns: 1fr; } .span-2 { grid-column: auto; } }
</style>
