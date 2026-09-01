import { describe, expect, test } from 'bun:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { OidcService } from '../src/auth/oidc.ts';
import { SessionService } from '../src/auth/session.ts';
import { loadConfig } from '../src/config.ts';
import type { FetchLike } from '../src/http.ts';

describe('SupAuth OIDC adapter', () => {
  test('uses authorization code with PKCE and the exact mounted callback', async () => {
    const config = loadConfig({
      EMPLOYEE_PORTAL_PUBLIC_URL: 'https://elygate.example.com/employee',
      EMPLOYEE_PORTAL_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      BIFROST_MANAGEMENT_URL: 'http://elygate:8080',
      BIFROST_MANAGEMENT_TOKEN: 'test-management-token',
      SUPAUTH_ISSUER: 'https://auth.example.com/auth/v1',
      SUPAUTH_CLIENT_ID: 'employee-portal',
    });
    const sessions = new SessionService(config.sessionSecret, config.publicUrl.pathname, true);
    const fetcher: FetchLike = async () => new Response(JSON.stringify({
      authorization_endpoint: 'https://auth.example.com/auth/v1/authorize',
      token_endpoint: 'https://auth.example.com/auth/v1/token',
      jwks_uri: 'https://auth.example.com/auth/v1/.well-known/jwks.json',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const login = await new OidcService(config, sessions, fetcher).start('supauth');
    const redirect = new URL(login.redirectUrl);
    expect(redirect.searchParams.get('client_id')).toBe('employee-portal');
    expect(redirect.searchParams.get('response_type')).toBe('code');
    expect(redirect.searchParams.get('code_challenge_method')).toBe('S256');
    expect(redirect.searchParams.get('code_challenge')).not.toBeEmpty();
    expect(redirect.searchParams.get('redirect_uri')).toBe('https://elygate.example.com/employee/api/auth/callback/supauth');
    expect(login.flowToken.length).toBeGreaterThan(40);
  });

  test('verifies the ID token and maps SupAuth project roles', async () => {
    const config = loadConfig({
      EMPLOYEE_PORTAL_PUBLIC_URL: 'https://elygate.example.com/employee',
      EMPLOYEE_PORTAL_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      BIFROST_MANAGEMENT_URL: 'http://elygate:8080',
      BIFROST_MANAGEMENT_TOKEN: 'test-management-token',
      SUPAUTH_ISSUER: 'https://auth.example.com/auth/v1',
      SUPAUTH_CLIENT_ID: 'employee-portal',
      SUPAUTH_PROJECT_REF: 'elygate',
    });
    const sessions = new SessionService(config.sessionSecret, config.publicUrl.pathname, true);
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = 'test-key';
    let idToken = '';
    const fetcher: FetchLike = async (input) => {
      const requestUrl = input instanceof Request ? input.url : input.toString();
      if (requestUrl.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          authorization_endpoint: 'https://auth.example.com/auth/v1/authorize',
          token_endpoint: 'https://auth.example.com/auth/v1/token',
          jwks_uri: 'https://auth.example.com/auth/v1/.well-known/jwks.json',
        });
      }
      if (requestUrl.endsWith('/token')) return Response.json({ id_token: idToken });
      if (requestUrl.endsWith('/jwks.json')) return Response.json({ keys: [publicJwk] });
      return new Response('not found', { status: 404 });
    };
    const oidc = new OidcService(config, sessions, fetcher);
    const login = await oidc.start('supauth');
    const redirect = new URL(login.redirectUrl);
    idToken = await new SignJWT({
      sub: 'employee-42',
      email: 'employee@example.com',
      email_verified: true,
      name: '测试员工',
      nonce: redirect.searchParams.get('nonce'),
      app_metadata: { supaoauth: { projects: { elygate: { roles: ['employee'] } } } },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://auth.example.com/auth/v1')
      .setAudience('employee-portal')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    const identity = await oidc.callback({
      providerId: 'supauth',
      code: 'authorization-code',
      state: redirect.searchParams.get('state') ?? '',
      cookieHeader: sessions.flowCookie(login.flowToken),
    });
    expect(identity).toEqual({
      providerId: 'supauth',
      userId: 'employee-42',
      email: 'employee@example.com',
      name: '测试员工',
      roles: ['employee'],
    });

    const deniedLogin = await oidc.start('supauth');
    const deniedRedirect = new URL(deniedLogin.redirectUrl);
    idToken = await new SignJWT({
      sub: 'contractor-7',
      email: 'contractor@example.com',
      email_verified: true,
      nonce: deniedRedirect.searchParams.get('nonce'),
      roles: ['employee'],
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://auth.example.com/auth/v1')
      .setAudience('employee-portal')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    await expect(oidc.callback({
      providerId: 'supauth',
      code: 'authorization-code',
      state: deniedRedirect.searchParams.get('state') ?? '',
      cookieHeader: sessions.flowCookie(deniedLogin.flowToken),
    })).rejects.toMatchObject({ status: 403 });
  });
});
