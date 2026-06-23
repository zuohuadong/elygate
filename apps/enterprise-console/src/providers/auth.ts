import { decodeJwtPayloadUnverified } from '@elygate/enterprise-authz';
import { normalizePlatformClaims } from '@elygate/enterprise-contracts';
import type { AuthActionResult, AuthProvider, CheckResult, Identity } from '@svadmin/core';

const tokenKey = 'supauth_token';

function readIdentityFromToken(token: string | null): Identity | null {
  if (!token) return null;
  const payload = decodeJwtPayloadUnverified(token);
  const claims = normalizePlatformClaims(payload);
  if (!claims) return null;
  return {
    id: claims.user_id ?? claims.service_account_id ?? claims.subject ?? 'enterprise-actor',
    name: claims.user_id ?? claims.service_account_id ?? 'Enterprise Actor',
    role: claims.roles.includes('owner') || claims.roles.includes('admin') ? 10 : 1,
    avatar: '',
    tenantId: claims.tenant_id,
    orgId: claims.org_id,
    appInstanceId: claims.app_instance_id,
    scopes: claims.scopes,
  };
}

export function getSupAuthToken(): string | null {
  return localStorage.getItem(tokenKey);
}

export function getSupAuthHeaders(): Record<string, string> {
  const token = getSupAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function createEnterpriseAuthProvider(): AuthProvider {
  const developmentOpenMode = import.meta.env.DEV && import.meta.env.VITE_ENTERPRISE_AUTH_MODE !== 'strict';

  return {
    async login(params: Record<string, unknown>): Promise<AuthActionResult> {
      const token = typeof params.token === 'string' ? params.token.trim() : '';
      if (!token) return { success: false, error: { message: '请输入 SupAuth JWT' } };
      const identity = readIdentityFromToken(token);
      if (!identity) return { success: false, error: { message: 'SupAuth JWT 缺少 Elygate Enterprise claims' } };
      localStorage.setItem(tokenKey, token);
      return { success: true, redirectTo: '/' };
    },
    async logout(): Promise<AuthActionResult> {
      localStorage.removeItem(tokenKey);
      return { success: true, redirectTo: '/login' };
    },
    async check(): Promise<CheckResult> {
      if (developmentOpenMode) return { authenticated: true };
      return readIdentityFromToken(getSupAuthToken())
        ? { authenticated: true }
        : { authenticated: false, redirectTo: '/login', logout: true };
    },
    async getIdentity(): Promise<Identity | null> {
      return readIdentityFromToken(getSupAuthToken()) ?? {
        id: 'local-enterprise-admin',
        name: 'Local Enterprise Admin',
        role: 10,
        avatar: '',
      };
    },
    async getPermissions(): Promise<unknown> {
      const identity = readIdentityFromToken(getSupAuthToken());
      return identity?.scopes ?? ['ai.gateway.admin'];
    },
  };
}
