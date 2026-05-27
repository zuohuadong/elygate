<script lang="ts">
  import { AdminApp } from '@svadmin/ui';
  import { createElysiaDataProvider } from '@svadmin/elysia';
  import { createSimpleRestAuthProvider } from '@svadmin/simple-rest';
  import { setAccessControlProvider } from '@svadmin/core';
  import type { DataProvider, MenuItem } from '@svadmin/core';
  import { resources } from './resources';
  import { createRoleBasedAccessControl } from './providers/accessControl';

  // Custom components
  import Dashboard from './pages/Dashboard.svelte';
  import ConsumerDashboard from './pages/ConsumerDashboard.svelte';
  import CustomShowPage from './pages/CustomShowPage.svelte';
  import CustomAutoTable from './components/CustomAutoTable.svelte';
  import CustomLoginPage from './pages/CustomLoginPage.svelte';

  const virtualResources = new Set([
    'system-options',
    'models',
    'playground',
    'feature-console',
    'content-management',
    'pricing-editor',
    'performance-monitor',
    'enterprise-console',
  ]);

  const baseDataProvider = createElysiaDataProvider({
    apiUrl: '/api/admin',
    withCredentials: true,
    headers: (): Record<string, string> => {
      const token = localStorage.getItem('auth_token');
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    updateMethod: 'PUT',
    parseListResponse: (json: any) => {
      if (Array.isArray(json)) return { data: json, total: json.length };
      if (json.data) return { data: json.data, total: json.total ?? json.data.length };
      return { data: [], total: 0 };
    },
    resourceUrlMap: {
      'user-groups': 'user-groups',
      'rate-limits': 'rate-limits',
    },
  });

  const dataProvider = {
    ...baseDataProvider,
    getList: async (params: any) => {
      if (virtualResources.has(params.resource)) {
        return { data: [], total: 0 };
      }
      return baseDataProvider.getList(params);
    },
    getOne: async (params: any) => {
      if (virtualResources.has(params.resource)) {
        return { data: { id: params.id } as any };
      }
      try {
        return await baseDataProvider.getOne(params);
      } catch (err: any) {
        // Fallback for missing GET /:id backend endpoints (very common in legacy Elygate).
        // If it throws a 404 or fails, we fallback to requesting the list and extracting the item.
        if (err.message && (err.message.includes('404') || err.message.includes('Not Found'))) {
          const list = await baseDataProvider.getList({ 
            resource: params.resource, 
            pagination: { current: 1, pageSize: 1000 } // Request a large page to ensure it's found
          });
          const found = list.data.find((item: any) => String(item.id) === String(params.id));
          if (found) {
            return { data: found };
          }
        }
        throw err;
      }
    }
  } as DataProvider;

  const authProvider = createSimpleRestAuthProvider({
    loginUrl: '/api/auth/login',
    logoutUrl: '/api/auth/logout',
    identityUrl: '/api/auth/user/info',
    tokenKey: 'auth_token',
  });

  // Inject ACL
  setAccessControlProvider(createRoleBasedAccessControl());

  // Determine dashboard variant by identity role
  let identity = $state<Record<string, any> | null>(null);
  $effect(() => {
    authProvider.getIdentity?.().then((id: any) => { identity = id; }).catch(() => {});
  });
  const isAdmin = $derived(identity?.role === 10);

  function buildMenu(admin: boolean): MenuItem[] {
    if (!admin) {
      return [
        { name: 'dashboard', label: '仪表盘', icon: 'dashboard', href: '/' },
        { name: 'tokens', label: '我的令牌', icon: 'key', href: '/tokens' },
      ];
    }

    return [
      { name: 'dashboard', label: '仪表盘', icon: 'dashboard', href: '/' },
      {
        name: 'new-api-layer',
        label: 'New API 兼容后台',
        icon: 'folder',
        children: [
          { name: 'channels', label: '渠道管理', icon: 'radio', href: '/channels' },
          { name: 'users', label: '用户管理', icon: 'users', href: '/users' },
          { name: 'tokens', label: '令牌管理', icon: 'key', href: '/tokens' },
          { name: 'user-groups', label: '分组', icon: 'folder', href: '/user-groups' },
          { name: 'packages', label: '套餐', icon: 'package', href: '/packages' },
          { name: 'redemptions', label: '兑换码', icon: 'gift', href: '/redemptions' },
          { name: 'vendors', label: '供应商', icon: 'building', href: '/vendors' },
          { name: 'rate-limits', label: '限流策略', icon: 'shield', href: '/rate-limits' },
          { name: 'models-meta', label: '模型管理', icon: 'cpu', href: '/models-meta' },
          { name: 'pricing-editor', label: '倍率管理', icon: 'coins', href: '/pricing-editor' },
          { name: 'logs', label: '日志', icon: 'scroll-text', href: '/logs' },
          { name: 'content-management', label: '内容管理', icon: 'file-text', href: '/content-management' },
          { name: 'feature-console', label: '新增功能', icon: 'sparkles', href: '/feature-console' },
          { name: 'performance-monitor', label: '性能监控', icon: 'activity', href: '/performance-monitor' },
          { name: 'playground', label: 'API 测试', icon: 'play', href: '/playground' },
          { name: 'system-options', label: '系统设置', icon: 'settings', href: '/system-options' },
        ],
      },
      {
        name: 'enterprise-layer',
        label: '企业内控后台',
        icon: 'folder',
        children: [
          { name: 'enterprise-console', label: '企业控制台', icon: 'shield', href: '/enterprise-console' },
        ],
      },
    ];
  }

  const menu = $derived(buildMenu(isAdmin));
</script>

<AdminApp
  {dataProvider}
  {authProvider}
  {resources}
  {menu}
  title="Elygate"
  locale="zh-CN"
  components={{
    AutoTable: CustomAutoTable,
    ShowPage: CustomShowPage,
  }}
>
  {#snippet loginPage()}
    <CustomLoginPage />
  {/snippet}

  {#snippet dashboard()}
    {#if isAdmin}
      <Dashboard />
    {:else}
      <ConsumerDashboard />
    {/if}
  {/snippet}
</AdminApp>
