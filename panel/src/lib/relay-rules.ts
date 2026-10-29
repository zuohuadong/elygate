import { isJsonRecord, type JsonRecord } from './api';

export const relayRouteMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
export const relayUsagePathFields = [
	{ key: 'model_path', zh: '模型路径 / Query 参数', en: 'Model path / query parameter' },
	{ key: 'units_path', zh: '用量路径', en: 'Units path' },
	{ key: 'cost_path', zh: '上游成本路径', en: 'Reported cost path' },
	{ key: 'input_tokens_path', zh: '输入令牌路径', en: 'Input tokens path' },
	{ key: 'output_tokens_path', zh: '输出令牌路径', en: 'Output tokens path' },
	{ key: 'total_tokens_path', zh: '总令牌路径', en: 'Total tokens path' },
] as const;
export const relayUsageNumberFields = [
	{ key: 'cost_per_request', zh: '每次请求费用 ($)', en: 'Fee per request ($)', min: 0 },
	{ key: 'cost_per_unit', zh: '每单位费用 ($)', en: 'Cost per unit ($)', min: 0 },
	{ key: 'units_block_size', zh: '计费块大小', en: 'Billing block size', min: 0 },
	{ key: 'units_minimum', zh: '最小计费用量', en: 'Minimum billed units', min: 0 },
] as const;
export const relayUsageOptions = [
	{ key: 'model_source', zh: '模型来源', en: 'Model source', choices: [
		{ value: 'body', zh: '请求正文', en: 'Request body' }, { value: 'query', zh: 'Query 参数', en: 'Query parameter' },
	] },
	{ key: 'units_source', zh: '用量来源', en: 'Units source', choices: [
		{ value: 'response', zh: '响应正文', en: 'Response body' }, { value: 'request', zh: '请求正文', en: 'Request body' },
	] },
	{ key: 'units_measure', zh: '用量计量方式', en: 'Units measure', choices: [
		{ value: 'value', zh: '路径数值', en: 'Value at path' }, { value: 'chars', zh: '路径字符串字符数', en: 'Characters at path' },
		{ value: 'body_bytes', zh: '整个正文的字节数', en: 'Whole body bytes' }, { value: 'body_chars', zh: '整个正文的字符数', en: 'Whole body characters' },
	] },
] as const;

type UsagePathKey = typeof relayUsagePathFields[number]['key'];
type UsageNumberKey = typeof relayUsageNumberFields[number]['key'];
type UsageOptionKey = typeof relayUsageOptions[number]['key'];
export type RelayUsageDraft = Record<UsagePathKey | UsageOptionKey, string>
	& Record<UsageNumberKey, number | null | undefined> & { present: boolean };
export type RelayOverride = '' | 'true' | 'false';
export interface RelayHeaderDraft { key: string; name: string; glob: string; }
export interface RelayPathDraft { key: string; path: string; }
export interface RelayRouteDraft {
	key: string;
	method: string;
	path: string;
	enabled: RelayOverride;
	billable: RelayOverride;
	stream: RelayOverride;
	headers: RelayHeaderDraft[];
	usage: RelayUsageDraft;
}
export interface RelayRulesDraft {
	usage: RelayUsageDraft;
	streamingConfigured: boolean;
	streaming: RelayPathDraft[];
	routes: RelayRouteDraft[];
}
export interface RelayRulesJson { usageJson: string; streamingJson: string; routesJson: string; }

export class RelayRuleError extends Error {
	constructor(readonly field: string, readonly code: string) { super(code); }
}

export function emptyRelayUsage(): RelayUsageDraft {
	return {
		present: false, model_path: '', model_source: '', units_path: '', units_source: '', units_measure: '',
		cost_path: '', input_tokens_path: '', output_tokens_path: '', total_tokens_path: '',
		cost_per_request: undefined, cost_per_unit: undefined, units_block_size: undefined, units_minimum: undefined,
	};
}

export function emptyRelayRoute(): RelayRouteDraft {
	return { key: crypto.randomUUID(), method: 'POST', path: '', enabled: '', billable: '', stream: '', headers: [], usage: emptyRelayUsage() };
}

export function emptyRelayRules(): RelayRulesDraft {
	return { usage: emptyRelayUsage(), streamingConfigured: false, streaming: [], routes: [] };
}

function fieldsOnly(record: JsonRecord, keys: readonly string[], field: string): void {
	if (Object.keys(record).some((key) => !keys.includes(key))) throw new RelayRuleError(field, 'unknown-field');
}

function sourceJson(source: string, field: string): unknown {
	if (!source.trim()) return undefined;
	try { return JSON.parse(source); }
	catch { throw new RelayRuleError(field, 'invalid-json'); }
}

function usageDraft(payload: unknown, field: string): RelayUsageDraft {
	const draft = emptyRelayUsage();
	if (payload == null) return draft;
	if (!isJsonRecord(payload)) throw new RelayRuleError(field, 'object-required');
	fieldsOnly(payload, [...relayUsagePathFields, ...relayUsageNumberFields, ...relayUsageOptions].map(({ key }) => key), field);
	draft.present = true;
	for (const { key } of [...relayUsagePathFields, ...relayUsageOptions]) {
		if (payload[key] == null) continue;
		if (typeof payload[key] !== 'string') throw new RelayRuleError(`${field}.${key}`, 'text-required');
		draft[key] = payload[key];
	}
	for (const { key } of relayUsageNumberFields) {
		if (payload[key] == null) continue;
		if (typeof payload[key] !== 'number' || !Number.isFinite(payload[key])) throw new RelayRuleError(`${field}.${key}`, 'finite-number');
		draft[key] = payload[key];
	}
	return draft;
}

function overrideDraft(payload: unknown, field: string): RelayOverride {
	if (payload == null) return '';
	if (typeof payload !== 'boolean') throw new RelayRuleError(field, 'boolean-required');
	return payload ? 'true' : 'false';
}

function routeDraft(payload: unknown, index: number): RelayRouteDraft {
	const field = `routes.${index}`;
	if (!isJsonRecord(payload)) throw new RelayRuleError(field, 'object-required');
	fieldsOnly(payload, ['method', 'path', 'headers', 'enabled', 'billable', 'stream', 'usage'], field);
	if (typeof payload.method !== 'string' || typeof payload.path !== 'string') throw new RelayRuleError(field, 'route-required');
	if (payload.headers != null && !isJsonRecord(payload.headers)) throw new RelayRuleError(`${field}.headers`, 'object-required');
	const headers = Object.entries(payload.headers ?? {}).map(([name, glob]) => {
		if (typeof glob !== 'string') throw new RelayRuleError(`${field}.headers`, 'text-required');
		return { key: crypto.randomUUID(), name, glob };
	});
	return {
		...emptyRelayRoute(), method: payload.method.toUpperCase(), path: payload.path, headers,
		enabled: overrideDraft(payload.enabled, `${field}.enabled`), billable: overrideDraft(payload.billable, `${field}.billable`),
		stream: overrideDraft(payload.stream, `${field}.stream`), usage: usageDraft(payload.usage, `${field}.usage`),
	};
}

export function relayRulesFromJson(source: RelayRulesJson): RelayRulesDraft {
	const draft = emptyRelayRules();
	draft.usage = usageDraft(sourceJson(source.usageJson, 'usage'), 'usage');
	const streaming = sourceJson(source.streamingJson, 'streaming');
	if (streaming != null) {
		if (!isJsonRecord(streaming)) throw new RelayRuleError('streaming', 'object-required');
		fieldsOnly(streaming, ['paths'], 'streaming');
		if (streaming.paths != null && (!Array.isArray(streaming.paths) || streaming.paths.some((path) => typeof path !== 'string'))) throw new RelayRuleError('streaming', 'paths-required');
		draft.streamingConfigured = true;
		draft.streaming = ((streaming.paths ?? []) as string[]).map((path) => ({ key: crypto.randomUUID(), path }));
	}
	const routes = sourceJson(source.routesJson, 'routes');
	if (routes != null && !Array.isArray(routes)) throw new RelayRuleError('routes', 'array-required');
	draft.routes = (routes ?? []).map(routeDraft);
	return draft;
}

function usageConfig(draft: RelayUsageDraft, field: string, base: JsonRecord = {}): JsonRecord | undefined {
	const config: JsonRecord = {};
	for (const { key } of relayUsagePathFields) if (draft[key] !== '') config[key] = draft[key];
	for (const { key, choices } of relayUsageOptions) {
		if (draft[key] === '') continue;
		if (!choices.some(({ value }) => value === draft[key])) throw new RelayRuleError(`${field}.${key}`, 'invalid-option');
		config[key] = draft[key];
	}
	for (const { key, min } of relayUsageNumberFields) {
		const number = draft[key];
		if (number == null) continue;
		if (!Number.isFinite(number) || number < min || (key === 'units_block_size' && number === 0)) throw new RelayRuleError(`${field}.${key}`, key === 'units_block_size' ? 'positive-number' : 'nonnegative-number');
		config[key] = number;
	}
	const merged = { ...base, ...config };
	if (Number(merged.cost_per_unit ?? 0) > 0 && !['body_bytes', 'body_chars'].includes(String(merged.units_measure ?? '')) && !merged.units_path) throw new RelayRuleError(`${field}.units_path`, 'units-path-required');
	return draft.present || Object.keys(config).length ? config : undefined;
}

function globCharacterEnd(pattern: string, index: number, field: string): number {
	if (index >= pattern.length || pattern[index] === '-' || pattern[index] === ']') throw new RelayRuleError(field, 'invalid-glob');
	if (pattern[index] === '\\') index += 1;
	const rune = pattern.codePointAt(index);
	if (rune === undefined) throw new RelayRuleError(field, 'invalid-glob');
	const end = index + (rune > 0xffff ? 2 : 1);
	if (end >= pattern.length) throw new RelayRuleError(field, 'invalid-glob');
	return end;
}

function globClassEnd(pattern: string, index: number, field: string): number {
	if (pattern[index] === '^') index += 1;
	let ranges = 0;
	while (index < pattern.length) {
		if (pattern[index] === ']' && ranges > 0) return index;
		index = globCharacterEnd(pattern, index, field);
		if (pattern[index] === '-') index = globCharacterEnd(pattern, index + 1, field);
		ranges += 1;
	}
	throw new RelayRuleError(field, 'invalid-glob');
}

// 与上游 Go path.Match 的字符类和转义语法一致，不使用 JS glob 方言。
function validateGlob(pattern: string, field: string): void {
	for (let index = 0; index < pattern.length; index += 1) {
		if (pattern[index] === '[') index = globClassEnd(pattern, index + 1, field);
		else if (pattern[index] === '\\' && ++index >= pattern.length) throw new RelayRuleError(field, 'invalid-glob');
	}
}

function rootedPath(path: string, field: string): void {
	if (!path.startsWith('/')) throw new RelayRuleError(field, 'rooted-path');
	const segments = path.slice(1).split('/');
	if (segments.slice(0, -1).includes('**')) throw new RelayRuleError(field, 'recursive-last');
	for (const segment of segments) if (segment !== '**') validateGlob(segment, field);
}

function headerConfig(headers: RelayHeaderDraft[], field: string): JsonRecord | undefined {
	const names = new Set<string>();
	const entries = headers.map(({ name, glob }, index) => {
		if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) throw new RelayRuleError(`${field}.${index}.name`, 'header-name');
		if (names.has(name.toLowerCase())) throw new RelayRuleError(`${field}.${index}.name`, 'duplicate-header');
		names.add(name.toLowerCase());
		if (!glob.trim()) throw new RelayRuleError(`${field}.${index}.glob`, 'header-glob');
		validateGlob(glob, `${field}.${index}.glob`);
		return [name, glob];
	});
	return entries.length ? Object.fromEntries(entries) : undefined;
}

function routeConfig(draft: RelayRouteDraft, index: number, base: JsonRecord): JsonRecord {
	const field = `routes.${index}`;
	if (!relayRouteMethods.some((method) => method === draft.method.toUpperCase())) throw new RelayRuleError(`${field}.method`, 'invalid-method');
	rootedPath(draft.path, `${field}.path`);
	const config: JsonRecord = { method: draft.method, path: draft.path };
	const headers = headerConfig(draft.headers, `${field}.headers`);
	if (headers) config.headers = headers;
	for (const key of ['enabled', 'billable', 'stream'] as const) {
		if (draft[key] === '') continue;
		if (!['true', 'false'].includes(draft[key])) throw new RelayRuleError(`${field}.${key}`, 'invalid-option');
		config[key] = draft[key] === 'true';
	}
	const usage = usageConfig(draft.usage, `${field}.usage`, base);
	if (usage) config.usage = usage;
	return config;
}

export function relayRulesToJson(draft: RelayRulesDraft): RelayRulesJson {
	const usage = usageConfig(draft.usage, 'usage');
	for (const [index, { path }] of draft.streaming.entries()) rootedPath(path, `streaming.${index}.path`);
	const streaming = draft.streamingConfigured || draft.streaming.length ? { paths: draft.streaming.map(({ path }) => path) } : undefined;
	const routes = draft.routes.map((route, index) => routeConfig(route, index, usage ?? {}));
	return { usageJson: usage ? JSON.stringify(usage) : '', streamingJson: streaming ? JSON.stringify(streaming) : '', routesJson: JSON.stringify(routes) };
}

export function relayRuleMessage(cause: RelayRuleError, locale: string): string {
	const messages: Record<string, [string, string]> = {
		'unknown-field': ['包含当前上游不支持的字段，请核对配置。', 'Contains fields not supported by the current upstream contract.'],
		'invalid-json': ['配置不是有效 JSON。', 'Configuration is not valid JSON.'],
		'object-required': ['配置必须是对象。', 'Configuration must be an object.'],
		'array-required': ['路由必须是数组。', 'Routes must be an array.'],
		'text-required': ['必须填写字符串。', 'A string is required.'],
		'route-required': ['路由必须包含方法和路径。', 'A route needs a method and path.'],
		'paths-required': ['流式路径必须是字符串数组。', 'Streaming paths must be an array of strings.'],
		'boolean-required': ['选项必须是布尔值。', 'The option must be a boolean.'],
		'finite-number': ['必须填写有限数值。', 'A finite number is required.'],
		'nonnegative-number': ['必须填写大于或等于 0 的有限数值。', 'Enter a finite number greater than or equal to 0.'],
		'positive-number': ['计费块大小必须大于 0。', 'Billing block size must be greater than 0.'],
		'invalid-option': ['请选择有效选项。', 'Select a valid option.'],
		'units-path-required': ['按路径计量且单价大于 0 时，用量路径不能为空。', 'A units path is required for path-based measurement with a positive unit rate.'],
		'rooted-path': ['路径必须以 / 开头。', 'The path must start with /.'],
		'recursive-last': ['** 只能放在路径的最后一段。', '** is allowed only as the last path segment.'],
		'invalid-glob': ['匹配模式包含无效字符类或转义。', 'The glob contains an invalid character class or escape.'],
		'header-name': ['请求头名称必须是有效 HTTP token。', 'The header name must be a valid HTTP token.'],
		'duplicate-header': ['请求头名称重复（不区分大小写）。', 'Duplicate header name (case-insensitive).'],
		'header-glob': ['请求头匹配模式不能为空。', 'The header value glob cannot be empty.'],
		'invalid-method': ['请选择上游支持的请求方法。', 'Select an upstream-supported request method.'],
	};
	return messages[cause.code]?.[locale === 'zh-CN' ? 0 : 1] ?? (locale === 'zh-CN' ? '配置无效。' : 'Invalid configuration.');
}
