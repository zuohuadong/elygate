import { sql } from '@elygate/db';

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
    warning: number;    // e.g., 0.5 (50%)
    critical: number;   // e.g., 0.8 (80%)
    exhausted: number;  // e.g., 0.9 (90%)
}

const DEFAULT_THRESHOLDS: AlertThreshold = {
    warning: 0.5,    // 50%
    critical: 0.8,   // 80%
    exhausted: 0.9   // 90%
};

/**
 * Check user quota usage and determine if alert is needed
 */
export async function checkQuotaUsage(
    userId: number,
    thresholds: AlertThreshold = DEFAULT_THRESHOLDS
): Promise<BudgetAlert | null> {
    const [user] = await sql`
        SELECT id, username, email, quota, used_quota
        FROM users
        WHERE id = ${userId}
    `;

    if (!user || user.quota <= 0) return null;

    const usagePercent = user.used_quota / user.quota;

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
        email: user.email,
        quota: user.quota,
        usedQuota: user.used_quota,
        usagePercent,
        alertLevel
    };
}

/**
 * Check all users for quota alerts
 */
export async function checkAllUsersQuota(): Promise<BudgetAlert[]> {
    const alerts: BudgetAlert[] = [];

    const users = await sql`
        SELECT id, username, email, quota, used_quota
        FROM users
        WHERE quota > 0 AND status = 1
    `;

    for (const user of users) {
        const alert = await checkQuotaUsage(user.id);
        if (alert) {
            alerts.push(alert);
        }
    }

    return alerts;
}

/**
 * Record budget alert in database
 */
export async function recordBudgetAlert(alert: BudgetAlert): Promise<void> {
    await sql`
        INSERT INTO budget_alerts (user_id, username, quota, used_quota, usage_percent, alert_level, created_at)
        VALUES (${alert.userId}, ${alert.username}, ${alert.quota}, ${alert.usedQuota}, ${alert.usagePercent}, ${alert.alertLevel}, NOW())
        ON CONFLICT (user_id, alert_level, DATE(created_at))
        DO NOTHING
    `;
}

/**
 * Get budget alerts for a user
 */
export async function getUserBudgetAlerts(userId: number): Promise<any[]> {
    return await sql`
        SELECT * FROM budget_alerts
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 10
    `;
}

/**
 * Send budget alert notification (placeholder for email/webhook integration)
 */
export async function sendBudgetAlertNotification(alert: BudgetAlert): Promise<void> {
    console.log(`[BudgetAlert] User ${alert.username} has reached ${Math.round(alert.usagePercent * 100)}% quota usage`);

    // TODO: Implement email notification
    // TODO: Implement webhook notification
    // TODO: Implement in-app notification
}
