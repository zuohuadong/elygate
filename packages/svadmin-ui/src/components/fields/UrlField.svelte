<script lang="ts">
  import { ExternalLink } from 'lucide-svelte';
  interface Props { value: string | null | undefined; label?: string }
  let { value, label }: Props = $props();
  const display = $derived(label ?? value ?? '');
</script>
{#if value}
  <a href={value} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline no-underline inline-flex items-center gap-1">
    {display}
    <ExternalLink class="h-3 w-3 opacity-60" />
  </a>
{:else}
  <span class="text-muted-foreground">—</span>
{/if}
