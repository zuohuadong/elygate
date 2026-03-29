<script lang="ts">
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';
  import type { HTMLLiAttributes } from 'svelte/elements';

  let { class: className, children, ...restProps }: HTMLLiAttributes & { children?: Snippet } = $props();
</script>

<li
  data-slot="breadcrumb-item"
  class={cn("inline-flex items-center gap-1.5", className)}
  {...restProps}
>
  {@render children?.()}
</li>
