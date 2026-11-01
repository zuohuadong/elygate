import { describe, expect, test } from 'bun:test';
import {
	buildMcpKillSwitchPayload,
	emptyMcpKillSwitchDraft,
	mcpKillSwitchDraftFromRecord,
	mcpKillSwitchesFromPayload,
} from './mcp-kill-switch';

describe('MCP kill-switch form contract', () => {
	test('supports every upstream scope and canonicalizes the global target', () => {
		expect(['global', 'tenant', 'agent', 'application', 'tool']).toEqual(
			['global', 'tenant', 'agent', 'application', 'tool'],
		);
		expect(buildMcpKillSwitchPayload({ ...emptyMcpKillSwitchDraft(), scope: 'global', target: '' })).toEqual({
			scope: 'global',
			target: '*',
			enabled: true,
			reason: '',
		});
	});

	test('serializes local expiration as an RFC3339 instant and round-trips records', () => {
		const payload = buildMcpKillSwitchPayload({
			scope: 'tool',
			target: 'weather/search',
			enabled: false,
			reason: 'maintenance',
			expiresAt: '2030-05-06T07:08',
		});
		expect(payload.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		const draft = mcpKillSwitchDraftFromRecord(payload);
		expect(draft.scope).toBe('tool');
		expect(draft.target).toBe('weather/search');
		expect(draft.enabled).toBe(false);
		expect(draft.reason).toBe('maintenance');
		expect(draft.expiresAt).toMatch(/^2030-05-06T\d{2}:08$/);
	});

	test('rejects missing and overlong values before a request is sent', () => {
		expect(() => buildMcpKillSwitchPayload({ ...emptyMcpKillSwitchDraft(), scope: 'tenant', target: ' ' })).toThrow('target-required');
		expect(() => buildMcpKillSwitchPayload({ ...emptyMcpKillSwitchDraft(), scope: 'tenant', target: 'x'.repeat(256) })).toThrow('target-too-long');
		expect(() => buildMcpKillSwitchPayload({ ...emptyMcpKillSwitchDraft(), reason: 'x'.repeat(513) })).toThrow('reason-too-long');
		expect(() => buildMcpKillSwitchPayload({ ...emptyMcpKillSwitchDraft(), expiresAt: 'not-a-date' })).toThrow('expires-invalid');
	});

	test('ignores malformed response entries without hiding valid rules', () => {
		expect(mcpKillSwitchesFromPayload({
			switches: [
				{ scope: 'tool', target: 'a/b', enabled: true },
				{ scope: 'invalid', target: 'x', enabled: true },
				{ scope: 'tenant', target: 42, enabled: true },
			],
		})).toEqual([{ scope: 'tool', target: 'a/b', enabled: true }]);
	});
});
