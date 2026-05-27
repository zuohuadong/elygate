import { log } from '../services/logger';
import { db } from '@elygate/db';
import { packages, userSubscriptions, users } from '@elygate/db/schema';
import { and, desc, eq, gt, inArray, lte, sql as drizzleSql } from 'drizzle-orm';

type PackageRow = typeof packages.$inferSelect;
type SubscriptionRow = typeof userSubscriptions.$inferSelect;

export type ResetPeriod = 'never' | 'daily' | 'weekly' | 'monthly' | 'custom';

function startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function startOfNextWeek(date: Date) {
    const base = startOfDay(date);
    const weekday = base.getDay() === 0 ? 7 : base.getDay();
    base.setDate(base.getDate() + (8 - weekday));
    return base;
}

function startOfNextMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
}

function durationEndFromPackage(pkg: PackageRow, now = new Date()) {
    const unit = String(pkg.durationUnit || '').trim() || 'day';
    const value = Number(pkg.durationValue || 0);
    const customSeconds = Number(pkg.customSeconds || 0);
    const fallbackDays = Number(pkg.durationDays || 30);
    const end = new Date(now);

    switch (unit) {
        case 'year':
            end.setFullYear(end.getFullYear() + Math.max(value, 1));
            return end;
        case 'month':
            end.setMonth(end.getMonth() + Math.max(value, 1));
            return end;
        case 'day':
            end.setDate(end.getDate() + Math.max(value, fallbackDays, 1));
            return end;
        case 'hour':
            end.setHours(end.getHours() + Math.max(value, 1));
            return end;
        case 'custom':
            end.setSeconds(end.getSeconds() + Math.max(customSeconds, 1));
            return end;
        default:
            end.setDate(end.getDate() + Math.max(fallbackDays, 1));
            return end;
    }
}

function resolveResetPolicy(pkg: PackageRow): { period: ResetPeriod; interval: number; customSeconds: number } {
    const explicit = String(pkg.quotaResetPeriod || 'never').trim().toLowerCase();
    if (explicit === 'daily' || explicit === 'weekly' || explicit === 'monthly') {
        return { period: explicit, interval: 1, customSeconds: 0 };
    }
    if (explicit === 'custom') {
        return {
            period: 'custom',
            interval: Math.max(Number(pkg.cycleInterval || 1), 1),
            customSeconds: Math.max(Number(pkg.quotaResetCustomSeconds || 0), 1),
        };
    }

    const cycleUnit = String(pkg.cycleUnit || '').trim().toLowerCase();
    const interval = Math.max(Number(pkg.cycleInterval || 1), 1);
    if (cycleUnit === 'day') return { period: 'daily', interval, customSeconds: 0 };
    if (cycleUnit === 'week') return { period: 'weekly', interval, customSeconds: 0 };
    if (cycleUnit === 'month') return { period: 'monthly', interval, customSeconds: 0 };
    if (cycleUnit === 'hour') return { period: 'custom', interval: 1, customSeconds: interval * 3600 };
    return { period: 'never', interval: 1, customSeconds: 0 };
}

function calculateNextReset(base: Date, pkg: PackageRow, endTime?: Date | null) {
    const policy = resolveResetPolicy(pkg);
    if (policy.period === 'never') return null;

    let next: Date;
    switch (policy.period) {
        case 'daily':
            next = startOfDay(base);
            next.setDate(next.getDate() + Math.max(policy.interval, 1));
            break;
        case 'weekly':
            next = startOfNextWeek(base);
            next.setDate(next.getDate() + ((Math.max(policy.interval, 1) - 1) * 7));
            break;
        case 'monthly':
            next = startOfNextMonth(base);
            next.setMonth(next.getMonth() + (Math.max(policy.interval, 1) - 1));
            break;
        case 'custom':
            next = new Date(base.getTime() + (policy.customSeconds * 1000));
            break;
        default:
            return null;
    }

    if (endTime && next > endTime) return null;
    return next;
}

function countResetCycles(lastResetAt: Date, now: Date, pkg: PackageRow) {
    const policy = resolveResetPolicy(pkg);
    if (policy.period === 'never') return 0;
    if (policy.period === 'custom') {
        const diffSeconds = Math.floor((now.getTime() - lastResetAt.getTime()) / 1000);
        return Math.max(Math.floor(diffSeconds / Math.max(policy.customSeconds, 1)), 0);
    }

    let cycles = 0;
    let cursor = calculateNextReset(lastResetAt, pkg);
    while (cursor && cursor <= now) {
        cycles += 1;
        cursor = calculateNextReset(cursor, pkg);
        if (cycles > 1000) break;
    }
    return cycles;
}

async function downgradeUserGroupForSubscription(tx: any, sub: SubscriptionRow) {
    if (!sub.upgradeGroup || !sub.prevUserGroup) return;

    const [currentUser] = await tx.select({
        id: users.id,
        group: users.group,
    }).from(users).where(eq(users.id, sub.userId)).limit(1);
    if (!currentUser || currentUser.group !== sub.upgradeGroup) return;

    const [otherActive] = await tx.select({
        id: userSubscriptions.id,
    }).from(userSubscriptions)
        .where(and(
            eq(userSubscriptions.userId, sub.userId),
            eq(userSubscriptions.status, 1),
            gt(userSubscriptions.endTime, new Date()),
            eq(userSubscriptions.upgradeGroup, sub.upgradeGroup),
        ))
        .orderBy(desc(userSubscriptions.endTime))
        .limit(1);
    if (otherActive) return;

    await tx.update(users)
        .set({ group: sub.prevUserGroup, updatedAt: new Date() })
        .where(eq(users.id, sub.userId));
}

export async function syncExpiredSubscriptionsForUser(userId: number) {
    const now = new Date();
    await db.transaction(async (tx) => {
        const expired = await tx.select().from(userSubscriptions).where(and(
            eq(userSubscriptions.userId, userId),
            eq(userSubscriptions.status, 1),
            lte(userSubscriptions.endTime, now),
        ));

        for (const sub of expired) {
            await tx.update(userSubscriptions)
                .set({ status: 2, updatedAt: now })
                .where(eq(userSubscriptions.id, sub.id));
            await downgradeUserGroupForSubscription(tx, sub);
        }
    });
}

async function bindSubscriptionToUserTx(tx: any, userId: number, packageId: number, source: 'order' | 'admin' = 'order') {
        const [pkg] = await tx.select().from(packages).where(eq(packages.id, packageId)).limit(1);
        if (!pkg) throw new Error('Package not found');
        if (!pkg.enabled) throw new Error('Package is disabled');

        if (Number(pkg.maxPurchasePerUser || 0) > 0) {
            const [purchaseCount] = await tx.select({
                total: drizzleSql<number>`count(*)::int`,
            }).from(userSubscriptions).where(and(
                eq(userSubscriptions.userId, userId),
                eq(userSubscriptions.packageId, packageId),
            ));
            if (Number(purchaseCount?.total || 0) >= Number(pkg.maxPurchasePerUser)) {
                throw new Error('Purchase limit reached for this package');
            }
        }

        const now = new Date();
        const endTime = durationEndFromPackage(pkg, now);
        const nextResetAt = calculateNextReset(now, pkg, endTime);
        let prevUserGroup: string | null = null;

        if (pkg.upgradeGroup) {
            const [currentUser] = await tx.select({
                id: users.id,
                group: users.group,
            }).from(users).where(eq(users.id, userId)).limit(1);
            if (currentUser && currentUser.group !== pkg.upgradeGroup) {
                prevUserGroup = currentUser.group;
                await tx.update(users)
                    .set({ group: pkg.upgradeGroup, updatedAt: now })
                    .where(eq(users.id, userId));
            }
        }

        const initialQuota = Number(pkg.totalAmount || 0) > 0
            ? Number(pkg.totalAmount || 0)
            : Number(pkg.cycleQuota || 0);

        const [sub] = await tx.insert(userSubscriptions).values({
            userId,
            packageId,
            status: 1,
            source,
            startTime: now,
            endTime,
            amountTotal: Number(pkg.totalAmount || 0),
            amountUsed: 0,
            quotaGranted: Number(pkg.cycleQuota || 0),
            quotaUsed: 0,
            lastResetAt: now,
            nextResetAt,
            upgradeGroup: pkg.upgradeGroup || null,
            prevUserGroup,
        }).returning();

        if (initialQuota > 0) {
            await tx.update(users)
                .set({ quota: drizzleSql`${users.quota} + ${initialQuota}` })
                .where(eq(users.id, userId));
        }

        return sub;
}

export async function bindSubscriptionToUser(userId: number, packageId: number, source: 'order' | 'admin' = 'order') {
    return await db.transaction(async (tx) => bindSubscriptionToUserTx(tx, userId, packageId, source));
}

export { bindSubscriptionToUserTx };

export async function cancelSubscription(subscriptionId: number, hardDelete = false) {
    await db.transaction(async (tx) => {
        const [sub] = await tx.select().from(userSubscriptions).where(eq(userSubscriptions.id, subscriptionId)).limit(1);
        if (!sub) throw new Error('Subscription not found');

        if (hardDelete) {
            await downgradeUserGroupForSubscription(tx, sub);
            await tx.delete(userSubscriptions).where(eq(userSubscriptions.id, subscriptionId));
            return;
        }

        const now = new Date();
        await tx.update(userSubscriptions)
            .set({ status: 3, endTime: now, updatedAt: now })
            .where(eq(userSubscriptions.id, subscriptionId));
        await downgradeUserGroupForSubscription(tx, sub);
    });
}

export async function checkAndResetSubscriptionQuota(userId: number): Promise<void> {
    await syncExpiredSubscriptionsForUser(userId);

    const activeSubs = await db.select({
        id: userSubscriptions.id,
        userId: userSubscriptions.userId,
        lastResetAt: userSubscriptions.lastResetAt,
        nextResetAt: userSubscriptions.nextResetAt,
        endTime: userSubscriptions.endTime,
        cycleQuota: packages.cycleQuota,
        cycleInterval: packages.cycleInterval,
        cycleUnit: packages.cycleUnit,
        quotaResetPeriod: packages.quotaResetPeriod,
        quotaResetCustomSeconds: packages.quotaResetCustomSeconds,
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
    const updatePayloads: Array<{ id: number; lastResetAt: Date; nextResetAt: Date | null }> = [];

    for (const sub of activeSubs) {
        const pkg = {
            cycleInterval: sub.cycleInterval,
            cycleUnit: sub.cycleUnit,
            quotaResetPeriod: sub.quotaResetPeriod,
            quotaResetCustomSeconds: sub.quotaResetCustomSeconds,
        } as PackageRow;

        const lastResetAt = sub.lastResetAt ? new Date(sub.lastResetAt) : now;
        const cyclesPassed = countResetCycles(lastResetAt, now, pkg);
        if (cyclesPassed <= 0) continue;

        totalRefill += Number(sub.cycleQuota || 0) * cyclesPassed;

        let cursor = lastResetAt;
        for (let i = 0; i < cyclesPassed; i += 1) {
            const next = calculateNextReset(cursor, pkg, sub.endTime ? new Date(sub.endTime) : null);
            if (!next) break;
            cursor = next;
        }

        updatePayloads.push({
            id: sub.id,
            lastResetAt: cursor,
            nextResetAt: calculateNextReset(cursor, pkg, sub.endTime ? new Date(sub.endTime) : null),
        });
    }

    if (totalRefill <= 0 || updatePayloads.length === 0) return;

    log.info(`[Subscription] Refilling quota for User ${userId}. Total: ${totalRefill}. Subs: ${updatePayloads.map((item) => item.id).join(',')}`);

    await db.transaction(async (tx) => {
        await tx.update(users)
            .set({ quota: drizzleSql`${users.quota} + ${totalRefill}` })
            .where(eq(users.id, userId));

        for (const item of updatePayloads) {
            await tx.update(userSubscriptions)
                .set({
                    lastResetAt: item.lastResetAt,
                    nextResetAt: item.nextResetAt,
                    updatedAt: new Date(),
                })
                .where(eq(userSubscriptions.id, item.id));
        }
    });
}

export async function syncExpiredSubscriptionsBatch() {
    const now = new Date();
    const rows = await db.select({
        id: userSubscriptions.id,
        userId: userSubscriptions.userId,
    }).from(userSubscriptions).where(and(
        eq(userSubscriptions.status, 1),
        lte(userSubscriptions.endTime, now),
    ));

    const userIds = [...new Set(rows.map((row) => row.userId))];
    for (const userId of userIds) {
        await syncExpiredSubscriptionsForUser(userId);
    }
}
