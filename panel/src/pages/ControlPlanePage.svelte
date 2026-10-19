<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { getAppName } from '../lib/branding';
	import { displayError } from '../lib/forms';
	import { getListPayload, requestJson, type JsonRecord } from '../lib/api';

	interface Props { resourceName: string; }
	interface ControlPlaneTab {
		id: string;
		label: string;
		endpoint: string;
		columns: { key: string; label: string }[];
	}

	let { resourceName }: Props = $props();
	const i18n = useTranslation();
	const appName = getAppName();

	const tabs: ControlPlaneTab[] = [
		{
			id: 'control-plane-projects',
			label: 'Projects',
			endpoint: '/api/control-plane/projects',
			columns: [
				{ key: 'id', label: 'ID' },
				{ key: 'name', label: 'Name' },
				{ key: 'organization_id', label: 'Organization' },
				{ key: 'status', label: 'Status' },
			],
		},
		{
			id: 'control-plane-applications',
			label: 'Applications',
			endpoint: '/api/control-plane/projects',
			columns: [
				{ key: 'id', label: 'ID' },
				{ key: 'name', label: 'Name' },
				{ key: 'environment', label: 'Environment' },
				{ key: 'status', label: 'Status' },
			],
		},
		{
			id: 'control-plane-usage',
			label: 'Usage',
			endpoint: '/api/control-plane/usage',
			columns: [
				{ key: 'virtual_key_id', label: 'Virtual key' },
				{ key: 'application_id', label: 'Application' },
				{ key: 'provider', label: 'Provider' },
				{ key: 'model', label: 'Model' },
				{ key: 'total_tokens', label: 'Tokens' },
				{ key: 'cost', label: 'Cost' },
			],
		},
	];

	const activeTab = $derived(tabs.find((tab) => tab.id === resourceName) ?? tabs[0]);
	let rows = $state.raw<JsonRecord[]>([]);
	let loading = $state(true);
	let error = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			const payload = await requestJson<unknown>(activeTab.endpoint);
			rows = getListPayload(payload);
		} catch (cause) {
			error = displayError(cause, 'Failed to load control-plane data.');
			rows = [];
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});

	$effect(() => {
		// Reload whenever the routed resource changes.
		activeTab;
		void load();
	});

	function cell(row: JsonRecord, key: string) {
		const value = row[key];
		if (value === null || value === undefined) return '—';
		if (typeof value === 'object') return JSON.stringify(value);
		return String(value);
	}
</script>

<svelte:head>
	<title>{activeTab.label} · {appName}</title>
</svelte:head>

<section class="page">
	<header>
		<div>
			<h1>{activeTab.label}</h1>
			<p>{i18n.t('elygate.controlPlaneHint') || 'Control-plane projects, applications and usage ledger.'}</p>
		</div>
		<button class="secondary" onclick={() => void load()} disabled={loading}>Reload</button>
	</header>

	{#if error}
		<div class="error" role="alert">{error}</div>
	{/if}

	<div class="card">
		{#if loading}
			<p class="muted">Loading…</p>
		{:else if rows.length === 0}
			<p class="muted">No records yet.</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							{#each activeTab.columns as column (column.key)}
								<th>{column.label}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each rows as row, index (String(row.id ?? index))}
							<tr>
								{#each activeTab.columns as column (column.key)}
									<td>{cell(row, column.key)}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</section>

<style>
	.page { display: grid; gap: 1rem; }
	header { display: flex; align-items: end; justify-content: space-between; gap: 1rem; }
	h1 { font-size: 1.35rem; margin: 0; }
	header p { color: var(--muted-foreground); margin: .35rem 0 0; }
	.card { background: var(--card); border: 1px solid var(--border); border-radius: .8rem; padding: 1rem; overflow: hidden; }
	.table-wrap { overflow: auto; }
	table { border-collapse: collapse; width: 100%; font-size: .85rem; }
	th, td { text-align: left; padding: .55rem .65rem; border-bottom: 1px solid var(--border); white-space: nowrap; }
	th { color: var(--muted-foreground); font-weight: 600; }
	.muted { color: var(--muted-foreground); }
	.error { background: color-mix(in srgb, var(--destructive) 12%, transparent); border: 1px solid var(--destructive); border-radius: .6rem; padding: .7rem .9rem; }
</style>