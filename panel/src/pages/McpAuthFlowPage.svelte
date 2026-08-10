<script lang="ts">
	import { onMount } from 'svelte';
	import { isJsonRecord } from '../lib/api';
	import { expiryMinutes, isSafeOAuthRedirect, tempTokenFromFragment } from '../lib/oauth-consent';
	import type { McpPublicRoute } from '../lib/public-routes';

	interface Props { route: McpPublicRoute; }
	interface IdentitySummary { id: string; name?: string; }
	interface ClientSummary { client_id: string; name?: string; }
	interface BaseFlow {
		id: string;
		flow_mode: string;
		status: string;
		mcp_client?: ClientSummary;
		user?: IdentitySummary;
		virtual_key?: IdentitySummary;
		session_id?: string;
		expires_at: string;
	}
	interface OAuthFlow extends BaseFlow { has_active_token?: boolean; }
	interface HeaderFlow extends BaseFlow {
		required_header_keys: string[];
		admin_header_keys?: string[];
		submitted_keys?: string[];
		has_active_credential: boolean;
	}

	let { route }: Props = $props();
	const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
	const copy = zh ? {
		loading: '正在加载认证流程…', missingTitle: '缺少认证流程标识', missingHint: '链接缺少 flow 参数，请从 MCP 客户端重新发起请求。',
		invalidTitle: '认证链接不可用', invalidHint: '链接可能已过期、已完成或临时令牌无效。请重新触发原始请求。',
		authTitle: '连接 MCP 服务', reauthTitle: '重新认证 MCP 服务', authHint: '继续后将跳转到服务提供方完成授权。', reauthHint: '完成后会用新凭据替换当前凭据。',
		alreadyTitle: '已存在可用凭据', alreadyHint: '此身份已具备有效凭据，可以关闭本页并重试原始请求。', authenticate: '开始认证', authenticating: '正在跳转…',
		headersTitle: '提交 MCP 请求头', headersHint: '这些值会按当前身份安全保存，并用于后续 MCP 请求。', updateHeadersHint: '已存在凭据；提交后将替换对应请求头值。',
		adminHeaders: '管理员已配置', previousHeaders: '此前已提交', required: '必填', submit: '验证并保存', submitting: '正在验证…', headersSaved: '请求头已保存', headersSavedHint: '连接已验证。现在可以关闭本页并重试原始请求。',
		client: 'MCP 客户端', binding: '绑定身份', expires: '约 {minutes} 分钟后过期', expiresSoon: '即将过期', session: '匿名会话', virtualKey: '虚拟密钥', user: '用户',
		successTitle: '认证成功', successHint: '凭据已保存。可以关闭本页并返回 MCP 客户端。', failedTitle: '认证失败', failedHint: '未能完成认证，请关闭本页并重试原始请求。',
		callbackSuccess: '授权已完成', callbackFailed: '授权失败', callbackClose: '可以关闭此窗口。', unsafeRedirect: '服务端返回了不安全的跳转地址。', requestFailed: '请求失败',
	} : {
		loading: 'Loading authentication flow…', missingTitle: 'Missing flow identifier', missingHint: 'This URL is missing the flow parameter. Restart the request from your MCP client.',
		invalidTitle: 'Authentication link unavailable', invalidHint: 'The link may be expired, completed, or missing its temporary token. Trigger the original request again.',
		authTitle: 'Connect MCP server', reauthTitle: 'Re-authenticate MCP server', authHint: 'Continue to the provider to sign in and grant access.', reauthHint: 'Completing this flow replaces the current credential.',
		alreadyTitle: 'A working credential already exists', alreadyHint: 'This identity already has an active credential. Close this page and retry the original request.', authenticate: 'Authenticate', authenticating: 'Redirecting…',
		headersTitle: 'Submit MCP headers', headersHint: 'These values are stored for this identity and used for future MCP requests.', updateHeadersHint: 'A credential already exists. Submitting replaces the corresponding header values.',
		adminHeaders: 'Configured by admin', previousHeaders: 'Previously submitted', required: 'Required', submit: 'Verify and save', submitting: 'Verifying…', headersSaved: 'Headers saved', headersSavedHint: 'The connection was verified. Close this page and retry the original request.',
		client: 'MCP client', binding: 'Bound to', expires: 'Expires in about {minutes} minutes', expiresSoon: 'Expires soon', session: 'Anonymous session', virtualKey: 'Virtual key', user: 'User',
		successTitle: 'Authentication successful', successHint: 'The credential has been stored. Close this page and return to your MCP client.', failedTitle: 'Authentication failed', failedHint: 'The flow could not be completed. Close this page and retry the original request.',
		callbackSuccess: 'Authorization complete', callbackFailed: 'Authorization failed', callbackClose: 'You can close this window.', unsafeRedirect: 'The server returned an unsafe redirect URL.', requestFailed: 'Request failed',
	};

	let flowId = $state('');
	let tempToken = $state('');
	let oauthFlow = $state.raw<OAuthFlow | null>(null);
	let headerFlow = $state.raw<HeaderFlow | null>(null);
	let headerValues = $state<Record<string, string>>({});
	let loading = $state(true);
	let submitting = $state(false);
	let submitted = $state(false);
	let error = $state('');
	let callbackStatus = $state('unknown');
	let callbackError = $state('');
	const isHeaderFlow = $derived(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('kind') === 'headers');
	const activeFlow = $derived<BaseFlow | null>(headerFlow ?? oauthFlow);
	const clientName = $derived(activeFlow?.mcp_client?.name || activeFlow?.mcp_client?.client_id || 'MCP');
	const expiry = $derived(activeFlow ? expiryMinutes(activeFlow.expires_at) : undefined);

	function messageFrom(payload: unknown, fallback: string): string {
		if (typeof payload === 'string' && payload.trim()) return payload;
		if (!isJsonRecord(payload)) return fallback;
		for (const key of ['message', 'detail', 'error']) {
			const value = payload[key];
			if (typeof value === 'string' && value.trim()) return value;
			if (isJsonRecord(value) && typeof value.message === 'string') return value.message;
		}
		return fallback;
	}

	async function flowRequest(path: string, init: RequestInit = {}): Promise<unknown> {
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
		if (!response.ok) throw new Error(messageFrom(payload, `${copy.requestFailed} (HTTP ${response.status})`));
		return payload;
	}

	function parseIdentity(value: unknown): IdentitySummary | undefined {
		if (!isJsonRecord(value) || typeof value.id !== 'string') return undefined;
		return { id: value.id, name: typeof value.name === 'string' ? value.name : undefined };
	}

	function parseBaseFlow(value: unknown): BaseFlow | null {
		if (!isJsonRecord(value) || typeof value.id !== 'string' || typeof value.status !== 'string' || typeof value.flow_mode !== 'string' || typeof value.expires_at !== 'string') return null;
		const mcp_client = isJsonRecord(value.mcp_client) && typeof value.mcp_client.client_id === 'string'
			? { client_id: value.mcp_client.client_id, name: typeof value.mcp_client.name === 'string' ? value.mcp_client.name : undefined }
			: undefined;
		return {
			id: value.id, status: value.status, flow_mode: value.flow_mode, expires_at: value.expires_at, mcp_client,
			user: parseIdentity(value.user), virtual_key: parseIdentity(value.virtual_key), session_id: typeof value.session_id === 'string' ? value.session_id : undefined,
		};
	}

	function parseOAuthFlow(value: unknown): OAuthFlow | null {
		const base = parseBaseFlow(value);
		return base && isJsonRecord(value) ? { ...base, has_active_token: value.has_active_token === true } : null;
	}

	function parseHeaderFlow(value: unknown): HeaderFlow | null {
		const base = parseBaseFlow(value);
		if (!base || !isJsonRecord(value) || !Array.isArray(value.required_header_keys)) return null;
		const strings = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : [];
		return {
			...base,
			required_header_keys: strings(value.required_header_keys), admin_header_keys: strings(value.admin_header_keys), submitted_keys: strings(value.submitted_keys),
			has_active_credential: value.has_active_credential === true,
		};
	}

	function bindingLabel(flow: BaseFlow): string {
		if (flow.user) return `${copy.user}: ${flow.user.name || flow.user.id}`;
		if (flow.virtual_key) return `${copy.virtualKey}: ${flow.virtual_key.name || flow.virtual_key.id}`;
		return `${copy.session}: ${flow.session_id ?? '—'}`;
	}

	async function loadAuthFlow(): Promise<void> {
		flowId = new URLSearchParams(window.location.search).get('flow')?.trim() ?? '';
		if (!flowId) { loading = false; return; }
		const storageKey = `mcp_auth_token_${flowId}`;
		const fragmentToken = tempTokenFromFragment(window.location.hash);
		tempToken = fragmentToken || window.sessionStorage.getItem(storageKey) || '';
		if (fragmentToken) window.sessionStorage.setItem(storageKey, fragmentToken);
		if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
		try {
			if (isHeaderFlow) {
				headerFlow = parseHeaderFlow(await flowRequest(`/api/mcp/per-user-headers/flows/${encodeURIComponent(flowId)}`));
				if (!headerFlow) throw new Error(copy.invalidHint);
				headerValues = Object.fromEntries(headerFlow.required_header_keys.map((key) => [key, '']));
			} else {
				oauthFlow = parseOAuthFlow(await flowRequest(`/api/oauth/per-user/flows/${encodeURIComponent(flowId)}`));
				if (!oauthFlow) throw new Error(copy.invalidHint);
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : copy.invalidHint;
		} finally {
			loading = false;
		}
	}

	async function startOAuth(): Promise<void> {
		if (!oauthFlow || submitting) return;
		submitting = true;
		error = '';
		try {
			const payload = await flowRequest(`/api/oauth/per-user/flows/${encodeURIComponent(flowId)}/start`);
			const redirect = isJsonRecord(payload) && typeof payload.authorize_url === 'string' ? payload.authorize_url : '';
			if (!redirect || !isSafeOAuthRedirect(redirect, window.location.origin)) throw new Error(copy.unsafeRedirect);
			window.location.assign(redirect);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : copy.requestFailed;
			submitting = false;
		}
	}

	async function submitHeaders(): Promise<void> {
		if (!headerFlow || submitting) return;
		const missing = headerFlow.required_header_keys.find((key) => !headerValues[key]?.trim());
		if (missing) { error = `${missing}: ${copy.required}`; return; }
		submitting = true;
		error = '';
		try {
			await flowRequest(`/api/mcp/per-user-headers/flows/${encodeURIComponent(flowId)}`, { method: 'PUT', body: JSON.stringify({ headers: headerValues }) });
			window.sessionStorage.removeItem(`mcp_auth_token_${flowId}`);
			submitted = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : copy.requestFailed;
		} finally {
			submitting = false;
		}
	}

	function handleCallback(): void {
		const params = new URLSearchParams(window.location.search);
		callbackStatus = params.get('status') ?? 'unknown';
		callbackError = params.get('error') ?? '';
		if (!window.opener) return;
		window.opener.postMessage(callbackStatus === 'success' ? { type: 'oauth_success' } : { type: 'oauth_failed', error: callbackError || copy.callbackFailed }, window.location.origin);
		window.close();
	}

	onMount(() => {
		if (route === 'mcp-auth') void loadAuthFlow();
		if (route === 'mcp-oauth-callback') handleCallback();
	});
</script>

<main class="flow-shell">
	<section class="flow-card">
		{#if route === 'mcp-auth-success'}
			{@render State('✓', copy.successTitle, copy.successHint, false)}
		{:else if route === 'mcp-auth-failed'}
			{@render State('×', copy.failedTitle, new URLSearchParams(window.location.search).get('error') || copy.failedHint, true)}
		{:else if route === 'mcp-oauth-callback'}
			{@render State(callbackStatus === 'success' ? '✓' : '×', callbackStatus === 'success' ? copy.callbackSuccess : copy.callbackFailed, callbackError || copy.callbackClose, callbackStatus !== 'success')}
		{:else if loading}
			<div class="state"><span class="spinner"></span><p>{copy.loading}</p></div>
		{:else if !flowId}
			{@render State('?', copy.missingTitle, copy.missingHint, false)}
		{:else if !activeFlow}
			{@render State('×', copy.invalidTitle, error || copy.invalidHint, true)}
		{:else if submitted}
			{@render State('✓', copy.headersSaved, copy.headersSavedHint, false)}
		{:else if oauthFlow?.has_active_token}
			{@render State('✓', copy.alreadyTitle, copy.alreadyHint, false)}
		{:else}
			<header><div class="icon">{isHeaderFlow ? 'H' : '↗'}</div><h1>{isHeaderFlow ? copy.headersTitle : (oauthFlow?.has_active_token ? copy.reauthTitle : copy.authTitle)}</h1><p>{clientName} · {isHeaderFlow && headerFlow?.has_active_credential ? copy.updateHeadersHint : isHeaderFlow ? copy.headersHint : copy.authHint}</p></header>
			{#if error}<div class="error" role="alert">{error}</div>{/if}
			<dl><div><dt>{copy.client}</dt><dd>{clientName}</dd></div><div><dt>{copy.binding}</dt><dd>{bindingLabel(activeFlow)}</dd></div><div><dt>{copy.expiresSoon}</dt><dd>{expiry ? copy.expires.replace('{minutes}', String(expiry)) : copy.expiresSoon}</dd></div></dl>
			{#if isHeaderFlow && headerFlow}
				{#if headerFlow.admin_header_keys?.length}<p class="hint"><strong>{copy.adminHeaders}:</strong> {headerFlow.admin_header_keys.join(', ')}</p>{/if}
				{#if headerFlow.submitted_keys?.length}<p class="hint"><strong>{copy.previousHeaders}:</strong> {headerFlow.submitted_keys.join(', ')}</p>{/if}
				<form onsubmit={(event) => { event.preventDefault(); void submitHeaders(); }}>{#each headerFlow.required_header_keys as key (key)}<label><span>{key} · {copy.required}</span><input type="password" autocomplete="off" bind:value={headerValues[key]} /></label>{/each}<button type="submit" disabled={submitting}>{submitting ? copy.submitting : copy.submit}</button></form>
			{:else}
				<button class="primary" type="button" onclick={() => void startOAuth()} disabled={submitting}>{submitting ? copy.authenticating : copy.authenticate}</button>
			{/if}
		{/if}
	</section>
</main>

{#snippet State(icon: string, title: string, hint: string, danger: boolean)}
	<div class="state"><div class={['icon', danger && 'danger']}>{icon}</div><h1>{title}</h1><p>{hint}</p></div>
{/snippet}

<style>
	:global(body) { margin: 0; }
	.flow-shell { align-items: center; background: radial-gradient(circle at top, color-mix(in oklch, var(--primary) 12%, var(--background)), var(--background) 55%); box-sizing: border-box; color: var(--foreground); display: flex; justify-content: center; min-height: 100vh; padding: 1rem; }
	.flow-card { background: var(--card); border: 1px solid var(--border); border-radius: 1rem; box-shadow: 0 24px 70px rgb(0 0 0 / .13); max-width: 34rem; padding: clamp(1.2rem, 4vw, 2rem); width: 100%; }
	.flow-card > header, .state { text-align: center; }
	.icon { align-items: center; background: color-mix(in oklch, var(--primary) 16%, transparent); border-radius: 999px; color: var(--primary); display: flex; font-size: 1.15rem; font-weight: 800; height: 3.4rem; justify-content: center; margin: 0 auto 1rem; width: 3.4rem; }
	.icon.danger { background: color-mix(in oklch, var(--destructive) 12%, transparent); color: var(--destructive); }
	h1 { font-size: 1.25rem; margin: 0; }
	header p, .state p, .hint { color: var(--muted-foreground); font-size: .85rem; line-height: 1.55; }
	dl { background: color-mix(in oklch, var(--muted) 65%, transparent); border: 1px solid var(--border); border-radius: .7rem; display: grid; gap: .65rem; margin: 1.2rem 0; padding: .9rem; }
	dl div { display: grid; gap: .25rem; grid-template-columns: 7.5rem 1fr; }
	dt { color: var(--muted-foreground); font-size: .75rem; }
	dd { font-size: .82rem; margin: 0; overflow-wrap: anywhere; }
	form { display: grid; gap: .7rem; margin-top: 1rem; }
	label { display: grid; gap: .35rem; }
	label span { color: var(--muted-foreground); font-size: .75rem; }
	input { background: var(--background); border: 1px solid var(--border); border-radius: .55rem; color: var(--foreground); padding: .65rem; }
	button { background: var(--primary); border: 1px solid var(--primary); border-radius: .55rem; color: var(--primary-foreground); cursor: pointer; font-weight: 700; padding: .65rem .8rem; }
	button.primary { display: block; margin: 1.1rem auto 0; min-width: 10rem; }
	button:disabled { cursor: wait; opacity: .55; }
	.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); border: 1px solid color-mix(in oklch, var(--destructive) 35%, var(--border)); border-radius: .6rem; color: var(--destructive); font-size: .8rem; margin-top: 1rem; padding: .65rem .75rem; }
	.spinner { animation: spin 1s linear infinite; border: 3px solid var(--border); border-radius: 999px; border-top-color: var(--primary); display: block; height: 2rem; margin: 0 auto; width: 2rem; }
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (max-width: 480px) { dl div { grid-template-columns: 1fr; } }
</style>
