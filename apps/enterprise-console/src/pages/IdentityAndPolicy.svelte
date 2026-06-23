<script lang="ts">
  import { onMount } from 'svelte';
  import { Plus, RefreshCw } from '@lucide/svelte';
  import { AI_GATEWAY_SCOPES } from '@elygate/enterprise-contracts';
  import type { EnterprisePolicyEvaluationResult } from '@elygate/enterprise-contracts';
  import { createEnterpriseApiState, enterpriseApiGet, enterpriseApiPost } from '../enterpriseApi';

  const scopes = Object.values(AI_GATEWAY_SCOPES);

  type Policy = {
    id: number;
    name: string;
    target_kind: string;
    target_id?: string | null;
    effect: string;
    status: string;
    rules: Record<string, unknown>;
    updated_at?: string;
  };

  type IdentityPolicyResponse = {
    claims: {
      tenant_id: string;
      org_id: string;
      app_instance_id: string;
      user_id?: string;
      service_account_id?: string;
      roles: string[];
      scopes: string[];
      entitlements_version: number;
    };
    policies: Policy[];
    total: number;
  };

  let identity = $state(createEnterpriseApiState<IdentityPolicyResponse>());
  let actionError = $state<string | null>(null);
  let policyName = $state('');
  let policyTargetKind = $state('org');
  let policyTargetId = $state('');
  let policyEffect = $state('allow');
  let policyRulesText = $state('{"models":["*"]}');
  let policySubmitting = $state(false);
  let evaluationModel = $state('gpt-4.1');
  let evaluationAction = $state('request');
  let evaluationWorkspace = $state('');
  let evaluationFeature = $state('');
  let evaluationSubmitting = $state(false);
  let evaluationResult = $state<EnterprisePolicyEvaluationResult | null>(null);

  async function loadIdentity() {
    identity.loading = true;
    identity.error = null;
    try {
      identity.data = await enterpriseApiGet<IdentityPolicyResponse>('/identity-and-policy');
    } catch (error) {
      identity.error = error instanceof Error ? error.message : String(error);
    } finally {
      identity.loading = false;
    }
  }

  async function createPolicy() {
    actionError = null;
    policySubmitting = true;
    try {
      const rules = JSON.parse(policyRulesText) as Record<string, unknown>;
      await enterpriseApiPost<Policy>('/identity-policies', {
        name: policyName || 'Default Enterprise Policy',
        target_kind: policyTargetKind,
        target_id: policyTargetId || null,
        effect: policyEffect,
        rules,
      });
      policyName = '';
      policyTargetId = '';
      await loadIdentity();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      policySubmitting = false;
    }
  }

  async function runPolicyEvaluation() {
    actionError = null;
    evaluationSubmitting = true;
    try {
      evaluationResult = await enterpriseApiPost<EnterprisePolicyEvaluationResult>('/policy-evaluations', {
        action: evaluationAction,
        resource: 'ai.gateway.request',
        model: evaluationModel || undefined,
        external_workspace_id: evaluationWorkspace || undefined,
        external_feature_type: evaluationFeature || undefined,
      });
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      evaluationSubmitting = false;
    }
  }

  onMount(() => {
    void loadIdentity();
  });
</script>

<section class="enterprise-page">
  <header>
    <div>
    <h1>身份与策略</h1>
      <p>{identity.data?.claims.tenant_id ?? 'SupAuth claims'}</p>
    </div>
    <button class="enterprise-button enterprise-button-secondary" type="button" onclick={() => void loadIdentity()} disabled={identity.loading}>
      <RefreshCw size={14} />
      <span>刷新</span>
    </button>
  </header>

  {#if identity.error || actionError}
    <div class="enterprise-error">{identity.error ?? actionError}</div>
  {:else if identity.loading}
    <div class="enterprise-empty">加载身份与策略...</div>
  {:else if identity.data}
    <div class="enterprise-grid">
      <article class="enterprise-card">
        <h3>Tenant</h3>
        <p class="enterprise-code">{identity.data.claims.tenant_id}</p>
      </article>
      <article class="enterprise-card">
        <h3>Org</h3>
        <p class="enterprise-code">{identity.data.claims.org_id}</p>
      </article>
      <article class="enterprise-card">
        <h3>Actor</h3>
        <p class="enterprise-code">{identity.data.claims.user_id ?? identity.data.claims.service_account_id ?? '-'}</p>
      </article>
      <article class="enterprise-card">
        <h3>Entitlements</h3>
        <div class="enterprise-stat">{identity.data.claims.entitlements_version}</div>
      </article>
    </div>

    <article class="enterprise-card">
      <h3>Scopes</h3>
      <ul class="enterprise-list" aria-label="ai gateway scopes">
        {#each scopes as scope (scope)}
          <li class="enterprise-chip">{scope}</li>
        {/each}
      </ul>
    </article>

    <form class="enterprise-form" onsubmit={(event) => { event.preventDefault(); void createPolicy(); }}>
      <label>
        <span>策略名</span>
        <input bind:value={policyName} placeholder="Default Enterprise Policy" />
      </label>
      <label>
        <span>Target</span>
        <select bind:value={policyTargetKind}>
          <option value="org">org</option>
          <option value="tenant">tenant</option>
          <option value="app_instance">app_instance</option>
          <option value="project">project</option>
          <option value="user">user</option>
          <option value="service_account">service_account</option>
          <option value="api_key">api_key</option>
          <option value="model">model</option>
          <option value="channel">channel</option>
          <option value="external_user">external_user</option>
          <option value="external_workspace">external_workspace</option>
          <option value="feature">feature</option>
        </select>
      </label>
      <label>
        <span>Target ID</span>
        <input bind:value={policyTargetId} placeholder="*" />
      </label>
      <label>
        <span>Effect</span>
        <select bind:value={policyEffect}>
          <option value="allow">allow</option>
          <option value="deny">deny</option>
        </select>
      </label>
      <label class="enterprise-form-wide">
        <span>Rules JSON</span>
        <textarea bind:value={policyRulesText} rows="3"></textarea>
      </label>
      <button class="enterprise-button" type="submit" disabled={policySubmitting}>
        <Plus size={14} />
        <span>创建策略</span>
      </button>
    </form>

    <div class="enterprise-section-heading">
      <h2>策略评估</h2>
      <span>deny-overrides</span>
    </div>

    <form class="enterprise-form" onsubmit={(event) => { event.preventDefault(); void runPolicyEvaluation(); }}>
      <label>
        <span>Action</span>
        <input bind:value={evaluationAction} placeholder="request" />
      </label>
      <label>
        <span>Model</span>
        <input bind:value={evaluationModel} placeholder="gpt-4.1" />
      </label>
      <label>
        <span>Workspace</span>
        <input bind:value={evaluationWorkspace} placeholder="workspace id" />
      </label>
      <label>
        <span>Feature</span>
        <input bind:value={evaluationFeature} placeholder="chat" />
      </label>
      <button class="enterprise-button" type="submit" disabled={evaluationSubmitting}>
        <RefreshCw size={14} />
        <span>评估</span>
      </button>
    </form>

    {#if evaluationResult}
      <article class="enterprise-card">
        <h3>Decision</h3>
        <p>
          <span class="enterprise-status">{evaluationResult.decision}</span>
          <span class="enterprise-code">{evaluationResult.reason}</span>
        </p>
      </article>

      <div class="enterprise-table-wrap">
        <table class="enterprise-table">
          <thead>
            <tr>
              <th>策略</th>
              <th>Effect</th>
              <th>Target</th>
              <th>Matched Rules</th>
            </tr>
          </thead>
          <tbody>
            {#each evaluationResult.matched_policies as policy (policy.id)}
              <tr>
                <td>{policy.name}</td>
                <td>{policy.effect}</td>
                <td>{policy.target_kind}:{policy.target_id ?? '*'}</td>
                <td class="enterprise-code">{policy.matched_rules.join(', ')}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="4" class="enterprise-muted">无命中策略，默认允许</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <div class="enterprise-table-wrap">
      <table class="enterprise-table">
        <thead>
          <tr>
            <th>策略</th>
            <th>Target</th>
            <th>Effect</th>
            <th>状态</th>
            <th>Rules</th>
          </tr>
        </thead>
        <tbody>
          {#each identity.data.policies as policy (policy.id)}
            <tr>
              <td>{policy.name}</td>
              <td>{policy.target_kind}:{policy.target_id ?? '*'}</td>
              <td>{policy.effect}</td>
              <td><span class="enterprise-status">{policy.status}</span></td>
              <td class="enterprise-code">{JSON.stringify(policy.rules)}</td>
            </tr>
          {:else}
            <tr>
              <td colspan="5" class="enterprise-muted">暂无企业策略</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
