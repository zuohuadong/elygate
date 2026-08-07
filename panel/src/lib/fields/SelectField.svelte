<script lang="ts">
	interface Option {
		value: string;
		label: string;
	}

	interface Props {
		label: string;
		hint?: string;
		value: string;
		options: Option[];
		disabled?: boolean;
	}
	let { label, hint, value = $bindable(), options, disabled = false }: Props = $props();
</script>

<label class="field-row">
	<span class="field-copy">
		<span class="field-label">{label}</span>
		{#if hint}<small>{hint}</small>{/if}
	</span>
	<select bind:value {disabled}>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
</label>

<style>
	.field-row { align-items: center; border-bottom: 1px solid var(--border); display: flex; gap: 1rem; justify-content: space-between; padding: .7rem 0; }
	.field-row:last-child { border-bottom: 0; }
	.field-copy { display: grid; flex: 1 1 10rem; gap: .15rem; min-width: 8rem; }
	.field-label { color: var(--foreground); font-size: .85rem; font-weight: 600; word-break: keep-all; }
	small { color: var(--muted-foreground); font-size: .72rem; line-height: 1.4; }
	select { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); flex: 1 1 12rem; font: inherit; font-size: .82rem; max-width: 19rem; min-width: 8rem; padding: .5rem .65rem; }
	select:disabled { cursor: wait; opacity: .55; }
	select:focus-visible { border-color: var(--primary); outline: none; }
	@media (max-width: 560px) {
		.field-row { align-items: stretch; flex-direction: column; gap: .45rem; }
		select { max-width: none; width: 100%; }
	}
</style>
