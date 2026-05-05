import { log } from '../services/logger';
import { db, sql } from '@elygate/db';
import { users, userSubscriptions, packages } from '@elygate/db/schema';
import { eq, and, lte, gt, inArray, sql as drizzleSql } from 'drizzle-orm';

export type CycleUnit = 'hour' | 'day' | 'week' | 'month';

/**
 * Core logic for checking and replenishing subscription-based quotas.
 * Implements a "Lazy Reset" pattern: quotas are refilled when a user makes a request
 * after their cycle reset period has passed.
 */
export async function checkAndResetSubscriptionQuota(userId: number): Promise<void> {
    const activeSubs = await db.select({
        id: userSubscriptions.id,
        lastResetAt: userSubscriptions.lastResetAt,
        cycleQuota: packages.cycleQuota,
        cycleInterval: packages.cycleInterval,
        cycleUnit: packages.cycleUnit,
    })
    .from(userSubscriptions)
    .innerJoin(packages, eq(userSubscriptions.packageId, packages.id))
    .where(and(
        eq(userSubscriptions.userId, userId),
        eq(userSubscriptions.status, 1),
        lte(userSubscriptions.startTime, drizzleSql`NOW()`),
        gt(userSubscriptions.endTime, drizzleSql`NOW()`),
        gt(packages.cycleQuota, 0),
    ));

    if (activeSubs.length === 0) return;

    const now = new Date();
    let totalRefill = 0;
    const resetSubIds: number[] = [];

    for (const sub of activeSubs) {
        const lastReset = new Date(sub.lastResetAt!);
        const nextReset = calculateNextReset(lastReset, sub.cycleInterval!, sub.cycleUnit as CycleUnit);

        if (now >= nextReset) {
            const cyclesPassed = calculateCyclesPassed(lastReset, now, sub.cycleInterval!, sub.cycleUnit as CycleUnit);
            
            if (cyclesPassed > 0) {
                totalRefill += Number(sub.cycleQuota);
                resetSubIds.push(sub.id);
            }
        }
    }

    if (resetSubIds.length > 0) {
        log.info(`[Subscription] Refilling quota for User ${userId}. Total: ${totalRefill}. Subs: ${resetSubIds.join(',')}`);
        
        await db.transaction(async (tx) => {
            await tx.update(users)
                .set({ quota: drizzleSql`${users.quota} + ${totalRefill}` })
                .where(eq(users.id, userId));
            
            await tx.update(userSubscriptions)
                .set({ lastResetAt: new Date() })
                .where(inArray(userSubscriptions.id, resetSubIds));
        });
    }
}

function calculateNextReset(lastReset: Date, interval: number, unit: CycleUnit): Date {
    const next = new Date(lastReset);
    switch (unit) {
        case 'hour':
            next.setHours(next.getHours() + interval);
            break;
        case 'day':
            next.setDate(next.getDate() + interval);
            break;
        case 'week':
            next.setDate(next.getDate() + (interval * 7));
            break;
        case 'month':
            next.setMonth(next.getMonth() + interval);
            break;
    }
    return next;
}

function calculateCyclesPassed(lastReset: Date, now: Date, interval: number, unit: CycleUnit): number {
    const diffMs = now.getTime() - lastReset.getTime();
    let cycleMs = 0;

    switch (unit) {
        case 'hour':
            cycleMs = interval * 60 * 60 * 1000;
            break;
        case 'day':
            cycleMs = interval * 24 * 60 * 60 * 1000;
            break;
        case 'week':
            cycleMs = interval * 7 * 24 * 60 * 60 * 1000;
            break;
        case 'month':
            const monthsDiff = (now.getFullYear() - lastReset.getFullYear()) * 12 + (now.getMonth() - lastReset.getMonth());
            return Math.floor(monthsDiff / interval);
    }

    return Math.floor(diffMs / cycleMs);
}
