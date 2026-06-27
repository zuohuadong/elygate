<script lang="ts">
  import { onMount } from 'svelte';
  import { Plus, RefreshCw, Save } from '@lucide/svelte';
  import { createEnterpriseApiState, enterpriseApiGet, enterpriseApiPost, enterpriseApiPut } from '../enterpriseApi';

  type Entitlements = {
    default_no_training: boolean;
    data_retention_days: number;
    provider_compliance_mode: string;
    allowed_ip_policy?: string | null;
  };

  type ProviderCompliance = {
    id: number;
    provider_kind: string;
    provider_id: string;
    display_name?: string | null;
    no_training: boolean;
    zero_retention: boolean;
    region?: string | null;
    status: string;
  };

  type GovernanceResponse = {
    entitlements: Entitlements;
    providers: { data: ProviderCompliance[]; total: number };
    enforcement: {
      default_no_training: boolean;
      provider_compliance_mode: string;
      allowed_providers: ProviderCompliance[];
      blocked_providers: ProviderCompliance[];
    };
  };

  let governanceState = $state(createEnterpriseApiState<GovernanceResponse>());
  let actionError = $state<string | null>(null);
  let savingPolicy = $state(false);
  let creatingProvider = $state(false);
  let defaultNoTraining = $state(true);
  let dataRetentionDays = $state(30);
  let providerComplianceMode = $state('strict');
  let allowedIpPolicy = $state('');
  let providerKind = $state('channel');
  let providerId = $state('');
  let providerName = $state('');
  let providerStatus = $state('approved');
  let providerNoTraining = $state(true);
  let providerZeroRetention = $state(false);

  async function load() {
    governanceState.loading = true;
    governanceState.error = null;
    try {
      governanceState.data = await enterpriseApiGet<GovernanceResponse>('/data-governance');
      defaultNoTraining = governanceState.data.entitlements.default_no_training;
      dataRetentionDays = governanceState.data.entitlements.data_retention_days;
      providerComplianceMode = governanceState.data.entitlements.provider_compliance_mode;
      allowedIpPolicy = governanceState.data.entitlements.allowed_ip_policy ?? '';
    } catch (error) {
      governanceState.error = error instanceof Error ? error.message : String(error);
    } finally {
      governanceState.loading = false;
    }
  }

  async function savePolicy() {
    actionError = null;
    savingPolicy = true;
    try {
      await enterpriseApiPut('/org-entitlements', {
        default_no_training: defaultNoTraining,
        data_retention_days: dataRetentionDays,
        provider_compliance_mode: providerComplianceMode,
        allowed_ip_policy: allowedIpPolicy || null,
      });
      await load();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      savingPolicy = false;
    }
  }

  async function saveProvider() {
    actionError = null;
    creatingProvider = true;
    try {
      await enterpriseApiPost('/provider-compliance', {
        provider_kind: providerKind,
        provider_id: providerId,
        display_name: providerName || null,
        status: providerStatus,
        no_training: providerNoTraining,
        zero_retention: providerZeroRetention,
      });
      providerId = '';
      providerName = '';
      await load();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      creatingProvider = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="enterprise-page">
  <header>
    <div>
      <h1>数据治理</h1>
      <p>{governanceState.data?.enforcement.allowed_providers.length ?? 0} compliant providers</p>
    </div>
    <button class="enterprise-button enterprise-button-secondary" type="button" onclick={() => void load()} disabled={governanceState.loading}>
      <RefreshCw size={14} />
      刷新
    </button>
  </header>

  {#if governanceState.error || actionError}
    <div class="enterprise-error">{governanceState.error ?? actionError}</div>
  {:else if governanceState.loading}
    <div class="enterprise-empty">加载数据治理...</div>
  {:else if governanceState.data}
    <div class="enterprise-grid">
      <article class="enterprise-card">
        <h3>默认不训练</h3>
        <p>{governanceState.data.entitlements.default_no_training ? 'enabled' : 'disabled'}</p>
      </article>
      <article class="enterprise-card">
        <h3>保留天数</h3>
        <div class="enterprise-stat">{governanceState.data.entitlements.data_retention_days}</div>
      </article>
      <article class="enterprise-card">
        <h3>合规模式</h3>
        <p>{governanceState.data.entitlements.provider_compliance_mode}</p>
      </article>
    </div>

    <form class="enterprise-form" onsubmit={(event) => { event.preventDefault(); void savePolicy(); }}>
      <label>
        默认不训练
        <select bind:value={defaultNoTraining}>
          <option value={true}>开启</option>
          <option value={false}>关闭</option>
        </select>
      </label>
      <label>
        保留天数
        <input type="number" min="0" bind:value={dataRetentionDays} />
      </label>
      <label>
        合规模式
        <select bind:value={providerComplianceMode}>
          <option value="strict">strict</option>
          <option value="warn">warn</option>
          <option value="off">off</option>
        </select>
      </label>
      <label class="enterprise-form-wide">
        固定 IP / CIDR
        <textarea rows="2" bind:value={allowedIpPolicy}></textarea>
      </label>
      <button class="enterprise-button" type="submit" disabled={savingPolicy}>
        <Save size={14} />
        保存治理策略
      </button>
    </form>

    <form class="enterprise-form" onsubmit={(event) => { event.preventDefault(); void saveProvider(); }}>
      <label>
        Provider ID
        <input bind:value={providerId} placeholder="1 或 provider slug" />
      </label>
      <label>
        名称
        <input bind:value={providerName} placeholder="OpenAI Enterprise" />
      </label>
      <label>
        类型
        <select bind:value={providerKind}>
          <option value="channel">channel</option>
          <option value="vendor">vendor</option>
          <option value="upstream">upstream</option>
        </select>
      </label>
      <label>
        状态
        <select bind:value={providerStatus}>
          <option value="approved">approved</option>
          <option value="review">review</option>
          <option value="blocked">blocked</option>
        </select>
      </label>
      <label>
        不训练
        <select bind:value={providerNoTraining}>
          <option value={true}>是</option>
          <option value={false}>否</option>
        </select>
      </label>
      <label>
        零保留
        <select bind:value={providerZeroRetention}>
          <option value={false}>否</option>
          <option value={true}>是</option>
        </select>
      </label>
      <button class="enterprise-button" type="submit" disabled={creatingProvider}>
        <Plus size={14} />
        记录供应商
      </button>
    </form>

    <div class="enterprise-table-wrap">
      <table class="enterprise-table">
        <thead>
          <tr>
            <th>供应商</th>
            <th>不训练</th>
            <th>零保留</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {#each governanceState.data.providers.data as provider (provider.id)}
            <tr>
              <td>{provider.display_name ?? provider.provider_id}</td>
              <td>{provider.no_training ? 'yes' : 'no'}</td>
              <td>{provider.zero_retention ? 'yes' : 'no'}</td>
              <td>{provider.status}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
