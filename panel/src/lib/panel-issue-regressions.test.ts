import { describe, expect, test } from 'bun:test';

describe('panel issue regressions', () => {
	test('provider keys route renders a dedicated key workspace', async () => {
		const source = await Bun.file(new URL('../pages/ProvidersPage.svelte', import.meta.url)).text();
		expect(source).toContain("resourceName === 'provider-keys'");
		expect(source).toContain('provider-key-workspace');
		expect(source).toContain("i18n.t('elygate.providerKeys')");
	});

	test('routing weights accept common values like 1 and 0.99', async () => {
		const source = await Bun.file(new URL('../pages/RoutingRulesPage.svelte', import.meta.url)).text();
		expect(source).toMatch(/type="number"[^>]*min="0"[^>]*max="1"[^>]*step="any"/);
		expect(source).not.toMatch(/step="0\.0*1"/);
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

	test('caching config identifies the system section instead of plugins', async () => {
		const source = await Bun.file(new URL('../pages/CachingConfigPage.svelte', import.meta.url)).text();
		expect(source).toContain("Elygate / {i18n.t('elygate.system')}");
		expect(source).not.toContain('Elygate / Plugins');
	});

	test('runtime cache status links to the actionable storage configuration', async () => {
		const source = await Bun.file(new URL('../pages/ConfigPage.svelte', import.meta.url)).text();
		expect(source).toContain("href: '#/caching-config'");
	});

	test('request-log metrics use the same filters as the paginated log list', async () => {
		const source = await Bun.file(new URL('../pages/LogsPage.svelte', import.meta.url)).text();
		expect(source).toContain('function filterParams(): URLSearchParams');
		expect(source).toContain('requestJson<LogStats>(statsEndpoint())');
		expect(source).toContain('requestJson<LogStats>(statsEndpoint()).catch(() => ({}))');
		expect(source).toContain('requestJson<unknown>(endpoint())');
		expect(source).toContain('Promise.all([');
	});

	test('request-log detail opens from an explicit action instead of a row click', async () => {
		const source = await Bun.file(new URL('../pages/LogsPage.svelte', import.meta.url)).text();
		expect(source).toContain("i18n.t('elygate.inspect')");
		expect(source).not.toContain('tr onclick={() => void openDetail(log)}');
	});

	test('release check times out without aborting the browser request', async () => {
		const source = await Bun.file(new URL('../pages/PanelAssist.svelte', import.meta.url)).text();
		expect(source).toContain("Promise.race([");
		expect(source).toContain("fetch('https://getbifrost.ai/latest-release'");
		expect(source).not.toContain('AbortController');
		expect(source).not.toContain('controller.abort()');
	});
});
