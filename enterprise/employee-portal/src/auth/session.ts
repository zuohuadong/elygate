import { jwtVerify, SignJWT } from 'jose';
import type { EmployeeIdentity } from '../types.ts';
import { HttpError, jsonRecord, stringField } from '../http.ts';

const SESSION_COOKIE = 'elygate_employee_session';
const FLOW_COOKIE = 'elygate_employee_oidc_flow';

export interface EmployeeSession extends EmployeeIdentity {
  readonly csrfToken: string;
}

export interface OidcFlow {
  readonly providerId: string;
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
}

interface CookieOptions {
  readonly name: string;
  readonly content: string;
  readonly path: string;
  readonly maxAge: number;
  readonly secure: boolean;
}

function cookieValue(header: string | null, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const [key, ...contentParts] = part.trim().split('=');
    if (key === name) return decodeURIComponent(contentParts.join('='));
  }
  return '';
}

function secureCookie(options: CookieOptions): string {
  const normalizedPath = options.path.endsWith('/') ? options.path : `${options.path}/`;
  return [
    `${options.name}=${encodeURIComponent(options.content)}`,
    `Path=${normalizedPath || '/'}`,
    `Max-Age=${options.maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}

function rolesFrom(claim: unknown): string[] {
  return Array.isArray(claim) ? claim.filter((role): role is string => typeof role === 'string') : [];
}

export class SessionService {
  constructor(
    private readonly secret: Uint8Array,
    private readonly cookiePath: string,
    private readonly secure: boolean,
  ) {}

  async createSession(identity: EmployeeIdentity): Promise<{ token: string; session: EmployeeSession }> {
    const session: EmployeeSession = { ...identity, csrfToken: crypto.randomUUID() };
    const token = await new SignJWT({ session })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setAudience('elygate-employee-portal')
      .setIssuer('elygate-employee-portal')
      .sign(this.secret);
    return { token, session };
  }

  async readSession(cookieHeader: string | null): Promise<EmployeeSession> {
    try {
      const token = cookieValue(cookieHeader, SESSION_COOKIE);
      if (!token) throw new HttpError(401, '请先登录员工门户');
      const { payload } = await jwtVerify(token, this.secret, {
        audience: 'elygate-employee-portal',
        issuer: 'elygate-employee-portal',
      });
      const session = jsonRecord(payload.session);
      const providerId = stringField(session, 'providerId');
      const userId = stringField(session, 'userId');
      const email = stringField(session, 'email');
      const name = stringField(session, 'name');
      const csrfToken = stringField(session, 'csrfToken');
      if (!providerId || !userId || !email || !csrfToken) throw new Error('invalid session');
      return { providerId, userId, email, name: name || email, roles: rolesFrom(session.roles), csrfToken };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401, '登录已过期，请重新登录');
    }
  }

  async createFlow(flow: OidcFlow): Promise<string> {
    return new SignJWT({ flow })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .setAudience('elygate-employee-portal-oidc')
      .setIssuer('elygate-employee-portal')
      .sign(this.secret);
  }

  async readFlow(cookieHeader: string | null): Promise<OidcFlow> {
    try {
      const token = cookieValue(cookieHeader, FLOW_COOKIE);
      if (!token) throw new HttpError(400, '登录流程已失效，请重新发起登录');
      const { payload } = await jwtVerify(token, this.secret, {
        audience: 'elygate-employee-portal-oidc',
        issuer: 'elygate-employee-portal',
      });
      const flow = jsonRecord(payload.flow);
      const providerId = stringField(flow, 'providerId');
      const state = stringField(flow, 'state');
      const nonce = stringField(flow, 'nonce');
      const verifier = stringField(flow, 'verifier');
      if (!providerId || !state || !nonce || !verifier) throw new Error('invalid flow');
      return { providerId, state, nonce, verifier };
    } catch {
      throw new HttpError(400, '登录流程已失效，请重新发起登录');
    }
  }

  sessionCookie(token: string): string {
    return secureCookie({ name: SESSION_COOKIE, content: token, path: this.cookiePath, maxAge: 60 * 60, secure: this.secure });
  }

  flowCookie(token: string): string {
    return secureCookie({ name: FLOW_COOKIE, content: token, path: this.cookiePath, maxAge: 10 * 60, secure: this.secure });
  }

  clearFlowCookie(): string {
    return secureCookie({ name: FLOW_COOKIE, content: '', path: this.cookiePath, maxAge: 0, secure: this.secure });
  }

  clearCookies(): string[] {
    return [
      secureCookie({ name: SESSION_COOKIE, content: '', path: this.cookiePath, maxAge: 0, secure: this.secure }),
      this.clearFlowCookie(),
    ];
  }
}
