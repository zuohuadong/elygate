import { describe, expect, test } from 'bun:test';
import { assertSafeExternalUrl, safeExternalFetch } from './safeExternalUrl';

describe('safe external URL guard', () => {
    test('rejects localhost and private IP literals before fetch', () => {
        expect(() => assertSafeExternalUrl('http://localhost/.well-known/openid-configuration')).toThrow();
        expect(() => assertSafeExternalUrl('http://127.0.0.1:3000/oauth')).toThrow();
        expect(() => assertSafeExternalUrl('http://192.168.1.5/oauth')).toThrow();
        expect(() => assertSafeExternalUrl('file:///tmp/token')).toThrow();
    });

    test('safe fetch uses the same internal host guard', async () => {
        await expect(safeExternalFetch('http://localhost/oauth')).rejects.toThrow(/internal/i);
    });

    test('allows ordinary https URLs through static validation', () => {
        expect(assertSafeExternalUrl('https://accounts.example.com/.well-known/openid-configuration').hostname)
            .toBe('accounts.example.com');
    });
});
