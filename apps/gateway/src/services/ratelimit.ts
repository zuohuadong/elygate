import { memoryCache } from './cache';

/**
 * High-Performance In-Memory Distributed Rate Limiter
 * Ensures sub-millisecond latency for frequency control.
 * For true multi-node consistency, this can be swapped with Redis,
 * but in-memory is the fastest for single-node or sticky-session deployments.
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
        // New window or new key
        bucket = { count: 1, windowStart };
        limitCache.set(key, bucket);

        // Periodic cleanup of stale entries (memory safety)
        if (limitCache.size > 10000) {
            // Very basic cleanup: if cache grows too large, clear old ones
            for (const [k, v] of limitCache.entries()) {
                if (v.windowStart < windowStart - WINDOW_MS) {
                    limitCache.delete(k);
                }
            }
        }
    } else {
        bucket.count++;
    }

    return bucket.count > maxAllowed;
}
