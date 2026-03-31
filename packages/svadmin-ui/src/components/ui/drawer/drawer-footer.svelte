<script lang="ts">
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let { class: className, children, ...restProps }: HTMLAttributes<HTMLDivElement> & { children?: Snippet } = $props();
</script>

<div data-slot="drawer-footer" class={cn("mt-auto flex flex-col gap-2 p-4", className)} {...restProps}>
  {@render children?.()}
</div>
