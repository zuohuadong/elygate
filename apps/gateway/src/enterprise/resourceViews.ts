import type { EnterpriseListQuery, EnterpriseResourcePage, EnterpriseScopeBoundary, PlatformClaims } from '@elygate/enterprise-contracts';
import { db } from '@elygate/db';
import { agentMemories, channels, logs, tokens, users } from '@elygate/db/schema';
import { and, count, desc, eq, isNull, or, sql as drizzleSql, type SQL } from 'drizzle-orm';
import { enterpriseRuntimeConfig } from './config';

function parsePagination(query?: EnterpriseListQuery): { page: number; limit: number; offset: number } {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query?.limit) || 30));
    return { page, limit, offset: (page - 1) * limit };
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

function paginated<T>(
    claims: PlatformClaims,
    data: readonly T[],
    total: number,
    query?: EnterpriseListQuery,
    scopeBoundary: EnterpriseScopeBoundary = 'gateway_instance_projection',
): EnterpriseResourcePage<T> {
    const { page, limit } = parsePagination(query);
    return {
        data,
        total,
        page,
        limit,
        scope: gatewayInstanceScope(claims),
        scope_boundary: scopeBoundary,
    };
}

function numericOrgId(claims: PlatformClaims): number | null {
    const parsed = Number(claims.org_id);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function projectedWorkspaceIds(claims: PlatformClaims): readonly string[] {
    return [claims.project_id, claims.app_instance_id].filter((value): value is string => Boolean(value));
}

function emptyProjectionWhere(base?: SQL): SQL {
    return base ? and(base, drizzleSql`false`) ?? drizzleSql`false` : drizzleSql`false`;
}

function orgScopedWhere(claims: PlatformClaims, column: typeof tokens.orgId | typeof logs.orgId | typeof agentMemories.orgId, base?: SQL): SQL {
    const orgId = numericOrgId(claims);
    if (!orgId) return emptyProjectionWhere(base);
    const scoped = eq(column, orgId);
    return base ? and(base, scoped) ?? scoped : scoped;
}

function requestLogWhere(claims: PlatformClaims): SQL {
    const filters: SQL[] = [];
    const orgId = numericOrgId(claims);
    if (orgId) filters.push(eq(logs.orgId, orgId));

    const workspaceIds = projectedWorkspaceIds(claims);
    if (workspaceIds.length) {
        const workspaceFilters = workspaceIds.map((workspaceId) => eq(logs.externalWorkspaceId, workspaceId));
        const workspaceWhere = or(...workspaceFilters);
        if (workspaceWhere) filters.push(workspaceWhere);
    }

    return filters.length ? or(...filters) ?? drizzleSql`false` : drizzleSql`false`;
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

function contentPreview(value: string, maxLength = 180): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function mapProviderChannel(row: typeof channels.$inferSelect) {
    return {
        id: row.id,
        type: row.type,
        name: row.name,
        base_url: row.baseUrl,
        credential_mask: maskCredential(row.key),
        models: row.models,
        model_mapping: row.modelMapping,
        groups: row.groups ?? [],
        status: row.status,
        status_message: row.statusMessage,
        key_strategy: row.keyStrategy,
        key_concurrency_limit: row.keyConcurrencyLimit,
        endpoint_type: row.endpointType,
        price_ratio: Number(row.priceRatio ?? 1),
        balance: row.balance === null || row.balance === undefined ? null : Number(row.balance),
        response_time: row.responseTime,
        tag: row.tag,
        updated_at: dateIso(row.updatedAt),
        created_at: dateIso(row.createdAt),
    };
}

type GatewayApiKeyRow = Pick<
    typeof tokens.$inferSelect,
    | 'id'
    | 'userId'
    | 'orgId'
    | 'name'
    | 'key'
    | 'status'
    | 'remainQuota'
    | 'usedQuota'
    | 'unlimitedQuota'
    | 'models'
    | 'rateLimit'
    | 'modelLimitsEnabled'
    | 'tokenGroup'
    | 'crossGroupRetry'
    | 'accessedAt'
    | 'expiredAt'
    | 'updatedAt'
    | 'createdAt'
> & {
    readonly username: string | null;
};

function mapGatewayApiKey(row: GatewayApiKeyRow) {
    return {
        id: row.id,
        user_id: row.userId,
        username: row.username ?? null,
        org_id: row.orgId,
        name: row.name,
        key_mask: maskCredential(row.key),
        status: row.status,
        remain_quota: row.remainQuota,
        used_quota: row.usedQuota,
        unlimited_quota: row.unlimitedQuota,
        models: row.models ?? [],
        rate_limit: row.rateLimit,
        model_limits_enabled: row.modelLimitsEnabled,
        token_group: row.tokenGroup,
        cross_group_retry: row.crossGroupRetry,
        accessed_at: dateIso(row.accessedAt),
        expired_at: dateIso(row.expiredAt),
        updated_at: dateIso(row.updatedAt),
        created_at: dateIso(row.createdAt),
    };
}

function mapRequestLog(row: typeof logs.$inferSelect) {
    return {
        id: row.id,
        user_id: row.userId,
        token_id: row.tokenId,
        channel_id: row.channelId,
        model_name: row.modelName,
        quota_cost: row.quotaCost,
        prompt_tokens: row.promptTokens,
        completion_tokens: row.completionTokens,
        cached_tokens: row.cachedTokens,
        elapsed_ms: row.elapsedMs,
        is_stream: row.isStream,
        status_code: row.statusCode,
        error_message: row.errorMessage,
        ip_address: row.ipAddress,
        trace_id: row.traceId,
        org_id: row.orgId,
        external_task_id: row.externalTaskId,
        external_user_id: row.externalUserId,
        external_workspace_id: row.externalWorkspaceId,
        external_feature_type: row.externalFeatureType,
        created_at: dateIso(row.createdAt),
    };
}

function mapAgentMemory(row: typeof agentMemories.$inferSelect) {
    return {
        id: row.id,
        user_id: row.userId,
        token_id: row.tokenId,
        org_id: row.orgId,
        thread_id: row.threadId,
        scope: row.scope,
        kind: row.kind,
        content_preview: contentPreview(row.content),
        content_length: row.content.length,
        confidence: Number(row.confidence ?? 0),
        source_trace_id: row.sourceTraceId,
        metadata: row.metadata,
        expires_at: dateIso(row.expiresAt),
        last_read_at: dateIso(row.lastReadAt),
        created_at: dateIso(row.createdAt),
        updated_at: dateIso(row.updatedAt),
    };
}

export async function listProviderChannels(claims: PlatformClaims, query?: EnterpriseListQuery) {
    const { limit, offset } = parsePagination(query);
    const [{ total }] = await db.select({ total: count() }).from(channels);
    const rows = await db.select()
        .from(channels)
        .orderBy(desc(channels.priority), desc(channels.weight), desc(channels.updatedAt))
        .limit(limit)
        .offset(offset);
    return paginated(claims, rows.map(mapProviderChannel), Number(total || 0), query, 'global_provider_catalog');
}

export async function listModelRoutes(claims: PlatformClaims, query?: EnterpriseListQuery) {
    const rows = await db.select()
        .from(channels)
        .orderBy(desc(channels.priority), desc(channels.weight), desc(channels.updatedAt));
    const routes = rows.flatMap((row) => {
        const models = stringArray(row.models);
        const routeModels = models.length ? models : ['*'];
        return routeModels.map((modelName) => ({
            id: `${row.id}:${modelName}`,
            model_name: modelName,
            channel_id: row.id,
            channel_name: row.name,
            provider_type: row.type,
            endpoint_type: row.endpointType,
            status: row.status,
            priority: row.priority,
            weight: row.weight,
            price_ratio: Number(row.priceRatio ?? 1),
            groups: row.groups ?? [],
            mapped_model: row.modelMapping?.[modelName] ?? null,
            updated_at: dateIso(row.updatedAt),
        }));
    });
    const { offset, limit } = parsePagination(query);
    return paginated(claims, routes.slice(offset, offset + limit), routes.length, query, 'global_provider_catalog');
}

export async function listGatewayApiKeys(claims: PlatformClaims, query?: EnterpriseListQuery) {
    const { limit, offset } = parsePagination(query);
    const where = orgScopedWhere(claims, tokens.orgId, isNull(tokens.deletedAt));
    const [{ total }] = await db.select({ total: count() }).from(tokens).where(where);
    const rows = await db.select({
        id: tokens.id,
        userId: tokens.userId,
        username: users.username,
        orgId: tokens.orgId,
        name: tokens.name,
        key: tokens.key,
        status: tokens.status,
        remainQuota: tokens.remainQuota,
        usedQuota: tokens.usedQuota,
        unlimitedQuota: tokens.unlimitedQuota,
        models: tokens.models,
        rateLimit: tokens.rateLimit,
        modelLimitsEnabled: tokens.modelLimitsEnabled,
        tokenGroup: tokens.tokenGroup,
        crossGroupRetry: tokens.crossGroupRetry,
        accessedAt: tokens.accessedAt,
        expiredAt: tokens.expiredAt,
        updatedAt: tokens.updatedAt,
        createdAt: tokens.createdAt,
    })
        .from(tokens)
        .leftJoin(users, eq(tokens.userId, users.id))
        .where(where)
        .orderBy(desc(tokens.updatedAt), desc(tokens.id))
        .limit(limit)
        .offset(offset);
    return paginated(claims, rows.map(mapGatewayApiKey), Number(total || 0), query);
}

export async function listRequestLogs(claims: PlatformClaims, query?: EnterpriseListQuery) {
    const { limit, offset } = parsePagination(query);
    const where = requestLogWhere(claims);
    const [{ total }] = await db.select({ total: count() }).from(logs).where(where);
    const rows = await db.select()
        .from(logs)
        .where(where)
        .orderBy(desc(logs.createdAt), desc(logs.id))
        .limit(limit)
        .offset(offset);
    return paginated(claims, rows.map(mapRequestLog), Number(total || 0), query);
}

export async function listAgentMemories(claims: PlatformClaims, query?: EnterpriseListQuery) {
    const { limit, offset } = parsePagination(query);
    const where = orgScopedWhere(claims, agentMemories.orgId, isNull(agentMemories.deletedAt));
    const [{ total }] = await db.select({ total: count() }).from(agentMemories).where(where);
    const rows = await db.select()
        .from(agentMemories)
        .where(where)
        .orderBy(desc(agentMemories.updatedAt), desc(agentMemories.createdAt))
        .limit(limit)
        .offset(offset);
    return paginated(claims, rows.map(mapAgentMemory), Number(total || 0), query);
}
