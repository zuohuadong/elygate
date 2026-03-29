<script lang="ts">
  import { useExport, useCan, t } from '@svadmin/core';
  import { Button } from '../ui/button/index.js';
  import { Download } from 'lucide-svelte';

  let { resource, hideText = false, accessControl = { enabled: true, hideIfUnauthorized: true }, class: className = '' } = $props<{
    resource: string;
    hideText?: boolean;
    accessControl?: { enabled?: boolean; hideIfUnauthorized?: boolean };
    class?: string;
  }>();

  const { triggerExport, isLoading } = useExport({ get resource() { return resource; } });
  const can = $derived(accessControl?.enabled ? useCan(resource, 'export') : null);
  const hidden = $derived(accessControl?.hideIfUnauthorized && can && !can.allowed);
</script>

{#if !hidden}

  <Button
    variant="outline"
    size={hideText ? 'icon' : 'sm'}
    class={className}
    disabled={isLoading || (can ? !can.allowed : false)}
    onclick={triggerExport}
  >
    <Download class="h-4 w-4" />
    {#if !hideText}<span class="ml-1">{t('common.export')}</span>{/if}
  </Button>
{/if}
