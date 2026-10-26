<script lang="ts">
	import { useTranslation } from '@svadmin/core/i18n';
	import { validBudgetInput } from '../control-plane-budgets';

	let { daily = $bindable(''), monthly = $bindable(''), disabled = false }:
		{ daily?: string; monthly?: string; disabled?: boolean } = $props();
	const i18n = useTranslation();
	const prefix = $props.id();
	let dailyTouched = $state(false);
	let monthlyTouched = $state(false);
	const dailyInvalid = $derived(dailyTouched && !validBudgetInput(daily));
	const monthlyInvalid = $derived(monthlyTouched && !validBudgetInput(monthly));
	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
</script>

<div class="budget-fields">
	<div class="field">
		<label for={`${prefix}-daily`}>{text('日预算 (USD)', 'Daily budget (USD)')}</label>
		<input id={`${prefix}-daily`} inputmode="decimal" autocomplete="off" bind:value={daily} {disabled}
			placeholder={text('未设置', 'Not set')} onblur={() => dailyTouched = true}
			aria-invalid={dailyInvalid} aria-describedby={dailyInvalid ? `${prefix}-daily-error` : undefined} />
		{#if dailyInvalid}<span id={`${prefix}-daily-error`} class="field-error">{text('请输入大于零的有限金额', 'Enter a finite amount greater than zero')}</span>{/if}
	</div>
	<div class="field">
		<label for={`${prefix}-monthly`}>{text('月预算 (USD)', 'Monthly budget (USD)')}</label>
		<input id={`${prefix}-monthly`} inputmode="decimal" autocomplete="off" bind:value={monthly} {disabled}
			placeholder={text('未设置', 'Not set')} onblur={() => monthlyTouched = true}
			aria-invalid={monthlyInvalid} aria-describedby={monthlyInvalid ? `${prefix}-monthly-error` : undefined} />
		{#if monthlyInvalid}<span id={`${prefix}-monthly-error`} class="field-error">{text('请输入大于零的有限金额', 'Enter a finite amount greater than zero')}</span>{/if}
	</div>
</div>

<style>
	.budget-fields { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.field { display: grid; gap: .35rem; font-size: .85rem; min-width: 0; }
	input { background: var(--background); border: 1px solid var(--border); border-radius: .45rem; color: inherit; font: inherit; min-width: 0; padding: .5rem .6rem; width: 100%; box-sizing: border-box; }
	input[aria-invalid="true"] { border-color: var(--destructive); }
	.field-error { color: var(--destructive); font-size: .8rem; }
	@media (max-width: 600px) { .budget-fields { grid-template-columns: 1fr; } }
</style>
