<script lang="ts">
	import { onMount } from 'svelte';
	import { Plus, Trash2, Search, ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { Button } from '@svadmin/ui';
	import { getListPayload, getTotal, requestJson } from './api';
	import { displayError } from './forms';
	import type { ElygateLocale } from './i18n';
	interface Props { names: string[]; locale: ElygateLocale; disabled: boolean; }
	let { names = $bindable(), locale, disabled }: Props = $props();
	let search = $state('');
	let options = $state<string[]>([]);
	let selected = $state('');
	let page = $state(1);
	let total = $state(0);
	let busy = $state(false);
	let error = $state('');
	let sequence = 0;
	const size = 25;
	function text(zh: string, en: string): string { return locale === 'zh-CN' ? zh : en; }
	async function load(): Promise<void> {
		const current = ++sequence;
		busy = true; error = '';
		try {
			const query = new URLSearchParams({ limit: String(size), offset: String((page - 1) * size), search });
			const payload = await requestJson<unknown>(`/api/relays?${query}`);
			if (current !== sequence) return;
			options = getListPayload(payload).map((item) => item.name).filter((name): name is string => typeof name === 'string');
			total = getTotal(payload, options.length);
			selected = '';
		} catch (cause) {
			if (current === sequence) { options = []; error = displayError(cause, text('无法读取 Relay 端点。', 'Unable to load relay endpoints.')); }
		} finally { if (current === sequence) busy = false; }
	}
	onMount(() => { void load(); return () => { sequence += 1; }; });
</script>

<fieldset disabled={disabled} class="relay-grants">
	<legend>{text('Relay 授权', 'Relay grants')}</legend>
	{#each names as name (name)}
		<div class="grant"><code>{name}</code><Button variant="ghost" size="icon" type="button" title={text('移除授权', 'Remove grant')} aria-label={`${text('移除授权', 'Remove grant')} ${name}`} onclick={() => names = names.filter((entry) => entry !== name)}><Trash2 size={16} aria-hidden="true" /></Button></div>
	{:else}<p>{text('未授权任何 Relay。', 'No relays authorized.')}</p>{/each}
	{#if error}<p role="alert">{error}</p>{/if}
	<div class="lookup">
		<label>{text('搜索 Relay', 'Search relays')}<input bind:value={search} /></label>
		<Button type="button" variant="outline" title={text('搜索', 'Search')} aria-label={text('搜索 Relay', 'Search relays')} disabled={busy} onclick={() => { page = 1; void load(); }}><Search size={16} aria-hidden="true" /></Button>
	</div>
	<div class="lookup">
		<label>{text('Relay 端点', 'Relay endpoint')}<select bind:value={selected} disabled={busy}><option value="">{text('选择端点', 'Select endpoint')}</option>{#each options.filter((name) => !names.includes(name)) as name (name)}<option value={name}>{name}</option>{/each}</select></label>
		<Button type="button" variant="outline" disabled={!selected || busy} onclick={() => { if (!names.includes(selected)) names = [...names, selected]; selected = ''; }}><Plus size={16} aria-hidden="true" />{text('授权', 'Grant')}</Button>
	</div>
	<div class="pages"><span>{page} / {Math.max(1, Math.ceil(total / size))}</span><Button type="button" variant="ghost" size="icon" title={text('上一页', 'Previous')} aria-label={text('上一页 Relay', 'Previous relays')} disabled={busy || page <= 1} onclick={() => { page -= 1; void load(); }}><ChevronLeft size={16} aria-hidden="true" /></Button><Button type="button" variant="ghost" size="icon" title={text('下一页', 'Next')} aria-label={text('下一页 Relay', 'Next relays')} disabled={busy || page * size >= total} onclick={() => { page += 1; void load(); }}><ChevronRight size={16} aria-hidden="true" /></Button></div>
</fieldset>

<style>
	.relay-grants { border: 0; border-top: 1px solid var(--border); display: grid; gap: .6rem; min-width: 0; padding: .85rem 0; }
	legend { font-size: .85rem; font-weight: 600; } p { color: var(--muted-foreground); font-size: .8rem; margin: .25rem 0; } p[role="alert"] { color: var(--foreground); }
	.grant, .pages, .lookup { align-items: center; display: flex; gap: .5rem; min-width: 0; } .grant { justify-content: space-between; border-bottom: 1px solid var(--border); } code { overflow-wrap: anywhere; } .lookup { align-items: end; } .lookup label { display: grid; flex: 1; gap: .3rem; font-size: .8rem; min-width: 0; }
	input, select { background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); font: inherit; min-height: 44px; min-width: 0; padding: .5rem; width: 100%; } .pages { justify-content: end; font-size: .8rem; }
</style>
