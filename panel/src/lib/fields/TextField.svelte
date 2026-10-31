<script lang="ts">
	import { Input, SettingsFieldRow } from '@svadmin/ui';

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
	const controlId = $props.id();
</script>

<SettingsFieldRow {label} description={hint} {controlId}>
	{#snippet control()}
		<Input id={controlId} type={secret ? 'password' : 'text'} bind:value {placeholder} {autocomplete} {disabled} spellcheck="false" />
	{/snippet}
</SettingsFieldRow>
