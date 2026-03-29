<script lang="ts">
	import type { Snippet } from "svelte";
	import { cn } from "../../../utils.js";

	let { class: className, children, orientation = 'vertical', ...restProps }:
		{ class?: string; children: Snippet; orientation?: 'vertical' | 'horizontal' } & Record<string, unknown> = $props();
</script>

<div
	class={cn("relative overflow-hidden", className)}
	{...restProps}
>
	<div class={cn(
		"h-full w-full overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border hover:scrollbar-thumb-muted-foreground/50",
		orientation === 'horizontal' ? 'overflow-x-auto overflow-y-hidden' : 'overflow-y-auto overflow-x-hidden'
	)}>
		{@render children()}
	</div>
</div>

