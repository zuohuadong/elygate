<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Button, PageHeader } from '@svadmin/ui';

  type MemoryItem = {
    id: string;
    userId?: number;
    tokenId?: number | null;
    scope: string;
    kind: string;
    content: string;
    confidence: number;
    sourceTraceId?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  };

  type MemoryStats = {
    total: number;
    active: number;
    deleted: number;
    expired: number;
    byScope: Record<string, number>;
    byKind: Record<string, number>;
  };

  let stats = $state<MemoryStats | null>(null);
  let memories = $state<MemoryItem[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let message = $state({ type: '', text: '' });
  let query = $state('');
  let userId = $state('');
  let scope = $state('');
  let kind = $state('');
  let includeDeleted = $state(false);
  let offset = $state(0);
  const limit = 25;

  const page = $derived(Math.floor(offset / limit) + 1);
  const pageCount = $derived(Math.max(1, Math.ceil(total / limit)));

  onMount(async () => {
    await refreshAll();
  });

  function showMessage(type: string, text: string) {
    message = { type, text };
    setTimeout(() => (message = { type: '', text: '' }), 3000);
  }

  function buildQuery() {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    if (query.trim()) params.set('query', query.trim());
    if (userId.trim()) params.set('userId', userId.trim());
    if (scope) params.set('scope', scope);
    if (kind) params.set('kind', kind);
    if (includeDeleted) params.set('includeDeleted', 'true');
    return params.toString();
  }

  async function loadStats() {
    const res = await fetch('/api/admin/memory/stats', { credentials: 'include' });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message || 'Failed to load memory stats');
    stats = json.data;
  }

  async function loadMemories() {
    const res = await fetch(`/api/admin/memory?${buildQuery()}`, { credentials: 'include' });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message || 'Failed to load memories');
    memories = json.data || [];
    total = json.total || 0;
  }

  async function refreshAll() {
    loading = true;
    try {
      await Promise.all([loadStats(), loadMemories()]);
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : String(error));
    } finally {
      loading = false;
    }
  }

  async function applyFilters() {
    offset = 0;
    await refreshAll();
  }

  async function deleteMemory(id: string) {
    const res = await fetch(`/api/admin/memory/${id}`, { method: 'DELETE', credentials: 'include' });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showMessage('error', json.message || '删除失败');
      return;
    }
    showMessage('success', '记忆已软删除');
    await refreshAll();
  }

  async function cleanupExpired() {
    const res = await fetch('/api/admin/memory/cleanup-expired', { method: 'POST', credentials: 'include' });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showMessage('error', json.message || '清理失败');
      return;
    }
    showMessage('success', `已清理 ${json.count || 0} 条过期记忆`);
    await refreshAll();
  }

  async function purgeDeleted() {
    const res = await fetch('/api/admin/memory/deleted', { method: 'DELETE', credentials: 'include' });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showMessage('error', json.message || '清空失败');
      return;
    }
    showMessage('success', `已永久清理 ${json.count || 0} 条已删除记忆`);
    await refreshAll();
  }

  function formatDate(value?: string | null) {
    if (!value) return '-';
    return new Date(value).toLocaleString();
  }
</script>

<div class="space-y-6">
  <PageHeader title="Agent Memory" description="长期记忆检索、治理与清理">
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={refreshAll}>刷新</Button>
      <Button variant="outline" size="sm" onclick={cleanupExpired}>清理过期</Button>
      <Button variant="outline" size="sm" onclick={purgeDeleted}>清空已删除</Button>
    {/snippet}
  </PageHeader>

  {#if message.text}
    <div class="rounded-md border px-4 py-3 text-sm {message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}">
      {message.text}
    </div>
  {/if}

  <div class="grid gap-4 md:grid-cols-4">
    <Card.Root><Card.Content class="pt-6"><div class="text-xs text-muted-foreground">总数</div><div class="text-lg font-semibold font-mono">{stats?.total ?? 0}</div></Card.Content></Card.Root>
    <Card.Root><Card.Content class="pt-6"><div class="text-xs text-muted-foreground">活跃</div><div class="text-lg font-semibold font-mono">{stats?.active ?? 0}</div></Card.Content></Card.Root>
    <Card.Root><Card.Content class="pt-6"><div class="text-xs text-muted-foreground">已删除</div><div class="text-lg font-semibold font-mono">{stats?.deleted ?? 0}</div></Card.Content></Card.Root>
    <Card.Root><Card.Content class="pt-6"><div class="text-xs text-muted-foreground">过期</div><div class="text-lg font-semibold font-mono">{stats?.expired ?? 0}</div></Card.Content></Card.Root>
  </div>

  <Card.Root>
    <Card.Header><Card.Title>筛选</Card.Title></Card.Header>
    <Card.Content>
      <div class="grid gap-3 md:grid-cols-6">
        <input bind:value={query} placeholder="搜索内容" class="h-9 rounded-md border border-input bg-background px-3 text-sm md:col-span-2" />
        <input bind:value={userId} placeholder="用户 ID" class="h-9 rounded-md border border-input bg-background px-3 text-sm" />
        <select bind:value={scope} class="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">全部 Scope</option>
          <option value="user">user</option>
          <option value="org">org</option>
          <option value="thread">thread</option>
        </select>
        <select bind:value={kind} class="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">全部类型</option>
          <option value="fact">fact</option>
          <option value="preference">preference</option>
          <option value="instruction">instruction</option>
          <option value="summary">summary</option>
          <option value="tool_result">tool_result</option>
        </select>
        <label class="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={includeDeleted} />
          已删除
        </label>
      </div>
      <div class="mt-3 flex justify-end">
        <Button size="sm" onclick={applyFilters}>应用筛选</Button>
      </div>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header><Card.Title>记忆列表</Card.Title></Card.Header>
    <Card.Content>
      {#if loading}
        <div class="flex justify-center py-12"><div class="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div></div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-left text-xs text-muted-foreground">
                <th class="py-2 pr-3">用户</th>
                <th class="py-2 pr-3">类型</th>
                <th class="py-2 pr-3">内容</th>
                <th class="py-2 pr-3">更新时间</th>
                <th class="py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {#each memories as item (item.id)}
                <tr class="border-b align-top">
                  <td class="py-3 pr-3 font-mono">{item.userId ?? '-'}</td>
                  <td class="py-3 pr-3"><span class="font-mono">{item.scope}</span> / <span class="font-mono">{item.kind}</span></td>
                  <td class="max-w-xl py-3 pr-3"><div class="line-clamp-3 whitespace-pre-wrap">{item.content}</div></td>
                  <td class="py-3 pr-3 whitespace-nowrap">{formatDate(item.updatedAt || item.createdAt)}</td>
                  <td class="py-3 text-right"><Button variant="outline" size="sm" onclick={() => deleteMemory(item.id)}>删除</Button></td>
                </tr>
              {:else}
                <tr><td colspan="5" class="py-10 text-center text-muted-foreground">暂无记忆</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <div>第 {page} / {pageCount} 页，共 {total} 条</div>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onclick={async () => { offset = Math.max(0, offset - limit); await refreshAll(); }}>上一页</Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= total} onclick={async () => { offset += limit; await refreshAll(); }}>下一页</Button>
          </div>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
