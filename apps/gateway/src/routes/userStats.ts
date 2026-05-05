import type { ElysiaCtx } from '../types';
import { Elysia, t } from 'elysia';
import { db, sql } from '@elygate/db';
import { users, tokens, logs } from '@elygate/db/schema';
import { eq, desc, count, sum, and, gte, lt, sql as drizzleSql } from 'drizzle-orm';
import { authPlugin } from '../middleware/auth';
import type { UserRecord  } from '../types';

export const userStatsRouter = new Elysia({ prefix: '/user' })
    .use(authPlugin)
    .get('/info', async ({ user }: ElysiaCtx) => {
        const u = user as UserRecord;
        const [userInfo] = await db.select({
            id: users.id,
            username: users.username,
            role: users.role,
            quota: users.quota,
            usedQuota: users.usedQuota,
            status: users.status,
            currency: users.currency,
        }).from(users).where(eq(users.id, u.id));
        return userInfo || { id: 0, username: '', role: 0, quota: 0, usedQuota: 0, status: 0, currency: 'USD' };
    })
    .get('/tokens', async ({ user }: ElysiaCtx) => {
        const u = user as UserRecord;
        const tokenRows = await db.select({
            id: tokens.id,
            name: tokens.name,
            key: tokens.key,
            status: tokens.status,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            createdAt: tokens.createdAt,
        }).from(tokens).where(eq(tokens.userId, u.id)).orderBy(desc(tokens.createdAt));
        return tokenRows;
    })
    .get('/logs', async ({ user, query }: ElysiaCtx) => {
        const u = user as UserRecord;
        const limit = parseInt((query as Record<string, string>).limit) || 10;

        const logRows = await db.select({
            id: logs.id,
            modelName: logs.modelName,
            promptTokens: logs.promptTokens,
            completionTokens: logs.completionTokens,
            quotaCost: logs.quotaCost,
            createdAt: logs.createdAt,
            isSuccess: drizzleSql<boolean>`CASE WHEN ${logs.statusCode} < 400 THEN true ELSE false END`,
        }).from(logs).where(eq(logs.userId, u.id)).orderBy(desc(logs.createdAt)).limit(limit);
        return logRows;
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

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const conditions = period === 'yesterday'
            ? and(eq(logs.userId, u.id), gte(logs.createdAt, startDate), lt(logs.createdAt, todayStart))
            : and(eq(logs.userId, u.id), gte(logs.createdAt, startDate));

        // 1. Overview
        const [overview] = await db.select({
            totalRequests: drizzleSql<number>`count(*)::int`,
            totalCost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
            totalPromptTokens: drizzleSql<string>`coalesce(sum(${logs.promptTokens}), 0)::bigint`,
            totalCompletionTokens: drizzleSql<string>`coalesce(sum(${logs.completionTokens}), 0)::bigint`,
            avgLatency: drizzleSql<number>`round(coalesce(avg(case when ${logs.elapsedMs} > 0 then ${logs.elapsedMs} else null end), 0))::int`,
        }).from(logs).where(conditions);

        // 2. Model breakdown
        const models = await db.select({
            model_name: logs.modelName,
            requests: drizzleSql<number>`count(*)::int`,
            tokens: drizzleSql<string>`coalesce(sum(${logs.promptTokens} + ${logs.completionTokens}), 0)::bigint`,
            cost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
            success_rate: drizzleSql<number>`round((count(case when ${logs.statusCode} < 400 then 1 end)::numeric / nullif(count(*), 0)) * 100, 1)::float`,
        }).from(logs).where(conditions)
          .groupBy(logs.modelName)
          .orderBy(desc(drizzleSql`coalesce(sum(${logs.quotaCost}), 0)`))
          .limit(10);

        // 3. Time series
        let timeSeries;
        if (period === '7d' || period === '30d') {
            timeSeries = await db.select({
                date: drizzleSql<string>`date(${logs.createdAt})`,
                requests: drizzleSql<number>`count(*)::int`,
                cost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
            }).from(logs).where(conditions)
              .groupBy(drizzleSql`date(${logs.createdAt})`)
              .orderBy(drizzleSql`date(${logs.createdAt}) asc`);
        } else {
            timeSeries = await db.select({
                hour: drizzleSql<number>`extract(hour from ${logs.createdAt})::int`,
                requests: drizzleSql<number>`count(*)::int`,
                cost: drizzleSql<string>`coalesce(sum(${logs.quotaCost}), 0)::bigint`,
            }).from(logs).where(conditions)
              .groupBy(drizzleSql`extract(hour from ${logs.createdAt})`)
              .orderBy(drizzleSql`extract(hour from ${logs.createdAt}) asc`);
        }

        return {
            overview,
            models,
            time_series: timeSeries
        };
    });
