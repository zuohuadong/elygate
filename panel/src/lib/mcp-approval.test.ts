import { describe, expect, test } from 'bun:test';
import { buildMcpApprovalPayload, emptyMcpApprovalDraft, mcpApprovalsFromPayload } from './mcp-approval';

describe('MCP approval form contract', () => {
	test('builds a bounded exact client/tool request', () => {
		expect(buildMcpApprovalPayload({
			...emptyMcpApprovalDraft(),
			clientName: 'local',
			toolName: 'local-delete',
			ttlSeconds: 90,
			reason: 'incident',
		})).toEqual({
			client_name: 'local',
			tool_name: 'local-delete',
			ttl_seconds: 90,
			reason: 'incident',
		});
	});

	test('rejects missing, overlong, or unbounded values before a request', () => {
		expect(() => buildMcpApprovalPayload({ ...emptyMcpApprovalDraft(), toolName: 'x' })).toThrow('client-required');
		expect(() => buildMcpApprovalPayload({ ...emptyMcpApprovalDraft(), clientName: 'x', toolName: '' })).toThrow('tool-required');
		expect(() => buildMcpApprovalPayload({ ...emptyMcpApprovalDraft(), clientName: 'x'.repeat(256), toolName: 't' })).toThrow('target-too-long');
		expect(() => buildMcpApprovalPayload({ ...emptyMcpApprovalDraft(), clientName: 'x', toolName: 't', ttlSeconds: 901 })).toThrow('ttl-invalid');
		expect(() => buildMcpApprovalPayload({ ...emptyMcpApprovalDraft(), clientName: 'x', toolName: 't', reason: 'x'.repeat(513) })).toThrow('reason-too-long');
	});

	test('drops malformed response rows while retaining valid approvals', () => {
		expect(mcpApprovalsFromPayload({
			approvals: [
				{ id: 'a', client_name: 'local', tool_name: 'local-delete', issued_at: '2026-01-01', expires_at: '2026-01-02', status: 'active' },
				{ id: 'b', client_name: 'local', tool_name: 'bad', issued_at: '2026-01-01', expires_at: '2026-01-02', status: 'unknown' },
			],
		})).toHaveLength(1);
	});
});
