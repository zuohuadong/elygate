import { memoryCache } from './cache';

/**
 * High-Performance In-Memory Rate Limiter
 * Powered by Bun + PostgreSQL — no Redis dependency.
 * Uses a sliding fixed-window algorithm with O(1) lookup via Map.
 * Periodic GC prevents unbounded memory growth on high-cardinality keys.
 */

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 300;

// TokenID -> { count, windowStart }
const limitCache = new Map<string, { count: number, windowStart: number }>();

/**
 * Check if the given identifier triggers rate limiting
 * @param identifier Unique ID (Token ID or User ID)
 * @param limit Override the default max requests (0 = use default)
 * @returns true if limited (rejected)
 */
export async function isRateLimited(identifier: string | number, limit: number = 0): Promise<boolean> {
    const now = Date.now();
    const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
    const key = `${identifier}`;
    const maxAllowed = limit > 0 ? limit : MAX_REQUESTS_PER_WINDOW;

    let bucket = limitCache.get(key);

    if (!bucket || bucket.windowStart !== windowStart) {
        // New window or new key — start at 0 then increment below
        bucket = { count: 0, windowStart };
        limitCache.set(key, bucket);

        // Periodic cleanup of stale entries (memory safety)
        if (limitCache.size > 10000) {
            for (const [k, v] of limitCache.entries()) {
                if (v.windowStart < windowStart - WINDOW_MS) {
                    limitCache.delete(k);
                }
            }
        }
    }

    bucket.count++;
    return bucket.count > maxAllowed;
}
