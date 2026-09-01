import { Elysia } from 'elysia';
import { resolve, sep } from 'node:path';
import type { PortalConfig } from './config.ts';
import { HttpError } from './http.ts';
import { OidcService } from './auth/oidc.ts';
import { SessionService } from './auth/session.ts';
import type { EmployeeSession } from './auth/session.ts';
import { BifrostEmployeeClient } from './bifrost-client.ts';

export interface PortalServices {
  readonly sessions: SessionService;
  readonly oidc: OidcService;
  readonly bifrost: BifrostEmployeeClient;
}

function trustedMutation(request: Request, config: PortalConfig, csrfToken: string): void {
  if (request.headers.get('origin') !== config.publicUrl.origin) throw new HttpError(403, '请求来源校验失败');
  if (request.headers.get('x-csrf-token') !== csrfToken) throw new HttpError(403, 'CSRF 校验失败');
}

async function employeeSession(request: Request, config: PortalConfig, sessions: SessionService): Promise<EmployeeSession> {
  const session = await sessions.readSession(request.headers.get('cookie'));
  if (!session.roles.some((role) => config.allowedRoles.includes(role))) {
    throw new HttpError(403, '当前账号未获授权访问员工门户');
  }
  return session;
}

function staticFile(webRoot: string, request: Request): Blob | null {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  if (!pathname.startsWith('/assets/')) return null;
  const candidate = resolve(webRoot, `.${pathname}`);
  if (!candidate.startsWith(`${resolve(webRoot)}${sep}`)) return null;
  return Bun.file(candidate);
}

export function createPortalServices(config: PortalConfig): PortalServices {
  const sessions = new SessionService(config.sessionSecret, config.publicUrl.pathname || '/', config.publicUrl.protocol === 'https:');
  return {
    sessions,
    oidc: new OidcService(config, sessions),
    bifrost: new BifrostEmployeeClient(config.bifrostUrl, config.bifrostToken),
  };
}

export function createApp(config: PortalConfig, services: PortalServices = createPortalServices(config), webRoot = resolve(process.cwd(), 'dist/web')) {
  const indexFile = resolve(webRoot, 'index.html');

  return new Elysia()
    .onAfterHandle(({ request, set }) => {
      set.headers['x-content-type-options'] = 'nosniff';
      set.headers['referrer-policy'] = 'no-referrer';
      set.headers['content-security-policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
      if (new URL(request.url).pathname.startsWith('/api/')) set.headers['cache-control'] = 'no-store';
    })
    .onError(({ error, set }) => {
      if (error instanceof HttpError) {
        set.status = error.status;
        return { error: error.message };
      }
      console.error('employee portal request failed', error instanceof Error ? error.message : 'unknown error');
      set.status = 500;
      return { error: '员工门户内部错误' };
    })
    .get('/health', () => ({ status: 'ok', providers: config.providers.map(({ id }) => id) }))
    .get('/api/auth/providers', () => config.providers.map(({ id, name }) => ({ id, name })))
    .get('/api/auth/login/:provider', async ({ params }) => {
      const login = await services.oidc.start(params.provider);
      return new Response(null, {
        status: 302,
        headers: { location: login.redirectUrl, 'set-cookie': services.sessions.flowCookie(login.flowToken) },
      });
    })
    .get('/api/auth/callback/:provider', async ({ params, request }) => {
      const url = new URL(request.url);
      const identity = await services.oidc.callback({
        providerId: params.provider,
        code: url.searchParams.get('code') ?? '',
        state: url.searchParams.get('state') ?? '',
        cookieHeader: request.headers.get('cookie'),
      });
      const { token } = await services.sessions.createSession(identity);
      const headers = new Headers({ location: config.publicUrl.toString() });
      headers.append('set-cookie', services.sessions.sessionCookie(token));
      headers.append('set-cookie', services.sessions.clearFlowCookie());
      return new Response(null, {
        status: 302,
        headers,
      });
    })
    .post('/api/auth/logout', async ({ request }) => {
      const session = await employeeSession(request, config, services.sessions);
      trustedMutation(request, config, session.csrfToken);
      const headers = new Headers({ location: config.publicUrl.toString() });
      for (const cookie of services.sessions.clearCookies()) headers.append('set-cookie', cookie);
      return new Response(null, { status: 303, headers });
    })
    .get('/api/me', async ({ request }) => {
      const session = await employeeSession(request, config, services.sessions);
      return {
        providerId: session.providerId,
        userId: session.userId,
        email: session.email,
        name: session.name,
        roles: session.roles,
        csrfToken: session.csrfToken,
      };
    })
    .get('/api/me/keys', async ({ request }) => {
      const session = await employeeSession(request, config, services.sessions);
      return { keys: await services.bifrost.keysFor(session) };
    })
    .get('/api/me/usage', async ({ request }) => {
      const session = await employeeSession(request, config, services.sessions);
      const period = new URL(request.url).searchParams.get('period') ?? '7d';
      return await services.bifrost.usageFor(session, period);
    })
    .post('/api/me/keys/:id/rotate', async ({ params, request }) => {
      const session = await employeeSession(request, config, services.sessions);
      trustedMutation(request, config, session.csrfToken);
      return await services.bifrost.rotate(session, params.id);
    })
    .get('/assets/*', ({ request, set }) => {
      const file = staticFile(webRoot, request);
      if (!file || !file.size) {
        set.status = 404;
        return 'Not found';
      }
      return file;
    })
    .get('/', () => Bun.file(indexFile));
}
