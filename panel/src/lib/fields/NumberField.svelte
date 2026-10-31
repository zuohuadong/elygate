<script lang="ts">
	import { Input, SettingsFieldRow } from '@svadmin/ui';

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
	const controlId = $props.id();
</script>

<SettingsFieldRow {label} description={hint} {controlId}>
	{#snippet control()}
		<Input id={controlId} type="number" bind:value {min} {max} {step} {disabled} />
	{/snippet}
</SettingsFieldRow>
