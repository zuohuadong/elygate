import { base64url, createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import type { OidcProviderConfig, PortalConfig } from '../config.ts';
import { HttpError, jsonRecord, stringField, type FetchLike } from '../http.ts';
import type { EmployeeIdentity } from '../types.ts';
import type { OidcFlow } from './session.ts';
import { SessionService } from './session.ts';

interface OidcDiscovery {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
}

interface LoginStart {
  readonly redirectUrl: string;
  readonly flowToken: string;
}

export interface OidcCallbackRequest {
  readonly providerId: string;
  readonly code: string;
  readonly state: string;
  readonly cookieHeader: string | null;
}

function endpoint(candidate: unknown, name: string): string {
  if (typeof candidate !== 'string' || !candidate) throw new HttpError(502, `身份提供商缺少 ${name}`);
  if (!URL.canParse(candidate)) throw new HttpError(502, `身份提供商 ${name} 不是有效 URL`);
  const url = new URL(candidate);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !local) throw new HttpError(502, `身份提供商 ${name} 必须使用 HTTPS`);
  return url.toString();
}

function randomVerifier(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return base64url.encode(randomBytes);
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url.encode(new Uint8Array(digest));
}

function stringClaim(claims: Record<string, unknown>, name: string): string {
  const claim = claims[name];
  return typeof claim === 'string' ? claim : '';
}

function claimRoles(claims: Record<string, unknown>, provider: OidcProviderConfig): string[] {
  const metadata = jsonRecord(claims.app_metadata);
  if (provider.projectRef) {
    const supauth = jsonRecord(metadata.supaoauth);
    const projects = jsonRecord(supauth.projects);
    const project = jsonRecord(projects[provider.projectRef]);
    return Array.isArray(project.roles) ? project.roles.filter((role): role is string => typeof role === 'string') : [];
  }
  const direct = claims.roles;
  if (Array.isArray(direct)) return direct.filter((role): role is string => typeof role === 'string');
  return Array.isArray(metadata.roles) ? metadata.roles.filter((role): role is string => typeof role === 'string') : [];
}

export class OidcService {
  private readonly discovery = new Map<string, Promise<OidcDiscovery>>();

  constructor(
    private readonly config: PortalConfig,
    private readonly sessions: SessionService,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  private provider(id: string): OidcProviderConfig {
    const provider = this.config.providers.find((candidate) => candidate.id === id);
    if (!provider) throw new HttpError(404, '未知身份提供商');
    return provider;
  }

  private callbackUrl(provider: OidcProviderConfig): string {
    const base = this.config.publicUrl.toString().replace(/\/?$/, '/');
    return new URL(`api/auth/callback/${encodeURIComponent(provider.id)}`, base).toString();
  }

  private fetchWithTimeout: FetchLike = (input, init) => this.fetcher(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(10_000),
  });

  private async resolve(provider: OidcProviderConfig): Promise<OidcDiscovery> {
    const cached = this.discovery.get(provider.id);
    if (cached) return cached;
    const pending = this.discover(provider);
    this.discovery.set(provider.id, pending);
    void pending.catch(() => this.discovery.delete(provider.id));
    return pending;
  }

  private async discover(provider: OidcProviderConfig): Promise<OidcDiscovery> {
    if (provider.authorizationUrl && provider.tokenUrl && provider.jwksUrl) {
      return {
        authorizationEndpoint: endpoint(provider.authorizationUrl, 'authorization_endpoint'),
        tokenEndpoint: endpoint(provider.tokenUrl, 'token_endpoint'),
        jwksUri: endpoint(provider.jwksUrl, 'jwks_uri'),
      };
    }
    const issuer = provider.issuer.replace(/\/$/, '');
    const response = await this.fetchWithTimeout(`${issuer}/.well-known/openid-configuration`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new HttpError(502, `无法读取 ${provider.name} OIDC discovery`);
    const discovery = jsonRecord(await response.json());
    return {
      authorizationEndpoint: endpoint(discovery.authorization_endpoint, 'authorization_endpoint'),
      tokenEndpoint: endpoint(discovery.token_endpoint, 'token_endpoint'),
      jwksUri: endpoint(discovery.jwks_uri, 'jwks_uri'),
    };
  }

  async start(providerId: string): Promise<LoginStart> {
    const provider = this.provider(providerId);
    const discovery = await this.resolve(provider);
    const flow: OidcFlow = {
      providerId,
      state: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
      verifier: randomVerifier(),
    };
    const redirect = new URL(discovery.authorizationEndpoint);
    redirect.searchParams.set('client_id', provider.clientId);
    redirect.searchParams.set('redirect_uri', this.callbackUrl(provider));
    redirect.searchParams.set('response_type', 'code');
    redirect.searchParams.set('scope', 'openid profile email');
    redirect.searchParams.set('state', flow.state);
    redirect.searchParams.set('nonce', flow.nonce);
    redirect.searchParams.set('code_challenge', await challenge(flow.verifier));
    redirect.searchParams.set('code_challenge_method', 'S256');
    return { redirectUrl: redirect.toString(), flowToken: await this.sessions.createFlow(flow) };
  }

  private async exchangeCode(provider: OidcProviderConfig, discovery: OidcDiscovery, flow: OidcFlow, code: string): Promise<string> {
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: provider.clientId,
      redirect_uri: this.callbackUrl(provider),
      code,
      code_verifier: flow.verifier,
    });
    if (provider.clientSecret) tokenBody.set('client_secret', provider.clientSecret);
    const tokenResponse = await this.fetchWithTimeout(discovery.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: tokenBody,
    });
    if (!tokenResponse.ok) throw new HttpError(401, `${provider.name} 登录失败`);
    const tokens = jsonRecord(await tokenResponse.json());
    const idToken = stringField(tokens, 'id_token');
    if (!idToken) throw new HttpError(401, `${provider.name} 未返回 OIDC ID Token`);
    return idToken;
  }

  private async identityFromToken(provider: OidcProviderConfig, discovery: OidcDiscovery, flow: OidcFlow, idToken: string): Promise<EmployeeIdentity> {
    const jwks = createRemoteJWKSet(new URL(discovery.jwksUri), { [customFetch]: this.fetchWithTimeout });
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(idToken, jwks, {
        issuer: provider.issuer.replace(/\/$/, ''),
        audience: provider.clientId,
      });
      payload = verified.payload as Record<string, unknown>;
    } catch {
      throw new HttpError(401, 'OIDC ID Token 校验失败');
    }
    if (payload.nonce !== flow.nonce) throw new HttpError(401, 'OIDC nonce 校验失败');
    const claims = payload;
    const userId = stringClaim(claims, this.config.userIdClaim);
    const email = stringClaim(claims, 'email');
    if (!userId || !email) throw new HttpError(403, '员工身份缺少用户 ID 或邮箱声明');
    if (this.config.requireVerifiedEmail && claims.email_verified !== true) {
      throw new HttpError(403, '身份提供商尚未验证员工邮箱');
    }
    const roles = claimRoles(claims, provider);
    if (!roles.some((role) => this.config.allowedRoles.includes(role))) {
      throw new HttpError(403, '当前账号未获授权访问员工门户');
    }
    return {
      providerId: provider.id,
      userId,
      email,
      name: stringClaim(claims, 'name') || stringClaim(claims, 'preferred_username') || email,
      roles,
    };
  }

  async callback(callbackRequest: OidcCallbackRequest): Promise<EmployeeIdentity> {
    const provider = this.provider(callbackRequest.providerId);
    const flow = await this.sessions.readFlow(callbackRequest.cookieHeader);
    if (flow.providerId !== provider.id || flow.state !== callbackRequest.state) throw new HttpError(400, '登录状态校验失败');
    if (!callbackRequest.code) throw new HttpError(400, '身份提供商未返回授权码');
    const discovery = await this.resolve(provider);
    const idToken = await this.exchangeCode(provider, discovery, flow, callbackRequest.code);
    return this.identityFromToken(provider, discovery, flow, idToken);
  }
}
