<script lang="ts">
  /**
   * CustomAutoTable — wraps the default AutoTable to intercept
   * virtual resource names and render custom pages instead.
   */
  import { AutoTable as DefaultAutoTable } from '@svadmin/ui';
  import Settings from '../pages/Settings.svelte';
  import ModelsStatus from '../pages/ModelsStatus.svelte';
  import Playground from '../pages/Playground.svelte';
  import FeatureConsole from '../pages/FeatureConsole.svelte';
  import ContentManagement from '../pages/ContentManagement.svelte';
  import PricingEditor from '../pages/PricingEditor.svelte';
  import PerformanceMonitor from '../pages/PerformanceMonitor.svelte';
  import EnterpriseConsole from '../pages/EnterpriseConsole.svelte';
  import MemoryManagement from '../pages/MemoryManagement.svelte';

  let { resourceName, ...rest }: { resourceName: string; [key: string]: any } = $props();

  // Map of virtual resource names to custom page components
  const customPages: Record<string, any> = {
    'system-options': Settings,
    models: ModelsStatus,
    playground: Playground,
    'feature-console': FeatureConsole,
    'content-management': ContentManagement,
    'pricing-editor': PricingEditor,
    'performance-monitor': PerformanceMonitor,
    'enterprise-console': EnterpriseConsole,
    'memory-management': MemoryManagement,
  };

  const CustomPage = $derived(customPages[resourceName]);
</script>

{#if CustomPage}
  <CustomPage />
{:else}
  <DefaultAutoTable {resourceName} {...rest} />
{/if}
