import { isJsonRecord, type JsonRecord } from './api';

export type GovernanceEntityKind = 'team' | 'customer' | 'provider';
export type PricingScopeKind =
	| 'global'
	| 'provider'
	| 'provider_key'
	| 'virtual_key'
	| 'virtual_key_provider'
	| 'virtual_key_provider_key'
	| 'user'
	| 'user_provider'
	| 'user_provider_key';
export type PricingMatchType = 'exact' | 'wildcard';

export interface BudgetDraft {
	key: string;
	maxLimit: string | number;
	resetDuration: string;
}

export interface GovernanceDraft {
	name: string;
	provider: string;
	customerId: string;
	calendarAligned: boolean;
	budgets: BudgetDraft[];
	tokenMaxLimit: string | number;
	tokenResetDuration: string;
	requestMaxLimit: string | number;
	requestResetDuration: string;
}

export interface PricingOverrideDraft {
	name: string;
	scopeKind: PricingScopeKind;
	userId: string;
	virtualKeyId: string;
	providerId: string;
	providerKeyId: string;
	matchType: PricingMatchType;
	pattern: string;
	requestTypes: string[];
	patchJson: string;
}

export const RESET_DURATIONS = ['1m', '5m', '15m', '30m', '1h', '6h', '1d', '1w', '1M'] as const;


const RESET_DURATION_LABELS_ZH: Record<string, string> = {
	'30s': '30 秒',
	'1m': '1 分钟',
	'5m': '5 分钟',
	'15m': '15 分钟',
	'30m': '30 分钟',
	'1h': '1 小时',
	'6h': '6 小时',
	'1d': '1 天',
	'1w': '1 周',
	'1M': '1 个月',
	'1Q': '1 个季度',
};

export function resetDurationLabel(duration: string, locale: string): string {
	return locale.startsWith('zh') ? RESET_DURATION_LABELS_ZH[duration] ?? duration : duration;
}
export const REQUEST_TYPES = [
	'chat_completion', 'text_completion', 'responses', 'embedding', 'rerank', 'speech', 'transcription',
	'image_generation', 'image_variation', 'image_edit', 'video_generation', 'video_remix', 'ocr',
] as const;
export const PRICING_SCOPE_KINDS: PricingScopeKind[] = [
	'global', 'provider', 'provider_key', 'virtual_key', 'virtual_key_provider', 'virtual_key_provider_key',
	'user', 'user_provider', 'user_provider_key',
];

function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function objectArray(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.filter(isJsonRecord) : []; }
function finiteNumber(value: string | number, field: string, minimum: number): number | undefined {
	const raw = String(value).trim();
	if (!raw) return undefined;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`${field}-invalid`);
	return parsed;
}
function positiveInteger(value: string | number, field: string): number | undefined {
	const parsed = finiteNumber(value, field, 1);
	if (parsed !== undefined && !Number.isInteger(parsed)) throw new Error(`${field}-invalid`);
	return parsed;
}
function rateLimitFromDraft(draft: GovernanceDraft): JsonRecord | undefined {
	const token = positiveInteger(draft.tokenMaxLimit, 'token-limit');
	const requests = positiveInteger(draft.requestMaxLimit, 'request-limit');
	if (token === undefined && requests === undefined) return undefined;
	return {
		...(token === undefined ? {} : { token_max_limit: token, token_reset_duration: draft.tokenResetDuration }),
		...(requests === undefined ? {} : { request_max_limit: requests, request_reset_duration: draft.requestResetDuration }),
	};
}
function budgetsFromDraft(draft: GovernanceDraft): JsonRecord[] {
	const budgets = draft.budgets
		.filter((budget) => String(budget.maxLimit).trim())
		.map((budget, index) => ({
			max_limit: finiteNumber(budget.maxLimit, `budget-${index}`, 0.01)!,
			reset_duration: budget.resetDuration,
		}));
	const durations = budgets.map((budget) => String(budget.reset_duration));
	if (new Set(durations).size !== durations.length) throw new Error('budget-duration-duplicate');
	return budgets;
}

export function emptyGovernanceDraft(kind: GovernanceEntityKind, provider = ''): GovernanceDraft {
	return {
		name: '', provider: kind === 'provider' ? provider : '', customerId: '', calendarAligned: false,
		budgets: [], tokenMaxLimit: '', tokenResetDuration: '1h', requestMaxLimit: '', requestResetDuration: '1h',
	};
}

export function governanceDraftFromRecord(record: JsonRecord, kind: GovernanceEntityKind): GovernanceDraft {
	const rateLimit = isJsonRecord(record.rate_limit) ? record.rate_limit : {};
	return {
		name: stringValue(record.name),
		provider: kind === 'provider' ? stringValue(record.provider) : '',
		customerId: stringValue(record.customer_id),
		calendarAligned: record.calendar_aligned === true,
		budgets: objectArray(record.budgets).map((budget, index) => ({
			key: stringValue(budget.id) || `budget-${index}`,
			maxLimit: typeof budget.max_limit === 'number' ? budget.max_limit : '',
			resetDuration: stringValue(budget.reset_duration) || '1M',
		})),
		tokenMaxLimit: typeof rateLimit.token_max_limit === 'number' ? rateLimit.token_max_limit : '',
		tokenResetDuration: stringValue(rateLimit.token_reset_duration) || '1h',
		requestMaxLimit: typeof rateLimit.request_max_limit === 'number' ? rateLimit.request_max_limit : '',
		requestResetDuration: stringValue(rateLimit.request_reset_duration) || '1h',
	};
}

export function buildGovernancePayload(draft: GovernanceDraft, kind: GovernanceEntityKind, isEditing: boolean): JsonRecord {
	const name = draft.name.trim();
	if (kind !== 'provider' && !name) throw new Error('name-required');
	if (kind === 'provider' && !draft.provider.trim()) throw new Error('provider-required');
	const budgets = budgetsFromDraft(draft);
	const rateLimit = rateLimitFromDraft(draft);
	return {
		...(kind === 'provider' ? {} : { name }),
		...(kind === 'team' ? { customer_id: isEditing ? draft.customerId.trim() : draft.customerId.trim() || undefined } : {}),
		budgets,
		rate_limit: rateLimit ?? (isEditing ? {} : undefined),
		calendar_aligned: draft.calendarAligned,
	};
}

export function emptyPricingOverrideDraft(): PricingOverrideDraft {
	return {
		name: '', scopeKind: 'global', userId: '', virtualKeyId: '', providerId: '', providerKeyId: '',
		matchType: 'exact', pattern: '', requestTypes: [], patchJson: '{\n  "input_cost_per_token": 0\n}',
	};
}

export function pricingOverrideDraftFromRecord(record: JsonRecord): PricingOverrideDraft {
	let patch: unknown = record.patch;
	if (typeof record.pricing_patch === 'string') {
		try { patch = JSON.parse(record.pricing_patch); } catch { patch = {}; }
	}
	if (!isJsonRecord(patch)) patch = {};
	const scopeKind = PRICING_SCOPE_KINDS.includes(record.scope_kind as PricingScopeKind) ? record.scope_kind as PricingScopeKind : 'global';
	return {
		name: stringValue(record.name), scopeKind,
		userId: stringValue(record.user_id), virtualKeyId: stringValue(record.virtual_key_id),
		providerId: stringValue(record.provider_id), providerKeyId: stringValue(record.provider_key_id),
		matchType: record.match_type === 'wildcard' ? 'wildcard' : 'exact', pattern: stringValue(record.pattern),
		requestTypes: Array.isArray(record.request_types) ? record.request_types.filter((value): value is string => typeof value === 'string') : [],
		patchJson: JSON.stringify(patch, null, 2),
	};
}

function validateScope(draft: PricingOverrideDraft): void {
	if (draft.scopeKind.startsWith('user') && !draft.userId.trim()) throw new Error('user-required');
	if (draft.scopeKind.startsWith('virtual_key') && !draft.virtualKeyId.trim()) throw new Error('virtual-key-required');
	if (draft.scopeKind.includes('provider') && !draft.providerId.trim()) throw new Error('provider-required');
	if (draft.scopeKind.endsWith('provider_key') && !draft.providerKeyId.trim()) throw new Error('provider-key-required');
}

function parsePricingPatch(value: string): JsonRecord {
	const parsed: unknown = JSON.parse(value);
	if (!isJsonRecord(parsed)) throw new Error('patch-object');
	for (const [key, field] of Object.entries(parsed)) {
		if (typeof field !== 'number' || !Number.isFinite(field) || field < 0) throw new Error(`patch-field:${key}`);
	}
	if (Object.keys(parsed).length === 0) throw new Error('patch-required');
	return parsed;
}

export function buildPricingOverridePayload(draft: PricingOverrideDraft): JsonRecord {
	const name = draft.name.trim();
	const pattern = draft.pattern.trim();
	if (!name) throw new Error('name-required');
	if (!pattern) throw new Error('pattern-required');
	if (draft.requestTypes.length === 0) throw new Error('request-types-required');
	if (draft.matchType === 'exact' && pattern.includes('*')) throw new Error('pattern-exact');
	if (draft.matchType === 'wildcard') {
		const stars = pattern.match(/\*/g)?.length ?? 0;
		if (stars !== 1 || !pattern.endsWith('*')) throw new Error('pattern-wildcard');
	}
	validateScope(draft);
	return {
		name,
		scope_kind: draft.scopeKind,
		user_id: draft.scopeKind.startsWith('user') ? draft.userId.trim() : null,
		virtual_key_id: draft.scopeKind.startsWith('virtual_key') ? draft.virtualKeyId.trim() : null,
		provider_id: draft.scopeKind.includes('provider') ? draft.providerId.trim() : null,
		provider_key_id: draft.scopeKind.endsWith('provider_key') ? draft.providerKeyId.trim() : null,
		match_type: draft.matchType,
		pattern,
		request_types: draft.requestTypes,
		patch: parsePricingPatch(draft.patchJson),
	};
}

export function buildPricingOverrideQuery(filters: { search?: string; scopeKind?: string; providerId?: string; limit: number; offset: number }): string {
	const query = new URLSearchParams({ limit: String(filters.limit), offset: String(filters.offset) });
	if (filters.search?.trim()) query.set('search', filters.search.trim());
	if (filters.scopeKind?.trim()) query.set('scope_kind', filters.scopeKind.trim());
	if (filters.providerId?.trim()) query.set('provider_id', filters.providerId.trim());
	return query.toString();
}
