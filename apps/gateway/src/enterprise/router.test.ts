import { beforeEach, describe, expect, test } from 'bun:test';
import { AI_GATEWAY_SCOPES, ELYGATE_ENTERPRISE_MANIFEST } from '@elygate/enterprise-contracts';
import type { PlatformClaims, PlatformEvent } from '@elygate/enterprise-contracts';
import { evaluateEnterpriseBudgets, evaluateEnterprisePolicies } from '@elygate/enterprise-authz';
import type { EnterpriseControlPlane, EnterpriseRequestMeta, JsonObject, ListQuery } from './controlPlane';

process.env.SUPAUTH_JWKS_URL = '';
process.env.SUPAUTH_ISSUER_URL = '';
process.env.ENTERPRISE_AUTH_MODE = '';
process.env.GATEWAY_URL = 'http://localhost:3000';

const { createEnterpriseRouter } = await import('./router');

type GatewayInstanceRecord = {
    id: number;
    tenant_id: string;
    org_id: string;
    app_id: string;
    app_instance_id: string;
    project_id?: string;
    status: string;
    public_base_url?: string;
    admin_base_url?: string;
    entitlements_version: number;
};

type PolicyRecord = {
    id: number;
    tenant_id: string;
    org_id: string;
    app_instance_id: string;
    name: string;
    target_kind: string;
    target_id?: string;
    effect: string;
    rules: JsonObject;
    status: string;
};

type BudgetRecord = {
    id: number;
    tenant_id: string;
    org_id: string;
    app_instance_id: string;
    subject_kind: string;
    subject_id?: string;
    period: string;
    limit_quota: number;
    used_quota: number;
    usage_percent: number;
    alert_threshold_pct: number;
    status: string;
};

type AuditRecord = {
    id: number;
    tenant_id: string;
    org_id: string;
    app_instance_id: string;
    actor_type: string;
    actor_id: string;
    action: string;
    resource: string;
    resource_id: string | null;
    details: JsonObject;
    created_at?: string;
};

type GatewayResourcePage<T> = {
    data: readonly T[];
    total: number;
    page: number;
    limit: number;
    scope: {
        scope_kind: 'gateway_instance';
        tenant_id: string;
        org_id: string;
        app_instance_id: string;
        project_id: string | null;
    };
};

function encodeSegment(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(scopes: readonly string[] = [AI_GATEWAY_SCOPES.gatewayAdmin]): string {
    return `${encodeSegment({ alg: 'none', typ: 'JWT' })}.${encodeSegment({
        tenant_id: 'tenant_demo',
        org_id: 'org_demo',
        app_id: ELYGATE_ENTERPRISE_MANIFEST.app_id,
        app_instance_id: 'agi_demo',
        user_id: 'user_demo',
        roles: ['owner'],
        scopes,
        entitlements_version: 1,
        aud: 'http://localhost:3000',
    })}.`;
}

function bearer(scopes?: readonly string[]): HeadersInit {
    return {
        authorization: `Bearer ${token(scopes)}`,
        'content-type': 'application/json',
    };
}

function body(value: unknown): BodyInit {
    return JSON.stringify(value);
}

function readString(record: JsonObject, key: string, fallback = ''): string {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readNumber(record: JsonObject, key: string, fallback = 0): number {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return fallback;
}

function readObject(value: unknown): JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : {};
}

function assertSameScope(claims: PlatformClaims, bodyValue: JsonObject): void {
    const tenantId = readString(bodyValue, 'tenant_id', claims.tenant_id);
    const orgId = readString(bodyValue, 'org_id', claims.org_id);
    if (tenantId !== claims.tenant_id || orgId !== claims.org_id) {
        throw Object.assign(new Error('Install request scope does not match SupAuth claims'), { statusCode: 403 });
    }
    const appInstanceId = readString(bodyValue, 'app_instance_id', claims.app_instance_id);
    if (appInstanceId !== claims.app_instance_id) {
        throw Object.assign(new Error('Install request app instance does not match SupAuth claims'), { statusCode: 403 });
    }
}

function usagePercent(used: number, limit: number): number {
    return limit > 0 ? Math.round((used / limit) * 10000) / 100 : 0;
}

function paginate<T>(rows: readonly T[], query?: ListQuery): { data: readonly T[]; total: number; page: number; limit: number } {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query?.limit) || 30));
    return {
        data: rows.slice((page - 1) * limit, page * limit),
        total: rows.length,
        page,
        limit,
    };
}

function queryRecord(query?: ListQuery): JsonObject {
    return readObject(query);
}

function queryString(query: JsonObject, key: string): string {
    return readString(query, key);
}

function filterAudits(claims: PlatformClaims, rows: readonly AuditRecord[], query?: ListQuery): AuditRecord[] {
    const filters = queryRecord(query);
    const action = queryString(filters, 'action');
    const resource = queryString(filters, 'resource');
    const actorType = queryString(filters, 'actor_type');
    const actorId = queryString(filters, 'actor_id');
    const resourceId = queryString(filters, 'resource_id');
    const appInstanceId = queryString(filters, 'app_instance_id');
    const q = queryString(filters, 'q');
    return rows.filter((item) => {
        if (item.tenant_id !== claims.tenant_id || item.org_id !== claims.org_id) return false;
        if (action && item.action !== action) return false;
        if (resource && item.resource !== resource) return false;
        if (actorType && item.actor_type !== actorType) return false;
        if (actorId && item.actor_id !== actorId) return false;
        if (resourceId && item.resource_id !== resourceId) return false;
        if (appInstanceId && item.app_instance_id !== appInstanceId) return false;
        if (q) {
            const haystack = JSON.stringify(item).toLowerCase();
            if (!haystack.includes(q.toLowerCase())) return false;
        }
        return true;
    });
}

function csvCell(value: unknown): string {
    const text = typeof value === 'object' && value !== null
        ? JSON.stringify(value)
        : value === undefined || value === null
            ? ''
            : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function auditCsv(rows: readonly AuditRecord[]): string {
    const header = ['id', 'actor_type', 'actor_id', 'action', 'resource', 'resource_id', 'details'];
    return [
        header.join(','),
        ...rows.map((item) => [
            item.id,
            item.actor_type,
            item.actor_id,
            item.action,
            item.resource,
            item.resource_id ?? '',
            item.details,
        ].map(csvCell).join(',')),
    ].join('\n');
}

function gatewayResourcePage<T>(claims: PlatformClaims, rows: readonly T[], query?: ListQuery): GatewayResourcePage<T> {
    return {
        ...paginate(rows, query),
        scope: {
            scope_kind: 'gateway_instance',
            tenant_id: claims.tenant_id,
            org_id: claims.org_id,
            app_instance_id: claims.app_instance_id,
            project_id: claims.project_id ?? null,
        },
    };
}

function createMemoryControlPlane(): EnterpriseControlPlane {
    const instances: GatewayInstanceRecord[] = [];
    const policies: PolicyRecord[] = [];
    const budgets: BudgetRecord[] = [];
    const audits: AuditRecord[] = [];
    const memberships: JsonObject[] = [];
    const invoices: JsonObject[] = [];
    const providerCompliance: JsonObject[] = [];
    let entitlements: JsonObject | null = null;
    let billingAccount: JsonObject | null = null;
    const providerChannels = [
        {
            id: 1,
            name: 'OpenAI Primary',
            type: 1,
            credential_mask: 'sk-live...1234',
            models: ['gpt-4.1'],
            status: 1,
            endpoint_type: 'chat',
            groups: ['default'],
        },
    ];
    const modelRoutes = [
        {
            id: '1:gpt-4.1',
            model_name: 'gpt-4.1',
            channel_id: 1,
            channel_name: 'OpenAI Primary',
            provider_type: 1,
            status: 1,
            priority: 0,
            weight: 1,
        },
    ];
    const gatewayApiKeys = [
        {
            id: 1,
            user_id: 1,
            username: 'owner@example.com',
            name: 'Production key',
            key_mask: 'sk-prod...abcd',
            status: 1,
            remain_quota: 100000,
            used_quota: 2500,
            models: ['gpt-4.1'],
        },
    ];
    const requestLogs = [
        {
            id: 1,
            user_id: 1,
            token_id: 1,
            channel_id: 1,
            model_name: 'gpt-4.1',
            quota_cost: 42,
            prompt_tokens: 100,
            completion_tokens: 24,
            cached_tokens: 8,
            elapsed_ms: 320,
            status_code: 200,
            trace_id: 'trace_demo',
            external_user_id: 'external_user_demo',
            external_workspace_id: 'workspace_demo',
            external_feature_type: 'chat',
        },
    ];
    const agentMemoryRecords = [
        {
            id: 'mem_demo',
            user_id: 1,
            token_id: 1,
            scope: 'user',
            kind: 'fact',
            content_preview: 'prefers concise answers',
            content_length: 23,
            confidence: 0.9,
        },
    ];

    function actorId(claims: PlatformClaims): string {
        return claims.user_id ?? claims.service_account_id ?? claims.subject ?? 'enterprise-actor';
    }

    function recordAudit(claims: PlatformClaims, action: string, resource: string, resourceId: string | null, details: JsonObject): void {
        audits.push({
            id: audits.length + 1,
            tenant_id: claims.tenant_id,
            org_id: claims.org_id,
            app_instance_id: claims.app_instance_id,
            actor_type: claims.service_account_id ? 'service_account' : 'user',
            actor_id: actorId(claims),
            action,
            resource,
            resource_id: resourceId,
            details,
            created_at: new Date(Date.UTC(2026, 5, 20, 12, audits.length, 0)).toISOString(),
        });
    }

    function scoped<T extends { tenant_id: string; org_id: string }>(claims: PlatformClaims, rows: readonly T[]): T[] {
        return rows.filter((row) => row.tenant_id === claims.tenant_id && row.org_id === claims.org_id);
    }

    function usageAttribution(claims: PlatformClaims, query?: ListQuery) {
        const days = Math.min(90, Math.max(1, Number((query as { days?: unknown } | undefined)?.days) || 7));
        const scope = gatewayResourcePage(claims, [], query).scope;
        const sample = {
            requests: 1,
            quota_cost: 42,
            prompt_tokens: 100,
            completion_tokens: 24,
            cached_tokens: 8,
            error_count: 0,
            avg_elapsed_ms: 320,
            last_seen_at: '2026-06-21T00:00:00.000Z',
        };
        return {
            scope,
            scope_boundary: 'gateway_instance_projection',
            window: {
                days,
                since: '2026-06-14T00:00:00.000Z',
                until: '2026-06-21T00:00:00.000Z',
            },
            totals: sample,
            dimensions: {
                models: [{ dimension: 'model', subject_id: 'gpt-4.1', subject_label: 'gpt-4.1', subject_secondary: null, credential_mask: null, ...sample }],
                users: [{ dimension: 'user', subject_id: '1', subject_label: 'owner@example.com', subject_secondary: null, credential_mask: null, ...sample }],
                api_keys: [{ dimension: 'api_key', subject_id: '1', subject_label: 'Production key', subject_secondary: '1', credential_mask: 'sk-prod...abcd', ...sample }],
                channels: [{ dimension: 'channel', subject_id: '1', subject_label: 'OpenAI Primary', subject_secondary: '1', credential_mask: null, ...sample }],
                external_users: [{ dimension: 'external_user', subject_id: 'external_user_demo', subject_label: 'external_user_demo', subject_secondary: null, credential_mask: null, ...sample }],
                external_workspaces: [{ dimension: 'external_workspace', subject_id: 'workspace_demo', subject_label: 'workspace_demo', subject_secondary: null, credential_mask: null, ...sample }],
                external_features: [{ dimension: 'external_feature', subject_id: 'chat', subject_label: 'chat', subject_secondary: null, credential_mask: null, ...sample }],
            },
        };
    }

    function policyEvaluation(claims: PlatformClaims, value: unknown) {
        const payload = readObject(value);
        return evaluateEnterprisePolicies(
            claims,
            {
                action: readString(payload, 'action', 'request'),
                resource: readString(payload, 'resource', 'ai.gateway.request'),
                model: readString(payload, 'model') || undefined,
                user_id: readString(payload, 'user_id', claims.user_id ?? ''),
                service_account_id: readString(payload, 'service_account_id', claims.service_account_id ?? '') || undefined,
                project_id: readString(payload, 'project_id', claims.project_id ?? '') || undefined,
                external_workspace_id: readString(payload, 'external_workspace_id') || undefined,
                external_feature_type: readString(payload, 'external_feature_type') || undefined,
                roles: claims.roles,
                scopes: claims.scopes,
            },
            scoped(claims, policies).map((item) => ({
                id: item.id,
                name: item.name,
                target_kind: item.target_kind,
                target_id: item.target_id,
                effect: item.effect,
                rules: item.rules,
                status: item.status,
            })),
            gatewayResourcePage(claims, [], undefined).scope,
        );
    }

    function budgetEvaluation(claims: PlatformClaims, value: unknown) {
        const payload = readObject(value);
        return evaluateEnterpriseBudgets(
            claims,
            {
                subject_kind: readString(payload, 'subject_kind') || undefined,
                subject_id: readString(payload, 'subject_id') || undefined,
                action: readString(payload, 'action', 'request'),
                model: readString(payload, 'model') || undefined,
                requested_quota: readNumber(payload, 'requested_quota', readNumber(payload, 'quota_cost', 0)),
                current_quota_cost: 'current_quota_cost' in payload ? readNumber(payload, 'current_quota_cost', 0) : undefined,
                projected_quota_cost: 'projected_quota_cost' in payload ? readNumber(payload, 'projected_quota_cost', 0) : undefined,
                user_id: readString(payload, 'user_id', claims.user_id ?? '') || undefined,
                service_account_id: readString(payload, 'service_account_id', claims.service_account_id ?? '') || undefined,
                project_id: readString(payload, 'project_id', claims.project_id ?? '') || undefined,
                api_key_id: readString(payload, 'api_key_id') || undefined,
                channel_id: readString(payload, 'channel_id') || undefined,
                external_workspace_id: readString(payload, 'external_workspace_id') || undefined,
                external_feature_type: readString(payload, 'external_feature_type') || undefined,
            },
            scoped(claims, budgets).map((item) => ({
                id: item.id,
                subject_kind: item.subject_kind,
                subject_id: item.subject_id,
                period: item.period,
                limit_quota: item.limit_quota,
                used_quota: item.used_quota,
                alert_threshold_pct: item.alert_threshold_pct,
                status: item.status,
                reset_at: null,
            })),
            gatewayResourcePage(claims, [], undefined).scope,
        );
    }

    function currentEntitlements(claims: PlatformClaims): JsonObject {
        const assignedSeats = memberships.filter((item) => item.seat_status === 'active' || item.seat_status === 'invited').length;
        entitlements = {
            id: 1,
            tenant_id: claims.tenant_id,
            org_id: claims.org_id,
            app_instance_id: claims.app_instance_id,
            seat_limit: Number(entitlements?.seat_limit ?? 5),
            assigned_seats: assignedSeats,
            available_seats: Math.max(0, Number(entitlements?.seat_limit ?? 5) - assignedSeats),
            billing_mode: entitlements?.billing_mode ?? 'prepaid',
            overage_enabled: Boolean(entitlements?.overage_enabled ?? false),
            overage_unit_price_cents: Number(entitlements?.overage_unit_price_cents ?? 0),
            budget_mode: entitlements?.budget_mode ?? 'hard_limit',
            default_no_training: entitlements?.default_no_training ?? true,
            data_retention_days: Number(entitlements?.data_retention_days ?? 30),
            provider_compliance_mode: entitlements?.provider_compliance_mode ?? 'strict',
            allowed_ip_policy: entitlements?.allowed_ip_policy ?? null,
            status: entitlements?.status ?? 'active',
        };
        return entitlements;
    }

    function assignedSeatCount(excludeId?: number): number {
        return memberships.filter((item) => {
            if (excludeId && item.id === excludeId) return false;
            return item.seat_status === 'active' || item.seat_status === 'invited';
        }).length;
    }

    function assertSeatCapacity(claims: PlatformClaims, seatStatus: string, excludeId?: number): void {
        const current = currentEntitlements(claims);
        if ((seatStatus === 'active' || seatStatus === 'invited')
            && assignedSeatCount(excludeId) >= Number(current.seat_limit)
            && !current.overage_enabled) {
            throw Object.assign(new Error('Seat limit reached and overage is disabled'), { statusCode: 402 });
        }
    }

    return {
        async getEnterpriseOverview(claims) {
            const scopedInstances = scoped(claims, instances);
            return {
                claims,
                stats: {
                    gateway_instances: scopedInstances.length,
                    active_instances: scopedInstances.filter((item) => item.status === 'active').length,
                    identity_policies: scoped(claims, policies).length,
                    budgets: scoped(claims, budgets).length,
                    audit_events_24h: scoped(claims, audits).length,
                    requests_7d: 0,
                    cost_7d: 0,
                    gateway_api_keys: 0,
                    provider_channels: 0,
                },
                model_distribution: [],
            };
        },
        async listGatewayInstances(claims, query) {
            return paginate(scoped(claims, instances), query);
        },
        async installEnterpriseGateway(value, claims, meta: EnterpriseRequestMeta) {
            const payload = readObject(value);
            assertSameScope(claims, payload);
            const appInstanceId = readString(payload, 'app_instance_id', claims.app_instance_id);
            const existing = instances.find((item) => item.tenant_id === claims.tenant_id && item.org_id === claims.org_id && item.app_instance_id === appInstanceId);
            const instance: GatewayInstanceRecord = {
                id: existing?.id ?? instances.length + 1,
                tenant_id: claims.tenant_id,
                org_id: claims.org_id,
                app_id: ELYGATE_ENTERPRISE_MANIFEST.app_id,
                app_instance_id: appInstanceId,
                project_id: readString(payload, 'project_id') || undefined,
                status: 'provisioning',
                public_base_url: readString(payload, 'public_base_url') || undefined,
                admin_base_url: readString(payload, 'admin_base_url') || undefined,
                entitlements_version: claims.entitlements_version,
            };
            if (existing) Object.assign(existing, instance);
            else instances.push(instance);
            recordAudit(claims, 'gateway_instance.install', 'gateway_instance', appInstanceId, { ip_address: meta.ipAddress ?? null });
            return {
                manifest: ELYGATE_ENTERPRISE_MANIFEST,
                env: { ELYGATE_LAYER: 'enterprise', ELYGATE_APP_INSTANCE_ID: appInstanceId },
                instance,
            };
        },
        async uninstallEnterpriseGateway(value, claims, meta: EnterpriseRequestMeta) {
            const payload = readObject(value);
            assertSameScope(claims, payload);
            const appId = readString(payload, 'app_id');
            if (appId !== ELYGATE_ENTERPRISE_MANIFEST.app_id) {
                throw Object.assign(new Error('Uninstall request is not for Elygate Enterprise'), { statusCode: 403 });
            }
            const appInstanceId = readString(payload, 'app_instance_id', claims.app_instance_id);
            const instance = instances.find((item) => item.tenant_id === claims.tenant_id && item.org_id === claims.org_id && item.app_instance_id === appInstanceId);
            if (instance) instance.status = 'deleted';
            recordAudit(claims, 'gateway_instance.uninstall', 'gateway_instance', appInstanceId, {
                ip_address: meta.ipAddress ?? null,
                instance_found: Boolean(instance),
            });
            return {
                action: { kind: 'disable-instance', tenant_id: claims.tenant_id, org_id: claims.org_id, app_instance_id: appInstanceId },
                status: instance ? 'deleted' : 'not_found',
                instance: instance ?? null,
            };
        },
        async updateGatewayInstance(claims, idOrInstance, value, meta) {
            const payload = readObject(value);
            const instance = scoped(claims, instances).find((item) => String(item.id) === idOrInstance || item.app_instance_id === idOrInstance);
            if (!instance) throw Object.assign(new Error('Gateway instance not found'), { statusCode: 404 });
            instance.status = readString(payload, 'status', instance.status);
            instance.entitlements_version = readNumber(payload, 'entitlements_version', instance.entitlements_version);
            recordAudit(claims, 'gateway_instance.update', 'gateway_instance', instance.app_instance_id, { ip_address: meta.ipAddress ?? null, status: instance.status });
            return instance;
        },
        async getIdentityAndPolicy(claims, query) {
            const list = paginate(scoped(claims, policies), query);
            return {
                claims,
                roles: claims.roles,
                scopes: claims.scopes,
                available_scopes: Object.values(AI_GATEWAY_SCOPES),
                policies: list.data,
                total: list.total,
            };
        },
        async listIdentityPolicies(claims, query) {
            return paginate(scoped(claims, policies), query);
        },
        async createIdentityPolicy(claims, value, meta) {
            const payload = readObject(value);
            const policy: PolicyRecord = {
                id: policies.length + 1,
                tenant_id: claims.tenant_id,
                org_id: claims.org_id,
                app_instance_id: readString(payload, 'app_instance_id', claims.app_instance_id),
                name: readString(payload, 'name', 'Default Enterprise Policy'),
                target_kind: readString(payload, 'target_kind', 'org'),
                target_id: readString(payload, 'target_id') || undefined,
                effect: readString(payload, 'effect', 'allow'),
                rules: readObject(payload.rules),
                status: readString(payload, 'status', 'active'),
            };
            policies.push(policy);
            recordAudit(claims, 'identity_policy.create', 'identity_policy', String(policy.id), { ip_address: meta.ipAddress ?? null });
            return policy;
        },
        async updateIdentityPolicy(claims, id, value, meta) {
            const payload = readObject(value);
            const policy = scoped(claims, policies).find((item) => String(item.id) === id);
            if (!policy) throw Object.assign(new Error('Identity policy not found'), { statusCode: 404 });
            policy.name = readString(payload, 'name', policy.name);
            policy.status = readString(payload, 'status', policy.status);
            recordAudit(claims, 'identity_policy.update', 'identity_policy', String(policy.id), { ip_address: meta.ipAddress ?? null });
            return policy;
        },
        async evaluateEnterprisePolicy(claims, value, meta) {
            const result = policyEvaluation(claims, value);
            recordAudit(claims, 'identity_policy.evaluate', 'policy_evaluation', result.decision, { ip_address: meta.ipAddress ?? null, decision: result.decision });
            return result;
        },
        async getUsageAndBudget(claims, query) {
            const list = paginate(scoped(claims, budgets), query);
            const attribution = usageAttribution(claims, query);
            return {
                budgets: list.data,
                total: list.total,
                usage_7d: attribution.totals,
                attribution,
            };
        },
        async listUsageAttribution(claims, query) {
            return usageAttribution(claims, query);
        },
        async listBudgets(claims, query) {
            return paginate(scoped(claims, budgets), query);
        },
        async createBudget(claims, value, meta) {
            const payload = readObject(value);
            const limit = readNumber(payload, 'limit_quota', 0);
            const used = readNumber(payload, 'used_quota', 0);
            const budget: BudgetRecord = {
                id: budgets.length + 1,
                tenant_id: claims.tenant_id,
                org_id: claims.org_id,
                app_instance_id: readString(payload, 'app_instance_id', claims.app_instance_id),
                subject_kind: readString(payload, 'subject_kind', 'org'),
                subject_id: readString(payload, 'subject_id') || undefined,
                period: readString(payload, 'period', 'monthly'),
                limit_quota: limit,
                used_quota: used,
                usage_percent: usagePercent(used, limit),
                alert_threshold_pct: readNumber(payload, 'alert_threshold_pct', 80),
                status: readString(payload, 'status', 'active'),
            };
            budgets.push(budget);
            recordAudit(claims, 'budget.create', 'budget', String(budget.id), { ip_address: meta.ipAddress ?? null });
            return budget;
        },
        async updateBudget(claims, id, value, meta) {
            const payload = readObject(value);
            const budget = scoped(claims, budgets).find((item) => String(item.id) === id);
            if (!budget) throw Object.assign(new Error('Budget not found'), { statusCode: 404 });
            budget.used_quota = readNumber(payload, 'used_quota', budget.used_quota);
            budget.limit_quota = readNumber(payload, 'limit_quota', budget.limit_quota);
            budget.usage_percent = usagePercent(budget.used_quota, budget.limit_quota);
            recordAudit(claims, 'budget.update', 'budget', String(budget.id), { ip_address: meta.ipAddress ?? null });
            return budget;
        },
        async evaluateEnterpriseBudget(claims, value, meta) {
            const result = budgetEvaluation(claims, value);
            recordAudit(claims, 'budget.evaluate', 'budget_evaluation', result.decision, { ip_address: meta.ipAddress ?? null, decision: result.decision });
            return result;
        },
        async getMembersAndAccess(claims, query) {
            return {
                entitlements: currentEntitlements(claims),
                memberships: paginate(memberships, query),
                policies: paginate(scoped(claims, policies), query),
            };
        },
        async listMemberships(_claims, query) {
            return paginate(memberships, query);
        },
        async upsertMembership(claims, value, meta) {
            const payload = readObject(value);
            const userId = readString(payload, 'user_id') || null;
            const email = readString(payload, 'email') || null;
            const existing = memberships.find((item) => (userId && item.user_id === userId) || (email && item.email === email));
            const seatStatus = readString(payload, 'seat_status', userId ? 'active' : 'invited');
            assertSeatCapacity(claims, seatStatus, existing?.id as number | undefined);
            const record = {
                id: existing?.id ?? memberships.length + 1,
                tenant_id: claims.tenant_id,
                org_id: claims.org_id,
                app_instance_id: claims.app_instance_id,
                user_id: userId,
                email,
                display_name: readString(payload, 'display_name') || null,
                role: readString(payload, 'role', 'developer'),
                scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
                seat_kind: readString(payload, 'seat_kind', 'human'),
                seat_status: seatStatus,
            };
            if (existing) Object.assign(existing, record);
            else memberships.push(record);
            recordAudit(claims, existing ? 'membership.update' : 'membership.create', 'membership', String(record.id), { ip_address: meta.ipAddress ?? null });
            return record;
        },
        async updateMembership(claims, id, value, meta) {
            const record = memberships.find((item) => String(item.id) === id);
            if (!record) throw Object.assign(new Error('Membership not found'), { statusCode: 404 });
            const payload = readObject(value);
            assertSeatCapacity(claims, readString(payload, 'seat_status', String(record.seat_status)), Number(record.id));
            Object.assign(record, payload);
            recordAudit(claims, 'membership.update', 'membership', id, { ip_address: meta.ipAddress ?? null });
            return record;
        },
        async getOrgEntitlements(claims) {
            return currentEntitlements(claims);
        },
        async updateOrgEntitlements(claims, value, meta) {
            entitlements = { ...currentEntitlements(claims), ...readObject(value) };
            recordAudit(claims, 'entitlements.update', 'org_entitlements', '1', { ip_address: meta.ipAddress ?? null });
            return currentEntitlements(claims);
        },
        async getUsageEfficiency(claims, query) {
            const attribution = usageAttribution(claims, query);
            return {
                scope: attribution.scope,
                window: attribution.window,
                totals: attribution.totals,
                efficiency: {
                    quota_per_request: 42,
                    error_rate_pct: 0,
                    cache_ratio_pct: 6.45,
                    avg_elapsed_ms: 320,
                },
                dimensions: attribution.dimensions,
            };
        },
        async getBillingAndInvoices(_claims, query) {
            return {
                billing_account: billingAccount,
                invoices: paginate(invoices, query),
                unbilled_usage: { quantity: 0, amount_cents: 0 },
            };
        },
        async listInvoices(_claims, query) {
            return paginate(invoices, query);
        },
        async upsertBillingAccount(claims, value, meta) {
            const payload = readObject(value);
            billingAccount = {
                id: 1,
                tenant_id: claims.tenant_id,
                org_id: claims.org_id,
                app_instance_id: claims.app_instance_id,
                billing_name: readString(payload, 'billing_name', claims.org_id),
                billing_email: readString(payload, 'billing_email') || null,
                currency: readString(payload, 'currency', 'USD'),
                status: readString(payload, 'status', 'active'),
            };
            recordAudit(claims, 'billing_account.create', 'billing_account', '1', { ip_address: meta.ipAddress ?? null });
            return billingAccount;
        },
        async createInvoice(claims, value, meta) {
            const payload = readObject(value);
            const itemRows = Array.isArray(payload.items) ? payload.items.map(readObject) : [];
            const total = itemRows.reduce((sum, item) => sum + readNumber(item, 'amount_cents', readNumber(item, 'quantity', 1) * readNumber(item, 'unit_amount_cents', 0)), 0);
            const invoice = {
                id: invoices.length + 1,
                tenant_id: claims.tenant_id,
                org_id: claims.org_id,
                app_instance_id: claims.app_instance_id,
                invoice_number: readString(payload, 'invoice_number', `ELY-${invoices.length + 1}`),
                subtotal_cents: total,
                tax_cents: readNumber(payload, 'tax_cents', 0),
                total_cents: total + readNumber(payload, 'tax_cents', 0),
                status: readString(payload, 'status', 'draft'),
                items: itemRows,
            };
            invoices.push(invoice);
            recordAudit(claims, 'invoice.create', 'invoice', String(invoice.id), { ip_address: meta.ipAddress ?? null });
            return invoice;
        },
        async getDataGovernance(claims, query) {
            const ent = currentEntitlements(claims);
            return {
                entitlements: ent,
                providers: paginate(providerCompliance, query),
                enforcement: {
                    default_no_training: ent.default_no_training,
                    provider_compliance_mode: ent.provider_compliance_mode,
                    allowed_providers: providerCompliance.filter((item) => item.status === 'approved' && item.no_training),
                    blocked_providers: providerCompliance.filter((item) => item.status !== 'approved' || !item.no_training),
                },
            };
        },
        async upsertProviderCompliance(claims, value, meta) {
            const payload = readObject(value);
            const record = {
                id: providerCompliance.length + 1,
                tenant_id: claims.tenant_id,
                org_id: claims.org_id,
                app_instance_id: claims.app_instance_id,
                provider_kind: readString(payload, 'provider_kind', 'channel'),
                provider_id: readString(payload, 'provider_id', 'provider_demo'),
                display_name: readString(payload, 'display_name') || null,
                no_training: Boolean(payload.no_training),
                zero_retention: Boolean(payload.zero_retention),
                status: readString(payload, 'status', 'review'),
            };
            providerCompliance.push(record);
            recordAudit(claims, 'provider_compliance.create', 'provider_compliance', String(record.id), { ip_address: meta.ipAddress ?? null });
            return record;
        },
        async listAuditEvents(claims, query) {
            return paginate(filterAudits(claims, audits, query), query);
        },
        async exportAuditEvents(claims, query) {
            const rows = filterAudits(claims, audits, query);
            return {
                filename: 'elygate-audit-events-test.csv',
                content_type: 'text/csv; charset=utf-8',
                total: rows.length,
                content: auditCsv(rows),
            };
        },
        async listProviderChannels(claims, query) {
            return gatewayResourcePage(claims, providerChannels, query);
        },
        async listModelRoutes(claims, query) {
            return gatewayResourcePage(claims, modelRoutes, query);
        },
        async listGatewayApiKeys(claims, query) {
            return gatewayResourcePage(claims, gatewayApiKeys, query);
        },
        async listRequestLogs(claims, query) {
            return gatewayResourcePage(claims, requestLogs, query);
        },
        async listAgentMemories(claims, query) {
            return gatewayResourcePage(claims, agentMemoryRecords, query);
        },
        async applyPlatformEvent(event: PlatformEvent, claims, meta) {
            if (event.tenant_id !== claims.tenant_id || event.org_id !== claims.org_id) {
                throw Object.assign(new Error('Platform event scope does not match SupAuth claims'), { statusCode: 403 });
            }
            if (event.type === 'app.uninstalled') {
                const instance = instances.find((item) => item.tenant_id === event.tenant_id && item.org_id === event.org_id && item.app_instance_id === event.app_instance_id);
                if (instance) instance.status = 'deleted';
                recordAudit(claims, 'platform.app.uninstalled', 'platform_event', event.app_instance_id, { ip_address: meta.ipAddress ?? null });
                return { kind: 'disable-instance', tenant_id: event.tenant_id, org_id: event.org_id, app_instance_id: event.app_instance_id };
            }
            recordAudit(claims, `platform.${event.type}`, 'platform_event', 'app_instance_id' in event ? event.app_instance_id : null, { ip_address: meta.ipAddress ?? null });
            return { kind: 'invalidate-entitlements', tenant_id: event.tenant_id, org_id: event.org_id, app_instance_id: 'app_instance_id' in event ? event.app_instance_id : undefined };
        },
    };
}

async function hit(app: ReturnType<typeof createEnterpriseRouter>, path: string, init: RequestInit = {}) {
    const response = await app.handle(new Request(`http://localhost${path}`, init));
    return {
        status: response.status,
        body: await response.json() as { success: boolean; data?: unknown; message?: string },
    };
}

describe('enterprise control-plane router', () => {
    let app: ReturnType<typeof createEnterpriseRouter>;

    beforeEach(() => {
        app = createEnterpriseRouter(createMemoryControlPlane());
    });

    test('runs claims-scoped install, policy, budget, event and audit flow', async () => {
        const install = await hit(app, '/install', {
            method: 'POST',
            headers: bearer(),
            body: body({
                tenant_id: 'tenant_demo',
                org_id: 'org_demo',
                app_instance_id: 'agi_demo',
                database_url_secret_name: 'elygate/db/demo',
                supauth_issuer_url: 'https://auth.example.com',
                supauth_jwks_url: 'https://auth.example.com/.well-known/jwks.json',
                supauth_audience: 'http://localhost:3000',
                public_base_url: 'https://gw.example.com',
            }),
        });
        expect(install.status).toBe(200);
        expect((install.body.data as { instance: { app_instance_id: string } }).instance.app_instance_id).toBe('agi_demo');

        const updateInstance = await hit(app, '/gateway-instances/1', {
            method: 'PUT',
            headers: bearer(),
            body: body({ status: 'active', entitlements_version: 2 }),
        });
        expect(updateInstance.status).toBe(200);
        expect((updateInstance.body.data as { status: string; entitlements_version: number }).status).toBe('active');

        const instances = await hit(app, '/gateway-instances', { headers: bearer([AI_GATEWAY_SCOPES.gatewayRead]) });
        expect(instances.status).toBe(200);
        expect((instances.body.data as { total: number }).total).toBe(1);

        const policy = await hit(app, '/identity-policies', {
            method: 'POST',
            headers: bearer(),
            body: body({ name: 'Default policy', rules: { models: ['gpt-4.1'] } }),
        });
        expect(policy.status).toBe(200);
        expect((policy.body.data as { name: string }).name).toBe('Default policy');

        const identity = await hit(app, '/identity-and-policy', { headers: bearer([AI_GATEWAY_SCOPES.policyManage]) });
        expect(identity.status).toBe(200);
        expect((identity.body.data as { total: number }).total).toBe(1);

        const denyPolicy = await hit(app, '/identity-policies', {
            method: 'POST',
            headers: bearer(),
            body: body({
                name: 'Deny workspace',
                target_kind: 'external_workspace',
                target_id: 'workspace_blocked',
                effect: 'deny',
                rules: { models: ['gpt-4.1'], actions: ['request'] },
            }),
        });
        expect(denyPolicy.status).toBe(200);

        const evaluation = await hit(app, '/policy-evaluations', {
            method: 'POST',
            headers: bearer([AI_GATEWAY_SCOPES.policyManage]),
            body: body({
                action: 'request',
                model: 'gpt-4.1',
                external_workspace_id: 'workspace_blocked',
            }),
        });
        expect(evaluation.status).toBe(200);
        expect((evaluation.body.data as { decision: string; deny_policy_ids: number[] }).decision).toBe('deny');
        expect((evaluation.body.data as { deny_policy_ids: number[] }).deny_policy_ids).toContain(2);

        const missingPolicyScope = await hit(app, '/policy-evaluations', {
            method: 'POST',
            headers: bearer([AI_GATEWAY_SCOPES.gatewayRead]),
            body: body({ model: 'gpt-4.1' }),
        });
        expect(missingPolicyScope.status).toBe(403);
        expect(missingPolicyScope.body.message).toContain(AI_GATEWAY_SCOPES.policyManage);

        const budget = await hit(app, '/budgets', {
            method: 'POST',
            headers: bearer(),
            body: body({ subject_kind: 'org', limit_quota: 1000, used_quota: 100 }),
        });
        expect(budget.status).toBe(200);
        expect((budget.body.data as { usage_percent: number }).usage_percent).toBe(10);

        const budgetWarning = await hit(app, '/budget-evaluations', {
            method: 'POST',
            headers: bearer([AI_GATEWAY_SCOPES.policyManage]),
            body: body({ subject_kind: 'org', requested_quota: 750 }),
        });
        expect(budgetWarning.status).toBe(200);
        expect((budgetWarning.body.data as { decision: string; warning_budget_ids: number[] }).decision).toBe('warn');
        expect((budgetWarning.body.data as { warning_budget_ids: number[] }).warning_budget_ids).toContain(1);

        const budgetDenied = await hit(app, '/budget-evaluations', {
            method: 'POST',
            headers: bearer([AI_GATEWAY_SCOPES.policyManage]),
            body: body({ subject_kind: 'org', requested_quota: 950 }),
        });
        expect(budgetDenied.status).toBe(200);
        expect((budgetDenied.body.data as { decision: string; blocking_budget_ids: number[] }).decision).toBe('deny');
        expect((budgetDenied.body.data as { blocking_budget_ids: number[] }).blocking_budget_ids).toContain(1);

        const missingBudgetScope = await hit(app, '/budget-evaluations', {
            method: 'POST',
            headers: bearer([AI_GATEWAY_SCOPES.gatewayRead]),
            body: body({ requested_quota: 1 }),
        });
        expect(missingBudgetScope.status).toBe(403);
        expect(missingBudgetScope.body.message).toContain(AI_GATEWAY_SCOPES.policyManage);

        const usage = await hit(app, '/usage-and-budget', { headers: bearer([AI_GATEWAY_SCOPES.usageRead]) });
        expect(usage.status).toBe(200);
        expect((usage.body.data as { total: number }).total).toBe(1);
        expect((usage.body.data as { attribution: { dimensions: { models: Array<{ subject_id: string }> } } }).attribution.dimensions.models[0]?.subject_id).toBe('gpt-4.1');

        const entitlements = await hit(app, '/org-entitlements', {
            method: 'PUT',
            headers: bearer(),
            body: body({ seat_limit: 2, overage_enabled: true, budget_mode: 'overage', allowed_ip_policy: '203.0.113.7' }),
        });
        expect(entitlements.status).toBe(200);
        expect((entitlements.body.data as { seat_limit: number; budget_mode: string }).seat_limit).toBe(2);
        expect((entitlements.body.data as { budget_mode: string }).budget_mode).toBe('overage');

        const member = await hit(app, '/memberships', {
            method: 'POST',
            headers: bearer(),
            body: body({ email: 'dev@example.com', display_name: 'Dev User', role: 'developer' }),
        });
        expect(member.status).toBe(200);
        expect((member.body.data as { email: string }).email).toBe('dev@example.com');

        const members = await hit(app, '/members-and-access', { headers: bearer([AI_GATEWAY_SCOPES.policyManage]) });
        expect(members.status).toBe(200);
        expect((members.body.data as { memberships: { total: number } }).memberships.total).toBe(1);

        const seatLimit = await hit(app, '/org-entitlements', {
            method: 'PUT',
            headers: bearer(),
            body: body({ seat_limit: 1, overage_enabled: false }),
        });
        expect(seatLimit.status).toBe(200);

        const updateExistingMember = await hit(app, '/memberships/1', {
            method: 'PUT',
            headers: bearer(),
            body: body({ display_name: 'Updated Dev User' }),
        });
        expect(updateExistingMember.status).toBe(200);

        const suspendedMember = await hit(app, '/memberships', {
            method: 'POST',
            headers: bearer(),
            body: body({ email: 'suspended@example.com', seat_status: 'suspended' }),
        });
        expect(suspendedMember.status).toBe(200);

        const activateOverLimit = await hit(app, '/memberships/2', {
            method: 'PUT',
            headers: bearer(),
            body: body({ seat_status: 'active' }),
        });
        expect(activateOverLimit.status).toBe(402);

        const createOverLimit = await hit(app, '/memberships', {
            method: 'POST',
            headers: bearer(),
            body: body({ email: 'over-limit@example.com' }),
        });
        expect(createOverLimit.status).toBe(402);

        const efficiency = await hit(app, '/usage-efficiency', { headers: bearer([AI_GATEWAY_SCOPES.usageRead]) });
        expect(efficiency.status).toBe(200);
        expect((efficiency.body.data as { efficiency: { quota_per_request: number } }).efficiency.quota_per_request).toBe(42);

        const billing = await hit(app, '/billing-account', {
            method: 'POST',
            headers: bearer(),
            body: body({ billing_name: 'Demo Org', billing_email: 'billing@example.com', currency: 'USD' }),
        });
        expect(billing.status).toBe(200);
        expect((billing.body.data as { billing_name: string }).billing_name).toBe('Demo Org');

        const invoice = await hit(app, '/invoices', {
            method: 'POST',
            headers: bearer(),
            body: body({ items: [{ description: 'Seats', amount_cents: 1200 }] }),
        });
        expect(invoice.status).toBe(200);
        expect((invoice.body.data as { total_cents: number }).total_cents).toBe(1200);

        const provider = await hit(app, '/provider-compliance', {
            method: 'POST',
            headers: bearer(),
            body: body({ provider_id: 'openai-enterprise', display_name: 'OpenAI Enterprise', no_training: true, status: 'approved' }),
        });
        expect(provider.status).toBe(200);
        expect((provider.body.data as { no_training: boolean }).no_training).toBe(true);

        const governance = await hit(app, '/data-governance', { headers: bearer([AI_GATEWAY_SCOPES.policyManage]) });
        expect(governance.status).toBe(200);
        expect((governance.body.data as { enforcement: { allowed_providers: unknown[] } }).enforcement.allowed_providers).toHaveLength(1);

        const event = await hit(app, '/events', {
            method: 'POST',
            headers: bearer(),
            body: body({
                type: 'app.uninstalled',
                tenant_id: 'tenant_demo',
                org_id: 'org_demo',
                app_id: ELYGATE_ENTERPRISE_MANIFEST.app_id,
                app_instance_id: 'agi_demo',
            }),
        });
        expect(event.status).toBe(200);
        expect((event.body.data as { action: { kind: string } }).action.kind).toBe('disable-instance');

        const audit = await hit(app, '/audit-events', { headers: bearer([AI_GATEWAY_SCOPES.auditRead]) });
        expect(audit.status).toBe(200);
        expect((audit.body.data as { total: number }).total).toBeGreaterThanOrEqual(5);

        const filteredAudit = await hit(app, '/audit-events?action=budget.create&q=budget', { headers: bearer([AI_GATEWAY_SCOPES.auditRead]) });
        expect(filteredAudit.status).toBe(200);
        const filteredAuditBody = filteredAudit.body.data as { total: number; data: Array<{ action: string }> };
        expect(filteredAuditBody.total).toBe(1);
        expect(filteredAuditBody.data[0]?.action).toBe('budget.create');

        const auditExport = await hit(app, '/audit-events/export?action=budget.create', { headers: bearer([AI_GATEWAY_SCOPES.auditRead]) });
        expect(auditExport.status).toBe(200);
        const exportBody = auditExport.body.data as { filename: string; content_type: string; total: number; content: string };
        expect(exportBody.filename).toBe('elygate-audit-events-test.csv');
        expect(exportBody.content_type).toContain('text/csv');
        expect(exportBody.total).toBe(1);
        expect(exportBody.content).toContain('budget.create');
    });

    test('rejects data-plane keys and insufficient SupAuth scopes on enterprise routes', async () => {
        const withGatewayKey = await hit(app, '/audit-events', {
            headers: { authorization: 'Bearer sk-test' },
        });
        expect(withGatewayKey.status).toBe(401);
        expect(withGatewayKey.body.message).toContain('data-plane');

        const withReadOnlyScope = await hit(app, '/audit-events', {
            headers: bearer([AI_GATEWAY_SCOPES.gatewayRead]),
        });
        expect(withReadOnlyScope.status).toBe(403);
        expect(withReadOnlyScope.body.message).toContain(AI_GATEWAY_SCOPES.auditRead);

        const exportWithReadOnlyScope = await hit(app, '/audit-events/export', {
            headers: bearer([AI_GATEWAY_SCOPES.gatewayRead]),
        });
        expect(exportWithReadOnlyScope.status).toBe(403);
        expect(exportWithReadOnlyScope.body.message).toContain(AI_GATEWAY_SCOPES.auditRead);
    });

    test('serves scoped gateway resource governance views with dedicated SupAuth scopes', async () => {
        const channels = await hit(app, '/provider-channels', { headers: bearer([AI_GATEWAY_SCOPES.channelManage]) });
        expect(channels.status).toBe(200);
        expect((channels.body.data as { total: number }).total).toBe(1);
        expect((channels.body.data as { data: Array<{ credential_mask: string }> }).data[0]?.credential_mask).toContain('...');

        const modelRoutes = await hit(app, '/model-routes', { headers: bearer([AI_GATEWAY_SCOPES.gatewayRead]) });
        expect(modelRoutes.status).toBe(200);
        expect((modelRoutes.body.data as { data: Array<{ model_name: string }> }).data[0]?.model_name).toBe('gpt-4.1');

        const apiKeys = await hit(app, '/gateway-api-keys', { headers: bearer([AI_GATEWAY_SCOPES.keyManage]) });
        expect(apiKeys.status).toBe(200);
        expect((apiKeys.body.data as { data: Array<{ key_mask: string }> }).data[0]?.key_mask).toContain('...');

        const requestLogs = await hit(app, '/request-logs', { headers: bearer([AI_GATEWAY_SCOPES.usageRead]) });
        expect(requestLogs.status).toBe(200);
        expect((requestLogs.body.data as { data: Array<{ trace_id: string }> }).data[0]?.trace_id).toBe('trace_demo');

        const attribution = await hit(app, '/usage-attribution?days=7&limit=5', { headers: bearer([AI_GATEWAY_SCOPES.usageRead]) });
        expect(attribution.status).toBe(200);
        expect((attribution.body.data as { scope: { scope_kind: string } }).scope.scope_kind).toBe('gateway_instance');
        expect((attribution.body.data as { dimensions: { external_workspaces: Array<{ subject_id: string }> } }).dimensions.external_workspaces[0]?.subject_id).toBe('workspace_demo');

        const memories = await hit(app, '/agent-memories', { headers: bearer([AI_GATEWAY_SCOPES.memoryManage]) });
        expect(memories.status).toBe(200);
        expect((memories.body.data as { scope: { scope_kind: string } }).scope.scope_kind).toBe('gateway_instance');

        const missingScope = await hit(app, '/provider-channels', { headers: bearer([AI_GATEWAY_SCOPES.gatewayRead]) });
        expect(missingScope.status).toBe(403);
        expect(missingScope.body.message).toContain(AI_GATEWAY_SCOPES.channelManage);

        const missingUsageScope = await hit(app, '/usage-attribution', { headers: bearer([AI_GATEWAY_SCOPES.gatewayRead]) });
        expect(missingUsageScope.status).toBe(403);
        expect(missingUsageScope.body.message).toContain(AI_GATEWAY_SCOPES.usageRead);
    });

    test('handles dedicated SupaCloud uninstall callback idempotently', async () => {
        const install = await hit(app, '/install', {
            method: 'POST',
            headers: bearer(),
            body: body({
                tenant_id: 'tenant_demo',
                org_id: 'org_demo',
                app_instance_id: 'agi_demo',
                database_url_secret_name: 'elygate/db/demo',
                supauth_issuer_url: 'https://auth.example.com',
                supauth_jwks_url: 'https://auth.example.com/.well-known/jwks.json',
                supauth_audience: 'http://localhost:3000',
            }),
        });
        expect(install.status).toBe(200);

        const uninstall = await hit(app, '/uninstall', {
            method: 'POST',
            headers: bearer(),
            body: body({
                tenant_id: 'tenant_demo',
                org_id: 'org_demo',
                app_id: ELYGATE_ENTERPRISE_MANIFEST.app_id,
                app_instance_id: 'agi_demo',
                reason: 'test cleanup',
            }),
        });
        expect(uninstall.status).toBe(200);
        expect((uninstall.body.data as { action: { kind: string }; status: string }).action.kind).toBe('disable-instance');
        expect((uninstall.body.data as { status: string }).status).toBe('deleted');

        const instances = await hit(app, '/gateway-instances', { headers: bearer([AI_GATEWAY_SCOPES.gatewayRead]) });
        expect((instances.body.data as { data: Array<{ status: string }> }).data[0]?.status).toBe('deleted');

        const secondUninstall = await hit(app, '/uninstall', {
            method: 'POST',
            headers: bearer(),
            body: body({
                tenant_id: 'tenant_demo',
                org_id: 'org_demo',
                app_id: ELYGATE_ENTERPRISE_MANIFEST.app_id,
                app_instance_id: 'agi_demo',
            }),
        });
        expect(secondUninstall.status).toBe(200);
    });

    test('rejects SupaCloud install callbacks outside the SupAuth tenant scope', async () => {
        const result = await hit(app, '/install', {
            method: 'POST',
            headers: bearer(),
            body: body({
                tenant_id: 'tenant_other',
                org_id: 'org_demo',
                app_instance_id: 'agi_demo',
                database_url_secret_name: 'elygate/db/demo',
                supauth_issuer_url: 'https://auth.example.com',
                supauth_jwks_url: 'https://auth.example.com/.well-known/jwks.json',
                supauth_audience: 'http://localhost:3000',
            }),
        });
        expect(result.status).toBe(403);
        expect(result.body.message).toContain('scope');
    });

    test('rejects lifecycle callbacks for another app or app instance', async () => {
        const installOtherInstance = await hit(app, '/install', {
            method: 'POST',
            headers: bearer(),
            body: body({
                tenant_id: 'tenant_demo',
                org_id: 'org_demo',
                app_instance_id: 'agi_other',
                database_url_secret_name: 'elygate/db/demo',
                supauth_issuer_url: 'https://auth.example.com',
                supauth_jwks_url: 'https://auth.example.com/.well-known/jwks.json',
                supauth_audience: 'http://localhost:3000',
            }),
        });
        expect(installOtherInstance.status).toBe(403);
        expect(installOtherInstance.body.message).toContain('app instance');

        const uninstallOtherApp = await hit(app, '/uninstall', {
            method: 'POST',
            headers: bearer(),
            body: body({
                tenant_id: 'tenant_demo',
                org_id: 'org_demo',
                app_id: 'other-app',
                app_instance_id: 'agi_demo',
            }),
        });
        expect(uninstallOtherApp.status).toBe(403);
        expect(uninstallOtherApp.body.message).toContain('Elygate Enterprise');
    });
});
