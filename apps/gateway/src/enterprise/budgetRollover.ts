import type { PlatformClaims } from '@elygate/enterprise-contracts';
import { db } from '@elygate/db';
import { enterpriseAuditEvents, enterpriseBudgets } from '@elygate/db/schema';
import { advanceEnterpriseBudgetResetAt, calculateNextEnterpriseBudgetResetAt } from '@elygate/enterprise-authz';
import { and, eq, isNotNull, lte } from 'drizzle-orm';

type JsonObject = Record<string, unknown>;

export type EnterpriseBudgetRolloverMeta = {
    readonly ipAddress?: string;
    readonly userAgent?: string;
};

export type EnterpriseBudgetRolloverOptions = {
    readonly appInstanceOnly?: boolean;
    readonly audit?: boolean;
    readonly meta?: EnterpriseBudgetRolloverMeta;
    readonly now?: Date;
    readonly updatedBy?: string;
};

export type EnterpriseBudgetRolloverResult = {
    readonly rolled_over: number;
    readonly budget_ids: readonly number[];
};

function actorId(claims: PlatformClaims): string {
    return claims.user_id ?? claims.service_account_id ?? claims.subject ?? 'enterprise-budget-rollover';
}

function actorType(claims: PlatformClaims): 'user' | 'service_account' | 'system' {
    if (claims.service_account_id) return 'service_account';
    if (claims.user_id) return 'user';
    return 'system';
}

function rolloverDetails(
    row: typeof enterpriseBudgets.$inferSelect,
    nextResetAt: Date | null,
    now: Date,
): JsonObject {
    return {
        period: row.period,
        subject_kind: row.subjectKind,
        subject_id: row.subjectId,
        previous_used_quota: Number(row.usedQuota || 0),
        previous_reset_at: row.resetAt?.toISOString() ?? null,
        next_reset_at: nextResetAt?.toISOString() ?? null,
        rolled_over_at: now.toISOString(),
    };
}

export function nextEnterpriseBudgetResetAt(period: string, now = new Date()): Date | null {
    return calculateNextEnterpriseBudgetResetAt(now, period);
}

export async function rolloverDueEnterpriseBudgets(
    claims: PlatformClaims,
    options: EnterpriseBudgetRolloverOptions = {},
): Promise<EnterpriseBudgetRolloverResult> {
    const now = options.now ?? new Date();
    const appScope = options.appInstanceOnly ? eq(enterpriseBudgets.appInstanceId, claims.app_instance_id) : undefined;
    const dueWhere = and(
        eq(enterpriseBudgets.tenantId, claims.tenant_id),
        eq(enterpriseBudgets.orgId, claims.org_id),
        appScope,
        eq(enterpriseBudgets.status, 'active'),
        isNotNull(enterpriseBudgets.resetAt),
        lte(enterpriseBudgets.resetAt, now),
    );

    const dueRows = await db.select()
        .from(enterpriseBudgets)
        .where(dueWhere);

    const rolledOverIds: number[] = [];
    for (const row of dueRows) {
        if (!row.resetAt) continue;
        const nextResetAt = advanceEnterpriseBudgetResetAt(row.resetAt, row.period, now);
        const [updated] = await db.update(enterpriseBudgets)
            .set({
                usedQuota: 0,
                resetAt: nextResetAt,
                updatedAt: now,
                updatedBy: options.updatedBy ?? actorId(claims),
            })
            .where(and(
                eq(enterpriseBudgets.id, row.id),
                eq(enterpriseBudgets.tenantId, claims.tenant_id),
                eq(enterpriseBudgets.orgId, claims.org_id),
                eq(enterpriseBudgets.appInstanceId, row.appInstanceId),
                eq(enterpriseBudgets.status, 'active'),
                eq(enterpriseBudgets.resetAt, row.resetAt),
            ))
            .returning();

        if (!updated) continue;
        rolledOverIds.push(updated.id);

        if (options.audit ?? true) {
            await db.insert(enterpriseAuditEvents).values({
                tenantId: claims.tenant_id,
                orgId: claims.org_id,
                appInstanceId: updated.appInstanceId,
                actorType: actorType(claims),
                actorId: actorId(claims),
                action: 'budget.rollover',
                resource: 'budget',
                resourceId: String(updated.id),
                details: rolloverDetails(row, nextResetAt, now),
                ipAddress: options.meta?.ipAddress ?? null,
                userAgent: options.meta?.userAgent ?? null,
            });
        }
    }

    return {
        rolled_over: rolledOverIds.length,
        budget_ids: rolledOverIds,
    };
}
