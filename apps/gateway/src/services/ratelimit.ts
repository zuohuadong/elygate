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

const packageLimitCache = new Map<string, { rpmCount: number, rpmWindow: number, rphCount: number, rphWindow: number }>();

/**
 * Check if the given User ID is rate limited by the provided Package Rule
 */
export async function isPackageRateLimited(userId: number, rule: any): Promise<boolean> {
   if (!rule) return false;
   const { rpm, rph } = rule;
   if ((!rpm || rpm <= 0) && (!rph || rph <= 0)) return false;
   
   const now = Date.now();
   const minWindow = Math.floor(now / 60000) * 60000;
   const hrWindow = Math.floor(now / 3600000) * 3600000;
   const key = `user_pkg_${userId}`;
   
   let bucket = packageLimitCache.get(key);
   if (!bucket) {
       bucket = { rpmCount: 0, rpmWindow: minWindow, rphCount: 0, rphWindow: hrWindow };
       packageLimitCache.set(key, bucket);
   }
   
   if (bucket.rpmWindow !== minWindow) {
       bucket.rpmCount = 0;
       bucket.rpmWindow = minWindow;
   }
   if (bucket.rphWindow !== hrWindow) {
       bucket.rphCount = 0;
       bucket.rphWindow = hrWindow;
   }
   
   if (rpm > 0 && bucket.rpmCount >= rpm) return true;
   if (rph > 0 && bucket.rphCount >= rph) return true;
   
   bucket.rpmCount++;
   bucket.rphCount++;
   return false;
}

export const packageConcurrencyMap = new Map<string, number>();

/**
 * Global wait for package concurrency
 */
export async function waitForPackageConcurrency(userId: number, limit: number, maxWaitMs = 15000): Promise<boolean> {
    if (!limit || limit <= 0) return true;
    const lockId = `user_pkg_wait_${userId}`;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
        const current = packageConcurrencyMap.get(lockId) || 0;
        if (current < limit) return true;
        await new Promise(r => setTimeout(r, 100)); // Sleep before retry
    }
    return false;
}
