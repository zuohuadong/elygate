<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, parseJsonObject, prettyJson, csv } from '../lib/forms';
	import { encodePathSegment, getListPayload, requestJson, type JsonRecord } from '../lib/api';
	import {
		hasOpenAIBaseURLVersionConflict,
		isMissingProviderKeyError,
		keyAdvancedForForm,
		providerKeyModelAccess,
		providerKeyModelsForPayload,
		unsupportedProviderConfigFields,
		type ProviderConfigSection,
	} from '../lib/resource-forms';

	type Modal = 'create' | 'edit' | 'keys' | null;
	interface Props { resourceName: string; }

	interface ProviderForm {
		name: string;
		network: string;
		concurrency: string;
		bufferSize: string;
		proxy: string;
		custom: string;
		openai: string;
		sendBackRequest: boolean;
		sendBackResponse: boolean;
		storeRaw: boolean;
	}

	interface KeyForm {
		name: string;
		value: string;
		models: string;
		blacklistedModels: string;
		weight: string;
		enabled: boolean;
		advanced: string;
	}

	function emptyProviderForm(): ProviderForm {
		return {
			name: '',
			network: '',
			concurrency: '10',
			bufferSize: '100',
			proxy: '',
			custom: '',
			openai: '',
			sendBackRequest: false,
			sendBackResponse: false,
			storeRaw: false,
		};
	}

	function emptyKeyForm(): KeyForm {
		return { name: '', value: '', models: '', blacklistedModels: '', weight: '1', enabled: true, advanced: '' };
	}

	function stringValue(record: JsonRecord, key: string): string {
		return typeof record[key] === 'string' ? String(record[key]) : '';
	}

	function numberValue(record: JsonRecord, key: string, fallback: number): string {
		return typeof record[key] === 'number' ? String(record[key]) : String(fallback);
	}

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let providers = $state.raw<JsonRecord[]>([]);
	let keys = $state.raw<JsonRecord[]>([]);
	let modal = $state<Modal>(null);
	let selectedProvider = $state('');
	let editingKey = $state<JsonRecord | null>(null);
	let providerForm = $state<ProviderForm>(emptyProviderForm());
	let keyForm = $state<KeyForm>(emptyKeyForm());
	let isLoading = $state(true);
	let isSaving = $state(false);
	let revalidatingKeyId = $state('');
	let deletingKeyId = $state('');
	let error = $state('');
	let notice = $state('');
	let warning = $state('');

	async function loadProviders(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			providers = getListPayload(await requestJson('/api/providers'));
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	async function loadKeys(): Promise<void> {
		if (!selectedProvider) return;
		error = '';
		try {
			keys = getListPayload(await requestJson(`/api/providers/${encodePathSegment(selectedProvider)}/keys`));
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		}
	}

	function openCreate(): void {
		providerForm = emptyProviderForm();
		notice = '';
		error = '';
		warning = '';
		modal = 'create';
	}

	function openEdit(provider: JsonRecord): void {
		providerForm = {
			name: stringValue(provider, 'name'),
			network: prettyJson(provider.network_config),
			concurrency: numberValue((provider.concurrency_and_buffer_size as JsonRecord | undefined) ?? {}, 'concurrency', 10),
			bufferSize: numberValue((provider.concurrency_and_buffer_size as JsonRecord | undefined) ?? {}, 'buffer_size', 100),
			proxy: prettyJson(provider.proxy_config),
			custom: prettyJson(provider.custom_provider_config),
			openai: prettyJson(provider.openai_config),
			sendBackRequest: provider.send_back_raw_request === true,
			sendBackResponse: provider.send_back_raw_response === true,
			storeRaw: provider.store_raw_request_response === true,
		};
		notice = '';
		error = '';
		warning = '';
		modal = 'edit';
	}

	function assertSupportedFields(section: ProviderConfigSection, value: JsonRecord, label: string): void {
		const fields = unsupportedProviderConfigFields(section, value);
		if (!fields.length) return;
		throw new Error(i18n.t('elygate.providerFieldsUnsupported')
			.replace('{section}', label)
			.replace('{fields}', fields.join(', ')));
	}

	async function saveProvider(): Promise<void> {
		isSaving = true;
		error = '';
		try {
			const invalidJson = i18n.t('elygate.invalidJson');
			const network = parseJsonObject(providerForm.network, i18n.t('elygate.networkConfig'), invalidJson);
			const proxy = parseJsonObject(providerForm.proxy, i18n.t('elygate.proxyConfig'), invalidJson);
			const custom = parseJsonObject(providerForm.custom, i18n.t('elygate.customConfig'), invalidJson);
			const openai = parseJsonObject(providerForm.openai, i18n.t('elygate.openaiConfig'), invalidJson);
			assertSupportedFields('network', network, i18n.t('elygate.networkConfig'));
			assertSupportedFields('proxy', proxy, i18n.t('elygate.proxyConfig'));
			assertSupportedFields('custom', custom, i18n.t('elygate.customConfig'));
			assertSupportedFields('openai', openai, i18n.t('elygate.openaiConfig'));
			if (hasOpenAIBaseURLVersionConflict(network, custom)) throw new Error(i18n.t('elygate.baseUrlV1Conflict'));
			if (!providerForm.name.trim()) throw new Error(i18n.t('elygate.required').replace('{field}', i18n.t('elygate.providerName')));
			const payload: JsonRecord = {
				network_config: Object.keys(network).length ? network : undefined,
				concurrency_and_buffer_size: {
					concurrency: Number(providerForm.concurrency),
					buffer_size: Number(providerForm.bufferSize),
				},
				proxy_config: Object.keys(proxy).length ? proxy : undefined,
				custom_provider_config: Object.keys(custom).length ? custom : undefined,
				openai_config: Object.keys(openai).length ? openai : undefined,
				send_back_raw_request: providerForm.sendBackRequest,
				send_back_raw_response: providerForm.sendBackResponse,
				store_raw_request_response: providerForm.storeRaw,
			};
			if (modal === 'create') {
				await requestJson('/api/providers', { method: 'POST', body: JSON.stringify({ provider: providerForm.name.trim(), ...payload }) });
			} else {
				await requestJson(`/api/providers/${encodePathSegment(providerForm.name)}`, { method: 'PUT', body: JSON.stringify(payload) });
			}
			modal = null;
			warning = '';
			notice = i18n.t('elygate.save');
			await loadProviders();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isSaving = false;
		}
	}

	async function removeProvider(provider: JsonRecord): Promise<void> {
		const name = stringValue(provider, 'name');
		if (!name || !window.confirm(i18n.t('elygate.confirmDelete'))) return;
		error = '';
		try {
			await requestJson(`/api/providers/${encodePathSegment(name)}`, { method: 'DELETE' });
			notice = i18n.t('elygate.delete');
			await loadProviders();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		}
	}

	async function openKeys(provider: JsonRecord): Promise<void> {
		selectedProvider = stringValue(provider, 'name');
		editingKey = null;
		keyForm = emptyKeyForm();
		modal = 'keys';
		error = '';
		const providerStatus = stringValue(provider, 'provider_status');
		const reason = stringValue(provider, 'description') || providerStatus || i18n.t('elygate.operationFailed');
		warning = providerStatus === 'active'
			? ''
			: i18n.t('elygate.providerNeedsAttention').replace('{provider}', selectedProvider).replace('{reason}', reason);
		await loadKeys();
	}

	function editKey(key: JsonRecord): void {
		editingKey = key;
		keyForm = {
			name: stringValue(key, 'name'),
			value: '',
			models: Array.isArray(key.models) ? key.models.map(String).join(', ') : '',
			blacklistedModels: Array.isArray(key.blacklisted_models) ? key.blacklisted_models.map(String).join(', ') : '',
			weight: numberValue(key, 'weight', 1),
			enabled: key.enabled !== false,
			advanced: prettyJson(keyAdvancedForForm(key), '{}'),
		};
	}

	async function saveKey(): Promise<void> {
		if (!selectedProvider || !keyForm.name.trim()) return;
		isSaving = true;
		error = '';
		try {
			const advanced = parseJsonObject(keyForm.advanced, i18n.t('elygate.advancedJson'), i18n.t('elygate.invalidJson'));
			const payload: JsonRecord = {
				...advanced,
				name: keyForm.name.trim(),
				models: providerKeyModelsForPayload(keyForm.models),
				blacklisted_models: csv(keyForm.blacklistedModels),
				weight: Number(keyForm.weight),
				enabled: keyForm.enabled,
			};
			if (keyForm.value.trim()) payload.value = { value: keyForm.value.trim() };
			else if (editingKey?.value !== undefined) payload.value = editingKey.value;
			else throw new Error(i18n.t('elygate.keyValueHelp'));
			if (editingKey) {
				await requestJson(`/api/providers/${encodePathSegment(selectedProvider)}/keys/${encodePathSegment(stringValue(editingKey, 'id'))}`, {
					method: 'PUT',
					body: JSON.stringify(payload),
				});
			} else {
				await requestJson(`/api/providers/${encodePathSegment(selectedProvider)}/keys`, { method: 'POST', body: JSON.stringify(payload) });
			}
			editingKey = null;
			keyForm = emptyKeyForm();
			notice = i18n.t('elygate.save');
			await loadKeys();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isSaving = false;
		}
	}

	async function removeKey(key: JsonRecord): Promise<void> {
		const id = stringValue(key, 'id');
		if (!selectedProvider || !id || !window.confirm(i18n.t('elygate.confirmDelete'))) return;
		deletingKeyId = id;
		error = '';
		try {
			await requestJson(`/api/providers/${encodePathSegment(selectedProvider)}/keys/${encodePathSegment(id)}`, { method: 'DELETE' });
			if (stringValue(editingKey ?? {}, 'id') === id) {
				editingKey = null;
				keyForm = emptyKeyForm();
			}
			notice = i18n.t('elygate.delete');
			await loadKeys();
		} catch (cause) {
			if (isMissingProviderKeyError(cause)) {
				editingKey = null;
				keyForm = emptyKeyForm();
				notice = i18n.t('elygate.keyAlreadyRemoved');
				await loadKeys();
				return;
			}
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			deletingKeyId = '';
		}
	}

	async function revalidateKey(key: JsonRecord): Promise<void> {
		const id = stringValue(key, 'id');
		if (!selectedProvider || !id) return;
		revalidatingKeyId = id;
		error = '';
		try {
			const payload: JsonRecord = {
				...keyAdvancedForForm(key),
				name: stringValue(key, 'name'),
				models: providerKeyModelsForPayload(Array.isArray(key.models) ? key.models.map(String).join(',') : ''),
				blacklisted_models: Array.isArray(key.blacklisted_models) ? key.blacklisted_models : [],
				weight: typeof key.weight === 'number' ? key.weight : 1,
				enabled: key.enabled !== false,
			};
			if (key.value !== undefined) payload.value = key.value;
			await requestJson(`/api/providers/${encodePathSegment(selectedProvider)}/keys/${encodePathSegment(id)}`, {
				method: 'PUT',
				body: JSON.stringify(payload),
			});
			notice = i18n.t('elygate.keyRevalidated');
			await loadKeys();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			revalidatingKeyId = '';
		}
	}

	function keyModelsLabel(key: JsonRecord): string {
		const access = providerKeyModelAccess(key.models);
		if (access === 'all') return i18n.t('elygate.allModels');
		if (access === 'none') return i18n.t('elygate.modelsNotConfigured');
		return (key.models as unknown[]).map(String).join(', ');
	}

	function submitProvider(event: SubmitEvent): void { event.preventDefault(); void saveProvider(); }
	function submitKey(event: SubmitEvent): void { event.preventDefault(); void saveKey(); }

	onMount(() => { void loadProviders(); });
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading">
		<div><p class="eyebrow">Elygate / Bifrost API</p><h1>{i18n.t('elygate.providers')}</h1><p>{i18n.t('elygate.providerNameHelp')}</p></div>
		<div class="heading-actions"><button class="primary" type="button" onclick={() => void loadProviders()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button><button class="primary" type="button" onclick={openCreate}>{i18n.t('elygate.create')}</button></div>
	</header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if warning}<div class="notice warning" role="status">{warning}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	<div class="table-wrap" aria-busy={isLoading}>
		<table><thead><tr><th>{i18n.t('elygate.providerName')}</th><th>{i18n.t('elygate.status')}</th><th>{i18n.t('elygate.baseUrl')}</th><th>{i18n.t('elygate.actions')}</th></tr></thead>
		<tbody>
		{#each providers as provider (stringValue(provider, 'name'))}
				<tr><td><strong>{stringValue(provider, 'name')}</strong></td><td title={stringValue(provider, 'description')}>{stringValue(provider, 'provider_status') || '—'}</td><td>{stringValue((provider.network_config as JsonRecord | undefined) ?? {}, 'base_url') || '—'}</td><td class="actions"><button type="button" onclick={() => openEdit(provider)}>{i18n.t('elygate.edit')}</button><button type="button" onclick={() => void openKeys(provider)}>{i18n.t('elygate.manageKeys')}</button><button class="danger" type="button" onclick={() => void removeProvider(provider)}>{i18n.t('elygate.delete')}</button></td></tr>
		{:else}<tr><td colspan="4" class="empty">{i18n.t('elygate.noResults')}</td></tr>{/each}
		</tbody></table>
	</div>
</section>

{#if modal === 'create' || modal === 'edit'}
	<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title"><header><h2 id="provider-dialog-title">{modal === 'create' ? i18n.t('elygate.create') : i18n.t('elygate.edit')} {i18n.t('elygate.providers')}</h2><button type="button" onclick={() => (modal = null)}>{i18n.t('elygate.close')}</button></header>
		<form onsubmit={submitProvider}><div class="form-hint" role="note">{i18n.t('elygate.apiKeySeparateHint')}</div><label>{i18n.t('elygate.providerName')}<input bind:value={providerForm.name} required disabled={modal === 'edit'} /><small>{i18n.t('elygate.providerNameHelp')}</small></label>
			<div class="grid-two"><label>{i18n.t('elygate.concurrency')}<input type="number" min="1" bind:value={providerForm.concurrency} /></label><label>{i18n.t('elygate.bufferSize')}<input type="number" min="1" bind:value={providerForm.bufferSize} /></label></div>
				<label>{i18n.t('elygate.networkConfig')}<textarea bind:value={providerForm.network} rows="5"></textarea><small>{i18n.t('elygate.providerNetworkHint')}</small></label><label>{i18n.t('elygate.proxyConfig')}<textarea bind:value={providerForm.proxy} rows="3"></textarea></label>
				<label>{i18n.t('elygate.customConfig')}<textarea bind:value={providerForm.custom} rows="3"></textarea><small>{i18n.t('elygate.providerCustomHint')}</small></label><label>{i18n.t('elygate.openaiConfig')}<textarea bind:value={providerForm.openai} rows="2"></textarea><small>{i18n.t('elygate.providerOpenAIHint')}</small></label>
			<div class="checks"><label><input type="checkbox" bind:checked={providerForm.sendBackRequest} /> {i18n.t('elygate.sendBackRawRequest')}</label><label><input type="checkbox" bind:checked={providerForm.sendBackResponse} /> {i18n.t('elygate.sendBackRawResponse')}</label><label><input type="checkbox" bind:checked={providerForm.storeRaw} /> {i18n.t('elygate.storeRawRequestResponse')}</label></div>
			<footer><button type="button" onclick={() => (modal = null)}>{i18n.t('elygate.cancel')}</button><button class="primary" type="submit" disabled={isSaving}>{i18n.t('elygate.save')}</button></footer>
		</form>
	</div></div>
{/if}

{#if modal === 'keys'}
	<div class="modal-backdrop"><div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="keys-dialog-title"><header><h2 id="keys-dialog-title">{i18n.t('elygate.manageKeys')}: {selectedProvider}</h2><button type="button" onclick={() => (modal = null)}>{i18n.t('elygate.close')}</button></header>
		<div class="key-layout"><div class="table-wrap"><table><thead><tr><th>{i18n.t('elygate.keyName')}</th><th>{i18n.t('elygate.status')}</th><th>{i18n.t('elygate.models')}</th><th>{i18n.t('elygate.actions')}</th></tr></thead><tbody>{#each keys as key (stringValue(key, 'id'))}<tr><td>{stringValue(key, 'name')}</td><td title={stringValue(key, 'description')}>{key.enabled === false ? i18n.t('elygate.disabled') : stringValue(key, 'status') || i18n.t('elygate.enabled')}</td><td>{keyModelsLabel(key)}</td><td class="actions"><button type="button" onclick={() => editKey(key)}>{i18n.t('elygate.edit')}</button><button type="button" onclick={() => void revalidateKey(key)} disabled={revalidatingKeyId === stringValue(key, 'id')}>{i18n.t('elygate.revalidate')}</button><button class="danger" type="button" onclick={() => void removeKey(key)} disabled={deletingKeyId === stringValue(key, 'id')}>{i18n.t('elygate.delete')}</button></td></tr>{:else}<tr><td colspan="4" class="empty">{i18n.t('elygate.noResults')}</td></tr>{/each}</tbody></table></div>
			<form class="key-form" onsubmit={submitKey}><h3>{editingKey ? i18n.t('elygate.edit') : i18n.t('elygate.create')} {i18n.t('elygate.keyName')}</h3><label>{i18n.t('elygate.keyName')}<input bind:value={keyForm.name} required /></label><label>{i18n.t('elygate.keyValue')}<input type="password" bind:value={keyForm.value} autocomplete="new-password" /><small>{i18n.t('elygate.keyValueHelp')}</small></label><label>{i18n.t('elygate.modelsCsv')}<input bind:value={keyForm.models} placeholder="*" /><small>{i18n.t('elygate.keyModelsHelp')}</small></label><label>{i18n.t('elygate.blacklistedModelsCsv')}<input bind:value={keyForm.blacklistedModels} /></label><div class="grid-two"><label>{i18n.t('elygate.weight')}<input type="number" min="0" step="0.01" bind:value={keyForm.weight} /></label><label class="check"><input type="checkbox" bind:checked={keyForm.enabled} /> {i18n.t('elygate.enabled')}</label></div><label>{i18n.t('elygate.advancedJson')}<textarea bind:value={keyForm.advanced} rows="5"></textarea></label><footer><button type="button" onclick={() => { editingKey = null; keyForm = emptyKeyForm(); }}>{i18n.t('elygate.cancel')}</button><button class="primary" type="submit" disabled={isSaving}>{i18n.t('elygate.save')}</button></footer></form>
		</div>
	</div></div>
{/if}

<style>
	.page-shell { max-width: 1280px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: flex-start; display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .45rem; text-transform: uppercase; }
	h1 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.15rem); }
	.page-heading p { color: var(--muted-foreground); margin: .55rem 0 0; }
	.heading-actions, .actions, footer { align-items: center; display: flex; gap: .5rem; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); cursor: pointer; font-weight: 600; padding: .55rem .75rem; white-space: nowrap; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	button:disabled { cursor: wait; opacity: .55; }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .9rem; overflow-x: auto; }
	table { border-collapse: collapse; min-width: 860px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); padding: .8rem 1rem; text-align: left; white-space: nowrap; }
	th { background: var(--muted); color: var(--muted-foreground); font-size: .75rem; text-transform: uppercase; }
	.notice { border-radius: .65rem; margin-bottom: 1rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.warning { background: color-mix(in oklch, var(--warning, #d97706) 12%, transparent); color: var(--warning, #b45309); }
	.notice.success { background: color-mix(in oklch, var(--primary) 12%, transparent); color: var(--primary); }
	.form-hint { background: color-mix(in oklch, var(--primary) 9%, transparent); border: 1px solid color-mix(in oklch, var(--primary) 28%, var(--border)); border-radius: .65rem; color: var(--foreground); line-height: 1.55; padding: .75rem .85rem; }
	.empty { color: var(--muted-foreground); text-align: center; }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .45); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; max-height: calc(100vh - 2rem); max-width: 760px; overflow: auto; padding: 1.25rem; width: 100%; }
	.modal.wide { max-width: 1200px; }
	.modal > header { align-items: center; display: flex; justify-content: space-between; margin-bottom: 1rem; }
	h2, h3 { margin: 0; }
	form { display: grid; gap: .85rem; }
	label { color: var(--foreground); display: grid; font-size: .85rem; font-weight: 650; gap: .35rem; }
	input, textarea { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); font: inherit; padding: .6rem .7rem; width: 100%; }
	textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem; resize: vertical; }
	small { color: var(--muted-foreground); font-weight: 400; }
	.grid-two { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.checks { display: flex; flex-wrap: wrap; gap: .75rem 1rem; }
	.checks label, .check { align-items: center; display: flex; font-weight: 500; }
	.checks input, .check input { width: auto; }
	form footer { justify-content: flex-end; margin-top: .25rem; }
	.key-layout { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr); }
	.key-form { border: 1px solid var(--border); border-radius: .75rem; padding: 1rem; }
	@media (max-width: 800px) { .page-heading, .key-layout { display: flex; flex-direction: column; } .heading-actions { width: 100%; } .heading-actions button { flex: 1; } .grid-two { grid-template-columns: 1fr; } }
</style>
