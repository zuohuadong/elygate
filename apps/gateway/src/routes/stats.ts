import type { ElysiaCtx } from '../types';
import { Elysia, t } from 'elysia';
import { getErrorMessage } from '../utils/error';
import { db } from '@elygate/db';
import { logs, dailyStats, modelStats, channels } from '@elygate/db/schema';
import { eq, and, desc, count, sum, sql as drizzleSql } from 'drizzle-orm';
import { adminGuard } from '../middleware/auth';

// Stats Router - prefix will be applied in index.ts
export const statsRouter = new Elysia()
    .use(adminGuard)
    .get('/overview', async () => {
        const [overviewMV] = await db.execute(drizzleSql`
            SELECT * FROM mv_system_overview LIMIT 1
        `) as any[];

        const [dynamic24h] = await db.select({
            requests24h: drizzleSql<number>`count(*)::int`,
            cost24h: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
        }).from(logs).where(
            drizzleSql`${logs.createdAt} >= NOW() - INTERVAL '24 hours'`
        );

        const [todayStats] = await db.select({
            request_count: drizzleSql<number>`count(*)::int`,
            total_cost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
            total_tokens: drizzleSql<string>`coalesce(sum(${logs.promptTokens} + ${logs.completionTokens}), 0)::bigint`,
            stream_count: drizzleSql<number>`count(case when ${logs.isStream} = true then 1 end)::int`,
        }).from(logs).where(
            drizzleSql`${logs.createdAt} >= CURRENT_DATE`
        );

        const hourlyStats = await db.select({
            hour: drizzleSql<number>`extract(hour from ${logs.createdAt})::int`,
            request_count: drizzleSql<number>`count(*)::int`,
            total_cost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
        }).from(logs).where(
            drizzleSql`${logs.createdAt} >= NOW() - INTERVAL '24 hours'`
        ).groupBy(drizzleSql`extract(hour from ${logs.createdAt})`)
         .orderBy(drizzleSql`extract(hour from ${logs.createdAt})`);

        return {
            overview: {
                ...overviewMV,
                requests_24h: dynamic24h?.requests24h || 0,
                cost_24h: dynamic24h?.cost24h || 0
            },
            today: todayStats,
            hourly: hourlyStats
        };
    })

    .get('/users/:userId', async ({ params: { userId } }: ElysiaCtx) => {
        const numUserId = Number(userId);

        const dailyStatsRows = await db.select({
            stat_date: dailyStats.statDate,
            request_count: dailyStats.requestCount,
            total_tokens: dailyStats.totalTokens,
            total_cost: dailyStats.totalCost,
            success_count: dailyStats.successCount,
            error_count: dailyStats.errorCount,
            success_rate: drizzleSql<string>`round((${dailyStats.successCount}::numeric / nullif(${dailyStats.requestCount}, 0)) * 100, 2)`,
        }).from(dailyStats).where(eq(dailyStats.userId, numUserId))
          .orderBy(desc(dailyStats.statDate))
          .limit(30);

        const modelUsage = await db.select({
            model_name: modelStats.modelName,
            request_count: modelStats.requestCount,
            total_tokens: modelStats.totalTokens,
            total_cost: modelStats.totalCost,
            avg_tokens_per_request: modelStats.avgTokensPerRequest,
            last_used_at: modelStats.lastUsedAt,
        }).from(modelStats).where(eq(modelStats.userId, numUserId))
          .orderBy(desc(modelStats.lastUsedAt))
          .limit(20);

        const [summary] = await db.select({
            total_requests: drizzleSql<string>`sum(${dailyStats.requestCount})`,
            total_tokens: drizzleSql<string>`sum(${dailyStats.totalTokens})`,
            total_cost: drizzleSql<string>`sum(${dailyStats.totalCost})`,
            avg_success_rate: drizzleSql<string>`avg(${dailyStats.successCount}::numeric / nullif(${dailyStats.requestCount}, 0) * 100)`,
        }).from(dailyStats).where(eq(dailyStats.userId, numUserId));

        return {
            daily: dailyStatsRows,
            models: modelUsage,
            summary
        };
    })

    .get('/models', async () => {
        const modelStatsRows = await db.execute(drizzleSql`
            SELECT * FROM mv_model_usage_stats
            ORDER BY total_requests DESC
            LIMIT 50
        `) as any[];

        const trendingModels = await db.select({
            model_name: logs.modelName,
            request_count: count(),
            total_cost: sum(logs.quotaCost),
            total_tokens: drizzleSql<string>`sum(${logs.promptTokens} + ${logs.completionTokens})`,
        }).from(logs).where(
            drizzleSql`${logs.createdAt} >= NOW() - INTERVAL '7 days'`
        ).groupBy(logs.modelName)
         .orderBy(desc(count()))
         .limit(10);

        return {
            all: modelStatsRows,
            trending: trendingModels
        };
    })

    .get('/channels/:channelId', async ({ params: { channelId } }: ElysiaCtx) => {
        const numChannelId = Number(channelId);

        const channelStats = await db.select({
            date: drizzleSql<string>`date(${logs.createdAt})`,
            request_count: count(),
            total_cost: sum(logs.quotaCost),
            total_tokens: drizzleSql<string>`sum(${logs.promptTokens} + ${logs.completionTokens})`,
            unique_users: drizzleSql<number>`count(distinct ${logs.userId})`,
        }).from(logs).where(and(
            eq(logs.channelId, numChannelId),
            drizzleSql`${logs.createdAt} >= NOW() - INTERVAL '30 days'`,
        )).groupBy(drizzleSql`date(${logs.createdAt})`)
          .orderBy(drizzleSql`date(${logs.createdAt}) desc`);

        const [summary] = await db.select({
            total_requests: count(),
            total_cost: sum(logs.quotaCost),
            unique_users: drizzleSql<number>`count(distinct ${logs.userId})`,
            unique_models: drizzleSql<number>`count(distinct ${logs.modelName})`,
        }).from(logs).where(and(
            eq(logs.channelId, numChannelId),
            drizzleSql`${logs.createdAt} >= NOW() - INTERVAL '30 days'`,
        ));

        return {
            daily: channelStats,
            summary
        };
    })

    .get('/heatmap', async () => {
        const heatmapData = await db.select({
            hour: drizzleSql<number>`extract(hour from ${logs.createdAt})`,
            day_of_week: drizzleSql<number>`extract(dow from ${logs.createdAt})`,
            request_count: count(),
            avg_cost: drizzleSql<string>`avg(${logs.quotaCost})`,
        }).from(logs).where(
            drizzleSql`${logs.createdAt} >= NOW() - INTERVAL '30 days'`
        ).groupBy(
            drizzleSql`extract(hour from ${logs.createdAt})`,
            drizzleSql`extract(dow from ${logs.createdAt})`,
        ).orderBy(
            drizzleSql`extract(dow from ${logs.createdAt})`,
            drizzleSql`extract(hour from ${logs.createdAt})`,
        );

        return heatmapData;
    })

    .get('/errors', async () => {
        const errorStats = await db.select({
            model_name: logs.modelName,
            error_count: count(),
            error_percentage: drizzleSql<string>`count(*) * 100.0 / sum(count(*)) over()`,
        }).from(logs).where(and(
            drizzleSql`${logs.createdAt} >= NOW() - INTERVAL '24 hours'`,
            eq(logs.quotaCost, 0),
        )).groupBy(logs.modelName)
          .orderBy(desc(count()))
          .limit(10);

        return errorStats;
    })

    .get('/realtime', async () => {
        const [realtimeStats] = await db.select({
            requests_per_minute: drizzleSql<number>`count(*)::int`,
            cost_per_minute: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
            tokens_per_minute: drizzleSql<string>`coalesce(sum(${logs.promptTokens} + ${logs.completionTokens}), 0)::bigint`,
            active_users: drizzleSql<number>`count(distinct ${logs.userId})::int`,
            active_models: drizzleSql<number>`count(distinct ${logs.modelName})::int`,
        }).from(logs).where(
            drizzleSql`${logs.createdAt} >= NOW() - INTERVAL '1 minute'`
        );

        const topModels = await db.select({
            model_name: logs.modelName,
            request_count: count(),
        }).from(logs).where(
            drizzleSql`${logs.createdAt} >= NOW() - INTERVAL '5 minutes'`
        ).groupBy(logs.modelName)
         .orderBy(desc(count()))
         .limit(5);

        return {
            stats: realtimeStats || {
                requests_per_minute: 0,
                cost_per_minute: 0,
                tokens_per_minute: 0,
                active_users: 0,
                active_models: 0
            },
            topModels
        };
    })

    .post('/refresh', async ({ set }: ElysiaCtx) => {
        try {
            await db.execute(drizzleSql`SELECT refresh_materialized_views()`);
            return { success: true, message: 'Materialized views refreshed' };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    });
