import { memoryCache } from './cache';

/**
 * High-Performance In-Memory Rate Limiter
 * Powered by Bun + PostgreSQL — no Redis dependency.
 * Uses a sliding fixed-window algorithm with O(1) lookup via Map.
 * Periodic GC prevents unbounded memory growth on high-cardinality keys.
 */

const MAX_REQUESTS_PER_WINDOW = 300;

/**
 * Token Bucket Rate Limiter
 * Provides smoother traffic flow and allows for short bursts.
 */
class TokenBucket {
    private tokens: number;
    private lastRefill: number;
    private readonly capacity: number;
    private readonly refillRate: number; // Tokens per ms

    constructor(capacity: number, refillRatePerMin: number) {
        this.capacity = capacity;
        this.tokens = capacity;
        this.refillRate = refillRatePerMin / 60000;
        this.lastRefill = Date.now();
    }

    consume(amount: number = 1): boolean {
        this.refill();
        if (this.tokens >= amount) {
            this.tokens -= amount;
            return true;
        }
        return false;
    }

    private refill() {
        const now = Date.now();
        const delta = now - this.lastRefill;
        const refillAmount = delta * this.refillRate;
        this.tokens = Math.min(this.capacity, this.tokens + refillAmount);
        this.lastRefill = now;
    }
}

const buckets = new Map<string, TokenBucket>();

/**
 * Check if the given identifier triggers rate limiting using Token Bucket.
 */
export async function isRateLimited(identifier: string | number, limit: number = 0): Promise<boolean> {
    const key = `${identifier}`;
    const maxAllowed = limit > 0 ? limit : MAX_REQUESTS_PER_WINDOW;
    
    let bucket = buckets.get(key);
    if (!bucket) {
        // Burst capacity default to 10% of limit or at least 5
        const burst = Math.max(5, Math.floor(maxAllowed * 0.1));
        bucket = new TokenBucket(maxAllowed + burst, maxAllowed);
        buckets.set(key, bucket);

        // Memory safety GC
        if (buckets.size > 10000) {
            // Very simple cleanup: clear all if too big
            buckets.clear();
        }
    }

    return !bucket.consume(1);
}

const packageLimitCache = new Map<string, { rpmCount: number, rpmWindow: number, rphCount: number, rphWindow: number }>();

/**
 * Check if the given User ID is rate limited by the provided Package Rule.
 * Key is scoped to (userId, ruleId) so different packages use independent counters.
 */
export async function isPackageRateLimited(userId: number, rule: Record<string, any>): Promise<boolean> {
   if (!rule) return false;
   const { rpm, rph } = rule;
   if ((!rpm || rpm <= 0) && (!rph || rph <= 0)) return false;
   
   const now = Date.now();
   const minWindow = Math.floor(now / 60000) * 60000;
   const hrWindow = Math.floor(now / 3600000) * 3600000;
   const key = `user_pkg_${userId}_rule_${rule.id}`;
   
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

// Event-driven concurrency wait queue: lockId -> resolve callbacks
const concurrencyWaiters = new Map<string, (() => void)[]>();

/**
 * Notify waiters that a concurrency slot has been freed.
 */
function notifyConcurrencyRelease(lockId: string) {
    const queue = concurrencyWaiters.get(lockId);
    if (queue && queue.length > 0) {
        const resolve = queue.shift()!;
        resolve();
        if (queue.length === 0) concurrencyWaiters.delete(lockId);
    }
}

/**
 * Wait for package concurrency using event-driven notifications instead of busy-wait polling.
 * The lockId now includes ruleId so different packages use separate concurrency pools.
 */
export async function waitForPackageConcurrency(userId: number, ruleId: number, limit: number, maxWaitMs = 15000): Promise<boolean> {
    if (!limit || limit <= 0) return true;
    const lockId = `user_pkg_wait_${userId}_rule_${ruleId}`;
    
    const current = packageConcurrencyMap.get(lockId) || 0;
    if (current < limit) return true;
    
    // Wait for a slot to open via event notification
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
            // Timeout: remove ourselves from the queue
            const queue = concurrencyWaiters.get(lockId);
            if (queue) {
                const idx = queue.indexOf(onRelease);
                if (idx !== -1) queue.splice(idx, 1);
                if (queue.length === 0) concurrencyWaiters.delete(lockId);
            }
            resolve(false);
        }, maxWaitMs);
        
        const onRelease = () => {
            clearTimeout(timer);
            resolve(true);
        };
        
        if (!concurrencyWaiters.has(lockId)) concurrencyWaiters.set(lockId, []);
        concurrencyWaiters.get(lockId)!.push(onRelease);
    });
}

/**
 * Build the concurrency lock ID for a given user+rule combination.
 */
export function getPackageLockId(userId: number, ruleId: number): string {
    return `user_pkg_wait_${userId}_rule_${ruleId}`;
}

/**
 * Release a package concurrency slot and notify waiting requests.
 */
export function releasePackageConcurrency(lockId: string): void {
    const current = packageConcurrencyMap.get(lockId);
    if (current) {
        packageConcurrencyMap.set(lockId, Math.max(0, current - 1));
    }
    notifyConcurrencyRelease(lockId);
}
