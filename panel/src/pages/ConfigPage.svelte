<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, parseJsonObject, prettyJson } from '../lib/forms';
	import { isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import {
		DUAL_CREDENTIAL_BEHAVIORS,
		MCP_CODE_MODE_BINDING_LEVELS,
		MCP_SERVER_AUTH_MODES,
		configFormFromDocument,
		mergeConfigForm,
		type ConfigForm,
	} from '../lib/config-form';
	import SwitchField from '../lib/fields/SwitchField.svelte';
	import TextField from '../lib/fields/TextField.svelte';
	import NumberField from '../lib/fields/NumberField.svelte';
	import SelectField from '../lib/fields/SelectField.svelte';

	type Mode = 'form' | 'json';

	interface Props { resourceName: string; }

	let { resourceName }: Props = $props();
	const i18n = useTranslation();

	const eyebrow = $derived(`Elygate / Bifrost ${resourceName === 'config' ? 'Config' : resourceName}`);

	let rawConfig = $state<JsonRecord>({});
	let form = $state<ConfigForm>(configFormFromDocument({}));
	let jsonText = $state('');
	let mode = $state<Mode>('form');
	let error = $state('');
	let notice = $state('');
	let isLoading = $state(true);
	let isSaving = $state(false);

	const statusItems = $derived.by(() => [
		{ key: 'database', ok: rawConfig.is_db_connected === true, kind: 'connected' as const },
		{ key: 'logs', ok: rawConfig.is_logs_connected === true, kind: 'connected' as const },
		{ key: 'cache', ok: rawConfig.is_cache_connected === true, kind: 'connected' as const },
		{ key: 'objectStorage', ok: rawConfig.is_object_storage_connected === true, kind: 'connected' as const },
		{ key: 'git', ok: rawConfig.is_git_available === true, kind: 'available' as const },
	]);

	const restartRequired = $derived(
		isJsonRecord(rawConfig.restart_required) && rawConfig.restart_required.required === true
			? typeof rawConfig.restart_required.reason === 'string'
				? rawConfig.restart_required.reason
				: ''
			: null,
	);

	const dualCredentialOptions = $derived(
		DUAL_CREDENTIAL_BEHAVIORS.map((value) => ({
			value,
			label: i18n.t(`elygate.option.dual.${value}`),
		})),
	);
	const mcpAuthModeOptions = $derived(
		MCP_SERVER_AUTH_MODES.map((value) => ({ value, label: i18n.t(`elygate.option.authMode.${value}`) })),
	);
	const codeModeBindingOptions = $derived(
		MCP_CODE_MODE_BINDING_LEVELS.map((value) => ({ value, label: i18n.t(`elygate.option.binding.${value}`) })),
	);

	function applyDocument(doc: JsonRecord): void {
		rawConfig = doc;
		form = configFormFromDocument(doc);
		jsonText = prettyJson(doc, '{}');
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		notice = '';
		try {
			applyDocument((await requestJson('/api/config')) as JsonRecord);
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	function switchMode(next: Mode): void {
		if (next === mode) return;
		error = '';
		if (next === 'json') {
			jsonText = prettyJson(mergeConfigForm(rawConfig, form), '{}');
			mode = 'json';
			return;
		}
		try {
			const parsed = parseJsonObject(jsonText, i18n.t('elygate.config'), i18n.t('elygate.invalidJson'));
			applyDocument(parsed);
			mode = 'form';
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.invalidJson'));
		}
	}

	async function save(): Promise<void> {
		isSaving = true;
		error = '';
		notice = '';
		try {
			const body =
				mode === 'json'
					? parseJsonObject(jsonText, i18n.t('elygate.config'), i18n.t('elygate.invalidJson'))
					: mergeConfigForm(rawConfig, form);
			const response = (await requestJson('/api/config', { method: 'PUT', body: JSON.stringify(body) })) as JsonRecord;
			applyDocument(response);
			notice = i18n.t('elygate.saveSuccess');
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
			<p class="eyebrow">{eyebrow}</p>
			<h1>{i18n.t('elygate.config')}</h1>
			<p>{i18n.t('elygate.configHint')}</p>
		</div>
		<div class="heading-actions">
			<div class="mode-switch" role="group" aria-label={i18n.t('elygate.config')}>
				<button type="button" class:is-active={mode === 'form'} onclick={() => switchMode('form')} disabled={isLoading || isSaving}>
					{i18n.t('elygate.formMode')}
				</button>
				<button type="button" class:is-active={mode === 'json'} onclick={() => switchMode('json')} disabled={isLoading || isSaving}>
					{i18n.t('elygate.jsonMode')}
				</button>
			</div>
			<button class="primary" type="button" onclick={() => void load()} disabled={isLoading || isSaving}>{i18n.t('elygate.refresh')}</button>
		</div>
	</header>

	<div class="status-grid" aria-label={i18n.t('elygate.connectionStatus')}>
		{#each statusItems as item (item.key)}
			<div class="status-item">
				<span class={['dot', item.ok ? 'ok' : 'off']}></span>
				<span class="status-name">{i18n.t(`elygate.conn.${item.key}`)}</span>
				<strong class={item.ok ? 'ok-text' : 'off-text'}>
					{item.ok
						? i18n.t(item.kind === 'connected' ? 'elygate.conn.connected' : 'elygate.conn.available')
						: i18n.t(item.kind === 'connected' ? 'elygate.conn.disconnected' : 'elygate.conn.unavailable')}
				</strong>
			</div>
		{/each}
	</div>

	{#if restartRequired !== null}
		<div class="notice warning" role="status">
			{i18n.t('elygate.restartRequired')}{restartRequired ? ` ${restartRequired}` : ''}
		</div>
	{/if}
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	{#if notice}<div class="notice success" role="status">{notice}</div>{/if}

	<form onsubmit={submit}>
		{#if mode === 'form'}
			<div class="section-grid">
				<section class="config-section">
					<h2>{i18n.t('elygate.section.auth')}</h2>
					<SwitchField label={i18n.t('elygate.field.authEnabled')} bind:checked={form.authEnabled} disabled={isLoading} />
					<TextField label={i18n.t('elygate.field.adminUsername')} bind:value={form.adminUsername} autocomplete="username" disabled={isLoading} />
					<TextField
						label={i18n.t('elygate.field.adminPassword')}
						hint={i18n.t('elygate.field.adminPasswordHint')}
						bind:value={form.adminPassword}
						secret
						autocomplete="new-password"
						disabled={isLoading}
					/>
				</section>

				<section class="config-section">
					<h2>{i18n.t('elygate.section.logging')}</h2>
					<SwitchField label={i18n.t('elygate.field.enableLogging')} bind:checked={form.enableLogging} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.disableContentLogging')} bind:checked={form.disableContentLogging} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.retainContentInObjectStorage')} bind:checked={form.retainContentInObjectStorage} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.allowPerRequestContentStorageOverride')} bind:checked={form.allowPerRequestContentStorageOverride} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.allowPerRequestRawOverride')} bind:checked={form.allowPerRequestRawOverride} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.dumpErrorsInConsoleLogs')} bind:checked={form.dumpErrorsInConsoleLogs} disabled={isLoading} />
					<NumberField label={i18n.t('elygate.field.logRetentionDays')} bind:value={form.logRetentionDays} min={0} disabled={isLoading} />
				</section>

				<section class="config-section">
					<h2>{i18n.t('elygate.section.security')}</h2>
					<SwitchField label={i18n.t('elygate.field.allowDirectKeys')} bind:checked={form.allowDirectKeys} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.enforceAuthOnInference')} bind:checked={form.enforceAuthOnInference} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.disableDbPingsInHealth')} bind:checked={form.disableDbPingsInHealth} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.dropExcessRequests')} bind:checked={form.dropExcessRequests} disabled={isLoading} />
					<SelectField label={i18n.t('elygate.field.dualCredentialConflictBehavior')} bind:value={form.dualCredentialConflictBehavior} options={dualCredentialOptions} disabled={isLoading} />
					<TextField label={i18n.t('elygate.field.allowedOrigins')} hint={i18n.t('elygate.field.csvHint')} bind:value={form.allowedOrigins} placeholder="*" disabled={isLoading} />
					<NumberField label={i18n.t('elygate.field.maxRequestBodySizeMb')} bind:value={form.maxRequestBodySizeMb} min={1} disabled={isLoading} />
				</section>

				<section class="config-section">
					<h2>{i18n.t('elygate.section.performance')}</h2>
					<NumberField label={i18n.t('elygate.field.initialPoolSize')} bind:value={form.initialPoolSize} min={0} disabled={isLoading} />
					<TextField label={i18n.t('elygate.field.prometheusLabels')} hint={i18n.t('elygate.field.csvHint')} bind:value={form.prometheusLabels} disabled={isLoading} />
					<NumberField label={i18n.t('elygate.field.asyncJobResultTtl')} bind:value={form.asyncJobResultTtl} min={0} disabled={isLoading} />
					<NumberField label={i18n.t('elygate.field.routingChainMaxDepth')} bind:value={form.routingChainMaxDepth} min={1} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.hideDeletedVirtualKeysInFilters')} bind:checked={form.hideDeletedVirtualKeysInFilters} disabled={isLoading} />
				</section>

				<section class="config-section">
					<h2>{i18n.t('elygate.section.compat')}</h2>
					<SwitchField label={i18n.t('elygate.field.compatConvertTextToChat')} bind:checked={form.compatConvertTextToChat} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.compatConvertChatToResponses')} bind:checked={form.compatConvertChatToResponses} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.compatShouldDropParams')} bind:checked={form.compatShouldDropParams} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.compatShouldConvertParams')} bind:checked={form.compatShouldConvertParams} disabled={isLoading} />
				</section>

				<section class="config-section">
					<h2>{i18n.t('elygate.section.mcp')}</h2>
					<NumberField label={i18n.t('elygate.field.mcpAgentDepth')} bind:value={form.mcpAgentDepth} min={0} disabled={isLoading} />
					<NumberField label={i18n.t('elygate.field.mcpToolExecutionTimeout')} bind:value={form.mcpToolExecutionTimeout} min={0} disabled={isLoading} />
					<SelectField label={i18n.t('elygate.field.mcpCodeModeBindingLevel')} bind:value={form.mcpCodeModeBindingLevel} options={codeModeBindingOptions} disabled={isLoading} />
					<NumberField label={i18n.t('elygate.field.mcpToolSyncInterval')} bind:value={form.mcpToolSyncInterval} min={0} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.mcpDisableAutoToolInject')} bind:checked={form.mcpDisableAutoToolInject} disabled={isLoading} />
					<SwitchField label={i18n.t('elygate.field.mcpEnableTempTokenAuth')} bind:checked={form.mcpEnableTempTokenAuth} disabled={isLoading} />
					<TextField label={i18n.t('elygate.field.mcpExternalClientUrl')} bind:value={form.mcpExternalClientUrl} disabled={isLoading} />
					<SelectField label={i18n.t('elygate.field.mcpServerAuthMode')} bind:value={form.mcpServerAuthMode} options={mcpAuthModeOptions} disabled={isLoading} />
				</section>

				<section class="config-section">
					<h2>{i18n.t('elygate.section.framework')}</h2>
					<TextField label={i18n.t('elygate.field.pricingUrl')} bind:value={form.pricingUrl} disabled={isLoading} />
					<NumberField label={i18n.t('elygate.field.pricingSyncInterval')} bind:value={form.pricingSyncInterval} min={0} disabled={isLoading} />
					<TextField label={i18n.t('elygate.field.modelParametersUrl')} bind:value={form.modelParametersUrl} disabled={isLoading} />
					<TextField label={i18n.t('elygate.field.mcpLibraryUrl')} bind:value={form.mcpLibraryUrl} disabled={isLoading} />
					<NumberField label={i18n.t('elygate.field.mcpLibrarySyncInterval')} bind:value={form.mcpLibrarySyncInterval} min={0} disabled={isLoading} />
				</section>
			</div>
		{:else}
			<label class="json-editor">
				{i18n.t('elygate.requestJson')}
				<textarea bind:value={jsonText} rows="24" spellcheck="false" disabled={isLoading}></textarea>
			</label>
		{/if}

		<footer class="save-bar">
			<button class="primary" type="submit" disabled={isSaving || isLoading}>
				{isSaving ? i18n.t('elygate.saving') : i18n.t('elygate.save')}
			</button>
		</footer>
	</form>
</section>

<style>
	.page-shell { max-width: 1180px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: flex-start; display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .45rem; text-transform: uppercase; }
	h1 { margin: 0; font-size: clamp(1.5rem, 3vw, 2.15rem); }
	.page-heading p { color: var(--muted-foreground); margin: .55rem 0 0; max-width: 760px; }
	.heading-actions { align-items: center; display: flex; flex-wrap: wrap; gap: .5rem; justify-content: flex-end; }
	.mode-switch { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; display: flex; gap: .15rem; padding: .18rem; }
	.mode-switch button { background: transparent; border: 0; border-radius: .4rem; color: var(--muted-foreground); cursor: pointer; font-weight: 600; padding: .4rem .7rem; white-space: nowrap; }
	.mode-switch button.is-active { background: var(--background); color: var(--foreground); box-shadow: 0 1px 2px rgb(0 0 0 / .08); }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); cursor: pointer; font-weight: 600; padding: .55rem .75rem; white-space: nowrap; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button:disabled { cursor: wait; opacity: .55; }

	.status-grid { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-bottom: 1.25rem; }
	.status-item { align-items: center; border: 1px solid var(--border); border-radius: .55rem; display: flex; gap: .45rem; padding: .55rem .7rem; }
	.dot { border-radius: 50%; flex: none; height: .5rem; width: .5rem; }
	.dot.ok { background: var(--primary); }
	.dot.off { background: var(--muted-foreground); opacity: .5; }
	.status-name { color: var(--foreground); font-size: .78rem; font-weight: 600; }
	.status-item strong { font-size: .72rem; font-weight: 600; margin-left: auto; }
	.ok-text { color: var(--primary); }
	.off-text { color: var(--muted-foreground); }

	form { display: grid; gap: 1rem; }
	.section-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); align-items: start; }
	.config-section { border: 1px solid var(--border); border-radius: .65rem; padding: .35rem 1rem .8rem; }
	.config-section h2 { font-size: .95rem; margin: .65rem 0 .25rem; }
	.json-editor { color: var(--foreground); display: grid; font-size: .85rem; font-weight: 650; gap: .35rem; }
	textarea { background: var(--background); border: 1px solid var(--border); border-radius: .65rem; color: var(--foreground); font: 0.8rem ui-monospace, SFMono-Regular, Menlo, monospace; padding: .85rem; resize: vertical; width: 100%; }

	.notice { border-radius: .65rem; margin-bottom: 1rem; padding: .75rem 1rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	.notice.success { background: color-mix(in oklch, var(--primary) 12%, transparent); color: var(--primary); }
	.notice.warning { background: color-mix(in oklch, var(--warning, #d97706) 12%, transparent); color: var(--warning, #b45309); }

	.save-bar { display: flex; justify-content: flex-end; position: sticky; bottom: 0; background: var(--background); border-top: 1px solid var(--border); padding: .75rem 0; }

	@media (max-width: 760px) {
		.page-heading { align-items: stretch; flex-direction: column; }
		.heading-actions { justify-content: stretch; }
		.heading-actions > button { flex: 1; }
		.mode-switch { flex: 1; }
		.mode-switch button { flex: 1; }
	}
</style>
