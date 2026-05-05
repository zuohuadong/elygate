import { db, sql } from '$lib/server/db';
import { requirePortalMember } from '$lib/server/portalAuth';
import { logs, users } from '@elygate/db/schema';
import { eq, and, gte, desc, sql as drizzleSql, count } from '@elygate/db/operators';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
    const { org } = requirePortalMember(locals);

    // Complex aggregate with FILTER — use raw SQL
    const trendData = await sql`
        SELECT 
            TO_CHAR(created_at, 'HH24:00') as label,
            SUM(quota_cost) as cost_value,
            COUNT(*) FILTER (WHERE status_code >= 400) as error_count,
            AVG(elapsed_ms) as avg_latency
        FROM logs
        WHERE org_id = ${org.id} 
          AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY label
        ORDER BY label ASC
    `;

    const errorStats = await sql`
        SELECT 
            status_code,
            COUNT(*) as count
        FROM logs
        WHERE org_id = ${org.id}
          AND status_code >= 400
          AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY status_code
        ORDER BY count DESC
    `;

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
                cost: Number(row.cost_value),
                errors: Number(row.error_count),
                latency: Math.round(Number(row.avg_latency || 0))
            })),
            modelDistribution: modelDistribution.map((row) => ({
                name: row.name,
                value: Number(row.value)
            })),
            errorStats: errorStats.map((row: Record<string, any>) => ({
                code: row.status_code,
                count: Number(row.count)
            })),
            activeMembers: Number(activeMembers)
        }
    };
};
