<script lang="ts">
  import { onMount } from 'svelte';
  import { PauseCircle, PlayCircle, Plus, RefreshCw, ShieldCheck } from '@lucide/svelte';
  import { createEnterpriseApiState, enterpriseApiGet, enterpriseApiPost, enterpriseApiPut } from '../enterpriseApi';

  type Budget = {
    id: number;
    subject_kind: string;
    subject_id?: string | null;
    period: string;
    limit_quota: number;
    used_quota: number;
    usage_percent: number;
    alert_threshold_pct: number;
    status: string;
    reset_at?: string;
  };

  type GatewayResourceScope = {
    scope_kind: 'gateway_instance';
    tenant_id: string;
    org_id: string;
    app_instance_id: string;
    project_id?: string | null;
  };

  type UsageTotals = {
    requests: number;
    quota_cost: number;
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens?: number;
    error_count?: number;
    avg_elapsed_ms?: number;
    last_seen_at?: string;
  };

  type UsageAttributionRow = {
    dimension: string;
    subject_id: string;
    subject_label: string;
    subject_secondary?: string | null;
    credential_mask?: string | null;
    requests: number;
    quota_cost: number;
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens: number;
    error_count: number;
    avg_elapsed_ms: number;
    last_seen_at?: string;
  };

  type UsageAttributionDimensions = {
    models: UsageAttributionRow[];
    users: UsageAttributionRow[];
    api_keys: UsageAttributionRow[];
    channels: UsageAttributionRow[];
    external_users: UsageAttributionRow[];
    external_workspaces: UsageAttributionRow[];
    external_features: UsageAttributionRow[];
  };

  type UsageAttribution = {
    scope: GatewayResourceScope;
    scope_boundary: string;
    window: {
      days: number;
      since: string;
      until: string;
    };
    totals: UsageTotals;
    dimensions: UsageAttributionDimensions;
  };

  type UsageAndBudgetResponse = {
    budgets: Budget[];
    total: number;
    usage_7d: UsageTotals;
    attribution?: UsageAttribution;
  };

  type BudgetDecision = 'allow' | 'warn' | 'deny';

  type BudgetEvaluationMatch = {
    id: number;
    subject_kind: string;
    subject_id?: string | null;
    period: string;
    status: string;
    limit_quota: number;
    used_quota: number;
    requested_quota: number;
    projected_quota: number;
    projected_usage_percent: number;
    alert_threshold_pct: number;
    decision: BudgetDecision;
    reset_at?: string | null;
  };

  type BudgetEvaluationResult = {
    decision: BudgetDecision;
    reason: string;
    matched_budgets: BudgetEvaluationMatch[];
    warning_budget_ids: number[];
    blocking_budget_ids: number[];
    evaluated_budget_count: number;
  };

  type AttributionView = 'models' | 'users' | 'api_keys' | 'channels' | 'external_workspaces' | 'external_features';

  let usage = $state(createEnterpriseApiState<UsageAndBudgetResponse>());
  let actionError = $state<string | null>(null);
  let budgetSubmitting = $state(false);
  let actionBusy = $state<string | null>(null);
  let budgetEvaluation = $state<BudgetEvaluationResult | null>(null);
  let budgetEvaluationSubmitting = $state(false);
  let attributionView = $state<AttributionView>('models');
  let subjectKind = $state('org');
  let subjectId = $state('');
  let period = $state('monthly');
  let limitQuota = $state(100000);
  let alertThresholdPct = $state(80);
  let evalSubjectKind = $state('org');
  let evalSubjectId = $state('');
  let evalRequestedQuota = $state(100);
  let evalModel = $state('');
  let evalExternalWorkspaceId = $state('');

  const attributionTabs: Array<{ key: AttributionView; label: string }> = [
    { key: 'models', label: '模型' },
    { key: 'users', label: '用户' },
    { key: 'api_keys', label: 'API Key' },
    { key: 'channels', label: '渠道' },
    { key: 'external_workspaces', label: 'Workspace' },
    { key: 'external_features', label: 'Feature' },
  ];

  const attributionRows = $derived(usage.data?.attribution?.dimensions[attributionView] ?? []);
  const attributionScope = $derived(usage.data?.attribution?.scope ?? null);

  function formatNumber(value: number | undefined): string {
    return new Intl.NumberFormat('zh-CN').format(value ?? 0);
  }

  function formatDate(value: string | undefined): string {
    return value ? new Date(value).toLocaleString('zh-CN') : '-';
  }

  async function loadUsage() {
    usage.loading = true;
    usage.error = null;
    try {
      usage.data = await enterpriseApiGet<UsageAndBudgetResponse>('/usage-and-budget');
    } catch (error) {
      usage.error = error instanceof Error ? error.message : String(error);
    } finally {
      usage.loading = false;
    }
  }

  async function createBudget() {
    actionError = null;
    budgetSubmitting = true;
    try {
      await enterpriseApiPost<Budget>('/budgets', {
        subject_kind: subjectKind,
        subject_id: subjectId || null,
        period,
        limit_quota: limitQuota,
        alert_threshold_pct: alertThresholdPct,
      });
      subjectId = '';
      await loadUsage();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      budgetSubmitting = false;
    }
  }

  async function updateBudgetStatus(budget: Budget, status: string) {
    actionError = null;
    actionBusy = `${budget.id}:${status}`;
    try {
      await enterpriseApiPut<Budget>(`/budgets/${encodeURIComponent(String(budget.id))}`, { status });
      await loadUsage();
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      actionBusy = null;
    }
  }

  async function evaluateBudget() {
    actionError = null;
    budgetEvaluationSubmitting = true;
    try {
      budgetEvaluation = await enterpriseApiPost<BudgetEvaluationResult>('/budget-evaluations', {
        subject_kind: evalSubjectKind,
        subject_id: evalSubjectId || null,
        requested_quota: evalRequestedQuota,
        model: evalModel || null,
        external_workspace_id: evalExternalWorkspaceId || null,
      });
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      budgetEvaluationSubmitting = false;
    }
  }

  onMount(() => {
    void loadUsage();
  });
</script>

<section class="enterprise-page">
  <header>
    <div>
      <h1>用量与预算</h1>
      <p>{attributionScope ? `${attributionScope.tenant_id} / ${attributionScope.org_id} / ${attributionScope.app_instance_id}` : 'Identity-aware budget'}</p>
    </div>
    <button class="enterprise-button enterprise-button-secondary" type="button" onclick={() => void loadUsage()} disabled={usage.loading}>
      <RefreshCw size={14} />
      <span>刷新</span>
    </button>
  </header>

  {#if usage.error || actionError}
    <div class="enterprise-error">{usage.error ?? actionError}</div>
  {:else if usage.loading}
    <div class="enterprise-empty">加载用量与预算...</div>
  {:else if usage.data}
    <div class="enterprise-grid">
      <article class="enterprise-card">
        <h3>7日请求</h3>
        <div class="enterprise-stat">{formatNumber(usage.data.usage_7d.requests)}</div>
      </article>
      <article class="enterprise-card">
        <h3>额度消耗</h3>
        <div class="enterprise-stat">{formatNumber(usage.data.usage_7d.quota_cost)}</div>
      </article>
      <article class="enterprise-card">
        <h3>Prompt Tokens</h3>
        <div class="enterprise-stat">{formatNumber(usage.data.usage_7d.prompt_tokens)}</div>
      </article>
      <article class="enterprise-card">
        <h3>Completion Tokens</h3>
        <div class="enterprise-stat">{formatNumber(usage.data.usage_7d.completion_tokens)}</div>
      </article>
      <article class="enterprise-card">
        <h3>Cached Tokens</h3>
        <div class="enterprise-stat">{formatNumber(usage.data.usage_7d.cached_tokens)}</div>
      </article>
      <article class="enterprise-card">
        <h3>错误请求</h3>
        <div class="enterprise-stat">{formatNumber(usage.data.usage_7d.error_count)}</div>
      </article>
    </div>

    {#if usage.data.attribution}
      <div class="enterprise-section-heading">
        <h2>用量归因</h2>
        <span>{usage.data.attribution.window.days}日 · {usage.data.attribution.scope_boundary}</span>
      </div>

      <div class="enterprise-segmented" role="tablist" aria-label="usage attribution">
        {#each attributionTabs as tab (tab.key)}
          <button
            class:enterprise-segmented-active={attributionView === tab.key}
            type="button"
            role="tab"
            aria-selected={attributionView === tab.key}
            onclick={() => { attributionView = tab.key; }}
          >
            <span>{tab.label}</span>
            <strong>{usage.data.attribution.dimensions[tab.key].length}</strong>
          </button>
        {/each}
      </div>

      <div class="enterprise-table-wrap">
        <table class="enterprise-table">
          <thead>
            <tr>
              <th>归因对象</th>
              <th>ID</th>
              <th>请求</th>
              <th>额度</th>
              <th>Tokens</th>
              <th>缓存</th>
              <th>错误</th>
              <th>平均耗时</th>
              <th>最近访问</th>
            </tr>
          </thead>
          <tbody>
            {#each attributionRows as row (`${row.dimension}:${row.subject_id}`)}
              <tr>
                <td>
                  <strong>{row.subject_label}</strong>
                  {#if row.credential_mask}
                    <div class="enterprise-code">{row.credential_mask}</div>
                  {/if}
                </td>
                <td class="enterprise-code">{row.subject_id}</td>
                <td>{formatNumber(row.requests)}</td>
                <td>{formatNumber(row.quota_cost)}</td>
                <td>{formatNumber(row.prompt_tokens + row.completion_tokens)}</td>
                <td>{formatNumber(row.cached_tokens)}</td>
                <td>{formatNumber(row.error_count)}</td>
                <td>{formatNumber(row.avg_elapsed_ms)}ms</td>
                <td>{formatDate(row.last_seen_at)}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="9" class="enterprise-muted">暂无归因数据</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <div class="enterprise-section-heading">
      <h2>预算策略</h2>
      <span>{usage.data.total} 条</span>
    </div>

    <form class="enterprise-form" onsubmit={(event) => { event.preventDefault(); void createBudget(); }}>
      <label>
        <span>Subject</span>
        <select bind:value={subjectKind}>
          <option value="org">org</option>
          <option value="project">project</option>
          <option value="user">user</option>
          <option value="service_account">service_account</option>
          <option value="api_key">api_key</option>
          <option value="external_workspace">external_workspace</option>
          <option value="feature">feature</option>
        </select>
      </label>
      <label>
        <span>Subject ID</span>
        <input bind:value={subjectId} placeholder="*" />
      </label>
      <label>
        <span>周期</span>
        <select bind:value={period}>
          <option value="daily">daily</option>
          <option value="monthly">monthly</option>
          <option value="quarterly">quarterly</option>
        </select>
      </label>
      <label>
        <span>预算额度</span>
        <input type="number" min="0" bind:value={limitQuota} />
      </label>
      <label>
        <span>告警阈值</span>
        <input type="number" min="1" max="100" bind:value={alertThresholdPct} />
      </label>
      <button class="enterprise-button" type="submit" disabled={budgetSubmitting}>
        <Plus size={14} />
        <span>创建预算</span>
      </button>
    </form>

    <div class="enterprise-section-heading">
      <h2>预算评估</h2>
      <span>{budgetEvaluation?.decision ?? 'ready'}</span>
    </div>

    <form class="enterprise-form" onsubmit={(event) => { event.preventDefault(); void evaluateBudget(); }}>
      <label>
        <span>Subject</span>
        <select bind:value={evalSubjectKind}>
          <option value="org">org</option>
          <option value="project">project</option>
          <option value="user">user</option>
          <option value="service_account">service_account</option>
          <option value="api_key">api_key</option>
          <option value="external_workspace">external_workspace</option>
          <option value="feature">feature</option>
        </select>
      </label>
      <label>
        <span>Subject ID</span>
        <input bind:value={evalSubjectId} placeholder="*" />
      </label>
      <label>
        <span>请求额度</span>
        <input type="number" min="0" bind:value={evalRequestedQuota} />
      </label>
      <label>
        <span>模型</span>
        <input bind:value={evalModel} placeholder="gpt-4.1" />
      </label>
      <label>
        <span>Workspace</span>
        <input bind:value={evalExternalWorkspaceId} placeholder="workspace_demo" />
      </label>
      <button class="enterprise-button" type="submit" disabled={budgetEvaluationSubmitting}>
        <ShieldCheck size={14} />
        <span>评估预算</span>
      </button>
    </form>

    {#if budgetEvaluation}
      <div class="enterprise-grid">
        <article class="enterprise-card">
          <h3>决策</h3>
          <div class="enterprise-stat">{budgetEvaluation.decision}</div>
        </article>
        <article class="enterprise-card">
          <h3>命中预算</h3>
          <div class="enterprise-stat">{formatNumber(budgetEvaluation.matched_budgets.length)}</div>
        </article>
        <article class="enterprise-card">
          <h3>告警</h3>
          <div class="enterprise-stat">{formatNumber(budgetEvaluation.warning_budget_ids.length)}</div>
        </article>
        <article class="enterprise-card">
          <h3>阻断</h3>
          <div class="enterprise-stat">{formatNumber(budgetEvaluation.blocking_budget_ids.length)}</div>
        </article>
      </div>
      <div class="enterprise-muted">{budgetEvaluation.reason}</div>
      <div class="enterprise-table-wrap">
        <table class="enterprise-table">
          <thead>
            <tr>
              <th>Budget</th>
              <th>决策</th>
              <th>请求</th>
              <th>预计</th>
              <th>上限</th>
              <th>比例</th>
              <th>周期</th>
              <th>重置</th>
            </tr>
          </thead>
          <tbody>
            {#each budgetEvaluation.matched_budgets as match (match.id)}
              <tr>
                <td>{match.subject_kind}:{match.subject_id ?? '*'}</td>
                <td><span class="enterprise-status">{match.decision}</span></td>
                <td>{formatNumber(match.requested_quota)}</td>
                <td>{formatNumber(match.projected_quota)}</td>
                <td>{formatNumber(match.limit_quota)}</td>
                <td>{match.projected_usage_percent}% / {match.alert_threshold_pct}%</td>
                <td>{match.period}</td>
                <td>{formatDate(match.reset_at ?? undefined)}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="8" class="enterprise-muted">未命中预算</td>
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
            <th>Subject</th>
            <th>周期</th>
            <th>预算</th>
            <th>已用</th>
            <th>比例</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {#each usage.data.budgets as budget (budget.id)}
            <tr>
              <td>{budget.subject_kind}:{budget.subject_id ?? '*'}</td>
              <td>{budget.period}</td>
              <td>{budget.limit_quota}</td>
              <td>{budget.used_quota}</td>
              <td>{budget.usage_percent}% / {budget.alert_threshold_pct}%</td>
              <td><span class="enterprise-status">{budget.status}</span></td>
              <td>
                <div class="enterprise-actions">
                  <button class="enterprise-icon-button" type="button" title="启用" aria-label="启用" disabled={actionBusy !== null} onclick={() => void updateBudgetStatus(budget, 'active')}>
                    <PlayCircle size={14} />
                  </button>
                  <button class="enterprise-icon-button" type="button" title="暂停" aria-label="暂停" disabled={actionBusy !== null} onclick={() => void updateBudgetStatus(budget, 'suspended')}>
                    <PauseCircle size={14} />
                  </button>
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="7" class="enterprise-muted">暂无预算</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
