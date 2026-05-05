<script lang="ts">
  /**
   * CustomAutoTable — wraps the default AutoTable to intercept
   * virtual resource names and render custom pages instead.
   */
  import { AutoTable as DefaultAutoTable } from '@svadmin/ui';
  import Settings from '../pages/Settings.svelte';
  import ModelsStatus from '../pages/ModelsStatus.svelte';
  import Playground from '../pages/Playground.svelte';

  let { resourceName, ...rest }: { resourceName: string; [key: string]: any } = $props();

  // Map of virtual resource names to custom page components
  const customPages: Record<string, any> = {
    'system-options': Settings,
    models: ModelsStatus,
    playground: Playground,
  };

  const CustomPage = $derived(customPages[resourceName]);
</script>

{#if CustomPage}
  <CustomPage />
{:else}
  <DefaultAutoTable {resourceName} {...rest} />
{/if}
