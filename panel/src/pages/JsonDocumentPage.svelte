<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, parseJsonObject, prettyJson } from '../lib/forms';
	import { requestJson, type JsonRecord } from '../lib/api';

	interface Props { resourceName: string; }

	interface DocumentConfig {
		titleKey: string;
		eyebrow: string;
		getPath: string;
		putPath: string;
		resetPath?: string;
	}

	const configs: Record<string, DocumentConfig> = {
		config: {
			titleKey: 'elygate.config',
			eyebrow: 'Elygate / Bifrost Config',
			getPath: '/api/config',
			putPath: '/api/config',
		},
		'complexity-analyzer': {
			titleKey: 'elygate.complexityAnalyzer',
			eyebrow: 'Elygate / Governance',
			getPath: '/api/governance/complexity-analyzer-config',
			putPath: '/api/governance/complexity-analyzer-config',
			resetPath: '/api/governance/complexity-analyzer-config/reset',
		},
	};

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	const config = $derived(configs[resourceName] ?? configs.config);
	const title = $derived(i18n.t(config.titleKey));
	let value = $state('');
	let error = $state('');
	let notice = $state('');
	let isLoading = $state(true);
	let isSaving = $state(false);

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			value = prettyJson(await requestJson(config.getPath), '{}');
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	async function save(): Promise<void> {
		isSaving = true;
		error = '';
		try {
			const body: JsonRecord = parseJsonObject(value, title, i18n.t('elygate.invalidJson'));
			const response = await requestJson(config.putPath, { method: 'PUT', body: JSON.stringify(body) });
			value = prettyJson(response, '{}');
			notice = i18n.t('elygate.save');
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isSaving = false;
		}
	}

	async function reset(): Promise<void> {
		if (!config.resetPath || !window.confirm(i18n.t('elygate.confirmAction'))) return;
		isSaving = true;
		error = '';
		try {
			value = prettyJson(await requestJson(config.resetPath, { method: 'POST' }), '{}');
			notice = i18n.t('elygate.reset');
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isSaving = false;
		}
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		void save();
	}

	onMount(() => {
		void load();
	});
</script>

<section class="page-shell">
	<header class="page-heading">
		<div>
			<p class="eyebrow">{config.eyebrow}</p>
			<h1>{title}</h1>
			<p>{i18n.t('elygate.jsonDocumentHint')}</p>
		</div>
		<div class="heading-actions">
			<button class="primary" type="button" onclick={() => void load()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button>
			{#if config.resetPath}<button type="button" onclick={() => void reset()} disabled={isSaving}>{i18n.t('elygate.reset')}</button>{/if}
		</div>
	</header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<form onsubmit={submit}>
		<label>{i18n.t('elygate.requestJson')}<textarea bind:value rows="26" spellcheck="false" disabled={isLoading}></textarea></label>
		<footer><button class="primary" type="submit" disabled={isSaving || isLoading}>{i18n.t('elygate.save')}</button></footer>
	</form>
</section>

<style>
	.page-shell { max-width: 1180px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: flex-start; display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .45rem; text-transform: uppercase; }
	h1 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.15rem); }
	.page-heading p { color: var(--muted-foreground); margin: .55rem 0 0; max-width: 760px; }
	.heading-actions, footer { align-items: center; display: flex; gap: .5rem; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); cursor: pointer; font-weight: 600; padding: .55rem .75rem; white-space: nowrap; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button:disabled { cursor: wait; opacity: .55; }
	form { display: grid; gap: .85rem; }
	label { color: var(--foreground); display: grid; font-size: .85rem; font-weight: 650; gap: .35rem; }
	textarea { background: var(--background); border: 1px solid var(--border); border-radius: .65rem; color: var(--foreground); font: 0.8rem ui-monospace, SFMono-Regular, Menlo, monospace; padding: .85rem; resize: vertical; width: 100%; }
	.notice { border-radius: .65rem; margin-bottom: 1rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 12%, transparent); color: var(--primary); }
	footer { justify-content: flex-end; }
	@media (max-width: 760px) { .page-heading { align-items: stretch; flex-direction: column; } .heading-actions { width: 100%; } .heading-actions button { flex: 1; } }
</style>
