<script lang="ts">
  import { Command } from 'cmdk-sv';
  import * as Dialog from '../dialog/index.js';
  import { cn } from '../../../utils.js';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    class: className,
    children,
    ...restProps
  }: {
    open?: boolean;
    class?: string;
    children?: Snippet;
    [key: string]: unknown;
  } = $props();
</script>

<Dialog.Dialog bind:open {...restProps}>
  <Dialog.DialogContent class="overflow-hidden p-0">
    <Command.Root
      class={cn(
        "[&_[data-cmdk-group-heading]]:text-muted-foreground flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground [&_[data-cmdk-group-heading]]:px-2 [&_[data-cmdk-group-heading]]:font-medium [&_[data-cmdk-group]:not([hidden])_~[data-cmdk-group]]:pt-0 [&_[data-cmdk-input-wrapper]_svg]:h-5 [&_[data-cmdk-input-wrapper]_svg]:w-5 [&_[data-cmdk-input]]:h-12 [&_[data-cmdk-item]]:px-2 [&_[data-cmdk-item]]:py-3",
        className
      )}
    >
      {@render children?.()}
    </Command.Root>
  </Dialog.DialogContent>
</Dialog.Dialog>
