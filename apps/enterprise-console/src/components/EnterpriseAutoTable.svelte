<script lang="ts">
  import type { Component } from 'svelte';
  import { AutoTable as DefaultAutoTable } from '@svadmin/ui';
  import EnterpriseHome from '../pages/EnterpriseHome.svelte';
  import GatewayInstances from '../pages/GatewayInstances.svelte';
  import GatewayResources from '../pages/GatewayResources.svelte';
  import IdentityAndPolicy from '../pages/IdentityAndPolicy.svelte';
  import UsageAndBudget from '../pages/UsageAndBudget.svelte';
  import MembersAndAccess from '../pages/MembersAndAccess.svelte';
  import UsageEfficiency from '../pages/UsageEfficiency.svelte';
  import BillingAndInvoices from '../pages/BillingAndInvoices.svelte';
  import DataGovernance from '../pages/DataGovernance.svelte';
  import AuditEvents from '../pages/AuditEvents.svelte';

  let { resourceName, ...rest }: { resourceName: string; [key: string]: unknown } = $props();

  const customPages: Record<string, Component> = {
    'enterprise-overview': EnterpriseHome,
    'gateway-instances': GatewayInstances,
    'gateway-resources': GatewayResources,
    'members-and-access': MembersAndAccess,
    'identity-and-policy': IdentityAndPolicy,
    'usage-and-budget': UsageAndBudget,
    'usage-efficiency': UsageEfficiency,
    'billing-and-invoices': BillingAndInvoices,
    'data-governance': DataGovernance,
    'audit-events': AuditEvents,
  };

  const CustomPage = $derived(customPages[resourceName]);
</script>

{#if CustomPage}
  <CustomPage />
{:else}
  <DefaultAutoTable {resourceName} {...rest} />
{/if}
