async (page) => {
	const checks = [];
	const errors = [];
	const unexpected = [];
	const writes = [];
	const modelRequests = [];
	const check = (condition, name) => {
		if (!condition) throw new Error(name);
		checks.push(name);
	};
	const settle = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const config = {
		auth_config: { is_enabled: true, admin_username: { value: 'fixture-admin', type: 'plain_text' }, admin_password: { value: '[REDACTED]' } },
		client_config: {
			enable_logging: true, initial_pool_size: 5000, allowed_origins: ['*'],
			max_request_body_size_mb: 100, routing_chain_max_depth: 10,
			dual_credential_conflict_behavior: 'prefer_idp', future_option: { retained: true },
		},
		framework_config: { pricing_url: 'https://example.test/pricing', config_hash: 'fixture-hash' },
		is_db_connected: true, is_logs_connected: true, is_cache_connected: false,
		restart_required: { required: false },
	};
	let document = structuredClone(config);
	let failSave = false;
	let failRead = false;
	let holdWrite;
	let releaseWrite;
	let holdModels;
	let releaseModels;
	let modelTotal = 125;
	let modelFailure = false;
	const origin = page.url().startsWith('http') ? new URL(page.url()).origin : 'http://127.0.0.1:3011';
	const onError = error => errors.push(error.message);
	page.on('pageerror', onError);
	await page.route('**/api/**', async route => {
		const request = route.request();
		const url = new URL(request.url());
		const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		if (request.method() !== 'GET') {
			writes.push({ path: url.pathname, body: request.postDataJSON() });
			if (url.pathname !== '/api/config' || request.method() !== 'PUT') {
				unexpected.push(`${request.method()} ${url.pathname}`);
				return json({ message: 'Unexpected fixture write' }, 500);
			}
			if (holdWrite) await holdWrite;
			if (failSave) return json({ message: 'Fixture save rejected' }, 400);
			document = request.postDataJSON();
			return json({ status: 'success' });
		}
		switch (url.pathname) {
			case '/api/session/is-auth-enabled': return json({ is_auth_enabled: true, has_valid_token: true });
			case '/api/config': return failRead ? json({ message: 'Fixture refresh unavailable' }, 503) : json(document);
			case '/api/plugins': return json({ plugins: [] });
			case '/api/notifications': return json({ data: [], total: 0 });
			case '/api/providers':
			case '/api/governance/virtual-keys':
			case '/api/mcp/clients':
				return json({ data: [], total: 0 });
			case '/api/version': return json({ version: 'fixture' });
			case '/api/latest-release': return json({ version: 'fixture' });
			case '/api/models': {
				modelRequests.push(Object.fromEntries(url.searchParams));
				if (holdModels) await holdModels;
				if (modelFailure) return json({ message: 'Fixture models unavailable' }, 503);
				const offset = Number(url.searchParams.get('offset') ?? 0);
				const limit = Number(url.searchParams.get('limit') ?? 50);
				return json({
					data: Array.from({ length: Math.max(0, Math.min(limit, modelTotal - offset)) }, (_, index) => ({
						id: `model-${offset + index + 1}`, name: `Fixture Model ${offset + index + 1}`, provider: 'fixture',
					})),
					total: modelTotal,
				});
			}
			default:
				unexpected.push(`${request.method()} ${url.pathname}`);
				return json({ message: 'Unexpected fixture endpoint' }, 404);
		}
	});
	try {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.goto(`${origin}/?svadmin-migration-fixture=${Date.now()}#/config`);
		const content = page.locator('[data-svadmin-content-page="config"]');
		const username = content.getByRole('textbox', { name: '管理员用户名', exact: true });
		await username.waitFor();
		await page.waitForFunction(() => document.querySelector('input[autocomplete="username"]')?.value === 'fixture-admin');
		check(await content.locator('[data-svadmin-settings-group]').count() === 7, 'seven-default-settings-groups');
		check(await content.locator('input[type=password]').getAttribute('autocomplete') === 'new-password', 'password-autocomplete-retained');
		const labelTargets = await content.locator('[data-svadmin-settings-field-row] label').evaluateAll(labels =>
			labels.every(label => label.control?.id === label.htmlFor) && new Set(labels.map(label => label.htmlFor)).size === labels.length,
		);
		check(labelTargets, 'all-field-labels-have-unique-control-targets');
		await content.locator('label').filter({ hasText: /^管理员用户名$/ }).click();
		check(await username.evaluate(element => element === document.activeElement), 'text-label-focuses-input');
		await username.fill('edited-admin');
		await content.getByRole('spinbutton', { name: '初始连接池大小', exact: true }).fill('8000');
		await content.getByRole('combobox', { name: '双凭证冲突处理', exact: true }).selectOption('prefer_vk');
		await content.locator('label').filter({ hasText: /^启用请求日志$/ }).click();
		check(await content.getByRole('switch', { name: '启用请求日志', exact: true }).getAttribute('aria-checked') === 'false', 'switch-label-toggles-binding');
		await content.getByRole('switch', { name: '启用请求日志', exact: true }).focus();
		await page.keyboard.press('Space');
		check(await content.getByRole('switch', { name: '启用请求日志', exact: true }).getAttribute('aria-checked') === 'true', 'switch-keyboard-toggle');
		await page.keyboard.press('Space');
		await content.getByRole('button', { name: 'JSON', exact: true }).click();
		const editor = content.locator('textarea');
		const merged = JSON.parse(await editor.inputValue());
		check(merged.auth_config.admin_username.value === 'edited-admin', 'text-binding-reaches-json');
		check(merged.client_config.initial_pool_size === 8000, 'number-binding-reaches-json');
		check(merged.client_config.enable_logging === false, 'switch-binding-reaches-json');
		check(merged.client_config.dual_credential_conflict_behavior === 'prefer_vk', 'select-binding-reaches-json');
		check(merged.client_config.future_option.retained && merged.framework_config.config_hash === 'fixture-hash', 'unknown-fields-retained');
		await editor.fill('{invalid');
		await content.getByRole('button', { name: '表单', exact: true }).click();
		check(await editor.inputValue() === '{invalid', 'invalid-json-retains-editor');
		check(await content.getByRole('alert').count() === 1, 'invalid-json-single-error');
		await editor.fill(JSON.stringify(merged));
		await content.getByRole('button', { name: '表单', exact: true }).click();
		check(await username.inputValue() === 'edited-admin', 'json-to-form-restores-draft');

		holdWrite = new Promise(resolve => { releaseWrite = resolve; });
		await content.getByRole('button', { name: '保存', exact: true }).click();
		await content.getByRole('button', { name: '保存中...', exact: true }).waitFor();
		check(await username.isDisabled(), 'saving-disables-fields');
		check(await content.getByRole('switch', { name: '启用请求日志', exact: true }).isDisabled(), 'saving-disables-default-switch');
		check(await content.getByRole('button', { name: '保存中...', exact: true }).isDisabled(), 'saving-disables-save-button');
		await content.locator('form').evaluate(form => form.requestSubmit());
		check(writes.length === 1, 'duplicate-submit-guard');
		releaseWrite();
		holdWrite = undefined;
		await content.getByRole('button', { name: '保存', exact: true }).waitFor();
		await page.getByText('配置已保存并生效。', { exact: true }).waitFor();
		check(await page.getByText('配置已保存并生效。', { exact: true }).count() === 1, 'one-success-toast');
		check(await content.locator('[data-svadmin-feedback-notice]').count() === 0, 'no-persistent-success-banner');
		check(writes[0].body.client_config.initial_pool_size === 8000 && writes[0].body.client_config.future_option.retained, 'save-payload-retains-contract');

		document.restart_required = { required: true, reason: 'Fixture restart pending' };
		await content.getByRole('button', { name: '刷新数据', exact: true }).click();
		await content.getByText(/Fixture restart pending/).waitFor();
		failSave = true;
		await username.fill('unsaved-admin');
		await content.getByRole('button', { name: '保存', exact: true }).click();
		await content.getByRole('alert').waitFor();
		check(await username.inputValue() === 'unsaved-admin', 'failed-save-retains-draft');
		check((await content.getByRole('alert').textContent()).includes('Fixture save rejected'), 'failed-save-actionable-error');
		check(await content.getByText(/Fixture restart pending/).isVisible(), 'save-error-does-not-hide-restart');
		failSave = false;
		failRead = true;
		await content.getByRole('button', { name: '保存', exact: true }).click();
		await content.getByText('配置已保存，但状态刷新失败；认证配置变更后请重新登录，或刷新页面重试读取。', { exact: true }).waitFor();
		check(await username.inputValue() === 'unsaved-admin', 'saved-but-refresh-failed-retains-draft');
		check(await content.locator('[data-svadmin-feedback-notice]').count() === 2, 'partial-save-keeps-independent-restart-warning');
		check(await content.getByText(/Fixture restart pending/).isVisible(), 'partial-save-does-not-hide-restart');
		failRead = false;

		for (const [width, height, theme] of [[1440, 1000, 'light'], [375, 812, 'light'], [375, 812, 'dark'], [812, 375, 'dark']]) {
			await page.setViewportSize({ width, height });
			await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
			await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
			await content.getByRole('button', { name: '表单', exact: true }).scrollIntoViewIfNeeded();
			await settle();
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
			check(!overflow, `config-no-page-overflow-${width}-${theme}`);
			const badControls = await content.locator('input, select, [role=switch]').evaluateAll(elements =>
				elements.filter(element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1); }).length,
			);
			check(badControls === 0, `config-controls-in-bounds-${width}-${theme}`);
			await page.screenshot({ path: `output/playwright/svadmin-config-${width}x${height}-${theme}.png` });
			await content.getByRole('button', { name: 'JSON', exact: true }).click();
			await settle();
			check(await editor.evaluate(element => element.getBoundingClientRect().right <= innerWidth + 1), `json-editor-in-bounds-${width}-${theme}`);
			await page.screenshot({ path: `output/playwright/svadmin-json-${width}x${height}-${theme}.png` });
			await content.getByRole('button', { name: '表单', exact: true }).click();
		}

		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.goto(`${origin}/#/models`);
		const models = page.locator('[data-svadmin-content-page="models"]');
		await models.locator('tbody tr').first().waitFor();
		await page.waitForFunction(() => document.querySelector('[data-svadmin-content-page=models] table')?.getAttribute('aria-busy') === 'false');
		check(await models.locator('select').count() === 1, 'single-page-size-selector');
		const next = models.getByRole('button', { name: /下一页/ });
		holdModels = new Promise(resolve => { releaseModels = resolve; });
		await next.click();
		await page.waitForFunction(() => document.querySelector('[data-svadmin-content-page=models] table')?.getAttribute('aria-busy') === 'true');
		check(await next.isDisabled(), 'in-flight-pagination-disabled');
		check(await models.getByRole('textbox', { name: '搜索', exact: true }).isDisabled(), 'in-flight-filter-disabled');
		releaseModels();
		holdModels = undefined;
		await page.waitForFunction(() => document.querySelector('[data-svadmin-content-page=models] table')?.getAttribute('aria-busy') === 'false');
		check(modelRequests.at(-1).offset === '50' && modelRequests.at(-1).limit === '50', 'next-page-request-contract');
		await models.getByRole('combobox', { name: '每页条数', exact: true }).selectOption('20');
		await page.waitForFunction(() => document.querySelector('[data-svadmin-content-page=models] table')?.getAttribute('aria-busy') === 'false');
		check(modelRequests.at(-1).offset === '0' && modelRequests.at(-1).limit === '20', 'page-size-resets-offset');
		const query = models.getByRole('textbox', { name: '搜索', exact: true });
		await query.fill('fixture search');
		await models.getByRole('button', { name: '搜索', exact: true }).click();
		await page.waitForFunction(() => document.querySelector('[data-svadmin-content-page=models] table')?.getAttribute('aria-busy') === 'false');
		check(modelRequests.at(-1).query === 'fixture search', 'search-parameter-preserved');
		modelTotal = 5;
		await next.click();
		await page.waitForFunction(() => document.querySelector('[data-svadmin-content-page=models] table')?.getAttribute('aria-busy') === 'false');
		check(modelRequests.at(-1).offset === '0', 'shrinking-total-clamps-page-and-reloads');
		check(await models.getByRole('navigation').count() === 0, 'single-page-hides-paging-buttons');
		modelTotal = 125;
		await models.getByRole('button', { name: '刷新数据', exact: true }).click();
		await page.waitForFunction(() => document.querySelector('[data-svadmin-content-page=models] table')?.getAttribute('aria-busy') === 'false');
		for (const [width, height, theme] of [[1440, 1000, 'light'], [375, 812, 'light'], [375, 812, 'dark'], [812, 375, 'dark']]) {
			await page.setViewportSize({ width, height });
			await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
			await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
			await models.scrollIntoViewIfNeeded();
			await settle();
			check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `models-no-page-overflow-${width}-${theme}`);
			check(await models.locator('[data-slot=data-table-shell-viewport]').evaluate(element => element.scrollWidth >= element.clientWidth), `table-scroll-owned-${width}-${theme}`);
			await page.screenshot({ path: `output/playwright/svadmin-models-${width}x${height}-${theme}.png` });
			await models.getByRole('navigation').scrollIntoViewIfNeeded();
			const pagerBounds = await models.getByRole('navigation').boundingBox();
			check(pagerBounds.x >= -1 && pagerBounds.x + pagerBounds.width <= width + 1, `pagination-in-bounds-${width}-${theme}`);
			await page.screenshot({ path: `output/playwright/svadmin-pagination-${width}x${height}-${theme}.png` });
		}
		modelFailure = true;
		await models.getByRole('button', { name: '刷新数据', exact: true }).click();
		await models.getByRole('alert').waitFor();
		check((await models.getByRole('alert').textContent()).includes('Fixture models unavailable'), 'models-error-state');
		modelFailure = false;
		modelTotal = 0;
		await models.getByRole('button', { name: '刷新数据', exact: true }).click();
		await models.locator('p.empty').waitFor();
		check(await models.locator('table').count() === 0, 'models-empty-state');
		check(unexpected.length === 0, `no-unexpected-api-calls: ${unexpected.join(', ')}`);
		check(errors.length === 0, `no-page-errors: ${errors.join(', ')}`);
		check(writes.length === 3 && writes.every(write => write.path === '/api/config'), 'only-three-fixture-config-writes');
		return { status: 'PASS_SCOPED', checkCount: checks.length, checks, fixtureWrites: writes.length, realBackendWrites: 0, pageErrors: errors };
	} finally {
		releaseWrite?.();
		releaseModels?.();
		page.off('pageerror', onError);
		await page.unroute('**/api/**');
	}
}
