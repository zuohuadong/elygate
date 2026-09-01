import { csv, parseJsonObject } from './forms';
import type { JsonRecord } from './api';
import type { ElygateLocale } from './i18n';

export type McpConnectionType = 'http' | 'sse' | 'stdio';
export type McpAuthType = 'none' | 'headers' | 'oauth' | 'per_user_oauth' | 'per_user_headers';

type McpCatalogField = 'category' | 'source' | 'tag';

const catalogCategoriesZh: Record<string, string> = {
	'AI Tools': 'AI 工具', Analytics: '分析', Communication: '通信', 'Customer Support': '客户支持', Design: '设计',
	'Developer Tools': '开发者工具', 'E-Commerce': '电子商务', Finance: '金融', 'Human Resources': '人力资源', Legal: '法务',
	Lifestyle: '生活方式', Marketing: '营销', Productivity: '生产力', 'Project Management': '项目管理', Research: '研究',
	Sales: '销售', Search: '搜索', Security: '安全', Travel: '旅行',
};

const catalogSourcesZh: Record<string, string> = { remote: '远程目录', custom: '自定义' };
const catalogTagsZh: Record<string, string> = {
	academic: '学术', accounting: '会计', adobe: 'Adobe', ads: '广告', ai: 'AI', analytics: '分析', api: 'API',
	applications: '应用', architecture: '架构', assets: '资产', audiences: '受众', audio: '音频', auth: '认证',
	authentication: '认证', automation: '自动化', backlinks: '反向链接', behavioral: '行为分析', benchmarking: '基准测试',
	bi: '商业智能', billing: '计费', booking: '预订', bookings: '预订', browser: '浏览器', budgeting: '预算',
	'bug-reports': '缺陷报告', calendar: '日历', calls: '通话', campaigns: '营销活动', channels: '渠道', 'ci-cd': '持续集成与交付',
	citations: '引用', cli: '命令行', cloud: '云服务', code: '代码', collaboration: '协作', collections: '集合',
	comments: '评论', communication: '通信', communications: '通信', companies: '企业', compliance: '合规', components: '组件',
	contacts: '联系人', content: '内容', 'content-extraction': '内容提取', contracts: '合同', conversations: '对话', creative: '创意',
	crm: '客户关系管理', crypto: '加密资产', 'customer-insights': '客户洞察', 'customer-support': '客户支持', data: '数据',
	'data-integration': '数据集成', 'data-science': '数据科学', 'data-warehouse': '数据仓库', database: '数据库', datasets: '数据集',
	debugging: '调试', decks: '演示文稿', deployments: '部署', design: '设计', diagrams: '图表', docs: '文档',
	documentation: '文档', documents: '文档', domains: '域名', ecommerce: '电子商务', email: '电子邮件', 'email-marketing': '邮件营销',
	enrichment: '数据增强', environments: '环境', equities: '股票', errors: '错误', evaluation: '评估', events: '事件',
	expenses: '费用', exports: '导出', 'feature-flags': '功能开关', feedback: '反馈', files: '文件', finance: '金融',
	'financial-data': '金融数据', fintech: '金融科技', flights: '航班', forms: '表单', funding: '融资', git: 'Git',
	grants: '授权', headcount: '人员规模', helpdesk: '服务台', hiring: '招聘', hosting: '托管', hotels: '酒店', hr: '人力资源',
	images: '图像', insights: '洞察', interviews: '面试', inventory: '库存', invoices: '发票', invoicing: '开票',
	issues: '问题', 'journey-optimizer': '旅程优化', keywords: '关键词', 'knowledge-base': '知识库', lead: '线索',
	'lead-generation': '潜在客户获取', legal: '法务', libraries: '资源库', lifestyle: '生活方式', local: '本地',
	'local-search': '本地搜索', logs: '日志', malware: '恶意软件', marketing: '营销', media: '媒体', meetings: '会议',
	messages: '消息', models: '模型', monitoring: '监控', music: '音乐', news: '新闻', newsletters: '简报', notebooks: '笔记本',
	notes: '笔记', observability: '可观测性', orchestration: '编排', orders: '订单', partnerships: '合作伙伴', payments: '支付',
	people: '人员', 'people-analytics': '人员分析', personal: '个人', 'personal-finance': '个人财务', phishing: '网络钓鱼',
	presentations: '演示文稿', privacy: '隐私', procurement: '采购', productivity: '生产力', products: '产品',
	'project-management': '项目管理', projects: '项目', recruiting: '招聘', reporting: '报告', repositories: '代码仓库',
	research: '研究', safety: '安全防护', sales: '销售', samples: '示例', scheduling: '排期', science: '科学',
	search: '搜索', security: '安全', seo: '搜索引擎优化', shapes: '图形', signatures: '签名', sms: '短信', social: '社交',
	spreadsheet: '电子表格', stocks: '股票', storage: '存储', support: '支持', surveys: '调查', tasks: '任务', testing: '测试',
	ticketing: '工单', tickets: '工单', tracing: '链路追踪', trading: '交易', traffic: '流量', transactions: '交易记录',
	transcripts: '转录', travel: '旅行', tweets: '推文', ui: '界面', users: '用户', video: '视频', visibility: '可见性',
	vulnerabilities: '漏洞', wealth: '财富管理', web: '网页', 'web-search': '网页搜索', websites: '网站', workflows: '工作流',
	workforce: '劳动力', workspaces: '工作区',
};
const catalogDescriptionsZh: Record<string, string> = {
	'Adobe Journey Optimizer': '将 AI 工具连接到 Adobe Journey Optimizer，用于查看状态、发现草稿问题并了解编排组合。由 Adobe 提供远程托管。',
	'Adobe Marketing Agent': '将 AI 工具连接到 Adobe，以获取营销活动和受众洞察。由 Adobe 提供远程托管。',
};

function jsonRecord(value: unknown): JsonRecord | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function catalogTranslation(metadata: unknown, field: 'name' | 'description'): string {
	const i18n = jsonRecord(jsonRecord(metadata)?.i18n);
	const zh = jsonRecord(i18n?.['zh-CN']) ?? jsonRecord(i18n?.zh);
	return typeof zh?.[field] === 'string' ? String(zh[field]).trim() : '';
}

export function localizeMcpCatalogValue(locale: ElygateLocale, field: McpCatalogField, value: unknown): string {
	const raw = String(value ?? '').trim();
	if (locale !== 'zh-CN' || !raw) return raw;
	const translated = field === 'category' ? catalogCategoriesZh[raw] : field === 'source' ? catalogSourcesZh[raw] : catalogTagsZh[raw];
	if (translated) return translated;
	if (field === 'tag') return `专有标签：${raw.replaceAll('-', ' ')}`;
	return `其他${field === 'category' ? '分类' : '来源'}：${raw}`;
}

export function localizeMcpCatalogDescription(
	locale: ElygateLocale,
	name: unknown,
	category: unknown,
	description: unknown,
	metadata?: unknown,
): string {
	const original = String(description ?? '');
	if (locale !== 'zh-CN' || !original || /[\u3400-\u9fff]/u.test(original)) return original;
	const translatedDescription = catalogTranslation(metadata, 'description') || catalogDescriptionsZh[String(name ?? '')];
	if (translatedDescription) return `${translatedDescription}\n英文原文：${original}`;
	const serverName = catalogTranslation(metadata, 'name') || String(name ?? 'MCP 服务');
	const categoryName = localizeMcpCatalogValue(locale, 'category', category) || '未分类';
	return `中文分类摘要：${serverName}；目录分类：${categoryName}。\n英文原文：${original}`;
}

export async function refreshMcpData(
	reset: boolean,
	loadMetadata: () => Promise<void>,
	loadRecords: (reset: boolean) => Promise<void>,
): Promise<void> {
	await loadMetadata();
	await loadRecords(reset);
}

export function createCoalescedRefresh(
	run: (reset: boolean) => Promise<void>,
): (reset?: boolean) => Promise<void> {
	let active: Promise<void> | null = null;
	let rerun = false;
	let pendingReset = false;

	return (reset = false): Promise<void> => {
		if (active) {
			rerun = true;
			pendingReset ||= reset;
			return active;
		}
		active = (async () => {
			let cycleReset = reset;
			do {
				rerun = false;
				cycleReset ||= pendingReset;
				pendingReset = false;
				await run(cycleReset);
				cycleReset = false;
			} while (rerun);
		})().finally(() => {
			active = null;
		});
		return active;
	};
}

export interface McpClientDraft {
	name: string;
	connectionType: McpConnectionType;
	connectionValue: string;
	command: string;
	args: string;
	envs: string;
	authType: McpAuthType;
	headersJson: string;
	perUserHeaderKeys: string;
	userHeadersJson: string;
	oauthClientId: string;
	oauthClientSecret: string;
	authorizeUrl: string;
	tokenUrl: string;
	registrationUrl: string;
	scopes: string;
	resource: string;
	tlsSkipVerify: boolean;
	caCert: string;
	codeMode: boolean;
	ping: boolean;
	disabled: boolean;
	allVirtualKeys: boolean;
	toolSyncMinutes: string | number;
	toolExecutionSeconds: string | number;
	allowedExtraHeaders: string;
	advancedJson: string;
}

export interface McpClientFilters {
	search?: string;
	server?: string;
	connectionTypes?: string[];
	authTypes?: string[];
	states?: string[];
	virtualKeys?: string[];
	codeMode?: boolean;
	disabled?: boolean;
	allVirtualKeys?: boolean;
	limit: number;
	offset: number;
}

export interface McpLibraryFilters {
	search?: string;
	categories?: string[];
	connectionTypes?: string[];
	authTypes?: string[];
	tags?: string[];
	sortBy?: string;
	order?: 'asc' | 'desc';
	limit: number;
	offset: number;
}

export interface McpSessionFilters {
	search?: string;
	identity?: string;
	kinds?: string[];
	statuses?: string[];
	authModes?: string[];
	clientIds?: string[];
	limit: number;
	offset: number;
}

function positiveNumber(value: string | number | undefined): number | undefined {
	if (value === undefined || String(value).trim() === '') return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) throw new Error('invalid-number');
	return parsed;
}

function setCsv(params: URLSearchParams, key: string, values?: string[]): void {
	if (values?.length) params.set(key, values.join(','));
}

export function buildMcpClientQuery(filters: McpClientFilters): string {
	const params = new URLSearchParams({ limit: String(filters.limit), offset: String(filters.offset) });
	if (filters.search?.trim()) params.set('search', filters.search.trim());
	if (filters.server?.trim()) params.set('server', filters.server.trim());
	setCsv(params, 'connection_type', filters.connectionTypes);
	setCsv(params, 'auth_type', filters.authTypes);
	setCsv(params, 'state', filters.states);
	setCsv(params, 'virtual_keys', filters.virtualKeys);
	if (filters.codeMode !== undefined) params.set('code_mode', String(filters.codeMode));
	if (filters.disabled !== undefined) params.set('disabled', String(filters.disabled));
	if (filters.allVirtualKeys) params.set('all_virtual_keys', 'true');
	return params.toString();
}

export function buildMcpLibraryQuery(filters: McpLibraryFilters): string {
	const params = new URLSearchParams({ limit: String(filters.limit), offset: String(filters.offset) });
	if (filters.search?.trim()) params.set('search', filters.search.trim());
	setCsv(params, 'category', filters.categories);
	setCsv(params, 'connection_type', filters.connectionTypes);
	setCsv(params, 'auth_type', filters.authTypes);
	setCsv(params, 'tags', filters.tags);
	if (filters.sortBy) params.set('sort_by', filters.sortBy);
	if (filters.order) params.set('order', filters.order);
	return params.toString();
}

export function buildMcpSessionQuery(filters: McpSessionFilters): string {
	const params = new URLSearchParams({ limit: String(filters.limit), offset: String(filters.offset) });
	if (filters.search?.trim()) params.set('q', filters.search.trim());
	if (filters.identity?.trim()) params.set('identity', filters.identity.trim());
	setCsv(params, 'kind', filters.kinds);
	setCsv(params, 'status', filters.statuses);
	setCsv(params, 'auth_mode', filters.authModes);
	setCsv(params, 'mcp_client_id', filters.clientIds);
	return params.toString();
}

export function buildOAuthGrantQuery(search: string, modes: string[], limit: number, offset: number): string {
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (search.trim()) params.set('q', search.trim());
	setCsv(params, 'bf_mode', modes);
	return params.toString();
}

export function createEmptyMcpClientDraft(): McpClientDraft {
	return {
		name: '',
		connectionType: 'http',
		connectionValue: '',
		command: '',
		args: '',
		envs: '',
		authType: 'none',
		headersJson: '{}',
		perUserHeaderKeys: '',
		userHeadersJson: '{}',
		oauthClientId: '',
		oauthClientSecret: '',
		authorizeUrl: '',
		tokenUrl: '',
		registrationUrl: '',
		scopes: '',
		resource: '',
		tlsSkipVerify: false,
		caCert: '',
		codeMode: false,
		ping: true,
		disabled: false,
		allVirtualKeys: false,
		toolSyncMinutes: '',
		toolExecutionSeconds: '',
		allowedExtraHeaders: '',
		advancedJson: '{}',
	};
}

function optionalSecret(value: string): JsonRecord | undefined {
	return value.trim() ? { value: value.trim(), ref: '' } : undefined;
}

function compactRecord(value: JsonRecord): JsonRecord {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function buildMcpClientPayload(draft: McpClientDraft, editing: boolean): JsonRecord {
	const name = draft.name.trim();
	if (!name) throw new Error('name-required');
	if (!editing && !/^[a-zA-Z_][a-zA-Z0-9_]{2,49}$/.test(name)) throw new Error('name-invalid');
	const advanced = parseJsonObject(draft.advancedJson, 'advanced');
	const headers = parseJsonObject(draft.headersJson, 'headers');
	const userHeaders = parseJsonObject(draft.userHeadersJson, 'user_headers');
	const perUserHeaderKeys = csv(draft.perUserHeaderKeys);
	if (draft.authType === 'per_user_headers' && perUserHeaderKeys.length === 0) throw new Error('header-keys-required');

	const base: JsonRecord = {
		...advanced,
		name,
		is_code_mode_client: draft.codeMode,
		is_ping_available: draft.ping,
		disabled: draft.disabled,
		allow_on_all_virtual_keys: draft.allVirtualKeys,
		tool_sync_interval: positiveNumber(draft.toolSyncMinutes),
		tool_execution_timeout: positiveNumber(draft.toolExecutionSeconds),
		allowed_extra_headers: csv(draft.allowedExtraHeaders),
	};

	if (editing) {
		if (Object.keys(headers).length) base.headers = headers;
		if (draft.authType === 'per_user_headers') base.per_user_header_keys = perUserHeaderKeys;
		if (draft.caCert.trim() || draft.tlsSkipVerify) base.tls_config = compactRecord({ insecure_skip_verify: draft.tlsSkipVerify, ca_cert_pem: optionalSecret(draft.caCert) });
		if ((draft.authType === 'oauth' || draft.authType === 'per_user_oauth') && (draft.oauthClientId.trim() || draft.oauthClientSecret.trim())) {
			base.oauth_config = compactRecord({ client_id: optionalSecret(draft.oauthClientId), client_secret: optionalSecret(draft.oauthClientSecret) });
		}
		return compactRecord(base);
	}

	base.connection_type = draft.connectionType;
	base.auth_type = draft.connectionType === 'stdio' ? 'none' : draft.authType;
	base.tools_to_execute = ['*'];
	if (draft.connectionType === 'stdio') {
		if (!draft.command.trim()) throw new Error('command-required');
		base.stdio_config = { command: draft.command.trim(), args: csv(draft.args), envs: csv(draft.envs) };
	} else {
		if (!draft.connectionValue.trim()) throw new Error('connection-required');
		base.connection_string = { value: draft.connectionValue.trim(), ref: '' };
		if (draft.caCert.trim() || draft.tlsSkipVerify) base.tls_config = compactRecord({ insecure_skip_verify: draft.tlsSkipVerify, ca_cert_pem: optionalSecret(draft.caCert) });
	}
	if (draft.authType === 'headers' || draft.authType === 'per_user_headers') {
		if (Object.keys(headers).length) base.headers = headers;
	}
	if (draft.authType === 'per_user_headers') {
		base.per_user_header_keys = perUserHeaderKeys;
		if (Object.keys(userHeaders).length) base.user_headers = userHeaders;
	}
	if (draft.authType === 'oauth' || draft.authType === 'per_user_oauth') {
		base.oauth_config = compactRecord({
			client_id: optionalSecret(draft.oauthClientId) ?? { value: '', ref: '' },
			client_secret: optionalSecret(draft.oauthClientSecret),
			authorize_url: draft.authorizeUrl.trim() || undefined,
			token_url: draft.tokenUrl.trim() || undefined,
			registration_url: draft.registrationUrl.trim() || undefined,
			scopes: csv(draft.scopes),
			server_url: draft.connectionValue.trim() || undefined,
			resource: draft.resource.trim() || undefined,
		});
	}
	return compactRecord(base);
}

export function buildLibraryClientPayload(server: JsonRecord, name: string, overrides: JsonRecord = {}): JsonRecord {
	const connectionType = server.connection_type === 'stdio' || server.connection_type === 'sse' ? server.connection_type : 'http';
	const payload: JsonRecord = {
		...overrides,
		name: name.trim(),
		connection_type: connectionType,
		auth_type: typeof server.auth_type === 'string' ? server.auth_type : 'none',
		is_code_mode_client: false,
		is_ping_available: true,
		tools_to_execute: ['*'],
	};
	if (!payload.name) throw new Error('name-required');
	if (connectionType === 'stdio') {
		payload.stdio_config = server.stdio_config ?? { command: '', args: [], envs: [] };
	} else {
		payload.connection_string = { value: typeof server.connection_url === 'string' ? server.connection_url : '', ref: '' };
	}
	if (Array.isArray(server.required_header_keys) && server.auth_type === 'per_user_headers') payload.per_user_header_keys = server.required_header_keys;
	return payload;
}
