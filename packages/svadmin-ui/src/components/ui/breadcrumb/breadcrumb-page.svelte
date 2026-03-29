<script lang="ts">
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let { class: className, children, ...restProps }: HTMLAttributes<HTMLSpanElement> & { children?: Snippet } = $props();
</script>

<span
  role="link"
  aria-disabled="true"
  aria-current="page"
  data-slot="breadcrumb-page"
  class={cn("text-foreground font-normal", className)}
  {...restProps}
>
  {@render children?.()}
</span>
