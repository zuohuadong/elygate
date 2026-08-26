<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError } from '../lib/forms';
	import { getListPayload, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { configFormFromDocument } from '../lib/config-form';

	interface Props { resourceName: string; }
	type Harness = 'claude-code' | 'codex' | 'cursor' | 'cline' | 'vscode' | 'opencode' | 'windsurf' | 'antigravity';

	const harnesses: { id: Harness; label: string }[] = [
		{ id: 'claude-code', label: 'Claude Code' },
		{ id: 'codex', label: 'Codex' },
		{ id: 'cursor', label: 'Cursor' },
		{ id: 'cline', label: 'Cline' },
		{ id: 'vscode', label: 'VS Code' },
		{ id: 'opencode', label: 'OpenCode' },
		{ id: 'windsurf', label: 'Windsurf' },
		{ id: 'antigravity', label: 'Antigravity' },
	];

	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let virtualKeys = $state.raw<JsonRecord[]>([]);
	let clients = $state.raw<JsonRecord[]>([]);
	let selectedVirtualKeyId = $state('');
	let selectedClientIds = $state<string[]>([]);
	let harness = $state<Harness>('claude-code');
	let gatewayBaseUrl = $state('');
	let isLoading = $state(true);
	let error = $state('');
	let copied = $state(false);

	const selectedVirtualKey = $derived(virtualKeys.find((item) => String(item.id ?? '') === selectedVirtualKeyId));
	const allowedClients = $derived.by(() => {
		if (!selectedVirtualKey) return [];
		return clients.filter((client) => {
			const config = isJsonRecord(client.config) ? client.config : {};
			if (config.disabled === true) return false;
			if (config.allow_on_all_virtual_keys === true) return true;
			const assignments = Array.isArray(client.vk_configs) ? client.vk_configs : [];
			return assignments.some((assignment) => isJsonRecord(assignment) && assignment.virtual_key_id === selectedVirtualKey.id);
		});
	});
	const selectedClients = $derived(
		allowedClients.filter((client) => selectedClientIds.includes(clientId(client))),
	);
	const command = $derived(buildHarnessConfig(harness, gatewayUrl(), selectedVirtualKey, selectedClients));

	function secretValue(record: JsonRecord | undefined): string {
		return typeof record?.value === 'string' ? record.value : '';
	}

	function clientConfig(client: JsonRecord): JsonRecord {
		return isJsonRecord(client.config) ? client.config : {};
	}

	function clientId(client: JsonRecord): string {
		const config = clientConfig(client);
		return String(config.client_id ?? config.name ?? '');
	}

	function clientName(client: JsonRecord): string {
		const config = clientConfig(client);
		return String(config.name ?? config.client_id ?? 'MCP');
	}

	function gatewayUrl(): string {
		return `${gatewayBaseUrl.replace(/\/+$/, '')}/mcp`;
	}

	function shellQuote(value: string): string {
		if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) return value;
		return `"${value.replace(/(["\\$`])/g, '\\$1').replace(/\n/g, '\\n')}"`;
	}

	function tomlQuote(value: string): string {
		return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
	}

	function requestHeaders(virtualKey: JsonRecord | undefined, selected: JsonRecord[]): Record<string, string> {
		const headers: Record<string, string> = {};
		const value = typeof virtualKey?.value === 'string' ? virtualKey.value : '';
		if (value) headers['x-bf-vk'] = value;
		if (selected.length) headers['x-bf-mcp-include-clients'] = selected.map(clientName).join(',');
		return headers;
	}

	function buildHarnessConfig(activeHarness: Harness, url: string, virtualKey: JsonRecord | undefined, selected: JsonRecord[]): string {
		if (!virtualKey) return '';
		const headers = requestHeaders(virtualKey, selected);
		const registrationName = selected.length === 1 ? clientName(selected[0]) : getAppName().toLowerCase();
		if (activeHarness === 'claude-code') {
			const headerArgs = Object.entries(headers).map(([key, value]) => `  --header ${shellQuote(`${key}: ${value}`)}`).join(' \\\n');
			return `claude mcp add --transport http ${shellQuote(registrationName)} --scope user ${shellQuote(url)} \\\n${headerArgs}`;
		}
		if (activeHarness === 'codex') {
			const tomlHeaders = Object.entries(headers).map(([key, value]) => `${tomlQuote(key)} = ${tomlQuote(value)}`).join(', ');
			return `[mcp_servers.${tomlQuote(registrationName)}]\nurl = ${tomlQuote(url)}\nhttp_headers = { ${tomlHeaders} }`;
		}
		const server = { url, headers };
		if (activeHarness === 'vscode') {
			return JSON.stringify({ servers: { [registrationName]: { type: 'http', ...server } } }, null, 2);
		}
		if (activeHarness === 'opencode') {
			return JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { [registrationName]: { type: 'remote', enabled: true, ...server } } }, null, 2);
		}
		if (activeHarness === 'windsurf' || activeHarness === 'antigravity') {
			return JSON.stringify({ mcpServers: { [registrationName]: { serverUrl: url, headers } } }, null, 2);
		}
		return JSON.stringify({ mcpServers: { [registrationName]: server } }, null, 2);
	}

	function toggleClient(id: string): void {
		selectedClientIds = selectedClientIds.includes(id)
			? selectedClientIds.filter((candidate) => candidate !== id)
			: [...selectedClientIds, id];
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const [virtualKeyResponse, clientResponse, configResponse] = await Promise.all([
				requestJson('/api/governance/virtual-keys?limit=100'),
				requestJson('/api/mcp/clients?limit=100'),
				requestJson<JsonRecord>('/api/config'),
			]);
			virtualKeys = getListPayload(virtualKeyResponse).filter((item) => item.is_active !== false);
			clients = getListPayload(clientResponse);
			selectedVirtualKeyId = String(virtualKeys[0]?.id ?? '');
			const configuredUrl = configFormFromDocument(configResponse).mcpExternalClientUrl.trim();
			gatewayBaseUrl = /^https?:\/\//i.test(configuredUrl) ? configuredUrl : window.location.origin;
		} catch (cause) {
			error = displayError(cause, i18n.t('elygate.loadFailed'));
		} finally {
			isLoading = false;
		}
	}

	async function copyCommand(): Promise<void> {
		if (!command) return;
		await navigator.clipboard.writeText(command);
		copied = true;
		window.setTimeout(() => (copied = false), 1800);
	}

	onMount(() => {
		void load();
	});
</script>

<section class="page-shell">
	<header class="page-heading">
		<div>
			<p class="eyebrow">{getAppName()} / MCP Gateway</p>
			<h1>{i18n.t('elygate.mcpUsageGuide')}</h1>
			<p>{i18n.t('elygate.mcpGuideHint')}</p>
		</div>
		<button type="button" onclick={() => void load()} disabled={isLoading}>{i18n.t('elygate.refresh')}</button>
	</header>

	{#if error}<div class="notice error" role="alert">{error}</div>{/if}
	<div class="layout" aria-busy={isLoading}>
		<div class="controls">
			<label>
				<span>{i18n.t('elygate.virtualKeys')}</span>
				<select bind:value={selectedVirtualKeyId} onchange={() => (selectedClientIds = [])} disabled={isLoading}>
					{#each virtualKeys as virtualKey (String(virtualKey.id))}
						<option value={String(virtualKey.id)}>{String(virtualKey.name ?? virtualKey.id)}</option>
					{/each}
				</select>
			</label>

			<label>
				<span>{i18n.t('elygate.mcpEndpoint')}</span>
				<input bind:value={gatewayBaseUrl} placeholder="https://gateway.example.com" />
			</label>

			<fieldset>
				<legend>{i18n.t('elygate.mcpServerScope')}</legend>
				<p>{i18n.t('elygate.mcpServerScopeHint')}</p>
				<div class="client-list">
					{#each allowedClients as client (clientId(client))}
						<label class="check-row">
							<input type="checkbox" checked={selectedClientIds.includes(clientId(client))} onchange={() => toggleClient(clientId(client))} />
							<span>{clientName(client)}</span>
						</label>
					{:else}
						<span class="muted">{i18n.t('elygate.noAllowedMcpClients')}</span>
					{/each}
				</div>
			</fieldset>

			<fieldset>
				<legend>{i18n.t('elygate.agentHarness')}</legend>
				<div class="harness-grid">
					{#each harnesses as item (item.id)}
						<button type="button" class:is-active={harness === item.id} onclick={() => (harness = item.id)}>{item.label}</button>
					{/each}
				</div>
			</fieldset>
		</div>

		<div class="output">
			<div class="output-heading">
				<strong>{i18n.t('elygate.generatedConfig')}</strong>
				<button type="button" onclick={() => void copyCommand()} disabled={!command}>{copied ? i18n.t('elygate.copied') : i18n.t('elygate.copy')}</button>
			</div>
			<pre>{command || i18n.t('elygate.selectVirtualKeyHint')}</pre>
			<p>{i18n.t('elygate.secretDisplayWarning')}</p>
		</div>
	</div>
</section>

<style>
	.page-shell { max-width: 1180px; margin: 0 auto; padding: 1.5rem; }
	.page-heading { align-items: start; display: flex; gap: 1rem; justify-content: space-between; margin-bottom: 1.5rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .45rem; text-transform: uppercase; }
	h1 { font-size: clamp(1.5rem, 3vw, 2.15rem); margin: 0; }
	.page-heading p, .muted, fieldset p, .output p { color: var(--muted-foreground); }
	.page-heading p { line-height: 1.6; margin: .55rem 0 0; max-width: 720px; }
	.layout { display: grid; gap: 1rem; grid-template-columns: minmax(300px, .85fr) minmax(0, 1.15fr); }
	.controls, .output { background: var(--card); border: 1px solid var(--border); border-radius: .9rem; padding: 1rem; }
	.controls { display: grid; gap: 1rem; }
	label, fieldset { display: grid; gap: .4rem; }
	label > span, legend { font-size: .85rem; font-weight: 700; }
	input, select { background: var(--background); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); padding: .65rem .7rem; width: 100%; }
	fieldset { border: 1px solid var(--border); border-radius: .65rem; margin: 0; padding: .8rem; }
	fieldset p { font-size: .8rem; margin: 0; }
	.client-list { display: grid; gap: .35rem; max-height: 190px; overflow: auto; }
	.check-row { align-items: center; display: flex; gap: .55rem; }
	.check-row input { height: 1rem; width: 1rem; }
	.harness-grid { display: flex; flex-wrap: wrap; gap: .4rem; }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); cursor: pointer; font-weight: 650; padding: .55rem .7rem; }
	button.is-active, .page-heading > button { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
	button:disabled { cursor: wait; opacity: .55; }
	.output-heading { align-items: center; display: flex; justify-content: space-between; }
	pre { background: color-mix(in oklch, var(--foreground) 5%, var(--background)); border: 1px solid var(--border); border-radius: .65rem; min-height: 330px; overflow: auto; padding: 1rem; white-space: pre-wrap; word-break: break-word; }
	.output p { font-size: .8rem; margin: .7rem 0 0; }
	.notice { border-radius: .65rem; margin-bottom: 1rem; padding: .75rem 1rem; }
	.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); }
	@media (max-width: 820px) { .layout { grid-template-columns: 1fr; } .page-heading { flex-direction: column; } }
</style>
