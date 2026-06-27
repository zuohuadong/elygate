import { beforeEach, describe, expect, mock, test } from 'bun:test';

const optionValues = new Map<string, unknown>();
const fetchMock = mock(async () => new Response(JSON.stringify({ success: true })));
const originalFetch = globalThis.fetch;

mock.module('./optionCache', () => ({
    optionCache: {
        get(key: string, fallback: unknown) {
            return optionValues.has(key) ? optionValues.get(key) : fallback;
        },
    },
}));

mock.module('./logger', () => ({
    log: {
        error: mock(() => undefined),
    },
}));

const { getCaptchaConfig, isCaptchaEnabled, verifyCaptcha } = await import('./captcha');

describe('captcha compatibility service', () => {
    beforeEach(() => {
        optionValues.clear();
        fetchMock.mockClear();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    test('stays disabled when provider is none and accepts requests without external calls', async () => {
        optionValues.set('CaptchaProvider', 'none');

        expect(getCaptchaConfig()).toEqual({ provider: 'none', siteKey: '', secretKey: '' });
        expect(isCaptchaEnabled()).toBe(false);
        expect(await verifyCaptcha(undefined, '127.0.0.1')).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('rejects missing token when a provider secret is configured', async () => {
        optionValues.set('CaptchaProvider', 'turnstile');
        optionValues.set('TurnstileSecretKey', 'secret');

        expect(isCaptchaEnabled()).toBe(true);
        expect(await verifyCaptcha(undefined)).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('posts hCaptcha verification payload with remote ip', async () => {
        optionValues.set('CaptchaProvider', 'hcaptcha');
        optionValues.set('hCaptchaSiteKey', 'site');
        optionValues.set('hCaptchaSecretKey', 'secret');

        expect(getCaptchaConfig()).toEqual({ provider: 'hcaptcha', siteKey: 'site', secretKey: 'secret' });
        expect(await verifyCaptcha('token', '203.0.113.10')).toBe(true);

        const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
        expect(call).toBeDefined();
        const [url, init] = call!;
        expect(url).toBe('https://api.hcaptcha.com/siteverify');
        expect(init.method).toBe('POST');
        expect(String(init.body)).toContain('secret=secret');
        expect(String(init.body)).toContain('response=token');
        expect(String(init.body)).toContain('remoteip=203.0.113.10');
    });

    test('restores fetch after captcha tests', () => {
        globalThis.fetch = originalFetch;
        expect(globalThis.fetch).toBe(originalFetch);
    });
});
