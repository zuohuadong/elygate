import { describe, expect, test } from 'bun:test';

describe('routing rules page contract', () => {
	test('submits editable provider/model fallbacks instead of rule IDs', async () => {
		const source = await Bun.file(new URL('../pages/RoutingRulesPage.svelte', import.meta.url)).text();

		expect(source).toContain("placeholder=\"openai/gpt-4o\"");
		expect(source).toContain('fallbacks: form.fallbacks.map((fallback) => fallback.trim()).filter(Boolean)');
		expect(source).not.toContain('function toggleFallback');
		expect(source).not.toContain('rules.filter((rule) => rule.id !== editing?.id)');
	});

	test('keeps the rule name bound and the JSON editor full width', async () => {
		const source = await Bun.file(new URL('../pages/RoutingRulesPage.svelte', import.meta.url)).text();

		expect(source).toContain('<input bind:value={form.name} />');
		expect(source).toContain('name: form.name.trim()');
		expect(source).toContain('class="query-editor"');
		expect(source).toMatch(/\.query-editor[^}]*width:\s*100%/);
	});
});
