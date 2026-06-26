<script lang="ts">
  import { onMount } from 'svelte';
  import { RefreshCw } from '@lucide/svelte';
  import { createEnterpriseApiState, enterpriseApiGet } from '../enterpriseApi';

  type UsageRow = {
    subject_id: string;
    subject_label: string;
    requests: number;
    quota_cost: number;
    error_count: number;
    avg_elapsed_ms: number;
    last_seen_at?: string;
  };

  type UsageEfficiencyResponse = {
    totals: {
      requests: number;
      quota_cost: number;
      prompt_tokens: number;
      completion_tokens: number;
      cached_tokens: number;
      error_count: number;
      avg_elapsed_ms: number;
    };
    efficiency: {
      quota_per_request: number;
      error_rate_pct: number;
      cache_ratio_pct: number;
      avg_elapsed_ms: number;
    };
    dimensions: Record<string, UsageRow[]>;
  };

  let efficiencyState = $state(createEnterpriseApiState<UsageEfficiencyResponse>());
  let view = $state('models');
  let days = $state(7);
  const tabs = [
    { key: 'models', label: '模型' },
    { key: 'users', label: '用户' },
    { key: 'api_keys', label: 'API Key' },
    { key: 'channels', label: '渠道' },
    { key: 'external_workspaces', label: 'Workspace' },
    { key: 'external_features', label: 'Feature' },
  ];
  const rows = $derived(efficiencyState.data?.dimensions[view] ?? []);

  function formatNumber(value: number | undefined): string {
    return new Intl.NumberFormat('zh-CN').format(value ?? 0);
  }

  function formatDate(value?: string): string {
    return value ? new Date(value).toLocaleString('zh-CN') : '-';
  }

  async function load() {
    efficiencyState.loading = true;
    efficiencyState.error = null;
    try {
      efficiencyState.data = await enterpriseApiGet<UsageEfficiencyResponse>(`/usage-efficiency?days=${days}&limit=50`);
    } catch (error) {
      efficiencyState.error = error instanceof Error ? error.message : String(error);
    } finally {
      efficiencyState.loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="enterprise-page">
  <header>
    <div>
      <h1>效能看板</h1>
      <p>{days} 天窗口</p>
    </div>
    <div class="enterprise-actions">
      <select bind:value={days} onchange={() => void load()}>
        <option value={7}>7 天</option>
        <option value={30}>30 天</option>
        <option value={90}>90 天</option>
      </select>
      <button class="enterprise-button enterprise-button-secondary" type="button" onclick={() => void load()} disabled={efficiencyState.loading}>
        <RefreshCw size={14} />
        刷新
      </button>
    </div>
  </header>

  {#if efficiencyState.error}
    <div class="enterprise-error">{efficiencyState.error}</div>
  {:else if efficiencyState.loading}
    <div class="enterprise-empty">加载效能数据...</div>
  {:else if efficiencyState.data}
    <div class="enterprise-grid">
      <article class="enterprise-card">
        <h3>请求数</h3>
        <div class="enterprise-stat">{formatNumber(efficiencyState.data.totals.requests)}</div>
      </article>
      <article class="enterprise-card">
        <h3>单请求额度</h3>
        <div class="enterprise-stat">{efficiencyState.data.efficiency.quota_per_request}</div>
      </article>
      <article class="enterprise-card">
        <h3>错误率</h3>
        <div class="enterprise-stat">{efficiencyState.data.efficiency.error_rate_pct}%</div>
      </article>
      <article class="enterprise-card">
        <h3>缓存比</h3>
        <div class="enterprise-stat">{efficiencyState.data.efficiency.cache_ratio_pct}%</div>
      </article>
    </div>

    <div class="enterprise-segmented">
      {#each tabs as tab (tab.key)}
        <button class:enterprise-segmented-active={view === tab.key} type="button" onclick={() => { view = tab.key; }}>
          {tab.label}
        </button>
      {/each}
    </div>

    <div class="enterprise-table-wrap">
      <table class="enterprise-table">
        <thead>
          <tr>
            <th>维度</th>
            <th>请求</th>
            <th>额度</th>
            <th>错误</th>
            <th>延迟</th>
            <th>最近访问</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.subject_id)}
            <tr>
              <td>{row.subject_label}</td>
              <td>{formatNumber(row.requests)}</td>
              <td>{formatNumber(row.quota_cost)}</td>
              <td>{formatNumber(row.error_count)}</td>
              <td>{formatNumber(row.avg_elapsed_ms)} ms</td>
              <td>{formatDate(row.last_seen_at)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
