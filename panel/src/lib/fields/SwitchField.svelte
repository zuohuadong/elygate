<script lang="ts">
	import { SettingsFieldRow, Switch } from '@svadmin/ui';

	interface Props {
		label: string;
		hint?: string;
		checked: boolean;
		disabled?: boolean;
	}
	let { label, hint, checked = $bindable(), disabled = false }: Props = $props();
	const controlId = $props.id();
</script>

<SettingsFieldRow {label} description={hint} {controlId}>
	{#snippet control()}
		<Switch id={controlId} bind:checked {disabled} aria-label={label} />
	{/snippet}
</SettingsFieldRow>
