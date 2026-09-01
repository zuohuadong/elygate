<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getListPayload, requestJson, type JsonRecord } from '../lib/api';
	import { displayError, parseJsonObject, prettyJson } from '../lib/forms';

	interface Props { resourceName: string; }
	interface ConnectorDefinition { id: string; pluginName: string; label: string; description: string; available: boolean; }
	interface Plugin extends JsonRecord { name: string; actualName?: string; enabled?: boolean; config?: JsonRecord; status?: unknown; }

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	const connectors: ConnectorDefinition[] = [
		{ id: 'otel', pluginName: 'otel', label: 'OpenTelemetry', description: 'OTLP traces and metrics', available: true },
		{ id: 'prometheus', pluginName: 'telemetry', label: 'Prometheus', description: 'Prometheus metrics endpoint', available: true },
		{ id: 'maxim', pluginName: 'maxim', label: 'Maxim', description: 'LLM observability export', available: true },
		// Keep connectors visible as roadmap entries, but do not let the panel
		// create database records for plugins that the runtime cannot load.
		{ id: 'datadog', pluginName: 'datadog', label: 'Datadog', description: 'APM and metrics export', available: false },
		{ id: 'bigquery', pluginName: 'bigquery', label: 'BigQuery', description: 'Warehouse log export', available: false },
		{ id: 'kafka', pluginName: 'kafka', label: 'Kafka', description: 'Streaming event export', available: false },
		{ id: 'pubsub', pluginName: 'pubsub', label: 'Pub/Sub', description: 'Google Cloud Pub/Sub export', available: false },
		{ id: 'newrelic', pluginName: 'newrelic', label: 'New Relic', description: 'APM export', available: false },
	];

	let plugins = $state.raw<Plugin[]>([]);
	let selectedId = $state('otel');
	let enabled = $state(false);
	let configJson = $state('{}');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let error = $state('');
	let notice = $state('');
	const selectedDefinition = $derived(connectors.find((connector) => connector.id === selectedId) ?? connectors[0]);
	const selectedPlugin = $derived(plugins.find((plugin) => plugin.name === selectedDefinition.pluginName || plugin.actualName === selectedDefinition.pluginName));

	function selectConnector(id: string): void {
		selectedId = id;
		const definition = connectors.find((connector) => connector.id === id) ?? connectors[0];
		const plugin = plugins.find((item) => item.name === definition.pluginName || item.actualName === definition.pluginName);
		enabled = plugin?.enabled === true;
		configJson = prettyJson(plugin?.config ?? {}, '{}');
		error = '';
		notice = '';
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const payload = await requestJson<unknown>('/api/plugins');
			plugins = getListPayload(payload).filter((value): value is Plugin => typeof value.name === 'string');
			selectConnector(selectedId);
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	async function save(): Promise<void> {
		if (!selectedDefinition.available || isSaving) return;
		isSaving = true;
		error = '';
		notice = '';
		try {
			const config = parseJsonObject(configJson, i18n.t('elygate.connectorConfig'), i18n.t('elygate.invalidJson'));
			const path = `/api/plugins/${encodeURIComponent(selectedDefinition.pluginName)}`;
			if (selectedPlugin) {
				await requestJson<unknown>(path, { method: 'PUT', body: JSON.stringify({ enabled, path: selectedPlugin.path ?? null, config, placement: selectedPlugin.placement ?? null, order: selectedPlugin.order ?? null }) });
			} else {
				await requestJson<unknown>('/api/plugins', { method: 'POST', body: JSON.stringify({ name: selectedDefinition.pluginName, enabled, path: null, config, placement: null, order: null }) });
			}
			await load();
			notice = i18n.t('elygate.connectorSaved');
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.saveFailed'));
		} finally {
			isSaving = false;
		}
	}

	onMount(() => { void load(); });
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading"><div><p class="eyebrow">{getAppName()} / {i18n.t('elygate.observability')}</p><h1>{i18n.t('elygate.connectors')}</h1><p>{i18n.t('elygate.connectorsHint')}</p></div><button type="button" onclick={() => void load()}>{i18n.t('elygate.refresh')}</button></header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<div class="workspace" aria-busy={isLoading}>
		<nav aria-label={i18n.t('elygate.connectors')}>
			{#each connectors as connector (connector.id)}
				<button type="button" class:is-active={selectedId === connector.id} disabled={!connector.available} onclick={() => selectConnector(connector.id)}><span class="connector-icon">{connector.label.slice(0, 2).toUpperCase()}</span><span><strong>{connector.label}</strong><small>{connector.description}</small></span>{#if !connector.available}<em>{i18n.t('elygate.comingSoon')}</em>{:else if plugins.some((plugin) => (plugin.name === connector.pluginName || plugin.actualName === connector.pluginName) && plugin.enabled)}<em class="active">{i18n.t('elygate.enabled')}</em>{/if}</button>
			{/each}
		</nav>
		<main>
			<header><div><h2>{selectedDefinition.label}</h2><p>{selectedDefinition.description}</p></div><label class="switch"><input type="checkbox" bind:checked={enabled} disabled={!selectedDefinition.available} /><span>{enabled ? i18n.t('elygate.enabled') : i18n.t('elygate.disabled')}</span></label></header>
			<div class="status"><span>{i18n.t('elygate.runtimeStatus')}</span><code>{selectedPlugin ? prettyJson(selectedPlugin.status ?? 'configured', 'configured') : i18n.t('elygate.notConfigured')}</code></div>
			<label class="config-label"><span>{i18n.t('elygate.connectorConfig')}</span><small>{i18n.t('elygate.connectorConfigHint')}</small><textarea bind:value={configJson} rows="20" spellcheck="false" disabled={!selectedDefinition.available}></textarea></label>
			<footer><button class="primary" type="button" onclick={() => void save()} disabled={!selectedDefinition.available || isSaving}>{isSaving ? i18n.t('elygate.saving') : i18n.t('elygate.save')}</button></footer>
		</main>
	</div>
</section>

<style>
	.page-shell { max-width: 1180px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: start; display: flex; gap: 1rem; justify-content: space-between; margin-bottom: 1rem; }
	.page-heading h1 { margin: 0; }
	.page-heading p { color: var(--muted-foreground); margin: .55rem 0 0; max-width: 720px; }
	.eyebrow { color: var(--primary) !important; font-size: .75rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
	button, textarea { border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); font: inherit; }
	button { background: var(--muted); cursor: pointer; padding: .55rem .7rem; }
	button:disabled { cursor: not-allowed; opacity: .55; }
	.workspace { display: grid; gap: 1rem; grid-template-columns: 280px 1fr; }
	nav { display: grid; gap: .45rem; }
	nav button { align-items: center; background: var(--card); display: grid; gap: .65rem; grid-template-columns: auto 1fr auto; padding: .7rem; text-align: left; }
	nav button.is-active { border-color: var(--primary); box-shadow: inset 3px 0 var(--primary); }
	nav button span:nth-child(2) { display: grid; gap: .18rem; }
	nav small { color: var(--muted-foreground); font-size: .7rem; }
	nav em { color: var(--muted-foreground); font-size: .62rem; font-style: normal; text-transform: uppercase; }
	nav em.active { color: var(--primary); }
	.connector-icon { align-items: center; background: color-mix(in oklch, var(--primary) 12%, transparent); border-radius: .45rem; color: var(--primary); display: flex; font-size: .7rem; font-weight: 800; height: 2rem; justify-content: center; width: 2rem; }
	main { background: var(--card); border: 1px solid var(--border); border-radius: .85rem; padding: 1rem; }
	main > header { align-items: center; display: flex; justify-content: space-between; }
	main h2 { margin: 0; }
	main header p { color: var(--muted-foreground); font-size: .8rem; margin: .35rem 0 0; }
	.switch { align-items: center; display: flex; gap: .45rem; }
	.status { background: var(--muted); border-radius: .55rem; display: grid; gap: .35rem; margin: 1rem 0; padding: .7rem; }
	.status span, .config-label > span { font-size: .78rem; font-weight: 700; }
	.status code { color: var(--muted-foreground); font-size: .72rem; max-height: 6rem; overflow: auto; white-space: pre-wrap; }
	.config-label { display: grid; gap: .35rem; }
	.config-label small { color: var(--muted-foreground); }
	textarea { background: var(--background); font-family: ui-monospace, monospace; font-size: .78rem; line-height: 1.5; padding: .75rem; resize: vertical; }
	footer { display: flex; justify-content: end; margin-top: .8rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	.notice { border-radius: .65rem; margin-bottom: .8rem; padding: .75rem 1rem; }
	.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.success { background: color-mix(in oklch, var(--primary) 10%, transparent); color: var(--primary); }
	@media (max-width: 760px) { .workspace { grid-template-columns: 1fr; } nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 520px) { .page-heading { flex-direction: column; } nav { grid-template-columns: 1fr; } }
</style>
