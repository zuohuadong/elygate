import { log } from '../services/logger';
import { db, sql } from '@elygate/db';
import { users, budgetAlerts } from '@elygate/db/schema';
import { eq, and, gt, desc, sql as drizzleSql } from 'drizzle-orm';

/**
 * Budget Alert Service
 * Monitors user quota usage and sends alerts when thresholds are reached
 */

export interface BudgetAlert {
    userId: number;
    username: string;
    email?: string;
    quota: number;
    usedQuota: number;
    usagePercent: number;
    alertLevel: 'warning' | 'critical' | 'exhausted';
}

export interface AlertThreshold {
    warning: number;
    critical: number;
    exhausted: number;
}

const DEFAULT_THRESHOLDS: AlertThreshold = {
    warning: 0.5,
    critical: 0.8,
    exhausted: 0.9
};

export async function checkQuotaUsage(
    userId: number,
    thresholds: AlertThreshold = DEFAULT_THRESHOLDS
): Promise<BudgetAlert | null> {
    const [user] = await db.select({
        id: users.id,
        username: users.username,
        email: users.email,
        quota: users.quota,
        usedQuota: users.usedQuota,
    })
    .from(users)
    .where(eq(users.id, userId));

    if (!user || user.quota <= 0) return null;

    const usagePercent = user.usedQuota / user.quota;

    let alertLevel: BudgetAlert['alertLevel'] | null = null;
    if (usagePercent >= thresholds.exhausted) {
        alertLevel = 'exhausted';
    } else if (usagePercent >= thresholds.critical) {
        alertLevel = 'critical';
    } else if (usagePercent >= thresholds.warning) {
        alertLevel = 'warning';
    }

    if (!alertLevel) return null;

    return {
        userId: user.id,
        username: user.username,
        email: user.email ?? undefined,
        quota: user.quota,
        usedQuota: user.usedQuota,
        usagePercent,
        alertLevel
    };
}

export async function checkAllUsersQuota(): Promise<BudgetAlert[]> {
    const alerts: BudgetAlert[] = [];

    const allUsers = await db.select({
        id: users.id,
        username: users.username,
        email: users.email,
        quota: users.quota,
        usedQuota: users.usedQuota,
    })
    .from(users)
    .where(and(gt(users.quota, 0), eq(users.status, 1)));

    for (const user of allUsers) {
        const alert = await checkQuotaUsage(user.id);
        if (alert) {
            alerts.push(alert);
        }
    }

    return alerts;
}

export async function recordBudgetAlert(alert: BudgetAlert): Promise<void> {
    await db.insert(budgetAlerts).values({
        userId: alert.userId,
        username: alert.username,
        quota: alert.quota,
        usedQuota: alert.usedQuota,
        usagePercent: String(alert.usagePercent),
        alertLevel: alert.alertLevel,
        createdAt: new Date(),
    })
    .onConflictDoNothing();
}

export async function getUserBudgetAlerts(userId: number): Promise<any[]> {
    return await db.select()
        .from(budgetAlerts)
        .where(eq(budgetAlerts.userId, userId))
        .orderBy(desc(budgetAlerts.createdAt))
        .limit(10);
}

export async function sendBudgetAlertNotification(alert: BudgetAlert): Promise<void> {
    log.info(`[BudgetAlert] User ${alert.username} has reached ${Math.round(alert.usagePercent * 100)}% quota usage`);
}
