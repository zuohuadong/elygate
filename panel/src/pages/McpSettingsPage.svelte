<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getAppName } from '../lib/branding';
	import { displayError } from '../lib/forms';
	import { requestJson } from '../lib/api';
	import { configFormFromDocument, type ConfigForm } from '../lib/config-form';

	interface Props { resourceName: string; }
	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let config = $state<ConfigForm>(configFormFromDocument({}));
	let isLoading = $state(true);
	let error = $state('');
	const links = [
		['mcp-clients', 'elygate.mcpClients', 'server-cog'],
		['mcp-library', 'elygate.mcpLibrary', 'library'],
		['mcp-sessions', 'elygate.mcpSessions', 'monitor-dot'],
		['mcp-usage-guide', 'elygate.mcpUsageGuide', 'book-open-text'],
	] as const;

	function value(candidate: string | number | boolean): string {
		if (candidate === '') return '—';
		if (typeof candidate === 'boolean') return candidate ? (i18n.locale === 'zh-CN' ? '启用' : 'Enabled') : (i18n.locale === 'zh-CN' ? '停用' : 'Disabled');
		return String(candidate);
	}

	onMount(() => {
		void (async () => {
			try {
				config = configFormFromDocument(await requestJson('/api/config'));
			} catch (cause) {
				error = displayError(cause, i18n.t('elygate.loadFailed'));
			} finally {
				isLoading = false;
			}
		})();
	});
</script>

<section class="page-shell">
	<header class="page-heading"><div><p class="eyebrow">{getAppName()} / {i18n.t('elygate.mcp')}</p><h1>{i18n.t('elygate.mcpSettings')}</h1><p>{i18n.locale === 'zh-CN' ? '管理 MCP 客户端、服务目录和认证会话；网关运行参数请在系统设置中单独配置。' : 'Manage MCP clients, the server catalog, and authentication sessions. Gateway runtime parameters live in System settings.'}</p></div></header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	<div class="link-grid">{#each links as [route, label, _icon] (route)}<a href={`#/${route}`}><strong>{i18n.t(label)}</strong><span>{i18n.locale === 'zh-CN' ? '打开管理工作区' : 'Open workspace'} →</span></a>{/each}</div>
	<section class="settings-panel"><h2>{i18n.locale === 'zh-CN' ? '当前 MCP 运行参数' : 'Current MCP runtime settings'}</h2>{#if isLoading}<p>{i18n.t('elygate.loading')}</p>{:else}<dl><div><dt>{i18n.locale === 'zh-CN' ? '网关认证模式' : 'Gateway auth mode'}</dt><dd>{value(config.mcpServerAuthMode)}</dd></div><div><dt>{i18n.locale === 'zh-CN' ? '工具同步间隔（分钟）' : 'Tool sync interval (minutes)'}</dt><dd>{value(config.mcpToolSyncInterval)}</dd></div><div><dt>{i18n.locale === 'zh-CN' ? '工具执行超时（秒）' : 'Tool timeout (seconds)'}</dt><dd>{value(config.mcpToolExecutionTimeout)}</dd></div><div><dt>{i18n.locale === 'zh-CN' ? '临时令牌认证' : 'Temporary token auth'}</dt><dd>{value(config.mcpEnableTempTokenAuth)}</dd></div></dl>{/if}</section>
</section>

<style>
	.page-shell { display: grid; gap: 1rem; margin: 0 auto; max-width: 1100px; padding: 1.5rem; }
	.page-heading { display: flex; justify-content: space-between; }
	.eyebrow { color: var(--primary); font-size: .72rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .4rem; text-transform: uppercase; }
	h1, h2 { margin: 0; } .page-heading p { color: var(--muted-foreground); margin: .5rem 0 0; max-width: 760px; }
	.link-grid { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.link-grid a, .settings-panel { background: var(--card); border: 1px solid var(--border); border-radius: .7rem; padding: 1rem; }
	.link-grid a { color: var(--foreground); display: grid; gap: .35rem; text-decoration: none; } .link-grid span, dt { color: var(--muted-foreground); font-size: .82rem; }
	.settings-panel { display: grid; gap: .8rem; } dl { display: grid; gap: .6rem; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; } dt, dd { margin: 0; } dd { overflow-wrap: anywhere; }
	.notice { border-radius: .6rem; padding: .75rem 1rem; } .notice.error { background: color-mix(in oklch, var(--destructive) 12%, transparent); color: var(--destructive); }
	@media (max-width: 720px) { .link-grid, dl { grid-template-columns: 1fr; } .page-shell { padding: 1rem; } }
</style>
