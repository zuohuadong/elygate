<script lang="ts">
	import {
		relayUsageNumberFields, relayUsageOptions, relayUsagePathFields, relayRuleMessage,
		type RelayUsageDraft, type RelayRuleError,
	} from './relay-rules';

	interface Props { draft: RelayUsageDraft; prefix: string; locale: string; issue: RelayRuleError | null; }
	let { draft = $bindable(), prefix, locale, issue }: Props = $props();
	const uid = $props.id();
	function text(zh: string, en: string): string { return locale === 'zh-CN' ? zh : en; }
	function invalid(key: string): boolean { return issue?.field === `${prefix}.${key}`; }
</script>

<div class="usage-fields">
	{#each relayUsageOptions as field (field.key)}
		<label>{text(field.zh, field.en)}
			<select bind:value={draft[field.key]} data-rule-field={`${prefix}.${field.key}`} aria-invalid={invalid(field.key)} aria-describedby={invalid(field.key) ? `${uid}-${field.key}` : undefined}>
				<option value="">{text('默认 / 继承', 'Default / inherit')}</option>
				{#each field.choices as choice (choice.value)}<option value={choice.value}>{text(choice.zh, choice.en)}</option>{/each}
			</select>
			{#if invalid(field.key) && issue}<span class="field-error" id={`${uid}-${field.key}`}>{relayRuleMessage(issue, locale)}</span>{/if}
		</label>
	{/each}
	{#each relayUsagePathFields as field (field.key)}
		<label>{text(field.zh, field.en)}
			<input bind:value={draft[field.key]} data-rule-field={`${prefix}.${field.key}`} aria-invalid={invalid(field.key)} aria-describedby={invalid(field.key) ? `${uid}-${field.key}` : undefined} />
			{#if invalid(field.key) && issue}<span class="field-error" id={`${uid}-${field.key}`}>{relayRuleMessage(issue, locale)}</span>{/if}
		</label>
	{/each}
	{#each relayUsageNumberFields as field (field.key)}
		<label>{text(field.zh, field.en)}
			<input type="number" min={field.min} step="any" bind:value={draft[field.key]} data-rule-field={`${prefix}.${field.key}`} aria-invalid={invalid(field.key)} aria-describedby={invalid(field.key) ? `${uid}-${field.key}` : undefined} />
			{#if invalid(field.key) && issue}<span class="field-error" id={`${uid}-${field.key}`}>{relayRuleMessage(issue, locale)}</span>{/if}
		</label>
	{/each}
</div>

<style>
	.usage-fields { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); min-width: 0; padding-top: .75rem; }
	label { display: grid; align-content: start; gap: .35rem; font-size: .82rem; font-weight: 600; min-width: 0; }
	input, select { background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); font: inherit; min-height: 44px; min-width: 0; padding: .6rem .7rem; width: 100%; }
	[aria-invalid="true"] { border-color: var(--destructive); }
	.field-error { color: var(--foreground); font-weight: 400; overflow-wrap: anywhere; }
	:where(input, select):focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
	@media (max-width: 600px) { .usage-fields { grid-template-columns: 1fr; } }
</style>
