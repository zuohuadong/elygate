import { describe, expect, test } from 'bun:test';
import { createApp, type PortalServices } from '../src/app.ts';
import { BifrostEmployeeClient } from '../src/bifrost-client.ts';
import { loadConfig } from '../src/config.ts';
import { OidcService } from '../src/auth/oidc.ts';
import { SessionService } from '../src/auth/session.ts';
import type { FetchLike } from '../src/http.ts';

const config = loadConfig({
  EMPLOYEE_PORTAL_PUBLIC_URL: 'https://elygate.example.com/employee',
  EMPLOYEE_PORTAL_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  BIFROST_MANAGEMENT_URL: 'http://elygate:8080',
  BIFROST_MANAGEMENT_TOKEN: 'test-management-token',
  SUPAUTH_ISSUER: 'https://auth.example.com/auth/v1',
  SUPAUTH_CLIENT_ID: 'employee-portal',
});

function fetchQueue(responses: unknown[], calls: Request[]): FetchLike {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(new Request(input, init));
    const body = responses.shift();
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

function services(responses: unknown[], calls: Request[]): PortalServices {
  const sessions = new SessionService(config.sessionSecret, config.publicUrl.pathname, true);
  return {
    sessions,
    oidc: new OidcService(config, sessions, fetchQueue([], [])),
    bifrost: new BifrostEmployeeClient(config.bifrostUrl, config.bifrostToken, fetchQueue(responses, calls)),
  };
}

describe('employee portal HTTP authorization', () => {
  test('requires an employee session for self-service APIs', async () => {
    const app = createApp(config, services([], []));
    const response = await app.handle(new Request('http://portal/api/me'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '请先登录员工门户' });
  });

  test('rejects cross-origin and bad-CSRF key rotation before Bifrost access', async () => {
    const calls: Request[] = [];
    const portalServices = services([], calls);
    const { token, session } = await portalServices.sessions.createSession({
      providerId: 'supauth', userId: 'user-1', email: 'employee@example.com', name: 'Employee', roles: ['employee'],
    });
    const app = createApp(config, portalServices);
    const response = await app.handle(new Request('http://portal/api/me/keys/vk-1/rotate', {
      method: 'POST',
      headers: {
        cookie: `elygate_employee_session=${encodeURIComponent(token)}`,
        origin: 'https://evil.example.com',
        'x-csrf-token': session.csrfToken,
      },
    }));
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test('rejects an authenticated account without an allowed employee role', async () => {
    const portalServices = services([], []);
    const { token } = await portalServices.sessions.createSession({
      providerId: 'supauth', userId: 'user-1', email: 'employee@example.com', name: 'Employee', roles: [],
    });
    const app = createApp(config, portalServices);
    const response = await app.handle(new Request('http://portal/api/me/keys', {
      headers: { cookie: `elygate_employee_session=${encodeURIComponent(token)}` },
    }));
    expect(response.status).toBe(403);
  });

  test('rotates through the employee-scoped atomic endpoint', async () => {
    const calls: Request[] = [];
    const portalServices = services([
      { virtual_key: { id: 'vk-owned', name: 'employee key', value: 'sk-bf-new-secret' } },
    ], calls);
    const { token, session } = await portalServices.sessions.createSession({
      providerId: 'supauth', userId: 'user-1', email: 'employee@example.com', name: 'Employee', roles: ['employee'],
    });
    const app = createApp(config, portalServices);
    const response = await app.handle(new Request('http://portal/api/me/keys/vk-owned/rotate', {
      method: 'POST',
      headers: {
        cookie: `elygate_employee_session=${encodeURIComponent(token)}`,
        origin: config.publicUrl.origin,
        'x-csrf-token': session.csrfToken,
      },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ value: 'sk-bf-new-secret', key: { id: 'vk-owned' } });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/users/email/employee%40example.com/virtual-keys/vk-owned/rotate',
    ]);
  });
});
