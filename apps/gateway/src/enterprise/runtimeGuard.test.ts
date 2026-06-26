import { describe, expect, test } from 'bun:test';
import { ELYGATE_ENTERPRISE_MANIFEST } from '@elygate/enterprise-contracts';
import type {
    EnterpriseRuntimeGuardConfig,
    EnterpriseRuntimeGuardInput,
    EnterpriseRuntimeProjection,
    EnterpriseRuntimeProjectionReader,
    EnterpriseRuntimeUsageRecord,
} from './runtimeGuard';
import { createEnterpriseRuntimeSession, evaluateEnterpriseRuntimeGuard } from './runtimeGuard';

const activeConfig: EnterpriseRuntimeGuardConfig = {
    enabled: true,
    appId: ELYGATE_ENTERPRISE_MANIFEST.app_id,
    appInstanceId: 'agi_demo',
    tenantId: 'tenant_demo',
    orgId: 'org_demo',
    projectId: 'project_demo',
};

const baseInput: EnterpriseRuntimeGuardInput = {
    model: 'gpt-4.1',
    endpointType: 'chat',
    user: { id: 42, orgId: 7 },
    token: { id: 99, name: 'Production key' },
    userGroup: 'default',
    requestedQuota: 100,
    externalWorkspaceId: 'workspace_allowed',
    externalFeatureType: 'chat',
};

function projection(overrides: Partial<EnterpriseRuntimeProjection> = {}): EnterpriseRuntimeProjection {
    return {
        instance: { status: 'active', projectId: 'project_demo', entitlementsVersion: 3 },
        policies: [],
        budgets: [],
        ...overrides,
    };
}

function reader(value: EnterpriseRuntimeProjection): EnterpriseRuntimeProjectionReader {
    return async (claims) => {
        expect(claims.tenant_id).toBe(activeConfig.tenantId);
        expect(claims.org_id).toBe(activeConfig.orgId);
        expect(claims.app_instance_id).toBe(activeConfig.appInstanceId);
        expect(claims.token_kind).toBe('gateway-api-key');
        return value;
    };
}

describe('enterprise runtime guard', () => {
    test('is a no-op when enterprise data-plane identity is not configured', async () => {
        let called = false;
        const result = await evaluateEnterpriseRuntimeGuard(
            baseInput,
            async () => {
                called = true;
                return projection();
            },
            { ...activeConfig, enabled: false },
        );

        expect(result.enabled).toBe(false);
        expect(result.decision).toBe('disabled');
        expect(called).toBe(false);
    });

    test('denies requests when the gateway instance projection is not active', async () => {
        const result = await evaluateEnterpriseRuntimeGuard(
            baseInput,
            reader(projection({ instance: { status: 'suspended', projectId: 'project_demo', entitlementsVersion: 4 } })),
            activeConfig,
        );

        expect(result.enabled).toBe(true);
        expect(result.decision).toBe('deny');
        if (result.enabled) {
            expect(result.reason).toContain('suspended');
            expect(result.claims.entitlements_version).toBe(4);
        }
    });

    test('applies deny-overrides enterprise policies before budget decisions', async () => {
        const result = await evaluateEnterpriseRuntimeGuard(
            { ...baseInput, externalWorkspaceId: 'workspace_blocked' },
            reader(projection({
                policies: [
                    {
                        id: 1,
                        name: 'Allow model',
                        target_kind: 'org',
                        effect: 'allow',
                        rules: { models: ['gpt-4.1'], actions: ['request'], resources: ['ai.gateway.request'] },
                        status: 'active',
                    },
                    {
                        id: 2,
                        name: 'Deny workspace',
                        target_kind: 'external_workspace',
                        target_id: 'workspace_blocked',
                        effect: 'deny',
                        rules: { models: ['gpt-4.1'], actions: ['request'] },
                        status: 'active',
                    },
                ],
                budgets: [
                    {
                        id: 1,
                        subject_kind: 'org',
                        subject_id: 'org_demo',
                        period: 'monthly',
                        limit_quota: 1000,
                        used_quota: 100,
                        alert_threshold_pct: 80,
                        status: 'active',
                    },
                ],
            })),
            activeConfig,
        );

        expect(result.enabled).toBe(true);
        expect(result.decision).toBe('deny');
        if (result.enabled) {
            expect(result.policy.deny_policy_ids).toEqual([2]);
            expect(result.budget.decision).toBe('allow');
        }
    });

    test('returns warn when projected usage crosses budget alert threshold', async () => {
        const result = await evaluateEnterpriseRuntimeGuard(
            { ...baseInput, requestedQuota: 150 },
            reader(projection({
                budgets: [
                    {
                        id: 7,
                        subject_kind: 'org',
                        subject_id: 'org_demo',
                        period: 'monthly',
                        limit_quota: 1000,
                        used_quota: 700,
                        alert_threshold_pct: 80,
                        status: 'active',
                    },
                ],
            })),
            activeConfig,
        );

        expect(result.enabled).toBe(true);
        expect(result.decision).toBe('warn');
        if (result.enabled) {
            expect(result.budget.warning_budget_ids).toEqual([7]);
            expect(result.budget.matched_budgets[0]?.projected_quota).toBe(850);
        }
    });

    test('creates a usage session that records actual quota to every matched active budget', async () => {
        const result = await evaluateEnterpriseRuntimeGuard(
            { ...baseInput, requestedQuota: 150 },
            reader(projection({
                budgets: [
                    {
                        id: 7,
                        subject_kind: 'org',
                        subject_id: 'org_demo',
                        period: 'monthly',
                        limit_quota: 1000,
                        used_quota: 700,
                        alert_threshold_pct: 80,
                        status: 'active',
                    },
                    {
                        id: 8,
                        subject_kind: 'api_key',
                        subject_id: '99',
                        period: 'monthly',
                        limit_quota: 2000,
                        used_quota: 100,
                        alert_threshold_pct: 80,
                        status: 'active',
                    },
                ],
            })),
            activeConfig,
        );

        const records: EnterpriseRuntimeUsageRecord[] = [];
        const session = createEnterpriseRuntimeSession(baseInput, result, async (record) => {
            records.push(record);
        });

        expect(session).not.toBeNull();
        await session?.recordUsage({
            actualQuota: 123.8,
            promptTokens: 100,
            completionTokens: 23,
            cachedTokens: 0,
            statusCode: 200,
            channelId: 5,
            traceId: 'trace_usage',
            isStream: false,
        });

        expect(records).toHaveLength(1);
        expect(records[0]?.actualQuota).toBe(123);
        expect(records[0]?.budgetIds).toEqual([7, 8]);
        expect(records[0]?.claims.tenant_id).toBe('tenant_demo');
        expect(records[0]?.usage.traceId).toBe('trace_usage');
    });

    test('denies when projected usage exceeds an active budget limit', async () => {
        const result = await evaluateEnterpriseRuntimeGuard(
            { ...baseInput, requestedQuota: 250 },
            reader(projection({
                budgets: [
                    {
                        id: 9,
                        subject_kind: 'api_key',
                        subject_id: '99',
                        period: 'monthly',
                        limit_quota: 1000,
                        used_quota: 800,
                        alert_threshold_pct: 80,
                        status: 'active',
                    },
                ],
            })),
            activeConfig,
        );

        expect(result.enabled).toBe(true);
        expect(result.decision).toBe('deny');
        if (result.enabled) {
            expect(result.budget.blocking_budget_ids).toEqual([9]);
            expect(result.policy.decision).toBe('allow');
        }

        const session = createEnterpriseRuntimeSession(baseInput, result, async () => {
            throw new Error('deny results must not record usage');
        });
        expect(session).toBeNull();
    });
});
