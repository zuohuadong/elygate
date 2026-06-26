<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Button, PageHeader } from '@svadmin/ui';

  let stats = $state<any>(null);
  let loading = $state(true);
  let message = $state({ type: '', text: '' });

  function authHeaders(extra: Record<string, string> = {}) {
    const token = localStorage.getItem('auth_token');
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  onMount(async () => {
    await loadStats();
  });

  async function loadStats() {
    loading = true;
    try {
      const res = await fetch('/api/admin/performance/stats', { credentials: 'include', headers: authHeaders() });
      if (res.ok) stats = (await res.json()).data;
    } catch (e) { console.error(e); }
    finally { loading = false; }
  }

  async function clearCaches() {
    try {
      const res = await fetch('/api/admin/performance/caches', { method: 'DELETE', credentials: 'include', headers: authHeaders() });
      if (res.ok) {
        message = { type: 'success', text: '缓存已清理' };
        setTimeout(() => message = { type: '', text: '' }, 3000);
        await loadStats();
      }
    } catch (e: any) { message = { type: 'error', text: e.message }; }
  }

  async function triggerGc() {
    try {
      const res = await fetch('/api/admin/performance/gc', { method: 'POST', credentials: 'include', headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        message = { type: 'success', text: `GC done. RSS: ${formatBytes(json.memory?.rss)}` };
        setTimeout(() => message = { type: '', text: '' }, 3000);
      }
    } catch (e: any) { message = { type: 'error', text: e.message }; }
  }

  function formatBytes(bytes: number) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${bytes.toFixed(1)} ${units[i]}`;
  }

  function formatUptime(s: number) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  }
</script>

<div class="space-y-6">
  <PageHeader title="性能监控" description="系统运行状态、缓存、内存">
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={loadStats}>刷新</Button>
      <Button variant="outline" size="sm" onclick={clearCaches}>清理缓存</Button>
      <Button variant="outline" size="sm" onclick={triggerGc}>触发 GC</Button>
    {/snippet}
  </PageHeader>

  {#if message.text}
    <div class="px-4 py-3 rounded-lg text-sm {message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}">
      {message.text}
    </div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-12"><div class="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div></div>
  {:else if stats}
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card.Root><Card.Content class="pt-6">
        <div class="text-xs text-muted-foreground">运行时间</div>
        <div class="text-lg font-semibold font-mono">{formatUptime(stats.uptime)}</div>
      </Card.Content></Card.Root>
      <Card.Root><Card.Content class="pt-6">
        <div class="text-xs text-muted-foreground">RSS 内存</div>
        <div class="text-lg font-semibold font-mono">{formatBytes(stats.memory?.rss)}</div>
      </Card.Content></Card.Root>
      <Card.Root><Card.Content class="pt-6">
        <div class="text-xs text-muted-foreground">计费队列</div>
        <div class="text-lg font-semibold font-mono">{stats.billingQueue?.length || 0}</div>
      </Card.Content></Card.Root>
      <Card.Root><Card.Content class="pt-6">
        <div class="text-xs text-muted-foreground">数据库大小</div>
        <div class="text-lg font-semibold font-mono">{formatBytes(stats.database?.sizeBytes)}</div>
      </Card.Content></Card.Root>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <Card.Root>
        <Card.Header><Card.Title>缓存统计</Card.Title></Card.Header>
        <Card.Content>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between"><span>渠道命中</span><span class="font-mono">{stats.cache?.channelHits} / {stats.cache?.channelMisses}</span></div>
            <div class="flex justify-between"><span>令牌命中</span><span class="font-mono">{stats.cache?.tokenHits} / {stats.cache?.tokenMisses}</span></div>
            <div class="flex justify-between"><span>语义缓存命中</span><span class="font-mono">{stats.cache?.semanticCacheHits} / {stats.cache?.semanticCacheMisses}</span></div>
            <div class="flex justify-between"><span>精确缓存命中</span><span class="font-mono">{stats.cache?.responseCacheHits} / {stats.cache?.responseCacheMisses}</span></div>
            <div class="flex justify-between"><span>活跃模型数</span><span class="font-mono">{stats.cache?.modelCount}</span></div>
            <div class="flex justify-between"><span>活跃渠道数</span><span class="font-mono">{stats.cache?.channelCount}</span></div>
          </div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>数据库概况</Card.Title></Card.Header>
        <Card.Content>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between"><span>总日志</span><span class="font-mono">{stats.database?.totalLogs?.toLocaleString()}</span></div>
            <div class="flex justify-between"><span>总渠道</span><span class="font-mono">{stats.database?.totalChannels}</span></div>
            <div class="flex justify-between"><span>活跃令牌</span><span class="font-mono">{stats.database?.activeTokens}</span></div>
            <div class="flex justify-between"><span>总用户</span><span class="font-mono">{stats.database?.totalUsers}</span></div>
            <div class="flex justify-between"><span>亲和缓存</span><span class="font-mono">{stats.affinity?.size} / {stats.affinity?.max}</span></div>
          </div>
        </Card.Content>
      </Card.Root>
    </div>
  {/if}
</div>
