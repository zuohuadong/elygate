import type { ElygateLocale } from './i18n';

const columnTranslations: Record<ElygateLocale, Record<string, string>> = {
	'zh-CN': {
		id: 'ID',
		request_id: '请求 ID',
		parent_request_id: '父请求 ID',
		object: '请求类型',
		nl: '网络延迟',
		provider: '供应商',
		name: '名称',
		description: '描述',
		model: '模型',
		timestamp: '时间',
		status: '状态',
		status_code: '状态码',
		method: '方法',
		path: '路径',
		content: '内容',
		latency: '延迟',
		duration: '耗时',
		prompt_tokens: '输入 Token',
		completion_tokens: '输出 Token',
		total_tokens: '总 Token',
		cost: '成本',
		customer_id: '客户 ID',
		calendar_aligned: '日历重置',
		budgets: '预算',
		rate_limit: '限流',
		enabled: '启用',
		scope: '范围',
		scope_id: '范围 ID',
		priority: '优先级',
		cel_expression: 'CEL 表达式',
		targets: '目标',
		model_name: '模型名称',
		virtual_key_id: '虚拟密钥 ID',
		provider_id: '供应商 ID',
		provider_key_id: '密钥 ID',
		scope_kind: '范围类型',
		match_type: '匹配方式',
		pattern: '匹配模式',
		request_types: '请求类型',
		url: 'URL',
		events: '事件',
		disabled: '停用',
		include_response: '包含响应',
		failure_count: '失败次数',
		kind: '类型',
		auth_kind: '认证类型',
		auth_mode: '认证模式',
		user_id: '用户 ID',
		virtual_key: '虚拟密钥',
		mcp_client: 'MCP 客户端',
		server_label: '服务标签',
		tool_name: '工具',
		actualName: '实际名称',
		isCustom: '自定义',
		version: '版本',
		license: '许可证',
		compatibility: '兼容性',
		folder_id: '目录 ID',
		created_at: '创建时间',
		updated_at: '更新时间',
		expires_at: '过期时间',
		max_limit: '上限',
		current_usage: '当前用量',
		reset_duration: '重置周期',
		last_reset: '上次重置',
		token_max_limit: 'Token 上限',
		token_current_usage: 'Token 用量',
		request_max_limit: '请求上限',
		request_current_usage: '请求用量',
	},
	en: {
		id: 'ID',
		request_id: 'Request ID',
		parent_request_id: 'Parent request ID',
		object: 'Request type',
		nl: 'Network latency',
		provider: 'Provider',
		name: 'Name',
		description: 'Description',
		model: 'Model',
		timestamp: 'Timestamp',
		status: 'Status',
		status_code: 'Status code',
		method: 'Method',
		path: 'Path',
		content: 'Content',
		latency: 'Latency',
		duration: 'Duration',
		prompt_tokens: 'Input tokens',
		completion_tokens: 'Output tokens',
		total_tokens: 'Total tokens',
		cost: 'Cost',
		customer_id: 'Customer ID',
		calendar_aligned: 'Calendar aligned',
		budgets: 'Budgets',
		rate_limit: 'Rate limit',
		enabled: 'Enabled',
		scope: 'Scope',
		scope_id: 'Scope ID',
		priority: 'Priority',
		cel_expression: 'CEL expression',
		targets: 'Targets',
		model_name: 'Model name',
		virtual_key_id: 'Virtual key ID',
		provider_id: 'Provider ID',
		provider_key_id: 'Key ID',
		scope_kind: 'Scope kind',
		match_type: 'Match type',
		pattern: 'Pattern',
		request_types: 'Request types',
		url: 'URL',
		events: 'Events',
		disabled: 'Disabled',
		include_response: 'Include response',
		failure_count: 'Failures',
		kind: 'Kind',
		auth_kind: 'Auth kind',
		auth_mode: 'Auth mode',
		user_id: 'User ID',
		virtual_key: 'Virtual key',
		mcp_client: 'MCP client',
		server_label: 'Server label',
		tool_name: 'Tool',
		actualName: 'Actual name',
		isCustom: 'Custom',
		version: 'Version',
		license: 'License',
		compatibility: 'Compatibility',
		folder_id: 'Folder ID',
		created_at: 'Created at',
		updated_at: 'Updated at',
		expires_at: 'Expires at',
		max_limit: 'Max limit',
		current_usage: 'Current usage',
		reset_duration: 'Reset duration',
		last_reset: 'Last reset',
		token_max_limit: 'Token max',
		token_current_usage: 'Token usage',
		request_max_limit: 'Request max',
		request_current_usage: 'Request usage',
	},
};

export function columnLabelFor(locale: ElygateLocale, column: string): string {
	const translated = columnTranslations[locale][column];
	if (translated) return translated;
	if (locale === 'zh-CN') return column;
	const words = column.replace(/[_-]+/g, ' ').trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : column;
}

const BOOLEAN_COLUMNS = new Set(['enabled', 'disabled', 'calendar_aligned', 'include_response', 'isCustom']);
const DATE_COLUMNS = new Set(['created_at', 'updated_at', 'expires_at', 'last_reset', 'timestamp', 'last_success_at', 'last_failure_at']);

const enumValueTranslations: Record<ElygateLocale, Record<string, Record<string, string>>> = {
	'zh-CN': {
		kind: { token: '令牌', flow: '授权流', header: '凭证' },
		auth_kind: { oauth: 'OAuth', headers: '请求头凭证' },
		auth_mode: { headers: '请求头凭证', both: '请求头与 OAuth', oauth: '仅 OAuth' },
		status: {
			active: '生效',
			orphaned: '孤立',
			pending: '待完成',
			needs_reauth: '需重新认证',
			needs_update: '待更新',
		},
		scope: { global: '全局', provider: '供应商', virtual_key: '虚拟密钥', user: '用户' },
		scope_kind: {
			global: '全局',
			virtual_key: '虚拟密钥',
			provider: '供应商',
			provider_key: '供应商密钥',
			user: '用户',
		},
		match_type: { exact: '精确匹配', prefix: '前缀匹配', suffix: '后缀匹配', regex: '正则匹配' },
	},
	en: {
		kind: { token: 'Token', flow: 'Auth flow', header: 'Credential' },
		auth_kind: { oauth: 'OAuth', headers: 'Header credentials' },
		auth_mode: { headers: 'Header credentials', both: 'Headers and OAuth', oauth: 'OAuth only' },
		status: {
			active: 'Active',
			orphaned: 'Orphaned',
			pending: 'Pending',
			needs_reauth: 'Needs reauth',
			needs_update: 'Needs update',
		},
		scope: { global: 'Global', provider: 'Provider', virtual_key: 'Virtual key', user: 'User' },
		scope_kind: {
			global: 'Global',
			virtual_key: 'Virtual key',
			provider: 'Provider',
			provider_key: 'Provider key',
			user: 'User',
		},
		match_type: { exact: 'Exact', prefix: 'Prefix', suffix: 'Suffix', regex: 'Regex' },
	},
};

const booleanValueTranslations: Record<ElygateLocale, Record<string, string>> = {
	'zh-CN': { true: '是', false: '否' },
	en: { true: 'Yes', false: 'No' },
};

function padDatePart(value: number): string {
	return String(value).padStart(2, '0');
}

export function formatLocalDateTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return [
		date.getFullYear(),
		padDatePart(date.getMonth() + 1),
		padDatePart(date.getDate()),
	].join('-') + ` ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;
}

export function columnValueFor(locale: ElygateLocale, column: string, value: unknown): string {
	if (value === null || value === undefined) return '—';
	if (BOOLEAN_COLUMNS.has(column) && typeof value === 'boolean') {
		return booleanValueTranslations[locale][String(value)];
	}
	if (typeof value === 'string') {
		if (DATE_COLUMNS.has(column) && value) return formatLocalDateTime(value);
		const table = enumValueTranslations[locale][column];
		if (table && table[value]) return table[value];
	}
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	if (Array.isArray(value)) return value.map((item) => columnValueFor(locale, column, item)).join(', ');
	return JSON.stringify(value);
}
