<script lang="ts">
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let { class: className, children, ...restProps }: HTMLAttributes<HTMLElement> & { children?: Snippet } = $props();
</script>

<nav aria-label="breadcrumb" data-slot="breadcrumb" class={cn("", className)} {...restProps}>
  {@render children?.()}
</nav>
