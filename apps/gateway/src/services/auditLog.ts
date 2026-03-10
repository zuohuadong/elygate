import { sql } from '@elygate/db';

/**
 * Audit Log Service
 * Records sensitive operations for security and compliance
 */

export type AuditAction =
    | 'user.create'
    | 'user.update'
    | 'user.delete'
    | 'user.login'
    | 'user.logout'
    | 'user.lock'
    | 'user.unlock'
    | 'token.create'
    | 'token.update'
    | 'token.delete'
    | 'token.regenerate'
    | 'channel.create'
    | 'channel.update'
    | 'channel.delete'
    | 'channel.test'
    | 'channel.enable'
    | 'channel.disable'
    | 'system.config'
    | 'system.backup'
    | 'system.restore';

export interface AuditLog {
    id?: number;
    userId: number;
    username: string;
    action: AuditAction;
    resource: string;
    resourceId?: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
    createdAt?: Date;
}

/**
 * Record an audit log entry
 */
export async function recordAuditLog(log: Omit<AuditLog, 'id' | 'createdAt'>): Promise<void> {
    try {
        await sql`
            INSERT INTO audit_logs (user_id, username, action, resource, resource_id, details, ip_address, user_agent, created_at)
            VALUES (
                ${log.userId},
                ${log.username},
                ${log.action},
                ${log.resource},
                ${log.resourceId || null},
                ${JSON.stringify(log.details) || null},
                ${log.ipAddress || null},
                ${log.userAgent || null},
                NOW()
            )
        `;
    } catch (error) {
        console.error('[AuditLog] Failed to record audit log:', error);
    }
}

/**
 * Get audit logs with pagination
 */
export async function getAuditLogs(
    options: {
        userId?: number;
        action?: AuditAction;
        resource?: string;
        limit?: number;
        offset?: number;
    } = {}
): Promise<{ logs: any[]; total: number }> {
    const { userId, action, resource, limit = 50, offset = 0 } = options;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (userId) {
        whereClause += ` AND user_id = $${params.length + 1}`;
        params.push(userId);
    }

    if (action) {
        whereClause += ` AND action = $${params.length + 1}`;
        params.push(action);
    }

    if (resource) {
        whereClause += ` AND resource = $${params.length + 1}`;
        params.push(resource);
    }

    const [countResult] = await sql.unsafe(`
        SELECT COUNT(*) as total FROM audit_logs ${whereClause}
    `, params);

    const logs = await sql.unsafe(`
        SELECT * FROM audit_logs ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    return {
        logs,
        total: Number(countResult.total)
    };
}

/**
 * Get audit logs for a specific user
 */
export async function getUserAuditLogs(
    userId: number,
    limit: number = 50
): Promise<any[]> {
    return await sql`
        SELECT * FROM audit_logs
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit}
    `;
}

/**
 * Clean old audit logs (older than retention days)
 */
export async function cleanOldAuditLogs(retentionDays: number = 90): Promise<number> {
    const result = await sql`
        DELETE FROM audit_logs
        WHERE created_at < NOW() - INTERVAL '1 day' * ${retentionDays}
        RETURNING id
    `;

    return result.length;
}
