import type { ElysiaCtx } from '../../types';
import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { quotaToUSD, quotaToRMB } from '../../services/ratio';
import { getAuditLogs } from '../../services/auditLog';
import { memoryCache } from '../../services/cache';

export const logsRouter = new Elysia()
    .get('/logs', async ({ query }: any) => {
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        const userId = query?.user_id;
        const channelId = query?.channel_id;
        const modelName = query?.model;
        const statusCode = query?.status_code;
        const search = query?.keyword;

        let whereClause = sql`WHERE 1=1`;
        if (userId) whereClause = sql`${whereClause} AND user_id = ${Number(userId)}`;
        if (channelId) whereClause = sql`${whereClause} AND channel_id = ${Number(channelId)}`;
        if (modelName) whereClause = sql`${whereClause} AND model_name = ${modelName}`;
        if (statusCode) whereClause = sql`${whereClause} AND status_code = ${Number(statusCode)}`;
        if (search) whereClause = sql`${whereClause} AND (prompt ILIKE ${'%' + search + '%'} OR response ILIKE ${'%' + search + '%'} OR error_message ILIKE ${'%' + search + '%'})`;

        const [countRow] = await sql`SELECT COUNT(*) as total FROM logs ${whereClause}`;
        const data = await sql`
            SELECT 
                l.*, 
                u.username as creator_name,
                c.name as channel_name
            FROM logs l
            LEFT JOIN users u ON l.user_id = u.id
            LEFT JOIN channels c ON l.channel_id = c.id
            ${whereClause}
            ORDER BY l.created_at DESC 
            LIMIT ${limit} OFFSET ${offset}
        `;

        return {
            data: data.map((l: Record<string, any>) => ({
                ...l,
                channel_name: l.channel_id === -1 
                    ? (query?.lang === 'zh' ? '系统精确缓存' : 'Exact Match Cache')
                    : l.channel_id === 0 
                        ? (query?.lang === 'zh' ? '系统语义缓存' : 'Semantic Cache') 
                        : (l.channel_name || `Unknown (${l.channel_id})`),
                cost_usd: quotaToUSD(l.quota_cost),
                cost_rmb: quotaToRMB(l.quota_cost),
                cached_tokens: l.cached_tokens || 0,
                elapsed_ms: l.elapsed_ms || 0
            })),
            total: countRow.total,
            page,
            limit
        };
    })

    .get('/logs/export', async ({ query, set }: any) => {
        const userId = query?.user_id;
        const channelId = query?.channel_id;
        const modelName = query?.model;
        const statusCode = query?.status_code;
        const search = query?.keyword;
        const format = query?.format || 'csv';

        let whereClause = sql`WHERE 1=1`;
        if (userId) whereClause = sql`${whereClause} AND user_id = ${Number(userId)}`;
        if (channelId) whereClause = sql`${whereClause} AND channel_id = ${Number(channelId)}`;
        if (modelName) whereClause = sql`${whereClause} AND model_name = ${modelName}`;
        if (statusCode) whereClause = sql`${whereClause} AND status_code = ${Number(statusCode)}`;
        if (search) whereClause = sql`${whereClause} AND (prompt ILIKE ${'%' + search + '%'} OR response ILIKE ${'%' + search + '%'} OR error_message ILIKE ${'%' + search + '%'})`;

        const data = await sql`
            SELECT l.*, u.username as creator_name
            FROM logs l
            LEFT JOIN users u ON l.user_id = u.id
            ${whereClause}
            ORDER BY l.created_at DESC 
            LIMIT 10000
        `;

        const logs = data.map((l: Record<string, any>) => ({
            id: l.id,
            created_at: l.created_at,
            user_id: l.user_id,
            username: l.creator_name || '',
            channel_id: l.channel_id,
            model_name: l.model_name,
            prompt_tokens: l.prompt_tokens,
            completion_tokens: l.completion_tokens,
            cached_tokens: l.cached_tokens || 0,
            total_tokens: (l.prompt_tokens || 0) + (l.completion_tokens || 0),
            quota_cost: l.quota_cost,
            cost_usd: quotaToUSD(l.quota_cost),
            cost_rmb: quotaToRMB(l.quota_cost),
            status_code: l.status_code,
            latency_ms: l.latency_ms,
            ip: l.ip,
            prompt: l.prompt || '',
            response: l.response || '',
            error_message: l.error_message || ''
        }));

        if (format === 'json') {
            set.headers['Content-Type'] = 'application/json';
            set.headers['Content-Disposition'] = 'attachment; filename="logs_export.json"';
            return JSON.stringify(logs, null, 2);
        }

        const csvHeaders = [
            'ID', 'Created At', 'User ID', 'Username', 'Channel ID', 'Model',
            'Prompt Tokens', 'Completion Tokens', 'Cached Tokens', 'Total Tokens', 'Quota Cost',
            'Cost USD', 'Cost RMB', 'Status Code', 'Latency MS', 'IP',
            'Prompt', 'Response', 'Error Message'
        ].join(',');

        const csvRows = logs.map((l: Record<string, any>) => [
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
        const channels = Array.from(memoryCache.channels.values());
        return channels.map(ch => ({
            id: ch.id,
            name: ch.name,
            status: ch.status,
            statusText: ch.status === 1 ? 'Active' : ch.status === 3 ? 'Prohibited' : ch.status === 4 ? 'Half-Open' : 'Unknown'
        }));
    })

    .get('/health-logs', async ({ query }: any) => {
        const channelId = query?.channel_id;
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        let whereClause = sql`WHERE 1=1`;
        if (channelId) whereClause = sql`${whereClause} AND hl.channel_id = ${Number(channelId)}`;

        const [countRow] = await sql`SELECT COUNT(*) as total FROM health_logs hl ${whereClause}`;
        const data = await sql`
            SELECT hl.*, c.name as channel_name, c.type as channel_type
            FROM health_logs hl
            LEFT JOIN channels c ON hl.channel_id = c.id
            ${whereClause}
            ORDER BY hl.created_at DESC 
            LIMIT ${limit} OFFSET ${offset}
        `;

        return {
            data: data.map((l: Record<string, any>) => ({
                id: l.id,
                channel_id: l.channel_id,
                channel_name: l.channel_name || 'Unknown',
                channel_type: l.channel_type,
                status: l.status,
                status_text: l.status === 1 ? 'Healthy' : 'Failed',
                latency: l.latency,
                error_message: l.error_message,
                created_at: l.created_at
            })),
            total: countRow.total,
            page,
            limit
        };
    })

    .get('/health-summary', async () => {
        const summary = await sql`
            SELECT 
                c.id,
                c.name,
                c.type,
                c.status,
                c.test_errors,
                c.test_at,
                COUNT(hl.id) as total_checks,
                COUNT(CASE WHEN hl.status = 1 THEN 1 END) as successful_checks,
                COUNT(CASE WHEN hl.status = 0 THEN 1 END) as failed_checks,
                AVG(CASE WHEN hl.status = 1 THEN hl.latency END) as avg_latency,
                MAX(hl.created_at) as last_check
            FROM channels c
            LEFT JOIN health_logs hl ON c.id = hl.channel_id
            WHERE hl.created_at >= NOW() - INTERVAL '24 hours' OR hl.id IS NULL
            GROUP BY c.id, c.name, c.type, c.status, c.test_errors, c.test_at
            ORDER BY c.id
        `;
        return summary.map((s: Record<string, any>) => ({
            ...s,
            success_rate: s.total_checks > 0 ? ((s.successful_checks / s.total_checks) * 100).toFixed(1) : 'N/A',
            avg_latency: s.avg_latency ? Math.round(s.avg_latency) : null
        }));
    })

    .get('/audit-logs', async ({ query }: any) => {
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
    });
