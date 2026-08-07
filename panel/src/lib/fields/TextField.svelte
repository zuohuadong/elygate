<script lang="ts">
	interface Props {
		label: string;
		hint?: string;
		value: string;
		secret?: boolean;
		placeholder?: string;
		autocomplete?: 'username' | 'new-password' | 'off';
		disabled?: boolean;
	}
	let { label, hint, value = $bindable(), secret = false, placeholder = '', autocomplete, disabled = false }: Props = $props();
</script>

<label class="field-row">
	<span class="field-copy">
		<span class="field-label">{label}</span>
		{#if hint}<small>{hint}</small>{/if}
	</span>
	{#if secret}
		<input type="password" bind:value {placeholder} {autocomplete} {disabled} spellcheck="false" />
	{:else}
		<input type="text" bind:value {placeholder} {autocomplete} {disabled} spellcheck="false" />
	{/if}
</label>

<style>
	.field-row { align-items: center; border-bottom: 1px solid var(--border); display: flex; gap: 1rem; justify-content: space-between; padding: .7rem 0; }
	.field-row:last-child { border-bottom: 0; }
	.field-copy { display: grid; flex: 1 1 10rem; gap: .15rem; min-width: 8rem; }
	.field-label { color: var(--foreground); font-size: .85rem; font-weight: 600; word-break: keep-all; }
	small { color: var(--muted-foreground); font-size: .72rem; line-height: 1.4; }
	input { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); flex: 1 1 12rem; font: inherit; font-size: .82rem; max-width: 19rem; min-width: 8rem; padding: .5rem .65rem; width: 100%; }
	input:disabled { cursor: wait; opacity: .55; }
	input:focus-visible { border-color: var(--primary); outline: none; }
	@media (max-width: 560px) {
		.field-row { align-items: stretch; flex-direction: column; gap: .45rem; }
		input { max-width: none; }
	}
</style>
