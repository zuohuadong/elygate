<script lang="ts">
  import type { Component } from 'svelte';
  /**
   * CustomAutoTable — wraps the default AutoTable to intercept
   * virtual resource names and render custom pages instead.
   */
  import { AutoTable as DefaultAutoTable } from '@svadmin/ui';
  import PanelSafeTable from './PanelSafeTable.svelte';
  import Settings from '../pages/Settings.svelte';
  import ModelsStatus from '../pages/ModelsStatus.svelte';
  import Playground from '../pages/Playground.svelte';
  import FeatureConsole from '../pages/FeatureConsole.svelte';
  import ContentManagement from '../pages/ContentManagement.svelte';
  import PricingEditor from '../pages/PricingEditor.svelte';
  import PerformanceMonitor from '../pages/PerformanceMonitor.svelte';
  import MemoryManagement from '../pages/MemoryManagement.svelte';

  let { resourceName }: { resourceName: string } = $props();

  // Map of virtual resource names to custom page components
  const customPages: Record<string, Component> = {
    'system-options': Settings,
    models: ModelsStatus,
    playground: Playground,
    'feature-console': FeatureConsole,
    'content-management': ContentManagement,
    'pricing-editor': PricingEditor,
    'performance-monitor': PerformanceMonitor,
    'memory-management': MemoryManagement,
  };

  const safeTableResources = new Set([
    'channels',
    'users',
    'tokens',
    'user-groups',
    'packages',
    'redemptions',
    'vendors',
    'rate-limits',
    'logs',
    'models-meta',
  ]);

  const CustomPage = $derived(customPages[resourceName]);
  const usesSafeTable = $derived(safeTableResources.has(resourceName));
</script>

{#key resourceName}
  {#if CustomPage}
    <CustomPage />
  {:else if usesSafeTable}
    <PanelSafeTable {resourceName} />
  {:else}
    <DefaultAutoTable {resourceName} />
  {/if}
{/key}
