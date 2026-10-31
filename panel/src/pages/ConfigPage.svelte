<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { useNotification } from '@svadmin/core';
	import { Button, ContentPageHeader, ContentPageShell, FeedbackNotice, SaveButton, SettingsGroup } from '@svadmin/ui';
	import { RefreshCw, RotateCw } from '@lucide/svelte';
	import { displayError, parseJsonObject, prettyJson } from '../lib/forms';
	import { isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { getAppName, resolveAppName, setAppName } from '../lib/branding';
	import {
		DUAL_CREDENTIAL_BEHAVIORS,
		MCP_CODE_MODE_BINDING_LEVELS,
		MCP_SERVER_AUTH_MODES,
		configFormFromDocument,
		mergeConfigForm,
		persistAndReloadConfigDocument,
		type ConfigForm,
	} from '../lib/config-form';
	import SwitchField from '../lib/fields/SwitchField.svelte';
	import TextField from '../lib/fields/TextField.svelte';
	import NumberField from '../lib/fields/NumberField.svelte';
	import SelectField from '../lib/fields/SelectField.svelte';

	type Mode = 'form' | 'json';
	type ConfigSection = 'auth' | 'logging' | 'security' | 'performance' | 'compat' | 'mcp' | 'framework';

	interface Props { resourceName: string; }

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	const notification = useNotification();
	const sectionMap: Record<string, ConfigSection[]> = {
		'client-settings': ['security', 'performance'],
		'compatibility-config': ['compat'],
		'security-config': ['auth', 'security'],
		'performance-config': ['performance'],
		'logging-config': ['logging'],
		'observability-config': ['logging', 'performance'],
		'pricing-config': ['framework'],
		'mcp-settings': ['mcp'],
		'mcp-gateway-config': ['mcp', 'framework'],
		'large-payload-config': ['security'],
	};
	const titleKeys: Record<string, string> = {
		'client-settings': 'elygate.clientSettings',
		'compatibility-config': 'elygate.compatibilityConfig',
		'security-config': 'elygate.securityConfig',
		'performance-config': 'elygate.performanceConfig',
		'logging-config': 'elygate.loggingConfig',
		'observability-config': 'elygate.observabilityConfig',
		'pricing-config': 'elygate.pricingConfig',
		'mcp-settings': 'elygate.mcpSettings',
		'mcp-gateway-config': 'elygate.mcpGatewayConfig',
		'large-payload-config': 'elygate.largePayloadConfig',
	};

	const sectionLabels: Record<string, string> = {
		config: 'elygate.system',
		'client-settings': 'elygate.system',
		'compatibility-config': 'elygate.system',
		'security-config': 'elygate.system',
		'performance-config': 'elygate.system',
		'logging-config': 'elygate.system',
		'pricing-config': 'elygate.system',
		'observability-config': 'elygate.observability',
		'mcp-settings': 'elygate.mcp',
		'mcp-gateway-config': 'elygate.system',
		'large-payload-config': 'elygate.system',
	};
	const eyebrow = $derived(`${getAppName()} / ${i18n.t(sectionLabels[resourceName] ?? 'elygate.system')}`);
	const titleKey = $derived(titleKeys[resourceName] ?? 'elygate.config');

	let rawConfig = $state<JsonRecord>({});
	let form = $state<ConfigForm>(configFormFromDocument({}));
	let jsonText = $state('');
	let mode = $state<Mode>('form');
	let error = $state('');
	let notice = $state('');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let loadSeq = 0;

	function connectionValue(key: string): boolean | null {
		return typeof rawConfig[key] === 'boolean' ? rawConfig[key] : null;
	}

	const statusItems = $derived.by(() => [
		{ key: 'database', ok: connectionValue('is_db_connected'), kind: 'connected' as const },
		{ key: 'logs', ok: connectionValue('is_logs_connected'), kind: 'connected' as const },
		{ key: 'cache', ok: connectionValue('is_cache_connected'), kind: 'connected' as const, href: '#/caching-config' },
		{ key: 'objectStorage', ok: connectionValue('is_object_storage_connected'), kind: 'connected' as const },
		{ key: 'git', ok: connectionValue('is_git_available'), kind: 'available' as const },
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
		resolveAppName(doc);
	}

	async function load(): Promise<void> {
		const sequence = ++loadSeq;
		isLoading = true;
		error = '';
		notice = '';
		try {
			const document = await requestJson('/api/config');
			if (sequence !== loadSeq) return;
			applyDocument(document as JsonRecord);
		} catch (cause) {
			if (sequence === loadSeq) error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			if (sequence === loadSeq) isLoading = false;
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
		if (isSaving) return;
		const saveMode = mode;
		const saveJsonText = jsonText;
		const saveFormSnapshot = JSON.stringify(form);
		const saveAppName = form.appName;
		isSaving = true;
		error = '';
		notice = '';
		try {
			const body =
				mode === 'json'
					? parseJsonObject(jsonText, i18n.t('elygate.config'), i18n.t('elygate.invalidJson'))
					: mergeConfigForm(rawConfig, form);
			const result = await persistAndReloadConfigDocument(
				body,
				(document) => requestJson('/api/config', { method: 'PUT', body: JSON.stringify(document) }),
				() => requestJson('/api/config'),
			);
			const contextMatches = mode === saveMode && jsonText === saveJsonText && JSON.stringify(form) === saveFormSnapshot;
			if (!contextMatches) return;
			setAppName(saveAppName);
			if (result.document) {
				applyDocument(result.document);
				notification.success(i18n.t('elygate.saveSuccess'), 3000);
			} else {
				notice = i18n.t('elygate.configSavedRefreshFailed');
			}
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

	function shows(section: ConfigSection): boolean {
		return resourceName === 'config' || (sectionMap[resourceName] ?? []).includes(section);
	}

	async function forcePricingSync(): Promise<void> {
		if (isSaving) return;
		isSaving = true;
		error = '';
		try {
			await requestJson('/api/pricing/force-sync', { method: 'POST' });
			notification.open(i18n.t('elygate.pricingSyncStarted'), 3000);
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.operationFailed'));
		} finally {
			isSaving = false;
		}
	}

	onMount(() => {
		void load();
	});
</script>

<ContentPageShell pageId={resourceName} width="wide">
	<ContentPageHeader title={i18n.t(titleKey)} {eyebrow}>
		{#snippet actions()}
		<div class="heading-actions">
			{#if resourceName === 'pricing-config'}
				<Button type="button" variant="outline" onclick={() => void forcePricingSync()} disabled={isLoading || isSaving}>
					<RotateCw size={16} aria-hidden="true" />{i18n.t('elygate.syncPricing')}
				</Button>
			{/if}
			<div class="mode-switch" role="group" aria-label={i18n.t('elygate.config')}>
				<button type="button" class:is-active={mode === 'form'} aria-pressed={mode === 'form'} onclick={() => switchMode('form')} disabled={isLoading || isSaving}>
					{i18n.t('elygate.formMode')}
				</button>
				<button type="button" class:is-active={mode === 'json'} aria-pressed={mode === 'json'} onclick={() => switchMode('json')} disabled={isLoading || isSaving}>
					{i18n.t('elygate.jsonMode')}
				</button>
			</div>
			<Button variant="outline" type="button" onclick={() => void load()} disabled={isLoading || isSaving}>
				<RefreshCw size={16} aria-hidden="true" />{i18n.t('elygate.refresh')}
			</Button>
		</div>
		{/snippet}
	</ContentPageHeader>

	<div class="status-grid" aria-label={i18n.t('elygate.connectionStatus')}>
		{#each statusItems as item (item.key)}
			<a class="status-item" class:is-link={Boolean(item.href)} href={item.href ?? undefined}>
				<span class={['dot', item.ok === true ? 'ok' : item.ok === false ? 'off' : 'unknown']}></span>
				<span class="status-name">{i18n.t(`elygate.conn.${item.key}`)}</span>
				<strong class={item.ok === true ? 'ok-text' : item.ok === false ? 'off-text' : 'unknown-text'}>
					{item.ok === null
						? i18n.t(isLoading ? 'elygate.conn.checking' : 'elygate.conn.unknown')
						: item.ok
						? i18n.t(item.kind === 'connected' ? 'elygate.conn.connected' : 'elygate.conn.available')
						: i18n.t(item.kind === 'connected' ? 'elygate.conn.disconnected' : 'elygate.conn.unavailable')}
				</strong>
			</a>
		{/each}
	</div>

	{#if error}
		<FeedbackNotice tone="danger" message={error} />
	{:else if notice}
		<FeedbackNotice tone="warning" message={notice} />
	{/if}
	{#if restartRequired !== null}
		<FeedbackNotice tone="warning" message={`${i18n.t('elygate.restartRequired')}${restartRequired ? ` ${restartRequired}` : ''}`} />
	{/if}

	<form onsubmit={submit}>
		{#if mode === 'form'}
			<div class="section-grid">
				{#if shows('auth')}<SettingsGroup title={i18n.t('elygate.section.auth')}>
					<SwitchField label={i18n.t('elygate.field.authEnabled')} bind:checked={form.authEnabled} disabled={isLoading || isSaving} />
					<TextField label={i18n.t('elygate.field.adminUsername')} bind:value={form.adminUsername} autocomplete="username" disabled={isLoading || isSaving} />
					<TextField
						label={i18n.t('elygate.field.adminPassword')}
						hint={i18n.t('elygate.field.adminPasswordHint')}
						bind:value={form.adminPassword}
						secret
						autocomplete="new-password"
						disabled={isLoading || isSaving}
					/>
				</SettingsGroup>{/if}

				{#if shows('logging')}<SettingsGroup title={i18n.t('elygate.section.logging')}>
					<SwitchField label={i18n.t('elygate.field.enableLogging')} bind:checked={form.enableLogging} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.disableContentLogging')} bind:checked={form.disableContentLogging} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.retainContentInObjectStorage')} bind:checked={form.retainContentInObjectStorage} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.allowPerRequestContentStorageOverride')} bind:checked={form.allowPerRequestContentStorageOverride} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.allowPerRequestRawOverride')} bind:checked={form.allowPerRequestRawOverride} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.dumpErrorsInConsoleLogs')} bind:checked={form.dumpErrorsInConsoleLogs} disabled={isLoading || isSaving} />
					<NumberField label={i18n.t('elygate.field.logRetentionDays')} bind:value={form.logRetentionDays} min={0} disabled={isLoading || isSaving} />
				</SettingsGroup>{/if}

				{#if shows('security')}<SettingsGroup title={i18n.t('elygate.section.security')}>
					<TextField label={i18n.t('elygate.field.appName')} hint={i18n.t('elygate.field.appNameHint')} bind:value={form.appName} placeholder={getAppName()} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.allowDirectKeys')} bind:checked={form.allowDirectKeys} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.enforceAuthOnInference')} bind:checked={form.enforceAuthOnInference} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.disableDbPingsInHealth')} bind:checked={form.disableDbPingsInHealth} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.dropExcessRequests')} bind:checked={form.dropExcessRequests} disabled={isLoading || isSaving} />
					<SelectField label={i18n.t('elygate.field.dualCredentialConflictBehavior')} bind:value={form.dualCredentialConflictBehavior} options={dualCredentialOptions} disabled={isLoading || isSaving} />
					<TextField label={i18n.t('elygate.field.allowedOrigins')} hint={i18n.t('elygate.field.csvHint')} bind:value={form.allowedOrigins} placeholder="*" disabled={isLoading || isSaving} />
					<NumberField label={i18n.t('elygate.field.maxRequestBodySizeMb')} bind:value={form.maxRequestBodySizeMb} min={1} disabled={isLoading || isSaving} />
				</SettingsGroup>{/if}

				{#if shows('performance')}<SettingsGroup title={i18n.t('elygate.section.performance')}>
					<NumberField label={i18n.t('elygate.field.initialPoolSize')} bind:value={form.initialPoolSize} min={0} disabled={isLoading || isSaving} />
					<TextField label={i18n.t('elygate.field.prometheusLabels')} hint={i18n.t('elygate.field.csvHint')} bind:value={form.prometheusLabels} disabled={isLoading || isSaving} />
					<NumberField label={i18n.t('elygate.field.asyncJobResultTtl')} bind:value={form.asyncJobResultTtl} min={0} disabled={isLoading || isSaving} />
					<NumberField label={i18n.t('elygate.field.routingChainMaxDepth')} bind:value={form.routingChainMaxDepth} min={1} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.hideDeletedVirtualKeysInFilters')} bind:checked={form.hideDeletedVirtualKeysInFilters} disabled={isLoading || isSaving} />
				</SettingsGroup>{/if}

				{#if shows('compat')}<SettingsGroup title={i18n.t('elygate.section.compat')}>
					<SwitchField label={i18n.t('elygate.field.compatConvertTextToChat')} bind:checked={form.compatConvertTextToChat} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.compatConvertChatToResponses')} bind:checked={form.compatConvertChatToResponses} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.compatShouldDropParams')} bind:checked={form.compatShouldDropParams} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.compatShouldConvertParams')} bind:checked={form.compatShouldConvertParams} disabled={isLoading || isSaving} />
				</SettingsGroup>{/if}

				{#if shows('mcp')}<SettingsGroup title={i18n.t('elygate.section.mcp')}>
					<NumberField label={i18n.t('elygate.field.mcpAgentDepth')} bind:value={form.mcpAgentDepth} min={0} disabled={isLoading || isSaving} />
					<NumberField label={i18n.t('elygate.field.mcpToolExecutionTimeout')} bind:value={form.mcpToolExecutionTimeout} min={0} disabled={isLoading || isSaving} />
					<SelectField label={i18n.t('elygate.field.mcpCodeModeBindingLevel')} bind:value={form.mcpCodeModeBindingLevel} options={codeModeBindingOptions} disabled={isLoading || isSaving} />
					<NumberField label={i18n.t('elygate.field.mcpToolSyncInterval')} bind:value={form.mcpToolSyncInterval} min={0} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.mcpDisableAutoToolInject')} bind:checked={form.mcpDisableAutoToolInject} disabled={isLoading || isSaving} />
					<SwitchField label={i18n.t('elygate.field.mcpEnableTempTokenAuth')} bind:checked={form.mcpEnableTempTokenAuth} disabled={isLoading || isSaving} />
					<TextField label={i18n.t('elygate.field.mcpExternalClientUrl')} bind:value={form.mcpExternalClientUrl} disabled={isLoading || isSaving} />
					<SelectField label={i18n.t('elygate.field.mcpServerAuthMode')} bind:value={form.mcpServerAuthMode} options={mcpAuthModeOptions} disabled={isLoading || isSaving} />
				</SettingsGroup>{/if}

				{#if shows('framework')}<SettingsGroup title={i18n.t('elygate.section.framework')}>
					<TextField label={i18n.t('elygate.field.pricingUrl')} bind:value={form.pricingUrl} disabled={isLoading || isSaving} />
					<NumberField label={i18n.t('elygate.field.pricingSyncInterval')} bind:value={form.pricingSyncInterval} min={0} disabled={isLoading || isSaving} />
					<TextField label={i18n.t('elygate.field.modelParametersUrl')} bind:value={form.modelParametersUrl} disabled={isLoading || isSaving} />
					<TextField label={i18n.t('elygate.field.mcpLibraryUrl')} bind:value={form.mcpLibraryUrl} disabled={isLoading || isSaving} />
					<NumberField label={i18n.t('elygate.field.mcpLibrarySyncInterval')} bind:value={form.mcpLibrarySyncInterval} min={0} disabled={isLoading || isSaving} />
				</SettingsGroup>{/if}
			</div>
		{:else}
			<label class="json-editor">
				{i18n.t('elygate.requestJson')}
				<textarea bind:value={jsonText} rows="24" spellcheck="false" disabled={isLoading || isSaving}></textarea>
			</label>
		{/if}

		<fieldset class="save-bar" disabled={isLoading || isSaving}>
			<SaveButton loading={isSaving} label={isSaving ? i18n.t('elygate.saving') : i18n.t('elygate.save')} />
		</fieldset>
	</form>
</ContentPageShell>

<style>
	.heading-actions { align-items: center; display: flex; flex-wrap: wrap; gap: .5rem; justify-content: flex-end; }
	.mode-switch { background: var(--muted); border: 1px solid var(--border); border-radius: .5rem; display: flex; gap: .15rem; padding: .18rem; }
	.mode-switch button { background: transparent; border: 0; border-radius: .4rem; color: var(--muted-foreground); cursor: pointer; font-weight: 600; padding: .4rem .7rem; white-space: nowrap; }
	.mode-switch button.is-active { background: var(--background); color: var(--foreground); box-shadow: 0 1px 2px rgb(0 0 0 / .08); }
	.mode-switch button:disabled { cursor: wait; opacity: .55; }
	.mode-switch button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

	.status-grid { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1.25rem; }
	.status-item { align-items: center; border: 1px solid var(--border); border-radius: .55rem; display: grid; flex: 1 1 170px; gap: .45rem; grid-template-columns: auto minmax(0, 1fr) auto; min-height: 2.65rem; padding: .55rem .7rem; }
	.status-item { color: inherit; text-decoration: none; }
	.status-item.is-link { cursor: pointer; }
	.status-item.is-link:hover { background: var(--accent); border-color: color-mix(in oklch, var(--primary) 45%, var(--border)); }
	.dot { border-radius: 50%; flex: none; height: .5rem; width: .5rem; }
	.dot.ok { background: var(--primary); }
	.dot.off { background: var(--muted-foreground); opacity: .5; }
	.dot.unknown { background: var(--muted-foreground); opacity: .3; }
	.status-name { color: var(--foreground); font-size: .78rem; font-weight: 600; min-width: 0; }
	.status-item strong { font-size: .72rem; font-weight: 600; white-space: nowrap; }
	.ok-text { color: var(--primary); }
	.off-text { color: var(--muted-foreground); }
	.unknown-text { color: var(--muted-foreground); }

	form { display: grid; gap: 1rem; }
	.section-grid { display: grid; gap: 1.5rem; min-width: 0; }
	.json-editor { color: var(--foreground); display: grid; font-size: .85rem; font-weight: 650; gap: .35rem; }
	textarea { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; box-sizing: border-box; color: var(--foreground); font: 0.8rem ui-monospace, SFMono-Regular, Menlo, monospace; padding: .85rem; resize: vertical; width: 100%; }
	textarea:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

	.save-bar { border: 0; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; margin: 0; min-width: 0; padding: .75rem 0; }

	@media (max-width: 760px) {
		.heading-actions { justify-content: stretch; }
		.heading-actions :global([data-slot='button']) { flex: 1; }
		.mode-switch { flex: 1; }
		.mode-switch button { flex: 1; }
	}
	@media (max-width: 480px) {
		.status-item { flex-basis: 100%; }
	}
</style>
