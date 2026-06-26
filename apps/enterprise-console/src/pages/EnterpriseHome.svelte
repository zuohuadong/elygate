<script lang="ts">
  import { onMount } from 'svelte';
  import { ELYGATE_ENTERPRISE_MANIFEST } from '@elygate/enterprise-contracts';
  import { createEnterpriseApiState, enterpriseApiGet } from '../enterpriseApi';

  type OverviewData = {
    stats: Record<string, number>;
    model_distribution: Array<{ modelName: string; requests: number; cost: string | number | null }>;
    claims: {
      tenant_id: string;
      org_id: string;
      app_instance_id: string;
      roles: string[];
      scopes: string[];
    };
  };

  const statLabels: Array<{ key: string; label: string }> = [
    { key: 'gateway_instances', label: '网关实例' },
    { key: 'active_instances', label: '活跃实例' },
    { key: 'identity_policies', label: '策略' },
    { key: 'budgets', label: '预算' },
    { key: 'requests_7d', label: '7日请求' },
    { key: 'cost_7d', label: '7日额度消耗' },
    { key: 'gateway_api_keys', label: '数据面 Key' },
    { key: 'provider_channels', label: '供应商渠道' },
  ];

  let overview = $state(createEnterpriseApiState<OverviewData>());

  onMount(() => {
    let cancelled = false;
    async function load() {
      overview.loading = true;
      overview.error = null;
      try {
        const data = await enterpriseApiGet<OverviewData>('/overview');
        if (!cancelled) overview.data = data;
      } catch (error) {
        if (!cancelled) overview.error = error instanceof Error ? error.message : String(error);
      } finally {
        if (!cancelled) overview.loading = false;
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  });
</script>

<section class="enterprise-page">
  <header>
    <div>
    <h1>Elygate Enterprise</h1>
      <p>{ELYGATE_ENTERPRISE_MANIFEST.app_id}</p>
    </div>
  </header>

  {#if overview.error}
    <div class="enterprise-error">{overview.error}</div>
  {:else if overview.loading}
    <div class="enterprise-empty">加载企业控制面...</div>
  {:else if overview.data}
    <div class="enterprise-grid">
      {#each statLabels as stat (stat.key)}
      <article class="enterprise-card">
        <h3>{stat.label}</h3>
        <div class="enterprise-stat">{overview.data.stats[stat.key] ?? 0}</div>
      </article>
    {/each}
    </div>

    <article class="enterprise-card">
      <h3>当前租户</h3>
      <ul class="enterprise-list" aria-label="tenant claims">
        <li class="enterprise-chip">{overview.data.claims.tenant_id}</li>
        <li class="enterprise-chip">{overview.data.claims.org_id}</li>
        <li class="enterprise-chip">{overview.data.claims.app_instance_id}</li>
        {#each overview.data.claims.roles as role (role)}
          <li class="enterprise-chip">{role}</li>
        {/each}
      </ul>
    </article>

    <div class="enterprise-table-wrap">
      <table class="enterprise-table">
        <thead>
          <tr>
            <th>模型</th>
            <th>请求数</th>
            <th>额度消耗</th>
          </tr>
        </thead>
        <tbody>
          {#each overview.data.model_distribution as model (model.modelName)}
            <tr>
              <td class="enterprise-code">{model.modelName}</td>
              <td>{model.requests}</td>
              <td>{model.cost ?? 0}</td>
            </tr>
          {:else}
            <tr>
              <td colspan="3" class="enterprise-muted">暂无 7 日模型用量</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
