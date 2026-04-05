<script lang="ts">
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { buttonVariants } from '../button/index.js';
  import { ChevronLeft } from '@lucide/svelte';

  let { class: className, children, ...restProps }: HTMLButtonAttributes & { children?: Snippet } = $props();
</script>

<button
  aria-label="Go to previous page"
  data-slot="pagination-previous"
  class={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), "gap-1", className)}
  {...restProps}
>
  {#if children}
    {@render children()}
  {:else}
    <ChevronLeft class="size-4" />
  {/if}
</button>
