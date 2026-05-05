import { db, sql } from '@elygate/db';
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
        const rows = await sql`
            INSERT INTO rate_limits (key, count, expired_at)
            VALUES (${key}, 1, NOW() + (${windowMs}::int * INTERVAL '1 millisecond'))
            ON CONFLICT (key) DO UPDATE SET
                count = CASE
                    WHEN rate_limits.expired_at <= NOW() THEN 1
                    ELSE rate_limits.count + 1
                END,
                expired_at = CASE
                    WHEN rate_limits.expired_at <= NOW() THEN EXCLUDED.expired_at
                    ELSE rate_limits.expired_at
                END
            RETURNING count
        `;
        return Number(rows[0]?.count || 0) > limit;
    } catch {
        return false;
    }
}

async function incrementWindow(key: string, limit: number, windowMs: number): Promise<void> {
    if (!limit || limit <= 0) return;
    try {
        await sql`
            INSERT INTO rate_limits (key, count, expired_at)
            VALUES (${key}, 1, NOW() + (${windowMs}::int * INTERVAL '1 millisecond'))
            ON CONFLICT (key) DO UPDATE SET
                count = CASE
                    WHEN rate_limits.expired_at <= NOW() THEN 1
                    ELSE rate_limits.count + 1
                END,
                expired_at = CASE
                    WHEN rate_limits.expired_at <= NOW() THEN EXCLUDED.expired_at
                    ELSE rate_limits.expired_at
                END
        `;
    } catch { /* fail silently */ }
}

async function readWindow(key: string): Promise<number> {
    try {
        const rows = await sql`
            SELECT count FROM rate_limits
            WHERE key = ${key} AND expired_at > NOW()
            LIMIT 1
        `;
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
