<script lang="ts">
  import { cn } from '../../../utils.js';
  import type { HTMLAttributes } from 'svelte/elements';
  import { Ellipsis } from '@lucide/svelte';

  let { class: className, ...restProps }: HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span
  role="presentation"
  aria-hidden="true"
  data-slot="breadcrumb-ellipsis"
  class={cn("flex size-9 items-center justify-center", className)}
  {...restProps}
>
  <Ellipsis class="size-4" />
  <span class="sr-only">More</span>
</span>
