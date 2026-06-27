import { describe, expect, test } from 'bun:test';

const { classifyChannelError } = await import('./circuitBreakerPolicy');

describe('circuit breaker auto-ban policy', () => {
    test('classifies upstream status codes into stable channel actions', () => {
        expect(classifyChannelError(401, true)).toBe('mark-key');
        expect(classifyChannelError(403, true)).toBe('mark-key');
        expect(classifyChannelError(401, false)).toBe('disable-channel');
        expect(classifyChannelError(403, false)).toBe('mark-busy');
        expect(classifyChannelError(429, false)).toBe('mark-busy');
        expect(classifyChannelError(404, false)).toBe('ignore-client-error');
        expect(classifyChannelError(500, false)).toBe('record-window-failure');
        expect(classifyChannelError(undefined, false)).toBe('record-window-failure');
    });
});
