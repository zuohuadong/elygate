<script lang="ts">
  import { onMount } from 'svelte';
  import { StatsCard, PageHeader, BarChart } from '@svadmin/ui';
  import * as Card from '@svadmin/ui/components/ui/card/index.js';
  import { useDataProvider } from '@svadmin/core';
  import { Users, Radio, Activity, Database, Zap, Layers, Folder, Key, Clock, AlertCircle, Check } from '@lucide/svelte';

  const dataProvider = useDataProvider()();
  
  let stats = $state<{
    totalUsers: number;
    activeChannels: number;
    totalQuota: number;
    usedQuota: number;
    todayQuota: number;
  }>({
    totalUsers: 0,
    activeChannels: 0,
    totalQuota: 0,
    usedQuota: 0,
    todayQuota: 0
  });

  let loading = $state(true);
  let recentLogs = $state<any[]>([]);
  let logsLoading = $state(true);

  onMount(async () => {
    try {
      // Load global stats
      dataProvider.custom?.({
        url: '/api/admin/dashboard/stats',
        method: 'get'
      }).then((res) => {
        if (res && res.data) stats = res.data;
      }).catch(e => console.error('Failed to load stats', e))
        .finally(() => loading = false);

      // Load recent logs
      dataProvider.getList({
        resource: 'logs',
        pagination: { current: 1, pageSize: 6 },
        sort: { field: 'id', order: 'desc' }
      }).then((res) => {
        if (res && res.data) recentLogs = res.data;
      }).catch(e => console.error('Failed to load logs', e))
        .finally(() => logsLoading = false);
    } catch (e) {
      console.error(e);
    }
  });

  const formatCompactNumber = (number: number) => 
    new Intl.NumberFormat('en-US', {
      notation: 'compact',
      compactDisplay: 'short'
    }).format(Number(number || 0));

  const formatQuota = (val: any) => `$ ${Number(val || 0).toFixed(4)}`;
  const formatTime = (iso: string) => {
    if (!iso) return '-';
    try {
      const date = new Date(iso);
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    } catch {
      return '-';
    }
  };
</script>

<div class="space-y-6">
  <PageHeader title="仪表盘" description="系统运行总览" />

  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
    <StatsCard
      label="总用户数"
      value={stats.totalUsers.toString()}
      icon={Users}
      description="系统注册用户"
      class="glass-card"
      {loading}
    />
    <StatsCard
      label="活跃渠道数"
      value={stats.activeChannels.toString()}
      icon={Radio}
      description="当前在线可用渠道"
      class="glass-card"
      {loading}
    />
    <StatsCard
      label="今日消耗额度"
      value={formatCompactNumber(stats.todayQuota)}
      icon={Activity}
      description="今日系统总请求消耗"
      class="glass-card"
      {loading}
    />
    <StatsCard
      label="总消耗额度"
      value={formatCompactNumber(stats.usedQuota)}
      icon={Database}
      description="历史总消耗"
      class="glass-card"
      {loading}
    />
  </div>

  <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
    <!-- Quick Actions -->
    <Card.Root class="glass-card border-none bg-transparent lg:col-span-1 shadow-lg">
      <Card.Header>
        <Card.Title class="flex items-center gap-2 text-lg">
          <Zap class="w-5 h-5 text-amber-500" />
          快速操作
        </Card.Title>
      </Card.Header>
      <Card.Content class="grid gap-3 pt-0">
        <a href="#/channels" class="group flex items-center gap-4 rounded-xl p-3 hover:bg-muted/50 transition-all border border-transparent hover:border-border">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
            <Layers class="h-5 w-5 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <div>
            <div class="font-medium text-sm">渠道管理</div>
            <div class="text-xs text-muted-foreground">管理上游下游调用池与分组配置</div>
          </div>
        </a>
        <a href="#/users" class="group flex items-center gap-4 rounded-xl p-3 hover:bg-muted/50 transition-all border border-transparent hover:border-border">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <Users class="h-5 w-5 text-blue-500 group-hover:scale-110 transition-transform" />
          </div>
          <div>
            <div class="font-medium text-sm">用户管理</div>
            <div class="text-xs text-muted-foreground">配置系统各层级用户额度授权</div>
          </div>
        </a>
        <a href="#/tokens" class="group flex items-center gap-4 rounded-xl p-3 hover:bg-muted/50 transition-all border border-transparent hover:border-border">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
            <Key class="h-5 w-5 text-purple-500 group-hover:scale-110 transition-transform" />
          </div>
          <div>
            <div class="font-medium text-sm">令牌管理</div>
            <div class="text-xs text-muted-foreground">生成与回收业务端点 Access Token</div>
          </div>
        </a>
        <a href="#/user-groups" class="group flex items-center gap-4 rounded-xl p-3 hover:bg-muted/50 transition-all border border-transparent hover:border-border">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
            <Folder class="h-5 w-5 text-amber-500 group-hover:scale-110 transition-transform" />
          </div>
          <div>
            <div class="font-medium text-sm">分组管理</div>
            <div class="text-xs text-muted-foreground">分配各类倍率分组池</div>
          </div>
        </a>
      </Card.Content>
    </Card.Root>

    <!-- Recent System Requests -->
    <Card.Root class="glass-card border-none bg-transparent lg:col-span-2 shadow-lg flex flex-col h-[400px]">
      <Card.Header class="flex flex-row items-center justify-between pb-2">
        <Card.Title class="flex items-center gap-2 text-lg">
          <Clock class="w-5 h-5 text-indigo-500" />
          全系统最近请求
        </Card.Title>
        <a href="#/logs" class="text-xs text-indigo-500 font-medium hover:underline">查看全部 →</a>
      </Card.Header>
      <Card.Content class="grid gap-3 overflow-y-auto flex-1 pr-2 mt-4 pb-4">
        {#if logsLoading}
          <div class="text-center text-sm text-muted-foreground py-8">正在拉取全系统日志...</div>
        {:else if recentLogs.length === 0}
          <div class="text-center py-8">
            <Activity class="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
            <p class="text-sm text-muted-foreground">暂无请求记录</p>
          </div>
        {:else}
          {#each recentLogs as log}
            <div class="flex items-center justify-between p-3 rounded-xl border bg-card/50 hover:bg-muted/50 transition-colors">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center { (log.status === 200 || log.status === 1 || log.isSuccess) ? 'bg-emerald-500/10' : 'bg-destructive/10' }">
                  {#if log.status === 200 || log.status === 1 || log.isSuccess}
                    <Check class="w-4 h-4 text-emerald-500" />
                  {:else}
                    <AlertCircle class="w-4 h-4 text-destructive" />
                  {/if}
                </div>
                <div>
                  <div class="font-medium text-sm font-mono tracking-tight">{log.model_name || log.modelName || log.model || 'Unknown Model'}</div>
                  <div class="text-xs text-muted-foreground mt-0.5">
                    {(log.prompt_tokens || log.promptTokens || 0) + (log.completion_tokens || log.completionTokens || 0)} tokens · {formatTime(log.created_at || log.createdAt)}
                  </div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-sm font-medium font-mono">{formatQuota(log.quota || log.quota_cost || log.quotaCost || 0)}</div>
              </div>
            </div>
          {/each}
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
</div>
