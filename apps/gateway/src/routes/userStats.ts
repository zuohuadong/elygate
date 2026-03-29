import type { ElysiaCtx } from '../types';
import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';
import type { UserRecord  } from '../types';

export const userStatsRouter = new Elysia({ prefix: '/user' })
    .use(authPlugin)
    .get('/info', async ({ user }: ElysiaCtx) => {
        const u = user as UserRecord;
        const [userInfo] = await sql`
            SELECT id, username, role, quota, used_quota as "usedQuota", status, currency
            FROM users
            WHERE id = ${u.id}
        `;
        return userInfo || { id: 0, username: '', role: 0, quota: 0, usedQuota: 0, status: 0, currency: 'USD' };
    })
    .get('/tokens', async ({ user }: ElysiaCtx) => {
        const u = user as UserRecord;
        const tokens = await sql`
            SELECT id, name, key, status, remain_quota as "remainQuota", used_quota as "usedQuota", created_at as "createdAt"
            FROM tokens
            WHERE user_id = ${u.id}
            ORDER BY created_at DESC
        `;
        return tokens;
    })
    .get('/logs', async ({ user, query }: ElysiaCtx) => {
        const u = user as UserRecord;
        const limit = parseInt((query as Record<string, string>).limit) || 10;
        
        const logs = await sql`
            SELECT 
                id,
                model_name as "modelName",
                prompt_tokens as "promptTokens",
                completion_tokens as "completionTokens",
                quota_cost as "quotaCost",
                created_at as "createdAt",
                CASE WHEN status_code < 400 THEN true ELSE false END as "isSuccess"
            FROM logs
            WHERE user_id = ${u.id}
            ORDER BY created_at DESC
            LIMIT ${limit}
        `;
        return logs;
    })
    .get('/dashboard/stats', async ({ user, query }: ElysiaCtx) => {
        const u = user as UserRecord;
        const { period } = query as Record<string, string>;
        
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
