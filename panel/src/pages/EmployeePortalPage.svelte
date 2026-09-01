<script lang="ts">
	import { onMount } from 'svelte';
	import { getAppLogo, getAppName, getShortName, resolveBranding } from '../lib/branding';
	import { requestJson, type JsonRecord } from '../lib/api';

	let employee = $state.raw<JsonRecord | null>(null);
	let keys = $state.raw<JsonRecord[]>([]);
	let stats = $state.raw<JsonRecord>({});
	let username = $state('');
	let password = $state('');
	let currentPassword = $state('');
	let newPassword = $state('');
	let period = $state('30d');
	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');
	let appName = $state(getAppName());
	let shortName = $state(getShortName());
	let logo = $state(getAppLogo());
	const mustChangePassword = $derived(employee?.must_change_password === true);

	function csrfToken(): string {
		const match = document.cookie.split('; ').find((entry) => entry.startsWith('employee_csrf='));
		return match ? decodeURIComponent(match.slice('employee_csrf='.length)) : '';
	}

	async function employeeRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
		return requestJson<T>(`/employee/api/${path.replace(/^\//, '')}`, {
			...init,
			headers: { ...(init.method && init.method !== 'GET' ? { 'X-CSRF-Token': csrfToken() } : {}), ...init.headers },
		});
	}

	async function refreshBranding(): Promise<void> {
		try {
			const config = await requestJson<Record<string, unknown>>('/api/session/is-auth-enabled');
			const resolved = resolveBranding(config);
			appName = resolved.appName;
			shortName = resolved.shortName;
			logo = resolved.logoUrl;
			document.title = `${shortName} · 员工门户`;
		} catch { /* 保留本地缓存品牌。 */ }
	}

	async function loadSession(): Promise<void> {
		loading = true;
		error = '';
		try {
			const response = await employeeRequest<{ employee: JsonRecord }>('session');
			employee = response.employee;
			if (employee.must_change_password !== true) {
				try {
					await loadUsageAndKeys();
				} catch (cause) {
					keys = [];
					stats = {};
					error = cause instanceof Error ? cause.message : String(cause);
				}
			}
		} catch {
			employee = null;
			keys = [];
			stats = {};
		} finally {
			loading = false;
		}
	}

	async function login(): Promise<void> {
		busy = true;
		error = '';
		try {
			const response = await employeeRequest<{ employee: JsonRecord }>('session/login', { method: 'POST', body: JSON.stringify({ username, password }) });
			employee = response.employee;
			currentPassword = password;
			password = '';
			if (employee.must_change_password !== true) {
				try {
					await loadUsageAndKeys();
				} catch (cause) {
					keys = [];
					stats = {};
					error = cause instanceof Error ? cause.message : String(cause);
				}
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	async function logout(): Promise<void> {
		try { await employeeRequest('session/logout', { method: 'POST' }); } catch { /* 会话失效也视为退出。 */ }
		employee = null;
		keys = [];
		stats = {};
	}

	async function changePassword(): Promise<void> {
		busy = true;
		error = '';
		try {
			await employeeRequest('me/password', { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
			currentPassword = '';
			newPassword = '';
			await loadSession();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	async function loadUsageAndKeys(): Promise<void> {
		const [keyResponse, usageResponse] = await Promise.all([
			employeeRequest<{ keys: JsonRecord[] }>('me/keys'),
			employeeRequest<{ stats: JsonRecord }>(`me/usage?period=${encodeURIComponent(period)}`),
		]);
		keys = keyResponse.keys;
		stats = usageResponse.stats;
	}

	async function changePeriod(): Promise<void> {
		try {
			error = '';
			const response = await employeeRequest<{ stats: JsonRecord }>(`me/usage?period=${encodeURIComponent(period)}`);
			stats = response.stats;
		} catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
	}

	function metric(name: string): number | null { const value = stats[name]; return typeof value === 'number' && Number.isFinite(value) ? value : null; }
	function number(value: number | null, digits = 0): string { return value === null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value); }
	function cost(): string { const value = metric('total_cost'); return value === null ? '—' : `$${number(value, 4)}`; }
	function submitLogin(event: SubmitEvent): void { event.preventDefault(); void login(); }
	function submitPassword(event: SubmitEvent): void { event.preventDefault(); void changePassword(); }
	onMount(() => { void refreshBranding(); void loadSession(); });
</script>

<svelte:head><meta name="description" content="员工密钥与用量自助门户" /></svelte:head>

<main>
	<header class="topbar"><a class="brand" href="/employee">{#if logo}<img src={logo} alt="" />{:else}<span>{shortName.slice(0, 1)}</span>{/if}<div><strong>{appName}</strong><small>员工门户</small></div></a>{#if employee}<div class="identity"><div><strong>{String(employee.name ?? '')}</strong><small>@{String(employee.username ?? '')}</small></div><button type="button" onclick={() => void logout()}>退出</button></div>{/if}</header>

	{#if loading}
		<section class="center-state"><div class="spinner"></div><p>正在验证登录状态…</p></section>
	{:else if !employee}
		<section class="login-layout"><div class="login-copy"><p class="eyebrow">EMPLOYEE ACCESS</p><h1>{shortName} 员工访问</h1><p>登录后查看本人专属 Key、请求量、Token、费用和成功率。</p></div><form class="login-form" onsubmit={submitLogin}><label>用户名<input bind:value={username} autocomplete="username" /></label><label>密码<input type="password" bind:value={password} autocomplete="current-password" /></label>{#if error}<div class="notice error" role="alert">{error}</div>{/if}<button class="primary" type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</button><small>管理员后台账号不能在此登录。</small></form></section>
	{:else if mustChangePassword}
		<section class="password-layout"><div><p class="eyebrow">FIRST SIGN-IN</p><h1>设置你的新密码</h1><p>初始密码仅用于首次登录。新密码至少 12 个字符。</p></div><form onsubmit={submitPassword}><label>当前密码<input type="password" bind:value={currentPassword} autocomplete="current-password" /></label><label>新密码<input type="password" bind:value={newPassword} autocomplete="new-password" minlength="12" /></label>{#if error}<div class="notice error" role="alert">{error}</div>{/if}<button class="primary" type="submit" disabled={busy}>{busy ? '更新中…' : '更新密码'}</button></form></section>
	{:else}
		<section class="workspace">
			<header class="workspace-heading"><div><p class="eyebrow">MY USAGE</p><h1>你好，{String(employee.name ?? '')}</h1><p>{String(employee.department ?? '')}{employee.job_title ? ` · ${String(employee.job_title)}` : ''}</p></div><label>统计周期<select bind:value={period} onchange={() => void changePeriod()}><option value="1h">最近 1 小时</option><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option></select></label></header>
			{#if error}<div class="notice error" role="alert">{error}</div>{/if}
			<section class="metrics"><article><small>请求数</small><strong>{number(metric('total_requests'))}</strong></article><article><small>Token</small><strong>{number(metric('total_tokens'))}</strong></article><article><small>费用</small><strong>{cost()}</strong></article><article><small>成功率</small><strong>{number(metric('success_rate'), 2)}{metric('success_rate') === null ? '' : '%'}</strong></article></section>
			<section class="key-section"><header><div><p class="eyebrow">API ACCESS</p><h2>我的专属 Key</h2></div><span>{keys.length} 个</span></header><div class="key-list">{#each keys as key (String(key.id ?? ''))}<article><div><strong>{String(key.name ?? '未命名 Key')}</strong><span class:active={key.is_active === true}>{key.is_active === true ? '可用' : '已停用'}</span></div><code>{String(key.masked_value ?? '')}</code><p>{String(key.description ?? '由管理员分配，变更请联系管理员。')}</p></article>{:else}<div class="empty">管理员尚未分配专属 Key。</div>{/each}</div></section>
		</section>
	{/if}
</main>

<style>
	:global(body) { background: #f6f8fa; margin: 0; }
	main { color: #18202b; min-height: 100vh; }
	.topbar { align-items: center; background: #fff; border-bottom: 1px solid #dce2e8; display: flex; justify-content: space-between; min-height: 66px; padding: 0 2rem; }
	.brand { align-items: center; color: inherit; display: flex; gap: .7rem; text-decoration: none; }
	.brand > span, .brand img { align-items: center; background: #146c43; border-radius: .35rem; color: #fff; display: flex; font-size: 1.1rem; font-weight: 800; height: 34px; justify-content: center; object-fit: contain; width: 34px; }
	.brand div, .identity div { display: grid; }
	.brand small, .identity small { color: #6b7785; }
	.identity { align-items: center; display: flex; gap: 1rem; text-align: right; }
	button, input, select { font: inherit; }
	button { border: 1px solid #cbd4dc; border-radius: .4rem; cursor: pointer; font-weight: 700; padding: .55rem .75rem; }
	button.primary { background: #146c43; border-color: #146c43; color: #fff; }
	button:disabled { cursor: not-allowed; opacity: .55; }
	input, select { background: #fff; border: 1px solid #cbd4dc; border-radius: .4rem; box-sizing: border-box; min-height: 42px; padding: .55rem .7rem; width: 100%; }
	label { display: grid; font-size: .82rem; font-weight: 700; gap: .35rem; }
	.eyebrow { color: #146c43; font-size: .7rem; font-weight: 850; letter-spacing: .08em; margin: 0; }
	.center-state { align-items: center; display: flex; gap: .7rem; justify-content: center; min-height: calc(100vh - 67px); }
	.spinner { animation: spin .8s linear infinite; border: 2px solid #dce2e8; border-radius: 50%; border-top-color: #146c43; height: 20px; width: 20px; }
	.login-layout, .password-layout { align-items: center; display: grid; gap: 4rem; grid-template-columns: minmax(0, 1fr) minmax(320px, 420px); margin: 0 auto; max-width: 1040px; min-height: calc(100vh - 67px); padding: 2rem; }
	.login-copy h1, .password-layout h1, .workspace-heading h1 { font-size: 2rem; margin: .4rem 0 .7rem; }
	.login-copy p, .password-layout p, .workspace-heading p { color: #637080; line-height: 1.65; }
	.login-form, .password-layout form { background: #fff; border: 1px solid #dce2e8; border-radius: .5rem; display: grid; gap: 1rem; padding: 1.5rem; }
	.login-form small { color: #75808d; text-align: center; }
	.notice { border-radius: .4rem; padding: .7rem; }
	.notice.error { background: #fff0f0; border: 1px solid #f0b8b8; color: #a12626; }
	.workspace { display: grid; gap: 1.25rem; margin: 0 auto; max-width: 1180px; padding: 2rem; }
	.workspace-heading { align-items: flex-end; display: flex; justify-content: space-between; }
	.workspace-heading label { min-width: 170px; }
	.metrics { display: grid; gap: .8rem; grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.metrics article { background: #fff; border: 1px solid #dce2e8; border-radius: .45rem; display: grid; gap: .45rem; padding: 1rem; }
	.metrics small { color: #6b7785; }
	.metrics strong { font-size: 1.55rem; }
	.key-section { display: grid; gap: .8rem; }
	.key-section > header { align-items: end; display: flex; justify-content: space-between; }
	.key-section h2 { font-size: 1.2rem; margin: .25rem 0 0; }
	.key-list { display: grid; gap: .8rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.key-list article { background: #fff; border: 1px solid #dce2e8; border-radius: .45rem; display: grid; gap: .75rem; padding: 1rem; }
	.key-list article > div { align-items: center; display: flex; justify-content: space-between; }
	.key-list span { color: #9a4c32; font-size: .75rem; font-weight: 750; }
	.key-list span.active { color: #146c43; }
	.key-list code { background: #f0f3f5; border-radius: .3rem; overflow-wrap: anywhere; padding: .5rem; }
	.key-list p { color: #637080; margin: 0; }
	.empty { background: #fff; border: 1px dashed #cbd4dc; color: #637080; grid-column: 1 / -1; padding: 2rem; text-align: center; }
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (max-width: 760px) { .topbar { padding: 0 1rem; } .brand strong { max-width: 48vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .login-layout, .password-layout { align-content: center; gap: 1.5rem; grid-template-columns: 1fr; padding: 1rem; } .workspace { padding: 1rem; } .workspace-heading { align-items: stretch; display: grid; gap: 1rem; } .metrics, .key-list { grid-template-columns: 1fr 1fr; } }
	@media (max-width: 480px) { .identity div { display: none; } .metrics, .key-list { grid-template-columns: 1fr; } }
</style>
