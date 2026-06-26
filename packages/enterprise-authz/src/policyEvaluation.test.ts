import { describe, expect, test } from 'bun:test';
import type { PlatformClaims } from '@elygate/enterprise-contracts';
import { evaluateEnterprisePolicies } from './index';
import type { EnterprisePolicyRecord } from './index';

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

function policy(overrides: Partial<EnterprisePolicyRecord>): EnterprisePolicyRecord {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? 'policy',
    target_kind: overrides.target_kind ?? 'org',
    target_id: overrides.target_id ?? null,
    effect: overrides.effect ?? 'allow',
    rules: overrides.rules ?? {},
    status: overrides.status ?? 'active',
  };
}

describe('evaluateEnterprisePolicies', () => {
  test('denies when a matching deny policy exists even if an allow also matches', () => {
    const result = evaluateEnterprisePolicies(claims, { model: 'gpt-4.1', action: 'request' }, [
      policy({ id: 1, effect: 'allow', rules: { models: ['*'] } }),
      policy({ id: 2, effect: 'deny', rules: { models: ['gpt-4.1'], actions: ['request'] } }),
    ], scope);

    expect(result.decision).toBe('deny');
    expect(result.deny_policy_ids).toEqual([2]);
    expect(result.allow_policy_ids).toEqual([1]);
  });

  test('allows when only matching allow policies exist', () => {
    const result = evaluateEnterprisePolicies(claims, { model: 'claude-sonnet-4.5', external_workspace_id: 'workspace_a' }, [
      policy({ id: 3, effect: 'allow', target_kind: 'external_workspace', target_id: 'workspace_a', rules: { models: ['claude-sonnet-4.5'] } }),
    ], scope);

    expect(result.decision).toBe('allow');
    expect(result.allow_policy_ids).toEqual([3]);
    expect(result.matched_policies[0]?.matched_rules).toContain('target:external_workspace');
  });

  test('ignores inactive and non-matching policies before default allow', () => {
    const result = evaluateEnterprisePolicies(claims, { model: 'gpt-4.1' }, [
      policy({ id: 4, effect: 'deny', status: 'suspended', rules: { models: ['gpt-4.1'] } }),
      policy({ id: 5, effect: 'deny', target_kind: 'user', target_id: 'someone_else', rules: { models: ['gpt-4.1'] } }),
    ], scope);

    expect(result.decision).toBe('allow');
    expect(result.matched_policies).toHaveLength(0);
    expect(result.evaluated_policy_count).toBe(1);
  });
});
