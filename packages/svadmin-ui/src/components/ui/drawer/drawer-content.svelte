<script lang="ts">
  import { Drawer as DrawerPrimitive } from 'vaul-svelte';
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';

  let { class: className, children, ...restProps }: { class?: string; children?: Snippet; [key: string]: unknown } = $props();
</script>

<DrawerPrimitive.Portal>
  <DrawerPrimitive.Overlay class="fixed inset-0 z-50 bg-black/80" />
  <DrawerPrimitive.Content
    class={cn(
      "bg-background fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border",
      className
    )}
    {...restProps}
  >
    <div class="bg-muted mx-auto mt-4 h-2 w-[100px] rounded-full"></div>
    {@render children?.()}
  </DrawerPrimitive.Content>
</DrawerPrimitive.Portal>
