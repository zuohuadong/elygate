import { sql } from '@elygate/db';
import { optionCache } from './optionCache';

/**
 * PG-backed model request rate limiter (replaces Redis-based ModelRequestRateLimit).
 * Uses the existing rate_limits UNLOGGED table with keys:
 *   - model_req_total:{userId}:{group}  — all requests
 *   - model_req_success:{userId}:{group} — only successful (< 400) responses
 *
 * Configuration via system options:
 *   - ModelRequestRateLimitEnabled: boolean (default false)
 *   - ModelRequestRateLimitCount: total requests per window (default 0 = unlimited)
 *   - ModelRequestRateLimitSuccessCount: success requests per window (default 0 = unlimited)
 *   - ModelRequestRateLimitDurationMinutes: window size in minutes (default 1)
 *   - GroupModelRateLimits: { "vip": { "total": 100, "success": 80 }, ... }
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
        return false; // Fail open on DB error
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

    // Check group-specific overrides
    const groupLimits: Record<string, GroupRateLimit> = optionCache.get('GroupModelRateLimits', {});
    if (groupLimits[group]) {
        total = groupLimits[group].total || total;
        success = groupLimits[group].success || success;
    }

    return { total, success, durationMs };
}

/**
 * Check if model request should be rate-limited.
 * Call BEFORE the upstream request.
 */
export async function isModelRequestRateLimited(userId: number, group: string): Promise<boolean> {
    const { total, success, durationMs } = getLimits(group);
    if ((!total && !success) || durationMs <= 0) return false;

    // Check total request limit
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

/**
 * Record a successful request after response status < 400.
 */
export async function recordModelRequestSuccess(userId: number, group: string): Promise<void> {
    const { success, durationMs } = getLimits(group);
    if (!success || durationMs <= 0) return;
    await incrementWindow(`model_req_success:${userId}:${group}`, success, durationMs);
}
