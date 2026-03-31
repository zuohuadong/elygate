<script lang="ts">
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let { class: className, children, ...restProps }: HTMLAttributes<HTMLDivElement> & { children?: Snippet } = $props();
</script>

<div data-slot="drawer-header" class={cn("grid gap-1.5 p-4 text-center sm:text-left", className)} {...restProps}>
  {@render children?.()}
</div>
