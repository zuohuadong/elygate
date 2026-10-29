<script lang="ts">
	import type { ElygateLocale } from './i18n';
	import type { McpClientDraft } from './mcp-management';

	interface Props {
		kind: 'prompts' | 'resources';
		locale: ElygateLocale;
		mode: McpClientDraft['promptsExposure'];
		entries: string;
		disabled: boolean;
	}
	let { kind, locale, mode = $bindable(), entries = $bindable(), disabled }: Props = $props();
	const title = $derived(kind === 'prompts' ? (locale === 'zh-CN' ? '提示词暴露' : 'Prompt exposure') : (locale === 'zh-CN' ? '资源暴露' : 'Resource exposure'));
</script>

<section class="exposure-field">
	<label for={`mcp-${kind}-exposure`}>{title}</label>
	<select id={`mcp-${kind}-exposure`} bind:value={mode} {disabled}>
		<option value="all">{locale === 'zh-CN' ? '全部' : 'All'}</option>
		<option value="none">{locale === 'zh-CN' ? '全部拒绝' : 'None'}</option>
		<option value="list">{locale === 'zh-CN' ? '限定名单' : 'Allowlist'}</option>
	</select>
	{#if mode === 'list'}
		<label for={`mcp-${kind}-entries`}>{kind === 'prompts' ? (locale === 'zh-CN' ? '原始提示词名称 / RE2 规则（JSON 数组）' : 'Original prompt names / RE2 rules (JSON array)') : (locale === 'zh-CN' ? '资源 URI / URI 模板 / RE2 规则（JSON 数组）' : 'Resource URIs / URI templates / RE2 rules (JSON array)')}</label>
		<textarea id={`mcp-${kind}-entries`} rows="5" bind:value={entries} {disabled} spellcheck="false"></textarea>
	{/if}
</section>

<style>
	.exposure-field { border-top: 1px solid var(--border); display: grid; gap: .5rem; min-width: 0; padding-top: .8rem; }
	label { color: var(--foreground); font-size: .8rem; }
	select, textarea { background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); font: inherit; min-width: 0; padding: .6rem .7rem; width: 100%; }
	select { min-height: 44px; }
	textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem; overflow-wrap: anywhere; resize: vertical; }
</style>
