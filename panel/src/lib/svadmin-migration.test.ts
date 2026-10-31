import { describe, expect, test } from 'bun:test';

const source = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe('svadmin default component migration', () => {
	for (const [name, control, binding] of [
		['TextField', 'Input', 'value'],
		['NumberField', 'Input', 'value'],
		['SelectField', 'Select', 'value'],
		['SwitchField', 'Switch', 'checked'],
	]) {
		test(`${name} retains a bound, disabled, explicitly labelled default control`, async () => {
			const field = await source(`./fields/${name}.svelte`);
			expect(field).toContain('const controlId = $props.id();');
			expect(field).toContain('<SettingsFieldRow {label} description={hint} {controlId}>');
			expect(field).toContain(`<${control} id={controlId}`);
			expect(field).toContain(`bind:${binding}`);
			expect(field).toContain('{disabled}');
			expect(field).not.toContain('<style>');
		});
	}

	test('configuration uses one success toast while keeping errors and partial-save warnings persistent', async () => {
		const config = await source('../pages/ConfigPage.svelte');
		expect(config).toContain('<ContentPageShell');
		expect(config.match(/<SettingsGroup /g)).toHaveLength(7);
		expect(config).toContain('<fieldset class="save-bar" disabled={isLoading || isSaving}>');
		expect(config).toContain("if (isSaving) return;");
		expect(config.match(/notification\.success\(/g)).toHaveLength(1);
		expect(config).not.toContain("notice = i18n.t('elygate.saveSuccess')");
		expect(config).toContain("notice = i18n.t('elygate.configSavedRefreshFailed')");
		expect(config).toContain('<FeedbackNotice tone="danger" message={error}');
		expect(config).toContain('{#if restartRequired !== null}');
		expect(config).not.toContain('{:else if restartRequired');
		expect(config).toContain('persistAndReloadConfigDocument(');
		expect(config).toContain('jsonText = prettyJson(mergeConfigForm(rawConfig, form)');
		expect(config).toContain('applyDocument(parsed)');
	});

	test('model list keeps one page-size owner, bounded paging and in-flight guards', async () => {
		const models = await source('../pages/BifrostResourcePage.svelte');
		expect(models).toContain('<DataTableShell caption={title}>');
		expect(models).toContain('<ListPagination');
		expect(models).toContain('onPageChange={movePage}');
		expect(models.match(/bind:value=\{pageSize\}/g)).toHaveLength(1);
		expect(models).not.toContain('onPageSizeChange=');
		expect(models).toContain('<fieldset disabled={isLoading} class="pagination"');
		expect(models).toContain('if (isLoading) return;');
		expect(models).toContain('Math.max(1, Math.min(totalPages, nextPage))');
		expect(models).toContain('sequence !== loadSeq');
		expect(models).toContain("if (requestedQuery) params.set(");
		expect(models).toContain('clampPaginationPage(requestedPage, nextTotal, Number(requestedPageSize))');
	});
});
