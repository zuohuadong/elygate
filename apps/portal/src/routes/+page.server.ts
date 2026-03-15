import { sql } from '$lib/server/db';
import { requirePortalMember } from '$lib/server/portalAuth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
    const { org } = requirePortalMember(locals);

    // 1. Fetch usage vs error trend for the last 24 hours
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

    // 2. Error distribution by category
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

    // 2. Fetch model distribution
    const modelDistribution = await sql`
        SELECT 
            model_name as name,
            COUNT(*) as value
        FROM logs
        WHERE org_id = ${org.id}
          AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY name
        ORDER BY value DESC
        LIMIT 5
    `;

    // 3. Fetch active member count
    const [{ count: activeMembers }] = await sql`
        SELECT COUNT(*) FROM users
        WHERE org_id = ${org.id} AND status = 1
    `;

    return {
        analytics: {
            usageTrend: trendData.map((row: any) => ({
                label: row.label,
                cost: Number(row.cost_value),
                errors: Number(row.error_count),
                latency: Math.round(Number(row.avg_latency || 0))
            })),
            modelDistribution: modelDistribution.map((row: any) => ({
                name: row.name,
                value: Number(row.value)
            })),
            errorStats: errorStats.map((row: any) => ({
                code: row.status_code,
                count: Number(row.count)
            })),
            activeMembers: Number(activeMembers)
        }
    };
};
