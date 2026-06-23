import { describe, expect, test } from 'bun:test';
import type { PlatformClaims } from '@elygate/enterprise-contracts';
import { advanceEnterpriseBudgetResetAt, calculateNextEnterpriseBudgetResetAt, evaluateEnterpriseBudgets } from './index';
import type { EnterpriseBudgetRecord } from './index';

const claims: PlatformClaims = {
  tenant_id: 'tenant_demo',
  org_id: 'org_demo',
  app_id: 'elygate-ai-gateway',
  app_instance_id: 'agi_demo',
  project_id: 'project_demo',
  user_id: 'user_demo',
  roles: ['developer'],
  scopes: ['ai.gateway.read'],
  entitlements_version: 1,
};

const scope = {
  scope_kind: 'gateway_instance' as const,
  tenant_id: claims.tenant_id,
  org_id: claims.org_id,
  app_instance_id: claims.app_instance_id,
  project_id: claims.project_id,
};

function budget(overrides: Partial<EnterpriseBudgetRecord>): EnterpriseBudgetRecord {
  return {
    id: overrides.id ?? 1,
    subject_kind: overrides.subject_kind ?? 'org',
    subject_id: overrides.subject_id ?? null,
    period: overrides.period ?? 'monthly',
    limit_quota: overrides.limit_quota ?? 1000,
    used_quota: overrides.used_quota ?? 0,
    alert_threshold_pct: overrides.alert_threshold_pct ?? 80,
    status: overrides.status ?? 'active',
    reset_at: overrides.reset_at ?? null,
  };
}

describe('evaluateEnterpriseBudgets', () => {
  test('denies when projected quota exceeds a matching active budget', () => {
    const result = evaluateEnterpriseBudgets(claims, { requested_quota: 50 }, [
      budget({ id: 1, subject_kind: 'org', subject_id: 'org_demo', limit_quota: 1000, used_quota: 980 }),
    ], scope);

    expect(result.decision).toBe('deny');
    expect(result.blocking_budget_ids).toEqual([1]);
    expect(result.matched_budgets[0]?.projected_quota).toBe(1030);
  });

  test('warns when projected usage reaches the alert threshold but remains under limit', () => {
    const result = evaluateEnterpriseBudgets(claims, { requested_quota: 100, user_id: 'user_demo' }, [
      budget({ id: 2, subject_kind: 'user', subject_id: 'user_demo', limit_quota: 1000, used_quota: 700, alert_threshold_pct: 80 }),
    ], scope);

    expect(result.decision).toBe('warn');
    expect(result.warning_budget_ids).toEqual([2]);
    expect(result.blocking_budget_ids).toEqual([]);
    expect(result.matched_budgets[0]?.projected_usage_percent).toBe(80);
  });

  test('ignores inactive and non-matching budgets before default allow', () => {
    const result = evaluateEnterpriseBudgets(claims, { requested_quota: 200, external_workspace_id: 'workspace_demo' }, [
      budget({ id: 3, subject_kind: 'external_workspace', subject_id: 'workspace_demo', status: 'suspended', used_quota: 990 }),
      budget({ id: 4, subject_kind: 'project', subject_id: 'project_other', used_quota: 990 }),
    ], scope);

    expect(result.decision).toBe('allow');
    expect(result.matched_budgets).toHaveLength(0);
    expect(result.evaluated_budget_count).toBe(1);
  });

  test('calculates period reset anchors and advances overdue windows', () => {
    expect(calculateNextEnterpriseBudgetResetAt(new Date('2026-06-20T10:15:00.000Z'), 'daily')?.toISOString())
      .toBe('2026-06-21T00:00:00.000Z');
    expect(calculateNextEnterpriseBudgetResetAt(new Date('2026-06-20T10:15:00.000Z'), 'monthly')?.toISOString())
      .toBe('2026-07-01T00:00:00.000Z');
    expect(calculateNextEnterpriseBudgetResetAt(new Date('2026-06-20T10:15:00.000Z'), 'never')).toBeNull();

    expect(advanceEnterpriseBudgetResetAt(
      '2026-05-01T00:00:00.000Z',
      'monthly',
      new Date('2026-06-20T10:15:00.000Z'),
    )?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});
