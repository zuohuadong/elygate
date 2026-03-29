<script lang="ts">
  import { onMount } from 'svelte';
  import { StatsCard, PageHeader, BarChart } from '@svadmin/ui';
  import { useDataProvider } from '@svadmin/core';

  const dataProvider = useDataProvider();
  
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

  onMount(async () => {
    try {
      const res = await dataProvider.custom?.({
        url: '/dashboard/stats',
        method: 'get'
      });
      if (res && res.data) {
        stats = res.data;
      }
    } catch (e) {
      console.error('Failed to load stats', e);
    } finally {
      loading = false;
    }
  });

  // Helper to format large numbers
  const formatCompactNumber = (number: number) => 
    new Intl.NumberFormat('en-US', {
      notation: 'compact',
      compactDisplay: 'short'
    }).format(number);
</script>

<div class="space-y-6">
  <PageHeader title="仪表盘" description="系统运行总览" />

  <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
    <StatsCard
      title="总用户数"
      value={stats.totalUsers.toString()}
      icon="users"
      description="系统注册用户"
      {loading}
    />
    <StatsCard
      title="活跃渠道数"
      value={stats.activeChannels.toString()}
      icon="radio"
      description="当前在线可用渠道"
      {loading}
    />
    <StatsCard
      title="今日消耗额度"
      value={formatCompactNumber(stats.todayQuota)}
      icon="activity"
      description="今日系统总请求消耗"
      {loading}
    />
    <StatsCard
      title="总消耗额度"
      value={formatCompactNumber(stats.usedQuota)}
      icon="database"
      description="历史总消耗"
      {loading}
    />
  </div>
</div>
