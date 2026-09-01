import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../src/config.ts';

const baseEnv = {
  EMPLOYEE_PORTAL_PUBLIC_URL: 'https://elygate.example.com/employee',
  EMPLOYEE_PORTAL_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  BIFROST_MANAGEMENT_URL: 'http://elygate:8080',
  BIFROST_MANAGEMENT_TOKEN: 'test-management-token',
};

describe('employee portal config', () => {
  test('supports SupAuth public clients without a client secret', () => {
    const config = loadConfig({
      ...baseEnv,
      SUPAUTH_ISSUER: 'https://auth.example.com/auth/v1',
      SUPAUTH_CLIENT_ID: 'employee-portal',
      SUPAUTH_PROJECT_REF: 'project-1',
    });
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]).toMatchObject({ id: 'supauth', clientSecret: undefined, projectRef: 'project-1' });
    expect(config.requireVerifiedEmail).toBe(true);
    expect(config.allowedRoles).toEqual(['employee']);
  });

  test('loads SupAuth and a second enterprise SSO independently', () => {
    const config = loadConfig({
      ...baseEnv,
      SUPAUTH_ISSUER: 'https://auth.example.com/auth/v1',
      SUPAUTH_CLIENT_ID: 'supauth-client',
      ENTERPRISE_SSO_ISSUER: 'https://sso.example.com',
      ENTERPRISE_SSO_CLIENT_ID: 'sso-client',
      ENTERPRISE_SSO_CLIENT_SECRET: 'confidential-secret',
    });
    expect(config.providers.map(({ id }) => id)).toEqual(['supauth', 'enterprise-sso']);
  });

  test('rejects weak session secrets and non-TLS public URLs', () => {
    expect(() => loadConfig({
      ...baseEnv,
      EMPLOYEE_PORTAL_SESSION_SECRET: 'short',
      SUPAUTH_ISSUER: 'https://auth.example.com/auth/v1',
      SUPAUTH_CLIENT_ID: 'client',
    })).toThrow('至少需要 32 字节');
    expect(() => loadConfig({
      ...baseEnv,
      EMPLOYEE_PORTAL_PUBLIC_URL: 'http://elygate.example.com/employee',
      SUPAUTH_ISSUER: 'https://auth.example.com/auth/v1',
      SUPAUTH_CLIENT_ID: 'client',
    })).toThrow('必须使用 HTTPS');
    expect(() => loadConfig({
      ...baseEnv,
      SUPAUTH_ISSUER: 'http://auth.example.com/auth/v1',
      SUPAUTH_CLIENT_ID: 'client',
    })).toThrow('SUPAUTH_ISSUER 必须使用 HTTPS');
  });
});
