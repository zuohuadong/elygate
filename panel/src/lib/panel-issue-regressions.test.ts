import { describe, expect, test } from 'bun:test';

interface PackageManifest {
	dependencies: Record<string, string>;
	patchedDependencies?: Record<string, string>;
}

async function readSvadminUiPatch(): Promise<{ packageJson: PackageManifest; patch: string }> {
	const packageJson = await Bun.file(new URL('../../package.json', import.meta.url)).json() as PackageManifest;
	const patchKey = `@svadmin/ui@${packageJson.dependencies?.['@svadmin/ui']}`;
	const patchPath = packageJson.patchedDependencies?.[patchKey];
	expect(typeof patchPath).toBe('string');
	return { packageJson, patch: await Bun.file(`${process.cwd()}/${patchPath}`).text() };
}

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
		expect(source).toContain("text('简单', 'Simple')");
		expect(source).not.toContain('简单（SIMPLE）');
		expect(source).not.toMatch(/>SIMPLE<|>MEDIUM<|>COMPLEX<|>REASONING</);
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
		const { packageJson, patch } = await readSvadminUiPatch();
		const uiVersion = packageJson.dependencies['@svadmin/ui'];
		expect(packageJson.patchedDependencies[`@svadmin/ui@${uiVersion}`]).toBe(`patches/@svadmin%2Fui@${uiVersion}.patch`);
		for (const contract of ['profile.newPassword', `const version = '${uiVersion}'`, 'whitespace-nowrap', "'用户' : 'User'", '关闭" : "Close', 'CI 部署令牌']) {
			expect(patch).toContain(contract);
		}
		expect(patch).toContain("e.key.toLowerCase() === 'k' || e.code === 'KeyK'");
		expect(patch).toContain('passwordChangedRecently = true');
		expect(patch).toContain('最近修改：刚刚');
		const integrations = await Bun.file(`${process.cwd()}/node_modules/@svadmin/ui/dist/components/IntegrationsSettings.svelte`).text();
		expect(integrations).toContain('onConnectionChange?:');
		expect(integrations).toContain("i18n.t('integrations.statusProvidedByHost')");
	});

	test('locale changes update document metadata and theme labels', async () => {
		const source = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		expect(source).toContain('pageTitleForHash(currentHash, locale, resourceLabels)');
		expect(source).toContain('`${pageTitle} - ${currentAppName} 管理台`');
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
		expect(resource).toContain("i18n.locale === 'zh-CN' ? '模型管理' : 'Model management'");
		expect(catalog).toContain("i18n.t('elygate.models')");
		expect(guide).toContain("i18n.t('elygate.mcp')");
		expect(keys).not.toContain('textarea bind:value={form.advanced}');
	});

	test('current Lingxi copy and recovery controls stay localized and interactive', async () => {
		const app = await Bun.file(new URL('../App.svelte', import.meta.url)).text();
		const governance = await Bun.file(new URL('../pages/GovernanceManagementPage.svelte', import.meta.url)).text();
		const modelLimits = await Bun.file(new URL('../pages/ModelLimitsPage.svelte', import.meta.url)).text();
		const virtualKeys = await Bun.file(new URL('../pages/VirtualKeysPage.svelte', import.meta.url)).text();
		const translations = await Bun.file(new URL('./i18n.ts', import.meta.url)).text();
		expect(governance).toContain("text('令牌上限', 'Token limit')");
		expect(governance).toContain('durationLabel(duration)');
		expect(governance).not.toContain("text('Token 上限', 'Token limit')");
		expect(modelLimits).toContain('durationLabel(record.rate_limit.token_reset_duration)');
		expect(virtualKeys).toContain("i18n.locale === 'zh-CN' ? '令牌重置周期' : 'Token reset window'");
		expect(translations).toContain("'elygate.tokenLimit': '令牌最大值'");
		expect(translations).toContain("'elygate.requestJson': 'JSON 配置'");
		expect(app).toContain(':global([data-svadmin-system-error] button)');
		expect(app).toContain('pointer-events: auto !important');
	});

	test('fourth-round settings and documentation surfaces are localized', async () => {
		const generic = await Bun.file(new URL('../pages/GenericAdminPage.svelte', import.meta.url)).text();
		const operational = await Bun.file(new URL('../pages/OperationalSettingsPage.svelte', import.meta.url)).text();
		const proxy = await Bun.file(new URL('../pages/RoutingNetworkSettingsPage.svelte', import.meta.url)).text();
		const docs = await Bun.file(new URL('../pages/DocsHubPage.svelte', import.meta.url)).text();
		const translations = await Bun.file(new URL('./i18n.ts', import.meta.url)).text();
		const { patch } = await readSvadminUiPatch();
		expect(generic).toContain('localizedEyebrow(config.eyebrow)');
		expect(generic).toContain("'Enterprise Governance': '企业级管理'");
		expect(operational).toContain("'source', flag.source ?? 'default'");
		expect(proxy).toContain("text('不使用代理的主机', 'No-proxy hosts')");
		expect(proxy).toContain("text('SCIM 企业目录', 'SCIM Enterprise')");
		expect(docs).toContain('const chineseDocs: Record<string, string>');
		expect(docs).toContain("content: zh ? chineseDocs.quickstart : quickstartSource");
		expect(translations).toContain("'elygate.option.dual.prefer_idp': '优先身份源令牌'");
		expect(translations).toContain("'elygate.field.compatConvertTextToChat': '文本接口转聊天接口'");
		const integrations = await Bun.file(`${process.cwd()}/node_modules/@svadmin/ui/dist/components/IntegrationsSettings.svelte`).text();
		expect(integrations).toContain("i18n.t('integrations.sourceControl')");
		expect(integrations).toContain("i18n.t('integrations.statusProvidedByHost')");
	});

	test('employee portal keeps a valid session when usage loading fails', async () => {
		const source = await Bun.file(new URL('../pages/EmployeePortalPage.svelte', import.meta.url)).text();
		expect(source).toMatch(/employee = response\.employee;[\s\S]*try \{[\s\S]*await loadUsageAndKeys\(\);[\s\S]*catch \(cause\)/);
		expect(source).toMatch(/catch \(cause\) \{[\s\S]*keys = \[\];[\s\S]*stats = \{\};[\s\S]*error =/);
	});
});
