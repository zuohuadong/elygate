<script lang="ts">
  import { Drawer as DrawerPrimitive } from 'vaul-svelte';
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';

  let { class: className, children, ...restProps }: { class?: string; children?: Snippet; [key: string]: unknown } = $props();
</script>

<DrawerPrimitive.Description class={cn("text-muted-foreground text-sm", className)} {...restProps}>
  {@render children?.()}
</DrawerPrimitive.Description>
