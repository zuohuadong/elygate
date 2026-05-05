import { db, sql } from '@elygate/db';
import { rateLimits } from '@elygate/db/schema';
import { sql as drizzleSql, lt } from 'drizzle-orm';

/**
 * PostgreSQL-backed fixed-window rate limiter.
 * Uses the UNLOGGED rate_limits table for cross-process atomic counters.
 * 
 * The UPSERT logic (INSERT ... ON CONFLICT ... DO UPDATE) requires raw SQL
 * because Drizzle query builder cannot express the conditional count reset.
 */

const MAX_REQUESTS_PER_WINDOW = 300;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
let lastRateLimitCleanup = 0;
const localFallbackWindows = new Map<string, { count: number; expiresAt: number }>();

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

        void cleanupExpiredRateLimits();
        return Number(rows[0]?.count || 0) > limit;
    } catch {
        return consumeLocalFallbackWindow(key, limit, windowMs);
    }
}

function consumeLocalFallbackWindow(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const current = localFallbackWindows.get(key);
    if (!current || current.expiresAt <= now) {
        localFallbackWindows.set(key, { count: 1, expiresAt: now + windowMs });
        return false;
    }

    current.count += 1;
    if (localFallbackWindows.size > 10_000) {
        for (const [windowKey, value] of localFallbackWindows.entries()) {
            if (value.expiresAt <= now) localFallbackWindows.delete(windowKey);
        }
    }
    return current.count > limit;
}

async function cleanupExpiredRateLimits(): Promise<void> {
    const now = Date.now();
    if (now - lastRateLimitCleanup < RATE_LIMIT_CLEANUP_INTERVAL_MS) return;
    lastRateLimitCleanup = now;
    try {
        await db.delete(rateLimits).where(lt(rateLimits.expiredAt, drizzleSql`NOW()`));
    } catch {
        // Cleanup is opportunistic; failed cleanup must not block requests.
    }
}

export async function isRateLimited(identifier: string | number, limit: number = 0): Promise<boolean> {
    const maxAllowed = limit > 0 ? limit : MAX_REQUESTS_PER_WINDOW;
    return consumeWindow(`token:${identifier}:rpm`, maxAllowed, 60_000);
}

export async function isPackageRateLimited(userId: number, rule: Record<string, any>): Promise<boolean> {
   if (!rule) return false;
   const { rpm, rph } = rule;
   if ((!rpm || rpm <= 0) && (!rph || rph <= 0)) return false;

   const ruleId = rule.id || 'default';
   if (rpm > 0 && await consumeWindow(`pkg:${userId}:${ruleId}:rpm`, rpm, 60_000)) return true;
   if (rph > 0 && await consumeWindow(`pkg:${userId}:${ruleId}:rph`, rph, 3_600_000)) return true;
   return false;
}

export const packageConcurrencyMap = new Map<string, number>();

const concurrencyWaiters = new Map<string, (() => void)[]>();

function notifyConcurrencyRelease(lockId: string) {
    const queue = concurrencyWaiters.get(lockId);
    if (queue && queue.length > 0) {
        const resolve = queue.shift()!;
        resolve();
        if (queue.length === 0) concurrencyWaiters.delete(lockId);
    }
}

export async function waitForPackageConcurrency(userId: number, ruleId: number, limit: number, maxWaitMs = 15000): Promise<boolean> {
    if (!limit || limit <= 0) return true;
    const lockId = `user_pkg_wait_${userId}_rule_${ruleId}`;
    
    const current = packageConcurrencyMap.get(lockId) || 0;
    if (current < limit) return true;
    
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
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

export function getPackageLockId(userId: number, ruleId: number): string {
    return `user_pkg_wait_${userId}_rule_${ruleId}`;
}

export function releasePackageConcurrency(lockId: string): void {
    const current = packageConcurrencyMap.get(lockId);
    if (current) {
        packageConcurrencyMap.set(lockId, Math.max(0, current - 1));
    }
    notifyConcurrencyRelease(lockId);
}
