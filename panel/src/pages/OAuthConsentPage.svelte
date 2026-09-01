<script lang="ts">
	import { getAppName } from '../lib/branding';
	import { onMount } from 'svelte';
	import { isJsonRecord, type JsonRecord } from '../lib/api';
	import { expiryMinutes, isSafeOAuthRedirect, tempTokenFromFragment } from '../lib/oauth-consent';

	type ConsentMode = 'vk' | 'session' | 'user';
	interface Props { resourceName?: string; }
	interface ConsentFlow {
		client_name: string;
		available_modes: ConsentMode[];
		logged_in_user?: { id: string; name?: string };
		expires_at: string;
	}

	let { resourceName: _resourceName = 'oauth-consent' }: Props = $props();
	const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
	const copy = zh ? {
		missingTitle: '缺少授权流程标识', missingHint: '链接缺少 flow 参数，请从 MCP 客户端重新发起连接。',
		loading: '正在加载授权请求…', unavailableTitle: '授权链接不可用', unavailableHint: '链接可能已过期、已使用，或临时令牌已失效。请从 MCP 客户端重新发起连接。',
		connectTitle: `请求连接到 ${getAppName()}`, connectHint: '请选择用于此次 MCP 连接的身份。', noModes: '当前没有可用的认证方式。',
		account: '已登录账户', continueAs: '以此账户继续', virtualKey: '虚拟密钥', virtualKeyHint: '使用当前工作区中的 sk-bf-* 虚拟密钥。',
		connectKey: '使用密钥连接', anonymous: '匿名会话', anonymousHint: '不绑定账户或虚拟密钥。', continueAnonymous: '匿名继续',
		expires: '此链接将在约 {minutes} 分钟后过期。', soon: '此链接即将过期。', connecting: '正在连接…', failed: '授权失败', unsafeRedirect: '服务端返回了不安全的跳转地址。',
	} : {
		missingTitle: 'Missing flow identifier', missingHint: 'This URL is missing the flow parameter. Restart the connection from your MCP client.',
		loading: 'Loading authorization request…', unavailableTitle: 'Authorization link unavailable', unavailableHint: 'The link may be expired, already used, or missing its temporary token. Restart the connection from your MCP client.',
		connectTitle: `wants to connect to ${getAppName()}`, connectHint: 'Choose the identity for this MCP connection.', noModes: 'No authentication options are currently available.',
		account: 'Signed-in account', continueAs: 'Continue as this account', virtualKey: 'Virtual key', virtualKeyHint: 'Use an sk-bf-* virtual key from this workspace.',
		connectKey: 'Connect with key', anonymous: 'Anonymous session', anonymousHint: 'Continue without an account or virtual key.', continueAnonymous: 'Continue anonymously',
		expires: 'This link expires in about {minutes} minutes.', soon: 'This link expires soon.', connecting: 'Connecting…', failed: 'Authorization failed', unsafeRedirect: 'The server returned an unsafe redirect URL.',
	};

	let flowId = $state('');
	let tempToken = $state('');
	let flow = $state.raw<ConsentFlow | null>(null);
	let virtualKey = $state('');
	let loading = $state(true);
	let submittingMode = $state<ConsentMode | null>(null);
	let error = $state('');
	const availableModes = $derived(new Set(flow?.available_modes ?? []));
	const minutesRemaining = $derived(flow ? expiryMinutes(flow.expires_at) : undefined);

	function messageFrom(payload: unknown, fallback: string): string {
		if (typeof payload === 'string' && payload.trim()) return payload;
		if (!isJsonRecord(payload)) return fallback;
		for (const key of ['message', 'detail', 'error']) {
			const candidate = payload[key];
			if (typeof candidate === 'string' && candidate.trim()) return candidate;
			if (isJsonRecord(candidate) && typeof candidate.message === 'string') return candidate.message;
		}
		return fallback;
	}

	async function consentRequest(path: string, init: RequestInit = {}): Promise<unknown> {
		const response = await fetch(path, {
			...init,
			credentials: 'same-origin',
			headers: {
				Accept: 'application/json',
				...(init.body ? { 'Content-Type': 'application/json' } : {}),
				...(tempToken ? { 'X-Bifrost-Temp-Token': tempToken } : {}),
				...init.headers,
			},
		});
		const payload: unknown = await response.json().catch(() => undefined);
		if (!response.ok) throw new Error(messageFrom(payload, `${copy.failed} (HTTP ${response.status})`));
		return payload;
	}

	function parseFlow(value: unknown): ConsentFlow | null {
		if (!isJsonRecord(value) || typeof value.client_name !== 'string' || !Array.isArray(value.available_modes) || typeof value.expires_at !== 'string') return null;
		const available_modes = value.available_modes.filter((mode): mode is ConsentMode => mode === 'vk' || mode === 'session' || mode === 'user');
		const logged_in_user = isJsonRecord(value.logged_in_user) && typeof value.logged_in_user.id === 'string'
			? { id: value.logged_in_user.id, name: typeof value.logged_in_user.name === 'string' ? value.logged_in_user.name : undefined }
			: undefined;
		return { client_name: value.client_name, available_modes, expires_at: value.expires_at, logged_in_user };
	}

	async function load(): Promise<void> {
		flowId = new URLSearchParams(window.location.search).get('flow')?.trim() ?? '';
		if (!flowId) { loading = false; return; }
		const storageKey = `oauth2_consent_token_${flowId}`;
		const fragmentToken = tempTokenFromFragment(window.location.hash);
		tempToken = fragmentToken || window.sessionStorage.getItem(storageKey) || '';
		if (fragmentToken) window.sessionStorage.setItem(storageKey, fragmentToken);
		if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
		try {
			const payload = await consentRequest(`/api/oauth2/consent/flows/${encodeURIComponent(flowId)}`);
			flow = parseFlow(payload);
			if (!flow) throw new Error(copy.unavailableHint);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : copy.unavailableHint;
		} finally {
			loading = false;
		}
	}

	async function submit(mode: ConsentMode): Promise<void> {
		if (!flow || submittingMode) return;
		submittingMode = mode;
		error = '';
		try {
			const payload = await consentRequest(`/api/oauth2/consent/flows/${encodeURIComponent(flowId)}`, {
				method: 'PUT',
				body: JSON.stringify({ mode, ...(mode === 'vk' ? { value: virtualKey.trim() } : {}) }),
			});
			const redirect = isJsonRecord(payload) && typeof payload.redirect_url === 'string' ? payload.redirect_url : '';
			if (!redirect || !isSafeOAuthRedirect(redirect, window.location.origin)) throw new Error(copy.unsafeRedirect);
			window.sessionStorage.removeItem(`oauth2_consent_token_${flowId}`);
			window.location.assign(redirect);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : copy.failed;
			submittingMode = null;
		}
	}

	onMount(() => { void load(); });
</script>

<main class="consent-shell">
	<section class="consent-card">
		{#if loading}
			<div class="state"><span class="spinner"></span><p>{copy.loading}</p></div>
		{:else if !flowId}
			<div class="state"><div class="icon">?</div><h1>{copy.missingTitle}</h1><p>{copy.missingHint}</p></div>
		{:else if !flow}
			<div class="state"><div class="icon danger">×</div><h1>{copy.unavailableTitle}</h1><p>{error || copy.unavailableHint}</p></div>
		{:else}
			<header><div class="icon">✓</div><h1>{flow.client_name || 'MCP Client'} {copy.connectTitle}</h1><p>{copy.connectHint}</p></header>
			{#if error}<div class="error" role="alert">{error}</div>{/if}
			<div class="modes">
				{#if availableModes.has('user') && flow.logged_in_user}
					<article><div><strong>{flow.logged_in_user.name || flow.logged_in_user.id}</strong><span>{copy.account}</span></div><button type="button" onclick={() => void submit('user')} disabled={!!submittingMode}>{submittingMode === 'user' ? copy.connecting : copy.continueAs}</button></article>
				{/if}
				{#if availableModes.has('vk')}
					<article><div><strong>{copy.virtualKey}</strong><span>{copy.virtualKeyHint}</span></div><input bind:value={virtualKey} type="password" autocomplete="off" placeholder="sk-bf-…" onkeydown={(event) => event.key === 'Enter' && virtualKey.trim() && void submit('vk')} /><button type="button" onclick={() => void submit('vk')} disabled={!!submittingMode || !virtualKey.trim()}>{submittingMode === 'vk' ? copy.connecting : copy.connectKey}</button></article>
				{/if}
				{#if availableModes.has('session')}
					<article class="session"><div><strong>{copy.anonymous}</strong><span>{copy.anonymousHint}</span></div><button type="button" onclick={() => void submit('session')} disabled={!!submittingMode}>{submittingMode === 'session' ? copy.connecting : copy.continueAnonymous}</button></article>
				{/if}
				{#if !availableModes.size}<p class="empty">{copy.noModes}</p>{/if}
			</div>
			<p class="expiry">{minutesRemaining ? copy.expires.replace('{minutes}', String(minutesRemaining)) : copy.soon}</p>
		{/if}
	</section>
</main>

<style>
	:global(body){margin:0}.consent-shell{align-items:center;background:radial-gradient(circle at top,color-mix(in oklch,var(--primary) 12%,var(--background)),var(--background) 55%);box-sizing:border-box;color:var(--foreground);display:flex;justify-content:center;min-height:100vh;padding:1rem}.consent-card{background:var(--card);border:1px solid var(--border);border-radius:1rem;box-shadow:0 24px 70px rgb(0 0 0/.13);max-width:30rem;padding:clamp(1.2rem,4vw,2rem);width:100%}.consent-card>header,.state{text-align:center}.icon{align-items:center;background:color-mix(in oklch,var(--primary) 16%,transparent);border-radius:999px;color:var(--primary);display:flex;font-size:1.25rem;font-weight:800;height:3.4rem;justify-content:center;margin:0 auto 1rem;width:3.4rem}.icon.danger{background:color-mix(in oklch,var(--destructive) 12%,transparent);color:var(--destructive)}h1{font-size:1.25rem;line-height:1.35;margin:0}.consent-card header p,.state p,.expiry{color:var(--muted-foreground);font-size:.85rem;line-height:1.55}.modes{display:grid;gap:.75rem;margin-top:1.25rem}.modes article{border:1px solid var(--border);border-radius:.75rem;display:grid;gap:.7rem;padding:.9rem}.modes article div{display:grid;gap:.18rem}.modes article span{color:var(--muted-foreground);font-size:.75rem;line-height:1.4}.modes input{background:var(--background);border:1px solid var(--border);border-radius:.55rem;color:var(--foreground);padding:.65rem}.modes button{background:var(--primary);border:1px solid var(--primary);border-radius:.55rem;color:var(--primary-foreground);cursor:pointer;font-weight:700;padding:.62rem .8rem}.modes .session button{background:var(--muted);border-color:var(--border);color:var(--foreground)}button:disabled{cursor:wait;opacity:.55}.error{background:color-mix(in oklch,var(--destructive) 10%,transparent);border:1px solid color-mix(in oklch,var(--destructive) 35%,var(--border));border-radius:.6rem;color:var(--destructive);font-size:.8rem;margin-top:1rem;padding:.65rem .75rem}.expiry{text-align:center}.empty{text-align:center}.spinner{animation:spin 1s linear infinite;border:3px solid var(--border);border-radius:999px;border-top-color:var(--primary);display:block;height:2rem;margin:0 auto;width:2rem}@keyframes spin{to{transform:rotate(360deg)}}
</style>
