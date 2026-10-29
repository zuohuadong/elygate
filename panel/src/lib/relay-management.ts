import type { JsonRecord } from './api';

export const relayAuthTypes = ['bearer', 'header', 'query', 'basic', 'aws_sigv4', 'none'] as const;
export type RelayAuthType = typeof relayAuthTypes[number];

export interface RelayDraft {
	name: string;
	description: string;
	baseUrl: string;
	authType: RelayAuthType;
	headerName: string;
	queryParam: string;
	valuePrefix: string;
	awsService: string;
	awsRegion: string;
	initialAwsRegion: string;
	credentialValue: string;
	credentialJson: string;
	extraHeadersJson: string;
	networkJson: string;
	proxyConfigJson: string;
	usageJson: string;
	streamingJson: string;
	routesJson: string;
	skipRouteCheck: boolean;
	ignoreUpstreamCost: boolean;
}

export const emptyRelayDraft = (): RelayDraft => ({
	name: '',
	description: '',
	baseUrl: '',
	authType: 'bearer',
	headerName: '',
	queryParam: '',
	valuePrefix: '',
	awsService: '',
	awsRegion: '',
	initialAwsRegion: '',
	credentialValue: '',
	credentialJson: '',
	extraHeadersJson: '{}',
	networkJson: '',
	proxyConfigJson: '',
	usageJson: '',
	streamingJson: '',
	routesJson: '[]',
	skipRouteCheck: false,
	ignoreUpstreamCost: false,
});

function objectValue(value: unknown): JsonRecord {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function secretInput(value: unknown): string {
	if (typeof value === 'string') return value;
	const secret = objectValue(value);
	return stringValue(secret.ref) || stringValue(secret.value);
}

function pretty(value: unknown, fallback = ''): string {
	return value == null ? fallback : JSON.stringify(value, null, 2);
}

export function relayDraftFromConfig(config: JsonRecord): RelayDraft {
	const auth = objectValue(config.auth);
	const credential = objectValue(config.credential);
	const awsCredential = objectValue(credential.aws);
	return {
		...emptyRelayDraft(),
		name: stringValue(config.name),
		description: stringValue(config.description),
		baseUrl: stringValue(config.base_url),
		authType: relayAuthTypes.includes(String(auth.type) as RelayAuthType) ? String(auth.type) as RelayAuthType : 'bearer',
		headerName: stringValue(auth.header_name),
		queryParam: stringValue(auth.query_param),
		valuePrefix: stringValue(auth.value_prefix),
		awsService: stringValue(objectValue(auth.aws).service),
		awsRegion: secretInput(awsCredential.region),
		initialAwsRegion: secretInput(awsCredential.region),
		credentialJson: pretty(config.credential),
		extraHeadersJson: pretty(config.extra_headers, '{}'),
		networkJson: pretty(config.network),
		proxyConfigJson: pretty(config.proxy_config),
		usageJson: pretty(config.usage),
		streamingJson: pretty(config.streaming),
		routesJson: pretty(config.routes, '[]'),
		skipRouteCheck: config.skip_route_check === true,
		ignoreUpstreamCost: config.ignore_upstream_cost === true,
	};
}

function parseJson(value: string, label: string, expected: 'object' | 'array'): JsonRecord | unknown[] | undefined {
	if (!value.trim()) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error(`${label}-json`);
	}
	if ((expected === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)))
		|| (expected === 'array' && !Array.isArray(parsed))) {
		throw new Error(`${label}-shape`);
	}
	return parsed as JsonRecord | unknown[];
}

export function buildRelayPayload(draft: RelayDraft, editingName = ''): JsonRecord {
	const name = draft.name.trim();
	if (!name) throw new Error('name-required');
	if (!/^[A-Za-z0-9._-]{1,64}$/.test(name) || name === '.' || name === '..') throw new Error('name-invalid');
	if (editingName && editingName !== name) throw new Error('name-immutable');
	if (!relayAuthTypes.includes(draft.authType)) throw new Error('invalid-auth-type');
	if (!draft.baseUrl.trim()) throw new Error('base-url-required');
	try {
		const parsed = new URL(draft.baseUrl.trim());
		if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
	} catch {
		throw new Error('base-url-invalid');
	}

	const payload: JsonRecord = {
		name,
		description: draft.description.trim() || undefined,
		base_url: draft.baseUrl.trim(),
		auth: {
			type: draft.authType,
			header_name: draft.headerName.trim() || undefined,
			query_param: draft.queryParam.trim() || undefined,
			value_prefix: draft.valuePrefix || undefined,
			aws: draft.authType === 'aws_sigv4' ? { service: draft.awsService.trim() } : undefined,
		},
		skip_route_check: draft.skipRouteCheck,
		ignore_upstream_cost: draft.ignoreUpstreamCost,
		extra_headers: parseJson(draft.extraHeadersJson, 'extra-headers', 'object'),
		network: parseJson(draft.networkJson, 'network', 'object'),
		proxy_config: parseJson(draft.proxyConfigJson, 'proxy-config', 'object'),
		usage: parseJson(draft.usageJson, 'usage', 'object'),
		streaming: parseJson(draft.streamingJson, 'streaming', 'object'),
		routes: parseJson(draft.routesJson, 'routes', 'array'),
	};

	if (draft.authType === 'header' && !draft.headerName.trim()) throw new Error('header-name-required');
	if (draft.authType === 'query' && !draft.queryParam.trim()) throw new Error('query-param-required');
	if (draft.authType === 'aws_sigv4' && !draft.awsRegion.trim() && !draft.credentialJson.trim()) throw new Error('aws-region-required');
	if (draft.authType === 'none') {
		delete payload.credential;
	} else if (draft.credentialValue.trim() && draft.authType !== 'aws_sigv4') {
		payload.credential = { value: draft.credentialValue };
	} else if (draft.credentialJson.trim()) {
		payload.credential = parseJson(draft.credentialJson, 'credential', 'object');
	} else if (draft.authType === 'aws_sigv4' && draft.awsRegion.trim()) {
		payload.credential = { aws: { region: { value: draft.awsRegion.trim() } } };
	} else {
		throw new Error('credential-required');
	}
	if (draft.authType === 'aws_sigv4' && draft.awsRegion.trim()) {
		const credential = objectValue(payload.credential);
		const aws = objectValue(credential.aws);
		if (draft.awsRegion !== draft.initialAwsRegion || !aws.region) aws.region = draft.awsRegion.trim();
		payload.credential = { ...credential, aws };
	}
	return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

export function relayLogParams(filters: { search: string; relayName: string; method: string; status: string; kind: string; period: string }, now = Date.now()): URLSearchParams {
	const periods: Record<string, number> = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };
	const hours = periods[filters.period];
	if (!hours) throw new Error('invalid-log-period');
	const params = new URLSearchParams({
		start_time: new Date(now - hours * 3_600_000).toISOString(),
		end_time: new Date(now).toISOString(),
	});
	for (const [key, value] of Object.entries({
		search: filters.search.trim(), relay_names: filters.relayName, methods: filters.method, statuses: filters.status, kinds: filters.kind,
	})) if (value) params.set(key, value);
	return params;
}

export function relayValidationMessage(error: unknown, locale: 'zh-CN' | 'en'): string {
	const zh = locale === 'zh-CN';
	if (!(error instanceof Error)) return zh ? '操作失败。' : 'Operation failed.';
	const messages: Record<string, [string, string]> = {
		'name-required': ['名称为必填项。', 'Name is required.'],
		'name-invalid': ['名称只能包含字母、数字、点、下划线和连字符，长度不超过 64。', 'Name may contain letters, digits, dots, underscores and hyphens, up to 64 characters.'],
		'name-immutable': ['Relay 名称创建后不可修改。', 'A relay name cannot be changed.'],
		'base-url-required': ['上游地址为必填项。', 'Base URL is required.'],
		'base-url-invalid': ['上游地址必须是无查询参数、无用户信息的绝对 HTTP(S) 地址。', 'Base URL must be an absolute HTTP(S) URL without query, fragment or user info.'],
		'header-name-required': ['Header 认证必须填写请求头名称。', 'Header authentication requires a header name.'],
		'query-param-required': ['Query 认证必须填写参数名称。', 'Query authentication requires a query parameter name.'],
		'aws-region-required': ['AWS SigV4 必须填写签名区域，或提供完整 AWS 凭据 JSON。', 'AWS SigV4 requires a signing region or a complete AWS credential JSON.'],
		'credential-required': ['当前认证方式需要凭据；编辑时请保留脱敏凭据或输入新值。', 'This auth type requires a credential; keep the redacted value on edit or enter a new one.'],
		'extra-headers-json': ['额外请求头必须是有效 JSON。', 'Extra headers must be valid JSON.'],
		'network-json': ['网络配置必须是有效 JSON。', 'Network config must be valid JSON.'],
		'proxy-config-json': ['代理配置必须是有效 JSON。', 'Proxy config must be valid JSON.'],
		'usage-json': ['用量配置必须是有效 JSON。', 'Usage config must be valid JSON.'],
		'streaming-json': ['流式配置必须是有效 JSON。', 'Streaming config must be valid JSON.'],
		'routes-json': ['路由配置必须是 JSON 数组。', 'Routes config must be a JSON array.'],
		'credential-json': ['凭据引用必须是 JSON 对象。', 'Credential reference must be a JSON object.'],
		'credential-shape': ['凭据配置必须是 JSON 对象。', 'Credential config must be a JSON object.'],
		'routes-shape': ['路由配置必须是 JSON 数组。', 'Routes config must be a JSON array.'],
		'extra-headers-shape': ['额外请求头必须是 JSON 对象。', 'Extra headers must be a JSON object.'],
		'network-shape': ['网络配置必须是 JSON 对象。', 'Network config must be a JSON object.'],
		'proxy-config-shape': ['代理配置必须是 JSON 对象。', 'Proxy config must be a JSON object.'],
		'usage-shape': ['用量配置必须是 JSON 对象。', 'Usage config must be a JSON object.'],
		'streaming-shape': ['流式配置必须是 JSON 对象。', 'Streaming config must be a JSON object.'],
	};
	return messages[error.message]?.[zh ? 0 : 1] ?? error.message;
}
