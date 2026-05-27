import { db } from '@elygate/db';
import { rateLimits } from '@elygate/db/schema';
import { and, eq, gt, lt, sql as drizzleSql } from 'drizzle-orm';

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

export type RateLimitStore = 'postgres' | 'local' | 'disabled';

export interface RateLimitResult {
    key: string;
    allowed: boolean;
    limit: number;
    consumedPoints: number;
    remainingPoints: number;
    msBeforeNext: number;
    isFirstInDuration: boolean;
    blocked: boolean;
    store: RateLimitStore;
}

export interface ConsumeRateLimitOptions {
    key: string;
    limit: number;
    windowMs: number;
    points?: number;
    blockDurationMs?: number;
}

export interface RateLimitHeaders {
    'X-RateLimit-Limit': string;
    'X-RateLimit-Remaining': string;
    'X-RateLimit-Reset': string;
    'Retry-After'?: string;
}

function normalizePoints(points: number | undefined): number {
    const n = Number(points ?? 1);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.ceil(n);
}

function normalizeDurationMs(ms: number): number {
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.ceil(ms);
}

function buildResult(
    key: string,
    limit: number,
    count: number,
    expiresAt: Date | number | null | undefined,
    changedPoints: number,
    store: RateLimitStore
): RateLimitResult {
    const expireMs = expiresAt instanceof Date ? expiresAt.getTime() : Number(expiresAt || 0);
    const msBeforeNext = expireMs > 0 ? Math.max(expireMs - Date.now(), 0) : -1;
    const consumedPoints = Math.max(0, Number(count || 0));
    const remainingPoints = limit > 0 ? Math.max(limit - consumedPoints, 0) : 0;
    const allowed = consumedPoints <= limit;

    return {
        key,
        allowed,
        limit,
        consumedPoints,
        remainingPoints,
        msBeforeNext,
        isFirstInDuration: consumedPoints === changedPoints,
        blocked: !allowed && msBeforeNext > 0,
        store,
    };
}

function disabledResult(key: string, limit: number): RateLimitResult {
    return {
        key,
        allowed: true,
        limit,
        consumedPoints: 0,
        remainingPoints: Math.max(limit, 0),
        msBeforeNext: -1,
        isFirstInDuration: false,
        blocked: false,
        store: 'disabled',
    };
}

async function consumeWindow(key: string, limit: number, windowMs: number, points = 1, blockDurationMs = 0): Promise<RateLimitResult> {
    if (!limit || limit <= 0) return disabledResult(key, limit);

    const consumedPoints = normalizePoints(points);
    const durationMs = normalizeDurationMs(windowMs);
    const blockMs = normalizeDurationMs(blockDurationMs);
    try {
        const rows = await db.insert(rateLimits)
            .values({
                key,
                count: consumedPoints,
                expiredAt: drizzleSql`NOW() + ${durationMs}::int * INTERVAL '1 millisecond'`,
            })
            .onConflictDoUpdate({
                target: rateLimits.key,
                set: {
                    count: drizzleSql`CASE WHEN ${rateLimits.expiredAt} <= NOW() THEN ${consumedPoints} ELSE ${rateLimits.count} + ${consumedPoints} END`,
                    expiredAt: drizzleSql`CASE WHEN ${rateLimits.expiredAt} <= NOW() THEN EXCLUDED.expired_at ELSE ${rateLimits.expiredAt} END`,
                },
            })
            .returning({ count: rateLimits.count, expiredAt: rateLimits.expiredAt });

        void cleanupExpiredRateLimits();

        let row = rows[0];
        if (row && blockMs > 0 && Number(row.count || 0) > limit) {
            const [blockedRow] = await db.update(rateLimits)
                .set({
                    count: Math.max(Number(row.count || 0), limit + consumedPoints),
                    expiredAt: drizzleSql`NOW() + ${blockMs}::int * INTERVAL '1 millisecond'`,
                })
                .where(eq(rateLimits.key, key))
                .returning({ count: rateLimits.count, expiredAt: rateLimits.expiredAt });
            row = blockedRow || row;
        }

        return buildResult(key, limit, Number(row?.count || 0), row?.expiredAt, consumedPoints, 'postgres');
    } catch {
        return consumeLocalFallbackWindow(key, limit, durationMs, consumedPoints, blockMs);
    }
}

function consumeLocalFallbackWindow(key: string, limit: number, windowMs: number, points: number, blockDurationMs = 0): RateLimitResult {
    const now = Date.now();
    const current = localFallbackWindows.get(key);
    if (!current || current.expiresAt <= now) {
        const next = { count: points, expiresAt: now + windowMs };
        localFallbackWindows.set(key, next);
        return buildResult(key, limit, next.count, next.expiresAt, points, 'local');
    }

    current.count += points;
    if (blockDurationMs > 0 && current.count > limit) {
        current.expiresAt = now + blockDurationMs;
    }
    if (localFallbackWindows.size > 10_000) {
        for (const [windowKey, value] of localFallbackWindows.entries()) {
            if (value.expiresAt <= now) localFallbackWindows.delete(windowKey);
        }
    }
    return buildResult(key, limit, current.count, current.expiresAt, points, 'local');
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

export async function consumeRateLimit(options: ConsumeRateLimitOptions): Promise<RateLimitResult> {
    return consumeWindow(
        options.key,
        options.limit,
        options.windowMs,
        options.points,
        options.blockDurationMs
    );
}

export async function getRateLimit(key: string, limit = 0): Promise<RateLimitResult | null> {
    try {
        const rows = await db.select({ count: rateLimits.count, expiredAt: rateLimits.expiredAt })
            .from(rateLimits)
            .where(and(eq(rateLimits.key, key), gt(rateLimits.expiredAt, drizzleSql`NOW()`)))
            .limit(1);

        const row = rows[0];
        if (!row) return null;
        return buildResult(key, limit, Number(row.count || 0), row.expiredAt, 0, 'postgres');
    } catch {
        const local = localFallbackWindows.get(key);
        if (!local || local.expiresAt <= Date.now()) return null;
        return buildResult(key, limit, local.count, local.expiresAt, 0, 'local');
    }
}

export async function incrementRateLimit(key: string, points: number, windowMs: number): Promise<void> {
    await consumeWindow(key, Number.MAX_SAFE_INTEGER, windowMs, points);
}

export async function penaltyRateLimit(options: ConsumeRateLimitOptions): Promise<RateLimitResult> {
    return consumeRateLimit(options);
}

export async function rewardRateLimit(key: string, points = 1, limit = 0): Promise<RateLimitResult | null> {
    const rewardPoints = normalizePoints(points);
    try {
        const [row] = await db.update(rateLimits)
            .set({ count: drizzleSql`GREATEST(${rateLimits.count} - ${rewardPoints}, 0)` })
            .where(and(eq(rateLimits.key, key), gt(rateLimits.expiredAt, drizzleSql`NOW()`)))
            .returning({ count: rateLimits.count, expiredAt: rateLimits.expiredAt });

        if (!row) return null;
        return buildResult(key, limit, Number(row.count || 0), row.expiredAt, -rewardPoints, 'postgres');
    } catch {
        const local = localFallbackWindows.get(key);
        if (!local || local.expiresAt <= Date.now()) return null;
        local.count = Math.max(local.count - rewardPoints, 0);
        return buildResult(key, limit, local.count, local.expiresAt, -rewardPoints, 'local');
    }
}

export async function blockRateLimit(key: string, blockDurationMs: number, limit = 0): Promise<RateLimitResult> {
    const durationMs = normalizeDurationMs(blockDurationMs);
    const blockedCount = Math.max(limit + 1, 1);
    try {
        const [row] = await db.insert(rateLimits)
            .values({
                key,
                count: blockedCount,
                expiredAt: drizzleSql`NOW() + ${durationMs}::int * INTERVAL '1 millisecond'`,
            })
            .onConflictDoUpdate({
                target: rateLimits.key,
                set: {
                    count: blockedCount,
                    expiredAt: drizzleSql`EXCLUDED.expired_at`,
                },
            })
            .returning({ count: rateLimits.count, expiredAt: rateLimits.expiredAt });

        return buildResult(key, limit, Number(row?.count || blockedCount), row?.expiredAt, blockedCount, 'postgres');
    } catch {
        const local = { count: blockedCount, expiresAt: Date.now() + durationMs };
        localFallbackWindows.set(key, local);
        return buildResult(key, limit, local.count, local.expiresAt, blockedCount, 'local');
    }
}

export async function deleteRateLimitKey(key: string): Promise<boolean> {
    localFallbackWindows.delete(key);
    try {
        const rows = await db.delete(rateLimits)
            .where(eq(rateLimits.key, key))
            .returning({ key: rateLimits.key });
        return rows.length > 0;
    } catch {
        return false;
    }
}

export function getRateLimitHeaders(result: RateLimitResult): RateLimitHeaders {
    const resetSeconds = result.msBeforeNext > 0 ? Math.ceil(result.msBeforeNext / 1000) : 0;
    const headers: RateLimitHeaders = {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remainingPoints),
        'X-RateLimit-Reset': String(resetSeconds),
    };

    if (!result.allowed && resetSeconds > 0) {
        headers['Retry-After'] = String(resetSeconds);
    }

    return headers;
}

export async function isRateLimited(identifier: string | number, limit: number = 0): Promise<boolean> {
    const maxAllowed = limit > 0 ? limit : MAX_REQUESTS_PER_WINDOW;
    const result = await consumeWindow(`token:${identifier}:rpm`, maxAllowed, 60_000);
    return !result.allowed;
}

export async function isPackageRateLimited(userId: number, rule: Record<string, any>): Promise<boolean> {
   if (!rule) return false;
   const { rpm, rph } = rule;
   if ((!rpm || rpm <= 0) && (!rph || rph <= 0)) return false;

   const ruleId = rule.id || 'default';
   if (rpm > 0 && !(await consumeWindow(`pkg:${userId}:${ruleId}:rpm`, rpm, 60_000)).allowed) return true;
   if (rph > 0 && !(await consumeWindow(`pkg:${userId}:${ruleId}:rph`, rph, 3_600_000)).allowed) return true;
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
