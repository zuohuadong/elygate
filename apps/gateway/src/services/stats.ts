import { sql } from '@elygate/db';

/**
 * Statistics Service
 * Collects latency and usage data for the dashboard.
 */
export const statsService = {
    async getLatencyHeatmap() {
        // Return 24-hour latency data for active channels
        const rows = await sql`
            SELECT channel_id as "channelId", 
                   EXTRACT(HOUR FROM created_at) as hour,
                   AVG(latency) as latency
            FROM logs
            WHERE created_at > NOW() - INTERVAL '24 hours'
              AND latency > 0
            GROUP BY channel_id, hour
            ORDER BY hour ASC
        `;
        return rows;
    },

    async getSystemHealth() {
        const [total] = await sql`SELECT count(*) FROM channels WHERE status = 1`;
        const [down] = await sql`SELECT count(*) FROM channels WHERE status = 3`;
        const [busy] = await sql`SELECT count(*) FROM channels WHERE status = 5`;
        
        return {
            online: parseInt(total.count),
            offline: parseInt(down.count),
            busy: parseInt(busy.count)
        };
    }
};
