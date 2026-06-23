import { AI_GATEWAY_SCOPES, ELYGATE_ENTERPRISE_MANIFEST } from '@elygate/enterprise-contracts';
import type {
    EnterpriseBudgetEvaluationInput,
    EnterpriseBudgetEvaluationResult,
    EnterprisePolicyEvaluationInput,
    EnterprisePolicyEvaluationResult,
    PlatformClaims,
} from '@elygate/enterprise-contracts';
import { db } from '@elygate/db';
import {
    enterpriseAuditEvents,
    enterpriseBudgets,
    enterpriseGatewayInstances,
    enterpriseIdentityPolicies,
} from '@elygate/db/schema';
import { evaluateEnterpriseBudgets, evaluateEnterprisePolicies } from '@elygate/enterprise-authz';
import type { EnterpriseBudgetRecord, EnterprisePolicyRecord } from '@elygate/enterprise-authz';
import { and, desc, eq, sql as drizzleSql } from 'drizzle-orm';
import { log } from '../services/logger';
import { setRuntimeGovernanceGuard } from '../services/runtimeGovernance';
import type { RuntimeGovernanceSession, RuntimeGovernanceUsage } from '../services/runtimeGovernance';
import type { TokenRecord, UserRecord } from '../types';
import { rolloverDueEnterpriseBudgets } from './budgetRollover';
import { enterpriseRuntimeConfig } from './config';

export type EnterpriseRuntimeGuardInput = {
    readonly model: string;
    readonly endpointType: string;
    readonly user: Pick<UserRecord, 'id' | 'orgId'>;
    readonly token: Pick<TokenRecord, 'id' | 'name'>;
    readonly userGroup: string;
    readonly requestedQuota: number;
    readonly ip?: string;
    readonly ua?: string;
    readonly externalTaskId?: string;
    readonly externalUserId?: string;
    readonly externalWorkspaceId?: string;
    readonly externalFeatureType?: string;
};

export type EnterpriseRuntimeGuardConfig = {
    readonly enabled: boolean;
    readonly appId: string;
    readonly appInstanceId: string;
    readonly tenantId: string;
    readonly orgId: string;
    readonly projectId?: string;
};

export type EnterpriseRuntimeGatewayInstance = {
    readonly status: string;
    readonly projectId?: string | null;
    readonly entitlementsVersion: number;
};

export type EnterpriseRuntimeProjection = {
    readonly instance: EnterpriseRuntimeGatewayInstance | null;
    readonly policies: readonly EnterprisePolicyRecord[];
    readonly budgets: readonly EnterpriseBudgetRecord[];
};

export type EnterpriseRuntimeProjectionReader = (claims: PlatformClaims) => Promise<EnterpriseRuntimeProjection>;

export type EnterpriseRuntimeGuardDecision =
    | {
        readonly enabled: false;
        readonly decision: 'disabled';
        readonly reason: string;
    }
    | {
        readonly enabled: true;
        readonly decision: 'allow' | 'warn' | 'deny';
        readonly reason: string;
        readonly claims: PlatformClaims;
        readonly policy: EnterprisePolicyEvaluationResult;
        readonly budget: EnterpriseBudgetEvaluationResult;
    };

export type EnterpriseRuntimeUsageRecord = {
    readonly claims: PlatformClaims;
    readonly input: EnterpriseRuntimeGuardInput;
    readonly budgetIds: readonly number[];
    readonly usage: RuntimeGovernanceUsage;
    readonly actualQuota: number;
};

export type EnterpriseRuntimeUsageWriter = (record: EnterpriseRuntimeUsageRecord) => Promise<void>;

function consumableBudgetIds(result: EnterpriseRuntimeGuardDecision): readonly number[] {
    if (!result.enabled || result.decision === 'deny') return [];
    return result.budget.matched_budgets.map((budget) => budget.id);
}

const DATA_PLANE_ROLE = 'gateway_api_key';

function runtimeGuardScope(claims: PlatformClaims) {
    return {
        scope_kind: 'gateway_instance' as const,
        tenant_id: claims.tenant_id,
        org_id: claims.org_id,
        app_instance_id: claims.app_instance_id,
        project_id: claims.project_id ?? null,
    };
}

function guardConfigured(config: EnterpriseRuntimeGuardConfig): boolean {
    return config.enabled
        && Boolean(config.tenantId)
        && Boolean(config.orgId)
        && Boolean(config.appInstanceId);
}

function dataPlaneClaims(input: EnterpriseRuntimeGuardInput, config: EnterpriseRuntimeGuardConfig): PlatformClaims {
    return {
        tenant_id: config.tenantId,
        org_id: config.orgId,
        app_id: config.appId || ELYGATE_ENTERPRISE_MANIFEST.app_id,
        app_instance_id: config.appInstanceId,
        project_id: config.projectId,
        user_id: String(input.user.id),
        roles: [DATA_PLANE_ROLE, input.userGroup].filter(Boolean),
        scopes: [AI_GATEWAY_SCOPES.gatewayRead],
        entitlements_version: 0,
        token_kind: 'gateway-api-key',
        subject: `gateway-api-key:${input.token.id}`,
    };
}

function policyInput(input: EnterpriseRuntimeGuardInput): EnterprisePolicyEvaluationInput {
    return {
        action: 'request',
        resource: 'ai.gateway.request',
        model: input.model,
        api_key_id: input.token.id,
        user_id: String(input.user.id),
        external_user_id: input.externalUserId,
        external_workspace_id: input.externalWorkspaceId,
        external_feature_type: input.externalFeatureType,
        roles: [DATA_PLANE_ROLE, input.userGroup].filter(Boolean),
        scopes: [AI_GATEWAY_SCOPES.gatewayRead],
        metadata: {
            token_name: input.token.name,
            token_id: input.token.id,
            endpoint_type: input.endpointType,
            user_org_id: input.user.orgId ?? null,
            external_task_id: input.externalTaskId ?? null,
        },
    };
}

function budgetInput(input: EnterpriseRuntimeGuardInput): EnterpriseBudgetEvaluationInput {
    return {
        action: 'request',
        model: input.model,
        requested_quota: Math.max(0, input.requestedQuota),
        api_key_id: input.token.id,
        user_id: String(input.user.id),
        external_user_id: input.externalUserId,
        external_workspace_id: input.externalWorkspaceId,
        external_feature_type: input.externalFeatureType,
        metadata: {
            endpoint_type: input.endpointType,
            user_group: input.userGroup,
            external_task_id: input.externalTaskId ?? null,
        },
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

export async function postgresEnterpriseRuntimeProjectionReader(claims: PlatformClaims): Promise<EnterpriseRuntimeProjection> {
    await rolloverDueEnterpriseBudgets(claims, {
        appInstanceOnly: true,
        updatedBy: 'enterprise-runtime-guard',
    });

    const instanceWhere = and(
        eq(enterpriseGatewayInstances.tenantId, claims.tenant_id),
        eq(enterpriseGatewayInstances.orgId, claims.org_id),
        eq(enterpriseGatewayInstances.appId, claims.app_id),
        eq(enterpriseGatewayInstances.appInstanceId, claims.app_instance_id),
    );

    const projectionWhere = and(
        eq(enterpriseIdentityPolicies.tenantId, claims.tenant_id),
        eq(enterpriseIdentityPolicies.orgId, claims.org_id),
        eq(enterpriseIdentityPolicies.appInstanceId, claims.app_instance_id),
    );

    const budgetWhere = and(
        eq(enterpriseBudgets.tenantId, claims.tenant_id),
        eq(enterpriseBudgets.orgId, claims.org_id),
        eq(enterpriseBudgets.appInstanceId, claims.app_instance_id),
    );

    const [[instance], policyRows, budgetRows] = await Promise.all([
        db.select({
            status: enterpriseGatewayInstances.status,
            projectId: enterpriseGatewayInstances.projectId,
            entitlementsVersion: enterpriseGatewayInstances.entitlementsVersion,
        })
            .from(enterpriseGatewayInstances)
            .where(instanceWhere)
            .limit(1),
        db.select()
            .from(enterpriseIdentityPolicies)
            .where(projectionWhere)
            .orderBy(desc(enterpriseIdentityPolicies.updatedAt), desc(enterpriseIdentityPolicies.id)),
        db.select()
            .from(enterpriseBudgets)
            .where(budgetWhere)
            .orderBy(desc(enterpriseBudgets.updatedAt), desc(enterpriseBudgets.id)),
    ]);

    return {
        instance: instance ?? null,
        policies: policyRows.map(toPolicyRecord),
        budgets: budgetRows.map(toBudgetRecord),
    };
}

async function recordRuntimeGuardAudit(
    claims: PlatformClaims,
    input: EnterpriseRuntimeGuardInput,
    decision: 'warn' | 'deny',
    reason: string,
    policy: EnterprisePolicyEvaluationResult,
    budget: EnterpriseBudgetEvaluationResult,
): Promise<void> {
    await db.insert(enterpriseAuditEvents).values({
        tenantId: claims.tenant_id,
        orgId: claims.org_id,
        appInstanceId: claims.app_instance_id,
        actorType: 'gateway_api_key',
        actorId: String(input.token.id),
        action: `runtime_guard.${decision}`,
        resource: 'ai.gateway.request',
        resourceId: input.model,
        details: {
            decision,
            reason,
            model: input.model,
            endpoint_type: input.endpointType,
            user_id: input.user.id,
            token_id: input.token.id,
            requested_quota: input.requestedQuota,
            policy_decision: policy.decision,
            budget_decision: budget.decision,
            deny_policy_ids: policy.deny_policy_ids,
            blocking_budget_ids: budget.blocking_budget_ids,
            warning_budget_ids: budget.warning_budget_ids,
            external_task_id: input.externalTaskId ?? null,
            external_user_id: input.externalUserId ?? null,
            external_workspace_id: input.externalWorkspaceId ?? null,
            external_feature_type: input.externalFeatureType ?? null,
        },
        ipAddress: input.ip ?? null,
        userAgent: input.ua ?? null,
    });
}

export async function evaluateEnterpriseRuntimeGuard(
    input: EnterpriseRuntimeGuardInput,
    reader: EnterpriseRuntimeProjectionReader = postgresEnterpriseRuntimeProjectionReader,
    config: EnterpriseRuntimeGuardConfig = enterpriseRuntimeConfig,
): Promise<EnterpriseRuntimeGuardDecision> {
    if (!guardConfigured(config)) {
        return {
            enabled: false,
            decision: 'disabled',
            reason: 'Enterprise runtime guard is not configured for this gateway instance',
        };
    }

    const baseClaims = dataPlaneClaims(input, config);
    const projection = await reader(baseClaims);
    if (!projection.instance) {
        const emptyPolicy = evaluateEnterprisePolicies(baseClaims, policyInput(input), [], runtimeGuardScope(baseClaims));
        const emptyBudget = evaluateEnterpriseBudgets(baseClaims, budgetInput(input), [], runtimeGuardScope(baseClaims));
        return {
            enabled: true,
            decision: 'deny',
            reason: `Enterprise gateway instance ${baseClaims.app_instance_id} is not installed`,
            claims: baseClaims,
            policy: emptyPolicy,
            budget: emptyBudget,
        };
    }

    const claims: PlatformClaims = {
        ...baseClaims,
        project_id: baseClaims.project_id ?? projection.instance.projectId ?? undefined,
        entitlements_version: projection.instance.entitlementsVersion,
    };

    if (projection.instance.status !== 'active') {
        const emptyPolicy = evaluateEnterprisePolicies(claims, policyInput(input), projection.policies, runtimeGuardScope(claims));
        const emptyBudget = evaluateEnterpriseBudgets(claims, budgetInput(input), projection.budgets, runtimeGuardScope(claims));
        return {
            enabled: true,
            decision: 'deny',
            reason: `Enterprise gateway instance ${claims.app_instance_id} is ${projection.instance.status}`,
            claims,
            policy: emptyPolicy,
            budget: emptyBudget,
        };
    }

    const policy = evaluateEnterprisePolicies(
        claims,
        policyInput(input),
        projection.policies,
        runtimeGuardScope(claims),
    );
    if (policy.decision === 'deny') {
        return {
            enabled: true,
            decision: 'deny',
            reason: policy.reason,
            claims,
            policy,
            budget: evaluateEnterpriseBudgets(claims, budgetInput(input), projection.budgets, runtimeGuardScope(claims)),
        };
    }

    const budget = evaluateEnterpriseBudgets(
        claims,
        budgetInput(input),
        projection.budgets,
        runtimeGuardScope(claims),
    );

    return {
        enabled: true,
        decision: budget.decision === 'deny' ? 'deny' : budget.decision === 'warn' ? 'warn' : 'allow',
        reason: budget.decision === 'allow' ? policy.reason : budget.reason,
        claims,
        policy,
        budget,
    };
}

export async function enforceEnterpriseRuntimeGuard(input: EnterpriseRuntimeGuardInput): Promise<EnterpriseRuntimeGuardDecision> {
    let result: EnterpriseRuntimeGuardDecision;
    try {
        result = await evaluateEnterpriseRuntimeGuard(input);
    } catch (error) {
        log.error('[EnterpriseRuntimeGuard] Projection lookup failed:', error instanceof Error ? error.message : String(error));
        throw new Error('HTTP 503 Service Unavailable: Enterprise runtime guard is unavailable');
    }

    if (!result.enabled) return result;

    if (result.decision === 'warn') {
        log.warn(`[EnterpriseRuntimeGuard] ${result.reason}`);
        recordRuntimeGuardAudit(result.claims, input, 'warn', result.reason, result.policy, result.budget)
            .catch((error: unknown) => log.warn('[EnterpriseRuntimeGuard] Audit warning failed:', error instanceof Error ? error.message : String(error)));
        return result;
    }

    if (result.decision === 'deny') {
        await recordRuntimeGuardAudit(result.claims, input, 'deny', result.reason, result.policy, result.budget)
            .catch((error: unknown) => log.warn('[EnterpriseRuntimeGuard] Audit deny failed:', error instanceof Error ? error.message : String(error)));
        throw new Error(`HTTP 403 Forbidden: ${result.reason}`);
    }

    return result;
}

export async function postgresEnterpriseRuntimeUsageWriter(record: EnterpriseRuntimeUsageRecord): Promise<void> {
    await rolloverDueEnterpriseBudgets(record.claims, {
        appInstanceOnly: true,
        updatedBy: `gateway-api-key:${record.input.token.id}`,
    });

    await Promise.all(record.budgetIds.map((budgetId) => db.update(enterpriseBudgets)
        .set({
            usedQuota: drizzleSql`${enterpriseBudgets.usedQuota} + ${record.actualQuota}`,
            updatedAt: new Date(),
        })
        .where(and(
            eq(enterpriseBudgets.id, budgetId),
            eq(enterpriseBudgets.tenantId, record.claims.tenant_id),
            eq(enterpriseBudgets.orgId, record.claims.org_id),
            eq(enterpriseBudgets.appInstanceId, record.claims.app_instance_id),
            eq(enterpriseBudgets.status, 'active'),
        ))));
}

async function recordEnterpriseRuntimeUsage(
    input: EnterpriseRuntimeGuardInput,
    result: EnterpriseRuntimeGuardDecision,
    usage: RuntimeGovernanceUsage,
    writer: EnterpriseRuntimeUsageWriter,
): Promise<void> {
    const actualQuota = Math.max(0, Math.trunc(usage.actualQuota));
    if (actualQuota <= 0 || !result.enabled) return;

    const budgetIds = consumableBudgetIds(result);
    if (budgetIds.length === 0) return;

    await writer({
        claims: result.claims,
        input,
        budgetIds,
        usage,
        actualQuota,
    });

    log.info(`[EnterpriseRuntimeGuard] Recorded quota ${actualQuota} for budgets ${budgetIds.join(', ')} token=${input.token.id} model=${input.model}`);
}

export function createEnterpriseRuntimeSession(
    input: EnterpriseRuntimeGuardInput,
    result: EnterpriseRuntimeGuardDecision,
    writer: EnterpriseRuntimeUsageWriter = postgresEnterpriseRuntimeUsageWriter,
): RuntimeGovernanceSession | null {
    if (!result.enabled || consumableBudgetIds(result).length === 0) return null;
    return {
        recordUsage: (usage) => recordEnterpriseRuntimeUsage(input, result, usage, writer),
    };
}

export function installEnterpriseRuntimeGuard(): void {
    setRuntimeGovernanceGuard(async (input) => {
        const result = await enforceEnterpriseRuntimeGuard(input);
        return createEnterpriseRuntimeSession(input, result);
    });
}
