import { db } from '$lib/server/db';
import { requirePortalMember } from '$lib/server/portalAuth';
import { logs, users } from '@elygate/db/schema';
import { eq, and, gte, desc, sql as drizzleSql, count } from '@elygate/db/operators';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
    const { org } = requirePortalMember(locals);

    const hourLabel = drizzleSql<string>`TO_CHAR(${logs.createdAt}, 'HH24:00')`;
    const trendData = await db.select({
        label: hourLabel,
        costValue: drizzleSql<number>`SUM(${logs.quotaCost})`,
        errorCount: drizzleSql<number>`COUNT(*) FILTER (WHERE ${logs.statusCode} >= 400)`,
        avgLatency: drizzleSql<number>`AVG(${logs.elapsedMs})`,
    })
    .from(logs)
    .where(and(eq(logs.orgId, org.id), gte(logs.createdAt, drizzleSql`NOW() - INTERVAL '24 hours'`)))
    .groupBy(hourLabel)
    .orderBy(hourLabel);

    const errorStats = await db.select({
        statusCode: logs.statusCode,
        count: count(),
    })
    .from(logs)
    .where(and(eq(logs.orgId, org.id), gte(logs.statusCode, 400), gte(logs.createdAt, drizzleSql`NOW() - INTERVAL '24 hours'`)))
    .groupBy(logs.statusCode)
    .orderBy(desc(count()));

    const modelDistribution = await db.select({
        name: logs.modelName,
        value: count(),
    })
    .from(logs)
    .where(and(eq(logs.orgId, org.id), gte(logs.createdAt, drizzleSql`NOW() - INTERVAL '30 days'`)))
    .groupBy(logs.modelName)
    .orderBy(desc(count()))
    .limit(5);

    const [{ count: activeMembers }] = await db.select({ count: count() })
        .from(users)
        .where(and(eq(users.orgId, org.id), eq(users.status, 1)));

    return {
        analytics: {
            usageTrend: trendData.map((row: Record<string, any>) => ({
                label: row.label,
                cost: Number(row.costValue),
                errors: Number(row.errorCount),
                latency: Math.round(Number(row.avgLatency || 0))
            })),
            modelDistribution: modelDistribution.map((row) => ({
                name: row.name,
                value: Number(row.value)
            })),
            errorStats: errorStats.map((row: Record<string, any>) => ({
                code: row.statusCode,
                count: Number(row.count)
            })),
            activeMembers: Number(activeMembers)
        }
    };
};
