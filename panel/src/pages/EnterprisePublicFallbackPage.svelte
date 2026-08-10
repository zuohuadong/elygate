<script lang="ts">
	import type { PublicPanelRoute } from '../lib/public-routes';

	interface Props { route: PublicPanelRoute; }
	let { route }: Props = $props();
	const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
	const title = $derived(route === 'agent-handover'
		? (zh ? 'Agent 交接需要企业扩展' : 'Agent handover requires the enterprise extension')
		: (zh ? 'SCIM OAuth 回调需要企业扩展' : 'SCIM OAuth callback requires the enterprise extension'));
	const hint = zh
		? '当前 OSS 面板不会猜测私有 API。请在企业面板模块中实现此公开页面，或从企业功能入口重新发起流程。'
		: 'The OSS panel does not invent private API contracts. Provide this public page from the enterprise panel module or restart the flow from the enterprise feature.';
</script>

<main><section><div>!</div><h1>{title}</h1><p>{hint}</p><a href="/">{zh ? '返回控制台' : 'Back to console'}</a></section></main>

<style>
	:global(body) { margin: 0; }
	main { align-items: center; background: var(--background); color: var(--foreground); display: flex; justify-content: center; min-height: 100vh; padding: 1rem; }
	section { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; max-width: 34rem; padding: 2rem; text-align: center; }
	section > div { align-items: center; background: color-mix(in oklch, var(--primary) 14%, transparent); border-radius: 999px; color: var(--primary); display: flex; font-size: 1.3rem; font-weight: 800; height: 3.4rem; justify-content: center; margin: 0 auto 1rem; width: 3.4rem; }
	h1 { font-size: 1.3rem; margin: 0; }
	p { color: var(--muted-foreground); font-size: .88rem; line-height: 1.6; }
	a { background: var(--primary); border-radius: .55rem; color: var(--primary-foreground); display: inline-block; font-weight: 700; padding: .65rem .85rem; text-decoration: none; }
</style>
