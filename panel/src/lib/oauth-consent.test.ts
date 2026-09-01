import { describe, expect, test } from 'bun:test';
import { expiryMinutes, isSafeOAuthRedirect, tempTokenFromFragment } from './oauth-consent';

describe('OAuth consent helpers', () => {
	test('extracts only the scoped temp token from a URL fragment', () => {
		expect(tempTokenFromFragment('#t=token-123')).toBe('token-123');
		expect(tempTokenFromFragment('#foo=bar&t=token%20456')).toBe('token 456');
		expect(tempTokenFromFragment('?t=wrong-shape')).toBe('');
	});

	test('allows web and native callbacks but blocks executable protocols', () => {
		expect(isSafeOAuthRedirect('https://client.example/callback', 'https://gateway.example')).toBe(true);
		expect(isSafeOAuthRedirect('cursor://oauth/callback', 'https://gateway.example')).toBe(true);
		expect(isSafeOAuthRedirect('/oauth/done', 'https://gateway.example')).toBe(true);
		for (const value of ['javascript:alert(1)', 'data:text/html,test', 'blob:https://gateway.example/id', 'file:///tmp/token']) {
			expect(isSafeOAuthRedirect(value, 'https://gateway.example')).toBe(false);
		}
	});

	test('reports a positive rounded-up expiry window', () => {
		const now = Date.parse('2026-08-09T00:00:00Z');
		expect(expiryMinutes('2026-08-09T00:01:01Z', now)).toBe(2);
		expect(expiryMinutes('2026-08-08T23:59:59Z', now)).toBeUndefined();
		expect(expiryMinutes('invalid', now)).toBeUndefined();
	});
});
