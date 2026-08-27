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
		expect(source).toMatch(/\{getAppName\(\)\}\s*\/\s*\{i18n\.t\('elygate\.system'\)\}/);
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

	test('cost recalculation only resumes a persisted job id', async () => {
		const source = await Bun.file(new URL('../pages/LogsPage.svelte', import.meta.url)).text();
		expect(source).toContain("sessionStorage.getItem(RECALCULATION_JOB_KEY)");
		expect(source).toContain('recalculate-cost/status?id=');
		expect(source).toMatch(/terminalStatusObserved = true;\s+await applyCostRecalculationResult/);
		expect(source).toContain('if (terminalStatusObserved) sessionStorage.removeItem(RECALCULATION_JOB_KEY)');
		expect(source).toContain('isMissingCostRecalculation(cause) && sessionStorage.getItem(RECALCULATION_JOB_KEY) === job.id');
		expect(source).toContain('isMissingCostRecalculation(cause) && sessionStorage.getItem(RECALCULATION_JOB_KEY) === jobID');
		expect(source).not.toContain("requestJson<CostRecalculationStatus>('/api/logs/recalculate-cost/status'");
	});

	test('governance names do not append internal ids', async () => {
		const source = await Bun.file(new URL('../pages/GovernanceManagementPage.svelte', import.meta.url)).text();
		expect(source).toContain("{:else}<tr><td><strong>{nameOf(record)}</strong></td>");
	});

	test('virtual key status uses a value rather than a field label', async () => {
		const source = await Bun.file(new URL('../pages/VirtualKeysPage.svelte', import.meta.url)).text();
		expect(source).toContain("providerWarning(record) || i18n.t('elygate.enabled')");
		expect(source).not.toContain("providerWarning(record) || i18n.t('elygate.active')");
	});

	test('release check uses the same-origin backend proxy', async () => {
		const source = await Bun.file(new URL('../pages/PanelAssist.svelte', import.meta.url)).text();
		expect(source).toContain("Promise.race([");
		expect(source).toContain("requestJson<JsonRecord>('/api/latest-release')");
		expect(source).not.toContain("fetch('https://getbifrost.ai/latest-release'");
		expect(source).not.toContain('AbortController');
		expect(source).not.toContain('controller.abort()');
	});

	test('provider retries are explicit and leave the default unchanged when unset', async () => {
		const source = await Bun.file(new URL('../pages/ProvidersPage.svelte', import.meta.url)).text();
		expect(source).toContain('maxRetries: string | number');
		expect(source).toContain('providerMaxRetriesForPayload(providerForm.maxRetries)');
		expect(source).toContain("network.max_retries = maxRetries");
		expect(source).toContain("i18n.t('elygate.maxRetriesHint')");
	});

	test('virtual key editor provides graphical provider, key, and model controls', async () => {
		const source = await Bun.file(new URL('../pages/VirtualKeysPage.svelte', import.meta.url)).text();
		expect(source).toContain('class="route-editor"');
		expect(source).toContain("requestJson<unknown>(`/api/providers/${encoded}/keys`)");
		expect(source).toContain("requestJson<unknown>(`/api/models?unfiltered=true&limit=0&provider=${encoded}`)");
		expect(source).toContain("i18n.t('elygate.virtualKeyAllowAllKeys')");
		expect(source).toContain("i18n.t('elygate.virtualKeyAllowAllModels')");
		expect(source).not.toContain('bind:value={form.providerConfigs}');
	});

	test('virtual key governance uses backend pagination and structured complex fields', async () => {
		const source = await Bun.file(new URL('../pages/VirtualKeysPage.svelte', import.meta.url)).text();
		expect(source).toContain('/api/governance/virtual-keys?limit=${pageSize}&offset=${(page - 1) * pageSize}');
		expect(source).toContain('formatPagination(page, totalPages, total, i18n.locale)');
		expect(source).toContain('form.mcpConfigs as config');
		expect(source).toContain('form.budgets as budget');
		expect(source).toContain('form.rateLimit.tokenMaxLimit');
		expect(source).not.toContain('<details class="advanced-editor">');
		expect(source).not.toContain('bind:value={form.mcpConfigs}');
		expect(source).not.toContain('bind:value={form.budgets}');
		expect(source).not.toContain('bind:value={form.rateLimit}');
	});

	test('dashboard CSV uses a mounted link and releases the object URL asynchronously', async () => {
		const source = await Bun.file(new URL('../pages/DashboardPage.svelte', import.meta.url)).text();
		expect(source).toContain('document.body.append(link)');
		expect(source).toContain('link.click()');
		expect(source).toContain('link.remove()');
		expect(source).toContain('window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)');
	});

	test('MCP settings reads the real client configuration and remains distinct from gateway editing', async () => {
		const source = await Bun.file(new URL('../pages/McpSettingsPage.svelte', import.meta.url)).text();
		expect(source).toContain("configFormFromDocument(await requestJson('/api/config'))");
		expect(source).toContain('config.mcpServerAuthMode');
		expect(source).toContain('config.mcpToolSyncInterval');
		expect(source).not.toContain('document.mcp');
		const app = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		expect(app).toContain("'mcp-settings': { list: McpSettingsPage }");
		expect(app).toContain("'mcp-gateway-config': { list: ConfigPage }");
	});

	test('governance, provider, routing, and log values are localized at render time', async () => {
		const governance = await Bun.file(new URL('../pages/GovernanceManagementPage.svelte', import.meta.url)).text();
		const providers = await Bun.file(new URL('../pages/ProvidersPage.svelte', import.meta.url)).text();
		const routing = await Bun.file(new URL('../pages/RoutingRulesPage.svelte', import.meta.url)).text();
		const logs = await Bun.file(new URL('../pages/LogsPage.svelte', import.meta.url)).text();
		const mcpLogs = await Bun.file(new URL('../pages/McpLogsPage.svelte', import.meta.url)).text();
		expect(governance).toContain("text('供应商治理', 'Provider governance')");
		expect(governance).toContain('scopeLabel(record.scope_kind)');
		expect(governance).toContain('requestTypesLabel(record.request_types)');
		expect(providers).toContain("status === 'success' || status === 'active'");
		expect(routing).toContain('scopeLabel(rule.scope)');
		expect(logs).toContain("statusLabel(value(log, 'status'))");
		expect(mcpLogs).toContain("statusLabel(value(log, 'status'))");
	});

	test('the svadmin compatibility patch is pinned and covers reported settings regressions', async () => {
		const packageJson = await Bun.file(new URL('../../package.json', import.meta.url)).json();
		const patch = await Bun.file(`${process.cwd()}/patches/@svadmin%2Fui@0.42.2.patch`).text();
		expect(packageJson.patchedDependencies['@svadmin/ui@0.42.2']).toBe('patches/@svadmin%2Fui@0.42.2.patch');
		for (const contract of ['profile.newPassword', "const version = '0.42.2'", 'whitespace-nowrap', "'用户' : 'User'", 'i18n.locale === "zh-CN" ? "关闭" : "Close"', 'CI 部署令牌', '3 个月前']) {
			expect(patch).toContain(contract);
		}
		expect(patch).toContain('passwordChangedRecently = true');
		expect(patch).toContain("'刚刚' : 'Just now'");
		expect(patch).toContain("e.key.toLowerCase() === 'k' || e.code === 'KeyK'");
	});

	test('locale changes update document metadata and theme labels', async () => {
		const source = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		expect(source).toContain('document.title = locale === \'zh-CN\'');
		expect(source).toContain('document.documentElement.lang = locale');
		expect(source).toContain('builtinPresets[name].label = label');
		expect(source).toContain('applyLocaleMetadata(currentLocale)');
		expect(source).toContain("{#if currentHash === '#/login'}");
		expect(source).toContain("window.addEventListener('hashchange', syncHash)");
	});

	test('security settings remain editable after configuration loads', async () => {
		const source = await Bun.file(new URL('../pages/ConfigPage.svelte', import.meta.url)).text();
		for (const field of ['authEnabled', 'enforceAuthOnInference', 'allowDirectKeys', 'disableDbPingsInHealth', 'dropExcessRequests']) {
			expect(source).toContain(`bind:checked={form.${field}} disabled={isLoading}`);
			expect(source).not.toContain(`bind:checked={form.${field}} disabled={true}`);
		}
	});

	test('async branding remounts both public and admin panel routes', async () => {
		const source = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		expect(source).toContain('{#key currentAppName}');
		expect(source).toContain('onAppNameChange((name) =>');
		expect(source).toContain('currentAppName = name;');
	});

	test('employee editor restores focus and supports escape and tab containment', async () => {
		const source = await Bun.file(new URL('../pages/EmployeesPage.svelte', import.meta.url)).text();
		expect(source).toContain('<svelte:window onkeydown={handleModalKeydown} />');
		expect(source).toContain("if (event.key === 'Escape')");
		expect(source).toContain("if (event.key !== 'Tab') return;");
		expect(source).toContain('returnFocusElement?.focus();');
		expect(source).toContain('aria-modal="true"');
	});

	test('employee credential copy failures are surfaced', async () => {
		const source = await Bun.file(new URL('../pages/EmployeesPage.svelte', import.meta.url)).text();
		expect(source).toContain('await navigator.clipboard.writeText(revealedCredential);');
		expect(source).toMatch(/catch \(cause\)[\s\S]*复制凭据失败/);
	});

	test('MCP guide never generates config from redacted virtual keys and surfaces copy failures', async () => {
		const source = await Bun.file(new URL('../pages/McpUsageGuidePage.svelte', import.meta.url)).text();
		expect(source).toContain("record?.value_redacted !== true");
		expect(source).toContain("i18n.t('elygate.copyFailed')");
		expect(source).toContain("i18n.t('elygate.virtualKeyRevealRequired')");
	});

	test('virtual key copy failures are surfaced', async () => {
		const source = await Bun.file(new URL('../pages/VirtualKeysPage.svelte', import.meta.url)).text();
		expect(source).toContain('await navigator.clipboard.writeText(revealedKey);');
		expect(source).toContain("error = i18n.t('elygate.copyFailed');");
	});

	test('reachable page banners use localized labels and virtual keys hide raw advanced JSON', async () => {
		const resource = await Bun.file(new URL('../pages/BifrostResourcePage.svelte', import.meta.url)).text();
		const catalog = await Bun.file(new URL('../pages/ModelCatalogPage.svelte', import.meta.url)).text();
		const guide = await Bun.file(new URL('../pages/McpUsageGuidePage.svelte', import.meta.url)).text();
		const keys = await Bun.file(new URL('../pages/VirtualKeysPage.svelte', import.meta.url)).text();
		expect(resource).toContain("i18n.locale === 'zh-CN' ? '接口' : 'API'");
		expect(catalog).toContain("i18n.t('elygate.models')");
		expect(guide).toContain("i18n.t('elygate.mcp')");
		expect(keys).not.toContain('textarea bind:value={form.advanced}');
	});

	test('employee portal keeps a valid session when usage loading fails', async () => {
		const source = await Bun.file(new URL('../pages/EmployeePortalPage.svelte', import.meta.url)).text();
		expect(source).toMatch(/employee = response\.employee;[\s\S]*try \{[\s\S]*await loadUsageAndKeys\(\);[\s\S]*catch \(cause\)/);
		expect(source).toMatch(/catch \(cause\) \{[\s\S]*keys = \[\];[\s\S]*stats = \{\};[\s\S]*error =/);
	});
});
