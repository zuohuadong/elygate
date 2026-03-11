import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';
import { type UserRecord } from '../types';

export const userStatsRouter = new Elysia({ prefix: '/user' })
    .use(authPlugin)
    .get('/dashboard/stats', async ({ user, query }: any) => {
        const u = user as UserRecord;
        const { period } = query as any;
        
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
            ? sql`user_id = ${u.id} AND created_at >= ${startDate} AND created_at < ${new Date(new Date().setHours(0, 0, 0, 0))}`
            : sql`user_id = ${u.id} AND created_at >= ${startDate}`;

        // 1. Overview
        const [overview] = await sql`
            SELECT 
                COUNT(*)::int as total_requests,
                COALESCE(SUM(quota_cost), 0)::bigint as total_cost,
                COALESCE(SUM(prompt_tokens), 0)::bigint as total_prompt_tokens,
                COALESCE(SUM(completion_tokens), 0)::bigint as total_completion_tokens,
                ROUND(COALESCE(AVG(CASE WHEN elapsed_ms > 0 THEN elapsed_ms ELSE NULL END), 0))::int as avg_latency
            FROM logs
            WHERE ${condition}
        `;

        // 2. Model breakdown
        const models = await sql`
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
            LIMIT 10
        `;

        // 3. Time series
        let timeSeries;
        if (period === '7d' || period === '30d') {
            timeSeries = await sql`
                SELECT 
                    DATE(created_at) as date,
                    COUNT(*)::int as requests,
                    COALESCE(SUM(quota_cost), 0)::bigint as cost
                FROM logs
                WHERE ${condition}
                GROUP BY DATE(created_at)
                ORDER BY date ASC
            `;
        } else {
            timeSeries = await sql`
                SELECT 
                    EXTRACT(HOUR FROM created_at) as hour,
                    COUNT(*)::int as requests,
                    COALESCE(SUM(quota_cost), 0)::bigint as cost
                FROM logs
                WHERE ${condition}
                GROUP BY EXTRACT(HOUR FROM created_at)
                ORDER BY hour ASC
            `;
        }

        return {
            overview,
            models,
            time_series: timeSeries
        };
    });
