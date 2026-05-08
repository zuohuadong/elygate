import { db } from '@elygate/db';
import { rateLimits } from '@elygate/db/schema';
import { and, eq, gt, sql as drizzleSql } from 'drizzle-orm';
import { optionCache } from './optionCache';

/**
 * PG-backed model request rate limiter.
 * The UPSERT logic requires raw SQL (INSERT ... ON CONFLICT ... DO UPDATE with CASE).
 */

interface GroupRateLimit {
    total: number;
    success: number;
}

async function consumeWindow(key: string, limit: number, windowMs: number): Promise<boolean> {
    if (!limit || limit <= 0) return false;
    try {
        const rows = await db.insert(rateLimits)
            .values({
                key,
                count: 1,
                expiredAt: drizzleSql`NOW() + ${windowMs}::int * INTERVAL '1 millisecond'`,
            })
            .onConflictDoUpdate({
                target: rateLimits.key,
                set: {
                    count: drizzleSql`CASE WHEN ${rateLimits.expiredAt} <= NOW() THEN 1 ELSE ${rateLimits.count} + 1 END`,
                    expiredAt: drizzleSql`CASE WHEN ${rateLimits.expiredAt} <= NOW() THEN EXCLUDED.expired_at ELSE ${rateLimits.expiredAt} END`,
                },
            })
            .returning({ count: rateLimits.count });
        return Number(rows[0]?.count || 0) > limit;
    } catch {
        return false;
    }
}

async function incrementWindow(key: string, limit: number, windowMs: number): Promise<void> {
    if (!limit || limit <= 0) return;
    try {
        await db.insert(rateLimits)
            .values({
                key,
                count: 1,
                expiredAt: drizzleSql`NOW() + ${windowMs}::int * INTERVAL '1 millisecond'`,
            })
            .onConflictDoUpdate({
                target: rateLimits.key,
                set: {
                    count: drizzleSql`CASE WHEN ${rateLimits.expiredAt} <= NOW() THEN 1 ELSE ${rateLimits.count} + 1 END`,
                    expiredAt: drizzleSql`CASE WHEN ${rateLimits.expiredAt} <= NOW() THEN EXCLUDED.expired_at ELSE ${rateLimits.expiredAt} END`,
                },
            });
    } catch { /* fail silently */ }
}

async function readWindow(key: string): Promise<number> {
    try {
        const rows = await db.select({ count: rateLimits.count })
            .from(rateLimits)
            .where(and(eq(rateLimits.key, key), gt(rateLimits.expiredAt, drizzleSql`NOW()`)))
            .limit(1);
        return Number(rows[0]?.count || 0);
    } catch {
        return 0;
    }
}

function getLimits(group: string): { total: number; success: number; durationMs: number } {
    const enabled = optionCache.get('ModelRequestRateLimitEnabled', false);
    if (!enabled) return { total: 0, success: 0, durationMs: 60000 };

    const durationMin = optionCache.get('ModelRequestRateLimitDurationMinutes', 1);
    const durationMs = (durationMin || 1) * 60 * 1000;

    let total = optionCache.get('ModelRequestRateLimitCount', 0);
    let success = optionCache.get('ModelRequestRateLimitSuccessCount', 0);

    const groupLimits: Record<string, GroupRateLimit> = optionCache.get('GroupModelRateLimits', {});
    if (groupLimits[group]) {
        total = groupLimits[group].total || total;
        success = groupLimits[group].success || success;
    }

    return { total, success, durationMs };
}

export async function isModelRequestRateLimited(userId: number, group: string): Promise<boolean> {
    const { total, success, durationMs } = getLimits(group);
    if ((!total && !success) || durationMs <= 0) return false;

    if (total > 0) {
        const totalLimited = await consumeWindow(`model_req_total:${userId}:${group}`, total, durationMs);
        if (totalLimited) return true;
    }

    if (success > 0) {
        const successCount = await readWindow(`model_req_success:${userId}:${group}`);
        if (successCount >= success) return true;
    }

    return false;
}

export async function recordModelRequestSuccess(userId: number, group: string): Promise<void> {
    const { success, durationMs } = getLimits(group);
    if (!success || durationMs <= 0) return;
    await incrementWindow(`model_req_success:${userId}:${group}`, success, durationMs);
}
