import { describe, expect, test } from 'bun:test';
import { getClientIpFromHeaders, isIpAllowed } from './ipAccess';

describe('ip access policy', () => {
    test('uses the first forwarded client ip', () => {
        const headers = new Headers({
            'x-forwarded-for': '203.0.113.7, 10.0.0.1',
            'x-real-ip': '198.51.100.1',
        });
        expect(getClientIpFromHeaders(headers)).toBe('203.0.113.7');
    });

    test('allows exact IP and CIDR entries', () => {
        expect(isIpAllowed('203.0.113.7', '198.51.100.1,203.0.113.7')).toBe(true);
        expect(isIpAllowed('10.12.3.4', '10.0.0.0/8')).toBe(true);
        expect(isIpAllowed('172.20.1.9', '10.0.0.0/8,172.16.0.0/12')).toBe(true);
    });

    test('rejects clients outside the configured policy', () => {
        expect(isIpAllowed('192.0.2.10', '10.0.0.0/8,203.0.113.7')).toBe(false);
    });
});
