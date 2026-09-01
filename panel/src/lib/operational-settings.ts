import { isJsonRecord, type JsonRecord } from './api';

export type UserAgentMatchType = 'contains' | 'starts_with' | 'exact' | 'regex';

export interface UserAgentDraft {
	pattern: string;
	matchType: UserAgentMatchType;
	app: string;
	logo: string;
	logoMime: string;
	isActive: boolean;
}

export const USER_AGENT_MATCH_TYPES: UserAgentMatchType[] = ['contains', 'starts_with', 'exact', 'regex'];
export const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_LOGO_BYTES = 256 * 1024;

export function emptyUserAgentDraft(): UserAgentDraft {
	return { pattern: '', matchType: 'contains', app: '', logo: '', logoMime: '', isActive: true };
}

export function userAgentDraftFromRecord(record: JsonRecord): UserAgentDraft {
	return {
		pattern: typeof record.pattern === 'string' ? record.pattern : '',
		matchType: USER_AGENT_MATCH_TYPES.includes(record.match_type as UserAgentMatchType) ? record.match_type as UserAgentMatchType : 'contains',
		app: typeof record.app === 'string' ? record.app : '',
		logo: typeof record.logo === 'string' ? record.logo : '',
		logoMime: typeof record.logo_mime === 'string' ? record.logo_mime : '',
		isActive: record.is_active !== false,
	};
}

export function buildUserAgentPayload(draft: UserAgentDraft): JsonRecord {
	const pattern = draft.pattern.trim();
	const app = draft.app.trim();
	if (!pattern) throw new Error('pattern-required');
	if (!app) throw new Error('app-required');
	if (draft.matchType === 'regex') {
		try { new RegExp(pattern); } catch { throw new Error('regex-invalid'); }
	}
	if (draft.logo && !ALLOWED_LOGO_MIME_TYPES.includes(draft.logoMime as typeof ALLOWED_LOGO_MIME_TYPES[number])) throw new Error('logo-type');
	return {
		pattern,
		match_type: draft.matchType,
		app,
		logo: draft.logo || undefined,
		logo_mime: draft.logo ? draft.logoMime : null,
		is_active: draft.isActive,
	};
}

export function logoDataUrl(value: unknown): string {
	if (!isJsonRecord(value) || typeof value.logo !== 'string' || typeof value.logo_mime !== 'string') return '';
	if (!ALLOWED_LOGO_MIME_TYPES.includes(value.logo_mime as typeof ALLOWED_LOGO_MIME_TYPES[number])) return '';
	return `data:${value.logo_mime};base64,${value.logo}`;
}
