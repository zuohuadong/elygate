import { db, sql } from '@elygate/db';
import { channels, logs } from '@elygate/db/schema';
import { eq, count, sql as drizzleSql } from 'drizzle-orm';

/**
 * Statistics Service
 * Collects latency and usage data for the dashboard.
 */
export const statsService = {
    async getLatencyHeatmap() {
        const rows = await db.select({
            channelId: logs.channelId,
            hour: drizzleSql`EXTRACT(HOUR FROM ${logs.createdAt})`.as('hour'),
            latency: drizzleSql`AVG(${logs.elapsedMs})`.as('latency'),
        })
        .from(logs)
        .where(drizzleSql`${logs.createdAt} > NOW() - INTERVAL '24 hours' AND ${logs.elapsedMs} > 0`)
        .groupBy(logs.channelId, drizzleSql`EXTRACT(HOUR FROM ${logs.createdAt})`)
        .orderBy(drizzleSql`hour ASC`);
        return rows;
    },

    async getSystemHealth() {
        const [total] = await db.select({ count: count() }).from(channels).where(eq(channels.status, 1));
        const [down] = await db.select({ count: count() }).from(channels).where(eq(channels.status, 3));
        const [busy] = await db.select({ count: count() }).from(channels).where(eq(channels.status, 5));
        
        return {
            online: total.count,
            offline: down.count,
            busy: busy.count
        };
    }
};
