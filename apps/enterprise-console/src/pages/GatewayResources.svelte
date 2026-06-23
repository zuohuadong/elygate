<script lang="ts">
  import { onMount } from 'svelte';
  import { Activity, Brain, KeyRound, Network, RefreshCw, Route } from '@lucide/svelte';
  import { createEnterpriseApiState, enterpriseApiGet } from '../enterpriseApi';
  import type { EnterpriseApiState } from '../enterpriseApi';

  type GatewayResourceScope = {
    scope_kind: 'gateway_instance';
    tenant_id: string;
    org_id: string;
    app_instance_id: string;
    project_id?: string | null;
  };

  type GatewayResourcePage<T> = {
    data: T[];
    total: number;
    page: number;
    limit: number;
    scope: GatewayResourceScope;
  };

  type ProviderChannel = {
    id: number;
    type: number;
    name: string;
    base_url?: string;
    credential_mask: string;
    models?: string[];
    groups?: string[];
    status: number;
    endpoint_type?: string;
    price_ratio?: number;
    balance?: number | null;
    response_time?: number | null;
    updated_at?: string;
  };

  type ModelRoute = {
    id: string;
    model_name: string;
    channel_id: number;
    channel_name: string;
    provider_type: number;
    endpoint_type?: string;
    status: number;
    priority: number;
    weight: number;
    price_ratio?: number;
    groups?: string[];
    mapped_model?: string | null;
    updated_at?: string;
  };

  type GatewayApiKey = {
    id: number;
    user_id: number;
    username?: string | null;
    org_id?: number | null;
    name: string;
    key_mask: string;
    status: number;
    remain_quota: number;
    used_quota: number;
    unlimited_quota: boolean;
    models?: string[];
    rate_limit: number;
    token_group?: string | null;
    accessed_at?: string;
    expired_at?: string;
  };

  type RequestLog = {
    id: number;
    user_id: number;
    token_id?: number | null;
    channel_id?: number | null;
    model_name: string;
    quota_cost: number;
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens: number;
    elapsed_ms: number;
    is_stream?: boolean | null;
    status_code: number;
    error_message?: string | null;
    trace_id?: string | null;
    external_workspace_id?: string | null;
    created_at?: string;
  };

  type AgentMemory = {
    id: string;
    user_id: number;
    token_id?: number | null;
    org_id?: number | null;
    thread_id?: string | null;
    scope: string;
    kind: string;
    content_preview: string;
    content_length: number;
    confidence: number;
    source_trace_id?: string | null;
    expires_at?: string;
    last_read_at?: string;
    updated_at?: string;
  };

  type ResourceView = 'channels' | 'routes' | 'keys' | 'logs' | 'memories';

  type ResourceTab = {
    key: ResourceView;
    label: string;
    count: () => number;
  };

  let channels = $state(createEnterpriseApiState<GatewayResourcePage<ProviderChannel>>());
  let routes = $state(createEnterpriseApiState<GatewayResourcePage<ModelRoute>>());
  let keys = $state(createEnterpriseApiState<GatewayResourcePage<GatewayApiKey>>());
  let logs = $state(createEnterpriseApiState<GatewayResourcePage<RequestLog>>());
  let memories = $state(createEnterpriseApiState<GatewayResourcePage<AgentMemory>>());
  let activeView = $state<ResourceView>('channels');
  let refreshing = $state(false);

  const tabs: ResourceTab[] = [
    { key: 'channels', label: '渠道', count: () => channels.data?.total ?? 0 },
    { key: 'routes', label: '路由', count: () => routes.data?.total ?? 0 },
    { key: 'keys', label: 'API Key', count: () => keys.data?.total ?? 0 },
    { key: 'logs', label: '请求日志', count: () => logs.data?.total ?? 0 },
    { key: 'memories', label: 'Memory', count: () => memories.data?.total ?? 0 },
  ];

  const scope = $derived(
    channels.data?.scope
      ?? routes.data?.scope
      ?? keys.data?.scope
      ?? logs.data?.scope
      ?? memories.data?.scope
      ?? null,
  );

  const hasAnyError = $derived(Boolean(channels.error || routes.error || keys.error || logs.error || memories.error));

  function formatList(value: string[] | undefined): string {
    return value?.length ? value.join(', ') : '-';
  }

  function formatDate(value: string | undefined): string {
    return value ? new Date(value).toLocaleString('zh-CN') : '-';
  }

  function activeIcon(view: ResourceView) {
    if (view === 'channels') return Network;
    if (view === 'routes') return Route;
    if (view === 'keys') return KeyRound;
    if (view === 'logs') return Activity;
    return Brain;
  }

  async function loadEndpoint<T>(state: EnterpriseApiState<T>, path: string) {
    state.loading = true;
    state.error = null;
    try {
      state.data = await enterpriseApiGet<T>(path);
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.loading = false;
    }
  }

  async function loadResources() {
    refreshing = true;
    await Promise.all([
      loadEndpoint(channels, '/provider-channels'),
      loadEndpoint(routes, '/model-routes'),
      loadEndpoint(keys, '/gateway-api-keys'),
      loadEndpoint(logs, '/request-logs'),
      loadEndpoint(memories, '/agent-memories'),
    ]);
    refreshing = false;
  }

  onMount(() => {
    void loadResources();
  });
</script>

<section class="enterprise-page">
  <header>
    <div>
      <h1>网关资源</h1>
      <p>{scope ? `${scope.tenant_id} / ${scope.org_id} / ${scope.app_instance_id}` : 'gateway instance scope'}</p>
    </div>
    <button class="enterprise-button enterprise-button-secondary" type="button" onclick={() => void loadResources()} disabled={refreshing}>
      <RefreshCw size={14} />
      <span>刷新</span>
    </button>
  </header>

  <div class="enterprise-segmented" role="tablist" aria-label="gateway resources">
    {#each tabs as tab (tab.key)}
      {@const Icon = activeIcon(tab.key)}
      <button
        class:enterprise-segmented-active={activeView === tab.key}
        type="button"
        role="tab"
        aria-selected={activeView === tab.key}
        onclick={() => { activeView = tab.key; }}
      >
        <Icon size={14} />
        <span>{tab.label}</span>
        <strong>{tab.count()}</strong>
      </button>
    {/each}
  </div>

  {#if hasAnyError}
    <div class="enterprise-error">
      {[channels.error, routes.error, keys.error, logs.error, memories.error].filter(Boolean).join(' / ')}
    </div>
  {/if}

  {#if activeView === 'channels'}
    {#if channels.loading}
      <div class="enterprise-empty">加载渠道...</div>
    {:else if channels.data}
      <div class="enterprise-table-wrap">
        <table class="enterprise-table">
          <thead>
            <tr>
              <th>渠道</th>
              <th>类型</th>
              <th>Endpoint</th>
              <th>Models</th>
              <th>Groups</th>
              <th>Key</th>
              <th>状态</th>
              <th>成本</th>
            </tr>
          </thead>
          <tbody>
            {#each channels.data.data as channel (channel.id)}
              <tr>
                <td>{channel.name}</td>
                <td>{channel.type}</td>
                <td class="enterprise-code">{channel.endpoint_type ?? channel.base_url ?? '-'}</td>
                <td class="enterprise-code">{formatList(channel.models)}</td>
                <td>{formatList(channel.groups)}</td>
                <td class="enterprise-code">{channel.credential_mask}</td>
                <td><span class="enterprise-status">{channel.status}</span></td>
                <td>{channel.price_ratio ?? 1}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="8" class="enterprise-muted">暂无渠道</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else if activeView === 'routes'}
    {#if routes.loading}
      <div class="enterprise-empty">加载模型路由...</div>
    {:else if routes.data}
      <div class="enterprise-table-wrap">
        <table class="enterprise-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>渠道</th>
              <th>Mapped</th>
              <th>优先级</th>
              <th>权重</th>
              <th>Groups</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {#each routes.data.data as route (route.id)}
              <tr>
                <td class="enterprise-code">{route.model_name}</td>
                <td>{route.channel_name} #{route.channel_id}</td>
                <td class="enterprise-code">{route.mapped_model ?? '-'}</td>
                <td>{route.priority}</td>
                <td>{route.weight}</td>
                <td>{formatList(route.groups)}</td>
                <td><span class="enterprise-status">{route.status}</span></td>
              </tr>
            {:else}
              <tr>
                <td colspan="7" class="enterprise-muted">暂无模型路由</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else if activeView === 'keys'}
    {#if keys.loading}
      <div class="enterprise-empty">加载 API Key...</div>
    {:else if keys.data}
      <div class="enterprise-table-wrap">
        <table class="enterprise-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>User</th>
              <th>Key</th>
              <th>额度</th>
              <th>模型</th>
              <th>限流</th>
              <th>状态</th>
              <th>访问时间</th>
            </tr>
          </thead>
          <tbody>
            {#each keys.data.data as key (key.id)}
              <tr>
                <td>{key.name}</td>
                <td>{key.username ?? key.user_id}</td>
                <td class="enterprise-code">{key.key_mask}</td>
                <td>{key.unlimited_quota ? 'unlimited' : `${key.used_quota} / ${key.remain_quota}`}</td>
                <td class="enterprise-code">{formatList(key.models)}</td>
                <td>{key.rate_limit}</td>
                <td><span class="enterprise-status">{key.status}</span></td>
                <td>{formatDate(key.accessed_at)}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="8" class="enterprise-muted">暂无 API Key</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else if activeView === 'logs'}
    {#if logs.loading}
      <div class="enterprise-empty">加载请求日志...</div>
    {:else if logs.data}
      <div class="enterprise-table-wrap">
        <table class="enterprise-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>模型</th>
              <th>状态</th>
              <th>Tokens</th>
              <th>成本</th>
              <th>耗时</th>
              <th>Trace</th>
            </tr>
          </thead>
          <tbody>
            {#each logs.data.data as log (log.id)}
              <tr>
                <td>{formatDate(log.created_at)}</td>
                <td class="enterprise-code">{log.model_name}</td>
                <td><span class="enterprise-status">{log.status_code}</span></td>
                <td>{log.prompt_tokens + log.completion_tokens} / cache {log.cached_tokens}</td>
                <td>{log.quota_cost}</td>
                <td>{log.elapsed_ms}ms</td>
                <td class="enterprise-code">{log.trace_id ?? log.error_message ?? '-'}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="7" class="enterprise-muted">暂无请求日志</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else}
    {#if memories.loading}
      <div class="enterprise-empty">加载 Memory...</div>
    {:else if memories.data}
      <div class="enterprise-table-wrap">
        <table class="enterprise-table">
          <thead>
            <tr>
              <th>Memory</th>
              <th>User</th>
              <th>Scope</th>
              <th>Kind</th>
              <th>置信度</th>
              <th>长度</th>
              <th>最近读取</th>
            </tr>
          </thead>
          <tbody>
            {#each memories.data.data as memory (memory.id)}
              <tr>
                <td class="enterprise-code">{memory.content_preview}</td>
                <td>{memory.user_id}</td>
                <td>{memory.scope}</td>
                <td>{memory.kind}</td>
                <td>{memory.confidence}</td>
                <td>{memory.content_length}</td>
                <td>{formatDate(memory.last_read_at)}</td>
              </tr>
            {:else}
              <tr>
                <td colspan="7" class="enterprise-muted">暂无 Memory</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</section>
