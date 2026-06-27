import { beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('@elygate/db', () => ({
    db: {},
    sql: {},
}));

mock.module('./mail', () => ({
    generateCode: () => '123456',
    renderVerificationEmail: () => ({ subject: 'code', html: '<b>code</b>', text: 'code' }),
    sendMail: async () => true,
}));

mock.module('./optionCache', () => ({
    optionCache: {
        get: (_key: string, fallback: unknown) => fallback,
    },
}));

mock.module('./logger', () => ({
    log: {
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
    },
}));

const {
    clearPasskeyChallenges,
    consumePasskeyChallenge,
    createPasskeyChallenge,
    PASSKEY_CHALLENGE_TTL_MS,
} = await import('./passkeyChallenge');
const { buildAuthSessionCookieOptions } = await import('./sessionCookie');
const { buildOAuthCallbackRedirect } = await import('./oauthCallback');
const { revokeAuthSession } = await import('./sessionRevocation');
const {
    exchangeOidcAuthorizationCode,
    fetchOidcUserInfo,
    normalizeOidcUserProfile,
} = await import('./oidcProvider');
const { isVerificationCodeUsable, verificationExpiresAt } = await import('./verification');

describe('identity security compatibility helpers', () => {
    beforeEach(() => {
        clearPasskeyChallenges();
    });

    test('computes email verification TTL and rejects expired or mismatched codes', () => {
        const now = new Date('2026-06-27T00:00:00.000Z');
        expect(verificationExpiresAt(now).toISOString()).toBe('2026-06-27T00:10:00.000Z');
        expect(isVerificationCodeUsable({ code: '123456', expiresAt: '2026-06-27T00:10:00.000Z' }, '123456', now)).toBe(true);
        expect(isVerificationCodeUsable({ code: '123456', expiresAt: '2026-06-26T23:59:59.000Z' }, '123456', now)).toBe(false);
        expect(isVerificationCodeUsable({ code: '123456', expiresAt: '2026-06-27T00:10:00.000Z' }, '000000', now)).toBe(false);
    });

    test('uses secure httpOnly session cookie options behind https proxies', () => {
        const httpsRequest = new Request('http://localhost/login', { headers: { 'x-forwarded-proto': 'https' } });
        expect(buildAuthSessionCookieOptions('sess_test', httpsRequest)).toEqual({
            value: 'sess_test',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 604800,
            path: '/',
        });

        const httpRequest = new Request('http://localhost/login');
        expect(buildAuthSessionCookieOptions('sess_test', httpRequest).secure).toBe(false);
    });

    test('builds encoded OAuth callback redirects for mocked provider callbacks', () => {
        const redirect = buildOAuthCallbackRedirect({
            webUrl: 'https://console.example.test/',
            token: 'sk test/+/=',
            username: 'google:user@example.test',
            role: 10,
        });

        expect(redirect).toBe('https://console.example.test/auth/callback?token=sk+test%2F%2B%2F%3D&username=google%3Auser%40example.test&role=10');
    });

    test('revokes DB-backed auth sessions and removes the browser cookie', async () => {
        const deleted: string[] = [];
        let removed = false;
        const result = await revokeAuthSession({
            value: 'sess_123',
            remove: () => { removed = true; },
        }, async (token) => {
            deleted.push(token);
        });

        expect(result).toEqual({ success: true, revoked: true, message: 'Logged out successfully' });
        expect(deleted).toEqual(['sess_123']);
        expect(removed).toBe(true);

        let removedWithoutToken = false;
        const noTokenResult = await revokeAuthSession({
            value: '',
            remove: () => { removedWithoutToken = true; },
        }, async (token) => {
            deleted.push(token);
        });
        expect(noTokenResult.revoked).toBe(false);
        expect(deleted).toEqual(['sess_123']);
        expect(removedWithoutToken).toBe(true);
    });

    test('exchanges mocked OIDC authorization codes and fetches userinfo', async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init });
            if (String(url).endsWith('/token')) {
                return new Response(JSON.stringify({ access_token: 'access_test', expires_in: 3600 }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ sub: 'user_1', email: 'user@example.test' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }) as typeof fetch;

        const token = await exchangeOidcAuthorizationCode({
            providerName: 'acme',
            tokenEndpoint: 'https://idp.example.test/token',
            userinfoEndpoint: 'https://idp.example.test/userinfo',
            clientId: 'client_id',
            clientSecret: 'client_secret',
        }, 'code_123', 'https://app.example.test/callback', fetcher);
        expect(token.access_token).toBe('access_test');
        const accessToken = token.access_token;
        if (typeof accessToken !== 'string') throw new Error('mock token response did not return a string access_token');

        const tokenBody = calls[0].init?.body as URLSearchParams;
        expect(calls[0].init?.method).toBe('POST');
        expect(tokenBody.get('grant_type')).toBe('authorization_code');
        expect(tokenBody.get('code')).toBe('code_123');
        expect(tokenBody.get('redirect_uri')).toBe('https://app.example.test/callback');

        const profile = await fetchOidcUserInfo({ userinfoEndpoint: 'https://idp.example.test/userinfo' }, accessToken, fetcher);
        expect(profile).toEqual({ sub: 'user_1', email: 'user@example.test' });
        expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer access_test');
    });

    test('proves OIDC callback-domain exchange against a live loopback provider', async () => {
        const tokenRequests: URLSearchParams[] = [];
        const provider = Bun.serve({
            port: 0,
            async fetch(request): Promise<Response> {
                const url = new URL(request.url);
                const origin = url.origin;
                if (url.pathname === '/.well-known/openid-configuration') {
                    return Response.json({
                        issuer: origin,
                        authorization_endpoint: `${origin}/authorize`,
                        token_endpoint: `${origin}/token`,
                        userinfo_endpoint: `${origin}/userinfo`,
                        jwks_uri: `${origin}/jwks`,
                        scopes_supported: ['openid', 'profile', 'email'],
                    });
                }
                if (url.pathname === '/token') {
                    const body = new URLSearchParams(await request.text());
                    tokenRequests.push(body);
                    if (body.get('redirect_uri') !== 'https://console.example.test/api/auth/oidc/acme/callback') {
                        return Response.json({ error: 'invalid_redirect_uri' }, { status: 400 });
                    }
                    return Response.json({ access_token: 'access_live_loopback', token_type: 'Bearer' });
                }
                if (url.pathname === '/userinfo') {
                    if (request.headers.get('authorization') !== 'Bearer access_live_loopback') {
                        return Response.json({ error: 'invalid_token' }, { status: 401 });
                    }
                    return Response.json({ sub: 'subject_live_loopback', email: 'loopback@example.test' });
                }
                return new Response('not found', { status: 404 });
            },
        });

        try {
            const issuer = `http://127.0.0.1:${provider.port}`;
            const discovery = await fetch(`${issuer}/.well-known/openid-configuration`).then((response) => response.json()) as Record<string, string>;
            const token = await exchangeOidcAuthorizationCode({
                providerName: 'acme',
                tokenEndpoint: discovery.token_endpoint,
                userinfoEndpoint: discovery.userinfo_endpoint,
                clientId: 'client_id',
                clientSecret: 'client_secret',
            }, 'code_live_loopback', 'https://console.example.test/api/auth/oidc/acme/callback');
            const accessToken = token.access_token;
            if (typeof accessToken !== 'string') throw new Error('loopback provider did not return string access_token');

            const profile = await fetchOidcUserInfo({ userinfoEndpoint: discovery.userinfo_endpoint }, accessToken);
            expect(profile).toEqual({ sub: 'subject_live_loopback', email: 'loopback@example.test' });
            expect(tokenRequests[0].get('code')).toBe('code_live_loopback');
            expect(tokenRequests[0].get('redirect_uri')).toBe('https://console.example.test/api/auth/oidc/acme/callback');
            expect(tokenRequests[0].get('client_id')).toBe('client_id');
        } finally {
            provider.stop(true);
        }
    });

    test('normalizes OIDC user profiles into stable local binding fields', () => {
        expect(normalizeOidcUserProfile('acme', {
            sub: 'subject_1',
            email: 'user@example.test',
            name: 'User',
        })).toEqual({
            provider: 'oidc:acme',
            providerUserId: 'subject_1',
            username: 'oidc:acme:user@example.test',
            email: 'user@example.test',
            rawProfile: {
                sub: 'subject_1',
                email: 'user@example.test',
                name: 'User',
            },
        });

        expect(() => normalizeOidcUserProfile('acme', { email: 'missing-sub@example.test' })).toThrow('missing subject');
    });

    test('consumes passkey challenges once and expires stale challenges', () => {
        const now = 1782518400000;
        const { challengeToken } = createPasskeyChallenge('register', 42, now);

        expect(consumePasskeyChallenge(challengeToken, 'verify', now + 1000)).toBeNull();
        expect(consumePasskeyChallenge(challengeToken, 'register', now + 1000)).toMatchObject({
            action: 'register',
            userId: 42,
        });
        expect(consumePasskeyChallenge(challengeToken, 'register', now + 1000)).toBeNull();

        const expired = createPasskeyChallenge('login', 42, now).challengeToken;
        expect(consumePasskeyChallenge(expired, 'login', now + PASSKEY_CHALLENGE_TTL_MS + 1)).toBeNull();
    });
});
