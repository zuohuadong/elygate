import type { ElysiaCtx } from '../../types';
import { Elysia } from 'elysia';
import { db } from '@elygate/db';
import { auditLogs, budgetAlerts, deletedRecords, logs, organizations, projects, teamMembers, teams, tokens, users } from '@elygate/db/schema';
import {
    and,
    count,
    desc,
    eq,
    gte,
    ilike,
    isNotNull,
    isNull,
    max,
    or,
    sql as drizzleSql,
    sum,
} from 'drizzle-orm';
import { recordAuditLog, getAuditLogs } from '../../services/auditLog';
import { getErrorMessage } from '../../utils/error';
import { getClientIpFromHeaders } from '../../utils/ipAccess';

function maskTokenKey(value: unknown): string {
    const key = String(value || '');
    if (!key) return '';
    return key.length > 14 ? `${key.slice(0, 8)}...${key.slice(-4)}` : '***';
}

function toInt(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function toBool(value: unknown, fallback = false): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value).trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(normalized);
}

function parseStringList(value: unknown): string[] {
    if (value === undefined || value === null || value === '') return [];
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parseStringList(parsed);
        } catch {
            // Fall through to comma/newline splitting.
        }
        return trimmed.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    }
    return [];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function parseDateOrNull(value: unknown): Date | null {
    if (!value) return null;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
}

function usagePercent(used: unknown, quota: unknown): number {
    const usedNum = Number(used || 0);
    const quotaNum = Number(quota || 0);
    if (!quotaNum || quotaNum < 0) return 0;
    return Math.round((usedNum / quotaNum) * 10000) / 100;
}

function auditMeta(ctx: ElysiaCtx) {
    return {
        userId: ctx.user?.id || 0,
        username: ctx.user?.username || `user-${ctx.user?.id || 'unknown'}`,
        ipAddress: ctx.request ? getClientIpFromHeaders(ctx.request.headers) : undefined,
        userAgent: ctx.request?.headers?.get?.('user-agent') || undefined,
    };
}

export const enterpriseRouter = new Elysia()
    .get('/enterprise/overview', async () => {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const [
            [userTotal],
            [tokenTotal],
            [activeTokenTotal],
            [orgTotal],
            [logStats],
            [errorStats],
            [audit24h],
            [budgetAlert7d],
            topTokens,
            topOrgs,
            modelDistribution,
            recentAudit,
            recentAlerts,
        ] = await Promise.all([
            db.select({ total: count() }).from(users),
            db.select({ total: count() }).from(tokens),
            db.select({ total: count() }).from(tokens).where(eq(tokens.status, 1)),
            db.select({ total: count() }).from(organizations),
            db.select({ total: count(), cost: sum(logs.quotaCost) }).from(logs).where(gte(logs.createdAt, sevenDaysAgo)),
            db.select({ total: count() }).from(logs).where(and(gte(logs.createdAt, sevenDaysAgo), or(gte(logs.statusCode, 400), isNotNull(logs.errorMessage)))),
            db.select({ total: count() }).from(auditLogs).where(gte(auditLogs.createdAt, dayAgo)),
            db.select({ total: count() }).from(budgetAlerts).where(gte(budgetAlerts.createdAt, sevenDaysAgo)),
            db.select({
                id: tokens.id,
                name: tokens.name,
                key: tokens.key,
                status: tokens.status,
                usedQuota: tokens.usedQuota,
                remainQuota: tokens.remainQuota,
                accessedAt: tokens.accessedAt,
                userId: tokens.userId,
                username: users.username,
                orgId: tokens.orgId,
                orgName: organizations.name,
            }).from(tokens)
                .leftJoin(users, eq(tokens.userId, users.id))
                .leftJoin(organizations, eq(tokens.orgId, organizations.id))
                .orderBy(desc(tokens.usedQuota))
                .limit(8),
            db.select().from(organizations).orderBy(desc(organizations.usedQuota)).limit(8),
            db.select({ modelName: logs.modelName, requests: count(), cost: sum(logs.quotaCost), lastUsedAt: max(logs.createdAt) })
                .from(logs)
                .where(gte(logs.createdAt, sevenDaysAgo))
                .groupBy(logs.modelName)
                .orderBy(desc(count()))
                .limit(10),
            db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(12),
            db.select().from(budgetAlerts).orderBy(desc(budgetAlerts.createdAt)).limit(12),
        ]);

        const requests7d = Number(logStats?.total || 0);
        const errors7d = Number(errorStats?.total || 0);

        return {
            success: true,
            data: {
                stats: {
                    totalUsers: userTotal?.total || 0,
                    totalTokens: tokenTotal?.total || 0,
                    activeTokens: activeTokenTotal?.total || 0,
                    totalOrganizations: orgTotal?.total || 0,
                    requests7d,
                    cost7d: Number(logStats?.cost || 0),
                    failureRate7d: requests7d > 0 ? Math.round((errors7d / requests7d) * 10000) / 100 : 0,
                    audit24h: audit24h?.total || 0,
                    budgetAlerts7d: budgetAlert7d?.total || 0,
                },
                topTokens: topTokens.map((row) => ({ ...row, key: maskTokenKey(row.key), usagePercent: usagePercent(row.usedQuota, row.remainQuota) })),
                topOrganizations: topOrgs.map((row) => ({ ...row, usagePercent: usagePercent(row.usedQuota, row.quota) })),
                modelDistribution,
                recentAudit,
                recentAlerts: recentAlerts.map((row) => ({ type: 'user', ...row })),
            },
        };
    })

    .get('/enterprise/tokens', async ({ query }: ElysiaCtx) => {
        const page = Math.max(1, toInt(query?.page, 1));
        const limit = Math.min(200, Math.max(1, toInt(query?.limit, 30)));
        const offset = (page - 1) * limit;
        const conditions = [];

        if (query?.keyword) {
            const keyword = `%${String(query.keyword).trim()}%`;
            conditions.push(or(ilike(tokens.name, keyword), ilike(users.username, keyword), ilike(organizations.name, keyword)));
        }
        if (query?.user_id) conditions.push(eq(tokens.userId, toInt(query.user_id)));
        if (query?.org_id) conditions.push(eq(tokens.orgId, toInt(query.org_id)));
        if (query?.status) conditions.push(eq(tokens.status, toInt(query.status)));
        const whereClause = conditions.length ? and(...conditions) : undefined;

        const [totalRow] = await db.select({ total: count() })
            .from(tokens)
            .leftJoin(users, eq(tokens.userId, users.id))
            .leftJoin(organizations, eq(tokens.orgId, organizations.id))
            .where(whereClause);

        const rows = await db.select({
            id: tokens.id,
            name: tokens.name,
            key: tokens.key,
            status: tokens.status,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            models: tokens.models,
            subnet: tokens.subnet,
            allowIps: tokens.allowIps,
            rateLimit: tokens.rateLimit,
            unlimitedQuota: tokens.unlimitedQuota,
            modelLimitsEnabled: tokens.modelLimitsEnabled,
            tokenGroup: tokens.tokenGroup,
            crossGroupRetry: tokens.crossGroupRetry,
            accessedAt: tokens.accessedAt,
            expiredAt: tokens.expiredAt,
            createdAt: tokens.createdAt,
            updatedAt: tokens.updatedAt,
            userId: tokens.userId,
            userName: users.username,
            orgId: tokens.orgId,
            orgName: organizations.name,
        }).from(tokens)
            .leftJoin(users, eq(tokens.userId, users.id))
            .leftJoin(organizations, eq(tokens.orgId, organizations.id))
            .where(whereClause)
            .orderBy(desc(tokens.id))
            .limit(limit)
            .offset(offset);

        return {
            success: true,
            data: rows.map((row) => ({ ...row, key: maskTokenKey(row.key), usagePercent: usagePercent(row.usedQuota, row.remainQuota) })),
            total: totalRow?.total || 0,
        };
    })

    .post('/enterprise/tokens', async (ctx: ElysiaCtx) => {
        try {
            const b = ctx.body as Record<string, any>;
            const key = `sk-${Bun.randomUUIDv7('hex')}`;
            const [created] = await db.insert(tokens).values({
                userId: toInt(b.userId || b.user_id || ctx.user.id),
                orgId: b.orgId || b.org_id ? toInt(b.orgId ?? b.org_id) : null,
                name: String(b.name || 'Enterprise Token'),
                key,
                status: toInt(b.status, 1),
                remainQuota: toInt(b.remainQuota ?? b.remain_quota, -1),
                models: parseStringList(b.models),
                subnet: b.subnet || null,
                allowIps: b.allowIps ?? b.allow_ips ?? null,
                rateLimit: toInt(b.rateLimit ?? b.rate_limit, 0),
                expiredAt: parseDateOrNull(b.expiredAt ?? b.expired_at),
                unlimitedQuota: toBool(b.unlimitedQuota ?? b.unlimited_quota, false),
                modelLimitsEnabled: toBool(b.modelLimitsEnabled ?? b.model_limits_enabled, false),
                tokenGroup: b.tokenGroup ?? b.token_group ?? null,
                crossGroupRetry: toBool(b.crossGroupRetry ?? b.cross_group_retry, false),
            }).returning();

            await recordAuditLog({
                ...auditMeta(ctx),
                action: 'token.create',
                resource: 'token',
                resourceId: String(created.id),
                details: { name: created.name, userId: created.userId, orgId: created.orgId },
            });

            return { success: true, data: { ...created, key } };
        } catch (e: unknown) {
            ctx.set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .put('/enterprise/tokens/:id', async (ctx: ElysiaCtx) => {
        try {
            const id = toInt(ctx.params.id);
            const b = ctx.body as Record<string, any>;
            const patch: Record<string, any> = { updatedAt: new Date() };
            if ('name' in b) patch.name = b.name;
            if ('userId' in b || 'user_id' in b) patch.userId = toInt(b.userId ?? b.user_id);
            if ('orgId' in b || 'org_id' in b) patch.orgId = b.orgId || b.org_id ? toInt(b.orgId ?? b.org_id) : null;
            if ('status' in b) patch.status = toInt(b.status, 1);
            if ('remainQuota' in b || 'remain_quota' in b) patch.remainQuota = toInt(b.remainQuota ?? b.remain_quota, -1);
            if ('models' in b) patch.models = parseStringList(b.models);
            if ('subnet' in b) patch.subnet = b.subnet || null;
            if ('allowIps' in b || 'allow_ips' in b) patch.allowIps = b.allowIps ?? b.allow_ips ?? null;
            if ('rateLimit' in b || 'rate_limit' in b) patch.rateLimit = toInt(b.rateLimit ?? b.rate_limit, 0);
            if ('expiredAt' in b || 'expired_at' in b) patch.expiredAt = parseDateOrNull(b.expiredAt ?? b.expired_at);
            if ('unlimitedQuota' in b || 'unlimited_quota' in b) patch.unlimitedQuota = toBool(b.unlimitedQuota ?? b.unlimited_quota, false);
            if ('modelLimitsEnabled' in b || 'model_limits_enabled' in b) patch.modelLimitsEnabled = toBool(b.modelLimitsEnabled ?? b.model_limits_enabled, false);
            if ('tokenGroup' in b || 'token_group' in b) patch.tokenGroup = b.tokenGroup ?? b.token_group ?? null;
            if ('crossGroupRetry' in b || 'cross_group_retry' in b) patch.crossGroupRetry = toBool(b.crossGroupRetry ?? b.cross_group_retry, false);

            const [updated] = await db.update(tokens).set(patch).where(eq(tokens.id, id)).returning();
            if (!updated) {
                ctx.set.status = 404;
                return { success: false, message: 'Token not found' };
            }

            await recordAuditLog({
                ...auditMeta(ctx),
                action: 'token.update',
                resource: 'token',
                resourceId: String(id),
                details: patch,
            });

            return { success: true, data: { ...updated, key: maskTokenKey(updated.key) } };
        } catch (e: unknown) {
            ctx.set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .post('/enterprise/tokens/:id/regenerate', async (ctx: ElysiaCtx) => {
        const id = toInt(ctx.params.id);
        const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
        const [updated] = await db.update(tokens).set({ key: newKey, updatedAt: new Date() }).where(eq(tokens.id, id)).returning();
        if (!updated) {
            ctx.set.status = 404;
            return { success: false, message: 'Token not found' };
        }
        await recordAuditLog({
            ...auditMeta(ctx),
            action: 'token.regenerate',
            resource: 'token',
            resourceId: String(id),
            details: { name: updated.name },
        });
        return { success: true, data: { ...updated, key: newKey } };
    })

    .delete('/enterprise/tokens/:id', async (ctx: ElysiaCtx) => {
        const id = toInt(ctx.params.id);
        const [deleted] = await db.delete(tokens).where(eq(tokens.id, id)).returning();
        if (!deleted) {
            ctx.set.status = 404;
            return { success: false, message: 'Token not found' };
        }
        await recordAuditLog({
            ...auditMeta(ctx),
            action: 'token.delete',
            resource: 'token',
            resourceId: String(id),
            details: { name: deleted.name, userId: deleted.userId, orgId: deleted.orgId },
        });
        return { success: true, data: { ...deleted, key: maskTokenKey(deleted.key) } };
    })

    .get('/enterprise/organizations', async () => {
        const [orgRows, userCounts, tokenCounts] = await Promise.all([
            db.select().from(organizations).orderBy(desc(organizations.id)),
            db.select({ orgId: users.orgId, total: count() }).from(users).where(isNotNull(users.orgId)).groupBy(users.orgId),
            db.select({ orgId: tokens.orgId, total: count() }).from(tokens).where(isNotNull(tokens.orgId)).groupBy(tokens.orgId),
        ]);
        const usersByOrg = new Map(userCounts.map((row) => [row.orgId, row.total]));
        const tokensByOrg = new Map(tokenCounts.map((row) => [row.orgId, row.total]));

        return {
            success: true,
            data: orgRows.map((row) => ({
                ...row,
                userCount: usersByOrg.get(row.id) || 0,
                tokenCount: tokensByOrg.get(row.id) || 0,
                usagePercent: usagePercent(row.usedQuota, row.quota),
            })),
            total: orgRows.length,
        };
    })

    .post('/enterprise/organizations', async (ctx: ElysiaCtx) => {
        try {
            const b = ctx.body as Record<string, any>;
            const [created] = await db.insert(organizations).values({
                slug: b.slug || null,
                name: String(b.name || b.slug || 'Enterprise Team'),
                billingEmail: b.billingEmail ?? b.billing_email ?? null,
                quota: toInt(b.quota, 0),
                allowedModels: parseStringList(b.allowedModels ?? b.allowed_models),
                deniedModels: parseStringList(b.deniedModels ?? b.denied_models),
                allowedSubnets: String(b.allowedSubnets ?? b.allowed_subnets ?? ''),
                quotaAlarmThreshold: toInt(b.quotaAlarmThreshold ?? b.quota_alarm_threshold, 80),
                alertThresholdPct: toInt(b.alertThresholdPct ?? b.alert_threshold_pct, 80),
                alertWebhookUrl: b.alertWebhookUrl ?? b.alert_webhook_url ?? null,
                status: toInt(b.status, 1),
                metadata: parseJsonObject(b.metadata),
            }).returning();

            await recordAuditLog({
                ...auditMeta(ctx),
                action: 'organization.create',
                resource: 'organization',
                resourceId: String(created.id),
                details: { name: created.name, slug: created.slug, quota: created.quota },
            });
            return { success: true, data: created };
        } catch (e: unknown) {
            ctx.set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .put('/enterprise/organizations/:id', async (ctx: ElysiaCtx) => {
        try {
            const id = toInt(ctx.params.id);
            const b = ctx.body as Record<string, any>;
            const patch: Record<string, any> = { updatedAt: new Date() };
            if ('slug' in b) patch.slug = b.slug || null;
            if ('name' in b) patch.name = b.name;
            if ('billingEmail' in b || 'billing_email' in b) patch.billingEmail = b.billingEmail ?? b.billing_email ?? null;
            if ('quota' in b) patch.quota = toInt(b.quota, 0);
            if ('allowedModels' in b || 'allowed_models' in b) patch.allowedModels = parseStringList(b.allowedModels ?? b.allowed_models);
            if ('deniedModels' in b || 'denied_models' in b) patch.deniedModels = parseStringList(b.deniedModels ?? b.denied_models);
            if ('allowedSubnets' in b || 'allowed_subnets' in b) patch.allowedSubnets = String(b.allowedSubnets ?? b.allowed_subnets ?? '');
            if ('quotaAlarmThreshold' in b || 'quota_alarm_threshold' in b) patch.quotaAlarmThreshold = toInt(b.quotaAlarmThreshold ?? b.quota_alarm_threshold, 80);
            if ('alertThresholdPct' in b || 'alert_threshold_pct' in b) patch.alertThresholdPct = toInt(b.alertThresholdPct ?? b.alert_threshold_pct, 80);
            if ('alertWebhookUrl' in b || 'alert_webhook_url' in b) patch.alertWebhookUrl = b.alertWebhookUrl ?? b.alert_webhook_url ?? null;
            if ('status' in b) patch.status = toInt(b.status, 1);
            if ('metadata' in b) patch.metadata = parseJsonObject(b.metadata);

            const [updated] = await db.update(organizations).set(patch).where(eq(organizations.id, id)).returning();
            if (!updated) {
                ctx.set.status = 404;
                return { success: false, message: 'Organization not found' };
            }
            await recordAuditLog({
                ...auditMeta(ctx),
                action: 'quota' in patch ? 'organization.quota' : 'organization.update',
                resource: 'organization',
                resourceId: String(id),
                details: patch,
            });
            return { success: true, data: updated };
        } catch (e: unknown) {
            ctx.set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .delete('/enterprise/organizations/:id', async (ctx: ElysiaCtx) => {
        const id = toInt(ctx.params.id);
        const [deleted] = await db.delete(organizations).where(eq(organizations.id, id)).returning();
        if (!deleted) {
            ctx.set.status = 404;
            return { success: false, message: 'Organization not found' };
        }
        await recordAuditLog({
            ...auditMeta(ctx),
            action: 'organization.delete',
            resource: 'organization',
            resourceId: String(id),
            details: { name: deleted.name, slug: deleted.slug },
        });
        return { success: true, data: deleted };
    })

    .get('/enterprise/budget-alerts', async () => {
        const [userAlerts, highUsageOrgs] = await Promise.all([
            db.select().from(budgetAlerts).orderBy(desc(budgetAlerts.createdAt)).limit(100),
            db.select().from(organizations).where(drizzleSql`${organizations.quota} > 0 AND ${organizations.usedQuota} * 100 >= ${organizations.quota} * ${organizations.alertThresholdPct}`).orderBy(desc(organizations.usedQuota)).limit(50),
        ]);

        return {
            success: true,
            data: [
                ...userAlerts.map((row) => ({ type: 'user', ...row })),
                ...highUsageOrgs.map((row) => ({
                    type: 'organization',
                    id: `org-${row.id}`,
                    orgId: row.id,
                    name: row.name,
                    quota: row.quota,
                    usedQuota: row.usedQuota,
                    usagePercent: usagePercent(row.usedQuota, row.quota),
                    alertLevel: 'threshold',
                    createdAt: row.updatedAt || row.createdAt,
                })),
            ].sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
        };
    })

    .get('/enterprise/audit-logs', async ({ query }: ElysiaCtx) => {
        const result = await getAuditLogs({
            userId: query?.user_id ? toInt(query.user_id) : undefined,
            action: query?.action || undefined,
            resource: query?.resource || undefined,
            limit: Math.min(200, Math.max(1, toInt(query?.limit, 50))),
            offset: Math.max(0, toInt(query?.offset, 0)),
        } as any);
        return { success: true, data: result.logs, total: result.total };
    });
