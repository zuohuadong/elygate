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

  const dataProvider = createElysiaDataProvider({
    apiUrl: '/api/admin',
    withCredentials: true,
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

  const authProvider = createSimpleRestAuthProvider({
    loginUrl: '/api/auth/login',
    logoutUrl: '/api/auth/logout',
    identityUrl: '/api/auth/user/info',
    tokenKey: null,
  });

  // Inject ACL
  setAccessControlProvider(createRoleBasedAccessControl());

  // Full menu (admin view — ACL will hide items for consumers)
  const menu: MenuItem[] = [
    { label: '仪表盘', icon: 'layout-dashboard', link: '/' },
    { label: '渠道管理', icon: 'radio', link: '/channels' },
    { label: '用户管理', icon: 'users', link: '/users' },
    { label: '令牌管理', icon: 'key', link: '/tokens' },
    { label: '分组', icon: 'folder', link: '/user-groups' },
    { label: '套餐', icon: 'package', link: '/packages' },
    { label: '兑换码', icon: 'gift', link: '/redemptions' },
    { label: '限流策略', icon: 'shield', link: '/rate-limits' },
    { label: '模型状态', icon: 'cpu', link: '/models' },
    { label: 'API 测试', icon: 'play', link: '/playground' },
    { label: '系统设置', icon: 'settings', link: '/settings' },
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
    LoginPage: CustomLoginPage,
  }}
>
  {#snippet dashboard()}
    {#if isAdmin}
      <Dashboard />
    {:else}
      <ConsumerDashboard />
    {/if}
  {/snippet}
</AdminApp>
