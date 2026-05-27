import { log } from '../services/logger';
import { db, sql } from '@elygate/db';
import { auditLogs } from '@elygate/db/schema';
import { eq, desc, count, sql as drizzleSql } from 'drizzle-orm';

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
    | 'organization.create'
    | 'organization.update'
    | 'organization.delete'
    | 'organization.quota'
    | 'system.config'
    | 'system.backup'
    | 'system.restore'
    | 'team.create'
    | 'team.update'
    | 'team.delete'
    | 'team.member.add'
    | 'team.member.remove'
    | 'project.create'
    | 'project.update'
    | 'project.delete'
    | 'token.restore'
    | 'token.purge'
    | 'organization.restore'
    | 'organization.purge'
    | 'team.restore'
    | 'team.purge'
    | 'project.restore'
    | 'project.purge';

export interface AuditLog {
    id?: number;
    userId: number;
    username: string;
    action: AuditAction;
    resource: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    createdAt?: Date;
}

export async function recordAuditLog(entry: Omit<AuditLog, 'id' | 'createdAt'>): Promise<void> {
    try {
        await db.insert(auditLogs).values({
            userId: entry.userId,
            username: entry.username,
            action: entry.action,
            resource: entry.resource,
            resourceId: entry.resourceId || null,
            details: entry.details || null,
            ipAddress: entry.ipAddress || null,
            userAgent: entry.userAgent || null,
            createdAt: new Date(),
        });
    } catch (error: unknown) {
        log.error('[AuditLog] Failed to record audit log:', error);
    }
}

export async function getAuditLogs(
    options: {
        userId?: number;
        action?: AuditAction;
        resource?: string;
        limit?: number;
        offset?: number;
    } = {}
): Promise<{ logs: Record<string, any>[]; total: number }> {
    const { userId, action, resource, limit = 50, offset = 0 } = options;

    const conditions = [];
    if (userId) conditions.push(eq(auditLogs.userId, userId));
    if (action) conditions.push(eq(auditLogs.action, action));
    if (resource) conditions.push(eq(auditLogs.resource, resource));

    const whereClause = conditions.length > 0
        ? drizzleSql.join(conditions, drizzleSql` AND `)
        : undefined;

    const [countResult] = await db.select({ total: count() })
        .from(auditLogs)
        .where(whereClause);

    const rows = await db.select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset);

    return {
        logs: rows,
        total: countResult?.total || 0
    };
}

export async function getUserAuditLogs(
    userId: number,
    limit: number = 50
): Promise<any[]> {
    return await db.select()
        .from(auditLogs)
        .where(eq(auditLogs.userId, userId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
}

export async function cleanOldAuditLogs(retentionDays: number = 90): Promise<number> {
    const result = await db.delete(auditLogs)
        .where(drizzleSql`${auditLogs.createdAt} < NOW() - INTERVAL '1 day' * ${retentionDays}`)
        .returning({ id: auditLogs.id });

    return result.length;
}
