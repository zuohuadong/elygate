import type { ElysiaCtx } from '../../types';
import { Elysia } from 'elysia';
import { db, sql } from '@elygate/db';
import { logs, users, tokens, channels, healthLogs } from '@elygate/db/schema';
import { eq, and, or, ilike, desc, count, sum, sql as drizzleSql } from 'drizzle-orm';
import { quotaToUSD, quotaToRMB } from '../../services/ratio';
import { getAuditLogs } from '../../services/auditLog';
import { memoryCache } from '../../services/cache';

export const logsRouter = new Elysia()
    .get('/logs', async ({ query }: ElysiaCtx) => {
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        const userId = query?.user_id;
        const channelId = query?.channel_id;
        const modelName = query?.model;
        const statusCode = query?.status_code;
        const search = query?.keyword;

        const conditions = [drizzleSql`1=1`];
        if (userId) conditions.push(eq(logs.userId, Number(userId)));
        if (channelId) conditions.push(eq(logs.channelId, Number(channelId)));
        if (modelName) conditions.push(eq(logs.modelName, modelName as string));
        if (statusCode) conditions.push(eq(logs.statusCode, Number(statusCode)));
        if (search) conditions.push(or(
            ilike(logs.errorMessage, '%' + search + '%'),
        )!);

        const whereClause = and(...conditions);

        const [countRow] = await db.select({ total: count() }).from(logs).where(whereClause);

        const data = await db.select({
            id: logs.id,
            userId: logs.userId,
            tokenId: logs.tokenId,
            channelId: logs.channelId,
            modelName: logs.modelName,
            quotaCost: logs.quotaCost,
            promptTokens: logs.promptTokens,
            completionTokens: logs.completionTokens,
            cachedTokens: logs.cachedTokens,
            elapsedMs: logs.elapsedMs,
            isStream: logs.isStream,
            errorMessage: logs.errorMessage,
            statusCode: logs.statusCode,
            ipAddress: logs.ipAddress,
            userAgent: logs.userAgent,
            traceId: logs.traceId,
            orgId: logs.orgId,
            externalTaskId: logs.externalTaskId,
            externalUserId: logs.externalUserId,
            externalWorkspaceId: logs.externalWorkspaceId,
            externalFeatureType: logs.externalFeatureType,
            createdAt: logs.createdAt,
            creatorName: users.username,
            channelName: channels.name,
        }).from(logs)
          .leftJoin(users, eq(logs.userId, users.id))
          .leftJoin(channels, eq(logs.channelId, channels.id))
          .where(whereClause)
          .orderBy(desc(logs.createdAt))
          .limit(limit)
          .offset(offset);

        return {
            data: data.map((l: Record<string, any>) => ({
                ...l,
                channel_name: l.channelId === -1
                    ? (query?.lang === 'zh' ? '系统精确缓存' : 'Exact Match Cache')
                    : l.channelId === 0
                        ? (query?.lang === 'zh' ? '系统语义缓存' : 'Semantic Cache')
                        : (l.channelName || `Unknown (${l.channelId})`),
                cost_usd: quotaToUSD(l.quotaCost),
                cost_rmb: quotaToRMB(l.quotaCost),
                cached_tokens: l.cachedTokens || 0,
                elapsed_ms: l.elapsedMs || 0
            })),
            total: countRow.total,
            page,
            limit
        };
    })

    .get('/logs/export', async ({ query, set }: ElysiaCtx) => {
        const userId = query?.user_id;
        const channelId = query?.channel_id;
        const modelName = query?.model;
        const statusCode = query?.status_code;
        const search = query?.keyword;
        const format = query?.format || 'csv';

        const conditions = [drizzleSql`1=1`];
        if (userId) conditions.push(eq(logs.userId, Number(userId)));
        if (channelId) conditions.push(eq(logs.channelId, Number(channelId)));
        if (modelName) conditions.push(eq(logs.modelName, modelName as string));
        if (statusCode) conditions.push(eq(logs.statusCode, Number(statusCode)));
        if (search) conditions.push(or(
            ilike(logs.errorMessage, '%' + search + '%'),
        )!);

        const whereClause = and(...conditions);

        const data = await db.select({
            id: logs.id,
            userId: logs.userId,
            channelId: logs.channelId,
            modelName: logs.modelName,
            quotaCost: logs.quotaCost,
            promptTokens: logs.promptTokens,
            completionTokens: logs.completionTokens,
            cachedTokens: logs.cachedTokens,
            elapsedMs: logs.elapsedMs,
            isStream: logs.isStream,
            errorMessage: logs.errorMessage,
            statusCode: logs.statusCode,
            ipAddress: logs.ipAddress,
            createdAt: logs.createdAt,
            creatorName: users.username,
        }).from(logs)
          .leftJoin(users, eq(logs.userId, users.id))
          .where(whereClause)
          .orderBy(desc(logs.createdAt))
          .limit(10000);

        const exportLogs = data.map((l: Record<string, any>) => ({
            id: l.id,
            created_at: l.createdAt,
            user_id: l.userId,
            username: l.creatorName || '',
            channel_id: l.channelId,
            model_name: l.modelName,
            prompt_tokens: l.promptTokens,
            completion_tokens: l.completionTokens,
            cached_tokens: l.cachedTokens || 0,
            total_tokens: (l.promptTokens || 0) + (l.completionTokens || 0),
            quota_cost: l.quotaCost,
            cost_usd: quotaToUSD(l.quotaCost),
            cost_rmb: quotaToRMB(l.quotaCost),
            status_code: l.statusCode,
            latency_ms: l.elapsedMs,
            ip: l.ipAddress,
            prompt: '',
            response: '',
            error_message: l.errorMessage || ''
        }));

        if (format === 'json') {
            set.headers['Content-Type'] = 'application/json';
            set.headers['Content-Disposition'] = 'attachment; filename="logs_export.json"';
            return JSON.stringify(exportLogs, null, 2);
        }

        const csvHeaders = [
            'ID', 'Created At', 'User ID', 'Username', 'Channel ID', 'Model',
            'Prompt Tokens', 'Completion Tokens', 'Cached Tokens', 'Total Tokens', 'Quota Cost',
            'Cost USD', 'Cost RMB', 'Status Code', 'Latency MS', 'IP',
            'Prompt', 'Response', 'Error Message'
        ].join(',');

        const csvRows = exportLogs.map((l: Record<string, any>) => [
            l.id,
            l.created_at,
            l.user_id,
            `"${(l.username || '').replace(/"/g, '""')}"`,
            l.channel_id,
            `"${(l.model_name || '').replace(/"/g, '""')}"`,
            l.prompt_tokens,
            l.completion_tokens,
            l.cached_tokens || 0,
            l.total_tokens,
            l.quota_cost,
            l.cost_usd,
            l.cost_rmb,
            l.status_code,
            l.latency_ms,
            l.ip || '',
            `"${(l.prompt || '').replace(/"/g, '""').substring(0, 500)}"`,
            `"${(l.response || '').replace(/"/g, '""').substring(0, 500)}"`,
            `"${(l.error_message || '').replace(/"/g, '""')}"`
        ].join(','));

        const csv = [csvHeaders, ...csvRows].join('\n');
        set.headers['Content-Type'] = 'text/csv; charset=utf-8';
        set.headers['Content-Disposition'] = 'attachment; filename="logs_export.csv"';
        return csv;
    })

    .get('/circuit-breaker/status', async () => {
        const channelList = Array.from(memoryCache.channels.values());
        return channelList.map(ch => ({
            id: ch.id,
            name: ch.name,
            status: ch.status,
            statusText: ch.status === 1 ? 'Active' : ch.status === 3 ? 'Prohibited' : ch.status === 4 ? 'Half-Open' : 'Unknown'
        }));
    })

    .get('/health-logs', async ({ query }: ElysiaCtx) => {
        const channelId = query?.channel_id;
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        const conditions = [];
        if (channelId) conditions.push(eq(healthLogs.channelId, Number(channelId)));
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [countRow] = await db.select({ total: count() }).from(healthLogs).where(whereClause);

        const data = await db.select({
            id: healthLogs.id,
            channelId: healthLogs.channelId,
            channelName: channels.name,
            channelType: channels.type,
            status: healthLogs.status,
            latency: healthLogs.latency,
            errorMessage: healthLogs.errorMessage,
            createdAt: healthLogs.createdAt,
        }).from(healthLogs)
          .leftJoin(channels, eq(healthLogs.channelId, channels.id))
          .where(whereClause)
          .orderBy(desc(healthLogs.createdAt))
          .limit(limit)
          .offset(offset);

        return {
            data: data.map((l: Record<string, any>) => ({
                id: l.id,
                channel_id: l.channelId,
                channel_name: l.channelName || 'Unknown',
                channel_type: l.channelType,
                status: l.status,
                status_text: l.status === 1 ? 'Healthy' : 'Failed',
                latency: l.latency,
                error_message: l.errorMessage,
                created_at: l.createdAt
            })),
            total: countRow.total,
            page,
            limit
        };
    })

    .get('/health-summary', async () => {
        const summary = await db.select({
            id: channels.id,
            name: channels.name,
            type: channels.type,
            status: channels.status,
            testErrors: channels.testErrors,
            testAt: channels.testAt,
            totalChecks: drizzleSql<number>`count(${healthLogs.id})`,
            successfulChecks: drizzleSql<number>`count(case when ${healthLogs.status} = 1 then 1 end)`,
            failedChecks: drizzleSql<number>`count(case when ${healthLogs.status} = 0 then 1 end)`,
            avgLatency: drizzleSql<string | null>`avg(case when ${healthLogs.status} = 1 then ${healthLogs.latency} end)`,
            lastCheck: drizzleSql<Date | null>`max(${healthLogs.createdAt})`,
        }).from(channels)
          .leftJoin(healthLogs, and(
              eq(channels.id, healthLogs.channelId),
              drizzleSql`${healthLogs.createdAt} >= NOW() - INTERVAL '24 hours' OR ${healthLogs.id} IS NULL`,
          ))
          .groupBy(channels.id, channels.name, channels.type, channels.status, channels.testErrors, channels.testAt)
          .orderBy(channels.id);

        return summary.map((s: Record<string, any>) => ({
            ...s,
            success_rate: s.totalChecks > 0 ? ((s.successfulChecks / s.totalChecks) * 100).toFixed(1) : 'N/A',
            avg_latency: s.avgLatency ? Math.round(Number(s.avgLatency)) : null
        }));
    })

    .get('/audit-logs', async ({ query }: ElysiaCtx) => {
        const userId = query?.user_id ? Number(query.user_id) : undefined;
        const action = query?.action;
        const resource = query?.resource;
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        const result = await getAuditLogs({
            userId,
            action,
            resource,
            limit,
            offset
        });

        return {
            data: result.logs.map((l: Record<string, any>) => ({
                id: l.id,
                user_id: l.user_id,
                username: l.username,
                action: l.action,
                resource: l.resource,
                resource_id: l.resource_id,
                details: l.details,
                ip_address: l.ip_address,
                user_agent: l.user_agent,
                created_at: l.created_at
            })),
            total: result.total,
            page,
            limit
        };
    })
    // --- Log Statistics (Admin) ---
    .get('/logs/stat', async ({ query }: ElysiaCtx) => {
        const hours = Number(query?.hours) || 24;
        const [stats] = await db.select({
            total_requests: drizzleSql<number>`count(*)`,
            success_count: drizzleSql<number>`count(case when ${logs.statusCode} < 400 then 1 end)`,
            error_count: drizzleSql<number>`count(case when ${logs.statusCode} >= 400 then 1 end)`,
            total_cost: drizzleSql<string>`sum(${logs.quotaCost})`,
            total_prompt_tokens: drizzleSql<string>`sum(${logs.promptTokens})`,
            total_completion_tokens: drizzleSql<string>`sum(${logs.completionTokens})`,
            avg_latency_ms: drizzleSql<number>`avg(case when ${logs.statusCode} < 400 then ${logs.elapsedMs} end)::int`,
            unique_users: drizzleSql<number>`count(distinct ${logs.userId})`,
            unique_models: drizzleSql<number>`count(distinct ${logs.modelName})`,
        }).from(logs).where(
            drizzleSql`${logs.createdAt} > NOW() - (${hours}::int * INTERVAL '1 hour')`
        );
        return stats;
    })

    // --- Self Log Statistics (User) ---
    .get('/logs/self/stat', async ({ user, query }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const hours = Number(query?.hours) || 24;
        const [stats] = await db.select({
            total_requests: drizzleSql<number>`count(*)`,
            success_count: drizzleSql<number>`count(case when ${logs.statusCode} < 400 then 1 end)`,
            total_cost: drizzleSql<string>`sum(${logs.quotaCost})`,
            total_tokens: drizzleSql<string>`sum(${logs.promptTokens} + ${logs.completionTokens})`,
            unique_models: drizzleSql<number>`count(distinct ${logs.modelName})`,
        }).from(logs).where(and(
            eq(logs.userId, user.id),
            drizzleSql`${logs.createdAt} > NOW() - (${hours}::int * INTERVAL '1 hour')`,
        ));
        return stats;
    })

    // --- Self Logs (User's own logs) ---
    .get('/logs/self', async ({ user, query }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        const [countRow] = await db.select({ total: count() }).from(logs).where(eq(logs.userId, user.id));

        const data = await db.select({
            id: logs.id,
            model_name: logs.modelName,
            prompt_tokens: logs.promptTokens,
            completion_tokens: logs.completionTokens,
            quota_cost: logs.quotaCost,
            status_code: logs.statusCode,
            is_stream: logs.isStream,
            created_at: logs.createdAt,
            channel_id: logs.channelId,
            error_message: logs.errorMessage,
            elapsed_ms: logs.elapsedMs,
        }).from(logs).where(eq(logs.userId, user.id))
          .orderBy(desc(logs.createdAt))
          .limit(limit)
          .offset(offset);

        return { data, total: countRow.total, page, limit };
    })

    // --- Self Log Search (User's own logs) ---
    .get('/logs/self/search', async ({ user, query }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const keyword = (query?.keyword || '').trim();
        const model = query?.model;
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;
        if (!keyword && !model) return { success: false, message: 'Provide keyword or model' };

        const conditions = [eq(logs.userId, user.id)];
        if (keyword) conditions.push(ilike(logs.modelName, '%' + keyword + '%'));
        if (model) conditions.push(eq(logs.modelName, model as string));

        const whereClause = and(...conditions);

        const [countRow] = await db.select({ total: count() }).from(logs).where(whereClause);

        const data = await db.select({
            id: logs.id,
            model_name: logs.modelName,
            prompt_tokens: logs.promptTokens,
            completion_tokens: logs.completionTokens,
            quota_cost: logs.quotaCost,
            status_code: logs.statusCode,
            is_stream: logs.isStream,
            created_at: logs.createdAt,
            error_message: logs.errorMessage,
            elapsed_ms: logs.elapsedMs,
        }).from(logs).where(whereClause)
          .orderBy(desc(logs.createdAt))
          .limit(limit)
          .offset(offset);

        return { data, total: countRow.total, page, limit };
    })

    // --- Token Read-Only Logs ---
    .get('/logs/token', async ({ query, request, set }: ElysiaCtx) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            set.status = 401;
            return { success: false, message: 'Missing Authorization header' };
        }
        const apiKey = authHeader.substring(7);
        const [tokenRow] = await db.select({
            id: tokens.id,
            userId: tokens.userId,
        }).from(tokens).where(and(eq(tokens.key, apiKey), eq(tokens.status, 1))).limit(1);

        if (!tokenRow) { set.status = 401; return { success: false, message: 'Invalid token' }; }

        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        const [countRow] = await db.select({ total: count() }).from(logs).where(eq(logs.tokenId, tokenRow.id));

        const data = await db.select({
            id: logs.id,
            model_name: logs.modelName,
            prompt_tokens: logs.promptTokens,
            completion_tokens: logs.completionTokens,
            quota_cost: logs.quotaCost,
            status_code: logs.statusCode,
            is_stream: logs.isStream,
            created_at: logs.createdAt,
            elapsed_ms: logs.elapsedMs,
        }).from(logs).where(eq(logs.tokenId, tokenRow.id))
          .orderBy(desc(logs.createdAt))
          .limit(limit)
          .offset(offset);

        return { data, total: countRow.total, page, limit };
    })

    // --- Delete Old Logs ---
    .delete('/logs/history', async ({ query }: ElysiaCtx) => {
        const days = Number(query?.days) || 30;
        const result = await db.delete(logs).where(
            drizzleSql`${logs.createdAt} < NOW() - (${days}::int * INTERVAL '1 day')`
        );
        return { success: true, deleted: (result as any).count || result.length || 0, olderThanDays: days };
    });
