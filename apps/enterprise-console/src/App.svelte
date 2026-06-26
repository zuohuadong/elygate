<script lang="ts">
  import { AdminApp } from '@svadmin/ui';
  import { setAccessControlProvider } from '@svadmin/core';
  import { createElygateDataProvider } from '@elygate/svadmin-helpers';
  import type { MenuItem } from '@svadmin/core';
  import { enterpriseResources } from './resources';
  import { createEnterpriseAccessControl } from './providers/accessControl';
  import { createEnterpriseAuthProvider, getSupAuthHeaders } from './providers/auth';
  import EnterpriseAutoTable from './components/EnterpriseAutoTable.svelte';
  import EnterpriseHome from './pages/EnterpriseHome.svelte';

  const virtualResources = new Set([
    'enterprise-overview',
    'gateway-instances',
    'gateway-resources',
    'members-and-access',
    'identity-and-policy',
    'usage-and-budget',
    'usage-efficiency',
    'billing-and-invoices',
    'data-governance',
    'audit-events',
  ]);

  const dataProvider = createElygateDataProvider({
    apiUrl: '/api/enterprise',
    withCredentials: true,
    headers: (): Record<string, string> => getSupAuthHeaders(),
    updateMethod: 'PUT',
    virtualResources,
  });

  const authProvider = createEnterpriseAuthProvider();

  setAccessControlProvider(createEnterpriseAccessControl());

  const menu: MenuItem[] = [
    { name: 'enterprise-overview', label: '企业总览', icon: 'layout-dashboard', href: '/enterprise-overview' },
    { name: 'gateway-instances', label: '网关实例', icon: 'server', href: '/gateway-instances' },
    { name: 'gateway-resources', label: '网关资源', icon: 'network', href: '/gateway-resources' },
    { name: 'members-and-access', label: '成员与席位', icon: 'users', href: '/members-and-access' },
    { name: 'identity-and-policy', label: '身份与策略', icon: 'shield', href: '/identity-and-policy' },
    { name: 'usage-and-budget', label: '用量与预算', icon: 'chart-no-axes-combined', href: '/usage-and-budget' },
    { name: 'usage-efficiency', label: '效能看板', icon: 'activity', href: '/usage-efficiency' },
    { name: 'billing-and-invoices', label: '账单发票', icon: 'receipt', href: '/billing-and-invoices' },
    { name: 'data-governance', label: '数据治理', icon: 'lock-keyhole', href: '/data-governance' },
    { name: 'audit-events', label: '审计事件', icon: 'scroll-text', href: '/audit-events' },
  ];
</script>

<AdminApp
  {dataProvider}
  {authProvider}
  resources={enterpriseResources}
  {menu}
  title="Elygate Enterprise"
  locale="zh-CN"
  components={{
    AutoTable: EnterpriseAutoTable,
  }}
>
  {#snippet dashboard()}
    <EnterpriseHome />
  {/snippet}
</AdminApp>
