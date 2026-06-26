<script lang="ts">
  import { onMount } from 'svelte';
  import { Download, Filter, RefreshCw } from '@lucide/svelte';
  import { createEnterpriseApiState, enterpriseApiGet } from '../enterpriseApi';

  type AuditEvent = {
    id: number;
    actor_type: string;
    actor_id?: string | null;
    action: string;
    resource: string;
    resource_id?: string | null;
    details: Record<string, unknown>;
    created_at?: string;
  };

  type AuditEventsResponse = {
    data: AuditEvent[];
    total: number;
    page?: number;
    limit?: number;
  };

  type AuditExportResponse = {
    filename: string;
    content_type: string;
    total: number;
    content: string;
  };

  let audit = $state(createEnterpriseApiState<AuditEventsResponse>());
  let filters = $state({
    action: '',
    resource: '',
    actor_type: '',
    actor_id: '',
    resource_id: '',
    app_instance_id: '',
    from: '',
    to: '',
    q: '',
  });
  let exporting = $state(false);

  function queryString(): string {
    const params = new URLSearchParams();
    params.set('limit', '100');
    for (const [key, value] of Object.entries(filters)) {
      if (value.trim()) params.set(key, value.trim());
    }
    return params.toString();
  }

  async function load() {
    audit.loading = true;
    audit.error = null;
    try {
      audit.data = await enterpriseApiGet<AuditEventsResponse>(`/audit-events?${queryString()}`);
    } catch (error) {
      audit.error = error instanceof Error ? error.message : String(error);
    } finally {
      audit.loading = false;
    }
  }

  async function exportCsv() {
    exporting = true;
    audit.error = null;
    try {
      const data = await enterpriseApiGet<AuditExportResponse>(`/audit-events/export?${queryString()}`);
      const blob = new Blob([data.content], { type: data.content_type || 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = data.filename || 'elygate-audit-events.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      audit.error = error instanceof Error ? error.message : String(error);
    } finally {
      exporting = false;
    }
  }

  function resetFilters() {
    filters = {
      action: '',
      resource: '',
      actor_type: '',
      actor_id: '',
      resource_id: '',
      app_instance_id: '',
      from: '',
      to: '',
      q: '',
    };
    void load();
  }

  function formatDate(value?: string): string {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function compactDetails(value: Record<string, unknown>): string {
    const text = JSON.stringify(value);
    return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  }

  onMount(() => {
    void load();
  });
</script>

<section class="enterprise-page">
  <header>
    <div>
      <h1>审计事件</h1>
      <p>{audit.data?.total ?? 0} events</p>
    </div>
    <div class="enterprise-actions">
      <button class="enterprise-button enterprise-button-secondary" type="button" onclick={load} disabled={audit.loading}>
        <RefreshCw size={14} />
        刷新
      </button>
      <button class="enterprise-button" type="button" onclick={exportCsv} disabled={exporting || audit.loading}>
        <Download size={14} />
        导出 CSV
      </button>
    </div>
  </header>

  <form class="enterprise-form" onsubmit={(event) => { event.preventDefault(); void load(); }}>
    <label>
      Action
      <input bind:value={filters.action} placeholder="budget.create" />
    </label>
    <label>
      Resource
      <input bind:value={filters.resource} placeholder="budget" />
    </label>
    <label>
      Actor Type
      <select bind:value={filters.actor_type}>
        <option value="">全部</option>
        <option value="user">user</option>
        <option value="service_account">service_account</option>
        <option value="gateway_api_key">gateway_api_key</option>
        <option value="system">system</option>
      </select>
    </label>
    <label>
      Actor
      <input bind:value={filters.actor_id} placeholder="user_..." />
    </label>
    <label>
      Resource ID
      <input bind:value={filters.resource_id} placeholder="resource id" />
    </label>
    <label>
      App Instance
      <input bind:value={filters.app_instance_id} placeholder="agi_..." />
    </label>
    <label>
      From
      <input type="datetime-local" bind:value={filters.from} />
    </label>
    <label>
      To
      <input type="datetime-local" bind:value={filters.to} />
    </label>
    <label>
      Search
      <input bind:value={filters.q} placeholder="trace / reason / model" />
    </label>
    <div class="enterprise-actions enterprise-form-wide">
      <button class="enterprise-button" type="submit" disabled={audit.loading}>
        <Filter size={14} />
        应用筛选
      </button>
      <button class="enterprise-button enterprise-button-secondary" type="button" onclick={resetFilters}>
        清空
      </button>
    </div>
  </form>

  {#if audit.error}
    <div class="enterprise-error">{audit.error}</div>
  {:else if audit.loading}
    <div class="enterprise-empty">加载审计事件...</div>
  {:else if audit.data}
    <div class="enterprise-table-wrap">
      <table class="enterprise-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Resource</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {#each audit.data.data as event (event.id)}
            <tr>
              <td>{formatDate(event.created_at)}</td>
              <td>{event.actor_type}:{event.actor_id ?? '-'}</td>
              <td class="enterprise-code">{event.action}</td>
              <td>{event.resource}:{event.resource_id ?? '-'}</td>
              <td class="enterprise-code">{compactDetails(event.details)}</td>
            </tr>
          {:else}
            <tr>
              <td colspan="5" class="enterprise-muted">暂无审计事件</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
