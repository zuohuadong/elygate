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
		expect(panel).toContain('onDestroy(preserveAndCancel)');
		expect(panel).toContain('uncertain: uncertainMutation || mutating');
		expect(panel).toContain("requestJson<unknown>(`${ROUTING_DRAFT_PATH}?limit=${ROUTING_DRAFT_PAGE_SIZE}&offset=${offset}`");
		expect(panel).toContain('buildRoutingDraftPayload');
		expect(panel).toContain('expected_revision');
		expect(panel).toContain('active routing was not changed');
		expect(source).toContain("<div hidden={viewMode !== 'simulation'}><RoutingSimulationPanel active={viewMode === 'simulation'} /></div>");
		expect(source).not.toContain('/api/governance/routing-rules');
	});

	test('uses a theme-aware readable error text token in simulation fields and alerts', async () => {
		const source = await Bun.file(new URL('./RoutingSimulationPanel.svelte', import.meta.url)).text();
		expect(source).toContain('--simulation-error-text: color-mix(in srgb, var(--destructive) 75%, var(--foreground))');
		expect(source).toMatch(/\.field-error\s*\{[^}]*color:\s*var\(--simulation-error-text\)/);
		expect(source).toMatch(/\.notice\s*\{[^}]*color:\s*var\(--simulation-error-text\)/);
	});
});
