<script lang="ts">
  import { Drawer as DrawerPrimitive } from 'vaul-svelte';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    children,
    ...restProps
  }: {
    open?: boolean;
    children?: Snippet;
    [key: string]: unknown;
  } = $props();
</script>

<DrawerPrimitive.Root bind:open {...restProps}>
  {@render children?.()}
</DrawerPrimitive.Root>
