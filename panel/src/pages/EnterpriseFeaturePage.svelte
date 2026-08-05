<script lang="ts">
	import { useTranslation } from '@svadmin/core/i18n';

	interface Props { resourceName: string; }

	const featureTitles: Record<string, string> = {
		users: 'elygate.users',
		'business-units': 'elygate.businessUnits',
		rbac: 'elygate.rbac',
		scim: 'elygate.scim',
		'access-profiles': 'elygate.accessProfiles',
		'audit-logs': 'elygate.auditLogs',
		alerting: 'elygate.alerting',
		guardrails: 'elygate.guardrails',
		cluster: 'elygate.cluster',
		'circuit-breaker': 'elygate.circuitBreaker',
		'adaptive-routing': 'elygate.adaptiveRouting',
	};

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	const titleKey = $derived(featureTitles[resourceName] ?? 'elygate.enterprise');
</script>

<section class="page-shell">
	<p class="eyebrow">Elygate / Enterprise</p>
	<h1>{i18n.t(titleKey)}</h1>
	<div class="panel">
		<p>{i18n.t('elygate.enterpriseFeatureHint')}</p>
		<div class="quick-links">
			<a href="/teams">{i18n.t('elygate.teams')}</a>
			<a href="/customers">{i18n.t('elygate.customers')}</a>
			<a href="/mcp-sessions">{i18n.t('elygate.mcpSessions')}</a>
			<a href="/routing-rules">{i18n.t('elygate.routingRules')}</a>
		</div>
	</div>
</section>

<style>
	.page-shell { max-width: 920px; margin: 0 auto; padding: 1.5rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .45rem; text-transform: uppercase; }
	h1 { margin: 0 0 1.25rem; font-size: clamp(1.5rem, 3vw, 2.15rem); }
	.panel { background: var(--card); border: 1px solid var(--border); border-radius: .9rem; padding: 1.25rem; }
	p { color: var(--muted-foreground); margin: 0; }
	.quick-links { display: flex; flex-wrap: wrap; gap: .6rem; margin-top: 1rem; }
	a { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); font-weight: 650; padding: .55rem .75rem; text-decoration: none; }
</style>
