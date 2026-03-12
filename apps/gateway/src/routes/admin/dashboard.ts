import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { memoryCache } from '../../services/cache';
import { modelConfig } from './channels';

export const dashboardRouter = new Elysia()
    .get('/dashboard/stats', async () => {
        const [stats] = await sql`
            SELECT 
                (SELECT count(*) FROM users)::int as "totalUsers",
                (SELECT count(*) FROM channels WHERE status = 1)::int as "activeChannels",
                (SELECT COALESCE(sum(quota), 0) FROM users)::bigint as "totalQuota",
                (SELECT COALESCE(sum(used_quota), 0) FROM users)::bigint as "usedQuota",
                (SELECT COALESCE(sum(quota_cost), 0) FROM logs WHERE created_at >= CURRENT_DATE)::bigint as "todayQuota"
        `;
        return stats;
    })

    .get('/dashboard/errors', async () => {
        const errorLogs = await sql`
            SELECT 
                COALESCE(error_message, 'Unknown Error') as title,
                ip,
                COUNT(*) as count
            FROM logs
            WHERE status_code >= 400
            AND created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY error_message, ip
            ORDER BY count DESC
            LIMIT 5
        `;
        return errorLogs;
    })

    .get('/stats/granular', async ({ query }: any) => {
        const { start, end, group_by } = query as any;
        const startDate = start ? new Date(start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const endDate = end ? new Date(end) : new Date();

        let groupByClause = sql`DATE(created_at)`;
        if (group_by === 'model') groupByClause = sql`model_name`;

        const stats = await sql`
            SELECT 
                ${groupByClause} as label,
                SUM(prompt_tokens) as prompt_tokens,
                SUM(completion_tokens) as completion_tokens,
                COUNT(*) as count
            FROM logs
            WHERE created_at BETWEEN ${startDate} AND ${endDate}
            GROUP BY 1
            ORDER BY 1 ASC
        `;
        return stats;
    })

    .get('/dashboard/period_stats', async ({ query }: any) => {
        const { period, timezone } = query as any;
        const tz = timezone || 'UTC';
        
        let startDate = new Date();
        startDate.setHours(0, 0, 0, 0);

        const now = new Date();
        switch (period) {
            case 'yesterday':
                startDate.setDate(startDate.getDate() - 1);
                break;
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case 'today':
            default:
                break;
        }

        const condition = period === 'yesterday'
            ? sql`created_at >= ${startDate} AND created_at < ${new Date(new Date().setHours(0, 0, 0, 0))}`
            : sql`created_at >= ${startDate}`;

        const [overview] = await sql`
            SELECT 
                COUNT(*)::int as total_requests,
                COALESCE(SUM(quota_cost), 0)::bigint as total_cost,
                COALESCE(SUM(prompt_tokens), 0)::bigint as total_prompt_tokens,
                COALESCE(SUM(completion_tokens), 0)::bigint as total_completion_tokens,
                ROUND(COALESCE(AVG(CASE WHEN elapsed_ms > 0 THEN elapsed_ms ELSE NULL END), 0))::int as avg_latency,
                COUNT(CASE WHEN channel_id = 0 THEN 1 END)::int as semantic_hits,
                COALESCE(SUM(CASE WHEN channel_id = 0 THEN quota_cost ELSE 0 END), 0)::bigint as semantic_profit_quota,
                COALESCE(SUM(CASE WHEN channel_id = 0 THEN prompt_tokens + completion_tokens ELSE 0 END), 0)::bigint as semantic_tokens,
                COUNT(CASE WHEN channel_id = -1 THEN 1 END)::int as exact_hits,
                COALESCE(SUM(CASE WHEN channel_id = -1 THEN quota_cost ELSE 0 END), 0)::bigint as exact_profit_quota,
                COALESCE(SUM(CASE WHEN channel_id = -1 THEN prompt_tokens + completion_tokens ELSE 0 END), 0)::bigint as exact_tokens,
                COUNT(CASE WHEN channel_id IN (0, -1) THEN 1 END)::int as cache_hits,
                COALESCE(SUM(CASE WHEN channel_id IN (0, -1) THEN quota_cost ELSE 0 END), 0)::bigint as cache_profit_quota,
                COALESCE(SUM(CASE WHEN channel_id IN (0, -1) THEN prompt_tokens + completion_tokens ELSE 0 END), 0)::bigint as cached_tokens
            FROM logs
            WHERE ${condition}
        `;

        let semantic_cache_size = 0;
        let semantic_cache_count = 0;
        let exact_cache_size = 0;
        let exact_cache_count = 0;

        try {
            const [semSize] = await sql`SELECT pg_total_relation_size('semantic_cache') as size`;
            const [semCount] = await sql`SELECT COUNT(*) as cnt FROM semantic_cache`;
            semantic_cache_size = Number(semSize?.size || 0);
            semantic_cache_count = Number(semCount?.cnt || 0);

            const [exSize] = await sql`SELECT pg_total_relation_size('response_cache') as size`;
            const [exCount] = await sql`SELECT COUNT(*) as cnt FROM response_cache`;
            exact_cache_size = Number(exSize?.size || 0);
            exact_cache_count = Number(exCount?.cnt || 0);
        } catch (e) {
            console.warn('[Admin] Failed to read cache sizes:', e);
        }

        const models_user = await sql`
            SELECT 
                model_name,
                COUNT(*)::int as requests,
                COALESCE(SUM(prompt_tokens + completion_tokens), 0)::bigint as tokens,
                COALESCE(SUM(quota_cost), 0)::bigint as cost,
                ROUND((COUNT(CASE WHEN status_code < 400 THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 1)::float as success_rate
            FROM logs
            WHERE ${condition}
            GROUP BY model_name
            ORDER BY cost DESC
            LIMIT 20
        `;

        const totalUserCost = Number(overview.total_cost || 1);
        models_user.forEach((m: any) => {
            m.cost_percentage = Number(((Number(m.cost) / totalUserCost) * 100).toFixed(1));
        });

        const models_channel = await sql`
            SELECT 
                model_name,
                COUNT(*)::int as requests,
                COALESCE(SUM(prompt_tokens + completion_tokens), 0)::bigint as tokens,
                COALESCE(SUM(quota_cost), 0)::bigint as cost,
                ROUND((COUNT(CASE WHEN status_code < 400 THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 1)::float as success_rate
            FROM logs
            WHERE ${condition} AND channel_id IS NOT NULL
            GROUP BY model_name
            ORDER BY cost DESC
            LIMIT 20
        `;

        const totalChannelCost = models_channel.reduce((sum: any, m: any) => sum + Number(m.cost), 0) || 1;
        models_channel.forEach((m: any) => {
            m.cost_percentage = Number(((Number(m.cost) / totalChannelCost) * 100).toFixed(1));
        });
        
        let timeSeries;
        if (period === '7d' || period === '30d') {
            timeSeries = await sql`
                SELECT 
                    DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) as date,
                    COUNT(*)::int as requests,
                    COALESCE(SUM(quota_cost), 0)::bigint as cost
                FROM logs
                WHERE ${condition}
                GROUP BY 1
                ORDER BY date ASC
            `;
        } else {
            timeSeries = await sql`
                SELECT 
                    EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) as hour,
                    COUNT(*)::int as requests,
                    COALESCE(SUM(quota_cost), 0)::bigint as cost
                FROM logs
                WHERE ${condition}
                GROUP BY 1
                ORDER BY hour ASC
            `;
        }

        return {
            overview: {
                ...overview,
                semantic_cache_size,
                semantic_cache_count,
                exact_cache_size,
                exact_cache_count,
                cache_size_bytes: semantic_cache_size,
                cache_record_count: semantic_cache_count
            },
            models_user,
            models_channel,
            time_series: timeSeries
        };
    })

    // --- Models List ---
    .get('/models', async () => {
        const allModelIds = new Set<string>();
        const modelToChannels = new Map<string, any[]>();

        for (const channel of memoryCache.channels.values()) {
            let supportedModels: string[] = [];
            if (Array.isArray(channel.models)) {
                supportedModels = channel.models;
            } else if (typeof channel.models === 'string') {
                try {
                    supportedModels = JSON.parse(channel.models);
                } catch {
                    supportedModels = (channel.models as string).split(',').map((s: string) => s.trim());
                }
            }

            for (const m of supportedModels) {
                allModelIds.add(m);
                if (!modelToChannels.has(m)) modelToChannels.set(m, []);
                modelToChannels.get(m)!.push(channel);
            }
        }

        const metaMap = new Map<string, any>();
        for (const provider of Object.values(modelConfig as any)) {
            if ((provider as any).models && Array.isArray((provider as any).models)) {
                for (const m of (provider as any).models) {
                    metaMap.set(m.id, m);
                }
            }
        }

        const metrics = await sql`
            SELECT channel_id, AVG(latency) as avg_latency
            FROM (
                SELECT channel_id, latency
                FROM health_logs
                WHERE status = 1
                ORDER BY created_at DESC
                LIMIT 1000
            ) t
            GROUP BY channel_id
        `;
        const channelLatencyMap = new Map<number, number>();
        metrics.forEach((m: any) => channelLatencyMap.set(m.channel_id, Number(m.avg_latency)));

        return Array.from(allModelIds).map(modelId => {
            const meta = metaMap.get(modelId);
            const channels = modelToChannels.get(modelId) || [];

            const activeChannels = channels.filter(ch => ch.status === 1 || ch.status === 4);
            const isOnline = activeChannels.length > 0;

            let avgLatency = 0;
            if (isOnline) {
                const latencies = activeChannels
                    .map(ch => channelLatencyMap.get(ch.id))
                    .filter((l): l is number => l !== undefined && l > 0);
                if (latencies.length > 0) {
                    avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
                }
            }

            let status = isOnline ? 'online' : 'offline';
            if (isOnline && avgLatency > 3000) {
                status = 'busy';
            }

            let displayName = meta?.name || modelId;

            if (displayName.includes('/')) {
                const prefixMatch = displayName.match(/^([a-zA-Z0-9\-_]+)\/(.+)$/);
                if (prefixMatch) displayName = prefixMatch[2];
            } else if (displayName.includes(':')) {
                const prefixMatch = displayName.match(/^([a-zA-Z0-9\-_]+):(.+)$/);
                if (prefixMatch) displayName = prefixMatch[2];
            }

            return {
                id: modelId,
                name: displayName,
                description: meta?.description || '',
                status,
                latency: Math.round(avgLatency),
                object: 'model'
            };
        });
    });
