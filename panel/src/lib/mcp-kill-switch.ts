import type { JsonRecord } from './api';

export const MCP_KILL_SWITCH_SCOPES = ['global', 'tenant', 'agent', 'application', 'tool'] as const;
export type McpKillSwitchScope = typeof MCP_KILL_SWITCH_SCOPES[number];

export interface McpKillSwitchDraft {
	scope: McpKillSwitchScope;
	target: string;
	enabled: boolean;
	reason: string;
	expiresAt: string;
}

export interface McpKillSwitchRecord {
	scope: McpKillSwitchScope;
	target: string;
	enabled: boolean;
	reason: string;
	expires_at?: string | null;
	updated_at?: string | null;
}

export function emptyMcpKillSwitchDraft(): McpKillSwitchDraft {
	return { scope: 'global', target: '*', enabled: true, reason: '', expiresAt: '' };
}

function scopeOf(value: unknown): McpKillSwitchScope {
	return MCP_KILL_SWITCH_SCOPES.includes(value as McpKillSwitchScope) ? value as McpKillSwitchScope : 'global';
}

function stringOf(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

export function mcpKillSwitchDraftFromRecord(record: JsonRecord | McpKillSwitchRecord): McpKillSwitchDraft {
	const scope = scopeOf(record.scope);
	return {
		scope,
		target: scope === 'global' ? '*' : stringOf(record.target),
		enabled: record.enabled !== false,
		reason: stringOf(record.reason),
		expiresAt: toDateTimeLocal(stringOf(record.expires_at)),
	};
}

export function toDateTimeLocal(value: string): string {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	const pad = (part: number): string => String(part).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildMcpKillSwitchPayload(draft: McpKillSwitchDraft): McpKillSwitchRecord {
	const scope = scopeOf(draft.scope);
	const target = scope === 'global' ? '*' : draft.target.trim();
	if (scope !== 'global' && !target) throw new Error('target-required');
	if (target.length > 255) throw new Error('target-too-long');
	const reason = draft.reason.trim();
	if (reason.length > 512) throw new Error('reason-too-long');
	let expires_at: string | undefined;
	if (draft.expiresAt.trim()) {
		const date = new Date(draft.expiresAt);
		if (Number.isNaN(date.getTime())) throw new Error('expires-invalid');
		expires_at = date.toISOString();
	}
	return { scope, target, enabled: draft.enabled, reason, ...(expires_at ? { expires_at } : {}) };
}

export function mcpKillSwitchesFromPayload(value: unknown): McpKillSwitchRecord[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
	const switches = (value as JsonRecord).switches;
	if (!Array.isArray(switches)) return [];
	return switches.filter((item): item is McpKillSwitchRecord => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
		const record = item as JsonRecord;
		return MCP_KILL_SWITCH_SCOPES.includes(record.scope as McpKillSwitchScope) && typeof record.target === 'string';
	});
}
