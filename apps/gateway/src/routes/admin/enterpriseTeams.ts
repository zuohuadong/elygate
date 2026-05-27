import type { ElysiaCtx } from '../../types';
import { Elysia } from 'elysia';
import { db } from '@elygate/db';
import {
    auditLogs,
    deletedRecords,
    logs,
    organizations,
    projects,
    teamMembers,
    teams,
    tokens,
    users,
} from '@elygate/db/schema';
import {
    and,
    count,
    desc,
    eq,
    gte,
    ilike,
    isNotNull,
    isNull,
    or,
    sql as drizzleSql,
    sum,
} from 'drizzle-orm';
import { recordAuditLog } from '../../services/auditLog';
import { getErrorMessage } from '../../utils/error';
import { getClientIpFromHeaders } from '../../utils/ipAccess';

// ─── Helpers ──────────────────────────────────────────────────

function toInt(v: unknown, fb = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : fb;
}

function toBool(v: unknown, fb = false): boolean {
    if (v == null || v === '') return fb;
    if (typeof v === 'boolean') return v;
    return ['true', '1', 'yes'].includes(String(v).trim().toLowerCase());
}

function parseList(v: unknown): string[] {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    return String(v).split(/[\n,]/).map(s => s.trim()).filter(Boolean);
}

function parseJson(v: unknown): Record<string, unknown> {
    if (!v) return {};
    if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    try { const p = JSON.parse(String(v)); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
}

function auditMeta(ctx: ElysiaCtx) {
    return {
        userId: ctx.user?.id || 0,
        username: ctx.user?.username || 'unknown',
        ipAddress: ctx.request ? getClientIpFromHeaders(ctx.request.headers) : undefined,
        userAgent: ctx.request?.headers?.get?.('user-agent') || undefined,
    };
}

async function softDeleteWithSnapshot(resourceType: string, resourceId: number, deletedBy: number) {
    // Get the row from the appropriate table
    let row: Record<string, unknown> | undefined;
    if (resourceType === 'token') {
        const [r] = await db.select().from(tokens).where(eq(tokens.id, resourceId));
        row = r;
        if (row) await db.update(tokens).set({ deletedAt: new Date() }).where(eq(tokens.id, resourceId));
    } else if (resourceType === 'organization') {
        const [r] = await db.select().from(organizations).where(eq(organizations.id, resourceId));
        row = r;
        if (row) await db.update(organizations).set({ deletedAt: new Date() }).where(eq(organizations.id, resourceId));
    } else if (resourceType === 'team') {
        const [r] = await db.select().from(teams).where(eq(teams.id, resourceId));
        row = r;
        if (row) await db.update(teams).set({ deletedAt: new Date() }).where(eq(teams.id, resourceId));
    } else if (resourceType === 'project') {
        const [r] = await db.select().from(projects).where(eq(projects.id, resourceId));
        row = r;
        if (row) await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, resourceId));
    }
    if (!row) return null;
    // Save snapshot for recovery
    const purgeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const [rec] = await db.insert(deletedRecords).values({
        resourceType,
        resourceId,
        snapshot: row,
        deletedBy,
        purgeAt,
    }).returning();
    return { record: rec, row };
}

// ─── Router ───────────────────────────────────────────────────

export const enterpriseTeamsRouter = new Elysia()

    // ========== TEAMS ==========

    .get('/enterprise/teams', async ({ query }: ElysiaCtx) => {
        const page = Math.max(1, toInt(query?.page, 1));
        const limit = Math.min(200, Math.max(1, toInt(query?.limit, 30)));
        const offset = (page - 1) * limit;
        const conditions = [isNull(teams.deletedAt)];

        if (query?.org_id) conditions.push(eq(teams.orgId, toInt(query.org_id)));
        if (query?.status) conditions.push(eq(teams.status, toInt(query.status)));
        if (query?.keyword) {
            const kw = `%${String(query.keyword).trim()}%`;
            const kwCond = or(ilike(teams.name, kw), ilike(teams.slug, kw));
            if (kwCond) conditions.push(kwCond);
        }

        const where = and(...conditions);
        const [{ total }] = await db.select({ total: count() }).from(teams).where(where);
        const rows = await db.select({
            id: teams.id, orgId: teams.orgId, name: teams.name, slug: teams.slug,
            description: teams.description, leaderId: teams.leaderId,
            budget: teams.budget, usedBudget: teams.usedBudget,
            allowedModels: teams.allowedModels, deniedModels: teams.deniedModels,
            status: teams.status, metadata: teams.metadata,
            createdAt: teams.createdAt, updatedAt: teams.updatedAt,
            orgName: organizations.name,
            leaderName: users.username,
        }).from(teams)
            .leftJoin(organizations, eq(teams.orgId, organizations.id))
            .leftJoin(users, eq(teams.leaderId, users.id))
            .where(where)
            .orderBy(desc(teams.id))
            .limit(limit).offset(offset);

        // Member counts
        const memberCounts = await db.select({ teamId: teamMembers.teamId, total: count() })
            .from(teamMembers).groupBy(teamMembers.teamId);
        const mcMap = new Map(memberCounts.map(r => [r.teamId, r.total]));

        return {
            success: true,
            data: rows.map(r => ({ ...r, memberCount: mcMap.get(r.id) || 0 })),
            total,
        };
    })

    .post('/enterprise/teams', async (ctx: ElysiaCtx) => {
        const b = ctx.body as Record<string, any>;
        const [created] = await db.insert(teams).values({
            orgId: toInt(b.orgId),
            name: String(b.name || 'New Team'),
            slug: b.slug || null,
            description: b.description || null,
            leaderId: b.leaderId ? toInt(b.leaderId) : null,
            budget: toInt(b.budget, 0),
            allowedModels: parseList(b.allowedModels),
            deniedModels: parseList(b.deniedModels),
            status: toInt(b.status, 1),
            metadata: parseJson(b.metadata),
        }).returning();
        await recordAuditLog({ ...auditMeta(ctx), action: 'team.create', resource: 'team', resourceId: String(created.id), details: { name: created.name, orgId: created.orgId } });
        return { success: true, data: created };
    })

    .put('/enterprise/teams/:id', async (ctx: ElysiaCtx) => {
        const id = toInt(ctx.params.id);
        const b = ctx.body as Record<string, any>;
        const patch: Record<string, any> = { updatedAt: new Date() };
        if ('name' in b) patch.name = b.name;
        if ('slug' in b) patch.slug = b.slug || null;
        if ('description' in b) patch.description = b.description;
        if ('leaderId' in b) patch.leaderId = b.leaderId ? toInt(b.leaderId) : null;
        if ('budget' in b) patch.budget = toInt(b.budget, 0);
        if ('allowedModels' in b) patch.allowedModels = parseList(b.allowedModels);
        if ('deniedModels' in b) patch.deniedModels = parseList(b.deniedModels);
        if ('status' in b) patch.status = toInt(b.status, 1);
        if ('metadata' in b) patch.metadata = parseJson(b.metadata);

        const [updated] = await db.update(teams).set(patch).where(and(eq(teams.id, id), isNull(teams.deletedAt))).returning();
        if (!updated) { ctx.set.status = 404; return { success: false, message: 'Team not found' }; }
        await recordAuditLog({ ...auditMeta(ctx), action: 'team.update', resource: 'team', resourceId: String(id), details: patch });
        return { success: true, data: updated };
    })

    .delete('/enterprise/teams/:id', async (ctx: ElysiaCtx) => {
        const id = toInt(ctx.params.id);
        const result = await softDeleteWithSnapshot('team', id, ctx.user?.id || 0);
        if (!result) { ctx.set.status = 404; return { success: false, message: 'Team not found' }; }
        await recordAuditLog({ ...auditMeta(ctx), action: 'team.delete', resource: 'team', resourceId: String(id), details: { name: (result.row as any).name } });
        return { success: true };
    })

    // ========== TEAM MEMBERS ==========

    .get('/enterprise/teams/:teamId/members', async (ctx: ElysiaCtx) => {
        const teamId = toInt(ctx.params.teamId);
        const rows = await db.select({
            id: teamMembers.id, teamId: teamMembers.teamId, userId: teamMembers.userId,
            role: teamMembers.role, joinedAt: teamMembers.joinedAt,
            username: users.username, email: users.email, name: users.name,
        }).from(teamMembers)
            .leftJoin(users, eq(teamMembers.userId, users.id))
            .where(eq(teamMembers.teamId, teamId))
            .orderBy(desc(teamMembers.joinedAt));
        return { success: true, data: rows, total: rows.length };
    })

    .post('/enterprise/teams/:teamId/members', async (ctx: ElysiaCtx) => {
        const teamId = toInt(ctx.params.teamId);
        const b = ctx.body as Record<string, any>;
        const userId = toInt(b.userId);
        const [created] = await db.insert(teamMembers).values({
            teamId,
            userId,
            role: String(b.role || 'member'),
        }).returning();
        await recordAuditLog({ ...auditMeta(ctx), action: 'team.member.add', resource: 'team', resourceId: String(teamId), details: { userId, role: created.role } });
        return { success: true, data: created };
    })

    .put('/enterprise/teams/:teamId/members/:memberId', async (ctx: ElysiaCtx) => {
        const memberId = toInt(ctx.params.memberId);
        const b = ctx.body as Record<string, any>;
        const [updated] = await db.update(teamMembers).set({ role: String(b.role || 'member') }).where(eq(teamMembers.id, memberId)).returning();
        if (!updated) { ctx.set.status = 404; return { success: false, message: 'Member not found' }; }
        return { success: true, data: updated };
    })

    .delete('/enterprise/teams/:teamId/members/:memberId', async (ctx: ElysiaCtx) => {
        const memberId = toInt(ctx.params.memberId);
        const [deleted] = await db.delete(teamMembers).where(eq(teamMembers.id, memberId)).returning();
        if (!deleted) { ctx.set.status = 404; return { success: false, message: 'Member not found' }; }
        await recordAuditLog({ ...auditMeta(ctx), action: 'team.member.remove', resource: 'team', resourceId: String(ctx.params.teamId), details: { memberId, userId: deleted.userId } });
        return { success: true };
    })

    // ========== PROJECTS ==========

    .get('/enterprise/projects', async ({ query }: ElysiaCtx) => {
        const page = Math.max(1, toInt(query?.page, 1));
        const limit = Math.min(200, Math.max(1, toInt(query?.limit, 30)));
        const offset = (page - 1) * limit;
        const conditions = [isNull(projects.deletedAt)];

        if (query?.org_id) conditions.push(eq(projects.orgId, toInt(query.org_id)));
        if (query?.team_id) conditions.push(eq(projects.teamId, toInt(query.team_id)));
        if (query?.status) conditions.push(eq(projects.status, toInt(query.status)));
        if (query?.keyword) {
            const kw = `%${String(query.keyword).trim()}%`;
            const kwCond = or(ilike(projects.name, kw), ilike(projects.slug, kw));
            if (kwCond) conditions.push(kwCond);
        }

        const where = and(...conditions);
        const [{ total }] = await db.select({ total: count() }).from(projects).where(where);
        const rows = await db.select({
            id: projects.id, orgId: projects.orgId, teamId: projects.teamId,
            name: projects.name, slug: projects.slug, description: projects.description,
            budget: projects.budget, usedBudget: projects.usedBudget,
            allowedModels: projects.allowedModels, deniedModels: projects.deniedModels,
            status: projects.status, metadata: projects.metadata,
            createdAt: projects.createdAt, updatedAt: projects.updatedAt,
            orgName: organizations.name,
            teamName: teams.name,
        }).from(projects)
            .leftJoin(organizations, eq(projects.orgId, organizations.id))
            .leftJoin(teams, eq(projects.teamId, teams.id))
            .where(where)
            .orderBy(desc(projects.id))
            .limit(limit).offset(offset);

        return { success: true, data: rows, total };
    })

    .post('/enterprise/projects', async (ctx: ElysiaCtx) => {
        const b = ctx.body as Record<string, any>;
        const [created] = await db.insert(projects).values({
            orgId: toInt(b.orgId),
            teamId: b.teamId ? toInt(b.teamId) : null,
            name: String(b.name || 'New Project'),
            slug: b.slug || null,
            description: b.description || null,
            budget: toInt(b.budget, 0),
            allowedModels: parseList(b.allowedModels),
            deniedModels: parseList(b.deniedModels),
            status: toInt(b.status, 1),
            metadata: parseJson(b.metadata),
        }).returning();
        await recordAuditLog({ ...auditMeta(ctx), action: 'project.create', resource: 'project', resourceId: String(created.id), details: { name: created.name, orgId: created.orgId } });
        return { success: true, data: created };
    })

    .put('/enterprise/projects/:id', async (ctx: ElysiaCtx) => {
        const id = toInt(ctx.params.id);
        const b = ctx.body as Record<string, any>;
        const patch: Record<string, any> = { updatedAt: new Date() };
        if ('name' in b) patch.name = b.name;
        if ('slug' in b) patch.slug = b.slug || null;
        if ('description' in b) patch.description = b.description;
        if ('teamId' in b) patch.teamId = b.teamId ? toInt(b.teamId) : null;
        if ('budget' in b) patch.budget = toInt(b.budget, 0);
        if ('allowedModels' in b) patch.allowedModels = parseList(b.allowedModels);
        if ('deniedModels' in b) patch.deniedModels = parseList(b.deniedModels);
        if ('status' in b) patch.status = toInt(b.status, 1);
        if ('metadata' in b) patch.metadata = parseJson(b.metadata);

        const [updated] = await db.update(projects).set(patch).where(and(eq(projects.id, id), isNull(projects.deletedAt))).returning();
        if (!updated) { ctx.set.status = 404; return { success: false, message: 'Project not found' }; }
        await recordAuditLog({ ...auditMeta(ctx), action: 'project.update', resource: 'project', resourceId: String(id), details: patch });
        return { success: true, data: updated };
    })

    .delete('/enterprise/projects/:id', async (ctx: ElysiaCtx) => {
        const id = toInt(ctx.params.id);
        const result = await softDeleteWithSnapshot('project', id, ctx.user?.id || 0);
        if (!result) { ctx.set.status = 404; return { success: false, message: 'Project not found' }; }
        await recordAuditLog({ ...auditMeta(ctx), action: 'project.delete', resource: 'project', resourceId: String(id), details: { name: (result.row as any).name } });
        return { success: true };
    })

    // ========== RECYCLE BIN ==========

    .get('/enterprise/recycle-bin', async ({ query }: ElysiaCtx) => {
        const page = Math.max(1, toInt(query?.page, 1));
        const limit = Math.min(200, Math.max(1, toInt(query?.limit, 30)));
        const offset = (page - 1) * limit;
        const conditions = [isNull(deletedRecords.restoredAt)];

        if (query?.resource_type) conditions.push(eq(deletedRecords.resourceType, String(query.resource_type)));

        const where = and(...conditions);
        const [{ total }] = await db.select({ total: count() }).from(deletedRecords).where(where);
        const rows = await db.select({
            id: deletedRecords.id, resourceType: deletedRecords.resourceType,
            resourceId: deletedRecords.resourceId, snapshot: deletedRecords.snapshot,
            deletedBy: deletedRecords.deletedBy, purgeAt: deletedRecords.purgeAt,
            createdAt: deletedRecords.createdAt,
            deleterName: users.username,
        }).from(deletedRecords)
            .leftJoin(users, eq(deletedRecords.deletedBy, users.id))
            .where(where)
            .orderBy(desc(deletedRecords.createdAt))
            .limit(limit).offset(offset);

        return { success: true, data: rows, total };
    })

    .post('/enterprise/recycle-bin/:id/restore', async (ctx: ElysiaCtx) => {
        const id = toInt(ctx.params.id);
        const [record] = await db.select().from(deletedRecords).where(and(eq(deletedRecords.id, id), isNull(deletedRecords.restoredAt)));
        if (!record) { ctx.set.status = 404; return { success: false, message: 'Record not found or already restored' }; }

        const snap = record.snapshot as Record<string, unknown>;
        const rt = record.resourceType;

        // Un-delete the source row
        if (rt === 'token') await db.update(tokens).set({ deletedAt: null }).where(eq(tokens.id, record.resourceId));
        else if (rt === 'organization') await db.update(organizations).set({ deletedAt: null }).where(eq(organizations.id, record.resourceId));
        else if (rt === 'team') await db.update(teams).set({ deletedAt: null }).where(eq(teams.id, record.resourceId));
        else if (rt === 'project') await db.update(projects).set({ deletedAt: null }).where(eq(projects.id, record.resourceId));

        // Mark as restored
        await db.update(deletedRecords).set({ restoredAt: new Date(), restoredBy: ctx.user?.id || null }).where(eq(deletedRecords.id, id));

        await recordAuditLog({
            ...auditMeta(ctx), action: `${rt}.restore` as any, resource: rt, resourceId: String(record.resourceId),
            details: { snapshot: snap },
        });

        return { success: true, message: `${rt} #${record.resourceId} restored` };
    })

    .delete('/enterprise/recycle-bin/:id', async (ctx: ElysiaCtx) => {
        const id = toInt(ctx.params.id);
        const [record] = await db.select().from(deletedRecords).where(eq(deletedRecords.id, id));
        if (!record) { ctx.set.status = 404; return { success: false, message: 'Record not found' }; }

        // Hard delete the source row if it still exists
        const rt = record.resourceType;
        if (rt === 'token') await db.delete(tokens).where(eq(tokens.id, record.resourceId));
        else if (rt === 'organization') await db.delete(organizations).where(eq(organizations.id, record.resourceId));
        else if (rt === 'team') await db.delete(teams).where(eq(teams.id, record.resourceId));
        else if (rt === 'project') await db.delete(projects).where(eq(projects.id, record.resourceId));

        // Remove recycle bin record
        await db.delete(deletedRecords).where(eq(deletedRecords.id, id));

        await recordAuditLog({
            ...auditMeta(ctx), action: `${rt}.purge` as any, resource: rt, resourceId: String(record.resourceId),
            details: { snapshot: record.snapshot },
        });

        return { success: true, message: `${rt} #${record.resourceId} permanently deleted` };
    })

    // ========== TRENDS (Usage over time) ==========

    .get('/enterprise/trends', async ({ query }: ElysiaCtx) => {
        const days = Math.min(90, Math.max(1, toInt(query?.days, 7)));
        const orgId = query?.org_id ? toInt(query.org_id) : undefined;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const conditions = [gte(logs.createdAt, since)];
        if (orgId) conditions.push(eq(logs.orgId, orgId));
        const where = and(...conditions);

        // Daily aggregation
        const daily = await db.select({
            date: drizzleSql<string>`date(${logs.createdAt})`.as('date'),
            requests: count(),
            promptTokens: sum(logs.promptTokens),
            completionTokens: sum(logs.completionTokens),
            cost: sum(logs.quotaCost),
            errors: drizzleSql<number>`count(*) FILTER (WHERE ${logs.statusCode} >= 400)`.as('errors'),
        }).from(logs)
            .where(where)
            .groupBy(drizzleSql`date(${logs.createdAt})`)
            .orderBy(drizzleSql`date(${logs.createdAt})`);

        // Model distribution for the period
        const models = await db.select({
            model: logs.modelName,
            requests: count(),
            cost: sum(logs.quotaCost),
        }).from(logs)
            .where(where)
            .groupBy(logs.modelName)
            .orderBy(desc(count()))
            .limit(15);

        // Top users for the period
        const topUsers = await db.select({
            userId: logs.userId,
            username: users.username,
            requests: count(),
            cost: sum(logs.quotaCost),
        }).from(logs)
            .leftJoin(users, eq(logs.userId, users.id))
            .where(where)
            .groupBy(logs.userId, users.username)
            .orderBy(desc(count()))
            .limit(10);

        return {
            success: true,
            data: {
                daily: daily.map(d => ({
                    ...d,
                    promptTokens: Number(d.promptTokens || 0),
                    completionTokens: Number(d.completionTokens || 0),
                    cost: Number(d.cost || 0),
                    errors: Number(d.errors || 0),
                })),
                models: models.map(m => ({ ...m, cost: Number(m.cost || 0) })),
                topUsers: topUsers.map(u => ({ ...u, cost: Number(u.cost || 0) })),
            },
        };
    });
