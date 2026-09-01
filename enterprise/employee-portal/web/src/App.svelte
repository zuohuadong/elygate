<script lang="ts">
  import { onMount } from 'svelte';

  interface Provider { id: string; name: string; }
  interface Me { providerId: string; userId: string; email: string; name: string; roles: string[]; csrfToken: string; }
  interface VirtualKey { id: string; name: string; description: string; isActive: boolean; expiresAt: string | null; lastUsedAt: string | null; maskedValue: string; }
  interface Usage { period: string; keyIds: string[]; dashboard: unknown; }

  let providers = $state.raw<Provider[]>([]);
  let me = $state.raw<Me | null>(null);
  let keys = $state.raw<VirtualKey[]>([]);
  let usage = $state.raw<Usage | null>(null);
  let period = $state('7d');
  let loading = $state(true);
  let rotatingId = $state('');
  let error = $state('');
  let revealedKey = $state('');
  let copyStatus = $state('');
  let usageRequestId = 0;

  function apiUrl(path: string): string {
    const base = new URL(window.location.href);
    base.search = '';
    base.hash = '';
    base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
    return new URL(path.replace(/^\//, ''), base).toString();
  }

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(apiUrl(path), { credentials: 'same-origin', ...init });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error || `请求失败（HTTP ${response.status}）`);
    return body as T;
  }

  function record(candidate: unknown): Record<string, unknown> {
    return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {};
  }

  function usageStats(): Record<string, unknown> {
    const dashboard = record(usage?.dashboard);
    return record(record(dashboard.overview).stats);
  }

  function numericMetric(...names: string[]): number | null {
    const stats = usageStats();
    for (const name of names) {
      const metric = stats[name];
      if (typeof metric === 'number' && Number.isFinite(metric)) return metric;
    }
    return null;
  }

  function formatNumber(metric: number | null, digits = 0): string {
    return metric === null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(metric);
  }

  function formatTime(timestamp: string | null): string {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return Number.isNaN(date.valueOf()) ? timestamp : date.toLocaleString('zh-CN');
  }

  async function loadProviders(): Promise<void> {
    providers = await requestJson<Provider[]>('api/auth/providers');
  }

  async function loadUsage(selectedPeriod = period): Promise<void> {
    const requestId = ++usageRequestId;
    try {
      const requestedUsage = await requestJson<Usage>(`api/me/usage?period=${encodeURIComponent(selectedPeriod)}`);
      if (requestId === usageRequestId) usage = requestedUsage;
    } catch (cause) {
      if (requestId === usageRequestId) throw cause;
    }
  }

  async function load(): Promise<void> {
    loading = true;
    error = '';
    try {
      await loadProviders();
      const identity = await requestJson<Me>('api/me');
      me = identity;
      const [keyPayload] = await Promise.all([
        requestJson<{ keys: VirtualKey[] }>('api/me/keys'),
        loadUsage(),
      ]);
      keys = keyPayload.keys;
    } catch (cause) {
      me = null;
      keys = [];
      usage = null;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!message.includes('请先登录') && !message.includes('登录已过期')) error = message;
    } finally {
      loading = false;
    }
  }

  async function changePeriod(): Promise<void> {
    if (!me) return;
    const selectedPeriod = period;
    try {
      error = '';
      await loadUsage(selectedPeriod);
    } catch (cause) {
      period = usage?.period ?? '7d';
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function rotate(key: VirtualKey): Promise<void> {
    if (!me || !window.confirm(`轮换“${key.name}”后，旧密钥会立即失效。确认继续？`)) return;
    rotatingId = key.id;
    error = '';
    revealedKey = '';
    copyStatus = '';
    try {
      const rotated = await requestJson<{ value: string; key: VirtualKey }>(`api/me/keys/${encodeURIComponent(key.id)}/rotate`, {
        method: 'POST',
        headers: { 'x-csrf-token': me.csrfToken },
      });
      revealedKey = rotated.value;
      keys = keys.map((candidate) => candidate.id === key.id ? rotated.key : candidate);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      rotatingId = '';
    }
  }

  async function copyRevealed(): Promise<void> {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      copyStatus = '已复制';
    } catch {
      copyStatus = '';
      error = '无法复制密钥，请手动选择并复制';
    }
  }

  async function logout(): Promise<void> {
    if (!me) return;
    try {
      error = '';
      const response = await fetch(apiUrl('api/auth/logout'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': me.csrfToken },
      });
      if (!response.ok) throw new Error(`退出失败（HTTP ${response.status}）`);
      await load();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function formatCost(): string {
    const cost = numericMetric('total_cost', 'cost');
    return cost === null ? '—' : `$${formatNumber(cost, 4)}`;
  }

  onMount(() => { void load(); });
</script>

<svelte:head><meta name="description" content="Elygate 员工密钥与用量自助门户" /></svelte:head>

<header class="topbar">
  <a class="brand" href="./" aria-label="Elygate 员工门户首页"><span>E</span><div><strong>Elygate</strong><small>员工门户</small></div></a>
  {#if me}<div class="identity"><div><strong>{me.name}</strong><small>{me.email}</small></div><button type="button" onclick={() => void logout()}>退出</button></div>{/if}
</header>

<main>
  {#if loading}
    <section class="state-card"><div class="spinner"></div><p>正在读取员工权限与用量…</p></section>
  {:else if !me}
    <section class="login-card">
      <p class="eyebrow">SECURE EMPLOYEE ACCESS</p>
      <h1>管理你的 AI 访问权限</h1>
      <p>使用公司身份登录，查看个人虚拟密钥、预算与使用情况。管理员策略不会在员工端开放修改。</p>
      {#if error}<div class="notice error" role="alert">{error}</div>{/if}
      <div class="provider-list">
        {#each providers as provider (provider.id)}
          <a class="login-button" href={apiUrl(`api/auth/login/${encodeURIComponent(provider.id)}`)}>使用 {provider.name} 登录 <span>→</span></a>
        {:else}
          <div class="notice error">管理员尚未配置企业 SSO 或 SupAuth。</div>
        {/each}
      </div>
      <small class="security-note">登录凭据由身份提供商处理；Elygate 不接收你的企业密码。</small>
    </section>
  {:else}
    <section class="hero">
      <div><p class="eyebrow">MY AI ACCESS</p><h1>你好，{me.name}</h1><p>这是仅属于你的密钥与用量视图。模型范围、预算及限流由企业策略统一管理。</p></div>
      <div class="identity-badge"><span></span><div><strong>已验证身份</strong><small>{me.providerId}</small></div></div>
    </section>

    {#if error}<div class="notice error" role="alert">{error}</div>{/if}
    {#if revealedKey}
      <section class="secret-card" role="status">
        <div><strong>新密钥仅显示这一次</strong><code>{revealedKey}</code><small>立即保存到受信任的密码管理器；关闭后无法再次查看。</small></div>
        <div class="secret-actions"><button type="button" onclick={() => void copyRevealed()}>{copyStatus || '复制密钥'}</button><button type="button" onclick={() => (revealedKey = '')}>我已保存</button><span class="copy-feedback" aria-live="polite">{copyStatus}</span></div>
      </section>
    {/if}

    <section class="section-heading"><div><p class="eyebrow">USAGE</p><h2>个人用量</h2></div><label>统计周期<select bind:value={period} onchange={() => void changePeriod()}><option value="1h">最近 1 小时</option><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option></select></label></section>
    <section class="metrics">
      <article><small>请求数</small><strong>{formatNumber(numericMetric('total_requests', 'requests'))}</strong><span>当前周期</span></article>
      <article><small>Token</small><strong>{formatNumber(numericMetric('total_tokens', 'tokens'))}</strong><span>输入与输出</span></article>
      <article><small>费用</small><strong>{formatCost()}</strong><span>以网关计价币种为准</span></article>
      <article><small>成功率</small><strong>{formatNumber(numericMetric('success_rate'), 2)}{numericMetric('success_rate') === null ? '' : '%'}</strong><span>成功请求占比</span></article>
    </section>

    <section class="section-heading"><div><p class="eyebrow">VIRTUAL KEYS</p><h2>我的密钥</h2></div><span class="count">{keys.length} 个</span></section>
    <section class="key-list">
      {#each keys as key (key.id)}
        <article class="key-card">
          <div class="key-icon">⌁</div>
          <div class="key-main"><div class="key-title"><strong>{key.name || '未命名密钥'}</strong><span class:active={key.isActive}>{key.isActive ? '可用' : '已停用'}</span></div><code>{key.maskedValue}</code><p>{key.description || '由企业访问策略签发'}</p><dl><div><dt>过期时间</dt><dd>{formatTime(key.expiresAt)}</dd></div><div><dt>最近使用</dt><dd>{formatTime(key.lastUsedAt)}</dd></div></dl></div>
          <button class="rotate" type="button" disabled={!key.isActive || rotatingId === key.id} onclick={() => void rotate(key)}>{rotatingId === key.id ? '轮换中…' : '轮换密钥'}</button>
        </article>
      {:else}
        <div class="empty"><strong>尚未分配虚拟密钥</strong><p>请联系管理员为你的角色分配访问配置。</p></div>
      {/each}
    </section>
  {/if}
</main>

<footer><span>Elygate Enterprise</span><span>身份与权限由企业 SSO / SupAuth 验证</span></footer>
