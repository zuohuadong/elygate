<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError } from '../lib/forms';
	import { getListPayload, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';

	interface Props { resourceName: string; }
	type CacheMode = 'direct' | 'semantic';
	interface CacheForm {
		ttl: number;
		threshold: number;
		dimension: number;
		conversationHistoryThreshold: number;
		excludeSystemPrompt: boolean;
		cacheByModel: boolean;
		cacheByProvider: boolean;
		provider: string;
		embeddingModel: string;
		vectorStoreNamespace: string;
		defaultCacheKey: string;
	}

	const PLUGIN_NAME = 'semantic_cache';
	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let plugin = $state.raw<JsonRecord | null>(null);
	let providers = $state.raw<JsonRecord[]>([]);
	let mode = $state<CacheMode>('direct');
	let form = $state<CacheForm>(defaults());
	let cacheId = $state('');
	let cacheKey = $state('');
	let vectorStoreConnected = $state(false);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let error = $state('');
	let notice = $state('');

	function defaults(): CacheForm {
		return { ttl: 300, threshold: .8, dimension: 1, conversationHistoryThreshold: 3, excludeSystemPrompt: false, cacheByModel: true, cacheByProvider: true, provider: '', embeddingModel: '', vectorStoreNamespace: '', defaultCacheKey: '' };
	}

	function numberValue(record: JsonRecord, key: string, fallback: number): number {
		return typeof record[key] === 'number' ? Number(record[key]) : fallback;
	}

	function boolValue(record: JsonRecord, key: string, fallback: boolean): boolean {
		return typeof record[key] === 'boolean' ? Boolean(record[key]) : fallback;
	}

	function stringValue(record: JsonRecord, key: string): string {
		return typeof record[key] === 'string' ? String(record[key]) : '';
	}

	function applyConfig(config: JsonRecord): void {
		form = {
			ttl: numberValue(config, 'ttl', 300),
			threshold: numberValue(config, 'threshold', .8),
			dimension: numberValue(config, 'dimension', 1),
			conversationHistoryThreshold: numberValue(config, 'conversation_history_threshold', 3),
			excludeSystemPrompt: boolValue(config, 'exclude_system_prompt', false),
			cacheByModel: boolValue(config, 'cache_by_model', true),
			cacheByProvider: boolValue(config, 'cache_by_provider', true),
			provider: stringValue(config, 'provider'),
			embeddingModel: stringValue(config, 'embedding_model'),
			vectorStoreNamespace: stringValue(config, 'vector_store_namespace'),
			defaultCacheKey: stringValue(config, 'default_cache_key'),
		};
		mode = form.dimension > 1 && form.provider ? 'semantic' : 'direct';
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const [pluginPayload, providerPayload, configPayload] = await Promise.all([
				requestJson('/api/plugins'),
				requestJson('/api/providers'),
				requestJson<JsonRecord>('/api/config'),
			]);
			plugin = getListPayload(pluginPayload).find((item) => item.name === PLUGIN_NAME) ?? null;
			providers = getListPayload(providerPayload);
			vectorStoreConnected = configPayload.is_cache_connected === true;
			applyConfig(plugin && isJsonRecord(plugin.config) ? plugin.config : {});
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	function payload(): JsonRecord {
		if (form.ttl < 0) throw new Error(i18n.t('elygate.cacheTtlInvalid'));
		if (form.threshold < 0 || form.threshold > 1) throw new Error(i18n.t('elygate.cacheThresholdInvalid'));
		if (form.conversationHistoryThreshold < 1 || form.conversationHistoryThreshold > 50) throw new Error(i18n.t('elygate.cacheHistoryInvalid'));
		const base: JsonRecord = {
			ttl: form.ttl,
			threshold: form.threshold,
			conversation_history_threshold: form.conversationHistoryThreshold,
			exclude_system_prompt: form.excludeSystemPrompt,
			cache_by_model: form.cacheByModel,
			cache_by_provider: form.cacheByProvider,
			vector_store_namespace: form.vectorStoreNamespace.trim() || undefined,
			default_cache_key: form.defaultCacheKey.trim() || undefined,
		};
		if (mode === 'direct') return { ...base, dimension: 1 };
		if (!form.provider || !form.embeddingModel.trim() || form.dimension <= 1) throw new Error(i18n.t('elygate.semanticCacheRequired'));
		return { ...base, provider: form.provider, embedding_model: form.embeddingModel.trim(), dimension: form.dimension };
	}

	async function save(enabled = plugin?.enabled === true): Promise<void> {
		isSaving = true;
		error = '';
		notice = '';
		try {
			const body = { enabled, config: payload(), path: plugin?.path ?? null, placement: plugin?.placement ?? null, order: plugin?.order ?? null };
			if (plugin) {
				plugin = await requestJson<JsonRecord>(`/api/plugins/${PLUGIN_NAME}`, { method: 'PUT', body: JSON.stringify(body) });
			} else {
				plugin = await requestJson<JsonRecord>('/api/plugins', { method: 'POST', body: JSON.stringify({ name: PLUGIN_NAME, ...body }) });
			}
			applyConfig(isJsonRecord(plugin.config) ? plugin.config : {});
			notice = i18n.t('elygate.saveSuccess');
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isSaving = false;
		}
	}

	async function clearCache(kind: 'id' | 'key'): Promise<void> {
		const value = (kind === 'id' ? cacheId : cacheKey).trim();
		if (!value || !window.confirm(i18n.t('elygate.confirmAction'))) return;
		try {
			await requestJson(`/api/cache/${kind === 'id' ? 'clear' : 'clear-by-key'}/${encodeURIComponent(value)}`, { method: 'DELETE' });
			notice = i18n.t('elygate.cacheCleared');
			if (kind === 'id') cacheId = ''; else cacheKey = '';
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
	}

	onMount(() => { void load(); });
</script>

<section class="page-shell">
	<header class="page-heading"><div><p class="eyebrow">Elygate / Plugins</p><h1>{i18n.t('elygate.cachingConfig')}</h1><p>{i18n.t('elygate.cachingHint')}</p></div><div class="toggle"><span>{plugin?.enabled === true ? i18n.t('elygate.enabled') : i18n.t('elygate.disabled')}</span><button type="button" onclick={() => void save(plugin?.enabled !== true)} disabled={isSaving || (!vectorStoreConnected && plugin?.enabled !== true)}>{plugin?.enabled === true ? i18n.t('elygate.disable') : i18n.t('elygate.enable')}</button></div></header>
	{#if !vectorStoreConnected}<div class="notice warning">{i18n.t('elygate.vectorStoreRequired')}</div>{/if}{#if error}<div class="notice error" role="alert">{error}</div>{/if}{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<form onsubmit={(event) => { event.preventDefault(); void save(); }}>
		<div class="mode-picker"><button type="button" class:is-active={mode === 'direct'} onclick={() => (mode = 'direct')}>{i18n.t('elygate.directCache')}</button><button type="button" class:is-active={mode === 'semantic'} onclick={() => (mode = 'semantic')}>{i18n.t('elygate.semanticCache')}</button></div>
		<div class="form-grid">
			{#if mode === 'semantic'}<label>{i18n.t('elygate.provider')}<select bind:value={form.provider}><option value="">{i18n.t('elygate.selectProvider')}</option>{#each providers as item (String(item.name))}<option value={String(item.name)}>{String(item.name)}</option>{/each}</select></label><label>{i18n.t('elygate.embeddingModel')}<input bind:value={form.embeddingModel} /></label><label>{i18n.t('elygate.embeddingDimension')}<input type="number" min="2" bind:value={form.dimension} /></label>{/if}
			<label>{i18n.t('elygate.cacheTtl')}<input type="number" min="0" bind:value={form.ttl} /></label><label>{i18n.t('elygate.similarityThreshold')}<input type="number" min="0" max="1" step="0.01" bind:value={form.threshold} /></label><label>{i18n.t('elygate.conversationThreshold')}<input type="number" min="1" max="50" bind:value={form.conversationHistoryThreshold} /></label><label>{i18n.t('elygate.vectorNamespace')}<input bind:value={form.vectorStoreNamespace} /></label><label>{i18n.t('elygate.defaultCacheKey')}<input bind:value={form.defaultCacheKey} /></label>
		</div>
		<div class="switches"><label><input type="checkbox" bind:checked={form.excludeSystemPrompt} />{i18n.t('elygate.excludeSystemPrompt')}</label><label><input type="checkbox" bind:checked={form.cacheByModel} />{i18n.t('elygate.cacheByModel')}</label><label><input type="checkbox" bind:checked={form.cacheByProvider} />{i18n.t('elygate.cacheByProvider')}</label></div>
		<footer><button class="primary" type="submit" disabled={isSaving || isLoading}>{i18n.t('elygate.save')}</button></footer>
	</form>
	<section class="cache-tools"><h2>{i18n.t('elygate.cacheManagement')}</h2><p>{i18n.t('elygate.cacheManagementHint')}</p><div><input bind:value={cacheId} placeholder={i18n.t('elygate.cacheId')} /><button type="button" onclick={() => void clearCache('id')}>{i18n.t('elygate.clear')}</button></div><div><input bind:value={cacheKey} placeholder={i18n.t('elygate.cacheKey')} /><button type="button" onclick={() => void clearCache('key')}>{i18n.t('elygate.clear')}</button></div></section>
</section>

<style>
	.page-shell { max-width: 980px; margin: 0 auto; padding: 1.5rem; }
	.page-heading, .toggle, footer, .mode-picker, .switches, .cache-tools > div { align-items: center; display: flex; gap: .55rem; }
	.page-heading { align-items: start; justify-content: space-between; margin-bottom: 1rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .4rem; text-transform: uppercase; }
	h1 { margin: 0; } .page-heading p, .cache-tools p { color: var(--muted-foreground); margin: .5rem 0 0; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); cursor: pointer; font-weight: 650; padding: .55rem .7rem; }
	button.primary, button.is-active { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	form, .cache-tools { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; display: grid; gap: 1rem; padding: 1rem; }
	.form-grid { display: grid; gap: .7rem; grid-template-columns: repeat(3, minmax(0, 1fr)); }
	label { display: grid; font-size: .8rem; font-weight: 650; gap: .35rem; }
	input, select { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); padding: .6rem; }
	.switches { align-items: start; flex-wrap: wrap; }
	.switches label { align-items: center; display: flex; }
	footer { justify-content: flex-end; }
	.cache-tools { margin-top: 1rem; }
	.cache-tools h2 { font-size: 1rem; margin: 0; }
	.cache-tools input { flex: 1; }
	.notice { border-radius: .65rem; margin-bottom: .8rem; padding: .7rem .85rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 12%, transparent); color: var(--primary); }
	.notice.warning { background: color-mix(in oklch, #d97706 12%, transparent); color: #b45309; }
	@media (max-width: 760px) { .page-heading { flex-direction: column; } .form-grid { grid-template-columns: 1fr 1fr; } }
	@media (max-width: 520px) { .form-grid { grid-template-columns: 1fr; } }
</style>
