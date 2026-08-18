<script lang="ts">
	import { onMount } from 'svelte';
	import { getListPayload, getSessionStatus, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';
	import { labelFor, type ElygateLocale } from '../lib/i18n';
	import { isVersionNewer } from '../lib/version';

	interface Props { locale: ElygateLocale; }
	interface ChecklistItem { label: string; complete: boolean; href: string; }

	let { locale }: Props = $props();
	let visible = $state(false);
	let expanded = $state(false);
	let version = $state('—');
	let latestVersion = $state('');
	let releaseNotesUrl = $state('');
	let releaseVisible = $state(false);
	let environment = $state('');
	let checklist = $state.raw<ChecklistItem[]>([]);

	function hasAuthConfig(config: JsonRecord): boolean {
		const auth = isJsonRecord(config.auth_config) ? config.auth_config : {};
		return auth.enabled === true || Object.keys(auth).length > 0;
	}

	async function getLatestRelease(): Promise<void> {
		let timeout: number | undefined;
		try {
			const response = await Promise.race([
				requestJson<JsonRecord>('/api/latest-release'),
				new Promise<undefined>((resolve) => {
					timeout = window.setTimeout(() => resolve(undefined), 3000);
				}),
			]);
			if (!response || !isJsonRecord(response)) return;
			const payload = response;
			latestVersion = String(payload.name ?? payload.tag ?? payload.version ?? '');
			releaseNotesUrl = String(payload.changelogUrl ?? payload.changelog_url ?? `https://docs.getbifrost.ai/changelogs/${latestVersion}`);
			releaseVisible = isVersionNewer(latestVersion, version) && window.localStorage.getItem(`elygate.release.dismissed.${latestVersion}`) !== 'true';
		} catch {
			latestVersion = '';
		} finally {
			if (timeout !== undefined) window.clearTimeout(timeout);
		}
	}

	async function load(): Promise<void> {
		try {
			const session = await getSessionStatus();
			if (!session.has_valid_token) return;
			const [versionPayload, providersPayload, keysPayload, clientsPayload, configPayload] = await Promise.all([
				requestJson<unknown>('/api/version').catch(() => undefined),
				requestJson<unknown>('/api/providers').catch(() => []),
				requestJson<unknown>('/api/governance/virtual-keys').catch(() => []),
				requestJson<unknown>('/api/mcp/clients').catch(() => []),
				requestJson<JsonRecord>('/api/config').catch(() => ({})),
			]);
			version = typeof versionPayload === 'string' ? versionPayload : isJsonRecord(versionPayload) ? String(versionPayload.version ?? versionPayload.tag ?? '—') : '—';
			void getLatestRelease();
			environment = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
				? labelFor(locale, 'elygate.localEnvironment')
				: labelFor(locale, 'elygate.deploymentEnvironment');
			checklist = [
				{ label: labelFor(locale, 'elygate.onboardingAuth'), complete: hasAuthConfig(configPayload), href: '#/security-config' },
				{ label: labelFor(locale, 'elygate.onboardingProvider'), complete: getListPayload(providersPayload).length > 0, href: '#/providers' },
				{ label: labelFor(locale, 'elygate.onboardingVirtualKey'), complete: getListPayload(keysPayload).length > 0, href: '#/virtual-keys' },
				{ label: labelFor(locale, 'elygate.onboardingMcp'), complete: getListPayload(clientsPayload).length > 0, href: '#/mcp-clients' },
			];
			visible = window.localStorage.getItem('elygate.panel-assist.dismissed') !== 'true';
		} catch {
			visible = false;
		}
	}

	function dismiss(): void {
		window.localStorage.setItem('elygate.panel-assist.dismissed', 'true');
		visible = false;
	}

	function dismissRelease(): void {
		window.localStorage.setItem(`elygate.release.dismissed.${latestVersion}`, 'true');
		releaseVisible = false;
	}

	onMount(() => {
		void load();
	});
</script>

{#if releaseVisible}
	<aside class="release" aria-label={labelFor(locale, 'elygate.updateAvailable')}>
		<div><strong>{latestVersion} {labelFor(locale, 'elygate.updateAvailable')}</strong><span>{labelFor(locale, 'elygate.updateAvailableHint')}</span></div>
		<a href={releaseNotesUrl} target="_blank" rel="noopener noreferrer">{labelFor(locale, 'elygate.releaseNotes')} ↗</a>
		<button type="button" onclick={dismissRelease} aria-label={labelFor(locale, 'elygate.close')}>×</button>
	</aside>
{/if}

{#if visible}
	<aside class="assist" aria-label={labelFor(locale, 'elygate.onboarding')}>
		<header><button class="summary" type="button" onclick={() => (expanded = !expanded)}><strong>Elygate {version}</strong><span>{environment}</span></button><button class="close" type="button" onclick={dismiss} aria-label={labelFor(locale, 'elygate.close')}>×</button></header>
		{#if expanded}<div class="body"><p>{labelFor(locale, 'elygate.onboardingHint')}</p>{#each checklist as item (item.href)}<a href={item.href} class:complete={item.complete}><span>{item.complete ? '✓' : '○'}</span>{item.label}</a>{/each}<a class="docs" href="#/docs-hub">{labelFor(locale, 'elygate.openDocs')} →</a></div>{/if}
	</aside>
{/if}

<style>
	.release{align-items:center;background:color-mix(in oklch,var(--primary) 12%,var(--card));border:1px solid color-mix(in oklch,var(--primary) 45%,var(--border));border-radius:.8rem;bottom:1rem;box-shadow:0 16px 40px rgb(0 0 0/.14);display:flex;gap:.75rem;left:50%;max-width:min(42rem,calc(100vw - 2rem));padding:.7rem .85rem;position:fixed;transform:translateX(-50%);width:max-content;z-index:56}.release div{display:grid;gap:.1rem}.release span{color:var(--muted-foreground);font-size:.72rem}.release a{color:var(--primary);font-size:.78rem;font-weight:700;text-decoration:none;white-space:nowrap}.release button{background:transparent;border:0;color:var(--muted-foreground);cursor:pointer;font-size:1.1rem}.assist{background:color-mix(in oklch,var(--card) 96%,transparent);border:1px solid var(--border);border-radius:.8rem;bottom:1rem;box-shadow:0 16px 40px rgb(0 0 0/.14);max-width:20rem;overflow:hidden;position:fixed;right:1rem;width:calc(100vw - 2rem);z-index:55}.release~.assist{bottom:5.2rem}.assist header{align-items:center;border-bottom:1px solid var(--border);display:flex}.summary{align-items:flex-start;background:transparent;border:0;color:var(--foreground);cursor:pointer;display:grid;flex:1;gap:.1rem;padding:.7rem .85rem;text-align:left}.summary span{color:var(--muted-foreground);font-size:.7rem}.close{background:transparent;border:0;color:var(--muted-foreground);cursor:pointer;font-size:1.2rem;padding:.7rem}.body{display:grid;gap:.45rem;padding:.75rem .85rem}.body p{color:var(--muted-foreground);font-size:.75rem;margin:0 0 .25rem}.body a{align-items:center;color:var(--foreground);display:flex;font-size:.78rem;gap:.45rem;text-decoration:none}.body a span{color:var(--muted-foreground);font-weight:800}.body a.complete{color:var(--muted-foreground);text-decoration:line-through}.body a.complete span{color:#16a34a}.body a.docs{color:var(--primary);font-weight:700;margin-top:.25rem;text-decoration:none}@media(max-width:560px){.release{align-items:flex-start;bottom:.75rem;flex-wrap:wrap;width:calc(100vw - 1.5rem)}.release div{flex:1}.assist{bottom:.75rem;right:.75rem;width:calc(100vw - 1.5rem)}.release~.assist{bottom:7.5rem}}
</style>
