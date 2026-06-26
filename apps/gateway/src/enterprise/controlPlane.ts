import { AI_GATEWAY_SCOPES, ELYGATE_ENTERPRISE_MANIFEST } from '@elygate/enterprise-contracts';
import type { ElygateGatewayInstance, EnterpriseBudgetEvaluationInput, EnterpriseListQuery, EnterprisePolicyEvaluationInput, PlatformClaims, PlatformEvent } from '@elygate/enterprise-contracts';
import { db } from '@elygate/db';
import {
    channels,
    enterpriseAuditEvents,
    enterpriseBillingAccounts,
    enterpriseBudgets,
    enterpriseGatewayInstances,
    enterpriseIdentityPolicies,
    enterpriseInvoiceItems,
    enterpriseInvoices,
    enterpriseMemberships,
    enterpriseMeteredUsage,
    enterpriseOrgEntitlements,
    enterpriseProviderCompliance,
    logs,
    organizations,
    tokens,
    users,
} from '@elygate/db/schema';
import {
    createInstallResponse,
    eventToProjectionAction,
    normalizeInstallRequest,
    normalizeUninstallRequest,
    toAppUninstalledEvent,
    toGatewayInstance,
} from '@elygate/enterprise-adapter';
import type { ProjectionAction } from '@elygate/enterprise-adapter';
import { evaluateEnterpriseBudgets, evaluateEnterprisePolicies } from '@elygate/enterprise-authz';
import type { EnterpriseBudgetRecord, EnterprisePolicyRecord } from '@elygate/enterprise-authz';
import { and, count, desc, eq, gte, isNotNull, lte, ne, sql as drizzleSql, sum } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { nextEnterpriseBudgetResetAt, rolloverDueEnterpriseBudgets } from './budgetRollover';
import { enterpriseRuntimeConfig } from './config';
import {
    listAgentMemories,
    listGatewayApiKeys,
    listModelRoutes,
    listProviderChannels,
    listRequestLogs,
} from './resourceViews';

export type EnterpriseRequestMeta = {
    readonly ipAddress?: string;
    readonly userAgent?: string;
};

export type ListQuery = EnterpriseListQuery;

export type JsonObject = Record<string, unknown>;

export type EnterpriseControlPlane = {
    readonly getEnterpriseOverview: (claims: PlatformClaims) => Promise<unknown>;
    readonly listGatewayInstances: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly installEnterpriseGateway: (body: unknown, claims: PlatformClaims, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly uninstallEnterpriseGateway: (body: unknown, claims: PlatformClaims, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly updateGatewayInstance: (claims: PlatformClaims, idOrInstance: string, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly getIdentityAndPolicy: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly listIdentityPolicies: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly createIdentityPolicy: (claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly updateIdentityPolicy: (claims: PlatformClaims, id: string, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly evaluateEnterprisePolicy: (claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly getUsageAndBudget: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly listUsageAttribution: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly listBudgets: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly createBudget: (claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly updateBudget: (claims: PlatformClaims, id: string, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly evaluateEnterpriseBudget: (claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly getMembersAndAccess: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly listMemberships: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly upsertMembership: (claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly updateMembership: (claims: PlatformClaims, id: string, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly getOrgEntitlements: (claims: PlatformClaims) => Promise<unknown>;
    readonly updateOrgEntitlements: (claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly getUsageEfficiency: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly getBillingAndInvoices: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly listInvoices: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly upsertBillingAccount: (claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly createInvoice: (claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly getDataGovernance: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly upsertProviderCompliance: (claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) => Promise<unknown>;
    readonly listAuditEvents: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly exportAuditEvents: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly listProviderChannels: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly listModelRoutes: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly listGatewayApiKeys: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly listRequestLogs: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly listAgentMemories: (claims: PlatformClaims, query?: ListQuery) => Promise<unknown>;
    readonly applyPlatformEvent: (event: PlatformEvent, claims: PlatformClaims, meta: EnterpriseRequestMeta) => Promise<ProjectionAction>;
};

function isRecord(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: JsonObject, key: string): string | null {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalString(record: JsonObject, key: string): string | null {
    return readString(record, key);
}

function readNumber(record: JsonObject, key: string, fallback: number): number {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return fallback;
}

function readJsonObject(record: JsonObject, key: string): JsonObject {
    const value = record[key];
    if (isRecord(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return isRecord(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function readUnknownStringArray(value: unknown): readonly string[] {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string' && value.trim()) return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
    return [];
}

function readDate(record: JsonObject, key: string): Date | null {
    const value = record[key];
    if (!value) return null;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
}

function actorId(claims: PlatformClaims): string {
    return claims.user_id ?? claims.service_account_id ?? claims.subject ?? 'enterprise-actor';
}

function actorType(claims: PlatformClaims): 'user' | 'service_account' {
    return claims.service_account_id ? 'service_account' : 'user';
}

function parsePagination(query?: ListQuery): { page: number; limit: number; offset: number } {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query?.limit) || 30));
    return { page, limit, offset: (page - 1) * limit };
}

function parseWindowDays(query?: ListQuery): number {
    const raw = isRecord(query ?? {}) ? Number((query as JsonObject).days) : NaN;
    if (!Number.isFinite(raw)) return 7;
    return Math.min(90, Math.max(1, Math.trunc(raw)));
}

function gatewayInstanceScope(claims: PlatformClaims) {
    return {
        scope_kind: 'gateway_instance' as const,
        tenant_id: claims.tenant_id,
        org_id: claims.org_id,
        app_instance_id: claims.app_instance_id,
        project_id: claims.project_id ?? enterpriseRuntimeConfig.projectId ?? null,
    };
}

function paginated<T>(claims: PlatformClaims, data: readonly T[], total: number, query?: ListQuery) {
    const { page, limit } = parsePagination(query);
    return {
        data,
        total,
        page,
        limit,
        scope: gatewayInstanceScope(claims),
    };
}

function maskCredential(value: string | null | undefined): string {
    if (!value) return '';
    if (value.length <= 12) return `${value.slice(0, 3)}...`;
    return `${value.slice(0, 7)}...${value.slice(-4)}`;
}

function stringArray(value: readonly string[] | null | undefined): readonly string[] {
    return Array.isArray(value) ? value : [];
}

function dateIso(value: Date | null | undefined): string | undefined {
    return value?.toISOString();
}

function dateValueIso(value: unknown): string | undefined {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
    }
    return undefined;
}

function numberValue(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

function contentPreview(value: string, maxLength = 180): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function assertInstallScope(claims: PlatformClaims, request: { tenant_id: string; org_id: string; app_instance_id: string }): void {
    if (claims.tenant_id !== request.tenant_id || claims.org_id !== request.org_id) {
        throw Object.assign(new Error('Install request scope does not match SupAuth claims'), { statusCode: 403 });
    }
    if (claims.app_instance_id !== request.app_instance_id) {
        throw Object.assign(new Error('Install request app instance does not match SupAuth claims'), { statusCode: 403 });
    }
    if (claims.app_id !== ELYGATE_ENTERPRISE_MANIFEST.app_id) {
        throw Object.assign(new Error('SupAuth claims are not issued for Elygate Enterprise'), { statusCode: 403 });
    }
}

function assertEnterpriseAppEvent(event: PlatformEvent): void {
    if ('app_id' in event && event.app_id !== ELYGATE_ENTERPRISE_MANIFEST.app_id) {
        throw Object.assign(new Error('Platform event is not for Elygate Enterprise'), { statusCode: 403 });
    }
}

function toInstanceRow(instance: ElygateGatewayInstance): typeof enterpriseGatewayInstances.$inferInsert {
    return {
        tenantId: instance.tenant_id,
        orgId: instance.org_id,
        appId: instance.app_id,
        appInstanceId: instance.app_instance_id,
        projectId: instance.project_id ?? null,
        status: instance.status,
        publicBaseUrl: instance.public_base_url ?? null,
        adminBaseUrl: instance.admin_base_url ?? null,
        databaseUrlSecretName: instance.database_url_secret_name ?? null,
        supauthIssuerUrl: instance.supauth_issuer_url,
        supauthJwksUrl: instance.supauth_jwks_url,
        supauthAudience: instance.supauth_audience,
        entitlementsVersion: instance.entitlements_version,
        metadata: {},
        createdAt: instance.created_at ? new Date(instance.created_at) : new Date(),
        updatedAt: new Date(),
    };
}

function mapInstance(row: typeof enterpriseGatewayInstances.$inferSelect): ElygateGatewayInstance & { readonly id: number; readonly metadata: JsonObject } {
    return {
        id: row.id,
        tenant_id: row.tenantId,
        org_id: row.orgId,
        app_id: row.appId,
        app_instance_id: row.appInstanceId,
        project_id: row.projectId ?? undefined,
        status: row.status as ElygateGatewayInstance['status'],
        public_base_url: row.publicBaseUrl ?? undefined,
        admin_base_url: row.adminBaseUrl ?? undefined,
        database_url_secret_name: row.databaseUrlSecretName ?? undefined,
        supauth_issuer_url: row.supauthIssuerUrl ?? '',
        supauth_jwks_url: row.supauthJwksUrl ?? '',
        supauth_audience: row.supauthAudience ?? '',
        entitlements_version: row.entitlementsVersion,
        metadata: row.metadata ?? {},
        created_at: row.createdAt?.toISOString(),
        updated_at: row.updatedAt?.toISOString(),
    };
}

function fallbackInstanceFromClaims(claims: PlatformClaims): ElygateGatewayInstance & { readonly id: string; readonly metadata: JsonObject } {
    return {
        id: 'claims-current',
        tenant_id: claims.tenant_id,
        org_id: claims.org_id,
        app_id: claims.app_id,
        app_instance_id: claims.app_instance_id,
        project_id: claims.project_id,
        status: enterpriseRuntimeConfig.enabled ? 'active' : 'provisioning',
        public_base_url: enterpriseRuntimeConfig.publicBaseUrl || undefined,
        admin_base_url: enterpriseRuntimeConfig.adminBaseUrl || undefined,
        database_url_secret_name: undefined,
        supauth_issuer_url: enterpriseRuntimeConfig.supauthIssuerUrl,
        supauth_jwks_url: enterpriseRuntimeConfig.supauthJwksUrl,
        supauth_audience: enterpriseRuntimeConfig.supauthAudience,
        entitlements_version: claims.entitlements_version,
        metadata: { source: 'supauth_claims' },
    };
}

function mapPolicy(row: typeof enterpriseIdentityPolicies.$inferSelect) {
    return {
        id: row.id,
        tenant_id: row.tenantId,
        org_id: row.orgId,
        app_instance_id: row.appInstanceId,
        name: row.name,
        target_kind: row.targetKind,
        target_id: row.targetId,
        effect: row.effect,
        rules: row.rules,
        status: row.status,
        created_by: row.createdBy,
        updated_by: row.updatedBy,
        created_at: row.createdAt?.toISOString(),
        updated_at: row.updatedAt?.toISOString(),
    };
}

function mapBudget(row: typeof enterpriseBudgets.$inferSelect) {
    const limit = Number(row.limitQuota || 0);
    const used = Number(row.usedQuota || 0);
    return {
        id: row.id,
        tenant_id: row.tenantId,
        org_id: row.orgId,
        app_instance_id: row.appInstanceId,
        subject_kind: row.subjectKind,
        subject_id: row.subjectId,
        period: row.period,
        limit_quota: limit,
        used_quota: used,
        usage_percent: limit > 0 ? Math.round((used / limit) * 10000) / 100 : 0,
        alert_threshold_pct: row.alertThresholdPct,
        reset_at: row.resetAt?.toISOString(),
        status: row.status,
        metadata: row.metadata,
        created_by: row.createdBy,
        updated_by: row.updatedBy,
        created_at: row.createdAt?.toISOString(),
        updated_at: row.updatedAt?.toISOString(),
    };
}

function mapAuditEvent(row: typeof enterpriseAuditEvents.$inferSelect) {
    return {
        id: row.id,
        tenant_id: row.tenantId,
        org_id: row.orgId,
        app_instance_id: row.appInstanceId,
        actor_type: row.actorType,
        actor_id: row.actorId,
        action: row.action,
        resource: row.resource,
        resource_id: row.resourceId,
        details: row.details,
        ip_address: row.ipAddress,
        user_agent: row.userAgent,
        created_at: row.createdAt?.toISOString(),
    };
}

function mapEntitlements(row: typeof enterpriseOrgEntitlements.$inferSelect) {
    return {
        id: row.id,
        tenant_id: row.tenantId,
        org_id: row.orgId,
        app_instance_id: row.appInstanceId,
        seat_limit: row.seatLimit,
        assigned_seats: row.assignedSeats,
        available_seats: Math.max(0, row.seatLimit - row.assignedSeats),
        billing_mode: row.billingMode,
        overage_enabled: row.overageEnabled,
        overage_unit_price_cents: row.overageUnitPriceCents,
        budget_mode: row.budgetMode,
        default_no_training: row.defaultNoTraining,
        data_retention_days: row.dataRetentionDays,
        provider_compliance_mode: row.providerComplianceMode,
        allowed_ip_policy: row.allowedIpPolicy,
        status: row.status,
        metadata: row.metadata,
        created_by: row.createdBy,
        updated_by: row.updatedBy,
        created_at: row.createdAt?.toISOString(),
        updated_at: row.updatedAt?.toISOString(),
    };
}

function mapMembership(row: typeof enterpriseMemberships.$inferSelect) {
    return {
        id: row.id,
        tenant_id: row.tenantId,
        org_id: row.orgId,
        app_instance_id: row.appInstanceId,
        user_id: row.userId,
        email: row.email,
        display_name: row.displayName,
        role: row.role,
        scopes: stringArray(row.scopes),
        seat_kind: row.seatKind,
        seat_status: row.seatStatus,
        invited_by: row.invitedBy,
        joined_at: row.joinedAt?.toISOString(),
        last_active_at: row.lastActiveAt?.toISOString(),
        metadata: row.metadata,
        created_at: row.createdAt?.toISOString(),
        updated_at: row.updatedAt?.toISOString(),
    };
}

function mapBillingAccount(row: typeof enterpriseBillingAccounts.$inferSelect) {
    return {
        id: row.id,
        tenant_id: row.tenantId,
        org_id: row.orgId,
        app_instance_id: row.appInstanceId,
        billing_name: row.billingName,
        billing_email: row.billingEmail,
        tax_id: row.taxId,
        currency: row.currency,
        payment_terms: row.paymentTerms,
        status: row.status,
        metadata: row.metadata,
        created_by: row.createdBy,
        updated_by: row.updatedBy,
        created_at: row.createdAt?.toISOString(),
        updated_at: row.updatedAt?.toISOString(),
    };
}

function mapInvoice(row: typeof enterpriseInvoices.$inferSelect, items: readonly ReturnType<typeof mapInvoiceItem>[] = []) {
    return {
        id: row.id,
        tenant_id: row.tenantId,
        org_id: row.orgId,
        app_instance_id: row.appInstanceId,
        billing_account_id: row.billingAccountId,
        invoice_number: row.invoiceNumber,
        period_start: row.periodStart.toISOString(),
        period_end: row.periodEnd.toISOString(),
        currency: row.currency,
        subtotal_cents: Number(row.subtotalCents || 0),
        tax_cents: Number(row.taxCents || 0),
        total_cents: Number(row.totalCents || 0),
        status: row.status,
        due_at: row.dueAt?.toISOString(),
        issued_at: row.issuedAt?.toISOString(),
        paid_at: row.paidAt?.toISOString(),
        metadata: row.metadata,
        items,
        created_at: row.createdAt?.toISOString(),
        updated_at: row.updatedAt?.toISOString(),
    };
}

function mapInvoiceItem(row: typeof enterpriseInvoiceItems.$inferSelect) {
    return {
        id: row.id,
        invoice_id: row.invoiceId,
        item_type: row.itemType,
        description: row.description,
        quantity: String(row.quantity),
        unit_amount_cents: Number(row.unitAmountCents || 0),
        amount_cents: Number(row.amountCents || 0),
        source_type: row.sourceType,
        source_id: row.sourceId,
        metadata: row.metadata,
        created_at: row.createdAt?.toISOString(),
    };
}

function mapMeteredUsage(row: typeof enterpriseMeteredUsage.$inferSelect) {
    return {
        id: row.id,
        tenant_id: row.tenantId,
        org_id: row.orgId,
        app_instance_id: row.appInstanceId,
        subject_kind: row.subjectKind,
        subject_id: row.subjectId,
        metric: row.metric,
        quantity: Number(row.quantity || 0),
        unit_amount_cents: row.unitAmountCents,
        amount_cents: Number(row.amountCents || 0),
        source_log_id: row.sourceLogId,
        invoice_id: row.invoiceId,
        occurred_at: row.occurredAt?.toISOString(),
        metadata: row.metadata,
        created_at: row.createdAt?.toISOString(),
    };
}

function mapProviderCompliance(row: typeof enterpriseProviderCompliance.$inferSelect) {
    return {
        id: row.id,
        tenant_id: row.tenantId,
        org_id: row.orgId,
        app_instance_id: row.appInstanceId,
        provider_kind: row.providerKind,
        provider_id: row.providerId,
        display_name: row.displayName,
        no_training: row.noTraining,
        zero_retention: row.zeroRetention,
        region: row.region,
        status: row.status,
        evidence_url: row.evidenceUrl,
        reviewed_by: row.reviewedBy,
        reviewed_at: row.reviewedAt?.toISOString(),
        metadata: row.metadata,
        created_at: row.createdAt?.toISOString(),
        updated_at: row.updatedAt?.toISOString(),
    };
}

function queryRecord(query?: ListQuery): JsonObject {
    const normalized = query ?? {};
    return isRecord(normalized) ? normalized : {};
}

function queryString(query: JsonObject, key: string): string | null {
    const value = query[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function queryDate(query: JsonObject, keys: readonly string[]): Date | null {
    for (const key of keys) {
        const value = queryString(query, key);
        if (!value) continue;
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
}

function auditEventWhere(claims: PlatformClaims, query?: ListQuery): SQL {
    const record = queryRecord(query);
    const filters: SQL[] = [
        eq(enterpriseAuditEvents.tenantId, claims.tenant_id),
        eq(enterpriseAuditEvents.orgId, claims.org_id),
    ];

    const appInstanceId = queryString(record, 'app_instance_id');
    if (appInstanceId) filters.push(eq(enterpriseAuditEvents.appInstanceId, appInstanceId));

    const actorType = queryString(record, 'actor_type');
    if (actorType) filters.push(eq(enterpriseAuditEvents.actorType, actorType));

    const actorId = queryString(record, 'actor_id');
    if (actorId) filters.push(eq(enterpriseAuditEvents.actorId, actorId));

    const action = queryString(record, 'action');
    if (action) filters.push(eq(enterpriseAuditEvents.action, action));

    const resource = queryString(record, 'resource');
    if (resource) filters.push(eq(enterpriseAuditEvents.resource, resource));

    const resourceId = queryString(record, 'resource_id');
    if (resourceId) filters.push(eq(enterpriseAuditEvents.resourceId, resourceId));

    const from = queryDate(record, ['from', 'created_from', 'since']);
    if (from) filters.push(gte(enterpriseAuditEvents.createdAt, from));

    const to = queryDate(record, ['to', 'created_to', 'until']);
    if (to) filters.push(lte(enterpriseAuditEvents.createdAt, to));

    const search = queryString(record, 'q');
    if (search) {
        const pattern = `%${search}%`;
        filters.push(drizzleSql`(
            ${enterpriseAuditEvents.action} ILIKE ${pattern}
            OR ${enterpriseAuditEvents.resource} ILIKE ${pattern}
            OR ${enterpriseAuditEvents.resourceId} ILIKE ${pattern}
            OR ${enterpriseAuditEvents.actorId} ILIKE ${pattern}
            OR ${enterpriseAuditEvents.details}::text ILIKE ${pattern}
        )`);
    }

    return and(...filters) ?? drizzleSql`true`;
}

function auditExportLimit(query?: ListQuery): number {
    const record = queryRecord(query);
    return Math.min(10000, Math.max(1, Number(queryString(record, 'export_limit') ?? queryString(record, 'limit') ?? 2000) || 2000));
}

function csvCell(value: unknown): string {
    const text = typeof value === 'object' && value !== null
        ? JSON.stringify(value)
        : value === undefined || value === null
            ? ''
            : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function auditEventsCsv(rows: readonly ReturnType<typeof mapAuditEvent>[]): string {
    const header = ['id', 'created_at', 'tenant_id', 'org_id', 'app_instance_id', 'actor_type', 'actor_id', 'action', 'resource', 'resource_id', 'details'];
    const lines = rows.map((row) => [
        row.id,
        row.created_at ?? '',
        row.tenant_id,
        row.org_id,
        row.app_instance_id,
        row.actor_type,
        row.actor_id ?? '',
        row.action,
        row.resource,
        row.resource_id ?? '',
        row.details,
    ].map(csvCell).join(','));
    return [header.join(','), ...lines].join('\n');
}

function normalizePolicyEvaluationInput(body: unknown, claims: PlatformClaims): EnterprisePolicyEvaluationInput {
    if (!isRecord(body)) throw new Error('Policy evaluation body must be an object');
    const metadata = isRecord(body.metadata) ? body.metadata : undefined;
    return {
        action: readOptionalString(body, 'action') ?? 'request',
        resource: readOptionalString(body, 'resource') ?? 'ai.gateway.request',
        model: readOptionalString(body, 'model') ?? undefined,
        channel_id: readOptionalString(body, 'channel_id') ?? undefined,
        api_key_id: readOptionalString(body, 'api_key_id') ?? readOptionalString(body, 'token_id') ?? undefined,
        user_id: readOptionalString(body, 'user_id') ?? claims.user_id,
        service_account_id: readOptionalString(body, 'service_account_id') ?? claims.service_account_id,
        project_id: readOptionalString(body, 'project_id') ?? claims.project_id,
        external_user_id: readOptionalString(body, 'external_user_id') ?? undefined,
        external_workspace_id: readOptionalString(body, 'external_workspace_id') ?? undefined,
        external_feature_type: readOptionalString(body, 'external_feature_type') ?? undefined,
        roles: readUnknownStringArray(body.roles).length ? readUnknownStringArray(body.roles) : claims.roles,
        scopes: readUnknownStringArray(body.scopes).length ? readUnknownStringArray(body.scopes) : claims.scopes,
        metadata,
    };
}

function normalizeBudgetEvaluationInput(body: unknown, claims: PlatformClaims): EnterpriseBudgetEvaluationInput {
    if (!isRecord(body)) throw new Error('Budget evaluation body must be an object');
    const metadata = isRecord(body.metadata) ? body.metadata : undefined;
    return {
        subject_kind: readOptionalString(body, 'subject_kind') ?? undefined,
        subject_id: readOptionalString(body, 'subject_id') ?? undefined,
        action: readOptionalString(body, 'action') ?? 'request',
        model: readOptionalString(body, 'model') ?? undefined,
        requested_quota: readNumber(body, 'requested_quota', readNumber(body, 'quota_cost', 0)),
        current_quota_cost: 'current_quota_cost' in body ? readNumber(body, 'current_quota_cost', 0) : undefined,
        projected_quota_cost: 'projected_quota_cost' in body ? readNumber(body, 'projected_quota_cost', 0) : undefined,
        user_id: readOptionalString(body, 'user_id') ?? claims.user_id,
        service_account_id: readOptionalString(body, 'service_account_id') ?? claims.service_account_id,
        project_id: readOptionalString(body, 'project_id') ?? claims.project_id,
        api_key_id: readOptionalString(body, 'api_key_id') ?? readOptionalString(body, 'token_id') ?? undefined,
        channel_id: readOptionalString(body, 'channel_id') ?? undefined,
        external_user_id: readOptionalString(body, 'external_user_id') ?? undefined,
        external_workspace_id: readOptionalString(body, 'external_workspace_id') ?? undefined,
        external_feature_type: readOptionalString(body, 'external_feature_type') ?? undefined,
        metadata,
    };
}

function toPolicyRecord(row: typeof enterpriseIdentityPolicies.$inferSelect): EnterprisePolicyRecord {
    return {
        id: row.id,
        name: row.name,
        target_kind: row.targetKind,
        target_id: row.targetId,
        effect: row.effect,
        rules: row.rules,
        status: row.status,
    };
}

function toBudgetRecord(row: typeof enterpriseBudgets.$inferSelect): EnterpriseBudgetRecord {
    return {
        id: row.id,
        subject_kind: row.subjectKind,
        subject_id: row.subjectId,
        period: row.period,
        limit_quota: Number(row.limitQuota || 0),
        used_quota: Number(row.usedQuota || 0),
        alert_threshold_pct: row.alertThresholdPct,
        status: row.status,
        reset_at: row.resetAt?.toISOString() ?? null,
    };
}

type UsageAttributionDimension =
    | 'model'
    | 'user'
    | 'api_key'
    | 'channel'
    | 'external_user'
    | 'external_workspace'
    | 'external_feature';

type UsageAttributionMetricRow = {
    readonly subjectId: string | number | null;
    readonly subjectLabel?: string | null;
    readonly subjectSecondary?: string | number | null;
    readonly credentialMask?: string | null;
    readonly requests: unknown;
    readonly quotaCost: unknown;
    readonly promptTokens: unknown;
    readonly completionTokens: unknown;
    readonly cachedTokens: unknown;
    readonly errorCount: unknown;
    readonly avgElapsedMs: unknown;
    readonly lastSeenAt: unknown;
};

const usageMetricSelection = {
    requests: drizzleSql<number>`count(*)::int`,
    quotaCost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
    promptTokens: drizzleSql<string>`coalesce(sum(${logs.promptTokens}), 0)::bigint`,
    completionTokens: drizzleSql<string>`coalesce(sum(${logs.completionTokens}), 0)::bigint`,
    cachedTokens: drizzleSql<string>`coalesce(sum(${logs.cachedTokens}), 0)::bigint`,
    errorCount: drizzleSql<number>`count(case when ${logs.statusCode} >= 400 then 1 end)::int`,
    avgElapsedMs: drizzleSql<number>`round(coalesce(avg(case when ${logs.elapsedMs} > 0 then ${logs.elapsedMs} else null end), 0))::int`,
    lastSeenAt: drizzleSql<Date | null>`max(${logs.createdAt})`,
} as const;

const usageCostOrder = desc(drizzleSql`coalesce(sum(${logs.quotaCost}), 0)`);

function numericOrgId(claims: PlatformClaims): number | null {
    const orgId = Number(claims.org_id);
    return Number.isInteger(orgId) && orgId > 0 ? orgId : null;
}

function usageWindowWhere(claims: PlatformClaims, since: Date): SQL {
    const orgId = numericOrgId(claims);
    if (!orgId) return drizzleSql`false`;
    return and(eq(logs.orgId, orgId), gte(logs.createdAt, since)) ?? drizzleSql`false`;
}

function mapUsageAttribution(row: UsageAttributionMetricRow, dimension: UsageAttributionDimension, fallbackLabel: string) {
    const subjectId = row.subjectId === null || row.subjectId === undefined || row.subjectId === '' ? 'unknown' : String(row.subjectId);
    const label = row.subjectLabel?.trim() || fallbackLabel;
    return {
        dimension,
        subject_id: subjectId,
        subject_label: label,
        subject_secondary: row.subjectSecondary === null || row.subjectSecondary === undefined ? null : String(row.subjectSecondary),
        credential_mask: row.credentialMask ?? null,
        requests: numberValue(row.requests),
        quota_cost: numberValue(row.quotaCost),
        prompt_tokens: numberValue(row.promptTokens),
        completion_tokens: numberValue(row.completionTokens),
        cached_tokens: numberValue(row.cachedTokens),
        error_count: numberValue(row.errorCount),
        avg_elapsed_ms: numberValue(row.avgElapsedMs),
        last_seen_at: dateValueIso(row.lastSeenAt),
    };
}

export function requestMetaFromHeaders(headers: Headers): EnterpriseRequestMeta {
    const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const realIp = headers.get('x-real-ip')?.trim();
    return {
        ipAddress: forwarded || realIp || undefined,
        userAgent: headers.get('user-agent') || undefined,
    };
}

export async function recordEnterpriseAuditEvent(
    claims: PlatformClaims,
    action: string,
    resource: string,
    resourceId: string | null,
    details: JsonObject = {},
    meta: EnterpriseRequestMeta = {},
): Promise<void> {
    await db.insert(enterpriseAuditEvents).values({
        tenantId: claims.tenant_id,
        orgId: claims.org_id,
        appInstanceId: claims.app_instance_id,
        actorType: actorType(claims),
        actorId: actorId(claims),
        action,
        resource,
        resourceId,
        details,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
    });
}

function orgScopeWhere(claims: PlatformClaims) {
    return and(
        eq(enterpriseOrgEntitlements.tenantId, claims.tenant_id),
        eq(enterpriseOrgEntitlements.orgId, claims.org_id),
        eq(enterpriseOrgEntitlements.appInstanceId, claims.app_instance_id),
    );
}

function membershipScopeWhere(claims: PlatformClaims) {
    return and(
        eq(enterpriseMemberships.tenantId, claims.tenant_id),
        eq(enterpriseMemberships.orgId, claims.org_id),
        eq(enterpriseMemberships.appInstanceId, claims.app_instance_id),
    );
}

function billingScopeWhere(claims: PlatformClaims) {
    return and(
        eq(enterpriseBillingAccounts.tenantId, claims.tenant_id),
        eq(enterpriseBillingAccounts.orgId, claims.org_id),
        eq(enterpriseBillingAccounts.appInstanceId, claims.app_instance_id),
    );
}

function invoicesScopeWhere(claims: PlatformClaims) {
    return and(
        eq(enterpriseInvoices.tenantId, claims.tenant_id),
        eq(enterpriseInvoices.orgId, claims.org_id),
        eq(enterpriseInvoices.appInstanceId, claims.app_instance_id),
    );
}

function providerComplianceScopeWhere(claims: PlatformClaims) {
    return and(
        eq(enterpriseProviderCompliance.tenantId, claims.tenant_id),
        eq(enterpriseProviderCompliance.orgId, claims.org_id),
        eq(enterpriseProviderCompliance.appInstanceId, claims.app_instance_id),
    );
}

function isAssignedSeatStatus(status: string | null | undefined): boolean {
    return status === 'active' || status === 'invited';
}

async function countAssignedSeats(claims: PlatformClaims, excludeMembershipId?: number): Promise<number> {
    const filters = [
        eq(enterpriseMemberships.tenantId, claims.tenant_id),
        eq(enterpriseMemberships.orgId, claims.org_id),
        eq(enterpriseMemberships.appInstanceId, claims.app_instance_id),
        drizzleSql`${enterpriseMemberships.seatStatus} IN ('active', 'invited')`,
    ];
    if (excludeMembershipId) filters.push(ne(enterpriseMemberships.id, excludeMembershipId));
    const [row] = await db.select({ total: count() })
        .from(enterpriseMemberships)
        .where(and(...filters));
    return Number(row?.total || 0);
}

async function ensureOrgEntitlements(claims: PlatformClaims): Promise<typeof enterpriseOrgEntitlements.$inferSelect> {
    const assignedSeats = await countAssignedSeats(claims);
    const [existing] = await db.select().from(enterpriseOrgEntitlements).where(orgScopeWhere(claims)).limit(1);
    if (existing) {
        if (existing.assignedSeats !== assignedSeats) {
            const [updated] = await db.update(enterpriseOrgEntitlements)
                .set({ assignedSeats, updatedAt: new Date() })
                .where(eq(enterpriseOrgEntitlements.id, existing.id))
                .returning();
            if (updated) return updated;
        }
        return existing;
    }

    const [created] = await db.insert(enterpriseOrgEntitlements).values({
        tenantId: claims.tenant_id,
        orgId: claims.org_id,
        appInstanceId: claims.app_instance_id,
        assignedSeats,
        createdBy: actorId(claims),
        updatedBy: actorId(claims),
    }).returning();
    return created;
}

function invoiceNumber(claims: PlatformClaims, date = new Date()): string {
    const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = `${claims.org_id}-${claims.app_instance_id}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toUpperCase();
    return `ELY-${stamp}-${suffix || 'ORG'}`;
}

export async function installEnterpriseGateway(body: unknown, claims: PlatformClaims, meta: EnterpriseRequestMeta) {
    const installRequest = normalizeInstallRequest(body);
    assertInstallScope(claims, installRequest);
    const response = createInstallResponse(installRequest);
    const next = toInstanceRow(response.instance);

    const [existing] = await db.select()
        .from(enterpriseGatewayInstances)
        .where(and(
            eq(enterpriseGatewayInstances.tenantId, next.tenantId),
            eq(enterpriseGatewayInstances.orgId, next.orgId),
            eq(enterpriseGatewayInstances.appInstanceId, next.appInstanceId),
        ))
        .limit(1);

    const [row] = existing
        ? await db.update(enterpriseGatewayInstances)
            .set({ ...next, createdAt: existing.createdAt, updatedAt: new Date() })
            .where(eq(enterpriseGatewayInstances.id, existing.id))
            .returning()
        : await db.insert(enterpriseGatewayInstances).values(next).returning();

    await recordEnterpriseAuditEvent(claims, 'gateway_instance.install', 'gateway_instance', row.appInstanceId, {
        project_id: row.projectId,
        public_base_url: row.publicBaseUrl,
        admin_base_url: row.adminBaseUrl,
    }, meta);

    return {
        ...response,
        instance: mapInstance(row),
    };
}

export async function uninstallEnterpriseGateway(body: unknown, claims: PlatformClaims, meta: EnterpriseRequestMeta) {
    const uninstallRequest = normalizeUninstallRequest(body);
    assertInstallScope(claims, uninstallRequest);
    const action = eventToProjectionAction(toAppUninstalledEvent(uninstallRequest));

    const [row] = await db.update(enterpriseGatewayInstances)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(and(
            eq(enterpriseGatewayInstances.tenantId, uninstallRequest.tenant_id),
            eq(enterpriseGatewayInstances.orgId, uninstallRequest.org_id),
            eq(enterpriseGatewayInstances.appId, ELYGATE_ENTERPRISE_MANIFEST.app_id),
            eq(enterpriseGatewayInstances.appInstanceId, uninstallRequest.app_instance_id),
        ))
        .returning();

    await recordEnterpriseAuditEvent(claims, 'gateway_instance.uninstall', 'gateway_instance', uninstallRequest.app_instance_id, {
        app_id: uninstallRequest.app_id,
        reason: uninstallRequest.reason ?? null,
        instance_found: Boolean(row),
    }, meta);

    return {
        action,
        status: row ? 'deleted' : 'not_found',
        instance: row ? mapInstance(row) : null,
    };
}

export async function listGatewayInstances(claims: PlatformClaims, query?: ListQuery) {
    const { page, limit, offset } = parsePagination(query);
    const where = and(
        eq(enterpriseGatewayInstances.tenantId, claims.tenant_id),
        eq(enterpriseGatewayInstances.orgId, claims.org_id),
        eq(enterpriseGatewayInstances.appId, ELYGATE_ENTERPRISE_MANIFEST.app_id),
    );
    const [{ total }] = await db.select({ total: count() }).from(enterpriseGatewayInstances).where(where);
    const rows = await db.select()
        .from(enterpriseGatewayInstances)
        .where(where)
        .orderBy(desc(enterpriseGatewayInstances.updatedAt))
        .limit(limit)
        .offset(offset);
    const data = rows.map(mapInstance);
    if (data.length === 0 && page === 1) return { data: [fallbackInstanceFromClaims(claims)], total: 1, page, limit };
    return { data, total: Number(total || 0), page, limit };
}

export async function updateGatewayInstance(claims: PlatformClaims, idOrInstance: string, body: unknown, meta: EnterpriseRequestMeta) {
    if (!isRecord(body)) throw new Error('Gateway instance update body must be an object');
    const patch: Partial<typeof enterpriseGatewayInstances.$inferInsert> = { updatedAt: new Date() };
    const status = readOptionalString(body, 'status');
    if (status) patch.status = status;
    if ('public_base_url' in body) patch.publicBaseUrl = readOptionalString(body, 'public_base_url');
    if ('admin_base_url' in body) patch.adminBaseUrl = readOptionalString(body, 'admin_base_url');
    if ('project_id' in body) patch.projectId = readOptionalString(body, 'project_id');
    if ('entitlements_version' in body) patch.entitlementsVersion = readNumber(body, 'entitlements_version', claims.entitlements_version);
    if ('metadata' in body) patch.metadata = readJsonObject(body, 'metadata');

    const id = Number(idOrInstance);
    const where = Number.isFinite(id)
        ? and(eq(enterpriseGatewayInstances.id, id), eq(enterpriseGatewayInstances.tenantId, claims.tenant_id), eq(enterpriseGatewayInstances.orgId, claims.org_id))
        : and(eq(enterpriseGatewayInstances.appInstanceId, idOrInstance), eq(enterpriseGatewayInstances.tenantId, claims.tenant_id), eq(enterpriseGatewayInstances.orgId, claims.org_id));
    const [row] = await db.update(enterpriseGatewayInstances).set(patch).where(where).returning();
    if (!row) throw Object.assign(new Error('Gateway instance not found'), { statusCode: 404 });
    await recordEnterpriseAuditEvent(claims, 'gateway_instance.update', 'gateway_instance', row.appInstanceId, patch as JsonObject, meta);
    return mapInstance(row);
}

export async function getEnterpriseOverview(claims: PlatformClaims) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const instanceWhere = and(eq(enterpriseGatewayInstances.tenantId, claims.tenant_id), eq(enterpriseGatewayInstances.orgId, claims.org_id));
    const recentUsageWhere = usageWindowWhere(claims, sevenDaysAgo);
    const [
        [instances],
        [activeInstances],
        [policyTotal],
        [budgetTotal],
        [audit24h],
        [requestStats],
        [tokenTotal],
        [channelTotal],
        models,
    ] = await Promise.all([
        db.select({ total: count() }).from(enterpriseGatewayInstances).where(instanceWhere),
        db.select({ total: count() }).from(enterpriseGatewayInstances).where(and(instanceWhere, eq(enterpriseGatewayInstances.status, 'active'))),
        db.select({ total: count() }).from(enterpriseIdentityPolicies).where(and(eq(enterpriseIdentityPolicies.tenantId, claims.tenant_id), eq(enterpriseIdentityPolicies.orgId, claims.org_id))),
        db.select({ total: count() }).from(enterpriseBudgets).where(and(eq(enterpriseBudgets.tenantId, claims.tenant_id), eq(enterpriseBudgets.orgId, claims.org_id))),
        db.select({ total: count() }).from(enterpriseAuditEvents).where(and(
            eq(enterpriseAuditEvents.tenantId, claims.tenant_id),
            eq(enterpriseAuditEvents.orgId, claims.org_id),
            gte(enterpriseAuditEvents.createdAt, dayAgo),
        )),
        db.select({ total: count(), cost: sum(logs.quotaCost) }).from(logs).where(recentUsageWhere),
        db.select({ total: count() }).from(tokens),
        db.select({ total: count() }).from(channels),
        db.select({ modelName: logs.modelName, requests: count(), cost: sum(logs.quotaCost) })
            .from(logs)
            .where(recentUsageWhere)
            .groupBy(logs.modelName)
            .orderBy(desc(count()))
            .limit(8),
    ]);

    return {
        manifest: ELYGATE_ENTERPRISE_MANIFEST,
        claims,
        stats: {
            gateway_instances: Number(instances?.total || 0),
            active_instances: Number(activeInstances?.total || 0),
            identity_policies: Number(policyTotal?.total || 0),
            budgets: Number(budgetTotal?.total || 0),
            audit_events_24h: Number(audit24h?.total || 0),
            requests_7d: Number(requestStats?.total || 0),
            cost_7d: Number(requestStats?.cost || 0),
            gateway_api_keys: Number(tokenTotal?.total || 0),
            provider_channels: Number(channelTotal?.total || 0),
        },
        model_distribution: models,
    };
}

export async function getIdentityAndPolicy(claims: PlatformClaims, query?: ListQuery) {
    const policies = await listIdentityPolicies(claims, query);
    return {
        claims,
        roles: claims.roles,
        scopes: claims.scopes,
        available_scopes: Object.values(AI_GATEWAY_SCOPES),
        policies: policies.data,
        total: policies.total,
    };
}

export async function listIdentityPolicies(claims: PlatformClaims, query?: ListQuery) {
    const { page, limit, offset } = parsePagination(query);
    const where = and(eq(enterpriseIdentityPolicies.tenantId, claims.tenant_id), eq(enterpriseIdentityPolicies.orgId, claims.org_id));
    const [{ total }] = await db.select({ total: count() }).from(enterpriseIdentityPolicies).where(where);
    const rows = await db.select()
        .from(enterpriseIdentityPolicies)
        .where(where)
        .orderBy(desc(enterpriseIdentityPolicies.updatedAt))
        .limit(limit)
        .offset(offset);
    return { data: rows.map(mapPolicy), total: Number(total || 0), page, limit };
}

export async function createIdentityPolicy(claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) {
    if (!isRecord(body)) throw new Error('Identity policy body must be an object');
    const [row] = await db.insert(enterpriseIdentityPolicies).values({
        tenantId: claims.tenant_id,
        orgId: claims.org_id,
        appInstanceId: readOptionalString(body, 'app_instance_id') ?? claims.app_instance_id,
        name: readOptionalString(body, 'name') ?? 'Default Enterprise Policy',
        targetKind: readOptionalString(body, 'target_kind') ?? 'org',
        targetId: readOptionalString(body, 'target_id'),
        effect: readOptionalString(body, 'effect') ?? 'allow',
        rules: readJsonObject(body, 'rules'),
        status: readOptionalString(body, 'status') ?? 'active',
        createdBy: actorId(claims),
        updatedBy: actorId(claims),
    }).returning();
    await recordEnterpriseAuditEvent(claims, 'identity_policy.create', 'identity_policy', String(row.id), mapPolicy(row), meta);
    return mapPolicy(row);
}

export async function updateIdentityPolicy(claims: PlatformClaims, id: string, body: unknown, meta: EnterpriseRequestMeta) {
    if (!isRecord(body)) throw new Error('Identity policy update body must be an object');
    const patch: Partial<typeof enterpriseIdentityPolicies.$inferInsert> = { updatedAt: new Date(), updatedBy: actorId(claims) };
    if ('name' in body) patch.name = readOptionalString(body, 'name') ?? 'Default Enterprise Policy';
    if ('target_kind' in body) patch.targetKind = readOptionalString(body, 'target_kind') ?? 'org';
    if ('target_id' in body) patch.targetId = readOptionalString(body, 'target_id');
    if ('effect' in body) patch.effect = readOptionalString(body, 'effect') ?? 'allow';
    if ('rules' in body) patch.rules = readJsonObject(body, 'rules');
    if ('status' in body) patch.status = readOptionalString(body, 'status') ?? 'active';
    const [row] = await db.update(enterpriseIdentityPolicies)
        .set(patch)
        .where(and(
            eq(enterpriseIdentityPolicies.id, Number(id)),
            eq(enterpriseIdentityPolicies.tenantId, claims.tenant_id),
            eq(enterpriseIdentityPolicies.orgId, claims.org_id),
        ))
        .returning();
    if (!row) throw Object.assign(new Error('Identity policy not found'), { statusCode: 404 });
    await recordEnterpriseAuditEvent(claims, 'identity_policy.update', 'identity_policy', String(row.id), patch as JsonObject, meta);
    return mapPolicy(row);
}

export async function evaluateEnterprisePolicy(claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) {
    const input = normalizePolicyEvaluationInput(body, claims);
    const rows = await db.select()
        .from(enterpriseIdentityPolicies)
        .where(and(
            eq(enterpriseIdentityPolicies.tenantId, claims.tenant_id),
            eq(enterpriseIdentityPolicies.orgId, claims.org_id),
            eq(enterpriseIdentityPolicies.appInstanceId, claims.app_instance_id),
        ))
        .orderBy(desc(enterpriseIdentityPolicies.updatedAt), desc(enterpriseIdentityPolicies.id));
    const result = evaluateEnterprisePolicies(
        claims,
        input,
        rows.map(toPolicyRecord),
        gatewayInstanceScope(claims),
    );
    await recordEnterpriseAuditEvent(claims, 'identity_policy.evaluate', 'policy_evaluation', result.decision, {
        decision: result.decision,
        reason: result.reason,
        input: result.input,
        matched_policy_ids: result.matched_policies.map((policy) => policy.id),
        deny_policy_ids: result.deny_policy_ids,
        allow_policy_ids: result.allow_policy_ids,
    }, meta);
    return result;
}

export async function getUsageAndBudget(claims: PlatformClaims, query?: ListQuery) {
    const [budgets, attribution] = await Promise.all([
        listBudgets(claims, query),
        listUsageAttribution(claims, query),
    ]);
    return {
        budgets: budgets.data,
        total: budgets.total,
        usage_7d: attribution.totals,
        attribution,
    };
}

export async function listUsageAttribution(claims: PlatformClaims, query?: ListQuery) {
    const days = parseWindowDays(query);
    const { limit } = parsePagination(query);
    const until = new Date();
    const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
    const windowWhere = usageWindowWhere(claims, since);

    const [
        [totals],
        byModel,
        byUser,
        byApiKey,
        byChannel,
        byExternalUser,
        byExternalWorkspace,
        byExternalFeature,
    ] = await Promise.all([
        db.select(usageMetricSelection).from(logs).where(windowWhere),
        db.select({
            subjectId: logs.modelName,
            subjectLabel: logs.modelName,
            ...usageMetricSelection,
        })
            .from(logs)
            .where(windowWhere)
            .groupBy(logs.modelName)
            .orderBy(usageCostOrder)
            .limit(limit),
        db.select({
            subjectId: logs.userId,
            subjectLabel: users.username,
            ...usageMetricSelection,
        })
            .from(logs)
            .leftJoin(users, eq(logs.userId, users.id))
            .where(windowWhere)
            .groupBy(logs.userId, users.username)
            .orderBy(usageCostOrder)
            .limit(limit),
        db.select({
            subjectId: logs.tokenId,
            subjectLabel: tokens.name,
            subjectSecondary: tokens.userId,
            credentialMask: tokens.key,
            ...usageMetricSelection,
        })
            .from(logs)
            .leftJoin(tokens, eq(logs.tokenId, tokens.id))
            .where(and(windowWhere, isNotNull(logs.tokenId)))
            .groupBy(logs.tokenId, tokens.name, tokens.userId, tokens.key)
            .orderBy(usageCostOrder)
            .limit(limit),
        db.select({
            subjectId: logs.channelId,
            subjectLabel: channels.name,
            subjectSecondary: channels.type,
            ...usageMetricSelection,
        })
            .from(logs)
            .leftJoin(channels, eq(logs.channelId, channels.id))
            .where(and(windowWhere, isNotNull(logs.channelId)))
            .groupBy(logs.channelId, channels.name, channels.type)
            .orderBy(usageCostOrder)
            .limit(limit),
        db.select({
            subjectId: logs.externalUserId,
            subjectLabel: logs.externalUserId,
            ...usageMetricSelection,
        })
            .from(logs)
            .where(and(windowWhere, isNotNull(logs.externalUserId)))
            .groupBy(logs.externalUserId)
            .orderBy(usageCostOrder)
            .limit(limit),
        db.select({
            subjectId: logs.externalWorkspaceId,
            subjectLabel: logs.externalWorkspaceId,
            ...usageMetricSelection,
        })
            .from(logs)
            .where(and(windowWhere, isNotNull(logs.externalWorkspaceId)))
            .groupBy(logs.externalWorkspaceId)
            .orderBy(usageCostOrder)
            .limit(limit),
        db.select({
            subjectId: logs.externalFeatureType,
            subjectLabel: logs.externalFeatureType,
            ...usageMetricSelection,
        })
            .from(logs)
            .where(and(windowWhere, isNotNull(logs.externalFeatureType)))
            .groupBy(logs.externalFeatureType)
            .orderBy(usageCostOrder)
            .limit(limit),
    ]);

    return {
        scope: gatewayInstanceScope(claims),
        scope_boundary: 'gateway_instance_projection',
        window: {
            days,
            since: since.toISOString(),
            until: until.toISOString(),
        },
        totals: {
            requests: numberValue(totals?.requests),
            quota_cost: numberValue(totals?.quotaCost),
            prompt_tokens: numberValue(totals?.promptTokens),
            completion_tokens: numberValue(totals?.completionTokens),
            cached_tokens: numberValue(totals?.cachedTokens),
            error_count: numberValue(totals?.errorCount),
            avg_elapsed_ms: numberValue(totals?.avgElapsedMs),
            last_seen_at: dateValueIso(totals?.lastSeenAt),
        },
        dimensions: {
            models: byModel.map((row) => mapUsageAttribution(row, 'model', 'unknown model')),
            users: byUser.map((row) => mapUsageAttribution(row, 'user', `user ${row.subjectId ?? 'unknown'}`)),
            api_keys: byApiKey.map((row) => ({
                ...mapUsageAttribution(row, 'api_key', `key ${row.subjectId ?? 'unknown'}`),
                credential_mask: maskCredential(row.credentialMask),
            })),
            channels: byChannel.map((row) => mapUsageAttribution(row, 'channel', `channel ${row.subjectId ?? 'unknown'}`)),
            external_users: byExternalUser.map((row) => mapUsageAttribution(row, 'external_user', 'unknown external user')),
            external_workspaces: byExternalWorkspace.map((row) => mapUsageAttribution(row, 'external_workspace', 'unknown workspace')),
            external_features: byExternalFeature.map((row) => mapUsageAttribution(row, 'external_feature', 'unknown feature')),
        },
    };
}

export async function listBudgets(claims: PlatformClaims, query?: ListQuery) {
    await rolloverDueEnterpriseBudgets(claims);
    const { page, limit, offset } = parsePagination(query);
    const where = and(eq(enterpriseBudgets.tenantId, claims.tenant_id), eq(enterpriseBudgets.orgId, claims.org_id));
    const [{ total }] = await db.select({ total: count() }).from(enterpriseBudgets).where(where);
    const rows = await db.select()
        .from(enterpriseBudgets)
        .where(where)
        .orderBy(desc(enterpriseBudgets.updatedAt))
        .limit(limit)
        .offset(offset);
    return { data: rows.map(mapBudget), total: Number(total || 0), page, limit };
}

export async function createBudget(claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) {
    if (!isRecord(body)) throw new Error('Budget body must be an object');
    const period = readOptionalString(body, 'period') ?? 'monthly';
    const resetAt = readDate(body, 'reset_at') ?? nextEnterpriseBudgetResetAt(period);
    const [row] = await db.insert(enterpriseBudgets).values({
        tenantId: claims.tenant_id,
        orgId: claims.org_id,
        appInstanceId: readOptionalString(body, 'app_instance_id') ?? claims.app_instance_id,
        subjectKind: readOptionalString(body, 'subject_kind') ?? 'org',
        subjectId: readOptionalString(body, 'subject_id'),
        period,
        limitQuota: readNumber(body, 'limit_quota', 0),
        usedQuota: readNumber(body, 'used_quota', 0),
        alertThresholdPct: readNumber(body, 'alert_threshold_pct', 80),
        resetAt,
        status: readOptionalString(body, 'status') ?? 'active',
        metadata: readJsonObject(body, 'metadata'),
        createdBy: actorId(claims),
        updatedBy: actorId(claims),
    }).returning();
    await recordEnterpriseAuditEvent(claims, 'budget.create', 'budget', String(row.id), mapBudget(row), meta);
    return mapBudget(row);
}

export async function updateBudget(claims: PlatformClaims, id: string, body: unknown, meta: EnterpriseRequestMeta) {
    if (!isRecord(body)) throw new Error('Budget update body must be an object');
    const patch: Partial<typeof enterpriseBudgets.$inferInsert> = { updatedAt: new Date(), updatedBy: actorId(claims) };
    if ('subject_kind' in body) patch.subjectKind = readOptionalString(body, 'subject_kind') ?? 'org';
    if ('subject_id' in body) patch.subjectId = readOptionalString(body, 'subject_id');
    if ('period' in body) {
        patch.period = readOptionalString(body, 'period') ?? 'monthly';
        if (!('reset_at' in body)) patch.resetAt = nextEnterpriseBudgetResetAt(patch.period);
    }
    if ('limit_quota' in body) patch.limitQuota = readNumber(body, 'limit_quota', 0);
    if ('used_quota' in body) patch.usedQuota = readNumber(body, 'used_quota', 0);
    if ('alert_threshold_pct' in body) patch.alertThresholdPct = readNumber(body, 'alert_threshold_pct', 80);
    if ('reset_at' in body) patch.resetAt = readDate(body, 'reset_at');
    if ('status' in body) patch.status = readOptionalString(body, 'status') ?? 'active';
    if ('metadata' in body) patch.metadata = readJsonObject(body, 'metadata');
    const [row] = await db.update(enterpriseBudgets)
        .set(patch)
        .where(and(eq(enterpriseBudgets.id, Number(id)), eq(enterpriseBudgets.tenantId, claims.tenant_id), eq(enterpriseBudgets.orgId, claims.org_id)))
        .returning();
    if (!row) throw Object.assign(new Error('Budget not found'), { statusCode: 404 });
    await recordEnterpriseAuditEvent(claims, 'budget.update', 'budget', String(row.id), patch as JsonObject, meta);
    return mapBudget(row);
}

export async function evaluateEnterpriseBudget(claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) {
    const input = normalizeBudgetEvaluationInput(body, claims);
    await rolloverDueEnterpriseBudgets(claims, { appInstanceOnly: true, meta });
    const rows = await db.select()
        .from(enterpriseBudgets)
        .where(and(
            eq(enterpriseBudgets.tenantId, claims.tenant_id),
            eq(enterpriseBudgets.orgId, claims.org_id),
            eq(enterpriseBudgets.appInstanceId, claims.app_instance_id),
        ))
        .orderBy(desc(enterpriseBudgets.updatedAt), desc(enterpriseBudgets.id));
    const result = evaluateEnterpriseBudgets(
        claims,
        input,
        rows.map(toBudgetRecord),
        gatewayInstanceScope(claims),
    );
    await recordEnterpriseAuditEvent(claims, 'budget.evaluate', 'budget_evaluation', result.decision, {
        decision: result.decision,
        reason: result.reason,
        input: result.input,
        matched_budget_ids: result.matched_budgets.map((budget) => budget.id),
        warning_budget_ids: result.warning_budget_ids,
        blocking_budget_ids: result.blocking_budget_ids,
    }, meta);
    return result;
}

export async function getOrgEntitlements(claims: PlatformClaims) {
    return mapEntitlements(await ensureOrgEntitlements(claims));
}

export async function updateOrgEntitlements(claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) {
    if (!isRecord(body)) throw new Error('Entitlements update body must be an object');
    await ensureOrgEntitlements(claims);
    const patch: Partial<typeof enterpriseOrgEntitlements.$inferInsert> = { updatedAt: new Date(), updatedBy: actorId(claims) };
    if ('seat_limit' in body) patch.seatLimit = readNumber(body, 'seat_limit', 5);
    if ('billing_mode' in body) patch.billingMode = readOptionalString(body, 'billing_mode') ?? 'prepaid';
    if ('overage_enabled' in body) patch.overageEnabled = Boolean(body.overage_enabled);
    if ('overage_unit_price_cents' in body) patch.overageUnitPriceCents = readNumber(body, 'overage_unit_price_cents', 0);
    if ('budget_mode' in body) patch.budgetMode = readOptionalString(body, 'budget_mode') ?? 'hard_limit';
    if ('default_no_training' in body) patch.defaultNoTraining = Boolean(body.default_no_training);
    if ('data_retention_days' in body) patch.dataRetentionDays = readNumber(body, 'data_retention_days', 30);
    if ('provider_compliance_mode' in body) patch.providerComplianceMode = readOptionalString(body, 'provider_compliance_mode') ?? 'strict';
    if ('allowed_ip_policy' in body) patch.allowedIpPolicy = readOptionalString(body, 'allowed_ip_policy');
    if ('status' in body) patch.status = readOptionalString(body, 'status') ?? 'active';
    if ('metadata' in body) patch.metadata = readJsonObject(body, 'metadata');

    const [row] = await db.update(enterpriseOrgEntitlements).set(patch).where(orgScopeWhere(claims)).returning();
    if (!row) throw Object.assign(new Error('Org entitlements not found'), { statusCode: 404 });

    const localOrgId = Number(claims.org_id);
    if ('allowed_ip_policy' in body && Number.isInteger(localOrgId) && localOrgId > 0) {
        await db.update(organizations)
            .set({ allowedSubnets: patch.allowedIpPolicy ?? '', updatedAt: new Date() })
            .where(eq(organizations.id, localOrgId));
    }

    await recordEnterpriseAuditEvent(claims, 'entitlements.update', 'org_entitlements', String(row.id), patch as JsonObject, meta);
    return mapEntitlements(row);
}

export async function listMemberships(claims: PlatformClaims, query?: ListQuery) {
    const { page, limit, offset } = parsePagination(query);
    const where = membershipScopeWhere(claims);
    const [{ total }] = await db.select({ total: count() }).from(enterpriseMemberships).where(where);
    const rows = await db.select()
        .from(enterpriseMemberships)
        .where(where)
        .orderBy(desc(enterpriseMemberships.updatedAt), desc(enterpriseMemberships.id))
        .limit(limit)
        .offset(offset);
    return { data: rows.map(mapMembership), total: Number(total || 0), page, limit };
}

export async function getMembersAndAccess(claims: PlatformClaims, query?: ListQuery) {
    const [entitlements, memberships, policies] = await Promise.all([
        getOrgEntitlements(claims),
        listMemberships(claims, query),
        listIdentityPolicies(claims, query),
    ]);
    return { entitlements, memberships, policies };
}

export async function upsertMembership(claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) {
    if (!isRecord(body)) throw new Error('Membership body must be an object');
    const userId = readOptionalString(body, 'user_id');
    const email = readOptionalString(body, 'email');
    if (!userId && !email) throw Object.assign(new Error('Membership requires user_id or email'), { statusCode: 400 });
    const entitlements = await ensureOrgEntitlements(claims);
    const lookup = userId
        ? eq(enterpriseMemberships.userId, userId)
        : eq(enterpriseMemberships.email, email ?? '');
    const filters = [
        eq(enterpriseMemberships.tenantId, claims.tenant_id),
        eq(enterpriseMemberships.orgId, claims.org_id),
        eq(enterpriseMemberships.appInstanceId, claims.app_instance_id),
        lookup,
    ];
    const [existing] = await db.select().from(enterpriseMemberships).where(and(...filters)).limit(1);
    const seatStatus = readOptionalString(body, 'seat_status') ?? (userId ? 'active' : 'invited');
    const assignedSeats = await countAssignedSeats(claims, existing?.id);
    if (isAssignedSeatStatus(seatStatus) && assignedSeats >= entitlements.seatLimit && !entitlements.overageEnabled) {
        throw Object.assign(new Error('Seat limit reached and overage is disabled'), { statusCode: 402 });
    }
    const values = {
        tenantId: claims.tenant_id,
        orgId: claims.org_id,
        appInstanceId: claims.app_instance_id,
        userId,
        email,
        displayName: readOptionalString(body, 'display_name'),
        role: readOptionalString(body, 'role') ?? 'developer',
        scopes: readUnknownStringArray(body.scopes) as string[],
        seatKind: readOptionalString(body, 'seat_kind') ?? 'human',
        seatStatus,
        invitedBy: actorId(claims),
        joinedAt: seatStatus === 'active' ? new Date() : null,
        lastActiveAt: readDate(body, 'last_active_at'),
        metadata: readJsonObject(body, 'metadata'),
        updatedAt: new Date(),
    };
    const [row] = existing
        ? await db.update(enterpriseMemberships).set(values).where(eq(enterpriseMemberships.id, existing.id)).returning()
        : await db.insert(enterpriseMemberships).values(values).returning();
    await ensureOrgEntitlements(claims);
    await recordEnterpriseAuditEvent(claims, existing ? 'membership.update' : 'membership.create', 'membership', String(row.id), mapMembership(row), meta);
    return mapMembership(row);
}

export async function updateMembership(claims: PlatformClaims, id: string, body: unknown, meta: EnterpriseRequestMeta) {
    if (!isRecord(body)) throw new Error('Membership update body must be an object');
    const membershipId = Number(id);
    if (!Number.isInteger(membershipId) || membershipId <= 0) {
        throw Object.assign(new Error('Membership not found'), { statusCode: 404 });
    }
    const [existing] = await db.select().from(enterpriseMemberships)
        .where(and(eq(enterpriseMemberships.id, membershipId), membershipScopeWhere(claims)))
        .limit(1);
    if (!existing) throw Object.assign(new Error('Membership not found'), { statusCode: 404 });

    const nextSeatStatus = 'seat_status' in body
        ? readOptionalString(body, 'seat_status') ?? 'active'
        : existing.seatStatus;
    if (isAssignedSeatStatus(nextSeatStatus)) {
        const [entitlements, assignedSeats] = await Promise.all([
            ensureOrgEntitlements(claims),
            countAssignedSeats(claims, membershipId),
        ]);
        if (assignedSeats >= entitlements.seatLimit && !entitlements.overageEnabled) {
            throw Object.assign(new Error('Seat limit reached and overage is disabled'), { statusCode: 402 });
        }
    }

    const patch: Partial<typeof enterpriseMemberships.$inferInsert> = { updatedAt: new Date() };
    if ('display_name' in body) patch.displayName = readOptionalString(body, 'display_name');
    if ('role' in body) patch.role = readOptionalString(body, 'role') ?? 'developer';
    if ('scopes' in body) patch.scopes = readUnknownStringArray(body.scopes) as string[];
    if ('seat_kind' in body) patch.seatKind = readOptionalString(body, 'seat_kind') ?? 'human';
    if ('seat_status' in body) patch.seatStatus = readOptionalString(body, 'seat_status') ?? 'active';
    if ('last_active_at' in body) patch.lastActiveAt = readDate(body, 'last_active_at');
    if ('metadata' in body) patch.metadata = readJsonObject(body, 'metadata');
    const [row] = await db.update(enterpriseMemberships)
        .set(patch)
        .where(and(eq(enterpriseMemberships.id, membershipId), membershipScopeWhere(claims)))
        .returning();
    await ensureOrgEntitlements(claims);
    await recordEnterpriseAuditEvent(claims, 'membership.update', 'membership', String(row.id), patch as JsonObject, meta);
    return mapMembership(row);
}

export async function getUsageEfficiency(claims: PlatformClaims, query?: ListQuery) {
    const attribution = await listUsageAttribution(claims, query) as Awaited<ReturnType<typeof listUsageAttribution>>;
    const totals = attribution.totals;
    const requests = Math.max(1, numberValue(totals.requests));
    const quotaCost = numberValue(totals.quota_cost);
    return {
        scope: attribution.scope,
        window: attribution.window,
        totals,
        efficiency: {
            quota_per_request: Math.round((quotaCost / requests) * 100) / 100,
            error_rate_pct: Math.round((numberValue(totals.error_count) / requests) * 10000) / 100,
            cache_ratio_pct: Math.round((numberValue(totals.cached_tokens) / Math.max(1, numberValue(totals.prompt_tokens) + numberValue(totals.completion_tokens))) * 10000) / 100,
            avg_elapsed_ms: numberValue(totals.avg_elapsed_ms),
        },
        dimensions: attribution.dimensions,
    };
}

export async function upsertBillingAccount(claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) {
    if (!isRecord(body)) throw new Error('Billing account body must be an object');
    const [existing] = await db.select().from(enterpriseBillingAccounts).where(billingScopeWhere(claims)).limit(1);
    const values = {
        tenantId: claims.tenant_id,
        orgId: claims.org_id,
        appInstanceId: claims.app_instance_id,
        billingName: readOptionalString(body, 'billing_name') ?? claims.org_id,
        billingEmail: readOptionalString(body, 'billing_email'),
        taxId: readOptionalString(body, 'tax_id'),
        currency: readOptionalString(body, 'currency') ?? 'USD',
        paymentTerms: readOptionalString(body, 'payment_terms') ?? 'net_30',
        status: readOptionalString(body, 'status') ?? 'active',
        metadata: readJsonObject(body, 'metadata'),
        createdBy: actorId(claims),
        updatedBy: actorId(claims),
        updatedAt: new Date(),
    };
    const [row] = existing
        ? await db.update(enterpriseBillingAccounts).set({ ...values, createdBy: existing.createdBy }).where(eq(enterpriseBillingAccounts.id, existing.id)).returning()
        : await db.insert(enterpriseBillingAccounts).values(values).returning();
    await recordEnterpriseAuditEvent(claims, existing ? 'billing_account.update' : 'billing_account.create', 'billing_account', String(row.id), mapBillingAccount(row), meta);
    return mapBillingAccount(row);
}

export async function listInvoices(claims: PlatformClaims, query?: ListQuery) {
    const { page, limit, offset } = parsePagination(query);
    const where = invoicesScopeWhere(claims);
    const [{ total }] = await db.select({ total: count() }).from(enterpriseInvoices).where(where);
    const rows = await db.select()
        .from(enterpriseInvoices)
        .where(where)
        .orderBy(desc(enterpriseInvoices.periodStart), desc(enterpriseInvoices.id))
        .limit(limit)
        .offset(offset);
    return { data: rows.map((row) => mapInvoice(row)), total: Number(total || 0), page, limit };
}

export async function createInvoice(claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) {
    if (!isRecord(body)) throw new Error('Invoice body must be an object');
    const [billingAccount] = await db.select().from(enterpriseBillingAccounts).where(billingScopeWhere(claims)).limit(1);
    const periodStart = readDate(body, 'period_start') ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const periodEnd = readDate(body, 'period_end') ?? new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));
    const itemsInput = Array.isArray(body.items) ? body.items.filter(isRecord) : [];
    const items = itemsInput.map((item) => {
        const quantity = Math.max(0, readNumber(item, 'quantity', 1));
        const unitAmountCents = readNumber(item, 'unit_amount_cents', 0);
        return {
            itemType: readOptionalString(item, 'item_type') ?? 'manual',
            description: readOptionalString(item, 'description') ?? 'Enterprise service',
            quantity: String(quantity),
            unitAmountCents,
            amountCents: 'amount_cents' in item ? readNumber(item, 'amount_cents', 0) : quantity * unitAmountCents,
            sourceType: readOptionalString(item, 'source_type'),
            sourceId: readOptionalString(item, 'source_id'),
            metadata: readJsonObject(item, 'metadata'),
        };
    });
    const subtotalCents = items.reduce((sumValue, item) => sumValue + Number(item.amountCents || 0), 0);
    const taxCents = readNumber(body, 'tax_cents', 0);
    const [invoice] = await db.insert(enterpriseInvoices).values({
        tenantId: claims.tenant_id,
        orgId: claims.org_id,
        appInstanceId: claims.app_instance_id,
        billingAccountId: billingAccount?.id ?? null,
        invoiceNumber: readOptionalString(body, 'invoice_number') ?? invoiceNumber(claims),
        periodStart,
        periodEnd,
        currency: readOptionalString(body, 'currency') ?? billingAccount?.currency ?? 'USD',
        subtotalCents,
        taxCents,
        totalCents: subtotalCents + taxCents,
        status: readOptionalString(body, 'status') ?? 'draft',
        dueAt: readDate(body, 'due_at') ?? new Date(periodEnd.getTime() + 30 * 24 * 60 * 60 * 1000),
        issuedAt: readDate(body, 'issued_at'),
        paidAt: readDate(body, 'paid_at'),
        metadata: readJsonObject(body, 'metadata'),
    }).returning();
    const createdItems = items.length
        ? await db.insert(enterpriseInvoiceItems).values(items.map((item) => ({ invoiceId: invoice.id, ...item }))).returning()
        : [];
    await recordEnterpriseAuditEvent(claims, 'invoice.create', 'invoice', String(invoice.id), { invoice_number: invoice.invoiceNumber, total_cents: invoice.totalCents }, meta);
    return mapInvoice(invoice, createdItems.map(mapInvoiceItem));
}

export async function getBillingAndInvoices(claims: PlatformClaims, query?: ListQuery) {
    const [billingAccount] = await db.select().from(enterpriseBillingAccounts).where(billingScopeWhere(claims)).limit(1);
    const [invoices, [unbilled]] = await Promise.all([
        listInvoices(claims, query),
        db.select({
            quantity: drizzleSql<string>`coalesce(sum(${enterpriseMeteredUsage.quantity}), 0)::bigint`,
            amountCents: drizzleSql<string>`coalesce(sum(${enterpriseMeteredUsage.amountCents}), 0)::bigint`,
        })
            .from(enterpriseMeteredUsage)
            .where(and(
                eq(enterpriseMeteredUsage.tenantId, claims.tenant_id),
                eq(enterpriseMeteredUsage.orgId, claims.org_id),
                eq(enterpriseMeteredUsage.appInstanceId, claims.app_instance_id),
                drizzleSql`${enterpriseMeteredUsage.invoiceId} IS NULL`,
            )),
    ]);
    return {
        billing_account: billingAccount ? mapBillingAccount(billingAccount) : null,
        invoices,
        unbilled_usage: {
            quantity: numberValue(unbilled?.quantity),
            amount_cents: numberValue(unbilled?.amountCents),
        },
    };
}

export async function upsertProviderCompliance(claims: PlatformClaims, body: unknown, meta: EnterpriseRequestMeta) {
    if (!isRecord(body)) throw new Error('Provider compliance body must be an object');
    const providerKind = readOptionalString(body, 'provider_kind') ?? 'channel';
    const providerId = readOptionalString(body, 'provider_id');
    if (!providerId) throw Object.assign(new Error('Provider compliance requires provider_id'), { statusCode: 400 });
    const [existing] = await db.select().from(enterpriseProviderCompliance).where(and(
        providerComplianceScopeWhere(claims),
        eq(enterpriseProviderCompliance.providerKind, providerKind),
        eq(enterpriseProviderCompliance.providerId, providerId),
    )).limit(1);
    const values = {
        tenantId: claims.tenant_id,
        orgId: claims.org_id,
        appInstanceId: claims.app_instance_id,
        providerKind,
        providerId,
        displayName: readOptionalString(body, 'display_name'),
        noTraining: Boolean(body.no_training),
        zeroRetention: Boolean(body.zero_retention),
        region: readOptionalString(body, 'region'),
        status: readOptionalString(body, 'status') ?? 'review',
        evidenceUrl: readOptionalString(body, 'evidence_url'),
        reviewedBy: actorId(claims),
        reviewedAt: new Date(),
        metadata: readJsonObject(body, 'metadata'),
        updatedAt: new Date(),
    };
    const [row] = existing
        ? await db.update(enterpriseProviderCompliance).set(values).where(eq(enterpriseProviderCompliance.id, existing.id)).returning()
        : await db.insert(enterpriseProviderCompliance).values(values).returning();
    await recordEnterpriseAuditEvent(claims, existing ? 'provider_compliance.update' : 'provider_compliance.create', 'provider_compliance', String(row.id), mapProviderCompliance(row), meta);
    return mapProviderCompliance(row);
}

export async function getDataGovernance(claims: PlatformClaims, query?: ListQuery) {
    const { page, limit, offset } = parsePagination(query);
    const [entitlements, [{ total }], rows] = await Promise.all([
        getOrgEntitlements(claims),
        db.select({ total: count() }).from(enterpriseProviderCompliance).where(providerComplianceScopeWhere(claims)),
        db.select()
            .from(enterpriseProviderCompliance)
            .where(providerComplianceScopeWhere(claims))
            .orderBy(desc(enterpriseProviderCompliance.updatedAt), desc(enterpriseProviderCompliance.id))
            .limit(limit)
            .offset(offset),
    ]);
    const providers = rows.map(mapProviderCompliance);
    return {
        entitlements,
        providers: { data: providers, total: Number(total || 0), page, limit },
        enforcement: {
            default_no_training: (entitlements as ReturnType<typeof mapEntitlements>).default_no_training,
            provider_compliance_mode: (entitlements as ReturnType<typeof mapEntitlements>).provider_compliance_mode,
            allowed_providers: providers.filter((provider) => provider.status === 'approved' && provider.no_training),
            blocked_providers: providers.filter((provider) => provider.status !== 'approved' || !provider.no_training),
        },
    };
}

export async function listAuditEvents(claims: PlatformClaims, query?: ListQuery) {
    const { page, limit, offset } = parsePagination(query);
    const where = auditEventWhere(claims, query);
    const [{ total }] = await db.select({ total: count() }).from(enterpriseAuditEvents).where(where);
    const rows = await db.select()
        .from(enterpriseAuditEvents)
        .where(where)
        .orderBy(desc(enterpriseAuditEvents.createdAt))
        .limit(limit)
        .offset(offset);
    return { data: rows.map(mapAuditEvent), total: Number(total || 0), page, limit };
}

export async function exportAuditEvents(claims: PlatformClaims, query?: ListQuery) {
    const limit = auditExportLimit(query);
    const where = auditEventWhere(claims, query);
    const rows = await db.select()
        .from(enterpriseAuditEvents)
        .where(where)
        .orderBy(desc(enterpriseAuditEvents.createdAt))
        .limit(limit);
    const data = rows.map(mapAuditEvent);
    const createdAt = new Date().toISOString().replace(/[:.]/g, '-');
    return {
        filename: `elygate-audit-events-${createdAt}.csv`,
        content_type: 'text/csv; charset=utf-8',
        total: data.length,
        content: auditEventsCsv(data),
    };
}

export async function applyPlatformEvent(event: PlatformEvent, claims: PlatformClaims, meta: EnterpriseRequestMeta): Promise<ProjectionAction> {
    assertEnterpriseAppEvent(event);
    const action = eventToProjectionAction(event);
    if ('tenant_id' in event && (event.tenant_id !== claims.tenant_id || event.org_id !== claims.org_id)) {
        throw Object.assign(new Error('Platform event scope does not match SupAuth claims'), { statusCode: 403 });
    }
    if (action.kind === 'disable-instance') {
        await db.update(enterpriseGatewayInstances)
            .set({ status: 'deleted', updatedAt: new Date() })
            .where(and(
                eq(enterpriseGatewayInstances.tenantId, action.tenant_id),
                eq(enterpriseGatewayInstances.orgId, action.org_id),
                eq(enterpriseGatewayInstances.appInstanceId, action.app_instance_id),
            ));
    } else if (event.type === 'app.installed') {
        const instance = toGatewayInstance({
            tenant_id: event.tenant_id,
            org_id: event.org_id,
            app_instance_id: event.app_instance_id,
            database_url_secret_name: '',
            supauth_issuer_url: enterpriseRuntimeConfig.supauthIssuerUrl,
            supauth_jwks_url: enterpriseRuntimeConfig.supauthJwksUrl,
            supauth_audience: enterpriseRuntimeConfig.supauthAudience,
        });
        const existing = await db.select()
            .from(enterpriseGatewayInstances)
            .where(and(
                eq(enterpriseGatewayInstances.tenantId, event.tenant_id),
                eq(enterpriseGatewayInstances.orgId, event.org_id),
                eq(enterpriseGatewayInstances.appInstanceId, event.app_instance_id),
            ))
            .limit(1);
        if (!existing.length) await db.insert(enterpriseGatewayInstances).values(toInstanceRow(instance));
    } else if (event.type === 'entitlements.changed' || event.type === 'org.updated') {
        await db.update(enterpriseGatewayInstances)
            .set({ entitlementsVersion: event.entitlements_version, updatedAt: new Date() })
            .where(and(eq(enterpriseGatewayInstances.tenantId, event.tenant_id), eq(enterpriseGatewayInstances.orgId, event.org_id)));
    }
    await recordEnterpriseAuditEvent(claims, `platform.${event.type}`, 'platform_event', 'app_instance_id' in event ? event.app_instance_id : null, event as unknown as JsonObject, meta);
    return action;
}

export const postgresEnterpriseControlPlane = {
    getEnterpriseOverview,
    listGatewayInstances,
    installEnterpriseGateway,
    uninstallEnterpriseGateway,
    updateGatewayInstance,
    getIdentityAndPolicy,
    listIdentityPolicies,
    createIdentityPolicy,
    updateIdentityPolicy,
    evaluateEnterprisePolicy,
    getUsageAndBudget,
    listUsageAttribution,
    listBudgets,
    createBudget,
    updateBudget,
    evaluateEnterpriseBudget,
    getMembersAndAccess,
    listMemberships,
    upsertMembership,
    updateMembership,
    getOrgEntitlements,
    updateOrgEntitlements,
    getUsageEfficiency,
    getBillingAndInvoices,
    listInvoices,
    upsertBillingAccount,
    createInvoice,
    getDataGovernance,
    upsertProviderCompliance,
    listAuditEvents,
    exportAuditEvents,
    listProviderChannels,
    listModelRoutes,
    listGatewayApiKeys,
    listRequestLogs,
    listAgentMemories,
    applyPlatformEvent,
} satisfies EnterpriseControlPlane;
