import { ELYGATE_ENTERPRISE_MANIFEST } from '@elygate/enterprise-contracts';
import type { ElygateGatewayInstance, PlatformEvent } from '@elygate/enterprise-contracts';

export type SupaCloudGatewayInstallRequest = {
  readonly tenant_id: string;
  readonly org_id: string;
  readonly project_id?: string;
  readonly app_instance_id: string;
  readonly public_base_url?: string;
  readonly admin_base_url?: string;
  readonly database_url_secret_name: string;
  readonly supauth_issuer_url: string;
  readonly supauth_jwks_url: string;
  readonly supauth_audience: string;
};

export type SupaCloudGatewayUninstallRequest = {
  readonly tenant_id: string;
  readonly org_id: string;
  readonly app_id: string;
  readonly app_instance_id: string;
  readonly reason?: string;
};

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  return readString(record, key) ?? undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeInstallRequest(value: unknown): SupaCloudGatewayInstallRequest {
  if (!isRecord(value)) throw new Error('Install request body must be an object');

  const tenantId = readString(value, 'tenant_id');
  const orgId = readString(value, 'org_id');
  const appInstanceId = readString(value, 'app_instance_id');
  const databaseUrlSecretName = readString(value, 'database_url_secret_name');
  const supauthIssuerUrl = readString(value, 'supauth_issuer_url');
  const supauthJwksUrl = readString(value, 'supauth_jwks_url');
  const supauthAudience = readString(value, 'supauth_audience');

  if (!tenantId || !orgId || !appInstanceId || !databaseUrlSecretName || !supauthIssuerUrl || !supauthJwksUrl || !supauthAudience) {
    throw new Error('Install request is missing required SupaCloud/SupAuth fields');
  }

  return {
    tenant_id: tenantId,
    org_id: orgId,
    project_id: readOptionalString(value, 'project_id'),
    app_instance_id: appInstanceId,
    public_base_url: readOptionalString(value, 'public_base_url'),
    admin_base_url: readOptionalString(value, 'admin_base_url'),
    database_url_secret_name: databaseUrlSecretName,
    supauth_issuer_url: supauthIssuerUrl,
    supauth_jwks_url: supauthJwksUrl,
    supauth_audience: supauthAudience,
  };
}

export function normalizeUninstallRequest(value: unknown): SupaCloudGatewayUninstallRequest {
  if (!isRecord(value)) throw new Error('Uninstall request body must be an object');

  const tenantId = readString(value, 'tenant_id');
  const orgId = readString(value, 'org_id');
  const appId = readString(value, 'app_id');
  const appInstanceId = readString(value, 'app_instance_id');

  if (!tenantId || !orgId || !appId || !appInstanceId) {
    throw new Error('Uninstall request is missing required SupaCloud app fields');
  }
  if (appId !== ELYGATE_ENTERPRISE_MANIFEST.app_id) {
    throw new Error('Uninstall request is not for Elygate Enterprise');
  }

  return {
    tenant_id: tenantId,
    org_id: orgId,
    app_id: appId,
    app_instance_id: appInstanceId,
    reason: readOptionalString(value, 'reason'),
  };
}

export type EnterpriseEnv = {
  readonly ELYGATE_LAYER: 'enterprise';
  readonly ELYGATE_APP_ID: string;
  readonly ELYGATE_APP_INSTANCE_ID: string;
  readonly ELYGATE_TENANT_ID: string;
  readonly ELYGATE_ORG_ID: string;
  readonly ELYGATE_PROJECT_ID?: string;
  readonly SUPAUTH_ISSUER_URL: string;
  readonly SUPAUTH_JWKS_URL: string;
  readonly SUPAUTH_AUDIENCE: string;
  readonly DATABASE_URL_SECRET_NAME: string;
};

export type ProjectionAction =
  | { readonly kind: 'upsert-instance'; readonly instance: ElygateGatewayInstance }
  | { readonly kind: 'invalidate-entitlements'; readonly tenant_id: string; readonly org_id: string; readonly app_instance_id?: string }
  | { readonly kind: 'disable-instance'; readonly tenant_id: string; readonly org_id: string; readonly app_instance_id: string }
  | { readonly kind: 'ignore'; readonly reason: string };

export function buildEnterpriseEnv(request: SupaCloudGatewayInstallRequest): EnterpriseEnv {
  return {
    ELYGATE_LAYER: 'enterprise',
    ELYGATE_APP_ID: ELYGATE_ENTERPRISE_MANIFEST.app_id,
    ELYGATE_APP_INSTANCE_ID: request.app_instance_id,
    ELYGATE_TENANT_ID: request.tenant_id,
    ELYGATE_ORG_ID: request.org_id,
    ELYGATE_PROJECT_ID: request.project_id,
    SUPAUTH_ISSUER_URL: request.supauth_issuer_url,
    SUPAUTH_JWKS_URL: request.supauth_jwks_url,
    SUPAUTH_AUDIENCE: request.supauth_audience,
    DATABASE_URL_SECRET_NAME: request.database_url_secret_name,
  };
}

export function toGatewayInstance(request: SupaCloudGatewayInstallRequest): ElygateGatewayInstance {
  const now = new Date().toISOString();
  return {
    tenant_id: request.tenant_id,
    org_id: request.org_id,
    app_id: ELYGATE_ENTERPRISE_MANIFEST.app_id,
    app_instance_id: request.app_instance_id,
    project_id: request.project_id,
    status: 'provisioning',
    public_base_url: request.public_base_url,
    admin_base_url: request.admin_base_url,
    database_url_secret_name: request.database_url_secret_name,
    supauth_issuer_url: request.supauth_issuer_url,
    supauth_jwks_url: request.supauth_jwks_url,
    supauth_audience: request.supauth_audience,
    entitlements_version: 0,
    created_at: now,
    updated_at: now,
  };
}

export function toAppUninstalledEvent(request: SupaCloudGatewayUninstallRequest): Extract<PlatformEvent, { readonly type: 'app.uninstalled' }> {
  return {
    type: 'app.uninstalled',
    tenant_id: request.tenant_id,
    org_id: request.org_id,
    app_id: request.app_id,
    app_instance_id: request.app_instance_id,
  };
}

export function eventToProjectionAction(event: PlatformEvent): ProjectionAction {
  switch (event.type) {
    case 'app.installed':
      return {
        kind: 'invalidate-entitlements',
        tenant_id: event.tenant_id,
        org_id: event.org_id,
        app_instance_id: event.app_instance_id,
      };
    case 'app.uninstalled':
      return {
        kind: 'disable-instance',
        tenant_id: event.tenant_id,
        org_id: event.org_id,
        app_instance_id: event.app_instance_id,
      };
    case 'entitlements.changed':
    case 'org.updated':
      return {
        kind: 'invalidate-entitlements',
        tenant_id: event.tenant_id,
        org_id: event.org_id,
        app_instance_id: 'app_instance_id' in event ? event.app_instance_id : undefined,
      };
    case 'member.removed':
    case 'role.changed':
      return {
        kind: 'invalidate-entitlements',
        tenant_id: event.tenant_id,
        org_id: event.org_id,
      };
    default:
      return { kind: 'ignore', reason: 'Unsupported platform event' };
  }
}

export function createInstallResponse(request: SupaCloudGatewayInstallRequest): {
  readonly manifest: typeof ELYGATE_ENTERPRISE_MANIFEST;
  readonly env: EnterpriseEnv;
  readonly instance: ElygateGatewayInstance;
} {
  return {
    manifest: ELYGATE_ENTERPRISE_MANIFEST,
    env: buildEnterpriseEnv(request),
    instance: toGatewayInstance(request),
  };
}
