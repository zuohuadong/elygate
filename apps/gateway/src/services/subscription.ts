import { log } from '../services/logger';
import { sql } from '@elygate/db';

export type CycleUnit = 'hour' | 'day' | 'week' | 'month';

/**
 * Core logic for checking and replenishing subscription-based quotas.
 * Implements a "Lazy Reset" pattern: quotas are refilled when a user makes a request
 * after their cycle reset period has passed.
 */
export async function checkAndResetSubscriptionQuota(userId: number): Promise<void> {
    // 1. Fetch active subscriptions with cycle configuration
    const activeSubs = await sql`
        SELECT 
            us.id, 
            us.last_reset_at,
            p.cycle_quota, 
            p.cycle_interval, 
            p.cycle_unit
        FROM user_subscriptions us
        JOIN packages p ON us.package_id = p.id
        WHERE us.user_id = ${userId}
          AND us.status = 1
          AND us.start_time <= NOW()
          AND us.end_time > NOW()
          AND p.cycle_quota > 0
    `;

    if (activeSubs.length === 0) return;

    const now = new Date();
    let totalRefill = 0;
    const resetSubIds: number[] = [];

    for (const sub of activeSubs) {
        const lastReset = new Date(sub.last_reset_at);
        const nextReset = calculateNextReset(lastReset, sub.cycle_interval, sub.cycle_unit as CycleUnit);

        if (now >= nextReset) {
            // How many cycles have passed? (In case of long inactivity)
            const cyclesPassed = calculateCyclesPassed(lastReset, now, sub.cycle_interval, sub.cycle_unit as CycleUnit);
            
            if (cyclesPassed > 0) {
                totalRefill += Number(sub.cycle_quota); // Refill for the current cycle
                resetSubIds.push(sub.id);
            }
        }
    }

    if (resetSubIds.length > 0) {
        log.info(`[Subscription] Refilling quota for User ${userId}. Total: ${totalRefill}. Subs: ${resetSubIds.join(',')}`);
        
        await sql.begin(async (tx) => {
            // Refill user quota
            await tx`UPDATE users SET quota = quota + ${totalRefill} WHERE id = ${userId}`;
            
            // Update last_reset_at for all processed subscriptions
            await tx`
                UPDATE user_subscriptions 
                SET last_reset_at = NOW() 
                WHERE id IN ${sql(resetSubIds)}
            `;
        });
    }
}

/**
 * Calculates when the next reset should occur based on the last reset time.
 */
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

/**
 * Determines how many full cycles have passed since the last reset.
 * We primarily refill once even if multiple cycles passed (standard practice for "use it or lose it" cycles),
 * but we return the count for future flexibility.
 */
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
            // Approximate if month, or use more complex calendar math if needed.
            // For monthly cycles, we usually just care if the month-day match has passed.
            const monthsDiff = (now.getFullYear() - lastReset.getFullYear()) * 12 + (now.getMonth() - lastReset.getMonth());
            return Math.floor(monthsDiff / interval);
    }

    return Math.floor(diffMs / cycleMs);
}
