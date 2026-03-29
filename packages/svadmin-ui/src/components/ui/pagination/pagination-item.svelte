<script lang="ts">
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';
  import type { HTMLLiAttributes } from 'svelte/elements';

  let { class: className, children, ...restProps }: HTMLLiAttributes & { children?: Snippet } = $props();
</script>

<li data-slot="pagination-item" class={cn("", className)} {...restProps}>
  {@render children?.()}
</li>
