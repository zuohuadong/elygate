import type { AuthProviderSummary } from './types.ts';

export interface OidcProviderConfig extends AuthProviderSummary {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly projectRef?: string;
  readonly authorizationUrl?: string;
  readonly tokenUrl?: string;
  readonly jwksUrl?: string;
}

export interface PortalConfig {
  readonly publicUrl: URL;
  readonly port: number;
  readonly sessionSecret: Uint8Array;
  readonly bifrostUrl: URL;
  readonly bifrostToken: string;
  readonly userIdClaim: string;
  readonly requireVerifiedEmail: boolean;
  readonly allowedRoles: readonly string[];
  readonly providers: readonly OidcProviderConfig[];
}

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const configured = env[name]?.trim();
  if (!configured) throw new Error(`缺少必需环境变量 ${name}`);
  return configured;
}

function optional(env: Env, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function booleanValue(env: Env, name: string, fallback: boolean): boolean {
  const configured = optional(env, name);
  if (configured === undefined) return fallback;
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  throw new Error(`${name} 只能是 true 或 false`);
}

function providerFromEnv(env: Env, prefix: 'SUPAUTH' | 'ENTERPRISE_SSO', id: string, name: string): OidcProviderConfig | null {
  const configuredIssuer = optional(env, `${prefix}_ISSUER`);
  if (!configuredIssuer) return null;
  return {
    id,
    name,
    issuer: secureUrl(configuredIssuer, `${prefix}_ISSUER`).replace(/\/$/, ''),
    clientId: required(env, `${prefix}_CLIENT_ID`),
    clientSecret: optional(env, `${prefix}_CLIENT_SECRET`),
    projectRef: optional(env, `${prefix}_PROJECT_REF`),
    authorizationUrl: optional(env, `${prefix}_AUTHORIZATION_URL`),
    tokenUrl: optional(env, `${prefix}_TOKEN_URL`),
    jwksUrl: optional(env, `${prefix}_JWKS_URL`),
  };
}

function secureUrl(configured: string, name: string): string {
  const url = new URL(configured);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !local) throw new Error(`${name} 必须使用 HTTPS`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${name} 不能包含凭据、查询参数或片段`);
  return url.toString();
}

function validatedUrl(configured: string, name: string): URL {
  const url = new URL(secureUrl(configured, name));
  url.pathname = `${url.pathname.replace(/\/$/, '')}/`;
  return url;
}

function allowedRoles(env: Env): string[] {
  const roles = (optional(env, 'EMPLOYEE_PORTAL_ALLOWED_ROLES') ?? 'employee')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
  if (roles.length === 0) throw new Error('EMPLOYEE_PORTAL_ALLOWED_ROLES 至少需要一个角色');
  return [...new Set(roles)];
}

export function loadConfig(env: Env = Bun.env): PortalConfig {
  const secret = required(env, 'EMPLOYEE_PORTAL_SESSION_SECRET');
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('EMPLOYEE_PORTAL_SESSION_SECRET 至少需要 32 字节');
  }
  const providers = [
    providerFromEnv(env, 'SUPAUTH', 'supauth', 'SupAuth'),
    providerFromEnv(env, 'ENTERPRISE_SSO', 'enterprise-sso', '企业 SSO'),
  ].filter((provider): provider is OidcProviderConfig => provider !== null);
  if (providers.length === 0) throw new Error('至少需要配置 SUPAUTH_ISSUER 或 ENTERPRISE_SSO_ISSUER');
  const port = Number(optional(env, 'EMPLOYEE_PORTAL_PORT') ?? '8090');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('EMPLOYEE_PORTAL_PORT 必须是有效端口');

  return {
    publicUrl: validatedUrl(required(env, 'EMPLOYEE_PORTAL_PUBLIC_URL'), 'EMPLOYEE_PORTAL_PUBLIC_URL'),
    port,
    sessionSecret: new TextEncoder().encode(secret),
    bifrostUrl: new URL(required(env, 'BIFROST_MANAGEMENT_URL')),
    bifrostToken: required(env, 'BIFROST_MANAGEMENT_TOKEN'),
    userIdClaim: optional(env, 'EMPLOYEE_PORTAL_USER_ID_CLAIM') ?? 'sub',
    requireVerifiedEmail: booleanValue(env, 'EMPLOYEE_PORTAL_REQUIRE_VERIFIED_EMAIL', true),
    allowedRoles: allowedRoles(env),
    providers,
  };
}
