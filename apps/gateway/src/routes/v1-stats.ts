import { Elysia } from 'elysia';
import { db, sql } from '@elygate/db';
import { logs } from '@elygate/db/schema';
import { eq, and, gte, sql as drizzleSql, count } from 'drizzle-orm';
import type { ElysiaCtx } from '../types';

export const v1StatsRouter = new Elysia()
    .get('/statistics', async ({ user }: ElysiaCtx) => {
        if (!user) {
            throw new Error('Unauthorized');
        }

        const [todayStats] = await db.select({
            todayTasks: count().as('todayTasks'),
            failedTasks: drizzleSql`count(case when ${logs.statusCode} != 1 then 1 end)::int`.as('failedTasks'),
        })
        .from(logs)
        .where(and(
            gte(logs.createdAt, drizzleSql`CURRENT_DATE`),
            eq(logs.userId, user.id),
        ));

        return {
            message: 'success',
            todayTasks: todayStats?.todayTasks || 0,
            failedTasks: todayStats?.failedTasks || 0
        };
    });
