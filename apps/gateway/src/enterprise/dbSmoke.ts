import type { EnterpriseBudgetEvaluationResult, EnterprisePolicyEvaluationResult, PlatformClaims } from '@elygate/enterprise-contracts';
import { readFile } from 'node:fs/promises';
import { db, sql as rawSql } from '@elygate/db';
import {
    enterpriseAuditEvents,
    enterpriseBudgets,
    enterpriseGatewayInstances,
    enterpriseIdentityPolicies,
} from '@elygate/db/schema';
import { eq } from '@elygate/db/operators';
import { AI_GATEWAY_SCOPES, ELYGATE_ENTERPRISE_MANIFEST } from '@elygate/enterprise-contracts';
import {
    applyPlatformEvent,
    createBudget,
    createIdentityPolicy,
    evaluateEnterpriseBudget,
    evaluateEnterprisePolicy,
    exportAuditEvents,
    installEnterpriseGateway,
    listAuditEvents,
    listGatewayInstances,
    uninstallEnterpriseGateway,
    updateGatewayInstance,
} from './controlPlane';

function describeDatabaseTarget(rawUrl: string | undefined): string {
    if (!rawUrl) return 'DATABASE_URL=<missing>';
    try {
        const url = new URL(rawUrl);
        return JSON.stringify({
            protocol: url.protocol,
            host: url.hostname,
            port: url.port || 'default',
            database: url.pathname.replace(/^\//, '') || null,
            username: url.username ? '<set>' : '<empty>',
            password: url.password ? '<set>' : '<empty>',
        });
    } catch {
        return 'DATABASE_URL=<invalid>';
    }
}

function sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://<redacted>@');
}

async function hasBaseSchema(): Promise<boolean> {
    const rows = await rawSql.unsafe("SELECT to_regclass('public.users')::text AS table_name");
    return Boolean(rows[0]?.table_name);
}

async function bootstrapFreshDatabaseIfNeeded(): Promise<void> {
    if (await hasBaseSchema()) return;

    const initSqlPath = new URL('../../../../packages/db/src/init.sql', import.meta.url);
    const initSql = await readFile(initSqlPath, 'utf8');
    console.log('[enterprise-db-smoke] base schema missing; applying packages/db/src/init.sql');
    await rawSql.unsafe(initSql);
    console.log('[enterprise-db-smoke] base schema bootstrap applied');
}

async function main() {
    console.log(`[enterprise-db-smoke] target ${describeDatabaseTarget(process.env.DATABASE_URL)}`);

    await bootstrapFreshDatabaseIfNeeded();

    await import('../../../../packages/db/src/migrate');
    console.log('[enterprise-db-smoke] migrations applied');

    const tenantId = `tenant_smoke_${Date.now()}`;
    const orgId = 'org_smoke';
    const appInstanceId = 'agi_smoke';
    const claims: PlatformClaims = {
        tenant_id: tenantId,
        org_id: orgId,
        app_id: ELYGATE_ENTERPRISE_MANIFEST.app_id,
        app_instance_id: appInstanceId,
        project_id: 'project_smoke',
        user_id: 'user_smoke',
        membership_id: 'membership_smoke',
        roles: ['owner'],
        scopes: Object.values(AI_GATEWAY_SCOPES),
        entitlements_version: 1,
        audience: 'http://localhost:3000',
    };

    async function cleanup() {
        await db.delete(enterpriseAuditEvents).where(eq(enterpriseAuditEvents.tenantId, tenantId));
        await db.delete(enterpriseBudgets).where(eq(enterpriseBudgets.tenantId, tenantId));
        await db.delete(enterpriseIdentityPolicies).where(eq(enterpriseIdentityPolicies.tenantId, tenantId));
        await db.delete(enterpriseGatewayInstances).where(eq(enterpriseGatewayInstances.tenantId, tenantId));
    }

    await cleanup();

    const meta = {
        ipAddress: '127.0.0.1',
        userAgent: 'elygate-enterprise-db-smoke',
    };

    try {
        const install = await installEnterpriseGateway({
            tenant_id: tenantId,
            org_id: orgId,
            project_id: 'project_smoke',
            app_instance_id: appInstanceId,
            public_base_url: 'https://gateway.smoke.local',
            admin_base_url: 'https://gateway.smoke.local/enterprise/',
            database_url_secret_name: 'elygate/smoke/database-url',
            supauth_issuer_url: 'https://auth.smoke.local',
            supauth_jwks_url: 'https://auth.smoke.local/.well-known/jwks.json',
            supauth_audience: 'https://gateway.smoke.local',
        }, claims, meta);

        const instance = install.instance as { id?: number | string; app_instance_id?: string };
        if (!instance.app_instance_id) throw new Error('install did not return a gateway instance projection');

        const updated = await updateGatewayInstance(claims, String(instance.id ?? appInstanceId), {
            status: 'active',
            entitlements_version: 2,
        }, meta) as { status?: string; entitlements_version?: number };
        if (updated.status !== 'active' || updated.entitlements_version !== 2) {
            throw new Error('gateway instance update did not persist expected values');
        }

        const list = await listGatewayInstances(claims) as { total?: number };
        if (list.total !== 1) throw new Error(`expected one gateway instance, got ${list.total ?? 'unknown'}`);

        const policy = await createIdentityPolicy(claims, {
            name: 'Smoke Policy',
            target_kind: 'org',
            effect: 'allow',
            rules: { models: ['*'], actions: ['request'] },
        }, meta) as { id?: number };
        if (!policy.id) throw new Error('identity policy create did not return an id');

        const allowedEvaluation = await evaluateEnterprisePolicy(claims, {
            action: 'request',
            model: 'gpt-4.1',
        }, meta) as EnterprisePolicyEvaluationResult;
        if (allowedEvaluation.decision !== 'allow') throw new Error('policy evaluation did not allow matching allow policy');

        const denyPolicy = await createIdentityPolicy(claims, {
            name: 'Smoke Deny Workspace',
            target_kind: 'external_workspace',
            target_id: 'workspace_blocked',
            effect: 'deny',
            rules: { models: ['gpt-4.1'], actions: ['request'] },
        }, meta) as { id?: number };
        if (!denyPolicy.id) throw new Error('deny policy create did not return an id');

        const deniedEvaluation = await evaluateEnterprisePolicy(claims, {
            action: 'request',
            model: 'gpt-4.1',
            external_workspace_id: 'workspace_blocked',
        }, meta) as EnterprisePolicyEvaluationResult;
        if (deniedEvaluation.decision !== 'deny' || !deniedEvaluation.deny_policy_ids?.includes(denyPolicy.id)) {
            throw new Error('policy evaluation did not apply deny-overrides');
        }

        const budget = await createBudget(claims, {
            subject_kind: 'org',
            period: 'monthly',
            limit_quota: 1000,
            used_quota: 100,
            alert_threshold_pct: 80,
        }, meta) as { id?: number; usage_percent?: number };
        if (!budget.id || budget.usage_percent !== 10) throw new Error('budget create did not return expected usage percent');

        const budgetWarning = await evaluateEnterpriseBudget(claims, {
            subject_kind: 'org',
            requested_quota: 750,
        }, meta) as EnterpriseBudgetEvaluationResult;
        if (budgetWarning.decision !== 'warn' || !budgetWarning.warning_budget_ids?.includes(budget.id)) {
            throw new Error('budget evaluation did not return warning threshold decision');
        }

        const budgetDenied = await evaluateEnterpriseBudget(claims, {
            subject_kind: 'org',
            requested_quota: 950,
        }, meta) as EnterpriseBudgetEvaluationResult;
        if (budgetDenied.decision !== 'deny' || !budgetDenied.blocking_budget_ids?.includes(budget.id)) {
            throw new Error('budget evaluation did not enforce budget limit');
        }

        const overdueBudget = await createBudget(claims, {
            subject_kind: 'api_key',
            subject_id: 'smoke_rollover_key',
            period: 'daily',
            limit_quota: 1000,
            used_quota: 950,
            alert_threshold_pct: 80,
            reset_at: '2026-01-01T00:00:00.000Z',
        }, meta) as { id?: number };
        if (!overdueBudget.id) throw new Error('overdue budget create did not return an id');

        const rolloverEvaluation = await evaluateEnterpriseBudget(claims, {
            subject_kind: 'api_key',
            subject_id: 'smoke_rollover_key',
            api_key_id: 'smoke_rollover_key',
            requested_quota: 50,
        }, meta) as EnterpriseBudgetEvaluationResult;
        const rolledOverMatch = rolloverEvaluation.matched_budgets.find((item) => item.id === overdueBudget.id);
        if (!rolledOverMatch || rolledOverMatch.used_quota !== 0 || rolloverEvaluation.decision !== 'allow') {
            throw new Error('budget rollover did not reset overdue usage before evaluation');
        }

        const action = await applyPlatformEvent({
            type: 'entitlements.changed',
            tenant_id: tenantId,
            org_id: orgId,
            app_id: ELYGATE_ENTERPRISE_MANIFEST.app_id,
            app_instance_id: appInstanceId,
            entitlements_version: 3,
        }, claims, meta);
        if (action.kind !== 'invalidate-entitlements') throw new Error(`unexpected projection action ${action.kind}`);

        const uninstall = await uninstallEnterpriseGateway({
            tenant_id: tenantId,
            org_id: orgId,
            app_id: ELYGATE_ENTERPRISE_MANIFEST.app_id,
            app_instance_id: appInstanceId,
            reason: 'smoke cleanup',
        }, claims, meta) as { status?: string; action?: { kind?: string } };
        if (uninstall.status !== 'deleted' || uninstall.action?.kind !== 'disable-instance') {
            throw new Error('uninstall callback did not mark instance deleted');
        }

        const audit = await listAuditEvents(claims) as { total?: number };
        if (!audit.total || audit.total < 10) throw new Error(`expected audit events, got ${audit.total ?? 0}`);

        const auditExport = await exportAuditEvents(claims, { action: 'budget.create' }) as { total?: number; content?: string };
        if (!auditExport.total || !auditExport.content?.includes('budget.create')) {
            throw new Error('audit export did not include filtered budget.create events');
        }

        console.log(`[enterprise-db-smoke] ok instances=${list.total} audits=${audit.total}`);
    } finally {
        if (process.env.KEEP_ENTERPRISE_SMOKE_DATA !== '1') await cleanup();
    }
}

try {
    await main();
} catch (error) {
    console.error(`[enterprise-db-smoke] failed: ${sanitizeError(error)}`);
    process.exit(1);
}
