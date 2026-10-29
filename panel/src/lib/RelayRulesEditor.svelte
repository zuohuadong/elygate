<script lang="ts">
	import { tick } from 'svelte';
	import { Button } from '@svadmin/ui';
	import { ArrowDown, ArrowUp, Plus, Trash2 } from '@lucide/svelte';
	import RelayUsageFields from './RelayUsageFields.svelte';
	import { emptyRelayRoute, relayRouteMethods, relayRuleMessage, type RelayRulesDraft, type RelayRuleError } from './relay-rules';

	interface Props { draft: RelayRulesDraft; locale: string; issue: RelayRuleError | null; onedit: () => void; }
	let { draft = $bindable(), locale, issue, onedit }: Props = $props();
	let root: HTMLDivElement;
	const uid = $props.id();
	function text(zh: string, en: string): string { return locale === 'zh-CN' ? zh : en; }
	function invalid(field: string): boolean { return issue?.field === field; }
	async function focusField(field: string): Promise<void> {
		await tick();
		root.querySelector<HTMLElement>(`[data-rule-field="${field}"]`)?.focus();
	}
	function addRoute(): void {
		onedit();
		draft.routes.push(emptyRelayRoute());
		void focusField(`routes.${draft.routes.length - 1}.path`);
	}
	function moveRoute(index: number, offset: number): void {
		const target = index + offset;
		if (target < 0 || target >= draft.routes.length) return;
		onedit();
		[draft.routes[index], draft.routes[target]] = [draft.routes[target], draft.routes[index]];
		void focusField(`routes.${target}.path`);
	}
	function addHeader(index: number): void {
		onedit();
		draft.routes[index].headers.push({ key: crypto.randomUUID(), name: '', glob: '' });
		void focusField(`routes.${index}.headers.${draft.routes[index].headers.length - 1}.name`);
	}
	function addStreamPath(): void {
		onedit();
		draft.streaming.push({ key: crypto.randomUUID(), path: '' });
		void focusField(`streaming.${draft.streaming.length - 1}.path`);
	}
</script>

<div class="rules-editor" bind:this={root} oninput={onedit} onchange={onedit}>
	<details class="endpoint-usage"><summary>{text('默认用量与计费', 'Default usage and billing')}</summary>
		<RelayUsageFields bind:draft={draft.usage} prefix="usage" {locale} {issue} />
	</details>
	<section aria-labelledby={`${uid}-streaming`}>
		<div class="section-heading"><h3 id={`${uid}-streaming`}>{text('流式路径', 'Streaming paths')}</h3><Button variant="outline" type="button" onclick={addStreamPath}><Plus size={16} aria-hidden="true" />{text('添加路径', 'Add path')}</Button></div>
		{#each draft.streaming as path, index (path.key)}
			<div class="stream-row"><label>{text(`路径 ${index + 1}`, `Path ${index + 1}`)}
				<input bind:value={path.path} data-rule-field={`streaming.${index}.path`} aria-invalid={invalid(`streaming.${index}.path`)} aria-describedby={invalid(`streaming.${index}.path`) ? `${uid}-stream-${index}` : undefined} placeholder="/events/**" />
				{#if invalid(`streaming.${index}.path`) && issue}<span id={`${uid}-stream-${index}`} class="field-error">{relayRuleMessage(issue, locale)}</span>{/if}
			</label><Button variant="ghost" size="icon" type="button" title={text('删除路径', 'Remove path')} aria-label={text(`删除路径 ${index + 1}`, `Remove path ${index + 1}`)} onclick={() => { onedit(); draft.streaming.splice(index, 1); }}><Trash2 size={16} aria-hidden="true" /></Button></div>
		{:else}<p class="empty">{text('未设置强制流式路径', 'No forced streaming paths')}</p>{/each}
	</section>
	<section aria-labelledby={`${uid}-routes`}>
		<div class="section-heading"><h3 id={`${uid}-routes`}>{text('路由（首个匹配优先）', 'Routes (first match wins)')}</h3><Button variant="outline" type="button" onclick={addRoute}><Plus size={16} aria-hidden="true" />{text('添加路由', 'Add route')}</Button></div>
		{#each draft.routes as route, index (route.key)}
			{@const prefix = `routes.${index}`}
			<article class="route" aria-label={text(`路由 ${index + 1}`, `Route ${index + 1}`)}>
				<header><strong>{text(`路由 ${index + 1}`, `Route ${index + 1}`)}</strong><div class="route-actions">
					<Button variant="ghost" size="icon" type="button" title={text('上移', 'Move up')} aria-label={text(`上移路由 ${index + 1}`, `Move route ${index + 1} up`)} disabled={index === 0} onclick={() => moveRoute(index, -1)}><ArrowUp size={16} aria-hidden="true" /></Button>
					<Button variant="ghost" size="icon" type="button" title={text('下移', 'Move down')} aria-label={text(`下移路由 ${index + 1}`, `Move route ${index + 1} down`)} disabled={index === draft.routes.length - 1} onclick={() => moveRoute(index, 1)}><ArrowDown size={16} aria-hidden="true" /></Button>
					<Button variant="ghost" size="icon" type="button" title={text('删除路由', 'Remove route')} aria-label={text(`删除路由 ${index + 1}`, `Remove route ${index + 1}`)} onclick={() => { onedit(); draft.routes.splice(index, 1); }}><Trash2 size={16} aria-hidden="true" /></Button>
				</div></header>
				<div class="match-fields">
					<label>{text('方法', 'Method')}<select bind:value={route.method} data-rule-field={`${prefix}.method`}>{#each relayRouteMethods as method}<option value={method}>{method}</option>{/each}</select></label>
					<label>{text('路径模式', 'Path pattern')}<input bind:value={route.path} data-rule-field={`${prefix}.path`} aria-invalid={invalid(`${prefix}.path`)} aria-describedby={invalid(`${prefix}.path`) ? `${uid}-path-${index}` : undefined} placeholder="/v1/*/run" />{#if invalid(`${prefix}.path`) && issue}<span id={`${uid}-path-${index}`} class="field-error">{relayRuleMessage(issue, locale)}</span>{/if}</label>
				</div>
				<div class="route-options">
					<label>{text('路由状态', 'Route state')}<select bind:value={route.enabled}><option value="">{text('默认启用', 'Enabled by default')}</option><option value="true">{text('启用', 'Enabled')}</option><option value="false">{text('拒绝请求 (404)', 'Refuse requests (404)')}</option></select></label>
					<label>{text('计费', 'Billable')}<select bind:value={route.billable}><option value="">{text('方法默认（仅 POST）', 'Method default (POST only)')}</option><option value="true">{text('计入用量与费用', 'Count and charge')}</option><option value="false">{text('不计入用量与费用', 'Do not count or charge')}</option></select></label>
					<label>{text('传输模式', 'Transport mode')}<select bind:value={route.stream}><option value="">{text('自动', 'Automatic')}</option><option value="true">{text('强制流式', 'Force streaming')}</option><option value="false">{text('强制缓冲', 'Force buffered')}</option></select></label>
				</div>
				<div class="header-matchers">
					<div class="section-heading"><h4>{text('请求头条件', 'Header conditions')}</h4><Button variant="ghost" type="button" onclick={() => addHeader(index)}><Plus size={16} aria-hidden="true" />{text('添加条件', 'Add condition')}</Button></div>
					{#each route.headers as header, headerIndex (header.key)}
						{@const headerPrefix = `${prefix}.headers.${headerIndex}`}
						<div class="header-row">
							<label>{text('请求头名称', 'Header name')}<input bind:value={header.name} data-rule-field={`${headerPrefix}.name`} aria-invalid={invalid(`${headerPrefix}.name`)} aria-describedby={invalid(`${headerPrefix}.name`) ? `${uid}-header-name-${index}-${headerIndex}` : undefined} />{#if invalid(`${headerPrefix}.name`) && issue}<span id={`${uid}-header-name-${index}-${headerIndex}`} class="field-error">{relayRuleMessage(issue, locale)}</span>{/if}</label>
							<label>{text('值模式', 'Value pattern')}<input bind:value={header.glob} data-rule-field={`${headerPrefix}.glob`} aria-invalid={invalid(`${headerPrefix}.glob`)} aria-describedby={invalid(`${headerPrefix}.glob`) ? `${uid}-header-glob-${index}-${headerIndex}` : undefined} />{#if invalid(`${headerPrefix}.glob`) && issue}<span id={`${uid}-header-glob-${index}-${headerIndex}`} class="field-error">{relayRuleMessage(issue, locale)}</span>{/if}</label>
							<Button variant="ghost" size="icon" type="button" title={text('删除条件', 'Remove condition')} aria-label={text(`删除请求头条件 ${headerIndex + 1}`, `Remove header condition ${headerIndex + 1}`)} onclick={() => { onedit(); route.headers.splice(headerIndex, 1); }}><Trash2 size={16} aria-hidden="true" /></Button>
						</div>
					{/each}
				</div>
				<details><summary>{text('用量与计费覆盖', 'Usage and billing overrides')}</summary><RelayUsageFields bind:draft={route.usage} prefix={`${prefix}.usage`} {locale} {issue} /></details>
			</article>
		{:else}<p class="empty">{text('未配置路由', 'No routes configured')}</p>{/each}
	</section>
</div>

<style>
	.rules-editor { display: grid; gap: 1rem; min-width: 0; }
	section, .endpoint-usage { border-top: 1px solid var(--border); padding-top: .85rem; min-width: 0; }
	.section-heading, .route > header, .route-actions { align-items: center; display: flex; gap: .5rem; }
	.section-heading, .route > header { justify-content: space-between; }
	h3, h4 { font-size: .9rem; font-weight: 600; margin: 0; }
	.route { border: 1px solid var(--border); border-radius: 6px; display: grid; gap: .85rem; margin-top: .75rem; min-width: 0; padding: .85rem; }
	.route > header strong { font-size: .85rem; }
	label { align-content: start; display: grid; gap: .35rem; font-size: .82rem; font-weight: 600; min-width: 0; }
	input, select { background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); font: inherit; min-height: 44px; min-width: 0; padding: .6rem .7rem; width: 100%; }
	.match-fields { display: grid; gap: .75rem; grid-template-columns: 110px minmax(0, 1fr); }
	.route-options { display: grid; gap: .75rem; grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.header-row { align-items: start; display: grid; gap: .5rem; grid-template-columns: repeat(2, minmax(0, 1fr)) 40px; margin-top: .5rem; }
	.header-row :global(button) { margin-top: 1.4rem; }
	.stream-row { display: grid; align-items: start; gap: .5rem; grid-template-columns: minmax(0, 1fr) 40px; margin-top: .5rem; }
	.stream-row :global(button) { margin-top: 1.4rem; }
	.empty { color: var(--muted-foreground); font-size: .85rem; margin: .75rem 0 0; }
	summary { cursor: pointer; font-size: .85rem; font-weight: 600; min-height: 36px; padding: .4rem 0; }
	.field-error { font-weight: 400; overflow-wrap: anywhere; }
	[aria-invalid="true"] { border-color: var(--destructive); }
	:where(input, select, summary):focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
	@media (max-width: 600px) {
		.route-options, .match-fields { grid-template-columns: 1fr; }
		.header-row { grid-template-columns: minmax(0, 1fr) 40px; }
		.header-row label:first-child { grid-column: 1 / -1; }
		.route { padding: .65rem; }
		.section-heading { flex-wrap: wrap; }
	}
	@media (pointer: coarse) { .rules-editor :global(button) { min-height: 44px; min-width: 44px; } }
</style>
