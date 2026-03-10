import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { adminGuard } from '../middleware/auth';

// Stats Router - prefix will be applied in index.ts
export const statsRouter = new Elysia()
    .use(adminGuard)
    .get('/overview', async () => {
        const [overview] = await sql`
            SELECT * FROM mv_system_overview LIMIT 1
        `;

        const [todayStats] = await sql`
            SELECT 
                COUNT(*) as request_count,
                SUM(quota_cost) as total_cost,
                SUM(prompt_tokens + completion_tokens) as total_tokens,
                COUNT(CASE WHEN is_stream = true THEN 1 END) as stream_count
            FROM logs 
            WHERE created_at >= CURRENT_DATE
        `;

        const [hourlyStats] = await sql`
            SELECT 
                EXTRACT(HOUR FROM created_at) as hour,
                COUNT(*) as request_count,
                SUM(quota_cost) as total_cost
            FROM logs 
            WHERE created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY EXTRACT(HOUR FROM created_at)
            ORDER BY hour
        `;

        return {
            overview,
            today: todayStats,
            hourly: hourlyStats
        };
    })

    .get('/users/:userId', async ({ params: { userId } }: any) => {
        const dailyStats = await sql`
            SELECT 
                stat_date,
                request_count,
                total_tokens,
                total_cost,
                success_count,
                error_count,
                ROUND((success_count::NUMERIC / NULLIF(request_count, 0)) * 100, 2) as success_rate
            FROM daily_stats
            WHERE user_id = ${Number(userId)}
            ORDER BY stat_date DESC
            LIMIT 30
        `;

        const modelUsage = await sql`
            SELECT 
                model_name,
                request_count,
                total_tokens,
                total_cost,
                avg_tokens_per_request,
                last_used_at
            FROM model_stats
            WHERE user_id = ${Number(userId)}
            ORDER BY last_used_at DESC
            LIMIT 20
        `;

        const [summary] = await sql`
            SELECT 
                SUM(request_count) as total_requests,
                SUM(total_tokens) as total_tokens,
                SUM(total_cost) as total_cost,
                AVG(success_count::NUMERIC / NULLIF(request_count, 0) * 100) as avg_success_rate
            FROM daily_stats
            WHERE user_id = ${Number(userId)}
        `;

        return {
            daily: dailyStats,
            models: modelUsage,
            summary
        };
    })

    .get('/models', async () => {
        const modelStats = await sql`
            SELECT * FROM mv_model_usage_stats
            ORDER BY total_requests DESC
            LIMIT 50
        `;

        const trendingModels = await sql`
            SELECT 
                model_name,
                COUNT(*) as request_count,
                SUM(quota_cost) as total_cost,
                SUM(prompt_tokens + completion_tokens) as total_tokens
            FROM logs
            WHERE created_at >= NOW() - INTERVAL '7 days'
            GROUP BY model_name
            ORDER BY request_count DESC
            LIMIT 10
        `;

        return {
            all: modelStats,
            trending: trendingModels
        };
    })

    .get('/channels/:channelId', async ({ params: { channelId } }: any) => {
        const channelStats = await sql`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as request_count,
                SUM(quota_cost) as total_cost,
                SUM(prompt_tokens + completion_tokens) as total_tokens,
                COUNT(DISTINCT user_id) as unique_users
            FROM logs
            WHERE channel_id = ${Number(channelId)}
            AND created_at >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `;

        const [summary] = await sql`
            SELECT 
                COUNT(*) as total_requests,
                SUM(quota_cost) as total_cost,
                COUNT(DISTINCT user_id) as unique_users,
                COUNT(DISTINCT model_name) as unique_models
            FROM logs
            WHERE channel_id = ${Number(channelId)}
            AND created_at >= NOW() - INTERVAL '30 days'
        `;

        return {
            daily: channelStats,
            summary
        };
    })

    .get('/heatmap', async () => {
        const heatmapData = await sql`
            SELECT 
                EXTRACT(HOUR FROM created_at) as hour,
                EXTRACT(DOW FROM created_at) as day_of_week,
                COUNT(*) as request_count,
                AVG(quota_cost) as avg_cost
            FROM logs
            WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY EXTRACT(HOUR FROM created_at), EXTRACT(DOW FROM created_at)
            ORDER BY day_of_week, hour
        `;

        return heatmapData;
    })

    .get('/errors', async () => {
        const errorStats = await sql`
            SELECT 
                model_name,
                COUNT(*) as error_count,
                COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as error_percentage
            FROM logs
            WHERE created_at >= NOW() - INTERVAL '24 hours'
            AND quota_cost = 0
            GROUP BY model_name
            ORDER BY error_count DESC
            LIMIT 10
        `;

        return errorStats;
    })

    .get('/realtime', async () => {
        const realtimeStats = await sql`
            SELECT 
                COUNT(*) as requests_per_minute,
                SUM(quota_cost) as cost_per_minute,
                COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tokens_per_minute,
                COUNT(DISTINCT user_id) as active_users,
                COUNT(DISTINCT model_name) as active_models
            FROM logs
            WHERE created_at >= NOW() - INTERVAL '1 minute'
        `;

        const topModels = await sql`
            SELECT 
                model_name,
                COUNT(*) as request_count
            FROM logs
            WHERE created_at >= NOW() - INTERVAL '5 minutes'
            GROUP BY model_name
            ORDER BY request_count DESC
            LIMIT 5
        `;

        return {
            stats: realtimeStats[0] || {
                requests_per_minute: 0,
                cost_per_minute: 0,
                tokens_per_minute: 0,
                active_users: 0,
                active_models: 0
            },
            topModels
        };
    })

    .post('/refresh', async ({ set }: any) => {
        try {
            await sql`SELECT refresh_materialized_views()`;
            return { success: true, message: 'Materialized views refreshed' };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    });
