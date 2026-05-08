<script lang="ts">
  import { onMount } from 'svelte';
  import { Card, Button, Input, PageHeader } from '@svadmin/ui';

  type Message = { type: 'success' | 'error' | ''; text: string };

  let activeTab = $state<'deployments' | 'oauth' | 'announcements' | 'ops'>('deployments');
  let loading = $state(false);
  let message = $state<Message>({ type: '', text: '' });

  let deploymentSettings = $state({
    enabled: false,
    apiKey: '',
    apiKeyConfigured: false,
    publicBaseUrl: '',
    enterpriseBaseUrl: '',
  });
  let deployments = $state<any[]>([]);
  let deploymentStatus = $state<Record<string, number>>({});

  let oauthProviders = $state<any[]>([]);
  let oauthForm = $state({
    id: '',
    name: '',
    issuer: '',
    discoveryUrl: '',
    clientId: '',
    clientSecret: '',
    enabled: true,
    scopes: 'openid profile email',
  });

  let announcements = $state<any[]>([]);
  let announcementForm = $state({
    id: '',
    title: '',
    tag: '',
    content: '',
  });

  let subscriptions = $state<any[]>([]);
  let bindForm = $state({ userId: '', packageId: '' });
  let logRetentionDays = $state('30');
  let ratioSync = $state<any>(null);

  const tabs = [
    { id: 'deployments', label: '模型部署' },
    { id: 'oauth', label: '登录集成' },
    { id: 'announcements', label: '公告' },
    { id: 'ops', label: '运维补齐' },
  ] as const;

  function authHeaders(extra: Record<string, string> = {}) {
    const token = localStorage.getItem('auth_token');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  async function request(path: string, options: RequestInit = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: authHeaders((options.headers || {}) as Record<string, string>),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      throw new Error(json?.message || json?.error?.message || `HTTP ${res.status}`);
    }
    return json;
  }

  function flash(type: Message['type'], text: string) {
    message = { type, text };
    setTimeout(() => (message = { type: '', text: '' }), 4000);
  }

  function normalizeList(payload: any) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  }

  async function loadDeployments() {
    const settings = await request('/api/deployments/settings');
    deploymentSettings = { ...deploymentSettings, ...settings.data };
    if (settings.data?.enabled) {
      const list = await request('/api/deployments?page_size=50');
      deployments = normalizeList(list);
      deploymentStatus = list.statusCount || {};
    }
  }

  async function saveDeploymentSettings() {
    loading = true;
    try {
      const saved = await request('/api/deployments/settings', {
        method: 'PUT',
        body: JSON.stringify(deploymentSettings),
      });
      deploymentSettings = { ...deploymentSettings, ...saved.data, apiKey: '' };
      flash('success', '模型部署设置已保存');
    } catch (e: any) {
      flash('error', e.message);
    } finally {
      loading = false;
    }
  }

  async function testDeploymentConnection() {
    loading = true;
    try {
      const result = await request('/api/deployments/settings/test-connection', {
        method: 'POST',
        body: JSON.stringify({ apiKey: deploymentSettings.apiKey }),
      });
      flash('success', result.message || '连接成功');
    } catch (e: any) {
      flash('error', e.message);
    } finally {
      loading = false;
    }
  }

  async function deleteDeployment(id: string) {
    if (!confirm(`确认删除部署 ${id} ?`)) return;
    await request(`/api/deployments/${encodeURIComponent(id)}`, { method: 'DELETE' });
    flash('success', '部署删除请求已提交');
    await loadDeployments();
  }

  async function loadOAuthProviders() {
    const payload = await request('/api/custom-oauth-provider');
    oauthProviders = normalizeList(payload);
  }

  async function discoverOAuth() {
    loading = true;
    try {
      const payload = await request('/api/custom-oauth-provider/discovery', {
        method: 'POST',
        body: JSON.stringify(oauthForm),
      });
      const data = payload.data || {};
      oauthForm = {
        ...oauthForm,
        issuer: data.issuer || oauthForm.issuer,
        discoveryUrl: data.discoveryUrl || oauthForm.discoveryUrl,
        scopes: Array.isArray(data.scopes) ? data.scopes.join(' ') : oauthForm.scopes,
      };
      flash('success', 'Discovery 解析成功');
    } catch (e: any) {
      flash('error', e.message);
    } finally {
      loading = false;
    }
  }

  function editOAuth(row: any) {
    oauthForm = {
      id: String(row.id || ''),
      name: row.name || '',
      issuer: row.issuer || '',
      discoveryUrl: row.discoveryUrl || '',
      clientId: row.clientId || '',
      clientSecret: '',
      enabled: row.enabled !== false,
      scopes: Array.isArray(row.scopes) ? row.scopes.join(' ') : '',
    };
  }

  function resetOAuth() {
    oauthForm = { id: '', name: '', issuer: '', discoveryUrl: '', clientId: '', clientSecret: '', enabled: true, scopes: 'openid profile email' };
  }

  async function saveOAuth() {
    loading = true;
    try {
      const payload = {
        ...oauthForm,
        scopes: oauthForm.scopes.split(/\s+/).map((item) => item.trim()).filter(Boolean),
      };
      await request(oauthForm.id ? `/api/custom-oauth-provider/${oauthForm.id}` : '/api/custom-oauth-provider', {
        method: oauthForm.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      flash('success', oauthForm.id ? 'OAuth 提供商已更新' : 'OAuth 提供商已创建');
      resetOAuth();
      await loadOAuthProviders();
    } catch (e: any) {
      flash('error', e.message);
    } finally {
      loading = false;
    }
  }

  async function deleteOAuth(id: number) {
    if (!confirm(`确认删除 OAuth Provider #${id} ?`)) return;
    await request(`/api/custom-oauth-provider/${id}`, { method: 'DELETE' });
    flash('success', 'OAuth 提供商已删除');
    await loadOAuthProviders();
  }

  async function loadAnnouncements() {
    announcements = normalizeList(await request('/api/announcement'));
  }

  function editAnnouncement(row: any) {
    announcementForm = {
      id: String(row.id || ''),
      title: row.title || '',
      tag: row.tag || '',
      content: row.content || '',
    };
  }

  function resetAnnouncement() {
    announcementForm = { id: '', title: '', tag: '', content: '' };
  }

  async function saveAnnouncement() {
    loading = true;
    try {
      await request('/api/announcement', {
        method: announcementForm.id ? 'PUT' : 'POST',
        body: JSON.stringify(announcementForm),
      });
      flash('success', announcementForm.id ? '公告已更新' : '公告已创建');
      resetAnnouncement();
      await loadAnnouncements();
    } catch (e: any) {
      flash('error', e.message);
    } finally {
      loading = false;
    }
  }

  async function deleteAnnouncement(id: number) {
    if (!confirm(`确认删除公告 #${id} ?`)) return;
    await request(`/api/announcement/${id}`, { method: 'DELETE' });
    flash('success', '公告已删除');
    await loadAnnouncements();
  }

  async function loadOps() {
    subscriptions = normalizeList(await request('/api/subscription'));
  }

  async function bindSubscription() {
    loading = true;
    try {
      await request('/api/subscription/bind', {
        method: 'POST',
        body: JSON.stringify({ userId: Number(bindForm.userId), packageId: Number(bindForm.packageId) }),
      });
      flash('success', '订阅已绑定');
      bindForm = { userId: '', packageId: '' };
      await loadOps();
    } catch (e: any) {
      flash('error', e.message);
    } finally {
      loading = false;
    }
  }

  async function cleanLogs() {
    if (!confirm(`确认清理 ${logRetentionDays} 天前的日志 ?`)) return;
    const payload = await request(`/api/log/clean?retention_days=${encodeURIComponent(logRetentionDays)}`, { method: 'DELETE' });
    flash('success', `已清理 ${payload.deleted || 0} 条日志`);
  }

  async function fetchRatioSync() {
    ratioSync = await request('/api/ratio_sync/fetch', { method: 'POST' });
    flash('success', '已读取倍率同步数据');
  }

  async function loadCurrentTab() {
    loading = true;
    try {
      if (activeTab === 'deployments') await loadDeployments();
      if (activeTab === 'oauth') await loadOAuthProviders();
      if (activeTab === 'announcements') await loadAnnouncements();
      if (activeTab === 'ops') await loadOps();
    } catch (e: any) {
      flash('error', e.message);
    } finally {
      loading = false;
    }
  }

  onMount(loadCurrentTab);
</script>

<div class="space-y-6">
  <PageHeader title="新增功能" description="最近补齐的 New API 管理入口">
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={loadCurrentTab} disabled={loading}>刷新</Button>
    {/snippet}
  </PageHeader>

  <div class="flex flex-wrap gap-2">
    {#each tabs as tab}
      <button
        class="rounded-md border px-3 py-2 text-sm {activeTab === tab.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input'}"
        onclick={() => {
          activeTab = tab.id;
          loadCurrentTab();
        }}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#if message.text}
    <div class="rounded-md border px-4 py-3 text-sm {message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}">
      {message.text}
    </div>
  {/if}

  {#if activeTab === 'deployments'}
    <div class="grid gap-6 xl:grid-cols-[420px_1fr]">
      <Card.Root>
        <Card.Header><Card.Title>io.net 部署设置</Card.Title></Card.Header>
        <Card.Content class="space-y-4">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={deploymentSettings.enabled} />
            启用模型部署
          </label>
          <div class="space-y-1.5">
            <label class="text-sm font-medium text-muted-foreground" for="deploy-api-key">API Key</label>
            <Input id="deploy-api-key" type="password" bind:value={deploymentSettings.apiKey} placeholder={deploymentSettings.apiKeyConfigured ? '已配置，留空不修改' : '必填'} />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium text-muted-foreground" for="deploy-enterprise-url">Enterprise Base URL</label>
            <Input id="deploy-enterprise-url" bind:value={deploymentSettings.enterpriseBaseUrl} />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium text-muted-foreground" for="deploy-public-url">Public Base URL</label>
            <Input id="deploy-public-url" bind:value={deploymentSettings.publicBaseUrl} />
          </div>
          <div class="flex gap-2">
            <Button size="sm" onclick={saveDeploymentSettings} disabled={loading}>保存</Button>
            <Button size="sm" variant="outline" onclick={testDeploymentConnection} disabled={loading}>测试连接</Button>
          </div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>部署列表</Card.Title></Card.Header>
        <Card.Content>
          <div class="mb-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {#each Object.entries(deploymentStatus) as [key, value]}
              <span class="rounded border px-2 py-1">{key}: {value}</span>
            {/each}
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-muted-foreground">
                <tr><th class="py-2">名称</th><th>状态</th><th>硬件</th><th>剩余</th><th></th></tr>
              </thead>
              <tbody>
                {#each deployments as item}
                  <tr class="border-t">
                    <td class="py-2 font-medium">{item.deployment_name || item.id}</td>
                    <td>{item.status}</td>
                    <td>{item.hardware_info || '-'}</td>
                    <td>{item.time_remaining || '-'}</td>
                    <td class="text-right"><Button size="sm" variant="outline" onclick={() => deleteDeployment(item.id)}>删除</Button></td>
                  </tr>
                {:else}
                  <tr><td colspan="5" class="py-8 text-center text-muted-foreground">暂无部署或尚未启用</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        </Card.Content>
      </Card.Root>
    </div>
  {:else if activeTab === 'oauth'}
    <div class="grid gap-6 xl:grid-cols-[420px_1fr]">
      <Card.Root>
        <Card.Header><Card.Title>{oauthForm.id ? '编辑 OAuth Provider' : '新增 OAuth Provider'}</Card.Title></Card.Header>
        <Card.Content class="space-y-4">
          <Input placeholder="名称" bind:value={oauthForm.name} />
          <Input placeholder="Issuer" bind:value={oauthForm.issuer} />
          <Input placeholder="Discovery URL" bind:value={oauthForm.discoveryUrl} />
          <Input placeholder="Client ID" bind:value={oauthForm.clientId} />
          <Input type="password" placeholder="Client Secret" bind:value={oauthForm.clientSecret} />
          <Input placeholder="Scopes" bind:value={oauthForm.scopes} />
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={oauthForm.enabled} />
            启用
          </label>
          <div class="flex gap-2">
            <Button size="sm" onclick={saveOAuth} disabled={loading}>保存</Button>
            <Button size="sm" variant="outline" onclick={discoverOAuth} disabled={loading}>Discovery</Button>
            <Button size="sm" variant="outline" onclick={resetOAuth}>清空</Button>
          </div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>OAuth Provider</Card.Title></Card.Header>
        <Card.Content class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-muted-foreground"><tr><th class="py-2">名称</th><th>Issuer</th><th>状态</th><th></th></tr></thead>
            <tbody>
              {#each oauthProviders as row}
                <tr class="border-t">
                  <td class="py-2 font-medium">{row.name}</td>
                  <td class="max-w-[320px] truncate">{row.issuer || row.discoveryUrl || '-'}</td>
                  <td>{row.enabled ? '启用' : '禁用'}</td>
                  <td class="text-right space-x-2">
                    <Button size="sm" variant="outline" onclick={() => editOAuth(row)}>编辑</Button>
                    <Button size="sm" variant="outline" onclick={() => deleteOAuth(row.id)}>删除</Button>
                  </td>
                </tr>
              {:else}
                <tr><td colspan="4" class="py-8 text-center text-muted-foreground">暂无 Provider</td></tr>
              {/each}
            </tbody>
          </table>
        </Card.Content>
      </Card.Root>
    </div>
  {:else if activeTab === 'announcements'}
    <div class="grid gap-6 xl:grid-cols-[420px_1fr]">
      <Card.Root>
        <Card.Header><Card.Title>{announcementForm.id ? '编辑公告' : '新增公告'}</Card.Title></Card.Header>
        <Card.Content class="space-y-4">
          <Input placeholder="标题" bind:value={announcementForm.title} />
          <Input placeholder="标签" bind:value={announcementForm.tag} />
          <textarea class="min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" bind:value={announcementForm.content}></textarea>
          <div class="flex gap-2">
            <Button size="sm" onclick={saveAnnouncement} disabled={loading}>保存</Button>
            <Button size="sm" variant="outline" onclick={resetAnnouncement}>清空</Button>
          </div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>公告列表</Card.Title></Card.Header>
        <Card.Content class="space-y-3">
          {#each announcements as row}
            <div class="rounded-md border p-3">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="font-medium">{row.title}</div>
                  <div class="text-xs text-muted-foreground">{row.tag || '未分组'}</div>
                </div>
                <div class="flex gap-2">
                  <Button size="sm" variant="outline" onclick={() => editAnnouncement(row)}>编辑</Button>
                  <Button size="sm" variant="outline" onclick={() => deleteAnnouncement(row.id)}>删除</Button>
                </div>
              </div>
              <p class="mt-2 line-clamp-2 text-sm text-muted-foreground">{row.content}</p>
            </div>
          {:else}
            <div class="py-8 text-center text-sm text-muted-foreground">暂无公告</div>
          {/each}
        </Card.Content>
      </Card.Root>
    </div>
  {:else}
    <div class="grid gap-6 xl:grid-cols-[420px_1fr]">
      <Card.Root>
        <Card.Header><Card.Title>运维动作</Card.Title></Card.Header>
        <Card.Content class="space-y-4">
          <div class="grid grid-cols-2 gap-2">
            <Input placeholder="用户 ID" bind:value={bindForm.userId} />
            <Input placeholder="套餐 ID" bind:value={bindForm.packageId} />
          </div>
          <Button size="sm" onclick={bindSubscription} disabled={loading}>绑定订阅</Button>
          <div class="flex gap-2">
            <Input placeholder="保留天数" bind:value={logRetentionDays} />
            <Button size="sm" variant="outline" onclick={cleanLogs}>清理日志</Button>
          </div>
          <Button size="sm" variant="outline" onclick={fetchRatioSync}>读取倍率同步数据</Button>
          {#if ratioSync}
            <pre class="max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">{JSON.stringify(ratioSync, null, 2)}</pre>
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>订阅列表</Card.Title></Card.Header>
        <Card.Content class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-muted-foreground">
              <tr><th class="py-2">用户</th><th>套餐</th><th>状态</th><th>到期</th><th>额度</th></tr>
            </thead>
            <tbody>
              {#each subscriptions as row}
                <tr class="border-t">
                  <td class="py-2">{row.username || row.userId}</td>
                  <td>{row.packageName || row.packageId}</td>
                  <td>{row.status}</td>
                  <td>{row.endTime ? new Date(row.endTime).toLocaleString() : '-'}</td>
                  <td>{row.quotaGranted || 0}</td>
                </tr>
              {:else}
                <tr><td colspan="5" class="py-8 text-center text-muted-foreground">暂无订阅</td></tr>
              {/each}
            </tbody>
          </table>
        </Card.Content>
      </Card.Root>
    </div>
  {/if}
</div>
