import { describe, expect, test } from 'bun:test';
import { buildRelayPayload, emptyRelayDraft } from './relay-management';
import {
	emptyRelayRoute, emptyRelayRules, relayRuleMessage, relayRulesFromJson, relayRulesToJson, RelayRuleError,
	relayUsageNumberFields, relayUsageOptions, relayUsagePathFields, type RelayRulesDraft,
} from './relay-rules';

function parsed(rules: RelayRulesDraft) {
	const json = relayRulesToJson(rules);
	return { usage: json.usageJson ? JSON.parse(json.usageJson) : undefined, streaming: json.streamingJson ? JSON.parse(json.streamingJson) : undefined, routes: JSON.parse(json.routesJson) };
}

function rulesFrom(config: { usage?: unknown; streaming?: unknown; routes?: unknown } = {}) {
	return relayRulesFromJson({
		usageJson: config.usage === undefined ? '' : JSON.stringify(config.usage),
		streamingJson: config.streaming === undefined ? '' : JSON.stringify(config.streaming),
		routesJson: config.routes === undefined ? '[]' : JSON.stringify(config.routes),
	});
}

function ruleAt(rules: RelayRulesDraft) {
	return { ...emptyRelayDraft(), name: 'mapping', baseUrl: 'https://api.example.test', authType: 'none' as const, ...relayRulesToJson(rules) };
}

describe('relay structured configuration', () => {
	test('restores the connected editor opener and traps Tab among visible modal controls', async () => {
		const source = await Bun.file(new URL('../pages/RelayManagementPage.svelte', import.meta.url)).text();
		expect(source).toContain('const returnFocus = modalOpener;');
		expect(source.indexOf('modalOpener = document.activeElement;', source.indexOf('async function openEdit'))).toBeLessThan(source.indexOf('isReading = true;', source.indexOf('async function openEdit')));
		expect(source).toContain('returnFocus instanceof HTMLElement && returnFocus.isConnected');
		expect(source).toContain('returnFocus.focus();');
		expect(source.match(/onkeydown=\{containTab\}/g)).toHaveLength(2);
		expect(source).toContain('filter(control => control.checkVisibility())');
	});

	test('empty and null configurations retain endpoint defaults without invented pricing or routes', () => {
		for (const rules of [emptyRelayRules(), rulesFrom(), rulesFrom({ usage: null, streaming: null, routes: null })]) {
			expect(parsed(rules)).toEqual({ usage: undefined, streaming: undefined, routes: [] });
		}
		expect(parsed(rulesFrom({ usage: {}, streaming: {} }))).toEqual({ usage: {}, streaming: { paths: [] }, routes: [] });
	});

	test('round-trips every supported mapping field and stream paths', () => {
		const usage = {
			model_path: 'engine', model_source: 'query', units_path: 'documents.#.pages', units_source: 'response',
			units_measure: 'value', cost_path: 'charges.#.cost', cost_per_request: 0.01, cost_per_unit: 0.05,
			units_block_size: 100, units_minimum: 1, input_tokens_path: 'usage.in', output_tokens_path: 'usage.out', total_tokens_path: 'usage.total',
		};
		const config = { usage, streaming: { paths: ['/v1/stream/**', '/events/*'] }, routes: [] };
		expect(parsed(rulesFrom(config))).toEqual(config);
		const payload = buildRelayPayload(ruleAt(rulesFrom(config)));
		expect(payload.usage).toEqual(usage);
		expect(payload.streaming).toEqual(config.streaming);
	});

	test('retains route order, exact whitespace identities, pointer booleans and explicit zero overrides', () => {
		const routes = [
			{ method: 'POST', path: '/jobs/ ', headers: { 'X-Amz-Target': 'Service.Start * ' }, enabled: false, billable: true, stream: false, usage: { cost_per_request: 0, cost_per_unit: 0, units_minimum: 0 } },
			{ method: 'GET', path: '/jobs/**', enabled: true, billable: false, stream: true },
			{ method: 'HEAD', path: '/**' },
		];
		const rules = rulesFrom({ usage: { cost_per_request: 1, cost_per_unit: 2, units_path: 'pages' }, routes });
		expect(parsed(rules).routes).toEqual(routes);
		expect(rules.routes.map(({ key }) => key).length).toBe(new Set(rules.routes.map(({ key }) => key)).size);
		const first = rules.routes[0];
		rules.routes.reverse();
		expect(parsed(rules).routes.map((route: { method: string }) => route.method)).toEqual(['HEAD', 'GET', 'POST']);
		rules.routes = rules.routes.filter((route) => route.key !== first.key);
		expect(parsed(rules).routes).toEqual([routes[2], routes[1]]);
	});

	test('omitted, enabled, billable and streaming overrides stay distinct through edit and preview payloads', () => {
		for (const key of ['enabled', 'billable', 'stream'] as const) {
			for (const override of [undefined, true, false]) {
				const route = { method: 'POST', path: '/', ...(override === undefined ? {} : { [key]: override }) };
				expect(buildRelayPayload(ruleAt(rulesFrom({ routes: [route] }))).routes).toEqual([route]);
			}
		}
	});

	test('normalizes upstream lowercase methods for the structured method selector', () => {
		const rules = rulesFrom({ routes: [{ method: 'post', path: '/' }, { method: 'pAtCh', path: '/jobs/*' }] });
		expect(rules.routes.map(({ method }) => method)).toEqual(['POST', 'PATCH']);
		expect(parsed(rules).routes.map((route: { method: string }) => route.method)).toEqual(['POST', 'PATCH']);
	});

	test('all enum variants serialize only explicit selections', () => {
		for (const { key, choices } of relayUsageOptions) {
			const rules = emptyRelayRules();
			for (const { value } of choices) {
				rules.usage[key] = value;
				expect(parsed(rules).usage[key]).toBe(value);
			}
			rules.usage[key] = '';
			expect(parsed(rules).usage).toBeUndefined();
			rules.usage[key] = 'unsupported';
			expect(() => relayRulesToJson(rules)).toThrow('invalid-option');
		}
	});

	test('empty paths remove overrides while nonempty gjson paths remain literal', () => {
		for (const { key } of relayUsagePathFields) {
			const rules = emptyRelayRules();
			rules.usage[key] = ' data.#(kind=="x").cost ';
			expect(parsed(rules).usage[key]).toBe(' data.#(kind=="x").cost ');
			rules.usage[key] = '';
			expect(parsed(rules).usage).toBeUndefined();
		}
	});

	test('blank, zero, positive, decimal and nonfinite numeric inputs remain distinct', () => {
		for (const { key } of relayUsageNumberFields) {
			const rules = emptyRelayRules();
			rules.usage.units_measure = 'body_bytes';
			rules.usage[key] = undefined;
			expect(parsed(rules).usage).not.toHaveProperty(key);
			rules.usage[key] = null;
			expect(parsed(rules).usage).not.toHaveProperty(key);
			for (const number of [0.000001, 1, 100, Number.MAX_VALUE]) {
				rules.usage[key] = number;
				expect(parsed(rules).usage[key]).toBe(number);
			}
			for (const number of [-1, NaN, Infinity, -Infinity]) {
				rules.usage[key] = number;
				expect(() => relayRulesToJson(rules)).toThrow();
			}
			rules.usage[key] = 0;
			if (key === 'units_block_size') expect(() => relayRulesToJson(rules)).toThrow('positive-number');
			else expect(parsed(rules).usage[key]).toBe(0);
		}
	});

	test('checks effective unit pricing across route overrides without treating zero as absent', () => {
		const rules = rulesFrom({ usage: { units_measure: 'body_bytes', cost_per_unit: 1 }, routes: [{ method: 'POST', path: '/', usage: { units_measure: 'chars' } }] });
		expect(() => relayRulesToJson(rules)).toThrow('units-path-required');
		rules.routes[0].usage.cost_per_unit = 0;
		expect(parsed(rules).routes[0].usage.cost_per_unit).toBe(0);
		rules.routes[0].usage.cost_per_unit = 2;
		rules.routes[0].usage.units_path = 'Text';
		expect(parsed(rules).routes[0].usage.units_path).toBe('Text');
		rules.usage.units_measure = '';
		expect(() => relayRulesToJson(rules)).toThrow('units-path-required');
		rules.usage.units_path = 'pages';
		rules.routes[0].usage.units_path = '';
		expect(parsed(rules).routes[0].usage).not.toHaveProperty('units_path');
		rules.usage.cost_per_unit = undefined;
		rules.usage.units_path = '';
		expect(() => relayRulesToJson(rules)).toThrow('units-path-required');
	});

	test('keeps partial valid route mappings and whole-body measurement aligned with upstream', () => {
		expect(parsed(rulesFrom({ usage: { units_path: 'pages' }, routes: [{ method: 'POST', path: '/', usage: { cost_per_unit: 0.5 } }] })).routes[0].usage).toEqual({ cost_per_unit: 0.5 });
		for (const units_measure of ['body_bytes', 'body_chars']) {
			expect(parsed(rulesFrom({ usage: { units_measure, cost_per_unit: 1 } })).usage.units_measure).toBe(units_measure);
		}
	});

	test('rejects malformed and unknown configuration instead of silently erasing fields on replacement', () => {
		for (const usage of [[], true, 'x', { extra: 1 }, { model_path: 5 }, { cost_per_request: '0' }]) expect(() => rulesFrom({ usage })).toThrow();
		for (const streaming of [[], true, { mode: 'on' }, { paths: '/' }, { paths: [1] }]) expect(() => rulesFrom({ streaming })).toThrow();
		for (const routes of [{}, false, [null], [{ path: '/' }], [{ method: 'POST', path: '/', job: {} }]]) expect(() => rulesFrom({ routes })).toThrow();
		for (const field of ['usageJson', 'streamingJson', 'routesJson'] as const) {
			expect(() => relayRulesFromJson({ usageJson: '', streamingJson: '', routesJson: '[]', [field]: '{' })).toThrow('invalid-json');
		}
	});

	test('validates route headers without collapsing case duplicates or whitespace-sensitive patterns', () => {
		const rules = rulesFrom({ routes: [{ method: 'POST', path: '/' }] });
		const route = rules.routes[0];
		route.headers = [{ key: 'one', name: 'X-Operation', glob: 'Ops.* ' }];
		expect(parsed(rules).routes[0].headers).toEqual({ 'X-Operation': 'Ops.* ' });
		route.headers.push({ key: 'two', name: 'x-operation', glob: '*' });
		expect(() => relayRulesToJson(rules)).toThrow('duplicate-header');
		route.headers.pop();
		route.headers[0].name = 'X Invalid';
		expect(() => relayRulesToJson(rules)).toThrow('header-name');
		route.headers[0].name = 'X-Operation';
		route.headers[0].glob = ' ';
		expect(() => relayRulesToJson(rules)).toThrow('header-glob');
		for (const headers of [[], { 'X-Operation': 1 }]) expect(() => rulesFrom({ routes: [{ method: 'POST', path: '/', headers }] })).toThrow();
	});

	test('new routes cannot silently create a catch-all or inherit an explicit false', () => {
		const route = emptyRelayRoute();
		expect(route.path).toBe('');
		expect(route.enabled).toBe('');
		expect(route.billable).toBe('');
		expect(route.stream).toBe('');
		const rules = emptyRelayRules();
		rules.routes.push(route);
		expect(() => relayRulesToJson(rules)).toThrow('rooted-path');
		route.path = '/**';
		expect(parsed(rules).routes).toEqual([{ method: 'POST', path: '/**' }]);
		route.method = 'OPTIONS';
		expect(() => relayRulesToJson(rules)).toThrow('invalid-method');
	});

	test('rejects misplaced recursive segments in route and streaming paths', () => {
		for (const path of ['', 'v1/*', '/**/run']) {
			expect(() => relayRulesToJson(rulesFrom({ routes: [{ method: 'POST', path }] }))).toThrow();
			expect(() => relayRulesToJson(rulesFrom({ streaming: { paths: [path] } }))).toThrow();
		}
		for (const path of ['/', '/v1/*/run', '/jobs/**', '/path/ ']) {
			expect(parsed(rulesFrom({ streaming: { paths: [path] } })).streaming.paths).toEqual([path]);
		}
	});

	test('validates Go path.Match syntax rather than a JavaScript glob dialect', () => {
		// Empty/negated classes, dangling escapes/ranges, Unicode and escaped metacharacters.
		for (const glob of ['[', '[]', '[^]', '[a', '[a-', '[a-]', '[-a]', '[a-b-c]', '[\\]', '\\', '*\\', 'abc[def']) {
			for (const config of [
				{ routes: [{ method: 'POST', path: `/${glob}` }] },
				{ streaming: { paths: [`/${glob}`] } },
				{ routes: [{ method: 'POST', path: '/', headers: { 'X-Operation': glob } }] },
			]) expect(() => relayRulesToJson(rulesFrom(config))).toThrow('invalid-glob');
		}
		for (const glob of ['literal]', '*?', '[a-z]', '[z-a]', '[^a-z]', '[!a]', '[[]', '[\\]]', '[a\\-]', '\\[', '\\*', '\\\\', '[文-语]', '[😀-🙏]']) {
			expect(parsed(rulesFrom({ streaming: { paths: [`/${glob}`] } })).streaming.paths).toEqual([`/${glob}`]);
			expect(parsed(rulesFrom({ routes: [{ method: 'POST', path: '/', headers: { 'X-Operation': glob } }] })).routes[0].headers).toEqual({ 'X-Operation': glob });
		}
		const rules = rulesFrom({ routes: [{ method: 'POST', path: '/', headers: { 'X-Operation': '[' } }] });
		try { relayRulesToJson(rules); } catch (cause) {
			expect(cause).toBeInstanceOf(RelayRuleError);
			expect((cause as RelayRuleError).field).toBe('routes.0.headers.0.glob');
		}
	});

	test('reports the exact field and localized recovery message without serializing editor keys', () => {
		const rules = rulesFrom({ routes: [{ method: 'POST', path: '/', usage: { units_block_size: 0 } }] });
		try {
			relayRulesToJson(rules);
			throw new Error('expected invalid billing block size');
		} catch (cause) {
			expect(cause).toBeInstanceOf(RelayRuleError);
			const issue = cause as RelayRuleError;
			expect(issue.field).toBe('routes.0.usage.units_block_size');
			expect(relayRuleMessage(issue, 'zh-CN')).toContain('必须大于 0');
			expect(relayRuleMessage(issue, 'en')).toContain('greater than 0');
		}
		rules.routes[0].usage.units_block_size = 1;
		const json = relayRulesToJson(rules);
		expect(json.routesJson).not.toContain(rules.routes[0].key);
	});
});
