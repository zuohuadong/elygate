export const ELYGATE_LAYERS = {
  gateway: 'gateway',
  panel: 'panel',
  enterprise: 'enterprise',
} as const;

export type ElygateLayer = (typeof ELYGATE_LAYERS)[keyof typeof ELYGATE_LAYERS];

export const AI_GATEWAY_SCOPES = {
  gatewayAdmin: 'ai.gateway.admin',
  gatewayRead: 'ai.gateway.read',
  keyManage: 'ai.key.manage',
  usageRead: 'ai.usage.read',
  policyManage: 'ai.policy.manage',
  channelManage: 'ai.channel.manage',
  auditRead: 'ai.audit.read',
  memoryManage: 'ai.memory.manage',
} as const;

export type AiGatewayScope = (typeof AI_GATEWAY_SCOPES)[keyof typeof AI_GATEWAY_SCOPES];

export const ENTERPRISE_ROLES = {
  owner: 'owner',
  admin: 'admin',
  developer: 'developer',
  billing: 'billing',
  auditor: 'auditor',
  serviceAccount: 'service_account',
} as const;

export type EnterpriseRole = (typeof ENTERPRISE_ROLES)[keyof typeof ENTERPRISE_ROLES];

export type EnterpriseTokenKind = 'supauth-jwt' | 'supauth-service-token' | 'gateway-api-key';

export type PlatformClaims = {
  readonly tenant_id: string;
  readonly org_id: string;
  readonly app_id: string;
  readonly app_instance_id: string;
  readonly project_id?: string;
  readonly user_id?: string;
  readonly membership_id?: string;
  readonly service_account_id?: string;
  readonly roles: readonly string[];
  readonly scopes: readonly string[];
  readonly entitlements_version: number;
  readonly token_kind?: EnterpriseTokenKind;
  readonly issuer?: string;
  readonly subject?: string;
  readonly audience?: string | readonly string[];
  readonly expires_at?: number;
  readonly issued_at?: number;
};

export type EnterpriseResourceName =
  | 'gateway_instances'
  | 'provider_channels'
  | 'model_routes'
  | 'model_policies'
  | 'policy_evaluations'
  | 'gateway_api_keys'
  | 'budgets'
  | 'budget_evaluations'
  | 'usage_ledger'
  | 'usage_attribution'
  | 'request_logs'
  | 'response_cache'
  | 'semantic_cache'
  | 'agent_memories'
  | 'audit_events';

export type EnterprisePolicyEffect = 'allow' | 'deny';
export type EnterprisePolicyDecision = 'allow' | 'deny';
export type EnterpriseBudgetDecision = 'allow' | 'warn' | 'deny';

export type EnterpriseGatewayInstanceScope = {
  readonly scope_kind: 'gateway_instance';
  readonly tenant_id: string;
  readonly org_id: string;
  readonly app_instance_id: string;
  readonly project_id?: string | null;
};

export type EnterpriseListQuery = {
  readonly page?: unknown;
  readonly limit?: unknown;
  readonly [key: string]: unknown;
};

export type EnterpriseScopeBoundary = 'gateway_instance_projection' | 'global_provider_catalog';

export type EnterpriseResourcePage<T> = {
  readonly data: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly scope: EnterpriseGatewayInstanceScope;
  readonly scope_boundary: EnterpriseScopeBoundary;
};

export type EnterprisePolicyEvaluationInput = {
  readonly action?: string;
  readonly resource?: string;
  readonly model?: string;
  readonly channel_id?: string | number;
  readonly api_key_id?: string | number;
  readonly user_id?: string;
  readonly service_account_id?: string;
  readonly project_id?: string;
  readonly external_user_id?: string;
  readonly external_workspace_id?: string;
  readonly external_feature_type?: string;
  readonly roles?: readonly string[];
  readonly scopes?: readonly string[];
  readonly metadata?: Record<string, unknown>;
};

export type EnterprisePolicyEvaluationMatch = {
  readonly id: number;
  readonly name: string;
  readonly effect: EnterprisePolicyEffect;
  readonly target_kind: string;
  readonly target_id?: string | null;
  readonly matched_rules: readonly string[];
};

export type EnterprisePolicyEvaluationResult = {
  readonly decision: EnterprisePolicyDecision;
  readonly reason: string;
  readonly scope: EnterpriseGatewayInstanceScope;
  readonly input: EnterprisePolicyEvaluationInput;
  readonly matched_policies: readonly EnterprisePolicyEvaluationMatch[];
  readonly allow_policy_ids: readonly number[];
  readonly deny_policy_ids: readonly number[];
  readonly evaluated_policy_count: number;
};

export type EnterpriseBudgetEvaluationInput = {
  readonly subject_kind?: string;
  readonly subject_id?: string | number | null;
  readonly action?: string;
  readonly model?: string;
  readonly requested_quota?: number;
  readonly current_quota_cost?: number;
  readonly projected_quota_cost?: number;
  readonly user_id?: string;
  readonly service_account_id?: string;
  readonly project_id?: string;
  readonly api_key_id?: string | number;
  readonly channel_id?: string | number;
  readonly external_user_id?: string;
  readonly external_workspace_id?: string;
  readonly external_feature_type?: string;
  readonly metadata?: Record<string, unknown>;
};

export type EnterpriseBudgetEvaluationMatch = {
  readonly id: number;
  readonly subject_kind: string;
  readonly subject_id?: string | null;
  readonly period: string;
  readonly status: string;
  readonly limit_quota: number;
  readonly used_quota: number;
  readonly requested_quota: number;
  readonly projected_quota: number;
  readonly projected_usage_percent: number;
  readonly alert_threshold_pct: number;
  readonly decision: EnterpriseBudgetDecision;
  readonly reset_at?: string | null;
};

export type EnterpriseBudgetEvaluationResult = {
  readonly decision: EnterpriseBudgetDecision;
  readonly reason: string;
  readonly scope: EnterpriseGatewayInstanceScope;
  readonly input: EnterpriseBudgetEvaluationInput;
  readonly matched_budgets: readonly EnterpriseBudgetEvaluationMatch[];
  readonly warning_budget_ids: readonly number[];
  readonly blocking_budget_ids: readonly number[];
  readonly evaluated_budget_count: number;
};

export type PlatformEvent =
  | { readonly type: 'org.updated'; readonly tenant_id: string; readonly org_id: string; readonly entitlements_version: number }
  | { readonly type: 'member.removed'; readonly tenant_id: string; readonly org_id: string; readonly user_id: string; readonly membership_id?: string }
  | { readonly type: 'role.changed'; readonly tenant_id: string; readonly org_id: string; readonly user_id: string; readonly roles: readonly string[]; readonly scopes: readonly string[]; readonly entitlements_version: number }
  | { readonly type: 'app.installed'; readonly tenant_id: string; readonly org_id: string; readonly app_id: string; readonly app_instance_id: string }
  | { readonly type: 'app.uninstalled'; readonly tenant_id: string; readonly org_id: string; readonly app_id: string; readonly app_instance_id: string }
  | { readonly type: 'entitlements.changed'; readonly tenant_id: string; readonly org_id: string; readonly app_id: string; readonly app_instance_id: string; readonly entitlements_version: number };

export type GatewayInstanceStatus = 'provisioning' | 'active' | 'suspended' | 'deleted';

export type ElygateGatewayInstance = {
  readonly tenant_id: string;
  readonly org_id: string;
  readonly app_id: string;
  readonly app_instance_id: string;
  readonly project_id?: string;
  readonly status: GatewayInstanceStatus;
  readonly public_base_url?: string;
  readonly admin_base_url?: string;
  readonly database_url_secret_name?: string;
  readonly supauth_issuer_url: string;
  readonly supauth_jwks_url: string;
  readonly supauth_audience: string;
  readonly entitlements_version: number;
  readonly created_at?: string;
  readonly updated_at?: string;
};

export type ElygateEnterpriseManifest = {
  readonly app_id: string;
  readonly name: string;
  readonly layers: readonly ElygateLayer[];
  readonly required_scopes: readonly AiGatewayScope[];
  readonly resources: readonly EnterpriseResourceName[];
  readonly callbacks: {
    readonly install: string;
    readonly uninstall: string;
    readonly events: string;
    readonly health: string;
  };
};

export const ELYGATE_ENTERPRISE_MANIFEST: ElygateEnterpriseManifest = {
  app_id: 'elygate-ai-gateway',
  name: 'Elygate Enterprise AI Gateway',
  layers: [ELYGATE_LAYERS.gateway, ELYGATE_LAYERS.panel, ELYGATE_LAYERS.enterprise],
  required_scopes: [
    AI_GATEWAY_SCOPES.gatewayAdmin,
    AI_GATEWAY_SCOPES.gatewayRead,
    AI_GATEWAY_SCOPES.keyManage,
    AI_GATEWAY_SCOPES.usageRead,
    AI_GATEWAY_SCOPES.policyManage,
    AI_GATEWAY_SCOPES.channelManage,
    AI_GATEWAY_SCOPES.auditRead,
    AI_GATEWAY_SCOPES.memoryManage,
  ],
  resources: [
    'gateway_instances',
    'provider_channels',
    'model_routes',
    'model_policies',
    'policy_evaluations',
    'gateway_api_keys',
    'budgets',
    'budget_evaluations',
    'usage_ledger',
    'usage_attribution',
    'request_logs',
    'response_cache',
    'semantic_cache',
    'agent_memories',
    'audit_events',
  ],
  callbacks: {
    install: '/api/enterprise/install',
    uninstall: '/api/enterprise/uninstall',
    events: '/api/enterprise/events',
    health: '/api/enterprise/health',
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  return readString(record, key) ?? undefined;
}

function readNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function readAudience(record: Record<string, unknown>): string | readonly string[] | undefined {
  const value = record.aud ?? record.audience;
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

export function normalizePlatformClaims(value: unknown): PlatformClaims | null {
  if (!isRecord(value)) return null;

  const tenantId = readString(value, 'tenant_id');
  const orgId = readString(value, 'org_id');
  const appId = readString(value, 'app_id');
  const appInstanceId = readString(value, 'app_instance_id');
  if (!tenantId || !orgId || !appId || !appInstanceId) return null;

  return {
    tenant_id: tenantId,
    org_id: orgId,
    app_id: appId,
    app_instance_id: appInstanceId,
    project_id: readOptionalString(value, 'project_id'),
    user_id: readOptionalString(value, 'user_id') ?? readOptionalString(value, 'sub'),
    membership_id: readOptionalString(value, 'membership_id'),
    service_account_id: readOptionalString(value, 'service_account_id'),
    roles: readStringArray(value, 'roles'),
    scopes: readStringArray(value, 'scopes').length ? readStringArray(value, 'scopes') : readStringArray(value, 'scope'),
    entitlements_version: readNumber(value, 'entitlements_version', 0),
    token_kind: readOptionalString(value, 'token_kind') as EnterpriseTokenKind | undefined,
    issuer: readOptionalString(value, 'iss') ?? readOptionalString(value, 'issuer'),
    subject: readOptionalString(value, 'sub') ?? readOptionalString(value, 'subject'),
    audience: readAudience(value),
    expires_at: readNumber(value, 'exp', 0) || undefined,
    issued_at: readNumber(value, 'iat', 0) || undefined,
  };
}

export function requirePlatformClaims(value: unknown): PlatformClaims {
  const claims = normalizePlatformClaims(value);
  if (!claims) throw new Error('Invalid SupAuth platform claims for Elygate Enterprise');
  return claims;
}

export function entitlementsCacheKey(claims: Pick<PlatformClaims, 'tenant_id' | 'org_id' | 'app_instance_id' | 'entitlements_version'>): string {
  return `${claims.tenant_id}:${claims.org_id}:${claims.app_instance_id}:${claims.entitlements_version}`;
}
