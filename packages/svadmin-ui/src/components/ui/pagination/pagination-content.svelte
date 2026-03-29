<script lang="ts">
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let { class: className, children, ...restProps }: HTMLAttributes<HTMLUListElement> & { children?: Snippet } = $props();
</script>

<ul data-slot="pagination-content" class={cn("flex flex-row items-center gap-1", className)} {...restProps}>
  {@render children?.()}
</ul>
