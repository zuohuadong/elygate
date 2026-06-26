import { AI_GATEWAY_SCOPES, normalizePlatformClaims } from '@elygate/enterprise-contracts';
import type {
  AiGatewayScope,
  EnterpriseBudgetDecision,
  EnterpriseBudgetEvaluationInput,
  EnterpriseBudgetEvaluationMatch,
  EnterpriseBudgetEvaluationResult,
  EnterprisePolicyEffect,
  EnterprisePolicyEvaluationInput,
  EnterprisePolicyEvaluationMatch,
  EnterprisePolicyEvaluationResult,
  PlatformClaims,
} from '@elygate/enterprise-contracts';

export type EnterpriseAuthFailureCode =
  | 'missing_authorization'
  | 'invalid_authorization'
  | 'invalid_token'
  | 'invalid_claims'
  | 'insufficient_scope';

export type EnterpriseAuthSuccess = {
  readonly ok: true;
  readonly claims: PlatformClaims;
};

export type EnterpriseAuthFailure = {
  readonly ok: false;
  readonly code: EnterpriseAuthFailureCode;
  readonly message: string;
};

export type EnterpriseAuthResult = EnterpriseAuthSuccess | EnterpriseAuthFailure;

export type EnterpriseTokenVerifier = (token: string) => Promise<unknown> | unknown;

export type EnterpriseAuthorizerOptions = {
  readonly verifyToken: EnterpriseTokenVerifier;
  readonly requiredScopes?: readonly AiGatewayScope[];
};

export type SupAuthJwtVerifierOptions = {
  readonly issuer?: string;
  readonly audience?: string;
  readonly jwksUrl?: string;
  readonly allowUnverifiedDevTokens?: boolean;
  readonly now?: () => number;
  readonly fetchJwks?: (url: string) => Promise<unknown>;
};

type JwtHeader = {
  readonly alg?: string;
  readonly kid?: string;
  readonly typ?: string;
};

type JwkRecord = JsonObject & {
  readonly kid?: string;
  readonly alg?: string;
  readonly kty?: string;
  readonly use?: string;
};

type JwksResponse = {
  readonly keys?: readonly JwkRecord[];
};

type JsonObject = Record<string, unknown>;

export function parseBearerToken(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export function hasScope(claims: Pick<PlatformClaims, 'scopes'>, scope: AiGatewayScope): boolean {
  return claims.scopes.includes(AI_GATEWAY_SCOPES.gatewayAdmin) || claims.scopes.includes(scope);
}

export function hasEveryScope(claims: Pick<PlatformClaims, 'scopes'>, scopes: readonly AiGatewayScope[]): boolean {
  return scopes.every((scope) => hasScope(claims, scope));
}

export function hasAnyRole(claims: Pick<PlatformClaims, 'roles'>, roles: readonly string[]): boolean {
  return roles.some((role) => claims.roles.includes(role));
}

export function assertScopes(claims: PlatformClaims, scopes: readonly AiGatewayScope[]): void {
  if (!hasEveryScope(claims, scopes)) {
    throw new Error(`Missing Elygate Enterprise scope: ${scopes.join(', ')}`);
  }
}

export type EnterprisePolicyRecord = {
  readonly id: number;
  readonly name: string;
  readonly target_kind: string;
  readonly target_id?: string | null;
  readonly effect: string;
  readonly rules: Record<string, unknown>;
  readonly status?: string;
};

export type EnterprisePolicyEvaluationScope = EnterprisePolicyEvaluationResult['scope'];

export type EnterpriseBudgetRecord = {
  readonly id: number;
  readonly subject_kind: string;
  readonly subject_id?: string | null;
  readonly period: string;
  readonly limit_quota: number;
  readonly used_quota: number;
  readonly alert_threshold_pct: number;
  readonly status?: string;
  readonly reset_at?: string | null;
};

export type EnterpriseBudgetEvaluationScope = EnterpriseBudgetEvaluationResult['scope'];

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (typeof value === 'string' && value.trim()) return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function firstRuleArray(rules: Record<string, unknown>, keys: readonly string[]): readonly string[] {
  for (const key of keys) {
    const values = readStringArray(rules[key]);
    if (values.length) return values;
  }
  return [];
}

function candidateValues(...values: readonly unknown[]): readonly string[] {
  return values.flatMap((value) => readStringArray(value)).filter(Boolean);
}

function readFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

export const ENTERPRISE_BUDGET_RESET_PERIODS = {
  hourly: 'hourly',
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
  yearly: 'yearly',
  never: 'never',
} as const;

export type EnterpriseBudgetResetPeriod = (typeof ENTERPRISE_BUDGET_RESET_PERIODS)[keyof typeof ENTERPRISE_BUDGET_RESET_PERIODS];

export function normalizeEnterpriseBudgetResetPeriod(period: string | null | undefined): EnterpriseBudgetResetPeriod {
  const normalized = String(period || '').trim().toLowerCase();
  switch (normalized) {
    case ENTERPRISE_BUDGET_RESET_PERIODS.hourly:
    case ENTERPRISE_BUDGET_RESET_PERIODS.daily:
    case ENTERPRISE_BUDGET_RESET_PERIODS.weekly:
    case ENTERPRISE_BUDGET_RESET_PERIODS.monthly:
    case ENTERPRISE_BUDGET_RESET_PERIODS.quarterly:
    case ENTERPRISE_BUDGET_RESET_PERIODS.yearly:
    case ENTERPRISE_BUDGET_RESET_PERIODS.never:
      return normalized;
    default:
      return ENTERPRISE_BUDGET_RESET_PERIODS.monthly;
  }
}

function startOfNextHour(base: Date): Date {
  const next = new Date(base);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

function startOfNextDay(base: Date): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + 1, 0, 0, 0, 0));
}

function startOfNextWeek(base: Date): Date {
  const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0));
  const weekday = next.getUTCDay() === 0 ? 7 : next.getUTCDay();
  next.setUTCDate(next.getUTCDate() + (8 - weekday));
  return next;
}

function startOfNextMonth(base: Date): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function startOfNextQuarter(base: Date): Date {
  const nextQuarterMonth = Math.floor(base.getUTCMonth() / 3) * 3 + 3;
  return new Date(Date.UTC(base.getUTCFullYear(), nextQuarterMonth, 1, 0, 0, 0, 0));
}

function startOfNextYear(base: Date): Date {
  return new Date(Date.UTC(base.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0));
}

function parseResetDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return null;
}

export function calculateNextEnterpriseBudgetResetAt(base: Date, period: string | null | undefined): Date | null {
  switch (normalizeEnterpriseBudgetResetPeriod(period)) {
    case ENTERPRISE_BUDGET_RESET_PERIODS.hourly:
      return startOfNextHour(base);
    case ENTERPRISE_BUDGET_RESET_PERIODS.daily:
      return startOfNextDay(base);
    case ENTERPRISE_BUDGET_RESET_PERIODS.weekly:
      return startOfNextWeek(base);
    case ENTERPRISE_BUDGET_RESET_PERIODS.monthly:
      return startOfNextMonth(base);
    case ENTERPRISE_BUDGET_RESET_PERIODS.quarterly:
      return startOfNextQuarter(base);
    case ENTERPRISE_BUDGET_RESET_PERIODS.yearly:
      return startOfNextYear(base);
    case ENTERPRISE_BUDGET_RESET_PERIODS.never:
      return null;
    default:
      return startOfNextMonth(base);
  }
}

export function advanceEnterpriseBudgetResetAt(
  resetAt: Date | string | null | undefined,
  period: string | null | undefined,
  now = new Date(),
): Date | null {
  const current = parseResetDate(resetAt);
  if (!current) return calculateNextEnterpriseBudgetResetAt(now, period);
  if (current > now) return current;

  let next = calculateNextEnterpriseBudgetResetAt(current, period);
  let cycles = 0;
  while (next && next <= now) {
    next = calculateNextEnterpriseBudgetResetAt(next, period);
    cycles += 1;
    if (cycles > 1000) return calculateNextEnterpriseBudgetResetAt(now, period);
  }
  return next;
}

function matchesAnyRule(ruleValues: readonly string[], candidates: readonly string[]): boolean {
  if (!ruleValues.length) return true;
  if (ruleValues.includes('*')) return true;
  if (!candidates.length) return false;
  return candidates.some((candidate) => ruleValues.includes(candidate));
}

function ruleMatched(rules: Record<string, unknown>, keys: readonly string[], candidates: readonly string[], label: string, matches: string[]): boolean {
  const values = firstRuleArray(rules, keys);
  if (!values.length) return true;
  if (!matchesAnyRule(values, candidates)) return false;
  matches.push(label);
  return true;
}

function targetMatches(policy: EnterprisePolicyRecord, claims: PlatformClaims, input: EnterprisePolicyEvaluationInput): boolean {
  const targetKind = policy.target_kind || 'org';
  const targetId = readString(policy.target_id);
  if (!targetId || targetId === '*') return true;

  switch (targetKind) {
    case 'org':
      return targetId === claims.org_id;
    case 'tenant':
      return targetId === claims.tenant_id;
    case 'app_instance':
      return targetId === claims.app_instance_id;
    case 'project':
      return targetId === (input.project_id ?? claims.project_id);
    case 'user':
      return targetId === (input.user_id ?? claims.user_id);
    case 'service_account':
      return targetId === (input.service_account_id ?? claims.service_account_id);
    case 'api_key':
      return targetId === String(input.api_key_id ?? '');
    case 'model':
      return targetId === input.model;
    case 'channel':
      return targetId === String(input.channel_id ?? '');
    case 'external_user':
      return targetId === input.external_user_id;
    case 'external_workspace':
      return targetId === input.external_workspace_id;
    case 'feature':
      return targetId === input.external_feature_type;
    default:
      return false;
  }
}

function policyMatches(policy: EnterprisePolicyRecord, claims: PlatformClaims, input: EnterprisePolicyEvaluationInput): EnterprisePolicyEvaluationMatch | null {
  if (policy.status && policy.status !== 'active') return null;
  if (!targetMatches(policy, claims, input)) return null;

  const rules = policy.rules ?? {};
  const matchedRules = [`target:${policy.target_kind || 'org'}`];
  const roleCandidates = candidateValues(input.roles, claims.roles);
  const scopeCandidates = candidateValues(input.scopes, claims.scopes);

  const checks = [
    ruleMatched(rules, ['actions', 'action'], candidateValues(input.action), 'action', matchedRules),
    ruleMatched(rules, ['resources', 'resource'], candidateValues(input.resource), 'resource', matchedRules),
    ruleMatched(rules, ['models', 'model'], candidateValues(input.model), 'model', matchedRules),
    ruleMatched(rules, ['channels', 'channel_ids', 'channel_id'], candidateValues(input.channel_id), 'channel', matchedRules),
    ruleMatched(rules, ['api_keys', 'api_key_ids', 'token_ids', 'token_id'], candidateValues(input.api_key_id), 'api_key', matchedRules),
    ruleMatched(rules, ['users', 'user_ids', 'user_id'], candidateValues(input.user_id, claims.user_id), 'user', matchedRules),
    ruleMatched(rules, ['service_accounts', 'service_account_ids', 'service_account_id'], candidateValues(input.service_account_id, claims.service_account_id), 'service_account', matchedRules),
    ruleMatched(rules, ['projects', 'project_ids', 'project_id'], candidateValues(input.project_id, claims.project_id), 'project', matchedRules),
    ruleMatched(rules, ['external_users', 'external_user_ids', 'external_user_id'], candidateValues(input.external_user_id), 'external_user', matchedRules),
    ruleMatched(rules, ['external_workspaces', 'external_workspace_ids', 'external_workspace_id'], candidateValues(input.external_workspace_id), 'external_workspace', matchedRules),
    ruleMatched(rules, ['features', 'feature_types', 'external_feature_types', 'external_feature_type'], candidateValues(input.external_feature_type), 'feature', matchedRules),
    ruleMatched(rules, ['roles', 'role'], roleCandidates, 'role', matchedRules),
    ruleMatched(rules, ['scopes', 'scope'], scopeCandidates, 'scope', matchedRules),
  ];

  if (checks.some((ok) => !ok)) return null;

  const effect: EnterprisePolicyEffect = policy.effect === 'deny' ? 'deny' : 'allow';
  return {
    id: policy.id,
    name: policy.name,
    effect,
    target_kind: policy.target_kind || 'org',
    target_id: policy.target_id ?? null,
    matched_rules: matchedRules,
  };
}

export function evaluateEnterprisePolicies(
  claims: PlatformClaims,
  input: EnterprisePolicyEvaluationInput,
  policies: readonly EnterprisePolicyRecord[],
  scope: EnterprisePolicyEvaluationScope,
): EnterprisePolicyEvaluationResult {
  const normalizedInput: EnterprisePolicyEvaluationInput = {
    ...input,
    user_id: input.user_id ?? claims.user_id,
    service_account_id: input.service_account_id ?? claims.service_account_id,
    project_id: input.project_id ?? claims.project_id,
    roles: input.roles?.length ? input.roles : claims.roles,
    scopes: input.scopes?.length ? input.scopes : claims.scopes,
  };
  const activePolicies = policies.filter((policy) => !policy.status || policy.status === 'active');
  const matchedPolicies = activePolicies
    .map((policy) => policyMatches(policy, claims, normalizedInput))
    .filter((policy): policy is EnterprisePolicyEvaluationMatch => Boolean(policy));
  const denyPolicyIds = matchedPolicies.filter((policy) => policy.effect === 'deny').map((policy) => policy.id);
  const allowPolicyIds = matchedPolicies.filter((policy) => policy.effect === 'allow').map((policy) => policy.id);
  const denied = denyPolicyIds.length > 0;

  return {
    decision: denied ? 'deny' : 'allow',
    reason: denied
      ? `Denied by enterprise policy ${denyPolicyIds.join(', ')}`
      : allowPolicyIds.length > 0
        ? `Allowed by enterprise policy ${allowPolicyIds.join(', ')}`
        : 'Allowed by default: no matching deny policy',
    scope,
    input: normalizedInput,
    matched_policies: matchedPolicies,
    allow_policy_ids: allowPolicyIds,
    deny_policy_ids: denyPolicyIds,
    evaluated_policy_count: activePolicies.length,
  };
}

function normalizeBudgetEvaluationInput(claims: PlatformClaims, input: EnterpriseBudgetEvaluationInput): EnterpriseBudgetEvaluationInput {
  return {
    ...input,
    subject_kind: input.subject_kind?.trim() || undefined,
    action: input.action?.trim() || 'request',
    requested_quota: Math.max(0, readFiniteNumber(input.requested_quota, 0)),
    current_quota_cost: input.current_quota_cost === undefined ? undefined : Math.max(0, readFiniteNumber(input.current_quota_cost, 0)),
    projected_quota_cost: input.projected_quota_cost === undefined ? undefined : Math.max(0, readFiniteNumber(input.projected_quota_cost, 0)),
    user_id: input.user_id ?? claims.user_id,
    service_account_id: input.service_account_id ?? claims.service_account_id,
    project_id: input.project_id ?? claims.project_id,
  };
}

function budgetSubjectCandidates(claims: PlatformClaims, input: EnterpriseBudgetEvaluationInput, subjectKind: string): readonly string[] {
  const explicitSubject = input.subject_kind === subjectKind ? candidateValues(input.subject_id) : [];
  switch (subjectKind) {
    case 'tenant':
      return candidateValues(explicitSubject, claims.tenant_id);
    case 'org':
      return candidateValues(explicitSubject, claims.org_id);
    case 'app_instance':
      return candidateValues(explicitSubject, claims.app_instance_id);
    case 'project':
      return candidateValues(explicitSubject, input.project_id, claims.project_id);
    case 'user':
      return candidateValues(explicitSubject, input.user_id, claims.user_id);
    case 'service_account':
      return candidateValues(explicitSubject, input.service_account_id, claims.service_account_id);
    case 'api_key':
      return candidateValues(explicitSubject, input.api_key_id);
    case 'channel':
      return candidateValues(explicitSubject, input.channel_id);
    case 'external_user':
      return candidateValues(explicitSubject, input.external_user_id);
    case 'external_workspace':
      return candidateValues(explicitSubject, input.external_workspace_id);
    case 'feature':
      return candidateValues(explicitSubject, input.external_feature_type);
    default:
      return explicitSubject;
  }
}

function budgetSubjectMatches(budget: EnterpriseBudgetRecord, claims: PlatformClaims, input: EnterpriseBudgetEvaluationInput): boolean {
  const subjectKind = budget.subject_kind || 'org';
  const subjectId = readString(budget.subject_id);
  if (!subjectId || subjectId === '*') return true;
  return budgetSubjectCandidates(claims, input, subjectKind).includes(subjectId);
}

function evaluateSingleBudget(budget: EnterpriseBudgetRecord, input: EnterpriseBudgetEvaluationInput): EnterpriseBudgetEvaluationMatch {
  const requestedQuota = Math.max(0, readFiniteNumber(input.requested_quota, 0));
  const currentQuota = input.current_quota_cost === undefined
    ? Math.max(0, readFiniteNumber(budget.used_quota, 0))
    : Math.max(0, readFiniteNumber(input.current_quota_cost, 0));
  const projectedQuota = input.projected_quota_cost === undefined
    ? currentQuota + requestedQuota
    : Math.max(0, readFiniteNumber(input.projected_quota_cost, currentQuota + requestedQuota));
  const limitQuota = Math.max(0, readFiniteNumber(budget.limit_quota, 0));
  const alertThresholdPct = clampPercent(readFiniteNumber(budget.alert_threshold_pct, 80));
  const projectedUsagePercent = limitQuota > 0 ? Math.round((projectedQuota / limitQuota) * 10000) / 100 : projectedQuota > 0 ? 100 : 0;
  const decision: EnterpriseBudgetDecision = projectedQuota > limitQuota
    ? 'deny'
    : projectedUsagePercent >= alertThresholdPct && alertThresholdPct > 0
      ? 'warn'
      : 'allow';

  return {
    id: budget.id,
    subject_kind: budget.subject_kind || 'org',
    subject_id: budget.subject_id ?? null,
    period: budget.period,
    status: budget.status ?? 'active',
    limit_quota: limitQuota,
    used_quota: currentQuota,
    requested_quota: requestedQuota,
    projected_quota: projectedQuota,
    projected_usage_percent: projectedUsagePercent,
    alert_threshold_pct: alertThresholdPct,
    decision,
    reset_at: budget.reset_at ?? null,
  };
}

export function evaluateEnterpriseBudgets(
  claims: PlatformClaims,
  input: EnterpriseBudgetEvaluationInput,
  budgets: readonly EnterpriseBudgetRecord[],
  scope: EnterpriseBudgetEvaluationScope,
): EnterpriseBudgetEvaluationResult {
  const normalizedInput = normalizeBudgetEvaluationInput(claims, input);
  const activeBudgets = budgets.filter((budget) => !budget.status || budget.status === 'active');
  const matchedBudgets = activeBudgets
    .filter((budget) => budgetSubjectMatches(budget, claims, normalizedInput))
    .map((budget) => evaluateSingleBudget(budget, normalizedInput));
  const blockingBudgetIds = matchedBudgets.filter((budget) => budget.decision === 'deny').map((budget) => budget.id);
  const warningBudgetIds = matchedBudgets.filter((budget) => budget.decision === 'warn').map((budget) => budget.id);
  const decision: EnterpriseBudgetDecision = blockingBudgetIds.length > 0 ? 'deny' : warningBudgetIds.length > 0 ? 'warn' : 'allow';

  return {
    decision,
    reason: blockingBudgetIds.length > 0
      ? `Denied by enterprise budget ${blockingBudgetIds.join(', ')}`
      : warningBudgetIds.length > 0
        ? `Budget warning threshold reached for ${warningBudgetIds.join(', ')}`
        : matchedBudgets.length > 0
          ? 'Allowed by enterprise budget'
          : 'Allowed by default: no matching active budget',
    scope,
    input: normalizedInput,
    matched_budgets: matchedBudgets,
    warning_budget_ids: warningBudgetIds,
    blocking_budget_ids: blockingBudgetIds,
    evaluated_budget_count: activeBudgets.length,
  };
}

export function decodeJwtPayloadUnverified(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = parts[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = decodeBase64Utf8(padded);
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function decodeJwtHeaderUnverified(token: string): JwtHeader | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const header = parts[0];
  if (!header) return null;

  try {
    const normalized = header.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed = JSON.parse(decodeBase64Utf8(padded)) as unknown;
    if (!isJsonObject(parsed)) return null;
    return {
      alg: typeof parsed.alg === 'string' ? parsed.alg : undefined,
      kid: typeof parsed.kid === 'string' ? parsed.kid : undefined,
      typ: typeof parsed.typ === 'string' ? parsed.typ : undefined,
    };
  } catch {
    return null;
  }
}

function decodeBase64Utf8(value: string): string {
  return new TextDecoder().decode(decodeBase64Bytes(value));
}

function decodeBase64Bytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = globalThis.atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeBase64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return decodeBase64Bytes(padded);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAudience(payload: JsonObject): readonly string[] {
  const aud = payload.aud ?? payload.audience;
  if (Array.isArray(aud)) return aud.map((item) => String(item)).filter(Boolean);
  if (typeof aud === 'string' && aud.trim()) return [aud.trim()];
  return [];
}

function assertRegisteredClaims(payload: JsonObject, options: SupAuthJwtVerifierOptions): void {
  const now = options.now?.() ?? Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : Number(payload.exp || 0);
  if (exp && exp <= now) throw new Error('SupAuth token has expired');

  if (options.issuer && payload.iss !== options.issuer) {
    throw new Error('SupAuth token issuer mismatch');
  }

  if (options.audience) {
    const audiences = readAudience(payload);
    if (!audiences.includes(options.audience)) throw new Error('SupAuth token audience mismatch');
  }
}

function parseJwks(value: unknown): JwksResponse {
  if (!isJsonObject(value)) return {};
  const keys = Array.isArray(value.keys)
    ? value.keys.filter(isJsonObject).map((item) => item as JwkRecord)
    : [];
  return { keys };
}

function findJwk(jwks: JwksResponse, header: JwtHeader): JwkRecord | null {
  const keys = jwks.keys ?? [];
  if (!keys.length) return null;
  if (header.kid) {
    const byKid = keys.find((key) => key.kid === header.kid);
    if (byKid) return byKid;
  }
  return keys.find((key) => key.alg === header.alg) ?? keys[0] ?? null;
}

async function importVerificationKey(jwk: JwkRecord, alg: string): Promise<CryptoKey> {
  if (alg !== 'RS256') throw new Error(`Unsupported SupAuth JWT alg: ${alg}`);
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

async function verifyJwtSignature(token: string, jwk: JwkRecord, alg: string): Promise<void> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('Malformed SupAuth JWT');

  const key = await importVerificationKey(jwk, alg);
  const signedData = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = decodeBase64UrlBytes(encodedSignature);
  const ok = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, signedData);
  if (!ok) throw new Error('SupAuth JWT signature verification failed');
}

export function createSupAuthJwtVerifier(options: SupAuthJwtVerifierOptions): EnterpriseTokenVerifier {
  let cachedJwks: JwksResponse | null = null;
  let cachedAt = 0;
  const fetchJwks = options.fetchJwks ?? (async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch SupAuth JWKS: HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  });

  async function getJwks(): Promise<JwksResponse> {
    const now = Date.now();
    if (cachedJwks && now - cachedAt < 5 * 60 * 1000) return cachedJwks;
    if (!options.jwksUrl) throw new Error('SUPAUTH_JWKS_URL is required for enterprise auth');
    cachedJwks = parseJwks(await fetchJwks(options.jwksUrl));
    cachedAt = now;
    return cachedJwks;
  }

  return async (token: string) => {
    const header = decodeJwtHeaderUnverified(token);
    const payload = decodeJwtPayloadUnverified(token);
    if (!header || !payload) throw new Error('Malformed SupAuth JWT');

    if (options.allowUnverifiedDevTokens) {
      assertRegisteredClaims(payload, options);
      return payload;
    }

    const alg = header.alg ?? '';
    if (!alg || alg === 'none') throw new Error('Unsigned SupAuth JWT is not allowed');
    const jwk = findJwk(await getJwks(), header);
    if (!jwk) throw new Error('No matching SupAuth JWKS key');
    await verifyJwtSignature(token, jwk, alg);
    assertRegisteredClaims(payload, options);
    return payload;
  };
}

export async function authorizeBearer(
  authorizationHeader: string | null | undefined,
  options: EnterpriseAuthorizerOptions,
): Promise<EnterpriseAuthResult> {
  const token = parseBearerToken(authorizationHeader);
  if (!token) {
    return { ok: false, code: 'missing_authorization', message: 'Missing Bearer authorization header' };
  }

  let verifiedPayload: unknown;
  try {
    verifiedPayload = await options.verifyToken(token);
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_token',
      message: error instanceof Error ? error.message : 'Invalid SupAuth token',
    };
  }

  const claims = normalizePlatformClaims(verifiedPayload);
  if (!claims) {
    return { ok: false, code: 'invalid_claims', message: 'Token does not contain Elygate platform claims' };
  }

  const requiredScopes = options.requiredScopes ?? [AI_GATEWAY_SCOPES.gatewayRead];
  if (!hasEveryScope(claims, requiredScopes)) {
    return { ok: false, code: 'insufficient_scope', message: `Missing scope: ${requiredScopes.join(', ')}` };
  }

  return { ok: true, claims };
}

export function createUnverifiedDevelopmentVerifier(): EnterpriseTokenVerifier {
  return (token: string) => {
    const payload = decodeJwtPayloadUnverified(token);
    if (!payload) throw new Error('Token is not a JWT payload');
    return payload;
  };
}
