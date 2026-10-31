<script lang="ts">
	import { Select, SettingsFieldRow } from '@svadmin/ui';

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
	const controlId = $props.id();
</script>

<SettingsFieldRow {label} description={hint} {controlId}>
	{#snippet control()}
		<Select id={controlId} bind:value {disabled}>
			{#each options as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</Select>
	{/snippet}
</SettingsFieldRow>
