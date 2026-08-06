<script lang="ts">
	interface Props {
		label: string;
		hint?: string;
		value: number;
		min?: number;
		max?: number;
		step?: number;
		disabled?: boolean;
	}
	let { label, hint, value = $bindable(), min, max, step = 1, disabled = false }: Props = $props();
</script>

<label class="field-row">
	<span class="field-copy">
		<span class="field-label">{label}</span>
		{#if hint}<small>{hint}</small>{/if}
	</span>
	<input type="number" bind:value {min} {max} {step} {disabled} />
</label>

<style>
	.field-row { align-items: center; border-bottom: 1px solid var(--border); display: flex; gap: 1rem; justify-content: space-between; padding: .7rem 0; }
	.field-row:last-child { border-bottom: 0; }
	.field-copy { display: grid; gap: .15rem; min-width: 0; }
	.field-label { color: var(--foreground); font-size: .85rem; font-weight: 600; }
	small { color: var(--muted-foreground); font-size: .72rem; line-height: 1.4; }
	input { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); flex: none; font: inherit; font-size: .82rem; padding: .5rem .65rem; width: 8rem; }
	input:disabled { cursor: wait; opacity: .55; }
	input:focus-visible { border-color: var(--primary); outline: none; }
</style>
