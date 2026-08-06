<script lang="ts">
	interface Props {
		label: string;
		hint?: string;
		checked: boolean;
		disabled?: boolean;
	}
	let { label, hint, checked = $bindable(), disabled = false }: Props = $props();
</script>

<label class="field-row">
	<span class="field-copy">
		<span class="field-label">{label}</span>
		{#if hint}<small>{hint}</small>{/if}
	</span>
	<input type="checkbox" role="switch" bind:checked {disabled} />
</label>

<style>
	.field-row { align-items: center; border-bottom: 1px solid var(--border); display: flex; gap: 1rem; justify-content: space-between; padding: .7rem 0; }
	.field-row:last-child { border-bottom: 0; }
	.field-copy { display: grid; gap: .15rem; min-width: 0; }
	.field-label { color: var(--foreground); font-size: .85rem; font-weight: 600; }
	small { color: var(--muted-foreground); font-size: .72rem; line-height: 1.4; }
	input {
		appearance: none;
		background: var(--muted);
		border: 1px solid var(--border);
		border-radius: 999px;
		cursor: pointer;
		flex: none;
		height: 1.35rem;
		position: relative;
		transition: background-color .15s ease;
		width: 2.5rem;
	}
	input::after {
		background: var(--background);
		border-radius: 50%;
		box-shadow: 0 1px 2px rgb(0 0 0 / .2);
		content: '';
		height: 1rem;
		left: .15rem;
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		transition: translate .15s ease;
		width: 1rem;
	}
	input:checked { background: var(--primary); border-color: var(--primary); }
	input:checked::after { translate: 1.13rem 0; }
	input:disabled { cursor: wait; opacity: .55; }
	input:focus-visible { outline: 2px solid var(--ring, var(--primary)); outline-offset: 2px; }
</style>
