<script lang="ts">
  import { onMount } from 'svelte';
  import { CheckCircle, PauseCircle, RefreshCw, Trash2 } from '@lucide/svelte';
  import { ELYGATE_ENTERPRISE_MANIFEST } from '@elygate/enterprise-contracts';
  import { createEnterpriseApiState, enterpriseApiGet, enterpriseApiPut } from '../enterpriseApi';

  type GatewayInstance = {
    id: number | string;
    tenant_id: string;
    org_id: string;
    app_instance_id: string;
    project_id?: string;
    status: string;
    public_base_url?: string;
    admin_base_url?: string;
    entitlements_version: number;
    updated_at?: string;
  };

  type GatewayInstancesResponse = {
    data: GatewayInstance[];
    total: number;
  };

  let instances = $state(createEnterpriseApiState<GatewayInstancesResponse>());
  let actionError = $state<string | null>(null);
  let actionBusy = $state<string | null>(null);

  async function loadInstances() {
    instances.loading = true;
    instances.error = null;
    try {
      instances.data = await enterpriseApiGet<GatewayInstancesResponse>('/gateway-instances');
    } catch (error) {
      instances.error = error instanceof Error ? error.message : String(error);
    } finally {
      instances.loading = false;
    }
  }

  async function updateStatus(instance: GatewayInstance, status: string) {
    actionError = null;
    actionBusy = `${instance.id}:${status}`;
    try {
      await enterpriseApiPut<GatewayInstance>(`/gateway-instances/${encodeURIComponent(String(instance.id))}`, { status });
      await loadInstances();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      actionBusy = null;
    }
  }

  onMount(() => {
    void loadInstances();
  });
</script>

<section class="enterprise-page">
  <header>
    <div>
    <h1>网关实例</h1>
      <p>{ELYGATE_ENTERPRISE_MANIFEST.callbacks.health}</p>
    </div>
    <button class="enterprise-button enterprise-button-secondary" type="button" onclick={() => void loadInstances()} disabled={instances.loading}>
      <RefreshCw size={14} />
      <span>刷新</span>
    </button>
  </header>

  {#if instances.error || actionError}
    <div class="enterprise-error">{instances.error ?? actionError}</div>
  {:else if instances.loading}
    <div class="enterprise-empty">加载网关实例...</div>
  {:else if instances.data}
    <div class="enterprise-grid">
      <article class="enterprise-card">
        <h3>实例总数</h3>
        <div class="enterprise-stat">{instances.data.total}</div>
      </article>
      <article class="enterprise-card">
        <h3>安装入口</h3>
        <p class="enterprise-code">{ELYGATE_ENTERPRISE_MANIFEST.callbacks.install}</p>
      </article>
      <article class="enterprise-card">
        <h3>事件同步</h3>
        <p class="enterprise-code">{ELYGATE_ENTERPRISE_MANIFEST.callbacks.events}</p>
      </article>
      <article class="enterprise-card">
        <h3>卸载回调</h3>
        <p class="enterprise-code">{ELYGATE_ENTERPRISE_MANIFEST.callbacks.uninstall}</p>
      </article>
    </div>

    <div class="enterprise-table-wrap">
      <table class="enterprise-table">
        <thead>
          <tr>
            <th>Instance</th>
            <th>状态</th>
            <th>Project</th>
            <th>Public URL</th>
            <th>Admin URL</th>
            <th>Entitlements</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {#each instances.data.data as instance (instance.id)}
            <tr>
              <td class="enterprise-code">{instance.app_instance_id}</td>
              <td><span class="enterprise-status">{instance.status}</span></td>
              <td>{instance.project_id ?? '-'}</td>
              <td class="enterprise-code">{instance.public_base_url ?? '-'}</td>
              <td class="enterprise-code">{instance.admin_base_url ?? '-'}</td>
              <td>{instance.entitlements_version}</td>
              <td>
                <div class="enterprise-actions">
                  <button class="enterprise-icon-button" type="button" title="激活" aria-label="激活" disabled={actionBusy !== null} onclick={() => void updateStatus(instance, 'active')}>
                    <CheckCircle size={14} />
                  </button>
                  <button class="enterprise-icon-button" type="button" title="暂停" aria-label="暂停" disabled={actionBusy !== null} onclick={() => void updateStatus(instance, 'suspended')}>
                    <PauseCircle size={14} />
                  </button>
                  <button class="enterprise-icon-button enterprise-danger" type="button" title="删除投影" aria-label="删除投影" disabled={actionBusy !== null} onclick={() => void updateStatus(instance, 'deleted')}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="7" class="enterprise-muted">暂无网关实例</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
