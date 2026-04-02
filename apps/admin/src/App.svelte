<script lang="ts">
  import { AdminApp } from '@svadmin/ui';
  import { createElysiaDataProvider } from '@svadmin/elysia';
  import { createSimpleRestAuthProvider } from '@svadmin/simple-rest';
  import { setAccessControlProvider } from '@svadmin/core';
  import type { MenuItem } from '@svadmin/core';
  import { resources } from './resources';
  import { createRoleBasedAccessControl } from './providers/accessControl';

  // Custom components
  import Dashboard from './pages/Dashboard.svelte';
  import ConsumerDashboard from './pages/ConsumerDashboard.svelte';
  import CustomShowPage from './pages/CustomShowPage.svelte';
  import CustomAutoTable from './components/CustomAutoTable.svelte';
  import CustomLoginPage from './pages/CustomLoginPage.svelte';

  const baseDataProvider = createElysiaDataProvider({
    apiUrl: '/api/admin',
    withCredentials: true,
    headers: () => {
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
      if (['system-options', 'models', 'playground'].includes(params.resource)) {
        return { data: [], total: 0 };
      }
      return baseDataProvider.getList(params);
    },
    getOne: async (params: any) => {
      if (['system-options', 'models', 'playground'].includes(params.resource)) {
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
  };

  const authProvider = createSimpleRestAuthProvider({
    loginUrl: '/api/auth/login',
    logoutUrl: '/api/auth/logout',
    identityUrl: '/api/auth/user/info',
    tokenKey: 'auth_token',
  });

  // Inject ACL
  setAccessControlProvider(createRoleBasedAccessControl());

  // Full menu (admin view — ACL will hide items for consumers)
  const menu: MenuItem[] = [
    { label: '仪表盘', icon: 'layout-dashboard', href: '/' },
    { label: '渠道管理', icon: 'radio', href: '/channels' },
    { label: '用户管理', icon: 'users', href: '/users' },
    { label: '令牌管理', icon: 'key', href: '/tokens' },
    { label: '分组', icon: 'folder', href: '/user-groups' },
    { label: '套餐', icon: 'package', href: '/packages' },
    { label: '兑换码', icon: 'gift', href: '/redemptions' },
    { label: '限流策略', icon: 'shield', href: '/rate-limits' },
    { label: '模型状态', icon: 'cpu', href: '/models' },
    { label: 'API 测试', icon: 'play', href: '/playground' },
    { label: '系统设置', icon: 'settings', href: '/system-options' },
  ];

  // Determine dashboard variant by identity role
  let identity = $state<Record<string, any> | null>(null);
  $effect(() => {
    authProvider.getIdentity?.().then((id: any) => { identity = id; }).catch(() => {});
  });
  const isAdmin = $derived(identity?.role === 10);
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
