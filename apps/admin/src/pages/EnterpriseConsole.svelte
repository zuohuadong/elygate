<script lang="ts">
  import { onMount } from 'svelte';
  import { Badge, Button, Card, Input, PageHeader, Textarea } from '@svadmin/ui';

  type TabId = 'overview' | 'tokens' | 'organizations' | 'teams' | 'projects' | 'budgets' | 'audit' | 'recycle' | 'trends';
  type Message = { type: 'success' | 'error' | ''; text: string };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: '企业总览' },
    { id: 'tokens', label: 'Token 生命周期' },
    { id: 'organizations', label: '组织与团队' },
    { id: 'teams', label: '团队管理' },
    { id: 'projects', label: '项目管理' },
    { id: 'budgets', label: '预算告警' },
    { id: 'audit', label: '审计日志' },
    { id: 'recycle', label: '回收站' },
    { id: 'trends', label: '趋势分析' },
  ];

  let activeTab = $state<TabId>('overview');
  let loading = $state(false);
  let message = $state<Message>({ type: '', text: '' });

  // ─── Data Stores ───────────────────────────────────────────
  let overview = $state<any>({ stats: {}, topTokens: [], topOrganizations: [], modelDistribution: [], recentAudit: [], recentAlerts: [] });

  // Token list with pagination/search
  let tokenSearch = $state('');
  let tokenFilterOrg = $state('');
  let tokenFilterStatus = $state('');
  let tokenPage = $state(1);
  let tokenTotal = $state(0);
  let tokenLimit = $state(30);
  let enterpriseTokens = $state<any[]>([]);

  // Organizations
  let organizations = $state<any[]>([]);

  // Teams
  let teamSearch = $state('');
  let teamFilterOrg = $state('');
  let teamPage = $state(1);
  let teamTotal = $state(0);
  let teams = $state<any[]>([]);
  let teamMembers = $state<any[]>([]);
  let selectedTeamId = $state<number | null>(null);

  // Projects
  let projectSearch = $state('');
  let projectFilterOrg = $state('');
  let projectFilterTeam = $state('');
  let projectPage = $state(1);
  let projectTotal = $state(0);
  let projects = $state<any[]>([]);

  // Budget / alerts / audit / recycle / trends
  let alerts = $state<any[]>([]);
  let auditSearchAction = $state('');
  let auditSearchResource = $state('');
  let auditPage = $state(1);
  let auditTotal = $state(0);
  let auditLogs = $state<any[]>([]);
  let recyclePage = $state(1);
  let recycleTotal = $state(0);
  let recycleType = $state('');
  let recycleRecords = $state<any[]>([]);

  // Trends
  let trendDays = $state(7);
  let trendOrgId = $state('');
  let trendData = $state<any>({ daily: [], models: [], topUsers: [] });

  // Forms
  let revealKey = $state('');
  let tokenForm = $state({ id: '', name: '', userId: '', orgId: '', remainQuota: '-1', models: '', allowIps: '', subnet: '', rateLimit: '0', expiredAt: '', status: '1', unlimitedQuota: false, modelLimitsEnabled: false, tokenGroup: '', crossGroupRetry: false });
  let orgForm = $state({ id: '', slug: '', name: '', billingEmail: '', quota: '0', allowedModels: '', deniedModels: '', allowedSubnets: '', quotaAlarmThreshold: '80', alertThresholdPct: '80', alertWebhookUrl: '', status: '1', metadata: '{}' });
  let teamForm = $state({ id: '', orgId: '', name: '', slug: '', description: '', leaderId: '', budget: '0', allowedModels: '', deniedModels: '', status: '1' });
  let projectForm = $state({ id: '', orgId: '', teamId: '', name: '', slug: '', description: '', budget: '0', allowedModels: '', deniedModels: '', status: '1' });
  let addMemberUserId = $state('');
  let addMemberRole = $state('member');

  // ─── Helpers ───────────────────────────────────────────────

  function authHeaders(extra: Record<string, string> = {}) {
    const token = localStorage.getItem('auth_token');
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
  }

  async function request(path: string, options: RequestInit = {}) {
    const res = await fetch(path, { credentials: 'include', ...options, headers: authHeaders((options.headers || {}) as Record<string, string>) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) throw new Error(json?.message || json?.error?.message || `HTTP ${res.status}`);
    return json;
  }

  function flash(type: Message['type'], text: string) { message = { type, text }; setTimeout(() => (message = { type: '', text: '' }), 4200); }
  function normalizeData(payload: any) { if (Array.isArray(payload)) return payload; if (Array.isArray(payload?.data)) return payload.data; return []; }
  function formatQuota(value: unknown) { return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(value || 0)); }
  function formatDate(value: unknown) { if (!value) return '-'; const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('zh-CN'); }
  function splitList(value: string) { return value.split(/[\n,]/).map(i => i.trim()).filter(Boolean); }
  function totalPages(total: number, limit: number) { return Math.max(1, Math.ceil(total / limit)); }

  function resetTokenForm() { tokenForm = { id: '', name: '', userId: '', orgId: '', remainQuota: '-1', models: '', allowIps: '', subnet: '', rateLimit: '0', expiredAt: '', status: '1', unlimitedQuota: false, modelLimitsEnabled: false, tokenGroup: '', crossGroupRetry: false }; }
  function resetOrgForm() { orgForm = { id: '', slug: '', name: '', billingEmail: '', quota: '0', allowedModels: '', deniedModels: '', allowedSubnets: '', quotaAlarmThreshold: '80', alertThresholdPct: '80', alertWebhookUrl: '', status: '1', metadata: '{}' }; }
  function resetTeamForm() { teamForm = { id: '', orgId: '', name: '', slug: '', description: '', leaderId: '', budget: '0', allowedModels: '', deniedModels: '', status: '1' }; }
  function resetProjectForm() { projectForm = { id: '', orgId: '', teamId: '', name: '', slug: '', description: '', budget: '0', allowedModels: '', deniedModels: '', status: '1' }; }

  // ─── Loaders ───────────────────────────────────────────────

  async function loadOverview() {
    const json = await request('/api/admin/enterprise/overview');
    overview = json.data || overview;
  }

  async function loadTokens() {
    const params = new URLSearchParams({ page: String(tokenPage), limit: String(tokenLimit) });
    if (tokenSearch) params.set('keyword', tokenSearch);
    if (tokenFilterOrg) params.set('org_id', tokenFilterOrg);
    if (tokenFilterStatus) params.set('status', tokenFilterStatus);
    const json = await request(`/api/admin/enterprise/tokens?${params}`);
    enterpriseTokens = normalizeData(json);
    tokenTotal = json.total || 0;
  }

  async function loadOrganizations() {
    const json = await request('/api/admin/enterprise/organizations');
    organizations = normalizeData(json);
  }

  async function loadTeams() {
    const params = new URLSearchParams({ page: String(teamPage), limit: '30' });
    if (teamSearch) params.set('keyword', teamSearch);
    if (teamFilterOrg) params.set('org_id', teamFilterOrg);
    const json = await request(`/api/admin/enterprise/teams?${params}`);
    teams = normalizeData(json);
    teamTotal = json.total || 0;
  }

  async function loadTeamMembers(teamId: number) {
    selectedTeamId = teamId;
    const json = await request(`/api/admin/enterprise/teams/${teamId}/members`);
    teamMembers = normalizeData(json);
  }

  async function loadProjects() {
    const params = new URLSearchParams({ page: String(projectPage), limit: '30' });
    if (projectSearch) params.set('keyword', projectSearch);
    if (projectFilterOrg) params.set('org_id', projectFilterOrg);
    if (projectFilterTeam) params.set('team_id', projectFilterTeam);
    const json = await request(`/api/admin/enterprise/projects?${params}`);
    projects = normalizeData(json);
    projectTotal = json.total || 0;
  }

  async function loadAlerts() {
    const json = await request('/api/admin/enterprise/budget-alerts');
    alerts = normalizeData(json);
  }

  async function loadAudit() {
    const params = new URLSearchParams({ page: String(auditPage), limit: '30' });
    if (auditSearchAction) params.set('action', auditSearchAction);
    if (auditSearchResource) params.set('resource', auditSearchResource);
    const json = await request(`/api/admin/enterprise/audit-logs?${params}`);
    auditLogs = normalizeData(json);
    auditTotal = json.total || 0;
  }

  async function loadRecycle() {
    const params = new URLSearchParams({ page: String(recyclePage), limit: '30' });
    if (recycleType) params.set('resource_type', recycleType);
    const json = await request(`/api/admin/enterprise/recycle-bin?${params}`);
    recycleRecords = normalizeData(json);
    recycleTotal = json.total || 0;
  }

  async function loadTrends() {
    const params = new URLSearchParams({ days: String(trendDays) });
    if (trendOrgId) params.set('org_id', trendOrgId);
    const json = await request(`/api/admin/enterprise/trends?${params}`);
    trendData = json.data || { daily: [], models: [], topUsers: [] };
  }

  async function loadAll() {
    loading = true;
    try {
      await Promise.all([loadOverview(), loadTokens(), loadOrganizations(), loadTeams(), loadProjects(), loadAlerts(), loadAudit(), loadRecycle(), loadTrends()]);
    } catch (e: any) { flash('error', e.message || '加载失败'); }
    finally { loading = false; }
  }

  // ─── Token CRUD ────────────────────────────────────────────

  async function saveToken() {
    loading = true;
    try {
      const payload = { name: tokenForm.name, userId: Number(tokenForm.userId || 0), orgId: tokenForm.orgId ? Number(tokenForm.orgId) : null, remainQuota: Number(tokenForm.remainQuota || -1), models: splitList(tokenForm.models), allowIps: tokenForm.allowIps, subnet: tokenForm.subnet, rateLimit: Number(tokenForm.rateLimit || 0), expiredAt: tokenForm.expiredAt || null, status: Number(tokenForm.status || 1), unlimitedQuota: tokenForm.unlimitedQuota, modelLimitsEnabled: tokenForm.modelLimitsEnabled, tokenGroup: tokenForm.tokenGroup || null, crossGroupRetry: tokenForm.crossGroupRetry };
      const path = tokenForm.id ? `/api/admin/enterprise/tokens/${tokenForm.id}` : '/api/admin/enterprise/tokens';
      const method = tokenForm.id ? 'PUT' : 'POST';
      const saved = await request(path, { method, body: JSON.stringify(payload) });
      revealKey = saved.data?.key?.startsWith('sk-') ? saved.data.key : revealKey;
      flash('success', tokenForm.id ? 'Token 已更新' : 'Token 已创建');
      resetTokenForm(); await loadTokens(); await loadOverview();
    } catch (e: any) { flash('error', e.message); } finally { loading = false; }
  }

  function editToken(t: any) { tokenForm = { id: String(t.id), name: t.name || '', userId: String(t.userId), orgId: t.orgId ? String(t.orgId) : '', remainQuota: String(t.remainQuota ?? -1), models: Array.isArray(t.models) ? t.models.join('\n') : '', allowIps: t.allowIps || '', subnet: t.subnet || '', rateLimit: String(t.rateLimit || 0), expiredAt: t.expiredAt ? String(t.expiredAt).slice(0, 16) : '', status: String(t.status || 1), unlimitedQuota: Boolean(t.unlimitedQuota), modelLimitsEnabled: Boolean(t.modelLimitsEnabled), tokenGroup: t.tokenGroup || '', crossGroupRetry: Boolean(t.crossGroupRetry) }; activeTab = 'tokens'; }
  async function regenerateToken(id: number) { if (!confirm('重新生成后旧 Token 立即失效')) return; const s = await request(`/api/admin/enterprise/tokens/${id}/regenerate`, { method: 'POST', body: '{}' }); revealKey = s.data?.key || ''; flash('success', 'Token 已重新生成'); await loadTokens(); }
  async function deleteToken(id: number) { if (!confirm('确认删除？记录将进入回收站。')) return; await request(`/api/admin/enterprise/tokens/${id}`, { method: 'DELETE' }); flash('success', 'Token 已删除'); await loadTokens(); }

  // ─── Org CRUD ──────────────────────────────────────────────

  async function saveOrganization() {
    loading = true;
    try {
      const payload = { slug: orgForm.slug, name: orgForm.name, billingEmail: orgForm.billingEmail, quota: Number(orgForm.quota || 0), allowedModels: splitList(orgForm.allowedModels), deniedModels: splitList(orgForm.deniedModels), allowedSubnets: orgForm.allowedSubnets, quotaAlarmThreshold: Number(orgForm.quotaAlarmThreshold || 80), alertThresholdPct: Number(orgForm.alertThresholdPct || 80), alertWebhookUrl: orgForm.alertWebhookUrl, status: Number(orgForm.status || 1), metadata: orgForm.metadata };
      const path = orgForm.id ? `/api/admin/enterprise/organizations/${orgForm.id}` : '/api/admin/enterprise/organizations';
      await request(path, { method: orgForm.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      flash('success', orgForm.id ? '组织已更新' : '组织已创建'); resetOrgForm(); await loadOrganizations();
    } catch (e: any) { flash('error', e.message); } finally { loading = false; }
  }

  function editOrganization(o: any) { orgForm = { id: String(o.id), slug: o.slug || '', name: o.name || '', billingEmail: o.billingEmail || '', quota: String(o.quota || 0), allowedModels: Array.isArray(o.allowedModels) ? o.allowedModels.join('\n') : '', deniedModels: Array.isArray(o.deniedModels) ? o.deniedModels.join('\n') : '', allowedSubnets: o.allowedSubnets || '', quotaAlarmThreshold: String(o.quotaAlarmThreshold || 80), alertThresholdPct: String(o.alertThresholdPct || 80), alertWebhookUrl: o.alertWebhookUrl || '', status: String(o.status || 1), metadata: JSON.stringify(o.metadata || {}, null, 2) }; activeTab = 'organizations'; }
  async function deleteOrganization(id: number) { if (!confirm('确认删除？')) return; await request(`/api/admin/enterprise/organizations/${id}`, { method: 'DELETE' }); flash('success', '组织已删除'); await loadOrganizations(); }

  // ─── Team CRUD ─────────────────────────────────────────────

  async function saveTeam() {
    loading = true;
    try {
      const payload = { orgId: Number(teamForm.orgId), name: teamForm.name, slug: teamForm.slug || null, description: teamForm.description, leaderId: teamForm.leaderId ? Number(teamForm.leaderId) : null, budget: Number(teamForm.budget || 0), allowedModels: splitList(teamForm.allowedModels), deniedModels: splitList(teamForm.deniedModels), status: Number(teamForm.status || 1) };
      const path = teamForm.id ? `/api/admin/enterprise/teams/${teamForm.id}` : '/api/admin/enterprise/teams';
      await request(path, { method: teamForm.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      flash('success', teamForm.id ? '团队已更新' : '团队已创建'); resetTeamForm(); await loadTeams();
    } catch (e: any) { flash('error', e.message); } finally { loading = false; }
  }

  function editTeam(t: any) { teamForm = { id: String(t.id), orgId: String(t.orgId), name: t.name, slug: t.slug || '', description: t.description || '', leaderId: t.leaderId ? String(t.leaderId) : '', budget: String(t.budget || 0), allowedModels: Array.isArray(t.allowedModels) ? t.allowedModels.join('\n') : '', deniedModels: Array.isArray(t.deniedModels) ? t.deniedModels.join('\n') : '', status: String(t.status || 1) }; activeTab = 'teams'; }
  async function deleteTeam(id: number) { if (!confirm('确认删除团队？')) return; await request(`/api/admin/enterprise/teams/${id}`, { method: 'DELETE' }); flash('success', '团队已删除'); await loadTeams(); }

  async function addMember() {
    if (!selectedTeamId || !addMemberUserId) return;
    await request(`/api/admin/enterprise/teams/${selectedTeamId}/members`, { method: 'POST', body: JSON.stringify({ userId: Number(addMemberUserId), role: addMemberRole }) });
    addMemberUserId = ''; addMemberRole = 'member'; flash('success', '成员已添加'); await loadTeamMembers(selectedTeamId);
  }
  async function removeMember(memberId: number) { if (!selectedTeamId || !confirm('确认移除？')) return; await request(`/api/admin/enterprise/teams/${selectedTeamId}/members/${memberId}`, { method: 'DELETE' }); flash('success', '成员已移除'); await loadTeamMembers(selectedTeamId); }

  // ─── Project CRUD ──────────────────────────────────────────

  async function saveProject() {
    loading = true;
    try {
      const payload = { orgId: Number(projectForm.orgId), teamId: projectForm.teamId ? Number(projectForm.teamId) : null, name: projectForm.name, slug: projectForm.slug || null, description: projectForm.description, budget: Number(projectForm.budget || 0), allowedModels: splitList(projectForm.allowedModels), deniedModels: splitList(projectForm.deniedModels), status: Number(projectForm.status || 1) };
      const path = projectForm.id ? `/api/admin/enterprise/projects/${projectForm.id}` : '/api/admin/enterprise/projects';
      await request(path, { method: projectForm.id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      flash('success', projectForm.id ? '项目已更新' : '项目已创建'); resetProjectForm(); await loadProjects();
    } catch (e: any) { flash('error', e.message); } finally { loading = false; }
  }

  function editProject(p: any) { projectForm = { id: String(p.id), orgId: String(p.orgId), teamId: p.teamId ? String(p.teamId) : '', name: p.name, slug: p.slug || '', description: p.description || '', budget: String(p.budget || 0), allowedModels: Array.isArray(p.allowedModels) ? p.allowedModels.join('\n') : '', deniedModels: Array.isArray(p.deniedModels) ? p.deniedModels.join('\n') : '', status: String(p.status || 1) }; activeTab = 'projects'; }
  async function deleteProject(id: number) { if (!confirm('确认删除项目？')) return; await request(`/api/admin/enterprise/projects/${id}`, { method: 'DELETE' }); flash('success', '项目已删除'); await loadProjects(); }

  // ─── Recycle Bin ───────────────────────────────────────────

  async function restoreRecord(id: number) { if (!confirm('确认恢复？')) return; await request(`/api/admin/enterprise/recycle-bin/${id}/restore`, { method: 'POST', body: '{}' }); flash('success', '已恢复'); await loadRecycle(); }
  async function purgeRecord(id: number) { if (!confirm('永久删除不可恢复！')) return; await request(`/api/admin/enterprise/recycle-bin/${id}`, { method: 'DELETE' }); flash('success', '已永久删除'); await loadRecycle(); }

  // ─── SVG Sparkline ─────────────────────────────────────────

  function sparklinePath(data: number[], width = 200, height = 32): string {
    if (!data.length) return '';
    const max = Math.max(...data, 1);
    const step = width / Math.max(data.length - 1, 1);
    return data.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`).join(' ');
  }

  // ─── Init ──────────────────────────────────────────────────
  onMount(loadAll);
</script>

<div class="space-y-6">
  <PageHeader title="企业内控后台" description="Token 生命周期、团队、项目、预算、审计、回收站与趋势分析。" />

  {#if message.text}
    <div class="rounded-xl border p-3 text-sm {message.type === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'}">
      {message.text}
    </div>
  {/if}

  {#if revealKey}
    <Card.Root class="border-amber-500/30 bg-amber-500/10">
      <Card.Header><Card.Title>完整 Token 仅显示一次</Card.Title></Card.Header>
      <Card.Content>
        <div class="flex flex-col gap-3 md:flex-row md:items-center">
          <code class="flex-1 rounded-lg bg-background px-3 py-2 text-xs break-all">{revealKey}</code>
          <Button variant="outline" onclick={() => (revealKey = '')}>已记录，隐藏</Button>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- Tab Bar -->
  <div class="flex flex-wrap gap-2">
    {#each tabs as tab}
      <Button variant={activeTab === tab.id ? 'default' : 'outline'} size="sm" onclick={() => (activeTab = tab.id)}>
        {tab.label}
      </Button>
    {/each}
    <Button variant="ghost" size="sm" onclick={loadAll} disabled={loading}>刷新</Button>
  </div>

  <!-- ═══════════════════════════════════════════════════════════
       OVERVIEW
       ═══════════════════════════════════════════════════════════ -->
  {#if activeTab === 'overview'}
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {#each [['组织', overview.stats?.totalOrganizations], ['用户', overview.stats?.totalUsers], ['活跃 Token', overview.stats?.activeTokens], ['7日请求', overview.stats?.requests7d], ['7日失败率', `${overview.stats?.failureRate7d || 0}%`]] as item}
        <Card.Root><Card.Content class="py-5"><div class="text-xs text-muted-foreground">{item[0]}</div><div class="mt-2 text-2xl font-semibold">{item[1] || 0}</div></Card.Content></Card.Root>
      {/each}
    </div>
    <div class="grid gap-4 xl:grid-cols-2">
      <Card.Root>
        <Card.Header><Card.Title>高消耗 Token</Card.Title></Card.Header>
        <Card.Content class="space-y-2">
          {#each overview.topTokens || [] as t}
            <div class="flex items-center justify-between rounded-lg border p-3 text-sm">
              <div><div class="font-medium">{t.name} <span class="text-xs text-muted-foreground">#{t.id}</span></div><div class="text-xs text-muted-foreground">{t.userName || '-'} · {t.orgName || '未绑定'} · {t.key}</div></div>
              <div class="text-right font-mono">{formatQuota(t.usedQuota)}</div>
            </div>
          {/each}
        </Card.Content>
      </Card.Root>
      <Card.Root>
        <Card.Header><Card.Title>模型分布 (7d)</Card.Title></Card.Header>
        <Card.Content class="space-y-2">
          {#each overview.modelDistribution || [] as m}
            <div class="flex items-center justify-between rounded-lg border p-3 text-sm">
              <span class="font-mono">{m.modelName}</span>
              <span>{m.requests} 次 · {formatQuota(m.cost)}</span>
            </div>
          {/each}
        </Card.Content>
      </Card.Root>
    </div>

  <!-- ═══════════════════════════════════════════════════════════
       TOKENS (with search/pagination/filter)
       ═══════════════════════════════════════════════════════════ -->
  {:else if activeTab === 'tokens'}
    <div class="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Card.Root>
        <Card.Header><Card.Title>{tokenForm.id ? '编辑' : '创建'}企业 Token</Card.Title></Card.Header>
        <Card.Content class="space-y-3">
          <Input placeholder="名称" bind:value={tokenForm.name} />
          <div class="grid grid-cols-2 gap-2"><Input placeholder="用户 ID" bind:value={tokenForm.userId} /><Input placeholder="组织 ID" bind:value={tokenForm.orgId} /></div>
          <div class="grid grid-cols-2 gap-2"><Input placeholder="剩余额度 (-1 不限)" bind:value={tokenForm.remainQuota} /><Input placeholder="RPM" bind:value={tokenForm.rateLimit} /></div>
          <Textarea placeholder="允许模型，每行一个" bind:value={tokenForm.models} />
          <Textarea placeholder="IP/CIDR 白名单，每行一个" bind:value={tokenForm.allowIps} />
          <Input placeholder="渠道/子网限制" bind:value={tokenForm.subnet} />
          <div class="grid grid-cols-2 gap-2"><Input type="datetime-local" bind:value={tokenForm.expiredAt} /><Input placeholder="状态 1=启用 2=禁用" bind:value={tokenForm.status} /></div>
          <Input placeholder="Token 分组" bind:value={tokenForm.tokenGroup} />
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={tokenForm.modelLimitsEnabled} /> 模型权限</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={tokenForm.unlimitedQuota} /> 无限额度</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={tokenForm.crossGroupRetry} /> 跨组重试</label>
          <div class="flex gap-2"><Button onclick={saveToken} disabled={loading}>{tokenForm.id ? '更新' : '创建'}</Button><Button variant="outline" onclick={resetTokenForm}>清空</Button></div>
        </Card.Content>
      </Card.Root>

      <div class="space-y-3">
        <!-- Search & Filter Bar -->
        <div class="flex flex-wrap gap-2 items-end">
          <div class="w-48"><Input placeholder="搜索名称/用户" bind:value={tokenSearch} /></div>
          <div class="w-28"><Input placeholder="组织 ID" bind:value={tokenFilterOrg} /></div>
          <select class="h-9 rounded-md border px-2 text-sm" bind:value={tokenFilterStatus}>
            <option value="">全部状态</option><option value="1">启用</option><option value="2">禁用</option>
          </select>
          <Button size="sm" onclick={() => { tokenPage = 1; loadTokens(); }}>搜索</Button>
        </div>

        <Card.Root>
          <Card.Content class="overflow-auto">
            <table class="w-full min-w-[900px] text-sm">
              <thead class="text-left text-muted-foreground"><tr><th class="py-2">Token</th><th>归属</th><th>预算</th><th>权限</th><th>最近使用</th><th>操作</th></tr></thead>
              <tbody>
                {#each enterpriseTokens as t}
                  <tr class="border-t">
                    <td class="py-3"><div class="font-medium">{t.name}</div><code class="text-xs text-muted-foreground">{t.key}</code></td>
                    <td>{t.userName || '-'}<div class="text-xs text-muted-foreground">{t.orgName || '未绑定'}</div></td>
                    <td>{formatQuota(t.usedQuota)} / {t.unlimitedQuota ? '不限' : formatQuota(t.remainQuota)}<div class="text-xs">{t.usagePercent || 0}%</div></td>
                    <td><Badge variant={t.status === 1 ? 'default' : 'secondary'}>{t.status === 1 ? '启用' : '禁用'}</Badge></td>
                    <td>{formatDate(t.accessedAt)}</td>
                    <td class="space-x-1"><Button size="sm" variant="outline" onclick={() => editToken(t)}>编辑</Button><Button size="sm" variant="outline" onclick={() => regenerateToken(t.id)}>重生</Button><Button size="sm" variant="destructive" onclick={() => deleteToken(t.id)}>删除</Button></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </Card.Content>
        </Card.Root>

        <!-- Pagination -->
        <div class="flex items-center justify-between text-sm text-muted-foreground">
          <span>共 {tokenTotal} 条，第 {tokenPage}/{totalPages(tokenTotal, tokenLimit)} 页</span>
          <div class="flex gap-2">
            <Button size="sm" variant="outline" disabled={tokenPage <= 1} onclick={() => { tokenPage--; loadTokens(); }}>上一页</Button>
            <Button size="sm" variant="outline" disabled={tokenPage >= totalPages(tokenTotal, tokenLimit)} onclick={() => { tokenPage++; loadTokens(); }}>下一页</Button>
          </div>
        </div>
      </div>
    </div>

  <!-- ═══════════════════════════════════════════════════════════
       ORGANIZATIONS
       ═══════════════════════════════════════════════════════════ -->
  {:else if activeTab === 'organizations'}
    <div class="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Card.Root>
        <Card.Header><Card.Title>{orgForm.id ? '编辑' : '创建'}组织</Card.Title></Card.Header>
        <Card.Content class="space-y-3">
          <div class="grid grid-cols-2 gap-2"><Input placeholder="Slug" bind:value={orgForm.slug} /><Input placeholder="名称" bind:value={orgForm.name} /></div>
          <Input placeholder="账单邮箱" bind:value={orgForm.billingEmail} />
          <div class="grid grid-cols-2 gap-2"><Input placeholder="总额度" bind:value={orgForm.quota} /><Input placeholder="状态" bind:value={orgForm.status} /></div>
          <Textarea placeholder="允许模型 (每行一个)" bind:value={orgForm.allowedModels} />
          <Textarea placeholder="禁止模型" bind:value={orgForm.deniedModels} />
          <Textarea placeholder="IP/CIDR 限制" bind:value={orgForm.allowedSubnets} />
          <div class="grid grid-cols-2 gap-2"><Input placeholder="用户告警阈值" bind:value={orgForm.quotaAlarmThreshold} /><Input placeholder="组织告警阈值" bind:value={orgForm.alertThresholdPct} /></div>
          <Input placeholder="告警 Webhook" bind:value={orgForm.alertWebhookUrl} />
          <Textarea placeholder="Metadata JSON" bind:value={orgForm.metadata} />
          <div class="flex gap-2"><Button onclick={saveOrganization} disabled={loading}>{orgForm.id ? '更新' : '创建'}</Button><Button variant="outline" onclick={resetOrgForm}>清空</Button></div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header><Card.Title>组织列表</Card.Title></Card.Header>
        <Card.Content class="overflow-auto">
          <table class="w-full min-w-[760px] text-sm">
            <thead class="text-left text-muted-foreground"><tr><th class="py-2">组织</th><th>额度</th><th>成员</th><th>策略</th><th>操作</th></tr></thead>
            <tbody>
              {#each organizations as o}
                <tr class="border-t">
                  <td class="py-3"><div class="font-medium">{o.name}</div><div class="text-xs text-muted-foreground">#{o.id} · {o.slug || '-'}</div></td>
                  <td>{formatQuota(o.usedQuota)} / {formatQuota(o.quota)}<div class="text-xs">{o.usagePercent || 0}%</div></td>
                  <td>{o.userCount || 0} 用户 · {o.tokenCount || 0} Token</td>
                  <td><Badge>{o.status === 1 ? '启用' : '禁用'}</Badge></td>
                  <td class="space-x-2"><Button size="sm" variant="outline" onclick={() => editOrganization(o)}>编辑</Button><Button size="sm" variant="destructive" onclick={() => deleteOrganization(o.id)}>删除</Button></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </Card.Content>
      </Card.Root>
    </div>

  <!-- ═══════════════════════════════════════════════════════════
       TEAMS
       ═══════════════════════════════════════════════════════════ -->
  {:else if activeTab === 'teams'}
    <div class="grid gap-4 xl:grid-cols-[380px_1fr]">
      <div class="space-y-4">
        <Card.Root>
          <Card.Header><Card.Title>{teamForm.id ? '编辑' : '创建'}团队</Card.Title></Card.Header>
          <Card.Content class="space-y-3">
            <Input placeholder="组织 ID (必填)" bind:value={teamForm.orgId} />
            <div class="grid grid-cols-2 gap-2"><Input placeholder="名称" bind:value={teamForm.name} /><Input placeholder="Slug" bind:value={teamForm.slug} /></div>
            <Input placeholder="描述" bind:value={teamForm.description} />
            <Input placeholder="负责人 User ID" bind:value={teamForm.leaderId} />
            <Input placeholder="预算" bind:value={teamForm.budget} />
            <Textarea placeholder="允许模型 (每行一个)" bind:value={teamForm.allowedModels} />
            <Textarea placeholder="禁止模型" bind:value={teamForm.deniedModels} />
            <div class="flex gap-2"><Button onclick={saveTeam} disabled={loading}>{teamForm.id ? '更新' : '创建'}</Button><Button variant="outline" onclick={resetTeamForm}>清空</Button></div>
          </Card.Content>
        </Card.Root>

        {#if selectedTeamId}
          <Card.Root>
            <Card.Header><Card.Title>团队成员 #{selectedTeamId}</Card.Title></Card.Header>
            <Card.Content class="space-y-3">
              <div class="flex gap-2">
                <Input placeholder="用户 ID" bind:value={addMemberUserId} class="flex-1" />
                <select class="h-9 rounded-md border px-2 text-sm" bind:value={addMemberRole}>
                  <option value="member">成员</option><option value="admin">管理员</option><option value="viewer">观察者</option>
                </select>
                <Button size="sm" onclick={addMember}>添加</Button>
              </div>
              {#each teamMembers as m}
                <div class="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <div><span class="font-medium">{m.username || m.name || '-'}</span> <Badge variant="outline">{m.role}</Badge><div class="text-xs text-muted-foreground">User #{m.userId}</div></div>
                  <Button size="sm" variant="destructive" onclick={() => removeMember(m.id)}>移除</Button>
                </div>
              {/each}
            </Card.Content>
          </Card.Root>
        {/if}
      </div>

      <div class="space-y-3">
        <div class="flex flex-wrap gap-2 items-end">
          <div class="w-48"><Input placeholder="搜索名称" bind:value={teamSearch} /></div>
          <div class="w-28"><Input placeholder="组织 ID" bind:value={teamFilterOrg} /></div>
          <Button size="sm" onclick={() => { teamPage = 1; loadTeams(); }}>搜索</Button>
        </div>
        <Card.Root>
          <Card.Content class="overflow-auto">
            <table class="w-full min-w-[760px] text-sm">
              <thead class="text-left text-muted-foreground"><tr><th class="py-2">团队</th><th>组织</th><th>预算</th><th>成员</th><th>操作</th></tr></thead>
              <tbody>
                {#each teams as t}
                  <tr class="border-t">
                    <td class="py-3"><div class="font-medium">{t.name}</div><div class="text-xs text-muted-foreground">#{t.id} · {t.slug || '-'}</div></td>
                    <td>{t.orgName || '-'}</td>
                    <td>{formatQuota(t.usedBudget)} / {formatQuota(t.budget)}</td>
                    <td>{t.memberCount || 0}</td>
                    <td class="space-x-1">
                      <Button size="sm" variant="outline" onclick={() => loadTeamMembers(t.id)}>成员</Button>
                      <Button size="sm" variant="outline" onclick={() => editTeam(t)}>编辑</Button>
                      <Button size="sm" variant="destructive" onclick={() => deleteTeam(t.id)}>删除</Button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </Card.Content>
        </Card.Root>
        <div class="flex items-center justify-between text-sm text-muted-foreground">
          <span>共 {teamTotal} 条</span>
          <div class="flex gap-2">
            <Button size="sm" variant="outline" disabled={teamPage <= 1} onclick={() => { teamPage--; loadTeams(); }}>上一页</Button>
            <Button size="sm" variant="outline" disabled={teamPage >= totalPages(teamTotal, 30)} onclick={() => { teamPage++; loadTeams(); }}>下一页</Button>
          </div>
        </div>
      </div>
    </div>

  <!-- ═══════════════════════════════════════════════════════════
       PROJECTS
       ═══════════════════════════════════════════════════════════ -->
  {:else if activeTab === 'projects'}
    <div class="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Card.Root>
        <Card.Header><Card.Title>{projectForm.id ? '编辑' : '创建'}项目</Card.Title></Card.Header>
        <Card.Content class="space-y-3">
          <Input placeholder="组织 ID (必填)" bind:value={projectForm.orgId} />
          <Input placeholder="团队 ID" bind:value={projectForm.teamId} />
          <div class="grid grid-cols-2 gap-2"><Input placeholder="名称" bind:value={projectForm.name} /><Input placeholder="Slug" bind:value={projectForm.slug} /></div>
          <Input placeholder="描述" bind:value={projectForm.description} />
          <Input placeholder="预算" bind:value={projectForm.budget} />
          <Textarea placeholder="允许模型" bind:value={projectForm.allowedModels} />
          <Textarea placeholder="禁止模型" bind:value={projectForm.deniedModels} />
          <div class="flex gap-2"><Button onclick={saveProject} disabled={loading}>{projectForm.id ? '更新' : '创建'}</Button><Button variant="outline" onclick={resetProjectForm}>清空</Button></div>
        </Card.Content>
      </Card.Root>

      <div class="space-y-3">
        <div class="flex flex-wrap gap-2 items-end">
          <div class="w-48"><Input placeholder="搜索名称" bind:value={projectSearch} /></div>
          <div class="w-28"><Input placeholder="组织 ID" bind:value={projectFilterOrg} /></div>
          <div class="w-28"><Input placeholder="团队 ID" bind:value={projectFilterTeam} /></div>
          <Button size="sm" onclick={() => { projectPage = 1; loadProjects(); }}>搜索</Button>
        </div>
        <Card.Root>
          <Card.Content class="overflow-auto">
            <table class="w-full min-w-[760px] text-sm">
              <thead class="text-left text-muted-foreground"><tr><th class="py-2">项目</th><th>组织</th><th>团队</th><th>预算</th><th>操作</th></tr></thead>
              <tbody>
                {#each projects as p}
                  <tr class="border-t">
                    <td class="py-3"><div class="font-medium">{p.name}</div><div class="text-xs text-muted-foreground">#{p.id} · {p.slug || '-'}</div></td>
                    <td>{p.orgName || '-'}</td>
                    <td>{p.teamName || '-'}</td>
                    <td>{formatQuota(p.usedBudget)} / {formatQuota(p.budget)}</td>
                    <td class="space-x-1"><Button size="sm" variant="outline" onclick={() => editProject(p)}>编辑</Button><Button size="sm" variant="destructive" onclick={() => deleteProject(p.id)}>删除</Button></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </Card.Content>
        </Card.Root>
        <div class="flex items-center justify-between text-sm text-muted-foreground">
          <span>共 {projectTotal} 条</span>
          <div class="flex gap-2">
            <Button size="sm" variant="outline" disabled={projectPage <= 1} onclick={() => { projectPage--; loadProjects(); }}>上一页</Button>
            <Button size="sm" variant="outline" disabled={projectPage >= totalPages(projectTotal, 30)} onclick={() => { projectPage++; loadProjects(); }}>下一页</Button>
          </div>
        </div>
      </div>
    </div>

  <!-- ═══════════════════════════════════════════════════════════
       BUDGETS
       ═══════════════════════════════════════════════════════════ -->
  {:else if activeTab === 'budgets'}
    <Card.Root>
      <Card.Header><Card.Title>预算与风险告警</Card.Title></Card.Header>
      <Card.Content class="space-y-2">
        {#each alerts as a}
          <div class="flex items-center justify-between rounded-lg border p-3 text-sm">
            <div><Badge variant="outline">{a.type}</Badge> <span class="font-medium">{a.username || a.name || '-'}</span><div class="text-xs text-muted-foreground">{formatDate(a.createdAt)}</div></div>
            <div class="text-right">{formatQuota(a.usedQuota)} / {formatQuota(a.quota)}<div class="text-xs">{Number(a.usagePercent || 0).toFixed(2)}%</div></div>
          </div>
        {/each}
      </Card.Content>
    </Card.Root>

  <!-- ═══════════════════════════════════════════════════════════
       AUDIT (with search & pagination)
       ═══════════════════════════════════════════════════════════ -->
  {:else if activeTab === 'audit'}
    <div class="space-y-3">
      <div class="flex flex-wrap gap-2 items-end">
        <div class="w-40"><Input placeholder="Action" bind:value={auditSearchAction} /></div>
        <div class="w-40"><Input placeholder="Resource" bind:value={auditSearchResource} /></div>
        <Button size="sm" onclick={() => { auditPage = 1; loadAudit(); }}>搜索</Button>
      </div>
      <Card.Root>
        <Card.Content class="overflow-auto">
          <table class="w-full min-w-[760px] text-sm">
            <thead class="text-left text-muted-foreground"><tr><th class="py-2">时间</th><th>操作者</th><th>动作</th><th>资源</th><th>来源</th></tr></thead>
            <tbody>
              {#each auditLogs as a}
                <tr class="border-t"><td class="py-3">{formatDate(a.createdAt)}</td><td>{a.username}</td><td><Badge variant="outline">{a.action}</Badge></td><td>{a.resource} #{a.resourceId || '-'}</td><td>{a.ipAddress || '-'}</td></tr>
              {/each}
            </tbody>
          </table>
        </Card.Content>
      </Card.Root>
      <div class="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {auditTotal} 条</span>
        <div class="flex gap-2">
          <Button size="sm" variant="outline" disabled={auditPage <= 1} onclick={() => { auditPage--; loadAudit(); }}>上一页</Button>
          <Button size="sm" variant="outline" disabled={auditPage >= totalPages(auditTotal, 30)} onclick={() => { auditPage++; loadAudit(); }}>下一页</Button>
        </div>
      </div>
    </div>

  <!-- ═══════════════════════════════════════════════════════════
       RECYCLE BIN
       ═══════════════════════════════════════════════════════════ -->
  {:else if activeTab === 'recycle'}
    <div class="space-y-3">
      <div class="flex flex-wrap gap-2 items-end">
        <select class="h-9 rounded-md border px-2 text-sm" bind:value={recycleType}>
          <option value="">全部类型</option><option value="token">Token</option><option value="organization">组织</option><option value="team">团队</option><option value="project">项目</option>
        </select>
        <Button size="sm" onclick={() => { recyclePage = 1; loadRecycle(); }}>筛选</Button>
      </div>
      <Card.Root>
        <Card.Content class="overflow-auto">
          <table class="w-full min-w-[760px] text-sm">
            <thead class="text-left text-muted-foreground"><tr><th class="py-2">类型</th><th>ID</th><th>快照</th><th>删除者</th><th>删除时间</th><th>过期</th><th>操作</th></tr></thead>
            <tbody>
              {#each recycleRecords as r}
                <tr class="border-t">
                  <td class="py-3"><Badge>{r.resourceType}</Badge></td>
                  <td>#{r.resourceId}</td>
                  <td class="max-w-[200px] truncate text-xs text-muted-foreground">{JSON.stringify(r.snapshot).slice(0, 80)}...</td>
                  <td>{r.deleterName || '-'}</td>
                  <td>{formatDate(r.createdAt)}</td>
                  <td>{formatDate(r.purgeAt)}</td>
                  <td class="space-x-1">
                    <Button size="sm" variant="outline" onclick={() => restoreRecord(r.id)}>恢复</Button>
                    <Button size="sm" variant="destructive" onclick={() => purgeRecord(r.id)}>永久删除</Button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </Card.Content>
      </Card.Root>
      <div class="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {recycleTotal} 条</span>
        <div class="flex gap-2">
          <Button size="sm" variant="outline" disabled={recyclePage <= 1} onclick={() => { recyclePage--; loadRecycle(); }}>上一页</Button>
          <Button size="sm" variant="outline" disabled={recyclePage >= totalPages(recycleTotal, 30)} onclick={() => { recyclePage++; loadRecycle(); }}>下一页</Button>
        </div>
      </div>
    </div>

  <!-- ═══════════════════════════════════════════════════════════
       TRENDS
       ═══════════════════════════════════════════════════════════ -->
  {:else if activeTab === 'trends'}
    <div class="space-y-4">
      <div class="flex flex-wrap gap-2 items-end">
        <select class="h-9 rounded-md border px-2 text-sm" bind:value={trendDays}>
          <option value={7}>7 天</option><option value={14}>14 天</option><option value={30}>30 天</option><option value={90}>90 天</option>
        </select>
        <div class="w-28"><Input placeholder="组织 ID" bind:value={trendOrgId} /></div>
        <Button size="sm" onclick={loadTrends}>刷新趋势</Button>
      </div>

      <!-- Daily Requests Sparkline -->
      <Card.Root>
        <Card.Header><Card.Title>每日请求量 ({trendDays}d)</Card.Title></Card.Header>
        <Card.Content>
          {#if trendData.daily.length}
            <svg viewBox="0 0 200 32" class="w-full max-w-xl h-10" preserveAspectRatio="none">
              <path d={sparklinePath(trendData.daily.map((d: any) => d.requests))} fill="none" stroke="hsl(var(--primary))" stroke-width="1.5" />
            </svg>
            <div class="mt-2 overflow-auto">
              <table class="w-full text-xs">
                <thead><tr><th>日期</th><th>请求</th><th>输入 Token</th><th>输出 Token</th><th>费用</th><th>错误</th></tr></thead>
                <tbody>
                  {#each trendData.daily as d}
                    <tr class="border-t"><td>{d.date}</td><td>{d.requests}</td><td>{Number(d.promptTokens).toLocaleString()}</td><td>{Number(d.completionTokens).toLocaleString()}</td><td>{formatQuota(d.cost)}</td><td>{d.errors}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <div class="text-sm text-muted-foreground">无数据</div>
          {/if}
        </Card.Content>
      </Card.Root>

      <div class="grid gap-4 xl:grid-cols-2">
        <!-- Model Distribution -->
        <Card.Root>
          <Card.Header><Card.Title>模型分布</Card.Title></Card.Header>
          <Card.Content class="space-y-2">
            {#each trendData.models as m}
              <div class="flex items-center justify-between text-sm"><span class="font-mono">{m.model}</span><span>{m.requests} 次 · {formatQuota(m.cost)}</span></div>
            {/each}
          </Card.Content>
        </Card.Root>

        <!-- Top Users -->
        <Card.Root>
          <Card.Header><Card.Title>高消费用户</Card.Title></Card.Header>
          <Card.Content class="space-y-2">
            {#each trendData.topUsers as u}
              <div class="flex items-center justify-between text-sm"><span>{u.username || `User #${u.userId}`}</span><span>{u.requests} 次 · {formatQuota(u.cost)}</span></div>
            {/each}
          </Card.Content>
        </Card.Root>
      </div>
    </div>
  {/if}
</div>
