import { describe, expect, test } from 'bun:test';

describe('routing rules page contract', () => {
	test('submits editable provider/model fallbacks instead of rule IDs', async () => {
		const source = await Bun.file(new URL('../pages/RoutingRulesPage.svelte', import.meta.url)).text();

		expect(source).toContain("placeholder=\"openai/gpt-4o\"");
		expect(source).toContain('fallbacks: formSnapshot.fallbacks.map((fallback) => fallback.trim()).filter(Boolean)');
		expect(source).not.toContain('function toggleFallback');
		expect(source).not.toContain('rules.filter((rule) => rule.id !== editing?.id)');
	});

	test('keeps the rule name bound and the JSON editor full width', async () => {
		const source = await Bun.file(new URL('../pages/RoutingRulesPage.svelte', import.meta.url)).text();

		expect(source).toContain('<input bind:value={form.name} />');
		expect(source).toContain('name: formSnapshot.name.trim()');
		expect(source).toContain('class="query-editor"');
		expect(source).toMatch(/\.query-editor[^}]*width:\s*100%/);
	});

	test('exposes the offline simulation view and canonical control-plane endpoint', async () => {
		const source = await Bun.file(new URL('../pages/RoutingRulesPage.svelte', import.meta.url)).text();
		const panel = await Bun.file(new URL('../lib/RoutingSimulationPanel.svelte', import.meta.url)).text();

		expect(source).toContain('RoutingSimulationPanel');
		expect(source).toContain('elygate.routingSimulation');
		expect(panel).toContain("requestJson<unknown>('/api/routing/rules'");
		expect(panel).toContain("requestJson<unknown>('/api/control-plane/routing/simulate'");
		expect(panel).toContain('AbortController');
		expect(panel).toContain('onDestroy(cancelRequests)');
		expect(source).toContain("<div hidden={viewMode !== 'simulation'}><RoutingSimulationPanel active={viewMode === 'simulation'} /></div>");
		expect(source).not.toContain('/api/governance/routing-rules');
	});
});
