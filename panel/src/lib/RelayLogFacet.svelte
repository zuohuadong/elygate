<script lang="ts">
	import { useTranslation } from '@svadmin/core/i18n';
	import { ChevronDown, RefreshCw, X } from '@lucide/svelte';
	import { isJsonRecord, requestJson } from './api';
	import { displayError } from './forms';

	interface Option { id: string; name: string; }
	interface Props { label: string; dimension?: string; options?: Option[]; selected: string[]; }
	let { label, dimension, options = [], selected = $bindable() }: Props = $props();
	const i18n = useTranslation();
	let open = $state(false);
	let disclosure = $state<HTMLDetailsElement>();
	let query = $state('');
	let remoteOptions = $state.raw<Option[]>([]);
	let rememberedOptions = $state.raw<Option[]>([]);
	let loading = $state(false);
	let error = $state('');
	let retry = $state(0);
	const available = $derived(dimension ? remoteOptions : options.filter((option) => option.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
	const visible = $derived([...rememberedOptions.filter((option) => selected.includes(option.id) && !available.some((candidate) => candidate.id === option.id)), ...available]);
	function text(zh: string, en: string): string { return i18n.locale === 'zh-CN' ? zh : en; }
	function parseOptions(payload: unknown): Option[] {
		if (!isJsonRecord(payload)) throw new Error(text('筛选项响应无效。', 'Invalid filter options response.'));
		const entries = payload[dimension!];
		if (entries === undefined || entries === null) return [];
		if (!Array.isArray(entries)) throw new Error(text('筛选项响应无效。', 'Invalid filter options response.'));
		return entries.map((entry) => {
			if (typeof entry === 'string') return { id: entry, name: entry };
			if (!isJsonRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') throw new Error(text('筛选项响应无效。', 'Invalid filter options response.'));
			return { id: entry.id, name: entry.name || entry.id };
		}).filter((option) => option.id);
	}
	async function load(search: string, controller: AbortController): Promise<void> {
		try {
			const params = new URLSearchParams({ dimensions: dimension!, q: search });
			const payload = await requestJson<unknown>(`/api/relay-logs/filterdata?${params}`, { signal: controller.signal });
			if (!controller.signal.aborted) remoteOptions = parseOptions(payload);
		} catch (cause) {
			if (!controller.signal.aborted) { remoteOptions = []; error = displayError(cause, text('筛选项加载失败。', 'Unable to load filter options.')); }
		} finally {
			if (!controller.signal.aborted) loading = false;
		}
	}
	function toggleOption(option: Option, checked: boolean): void {
		selected = checked ? [...new Set([...selected, option.id])] : selected.filter((id) => id !== option.id);
		rememberedOptions = [...rememberedOptions.filter((saved) => saved.id !== option.id), option];
	}
	function closeOnEscape(event: KeyboardEvent): void {
		if (!open || event.key !== 'Escape' || !(event.target instanceof Node) || !disclosure?.contains(event.target)) return;
		event.preventDefault();
		open = false;
		disclosure.querySelector('summary')?.focus();
	}
	$effect(() => {
		if (!open || !dimension) return;
		const search = query.trim();
		retry;
		const controller = new AbortController();
		loading = true; error = '';
		const timer = window.setTimeout(() => void load(search, controller), 200);
		return () => { window.clearTimeout(timer); controller.abort(); };
	});
</script>

<svelte:window onkeydown={closeOnEscape} />
<details class="facet" bind:open bind:this={disclosure}>
	<summary><span>{label}{selected.length ? ` (${selected.length})` : ''}</span><ChevronDown size={14} aria-hidden="true" style="flex-shrink: 0;" /></summary>
	<div class="facet-options">
		<div class="facet-tools">
			<label><span>{text('搜索', 'Search')} {label}</span><input bind:value={query} type="search" /></label>
			<button type="button" title={text('清除', 'Clear')} aria-label={`${text('清除', 'Clear')} ${label}`} onclick={() => { selected = []; rememberedOptions = []; }} disabled={!selected.length}><X size={16} aria-hidden="true" /></button>
		</div>
		{#if error}<div class="facet-error" role="alert">{error}<button type="button" title={text('重试', 'Retry')} aria-label={`${text('重试', 'Retry')} ${label}`} onclick={() => retry += 1}><RefreshCw size={16} aria-hidden="true" /></button></div>{/if}
		<div class="choices" aria-busy={loading}>
			{#each visible as option (option.id)}
				<label class="choice"><input type="checkbox" checked={selected.includes(option.id)} onchange={(event) => toggleOption(option, event.currentTarget.checked)} /><span>{option.name}</span></label>
			{:else}<p role="status">{loading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</p>{/each}
		</div>
	</div>
</details>

<style>
	.facet { min-width: 0; }
	summary { align-items: center; background: var(--background); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; display: flex; font-size: .8rem; gap: .4rem; justify-content: space-between; min-height: 42px; padding: .55rem .65rem; }
	summary span { min-width: 0; overflow-wrap: anywhere; }
	.facet-options { border-bottom: 1px solid var(--border); padding: .55rem 0; }
	.facet-tools, .facet-error { align-items: end; display: flex; gap: .4rem; }
	label { display: grid; flex: 1; font-size: .75rem; gap: .3rem; min-width: 0; }
	input[type="search"] { background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); font: inherit; min-height: 42px; min-width: 0; padding: .5rem; width: 100%; }
	button { align-items: center; background: var(--muted); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); cursor: pointer; display: flex; flex-shrink: 0; height: 42px; justify-content: center; width: 42px; }
	button:disabled { opacity: .5; }
	.choices { max-height: 12rem; overflow-y: auto; padding: .4rem 0; }
	.choice { align-items: center; display: flex; font-size: .8rem; font-weight: 400; gap: .5rem; min-height: 36px; padding: .3rem .2rem; }
	.choice input { flex: 0 0 auto; height: 16px; width: 16px; } .choice span { min-width: 0; overflow-wrap: anywhere; }
	p { color: var(--muted-foreground); font-size: .8rem; margin: .5rem 0; }
	.facet-error { color: var(--destructive); font-size: .8rem; overflow-wrap: anywhere; padding-top: .4rem; }
	@media (max-width: 560px) { input[type="search"] { font-size: 16px; } .choice { min-height: 44px; } }
</style>
