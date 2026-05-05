import type { ElysiaCtx } from '../../types';
import { log } from '../../services/logger';
import { Elysia } from 'elysia';
import { db, sql } from '@elygate/db';
import { logs, users, channels, healthLogs } from '@elygate/db/schema';
import { eq, and, desc, count, sum, isNotNull, gte, lt, sql as drizzleSql } from 'drizzle-orm';
import { memoryCache } from '../../services/cache';
import { modelConfig } from './channels';
import { statsService } from '../../services/stats';

export const dashboardRouter = new Elysia()
    .get('/dashboard/health', () => statsService.getSystemHealth())
    .get('/dashboard/latency-heatmap', () => statsService.getLatencyHeatmap())
    .get('/dashboard/stats', async () => {
        const [totalUsersRow] = await db.select({ count: count() }).from(users);
        const [activeChannelsRow] = await db.select({ count: count() }).from(channels).where(eq(channels.status, 1));
        const [totalQuotaRow] = await db.select({ total: drizzleSql<string>`coalesce(sum(${users.quota}), 0)` }).from(users);
        const [usedQuotaRow] = await db.select({ total: drizzleSql<string>`coalesce(sum(${users.usedQuota}), 0)` }).from(users);
        const [todayQuotaRow] = await db.select({ total: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)` }).from(logs).where(
            drizzleSql`${logs.createdAt} >= CURRENT_DATE`
        );

        return {
            totalUsers: totalUsersRow.count,
            activeChannels: activeChannelsRow.count,
            totalQuota: totalQuotaRow.total,
            usedQuota: usedQuotaRow.total,
            todayQuota: todayQuotaRow.total,
        };
    })

    .get('/dashboard/errors', async () => {
        const errorLogs = await db.select({
            title: drizzleSql<string>`coalesce(${logs.errorMessage}, 'Unknown Error')`,
            ip: logs.ipAddress,
            count: count(),
        }).from(logs).where(and(
            gte(logs.statusCode, 400),
            drizzleSql`${logs.createdAt} >= NOW() - INTERVAL '24 hours'`,
        )).groupBy(logs.errorMessage, logs.ipAddress)
          .orderBy(desc(count()))
          .limit(5);

        return errorLogs;
    })

    .get('/stats/granular', async ({ query }: ElysiaCtx) => {
        const { start, end, group_by } = query as Record<string, string>;
        const startDate = start ? new Date(start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const endDate = end ? new Date(end) : new Date();

        const groupByExpr = group_by === 'model' ? logs.modelName : drizzleSql`date(${logs.createdAt})`;

        const stats = await db.select({
            label: groupByExpr,
            prompt_tokens: sum(logs.promptTokens),
            completion_tokens: sum(logs.completionTokens),
            count: count(),
        }).from(logs).where(
            drizzleSql`${logs.createdAt} BETWEEN ${startDate} AND ${endDate}`
        ).groupBy(groupByExpr)
         .orderBy(groupByExpr);

        return stats;
    })

    .get('/dashboard/period_stats', async ({ query }: ElysiaCtx) => {
        const { period, timezone } = query as Record<string, string>;
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

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const conditions = period === 'yesterday'
            ? and(gte(logs.createdAt, startDate), lt(logs.createdAt, todayStart))
            : gte(logs.createdAt, startDate);

        const [overview] = await db.select({
            total_requests: drizzleSql<number>`count(*)::int`,
            total_cost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
            total_prompt_tokens: drizzleSql<string>`coalesce(sum(${logs.promptTokens}), 0)::bigint`,
            total_completion_tokens: drizzleSql<string>`coalesce(sum(${logs.completionTokens}), 0)::bigint`,
            avg_latency: drizzleSql<number>`round(coalesce(avg(case when ${logs.elapsedMs} > 0 then ${logs.elapsedMs} else null end), 0))::int`,
            semantic_hits: drizzleSql<number>`count(case when ${logs.channelId} = 0 then 1 end)::int`,
            semantic_profit_quota: drizzleSql<string>`coalesce(sum(case when ${logs.channelId} = 0 then ${logs.quotaCost} else 0 end), 0)::bigint`,
            semantic_tokens: drizzleSql<string>`coalesce(sum(case when ${logs.channelId} = 0 then ${logs.promptTokens} + ${logs.completionTokens} else 0 end), 0)::bigint`,
            exact_hits: drizzleSql<number>`count(case when ${logs.channelId} = -1 then 1 end)::int`,
            exact_profit_quota: drizzleSql<string>`coalesce(sum(case when ${logs.channelId} = -1 then ${logs.quotaCost} else 0 end), 0)::bigint`,
            exact_tokens: drizzleSql<string>`coalesce(sum(case when ${logs.channelId} = -1 then ${logs.promptTokens} + ${logs.completionTokens} else 0 end), 0)::bigint`,
            cache_hits: drizzleSql<number>`count(case when ${logs.channelId} in (0, -1) then 1 end)::int`,
            cache_profit_quota: drizzleSql<string>`coalesce(sum(case when ${logs.channelId} in (0, -1) then ${logs.quotaCost} else 0 end), 0)::bigint`,
            cached_tokens: drizzleSql<string>`coalesce(sum(case when ${logs.channelId} in (0, -1) then ${logs.promptTokens} + ${logs.completionTokens} else 0 end), 0)::bigint`,
        }).from(logs).where(conditions);

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
        } catch (e: unknown) {
            log.warn('[Admin] Failed to read cache sizes:', e);
        }

        const models_user = await db.select({
            model_name: logs.modelName,
            requests: drizzleSql<number>`count(*)::int`,
            tokens: drizzleSql<string>`coalesce(sum(${logs.promptTokens} + ${logs.completionTokens}), 0)::bigint`,
            cost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
            success_rate: drizzleSql<number>`round((count(case when ${logs.statusCode} < 400 then 1 end)::numeric / nullif(count(*), 0)) * 100, 1)::float`,
        }).from(logs).where(conditions)
          .groupBy(logs.modelName)
          .orderBy(desc(drizzleSql`coalesce(sum(${logs.quotaCost}), 0)`))
          .limit(20);

        const totalUserCost = Number(overview.total_cost || 1);
        models_user.forEach((m: Record<string, any>) => {
            m.cost_percentage = Number(((Number(m.cost) / totalUserCost) * 100).toFixed(1));
        });

        const models_channel = await db.select({
            model_name: logs.modelName,
            requests: drizzleSql<number>`count(*)::int`,
            tokens: drizzleSql<string>`coalesce(sum(${logs.promptTokens} + ${logs.completionTokens}), 0)::bigint`,
            cost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
            success_rate: drizzleSql<number>`round((count(case when ${logs.statusCode} < 400 then 1 end)::numeric / nullif(count(*), 0)) * 100, 1)::float`,
        }).from(logs).where(and(
            conditions,
            isNotNull(logs.channelId),
        ))
          .groupBy(logs.modelName)
          .orderBy(desc(drizzleSql`coalesce(sum(${logs.quotaCost}), 0)`))
          .limit(20);

        const totalChannelCost = models_channel.reduce((acc: number, m: Record<string, any>) => acc + Number(m.cost), 0) || 1;
        models_channel.forEach((m: Record<string, any>) => {
            m.cost_percentage = Number(((Number(m.cost) / totalChannelCost) * 100).toFixed(1));
        });

        let timeSeries;
        if (period === '7d' || period === '30d') {
            timeSeries = await db.select({
                date: drizzleSql<string>`date(${logs.createdAt} at time zone 'UTC' at time zone ${tz})`,
                requests: drizzleSql<number>`count(*)::int`,
                cost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
            }).from(logs).where(conditions)
              .groupBy(drizzleSql`date(${logs.createdAt} at time zone 'UTC' at time zone ${tz})`)
              .orderBy(drizzleSql`date(${logs.createdAt} at time zone 'UTC' at time zone ${tz}) asc`);
        } else {
            timeSeries = await db.select({
                hour: drizzleSql<number>`extract(hour from ${logs.createdAt} at time zone 'UTC' at time zone ${tz})`,
                requests: drizzleSql<number>`count(*)::int`,
                cost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
            }).from(logs).where(conditions)
              .groupBy(drizzleSql`extract(hour from ${logs.createdAt} at time zone 'UTC' at time zone ${tz})`)
              .orderBy(drizzleSql`extract(hour from ${logs.createdAt} at time zone 'UTC' at time zone ${tz}) asc`);
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
        for (const provider of Object.values(modelConfig as Record<string, any>)) {
            if ((provider as Record<string, any>).models && Array.isArray((provider as Record<string, any>).models)) {
                for (const m of (provider as Record<string, any>).models) {
                    metaMap.set(m.id, m);
                }
            }
        }

        const recentHealthRows = await db.select({
            channelId: healthLogs.channelId,
            latency: healthLogs.latency,
        }).from(healthLogs)
          .where(eq(healthLogs.status, 1))
          .orderBy(desc(healthLogs.createdAt))
          .limit(1000);

        const channelLatencyMap = new Map<number, number>();
        const channelLatencies = new Map<number, number[]>();
        for (const row of recentHealthRows) {
            const arr = channelLatencies.get(row.channelId) || [];
            arr.push(row.latency ?? 0);
            channelLatencies.set(row.channelId, arr);
        }
        for (const [chId, lats] of channelLatencies) {
            const avg = lats.reduce((a, b) => a + b, 0) / lats.length;
            channelLatencyMap.set(chId, avg);
        }

        return Array.from(allModelIds).map(modelId => {
            const meta = metaMap.get(modelId);
            const channelList = modelToChannels.get(modelId) || [];

            const activeChannelList = channelList.filter(ch => ch.status === 1 || ch.status === 4);
            const isOnline = activeChannelList.length > 0;

            let avgLatency = 0;
            if (isOnline) {
                const latencies = activeChannelList
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
