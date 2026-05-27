import { optionCache } from './optionCache';
import { consumeRateLimit, getRateLimit, incrementRateLimit } from './ratelimit';

/**
 * PG-backed model request rate limiter.
 * The UPSERT logic requires raw SQL (INSERT ... ON CONFLICT ... DO UPDATE with CASE).
 */

interface GroupRateLimit {
    total: number;
    success: number;
}

async function readWindow(key: string): Promise<number> {
    const result = await getRateLimit(key);
    return result?.consumedPoints || 0;
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
        const totalResult = await consumeRateLimit({
            key: `model_req_total:${userId}:${group}`,
            limit: total,
            windowMs: durationMs,
        });
        if (!totalResult.allowed) return true;
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
    await incrementRateLimit(`model_req_success:${userId}:${group}`, 1, durationMs);
}
