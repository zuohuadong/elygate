<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Button, PageHeader, StatsCard } from '@svadmin/ui';
  import { User, Folder, Database, Activity } from '@lucide/svelte';

  let userInfo = $state<Record<string, any> | null>(null);
  let logs = $state<any[]>([]);
  let loading = $state(true);
  let topupCode = $state('');
  let redeeming = $state(false);
  let message = $state({ type: '', text: '' });
  let checkinStatus = $state({ enabled: false, checkedIn: false, reward: 0 });
  let affInfo = $state({ code: '', inviteCount: 0, totalReward: 0 });
  let tokens = $state<any[]>([]);
  let newTokenName = $state('');
  let creatingToken = $state(false);

  const quotaPerUnit = 500000; // 1 USD = 500000 quota units

  onMount(async () => {
    await loadData();
  });

  async function loadData() {
    loading = true;
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const [infoRes, logsRes, checkinRes, affRes, tokensRes] = await Promise.all([
        fetch('/api/auth/user/info', { credentials: 'include', headers }),
        fetch('/api/auth/user/logs?limit=5', { credentials: 'include', headers }),
        fetch('/api/admin/self/checkin', { credentials: 'include', headers }).catch(() => null),
        fetch('/api/admin/self/aff', { credentials: 'include', headers }).catch(() => null),
        fetch('/api/admin/self/tokens', { credentials: 'include', headers }).catch(() => null),
      ]);
      if (infoRes.ok) userInfo = await infoRes.json();
      if (logsRes.ok) {
        const data = await logsRes.json();
        logs = data.data || (Array.isArray(data) ? data : []);
      }
      if (checkinRes?.ok) { const d = await checkinRes.json(); if (d.success) checkinStatus = d.data; }
      if (affRes?.ok) { const d = await affRes.json(); if (d.success) affInfo = d.data; }
      if (tokensRes?.ok) { const d = await tokensRes.json(); tokens = d.data || []; }
    } catch (e) {
      console.error('Failed to load user data', e);
    } finally {
      loading = false;
    }
  }

  async function handleRedeem(e: Event) {
    e.preventDefault();
    if (!topupCode.trim()) return;
    redeeming = true;
    message = { type: '', text: '' };
    try {
      const token = localStorage.getItem('auth_token');
      const fetchHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) fetchHeaders['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/redemptions/redeem', {
        method: 'POST',
        headers: fetchHeaders,
        credentials: 'include',
        body: JSON.stringify({ key: topupCode.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        message = { type: 'success', text: `充值成功！新增额度: $${(data.addedQuota / quotaPerUnit).toFixed(4)}` };
        topupCode = '';
        await loadData();
      } else {
        throw new Error(data.message || '兑换失败');
      }
    } catch (e: any) {
      message = { type: 'error', text: e.message || '兑换失败' };
    } finally {
      redeeming = false;
    }
  }

  async function handleCheckin() {
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/admin/self/checkin', {
        method: 'POST', credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.success) {
        message = { type: 'success', text: data.message };
        checkinStatus = { ...checkinStatus, checkedIn: true };
        await loadData();
        setTimeout(() => message = { type: '', text: '' }, 3000);
      } else {
        message = { type: 'error', text: data.message };
      }
    } catch (e: any) { message = { type: 'error', text: e.message }; }
  }

  async function handleCreateToken() {
    if (!newTokenName.trim()) return;
    creatingToken = true;
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/admin/self/tokens', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: newTokenName }),
      });
      const data = await res.json();
      if (data.success) {
        newTokenName = '';
        await loadData();
      }
    } catch (e: any) { message = { type: 'error', text: e.message }; }
    finally { creatingToken = false; }
  }

  async function handleDeleteToken(id: number) {
    try {
      const token = localStorage.getItem('auth_token');
      await fetch(`/api/admin/self/tokens/${id}`, {
        method: 'DELETE', credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      await loadData();
    } catch (e: any) { message = { type: 'error', text: e.message }; }
  }

  const balanceUsd = $derived(userInfo ? (userInfo.quota / quotaPerUnit) : 0);
  const usedUsd = $derived(userInfo ? (userInfo.usedQuota / quotaPerUnit) : 0);
</script>

<div class="space-y-6">
  <PageHeader title="个人工作台" description="查看使用统计与账户余额" />

  {#if loading}
    <div class="flex justify-center py-12">
      <div class="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"></div>
    </div>
  {:else}
    <!-- Balance & Stats -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Balance Card -->
      <div class="lg:col-span-1 bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
        <div class="absolute top-0 right-0 p-4 opacity-10">
          <svg class="w-24 h-24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>
        </div>
        <h3 class="text-indigo-100 text-sm font-medium opacity-80">可用余额</h3>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-4xl font-bold tracking-tight">${balanceUsd.toFixed(2)}</span>
          <span class="text-indigo-200 text-sm">USD</span>
        </div>
        <p class="text-indigo-200 text-xs mt-1">已用: ${usedUsd.toFixed(4)}</p>

        <div class="mt-6 pt-4 border-t border-white/10">
          <form onsubmit={handleRedeem} class="flex gap-2">
            <input
              bind:value={topupCode}
              placeholder="输入兑换码"
              class="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-xl text-sm placeholder:text-indigo-200/50 outline-none focus:bg-white/20 transition-all"
            />
            <button type="submit" disabled={redeeming || !topupCode.trim()} class="px-4 py-2 bg-white text-indigo-600 font-bold rounded-xl text-xs hover:bg-indigo-50 disabled:opacity-50 transition-all">
              {redeeming ? '...' : '兑换'}
            </button>
          </form>
          {#if message.text}
            <p class="text-xs mt-2 {message.type === 'success' ? 'text-emerald-200' : 'text-red-200'}">{message.text}</p>
          {/if}
        </div>
      </div>

      <!-- Info Cards -->
      <div class="lg:col-span-2 grid grid-cols-2 gap-4">
        <StatsCard label="用户名" value={userInfo?.username || '-'} icon={User} />
        <StatsCard label="用户组" value={userInfo?.group || 'default'} icon={Folder} />
        <StatsCard label="总额度" value={'$' + balanceUsd.toFixed(2)} icon={Database} />
        <StatsCard label="已用额度" value={'$' + usedUsd.toFixed(4)} icon={Activity} />
      </div>
    </div>

    <!-- Recent Logs -->
    <Card.Root>
      <Card.Header>
        <Card.Title>最近使用记录</Card.Title>
      </Card.Header>
      <Card.Content class="p-0">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-xs text-muted-foreground bg-muted/50 border-b">
              <tr>
                <th class="px-4 py-3 text-left font-medium">模型</th>
                <th class="px-4 py-3 text-center font-medium">Tokens</th>
                <th class="px-4 py-3 text-right font-medium">费用</th>
                <th class="px-4 py-3 text-right font-medium">时间</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {#each logs as log}
                <tr class="hover:bg-muted/30 transition-colors">
                  <td class="px-4 py-3 font-medium font-mono text-xs">{log.modelName}</td>
                  <td class="px-4 py-3 text-center text-muted-foreground font-mono">{(log.promptTokens || 0) + (log.completionTokens || 0)}</td>
                  <td class="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">${((log.quotaCost || 0) / quotaPerUnit).toFixed(6)}</td>
                  <td class="px-4 py-3 text-right text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</td>
                </tr>
              {/each}
              {#if logs.length === 0}
                <tr><td colspan="4" class="px-4 py-8 text-center text-muted-foreground">暂无记录</td></tr>
              {/if}
            </tbody>
          </table>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Checkin, Aff & Tokens row -->
    <div class="grid gap-6 lg:grid-cols-3">
      <!-- Checkin -->
      <Card.Root>
        <Card.Header><Card.Title>每日签到</Card.Title></Card.Header>
        <Card.Content>
          {#if checkinStatus.enabled}
            <Button class="w-full" disabled={checkinStatus.checkedIn} onclick={handleCheckin}>
              {checkinStatus.checkedIn ? '已签到' : `签到 (+${checkinStatus.reward} 额度)`}
            </Button>
          {:else}
            <p class="text-sm text-muted-foreground">签到功能未启用</p>
          {/if}
        </Card.Content>
      </Card.Root>

      <!-- Affiliate -->
      <Card.Root>
        <Card.Header><Card.Title>邀请返利</Card.Title></Card.Header>
        <Card.Content class="space-y-2">
          {#if affInfo.code}
            <div class="font-mono text-sm bg-muted p-2 rounded select-all">{affInfo.code}</div>
            <p class="text-xs text-muted-foreground">已邀请 {affInfo.inviteCount} 人，累计奖励 {affInfo.totalReward}</p>
          {:else}
            <p class="text-sm text-muted-foreground">暂无邀请码</p>
          {/if}
        </Card.Content>
      </Card.Root>

      <!-- Create Token -->
      <Card.Root>
        <Card.Header><Card.Title>快速创建令牌</Card.Title></Card.Header>
        <Card.Content>
          <div class="flex gap-2">
            <input bind:value={newTokenName} placeholder="令牌名称" class="flex-1 h-8 rounded border px-2 text-sm" />
            <Button size="sm" disabled={creatingToken} onclick={handleCreateToken}>
              {creatingToken ? '...' : '创建'}
            </Button>
          </div>
          {#if tokens.length > 0}
            <div class="mt-3 space-y-1 max-h-32 overflow-y-auto">
              {#each tokens.slice(0, 5) as tk}
                <div class="flex items-center justify-between text-xs py-1">
                  <span class="font-mono truncate">{tk.name}: {tk.key}</span>
                  <button class="text-destructive" onclick={() => handleDeleteToken(tk.id)}>X</button>
                </div>
              {/each}
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
    </div>
  {/if}
</div>
