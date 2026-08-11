import { describe, expect, test } from 'bun:test';

describe('panel issue regressions', () => {
	test('provider keys route renders a dedicated key workspace', async () => {
		const source = await Bun.file(new URL('../pages/ProvidersPage.svelte', import.meta.url)).text();
		expect(source).toContain("resourceName === 'provider-keys'");
		expect(source).toContain('provider-key-workspace');
		expect(source).toContain("i18n.t('elygate.providerKeys')");
	});

	test('routing weights accept common four-decimal values', async () => {
		const source = await Bun.file(new URL('../pages/RoutingRulesPage.svelte', import.meta.url)).text();
		expect(source).toMatch(/type="number"[^>]*min="0\.0001"[^>]*max="1"[^>]*step="0\.0001"/);
		expect(source).not.toContain('step="0.01"');
	});

	test('complexity routing keeps technical enum values but localizes visible Chinese copy', async () => {
		const source = await Bun.file(new URL('../pages/RoutingNetworkSettingsPage.svelte', import.meta.url)).text();
		expect(source).toContain("text('治理', 'Governance')");
		expect(source).toContain('简单（SIMPLE）');
		expect(source).toContain('复杂度层级（complexity_tier）');
		expect(source).toContain('支持中文和英文关键词');
	});

	test('runtime config inherits the active theme foreground color', async () => {
		const source = await Bun.file(new URL('../pages/ConfigPage.svelte', import.meta.url)).text();
		expect(source).toMatch(/\.page-shell\s*\{[^}]*color:\s*var\(--foreground\)/s);
	});
});
