import type { ElysiaCtx } from '../../types';
import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { adminGuard } from '../../middleware/auth';
import { optionCache } from '../../services/optionCache';

function notImplemented(set: Record<string, any>, message: string) {
    set.status = 501;
    return { error: { message, type: 'not_implemented', code: 'NOT_IMPLEMENTED' } };
}

function maskKey(value?: string | null) {
    if (!value) return value;
    return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : '***';
}

export const newApiCompatAdminRouter = new Elysia()
    .use(adminGuard)

    // New API: /api/channel/*
    .get('/channel', async () => {
        return await sql`
            SELECT id, name, type, base_url AS "baseUrl", models, priority, weight, groups, status, tag, created_at AS "createdAt", updated_at AS "updatedAt"
            FROM channels
            ORDER BY id DESC
        `;
    })
    .get('/channel/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        const tag = query?.tag;
        const type = query?.type;
        const status = query?.status;
        return await sql`
            SELECT id, name, type, base_url AS "baseUrl", models, priority, weight, groups, status, tag, created_at AS "createdAt", updated_at AS "updatedAt"
            FROM channels
            WHERE (${keyword || null} IS NULL OR name ILIKE ${'%' + keyword + '%'} OR CAST(id AS TEXT) ILIKE ${'%' + keyword + '%'})
              AND (${tag || null} IS NULL OR tag = ${tag || ''})
              AND (${type ?? null} IS NULL OR type = ${Number(type) || 0})
              AND (${status ?? null} IS NULL OR status = ${Number(status) || 0})
            ORDER BY id DESC
            LIMIT 200
        `;
    })
    .get('/channel/test', async () => {
        const rows = await sql`
            SELECT id, name, type, status, test_at AS "testAt", response_time AS "responseTime", status_message AS "statusMessage"
            FROM channels
            ORDER BY id DESC
        `;
        return { success: true, tested: rows.length, results: rows };
    })
    .get('/channel/test/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [row] = await sql`
            SELECT id, name, type, status, test_at AS "testAt", response_time AS "responseTime", status_message AS "statusMessage"
            FROM channels WHERE id = ${Number(id)} LIMIT 1
        `;
        if (!row) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }
        return { success: true, ...row };
    })
    .post('/channel/codex/oauth/start', ({ set }: ElysiaCtx) => notImplemented(set, 'Codex OAuth is not implemented.'))
    .post('/channel/codex/oauth/complete', ({ set }: ElysiaCtx) => notImplemented(set, 'Codex OAuth is not implemented.'))
    .post('/channel/:id/codex/oauth/start', ({ set }: ElysiaCtx) => notImplemented(set, 'Codex OAuth is not implemented.'))
    .post('/channel/:id/codex/oauth/complete', ({ set }: ElysiaCtx) => notImplemented(set, 'Codex OAuth is not implemented.'))
    .post('/channel/:id/codex/refresh', ({ set }: ElysiaCtx) => notImplemented(set, 'Codex credential refresh is not implemented.'))
    .get('/channel/:id/codex/usage', ({ set }: ElysiaCtx) => notImplemented(set, 'Codex usage is not implemented.'))

    // New API: /api/token/*
    .get('/token/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        const userId = query?.user_id;
        const status = query?.status;
        const rows = await sql`
            SELECT t.id, t.name, t.key, t.status, t.remain_quota AS "remainQuota", t.used_quota AS "usedQuota",
                   t.models, t.rate_limit AS "rateLimit", t.expired_at AS "expiredAt", t.user_id AS "userId",
                   t.token_group AS "tokenGroup", t.cross_group_retry AS "crossGroupRetry", u.username AS "creatorName"
            FROM tokens t
            LEFT JOIN users u ON t.user_id = u.id
            WHERE (${keyword || null} IS NULL OR t.name ILIKE ${'%' + keyword + '%'})
              AND (${userId || null} IS NULL OR t.user_id = ${Number(userId) || 0})
              AND (${status ?? null} IS NULL OR t.status = ${Number(status) || 0})
            ORDER BY t.id DESC
            LIMIT 100
        `;
        return rows.map((row: Record<string, any>) => ({ ...row, key: maskKey(row.key) }));
    })

    // New API: /api/log/*
    .get('/log/stat', async ({ query }: ElysiaCtx) => {
        const hours = Number(query?.hours) || 24;
        const [stats] = await sql`
            SELECT COUNT(*) AS "totalRequests",
                   COALESCE(SUM(quota_cost), 0) AS "totalCost",
                   COALESCE(SUM(prompt_tokens), 0) AS "promptTokens",
                   COALESCE(SUM(completion_tokens), 0) AS "completionTokens",
                   COALESCE(AVG(elapsed_ms), 0) AS "avgLatency"
            FROM logs
            WHERE created_at > NOW() - (${hours}::int * INTERVAL '1 hour')
        `;
        return stats || {};
    })

    // New API: /api/models/*
    .get('/models', async () => {
        return await sql`
            SELECT id, model_name AS "modelName", type, endpoint, display_name AS "displayName", tags, created_at AS "createdAt", updated_at AS "updatedAt"
            FROM model_metadata
            ORDER BY model_name
            LIMIT 500
        `;
    })
    .get('/models/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        return await sql`
            SELECT id, model_name AS "modelName", type, endpoint, display_name AS "displayName", tags, created_at AS "createdAt", updated_at AS "updatedAt"
            FROM model_metadata
            WHERE (${keyword || null} IS NULL OR model_name ILIKE ${'%' + keyword + '%'})
            ORDER BY model_name
            LIMIT 100
        `;
    })
    .get('/models/missing', async () => {
        const rows = await sql`
            SELECT DISTINCT model_name FROM (
                SELECT model_name FROM logs
                WHERE created_at > NOW() - INTERVAL '7 days'
                EXCEPT
                SELECT model_name FROM model_metadata
            ) sub
            ORDER BY model_name
        `;
        return { success: true, missing: rows.map((row: any) => row.model_name), count: rows.length };
    })
    .get('/models/sync_upstream/preview', async () => {
        const rows = await sql`SELECT id, name, models FROM channels WHERE status = 1 ORDER BY id DESC`;
        return {
            success: true,
            channels: rows.map((row: any) => ({
                id: row.id,
                name: row.name,
                modelCount: Array.isArray(row.models) ? row.models.length : 0,
            })),
        };
    })
    .post('/models/sync_upstream', async () => {
        return { success: true, message: 'Use /api/channel/upstream_updates/* for channel-level upstream sync.', applied: false };
    })

    // New API: /api/ratio_sync/*
    .get('/ratio_sync/channels', async () => {
        return await sql`
            SELECT id, name, type, base_url AS "baseUrl", status
            FROM channels
            WHERE status = 1
            ORDER BY id DESC
        `;
    })
    .post('/ratio_sync/fetch', async () => {
        return {
            success: true,
            modelRatio: optionCache.get('ModelRatio', {}),
            completionRatio: optionCache.get('CompletionRatio', {}),
            groupRatio: optionCache.get('GroupRatio', {}),
        };
    })

    // New API: /api/vendors/*
    .get('/vendors', async () => {
        return await sql`
            SELECT id, name, type, base_url AS "baseUrl", logo_url AS "logoUrl", description, config, created_at AS "createdAt", updated_at AS "updatedAt"
            FROM vendors
            ORDER BY name
        `;
    })
    .get('/vendors/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        return await sql`
            SELECT id, name, type, base_url AS "baseUrl", logo_url AS "logoUrl", description
            FROM vendors
            WHERE (${keyword || null} IS NULL OR name ILIKE ${'%' + keyword + '%'} OR CAST(type AS TEXT) ILIKE ${'%' + keyword + '%'})
            ORDER BY name
            LIMIT 50
        `;
    })

    // New API: /api/deployments/* minimal compatibility
    .get('/deployments', ({ set }: ElysiaCtx) => notImplemented(set, 'Deployment management is not implemented.'))
    .get('/deployments/settings', ({ set }: ElysiaCtx) => notImplemented(set, 'Deployment management is not implemented.'));
