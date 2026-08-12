<script lang="ts">
	import { onMount } from 'svelte';
	import { useTranslation } from '@svadmin/core/i18n';
	import { displayError, parseJsonObject, prettyJson } from '../lib/forms';
	import { getListPayload, isJsonRecord, requestJson, type JsonRecord } from '../lib/api';

	interface Props { resourceName: string; }
	interface TargetForm { provider: string; model: string; key_id: string; weight: number; }
	interface RuleForm { name: string; description: string; enabled: boolean; chainRule: boolean; celExpression: string; scope: string; scopeId: string; priority: number; targets: TargetForm[]; fallbacks: string[]; query: string; }

	let { resourceName: _resourceName }: Props = $props();
	const i18n = useTranslation();
	let rules = $state.raw<JsonRecord[]>([]);
	let providers = $state.raw<JsonRecord[]>([]);
	let editing = $state.raw<JsonRecord | null>(null);
	let form = $state<RuleForm>(emptyForm());
	let isOpen = $state(false);
	let isLoading = $state(true);
	let isSaving = $state(false);
	let viewMode = $state<'list' | 'tree'>('list');
	let error = $state('');
	let notice = $state('');

	const sortedRules = $derived([...rules].sort((left, right) => Number(left.priority ?? 0) - Number(right.priority ?? 0)));
	const totalWeight = $derived(form.targets.reduce((total, target) => total + Number(target.weight || 0), 0));

	function emptyForm(): RuleForm {
		return { name: '', description: '', enabled: true, chainRule: false, celExpression: 'true', scope: 'global', scopeId: '', priority: 0, targets: [{ provider: '', model: '', key_id: '', weight: 1 }], fallbacks: [], query: '{}' };
	}

	function stringValue(record: JsonRecord, key: string): string { return typeof record[key] === 'string' ? String(record[key]) : ''; }

	function targetForms(value: unknown): TargetForm[] {
		if (!Array.isArray(value)) return [{ provider: '', model: '', key_id: '', weight: 1 }];
		const targets = value.filter(isJsonRecord).map((item) => ({ provider: stringValue(item, 'provider'), model: stringValue(item, 'model'), key_id: stringValue(item, 'key_id'), weight: Number(item.weight ?? 0) }));
		return targets.length ? targets : [{ provider: '', model: '', key_id: '', weight: 1 }];
	}

	async function load(): Promise<void> {
		isLoading = true;
		error = '';
		try {
			const [rulesPayload, providersPayload] = await Promise.all([
				requestJson('/api/governance/routing-rules?limit=100'),
				requestJson('/api/providers'),
			]);
			rules = getListPayload(rulesPayload);
			providers = getListPayload(providersPayload);
		} catch (cause) { error = displayError(cause, i18n.t('elygate.loadFailed')); }
		finally { isLoading = false; }
	}

	function openCreate(): void { editing = null; form = emptyForm(); isOpen = true; error = ''; }

	function openEdit(rule: JsonRecord): void {
		editing = rule;
		form = {
			name: stringValue(rule, 'name'), description: stringValue(rule, 'description'), enabled: rule.enabled !== false,
			chainRule: rule.chain_rule === true, celExpression: stringValue(rule, 'cel_expression') || 'true', scope: stringValue(rule, 'scope') || 'global',
			scopeId: stringValue(rule, 'scope_id'), priority: Number(rule.priority ?? 0), targets: targetForms(rule.targets),
			fallbacks: Array.isArray(rule.fallbacks) ? rule.fallbacks.filter((item): item is string => typeof item === 'string') : [], query: prettyJson(rule.query, '{}'),
		};
		isOpen = true;
		error = '';
	}

	function addTarget(): void { form.targets = [...form.targets, { provider: '', model: '', key_id: '', weight: 0 }]; }
	function removeTarget(index: number): void { if (form.targets.length > 1) form.targets = form.targets.filter((_, itemIndex) => itemIndex !== index); }
	function toggleFallback(id: string): void { form.fallbacks = form.fallbacks.includes(id) ? form.fallbacks.filter((item) => item !== id) : [...form.fallbacks, id]; }

	async function save(): Promise<void> {
		isSaving = true;
		error = '';
		try {
			if (!form.name.trim()) throw new Error(i18n.t('elygate.required').replace('{field}', i18n.t('elygate.name')));
			if (form.scope !== 'global' && !form.scopeId.trim()) throw new Error(i18n.t('elygate.scopeIdRequired'));
			if (form.targets.some((target) => target.weight <= 0)) throw new Error(i18n.t('elygate.targetWeightPositive'));
			if (Math.abs(totalWeight - 1) > .000001) throw new Error(i18n.t('elygate.targetWeightSum'));
			const payload = {
				name: form.name.trim(), description: form.description.trim(), enabled: form.enabled, chain_rule: form.chainRule,
				cel_expression: form.celExpression.trim(), scope: form.scope, scope_id: form.scope === 'global' ? null : form.scopeId.trim(), priority: form.priority,
				targets: form.targets.map((target) => ({ provider: target.provider.trim() || undefined, model: target.model.trim() || undefined, key_id: target.key_id.trim() || undefined, weight: target.weight })),
				fallbacks: form.fallbacks, query: parseJsonObject(form.query, i18n.t('elygate.queryBuilder'), i18n.t('elygate.invalidJson')),
			};
			const path = editing ? `/api/governance/routing-rules/${encodeURIComponent(String(editing.id))}` : '/api/governance/routing-rules';
			await requestJson(path, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
			isOpen = false;
			notice = i18n.t('elygate.saveSuccess');
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
		finally { isSaving = false; }
	}

	async function toggleEnabled(rule: JsonRecord): Promise<void> {
		try {
			await requestJson(`/api/governance/routing-rules/${encodeURIComponent(String(rule.id))}`, { method: 'PUT', body: JSON.stringify({ enabled: rule.enabled === false }) });
			await load();
		} catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
	}

	async function remove(rule: JsonRecord): Promise<void> {
		if (!window.confirm(i18n.t('elygate.confirmDelete'))) return;
		try { await requestJson(`/api/governance/routing-rules/${encodeURIComponent(String(rule.id))}`, { method: 'DELETE' }); await load(); }
		catch (cause) { error = displayError(cause, i18n.t('elygate.operationFailed')); }
	}

	onMount(() => { void load(); });
</script>

<section class="page-shell">
	<header class="page-heading"><div><p class="eyebrow">Elygate / Governance</p><h1>{i18n.t('elygate.routingRules')}</h1><p>{viewMode === 'tree' ? i18n.t('elygate.routingTreeHint') : i18n.t('elygate.routingRulesStructuredHint')}</p></div><div class="heading-actions"><div class="view-switch"><button type="button" class:is-active={viewMode === 'list'} onclick={() => (viewMode = 'list')}>{i18n.t('elygate.tableView')}</button><button type="button" class:is-active={viewMode === 'tree'} onclick={() => (viewMode = 'tree')}>{i18n.t('elygate.treeView')}</button></div><button class="primary" type="button" onclick={openCreate}>{i18n.t('elygate.create')}</button></div></header>
	{#if error}<div class="notice error" role="alert">{error}</div>{/if}{#if notice}<div class="notice success" role="status">{notice}</div>{/if}
	{#if viewMode === 'list'}
		<div class="rule-list" aria-busy={isLoading}>
			{#each sortedRules as rule, index (String(rule.id))}
				<article class:disabled={rule.enabled === false}><div class="priority"><span>{index + 1}</span><small>P{Number(rule.priority ?? 0)}</small></div><div class="rule-main"><header><div><h2>{String(rule.name)}</h2><span>{String(rule.scope ?? 'global')}{rule.scope_id ? ` / ${String(rule.scope_id)}` : ''}</span></div><code>{String(rule.cel_expression || 'true')}</code></header><div class="targets">{#each Array.isArray(rule.targets) ? rule.targets.filter(isJsonRecord) : [] as target, targetIndex (targetIndex)}<span>{String(target.provider ?? '*')} / {String(target.model ?? '*')} · {(Number(target.weight ?? 0) * 100).toFixed(0)}%</span>{/each}</div>{#if Array.isArray(rule.fallbacks) && rule.fallbacks.length}<p>↳ {i18n.t('elygate.fallbacks')}: {rule.fallbacks.map((id) => String(rules.find((item) => item.id === id)?.name ?? id)).join(' → ')}</p>{/if}</div><div class="row-actions"><button type="button" onclick={() => void toggleEnabled(rule)}>{rule.enabled === false ? i18n.t('elygate.enable') : i18n.t('elygate.disable')}</button><button type="button" onclick={() => openEdit(rule)}>{i18n.t('elygate.edit')}</button><button class="danger" type="button" onclick={() => void remove(rule)}>{i18n.t('elygate.delete')}</button></div></article>
			{:else}<p>{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</p>{/each}
		</div>
	{:else}
		<div class="tree-canvas" aria-busy={isLoading}>
			<div class="source-node"><span>HTTP / MCP</span><strong>{i18n.t('elygate.requestEntry')}</strong></div>
			{#each sortedRules as rule, index (String(rule.id))}
				<div class="flow-arrow" aria-hidden="true"><span>{index === 0 ? i18n.t('elygate.evaluate') : i18n.t('elygate.noMatch')}</span>↓</div>
				<article class="tree-node" class:disabled={rule.enabled === false}>
					<header><div><small>P{Number(rule.priority ?? 0)} · {String(rule.scope ?? 'global')}</small><h2>{String(rule.name)}</h2></div><button type="button" onclick={() => openEdit(rule)}>{i18n.t('elygate.edit')}</button></header>
					<code>{String(rule.cel_expression || 'true')}</code>
					<div class="branch-grid">
						<div class="match-branch"><span>✓ {i18n.t('elygate.matchedTargets')}</span>{#each Array.isArray(rule.targets) ? rule.targets.filter(isJsonRecord) : [] as target, targetIndex (targetIndex)}<strong>{String(target.provider ?? '*')} / {String(target.model ?? '*')} <small>{(Number(target.weight ?? 0) * 100).toFixed(0)}%</small></strong>{/each}</div>
						<div class="fallback-branch"><span>↳ {i18n.t('elygate.fallbacks')}</span>{#if Array.isArray(rule.fallbacks) && rule.fallbacks.length}{#each rule.fallbacks as fallbackId (String(fallbackId))}<strong>{String(rules.find((item) => item.id === fallbackId)?.name ?? fallbackId)}</strong>{/each}{:else}<small>{rule.chain_rule === true ? i18n.t('elygate.continueEvaluation') : i18n.t('elygate.terminalRule')}</small>{/if}</div>
					</div>
				</article>
			{:else}<p>{isLoading ? i18n.t('elygate.loading') : i18n.t('elygate.empty')}</p>{/each}
		</div>
	{/if}
</section>

{#if isOpen}
	<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><header><h2>{editing ? i18n.t('elygate.edit') : i18n.t('elygate.create')} {i18n.t('elygate.routingRules')}</h2><button type="button" onclick={() => (isOpen = false)}>{i18n.t('elygate.close')}</button></header><form onsubmit={(event) => { event.preventDefault(); void save(); }}>
		<div class="form-grid"><label>{i18n.t('elygate.name')}<input bind:value={form.name} /></label><label>{i18n.t('elygate.priority')}<input type="number" bind:value={form.priority} /></label><label class="wide">{i18n.t('elygate.description')}<input bind:value={form.description} /></label><label>{i18n.t('elygate.scope')}<select bind:value={form.scope}><option value="global">global</option><option value="team">team</option><option value="customer">customer</option><option value="virtual_key">virtual_key</option><option value="user">user</option></select></label>{#if form.scope !== 'global'}<label>{i18n.t('elygate.scopeId')}<input bind:value={form.scopeId} /></label>{/if}<label class="switch"><input type="checkbox" bind:checked={form.enabled} />{i18n.t('elygate.enabled')}</label><label class="switch"><input type="checkbox" bind:checked={form.chainRule} />{i18n.t('elygate.chainRule')}</label></div>
		<label>{i18n.t('elygate.celExpression')}<textarea bind:value={form.celExpression} rows="4"></textarea><small>{i18n.t('elygate.celExamples')}</small></label>
		<section><div class="section-heading"><h3>{i18n.t('elygate.routingTargets')} · {(totalWeight * 100).toFixed(0)}%</h3><button type="button" onclick={addTarget}>{i18n.t('elygate.addTarget')}</button></div>{#each form.targets as target, index (index)}<div class="target-row"><label>{i18n.t('elygate.provider')}<select bind:value={target.provider}><option value="">*</option>{#each providers as item (String(item.name))}<option value={String(item.name)}>{String(item.name)}</option>{/each}</select></label><label>{i18n.t('elygate.model')}<input bind:value={target.model} /></label><label>{i18n.t('elygate.keyId')}<input bind:value={target.key_id} /></label><label>{i18n.t('elygate.weight')}<input type="number" min="0" max="1" step="any" bind:value={target.weight} /></label><button type="button" onclick={() => removeTarget(index)}>×</button></div>{/each}</section>
		<section><h3>{i18n.t('elygate.fallbacks')}</h3><div class="fallback-grid">{#each rules.filter((rule) => rule.id !== editing?.id) as rule (String(rule.id))}<label><input type="checkbox" checked={form.fallbacks.includes(String(rule.id))} onchange={() => toggleFallback(String(rule.id))} />{String(rule.name)}</label>{/each}</div></section>
		<label>{i18n.t('elygate.queryBuilder')} JSON<textarea bind:value={form.query} rows="7"></textarea></label><footer><button type="button" onclick={() => (isOpen = false)}>{i18n.t('elygate.cancel')}</button><button class="primary" type="submit" disabled={isSaving}>{i18n.t('elygate.save')}</button></footer>
	</form></div></div>
{/if}

<style>
	.page-shell { max-width: 1180px; margin: 0 auto; padding: 1.5rem; }
	.page-heading, .heading-actions, .modal > header, .section-heading, footer { align-items: center; display: flex; gap: .6rem; justify-content: space-between; }
	.page-heading { align-items: start; margin-bottom: 1rem; }
	.eyebrow { color: var(--primary); font-size: .75rem; font-weight: 700; letter-spacing: .12em; margin: 0 0 .4rem; text-transform: uppercase; }
	h1, h2, h3 { margin: 0; } .page-heading p, .rule-main p, small { color: var(--muted-foreground); }
	button { background: var(--muted); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); cursor: pointer; font-weight: 650; padding: .5rem .65rem; }
	button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); } button.danger { color: var(--destructive); }
	.view-switch { background: var(--muted); border: 1px solid var(--border); border-radius: .6rem; display: flex; padding: .2rem; }
	.view-switch button { background: transparent; border: 0; }
	.view-switch button.is-active { background: var(--card); box-shadow: 0 1px 3px rgb(0 0 0 / .12); }
	.rule-list { display: grid; gap: .65rem; }
	.rule-list article { align-items: start; background: var(--card); border: 1px solid var(--border); border-radius: .8rem; display: grid; gap: .8rem; grid-template-columns: 54px 1fr auto; padding: .8rem; }
	.rule-list article.disabled { opacity: .55; }
	.priority { align-items: center; display: grid; justify-items: center; }
	.priority span { align-items: center; background: var(--primary); border-radius: 50%; color: var(--primary-foreground); display: flex; height: 2rem; justify-content: center; width: 2rem; }
	.rule-main header { align-items: start; display: flex; justify-content: space-between; }
	.rule-main header span { color: var(--muted-foreground); font-size: .72rem; }
	.rule-main code { background: var(--muted); border-radius: .4rem; max-width: 50%; overflow: hidden; padding: .35rem .5rem; text-overflow: ellipsis; white-space: nowrap; }
	.targets { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .55rem; }
	.targets span { background: var(--muted); border-radius: 999px; font-size: .75rem; padding: .3rem .5rem; }
	.row-actions { display: flex; gap: .35rem; }
	.tree-canvas { background-image: radial-gradient(color-mix(in oklch, var(--border) 70%, transparent) 1px, transparent 1px); background-size: 18px 18px; border: 1px solid var(--border); border-radius: .9rem; display: grid; justify-items: center; min-height: 420px; overflow: auto; padding: 1.5rem; }
	.source-node { background: var(--foreground); border-radius: .8rem; color: var(--background); display: grid; min-width: 220px; padding: .75rem 1rem; text-align: center; }
	.source-node span { font-size: .7rem; opacity: .7; }
	.flow-arrow { align-items: center; color: var(--muted-foreground); display: grid; font-size: 1.35rem; justify-items: center; min-height: 3.5rem; }
	.flow-arrow span { background: var(--background); border: 1px solid var(--border); border-radius: 999px; font-size: .65rem; padding: .15rem .45rem; }
	.tree-node { background: var(--card); border: 2px solid color-mix(in oklch, var(--primary) 45%, var(--border)); border-radius: .9rem; box-shadow: 0 8px 28px rgb(0 0 0 / .08); max-width: 820px; padding: .85rem; width: min(820px, 100%); }
	.tree-node.disabled { filter: grayscale(.8); opacity: .55; }
	.tree-node header { align-items: center; display: flex; justify-content: space-between; }
	.tree-node header small { display: block; font-size: .68rem; }
	.tree-node code { background: var(--muted); border-radius: .45rem; display: block; margin-top: .65rem; overflow-wrap: anywhere; padding: .55rem; white-space: pre-wrap; }
	.branch-grid { display: grid; gap: .65rem; grid-template-columns: 1fr 1fr; margin-top: .65rem; }
	.match-branch, .fallback-branch { border: 1px solid var(--border); border-radius: .6rem; display: flex; flex-wrap: wrap; gap: .35rem; padding: .6rem; }
	.match-branch > span, .fallback-branch > span { color: var(--muted-foreground); flex-basis: 100%; font-size: .7rem; font-weight: 700; text-transform: uppercase; }
	.match-branch strong, .fallback-branch strong { background: var(--muted); border-radius: .4rem; font-size: .75rem; padding: .3rem .45rem; }
	.notice { border-radius: .65rem; margin-bottom: .8rem; padding: .7rem .85rem; }
	.notice.error { background: color-mix(in oklch, var(--destructive) 10%, transparent); color: var(--destructive); } .notice.success { background: color-mix(in oklch, var(--primary) 12%, transparent); color: var(--primary); }
	.modal-backdrop { align-items: center; background: rgb(0 0 0 / .45); display: flex; inset: 0; justify-content: center; padding: 1rem; position: fixed; z-index: 100; }
	.modal { background: var(--card); border: 1px solid var(--border); border-radius: .9rem; max-height: calc(100vh - 2rem); max-width: 1040px; overflow: auto; padding: 1rem; width: 100%; }
	.modal form, .modal label { display: grid; gap: .4rem; }
	.modal form { gap: .8rem; margin-top: .8rem; }
	.form-grid { display: grid; gap: .65rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-grid .wide { grid-column: 1 / -1; }
	label { font-size: .8rem; font-weight: 650; }
	label.switch { align-items: center; display: flex; }
	input, select, textarea { background: var(--background); border: 1px solid var(--border); border-radius: .5rem; color: var(--foreground); padding: .58rem; }
	textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	.modal section { border: 1px solid var(--border); border-radius: .65rem; padding: .7rem; }
	.target-row { align-items: end; display: grid; gap: .5rem; grid-template-columns: 1fr 1fr 1fr 100px auto; margin-top: .5rem; }
	.fallback-grid { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .5rem; }
	.fallback-grid label { align-items: center; display: flex; }
	@media (max-width: 760px) { .page-heading, .rule-main header { flex-direction: column; } .heading-actions { align-items: stretch; flex-direction: column; width: 100%; } .rule-list article { grid-template-columns: auto 1fr; } .row-actions { grid-column: 1 / -1; } .target-row, .branch-grid { grid-template-columns: 1fr; } }
</style>
