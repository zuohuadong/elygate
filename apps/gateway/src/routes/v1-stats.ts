import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import type { ElysiaCtx } from '../types';

export const v1StatsRouter = new Elysia()
    .get('/statistics', async ({ user }: ElysiaCtx) => {
        if (!user) {
            throw new Error('Unauthorized');
        }

        const [todayStats] = await sql`
            SELECT 
                COUNT(*)::int as todayTasks,
                COUNT(CASE WHEN status != 1 THEN 1 END)::int as failedTasks
            FROM logs 
            WHERE created_at >= CURRENT_DATE
            AND user_id = ${user.id}
        `;

        return {
            message: 'success',
            todayTasks: todayStats?.todaytasks || todayStats?.todayTasks || 0,
            failedTasks: todayStats?.failedtasks || todayStats?.failedTasks || 0
        };
    });
