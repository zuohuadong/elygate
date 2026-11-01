import type { JsonRecord } from './api';

export interface McpApprovalRecord {
	id: string;
	client_name: string;
	tool_name: string;
	issued_at: string;
	expires_at: string;
	revoked_at?: string | null;
	reason?: string;
	status: 'active' | 'expired' | 'revoked';
}

export interface McpApprovalDraft {
	clientName: string;
	toolName: string;
	ttlSeconds: number;
	reason: string;
}

export function emptyMcpApprovalDraft(): McpApprovalDraft {
	return { clientName: '', toolName: '', ttlSeconds: 60, reason: '' };
}

export function buildMcpApprovalPayload(draft: McpApprovalDraft): JsonRecord {
	const clientName = draft.clientName.trim();
	const toolName = draft.toolName.trim();
	if (!clientName) throw new Error('client-required');
	if (!toolName) throw new Error('tool-required');
	if (clientName.length > 255 || toolName.length > 255) throw new Error('target-too-long');
	if (!Number.isInteger(draft.ttlSeconds) || draft.ttlSeconds < 1 || draft.ttlSeconds > 900) throw new Error('ttl-invalid');
	if (draft.reason.length > 512) throw new Error('reason-too-long');
	return {
		client_name: clientName,
		tool_name: toolName,
		ttl_seconds: draft.ttlSeconds,
		...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
	};
}

export function mcpApprovalsFromPayload(value: unknown): McpApprovalRecord[] {
	const candidate = value as { approvals?: unknown } | null;
	if (!candidate || !Array.isArray(candidate.approvals)) return [];
	return candidate.approvals.filter((item): item is McpApprovalRecord => {
		if (!item || typeof item !== 'object') return false;
		const record = item as Partial<McpApprovalRecord>;
		return typeof record.id === 'string' &&
			typeof record.client_name === 'string' &&
			typeof record.tool_name === 'string' &&
			typeof record.issued_at === 'string' &&
			typeof record.expires_at === 'string' &&
			(record.status === 'active' || record.status === 'expired' || record.status === 'revoked');
	});
}
