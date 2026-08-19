<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, parseJsonArray, parseJsonObject, prettyJson } from '../lib/forms';
	import { encodePathSegment, getListPayload, getObjectPayload, requestJson, type JsonRecord } from '../lib/api';
	import { availableVirtualKeyProviders, duplicateVirtualKeyProviders, providerConfigsForForm, removedVirtualKeyProviderConfigCount, unavailableVirtualKeyProviders, virtualKeyAdvancedProviderFields, virtualKeyProviderConfigsForPayload } from '../lib/resource-forms';

	interface VirtualKeyForm {
		name: string;
		description: string;
		isActive: boolean;
		calendarAligned: boolean;
		expiresAt: string;
		teamId: string;
		customerId: string;
		mcpConfigs: string;
		budgets: string;
		rateLimit: string;
		advanced: string;
	}
	interface Props { resourceName: string; }
	function emptyForm(): VirtualKeyForm {
		return { name: '', description: '', isActive: true, calendarAligned: false, expiresAt: '', teamId: '', customerId: '', mcpConfigs: '[]', budgets: '[]', rateLimit: '', advanced: '' };
	}

	function stringValue(record: JsonRecord, key: string): string {
		return typeof record[key] === 'string' ? String(record[key]) : '';
	}

	function mcpConfigsForForm(value: unknown): unknown[] {
		if (!Array.isArray(value)) return [];
		return value.filter((item): item is JsonRecord => !!item && typeof item === 'object' && !Array.isArray(item)).map((item) => {
			const client = item.mcp_client && typeof item.mcp_client === 'object' && !Array.isArray(item.mcp_client) ? item.mcp_client as JsonRecord : {};
			return {
				...(typeof item.id === 'number' ? { id: item.id } : {}),
				mcp_client_name: client.name ?? item.mcp_client_name,
				tools_to_execute: item.tools_to_execute ?? client.tools_to_execute ?? [],
			};
		});
	}

	function rateLimitForForm(value: unknown): JsonRecord {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
		const source = value as JsonRecord;
		return {
			token_max_limit: source.token_max_limit,
			token_reset_duration: source.token_reset_duration,
			request_max_limit: source.request_max_limit,
			request_reset_duration: source.request_reset_duration,
		};
	}

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	let virtualKeys = $state.raw<JsonRecord[]>([]);
	let providers = $state.raw<JsonRecord[]>([]);
	let providerRoutes = $state<JsonRecord[]>([]);
	let modelsByProvider = $state.raw<Record<string, JsonRecord[]>>({});
	let keysByProvider = $state.raw<Record<string, JsonRecord[]>>({});
	let providerStatusAvailable = $state(false);
	let form = $state<VirtualKeyForm>(emptyForm());
	let editing = $state<JsonRecord | null>(null);
	let isOpen = $state(false);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let error = $state('');
	let notice = $state('');
	let revealedKey = $state('');
	const canAddProviderRoute = $derived(availableVirtualKeyProviders(providers, providerRoutes).length > 0);

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			virtualKeys = getListPayload(await requestJson('/api/governance/virtual-keys'));
			try {
				providers = getListPayload(await requestJson('/api/providers'));
				providerStatusAvailable = true;
			} catch {
				providers = [];
				providerStatusAvailable = false;
			}
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	async function loadProviderOptions(providerName: string): Promise<void> {
		if (!providerName || (modelsByProvider[providerName] && keysByProvider[providerName])) return;
		const encoded = encodeURIComponent(providerName);
		try {
			const [modelPayload, keyPayload] = await Promise.all([
				requestJson<unknown>(`/api/models?unfiltered=true&limit=0&provider=${encoded}`),
				requestJson<unknown>(`/api/providers/${encoded}/keys`),
			]);
			modelsByProvider = { ...modelsByProvider, [providerName]: getListPayload(modelPayload) };
			keysByProvider = { ...keysByProvider, [providerName]: getListPayload(keyPayload) };
		} catch {
			// 不缓存失败结果；重新打开或切换供应商时会再次请求。
		}
	}

	function stringArray(value: unknown): string[] {
		return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
	}

	function addProviderRoute(): void {
		const providerName = availableVirtualKeyProviders(providers, providerRoutes)[0]?.name;
		if (typeof providerName !== 'string') return;
		providerRoutes.push({ provider: providerName, allowed_models: ['*'], allow_all_keys: true });
		void loadProviderOptions(providerName);
	}

	function removeProviderRoute(index: number): void {
		providerRoutes.splice(index, 1);
	}

	function changeProvider(index: number, providerName: string): void {
		providerRoutes[index] = { provider: providerName, allowed_models: ['*'], allow_all_keys: true };
		void loadProviderOptions(providerName);
	}

	function setAllKeys(route: JsonRecord, checked: boolean): void {
		route.allow_all_keys = checked;
		if (checked) delete route.key_ids;
		else route.key_ids = [];
	}

	function toggleRouteValue(route: JsonRecord, field: 'allowed_models' | 'key_ids', value: string, checked: boolean): void {
		const current = stringArray(route[field]).filter((item) => item !== '*');
		route[field] = checked ? [...new Set([...current, value])] : current.filter((item) => item !== value);
		if (field === 'key_ids' && stringArray(route[field]).length > 0) route.allow_all_keys = false;
	}

	function setAllModels(route: JsonRecord, checked: boolean): void {
		route.allowed_models = checked ? ['*'] : [];
	}

	function providerWarning(record: JsonRecord): string {
		if (!providerStatusAvailable) return '';
		const unavailable = unavailableVirtualKeyProviders(record.provider_configs, providers);
		return unavailable.length
			? i18n.t('elygate.virtualKeyProviderUnavailable').replace('{providers}', unavailable.join(', '))
			: '';
	}

	function virtualKeyStatus(record: JsonRecord): string {
		if (record.is_active === false) return i18n.t('elygate.disabled');
		return providerWarning(record) || i18n.t('elygate.active');
	}

	function openCreate(): void {
		editing = null;
		form = emptyForm();
		providerRoutes = [];
		revealedKey = '';
		error = '';
		isOpen = true;
	}

	function openEdit(record: JsonRecord): void {
		editing = record;
		revealedKey = '';
		providerRoutes = providerConfigsForForm(record.provider_configs).filter((item): item is JsonRecord => !!item && typeof item === 'object' && !Array.isArray(item));
		for (const route of providerRoutes) if (typeof route.provider === 'string') void loadProviderOptions(route.provider);
		form = {
			name: stringValue(record, 'name'),
			description: stringValue(record, 'description'),
			isActive: record.is_active !== false,
			calendarAligned: record.calendar_aligned === true,
			expiresAt: stringValue(record, 'expires_at'),
			teamId: stringValue(record, 'team_id'),
			customerId: stringValue(record, 'customer_id'),
			mcpConfigs: prettyJson(mcpConfigsForForm(record.mcp_configs), '[]'),
			budgets: prettyJson(Array.isArray(record.budgets) ? record.budgets : [], '[]'),
			rateLimit: prettyJson(rateLimitForForm(record.rate_limit)),
			advanced: '',
		};
		error = '';
		isOpen = true;
	}

	async function save(): Promise<void> {
		isSaving = true;
		error = '';
		try {
			if (!form.name.trim()) throw new Error(i18n.t('elygate.required').replace('{field}', i18n.t('elygate.virtualKeyName')));
			if (form.teamId.trim() && form.customerId.trim()) throw new Error(i18n.t('elygate.teamCustomerConflict'));
			const invalidJson = i18n.t('elygate.invalidJson');
			let providerConfigs: JsonRecord[];
			try {
				providerConfigs = virtualKeyProviderConfigsForPayload(
					JSON.parse(JSON.stringify(providerRoutes)) as unknown[],
					{ requireAllowedModels: !editing },
				);
			} catch (cause) {
				if (!editing && cause instanceof Error && cause.message.includes('.allowed_models')) {
					throw new Error(i18n.t('elygate.virtualKeyModelsRequired'));
				}
				throw cause;
			}
			const duplicateProviders = duplicateVirtualKeyProviders(providerConfigs);
			if (duplicateProviders.length) throw new Error(i18n.t('elygate.virtualKeyDuplicateProvider').replace('{providers}', duplicateProviders.join(', ')));
			for (const [index, route] of providerConfigs.entries()) {
				if (!String(route.provider ?? '').trim()) throw new Error(i18n.t('elygate.required').replace('{field}', `${i18n.t('elygate.provider')} #${index + 1}`));
			}
			const mcpConfigs = parseJsonArray(form.mcpConfigs, i18n.t('elygate.mcpConfigs'), invalidJson);
			const budgets = parseJsonArray(form.budgets, i18n.t('elygate.budgets'), invalidJson);
			const rateLimit = parseJsonObject(form.rateLimit, i18n.t('elygate.rateLimit'), invalidJson);
			const advanced = parseJsonObject(form.advanced, i18n.t('elygate.advancedJson'), invalidJson);
			const misplacedProviderFields = virtualKeyAdvancedProviderFields(advanced);
			if (misplacedProviderFields.length) {
				throw new Error(i18n.t('elygate.virtualKeyAdvancedProviderFields').replace('{fields}', misplacedProviderFields.join(', ')));
			}
			const removedProviderCount = removedVirtualKeyProviderConfigCount(editing?.provider_configs, providerConfigs);
			if (removedProviderCount > 0 && !window.confirm(i18n.t('elygate.confirmReplaceVirtualKeyProviders').replace('{count}', String(removedProviderCount)))) return;
			const payload: JsonRecord = {
				...advanced,
				name: form.name.trim(),
				description: form.description.trim(),
				is_active: form.isActive,
				calendar_aligned: form.calendarAligned,
				provider_configs: providerConfigs,
				mcp_configs: mcpConfigs,
				budgets,
				rate_limit: Object.keys(rateLimit).length ? rateLimit : undefined,
				team_id: editing ? (form.teamId.trim() || null) : (form.teamId.trim() || undefined),
				customer_id: editing ? (form.customerId.trim() || null) : (form.customerId.trim() || undefined),
			};
			if (form.expiresAt.trim() || editing) payload.expires_at = form.expiresAt.trim();
			let response: unknown;
			if (editing) {
				response = await requestJson(`/api/governance/virtual-keys/${encodePathSegment(stringValue(editing, 'id'))}`, { method: 'PUT', body: JSON.stringify(payload) });
			} else {
				response = await requestJson('/api/governance/virtual-keys', { method: 'POST', body: JSON.stringify(payload) });
			}
			const saved = getObjectPayload(response, 'virtual_key');
			// 创建和轮换会生成新值；普通编辑绝不能重新展示已存在的密钥。
			revealedKey = editing ? '' : stringValue(saved, 'value');
			notice = i18n.t('elygate.save');
			isOpen = false;
			await load();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isSaving = false;
		}
	}

	async function rotate(record: JsonRecord): Promise<void> {
		if (!window.confirm(i18n.t('elygate.confirmRotate'))) return;
		error = '';
		try {
			const response = await requestJson(`/api/governance/virtual-keys/${encodePathSegment(stringValue(record, 'id'))}/rotate`, { method: 'POST' });
			const rotated = getObjectPayload(response, 'virtual_key');
			revealedKey = stringValue(rotated, 'value');
			notice = i18n.t('elygate.rotate');
			await load();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		}
	}

	async function remove(record: JsonRecord): Promise<void> {
		if (!window.confirm(i18n.t('elygate.confirmDelete'))) return;
		try {
			await requestJson(`/api/governance/virtual-keys/${encodePathSegment(stringValue(record, 'id'))}`, { method: 'DELETE' });
			notice = i18n.t('elygate.delete');
			await load();
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		}
	}

	async function copyKey(): Promise<void> {
		if (revealedKey) await navigator.clipboard.writeText(revealedKey);
	}

	function submit(event: SubmitEvent): void { event.preventDefault(); void save(); }
	onMount(() => { void load(); });
</script>

<section class="page-shell" data-resource={resourceName}>
	<header class="page-heading"><div><p class="eyebrow">Elygate / Governance</p><h1>{i18n.t('elygate.virtualKeys')}</h1><p>{i18n.t('elygate.securityNotice')}</p></div><div class="heading-actions"><button class="primary" type="button" onclick={() => void load()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button><button class="primary" type="button" onclick={openCreate}>{i18n.t('elygate.create')}</button></div></header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	{#if revealedKey}<div class="secret-reveal" role="status"><div><strong>{i18n.t('elygate.newKeyValue')}</strong><code>{revealedKey}</code></div><button type="button" onclick={() => void copyKey()}>{i18n.t('elygate.copy')}</button><button type="button" onclick={() => (revealedKey = '')}>{i18n.t('elygate.close')}</button></div>{/if}
	<div class="table-wrap" aria-busy={isLoading}><table><thead><tr><th>{i18n.t('elygate.virtualKeyName')}</th><th>{i18n.t('elygate.status')}</th><th>{i18n.t('elygate.expiresAt')}</th><th>{i18n.t('elygate.description')}</th><th>{i18n.t('elygate.actions')}</th></tr></thead><tbody>{#each virtualKeys as key (stringValue(key, 'id'))}<tr><td><strong>{stringValue(key, 'name')}</strong></td><td class={providerWarning(key) ? 'warning-text' : undefined} title={providerWarning(key)}>{virtualKeyStatus(key)}</td><td>{stringValue(key, 'expires_at') || '—'}</td><td>{stringValue(key, 'description') || '—'}</td><td class="actions"><button type="button" onclick={() => openEdit(key)}>{i18n.t('elygate.edit')}</button><button type="button" onclick={() => void rotate(key)}>{i18n.t('elygate.rotate')}</button><button class="danger" type="button" onclick={() => void remove(key)}>{i18n.t('elygate.delete')}</button></td></tr>{:else}<tr><td colspan="5" class="empty">{i18n.t('elygate.noResults')}</td></tr>{/each}</tbody></table></div>
</section>

{#if isOpen}
	<div class="modal-backdrop">
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="vk-dialog-title">
			<header>
				<h2 id="vk-dialog-title">{editing ? i18n.t('elygate.edit') : i18n.t('elygate.create')} {i18n.t('elygate.virtualKeys')}</h2>
				<button type="button" onclick={() => (isOpen = false)}>{i18n.t('elygate.close')}</button>
			</header>
			<form onsubmit={submit}>
				<label>{i18n.t('elygate.virtualKeyName')}<input bind:value={form.name} required /></label>
				<label>{i18n.t('elygate.description')}<input bind:value={form.description} /></label>
				<div class="grid-two">
					<label>{i18n.t('elygate.teamId')}<input bind:value={form.teamId} /></label>
					<label>{i18n.t('elygate.customerId')}<input bind:value={form.customerId} /></label>
				</div>
				<label>{i18n.t('elygate.expiresAt')}<input bind:value={form.expiresAt} placeholder="2030-01-01T00:00:00Z" /></label>
				<div class="checks">
					<label><input type="checkbox" bind:checked={form.isActive} /> {i18n.t('elygate.active')}</label>
					<label><input type="checkbox" bind:checked={form.calendarAligned} /> {i18n.t('elygate.calendarAligned')}</label>
				</div>
				<fieldset class="route-editor">
					<legend>{i18n.t('elygate.providerConfigs')}</legend>
					{#each providerRoutes as route, routeIndex (route)}
						<section class="route-row">
							<header><strong>{i18n.t('elygate.provider')} #{routeIndex + 1}</strong><button class="danger" type="button" onclick={() => removeProviderRoute(routeIndex)}>{i18n.t('elygate.delete')}</button></header>
							<label>{i18n.t('elygate.provider')}<select value={String(route.provider ?? '')} onchange={(event) => changeProvider(routeIndex, event.currentTarget.value)}><option value="">{i18n.t('elygate.select')}</option>{#each availableVirtualKeyProviders(providers, providerRoutes, routeIndex) as provider (String(provider.name))}<option value={String(provider.name)}>{String(provider.name)}</option>{/each}</select></label>
							<label class="check"><input type="checkbox" checked={route.allow_all_keys === true} onchange={(event) => setAllKeys(route, event.currentTarget.checked)} />{i18n.t('elygate.virtualKeyAllowAllKeys')}</label>
							{#if route.allow_all_keys !== true}<div class="choice-grid"><strong>{i18n.t('elygate.providerKeys')}</strong>{#each keysByProvider[String(route.provider ?? '')] ?? [] as key (String(key.id ?? key.key_id))}<label class="check"><input type="checkbox" checked={stringArray(route.key_ids).includes(String(key.id ?? key.key_id))} onchange={(event) => toggleRouteValue(route, 'key_ids', String(key.id ?? key.key_id), event.currentTarget.checked)} />{String(key.name ?? key.id ?? key.key_id)}</label>{:else}<small>{i18n.t('elygate.empty')}</small>{/each}</div>{/if}
							<label class="check"><input type="checkbox" checked={stringArray(route.allowed_models).includes('*')} onchange={(event) => setAllModels(route, event.currentTarget.checked)} />{i18n.t('elygate.virtualKeyAllowAllModels')}</label>
							{#if !stringArray(route.allowed_models).includes('*')}<div class="choice-grid"><strong>{i18n.t('elygate.models')}</strong>{#each modelsByProvider[String(route.provider ?? '')] ?? [] as model (String(model.name))}<label class="check"><input type="checkbox" checked={stringArray(route.allowed_models).includes(String(model.name))} onchange={(event) => toggleRouteValue(route, 'allowed_models', String(model.name), event.currentTarget.checked)} />{String(model.name)}</label>{:else}<small>{i18n.t('elygate.empty')}</small>{/each}</div>{/if}
						</section>
					{:else}<p class="empty">{i18n.t('elygate.virtualKeyNoProviderRoutes')}</p>{/each}
					<button type="button" onclick={addProviderRoute} disabled={!canAddProviderRoute}>{i18n.t('elygate.virtualKeyAddProviderRoute')}</button>
					<small>{i18n.t('elygate.virtualKeyProviderConfigsHint')}</small>
				</fieldset>
				<label>{i18n.t('elygate.mcpConfigs')}<textarea bind:value={form.mcpConfigs} rows="5"></textarea></label>
				<div class="grid-two">
					<label>{i18n.t('elygate.budgets')}<textarea bind:value={form.budgets} rows="5"></textarea></label>
					<label>{i18n.t('elygate.rateLimit')}<textarea bind:value={form.rateLimit} rows="5"></textarea></label>
				</div>
				<label>{i18n.t('elygate.advancedJson')}<textarea bind:value={form.advanced} rows="4"></textarea><small>{i18n.t('elygate.virtualKeyAdvancedHint')}</small></label>
				<footer>
					<button type="button" onclick={() => (isOpen = false)}>{i18n.t('elygate.cancel')}</button>
					<button class="primary" type="submit" disabled={isSaving}>{i18n.t('elygate.save')}</button>
				</footer>
			</form>
		</div>
	</div>
{/if}

<style>
	.page-shell { max-width: 1280px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: flex-start; display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .45rem; text-transform: uppercase; }
	h1 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.15rem); }
	.page-heading p { color: var(--muted-foreground); margin: .55rem 0 0; }
	.heading-actions, .actions, footer, .checks { align-items: center; display: flex; gap: .5rem; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); cursor: pointer; font-weight: 600; padding: .55rem .75rem; white-space: nowrap; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button.danger { color: var(--destructive); }
	.table-wrap { background: var(--card); border: 1px solid var(--border); border-radius: .9rem; overflow-x: auto; }
	table { border-collapse: collapse; min-width: 920px; width: 100%; }
	th, td { border-bottom: 1px solid var(--border); max-width: 320px; overflow: hidden; padding: .8rem 1rem; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
	th { background: var(--muted); color: var(--muted-foreground); font-size: .75rem; text-transform: uppercase; }
	.notice, .secret-reveal { border-radius: .65rem; margin-bottom: 1rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success, .secret-reveal { background: color-mix(in oklch, var(--primary) 12%, transparent); color: var(--primary); }
	.warning-text { color: var(--warning, #b45309); font-weight: 650; }
	.secret-reveal { align-items: center; display: flex; gap: .5rem; justify-content: space-between; }
	.secret-reveal div { display: grid; gap: .35rem; min-width: 0; }
	.secret-reveal code { color: var(--foreground); overflow-wrap: anywhere; }
	.empty { color: var(--muted-foreground); text-align: center; }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .45); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; max-height: calc(100vh - 2rem); max-width: 820px; overflow: auto; padding: 1.25rem; width: 100%; }
	.modal > header { align-items: center; display: flex; justify-content: space-between; margin-bottom: 1rem; }
	h2 { margin: 0; }
	form { display: grid; gap: .85rem; }
	label { display: grid; font-size: .85rem; font-weight: 650; gap: .35rem; }
	input, textarea, select { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); font: inherit; padding: .6rem .7rem; width: 100%; }
	textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem; resize: vertical; }
	.route-editor { border: 1px solid var(--border); border-radius: .65rem; display: grid; gap: .75rem; margin: 0; padding: .85rem; }
	.route-editor legend { font-size: .85rem; font-weight: 700; padding: 0 .3rem; }
	.route-row { border-bottom: 1px solid var(--border); display: grid; gap: .7rem; padding-bottom: .85rem; }
	.route-row header { align-items: center; display: flex; justify-content: space-between; }
	.check { align-items: center; display: flex; font-weight: 500; gap: .45rem; }
	.check input { flex: 0 0 auto; width: auto; }
	.choice-grid { background: var(--muted); border-radius: .5rem; display: grid; gap: .45rem; max-height: 12rem; overflow: auto; padding: .65rem; }
	.grid-two { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.checks { flex-wrap: wrap; gap: 1rem; }
	.checks label { align-items: center; display: flex; font-weight: 500; }
	.checks input { width: auto; }
	form footer { justify-content: flex-end; }
	@media (max-width: 760px) { .page-heading, .secret-reveal { align-items: stretch; flex-direction: column; } .grid-two { grid-template-columns: 1fr; } }
</style>
