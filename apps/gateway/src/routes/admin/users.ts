import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { getErrorMessage } from '../../utils/error';
import { db, sql } from '@elygate/db';
import { users, tokens, logs } from '@elygate/db/schema';
import { eq, and, desc, inArray, count, sum, max, ilike, or, sql as drizzleSql } from 'drizzle-orm';
import { optionCache } from '../../services/optionCache';
import { getLangFromHeader } from '../../utils/i18n';


function maskTokenKey(t: Record<string, any>): Record<string, any> {
    if (!t.key) return t;
    const k = String(t.key);
    return {
        ...t,
        key: k.length > 12 ? k.substring(0, 8) + '...' + k.substring(k.length - 4) : '***'
    };
}

export const usersRouter = new Elysia()
    // --- Token Management ---
    .get('/tokens', async () => {
        const tokenRows = await db.select({
            id: tokens.id,
            name: tokens.name,
            key: tokens.key,
            status: tokens.status,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            createdAt: tokens.createdAt,
            updatedAt: tokens.updatedAt,
            models: tokens.models,
            subnet: tokens.subnet,
            allowIps: tokens.allowIps,
            rateLimit: tokens.rateLimit,
            expiredAt: tokens.expiredAt,
            unlimitedQuota: tokens.unlimitedQuota,
            modelLimitsEnabled: tokens.modelLimitsEnabled,
            tokenGroup: tokens.tokenGroup,
            crossGroupRetry: tokens.crossGroupRetry,
            accessedAt: tokens.accessedAt,
            userId: tokens.userId,
            creatorName: users.username,
        }).from(tokens)
            .leftJoin(users, eq(tokens.userId, users.id))
            .orderBy(desc(tokens.id));
        return tokenRows.map((t: Record<string, any>) => maskTokenKey(t));
    })

    .get('/tokens/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [token] = await db.select({
            id: tokens.id,
            name: tokens.name,
            key: tokens.key,
            status: tokens.status,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            createdAt: tokens.createdAt,
            updatedAt: tokens.updatedAt,
            models: tokens.models,
            subnet: tokens.subnet,
            allowIps: tokens.allowIps,
            rateLimit: tokens.rateLimit,
            expiredAt: tokens.expiredAt,
            unlimitedQuota: tokens.unlimitedQuota,
            modelLimitsEnabled: tokens.modelLimitsEnabled,
            tokenGroup: tokens.tokenGroup,
            crossGroupRetry: tokens.crossGroupRetry,
            accessedAt: tokens.accessedAt,
            userId: tokens.userId,
            creatorName: users.username,
        }).from(tokens)
            .leftJoin(users, eq(tokens.userId, users.id))
            .where(eq(tokens.id, Number(id)))
            .limit(1);
        if (!token) {
            set.status = 404;
            return { success: false, message: 'Token not found' };
        }
        return token;
    })

    .post('/tokens', async ({ body, user, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            const [result] = await db.insert(tokens).values({
                userId: b.userId || user.id,
                name: b.name,
                key: newKey,
                status: b.status || 1,
                remainQuota: b.remainQuota ?? -1,
                models: Array.isArray(b.models) ? b.models : b.models || [],
                subnet: b.subnet || b.allowIps || null,
                allowIps: b.allowIps || b.subnet || null,
                rateLimit: b.rateLimit || 0,
                expiredAt: b.expiredAt || null,
                unlimitedQuota: Boolean(b.unlimitedQuota),
                modelLimitsEnabled: Boolean(b.modelLimitsEnabled),
                tokenGroup: b.tokenGroup || null,
                crossGroupRetry: Boolean(b.crossGroupRetry),
            }).returning();
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .put('/tokens/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [oldToken] = await db.select().from(tokens).where(eq(tokens.id, Number(id))).limit(1);
            if (!oldToken) {
                set.status = 404;
                return { success: false, message: 'Token not found' };
            }

            let finalModels = oldToken.models;
            if (b.models !== undefined) {
                finalModels = Array.isArray(b.models) ? b.models : b.models;
            }

            const [result] = await db.update(tokens).set({
                name: b.name ?? oldToken.name,
                status: b.status ?? oldToken.status,
                remainQuota: b.remainQuota ?? oldToken.remainQuota,
                models: finalModels,
                subnet: b.subnet ?? oldToken.subnet,
                allowIps: b.allowIps ?? oldToken.allowIps,
                rateLimit: b.rateLimit ?? oldToken.rateLimit,
                expiredAt: b.expiredAt ?? oldToken.expiredAt,
                unlimitedQuota: b.unlimitedQuota ?? oldToken.unlimitedQuota,
                modelLimitsEnabled: b.modelLimitsEnabled ?? oldToken.modelLimitsEnabled,
                tokenGroup: b.tokenGroup ?? oldToken.tokenGroup,
                crossGroupRetry: b.crossGroupRetry ?? oldToken.crossGroupRetry,
                updatedAt: new Date(),
            }).where(eq(tokens.id, Number(id))).returning();
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .post('/tokens/:id/regenerate', async ({ params: { id }, set }: ElysiaCtx) => {
        try {
            const [oldToken] = await db.select().from(tokens).where(eq(tokens.id, Number(id))).limit(1);
            if (!oldToken) {
                set.status = 404;
                return { success: false, message: 'Token not found' };
            }

            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            const [result] = await db.update(tokens).set({
                key: newKey,
                updatedAt: new Date(),
            }).where(eq(tokens.id, Number(id))).returning();

            return { success: true, message: 'Token key regenerated successfully', token: result };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .delete('/tokens/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        try {
            await db.delete(tokens).where(eq(tokens.id, Number(id)));
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- User Management ---
    .get('/users', async () => {
        return await db.select({
            id: users.id,
            username: users.username,
            role: users.role,
            quota: users.quota,
            usedQuota: users.usedQuota,
            status: users.status,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
        }).from(users).orderBy(desc(users.id));
    })

    .get('/users/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [user] = await db.select({
            id: users.id,
            username: users.username,
            role: users.role,
            quota: users.quota,
            usedQuota: users.usedQuota,
            status: users.status,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
        }).from(users).where(eq(users.id, Number(id))).limit(1);
        if (!user) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }
        return user;
    })

    .post('/users', async ({ body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const passwordHash = await Bun.password.hash(b.password);
            const defaultCurrency = optionCache.get('CurrencyName', 'USD');
            const [result] = await db.insert(users).values({
                username: b.username,
                passwordHash,
                role: b.role || 1,
                quota: b.quota || 0,
                status: 1,
                currency: defaultCurrency,
            }).returning({
                id: users.id,
                username: users.username,
                role: users.role,
                quota: users.quota,
                status: users.status,
                currency: users.currency,
            });
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .put('/users/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const updateData: Record<string, any> = {
                username: b.username ?? undefined,
                role: b.role ?? undefined,
                quota: b.quota ?? undefined,
                currency: b.currency ?? undefined,
                status: b.status ?? undefined,
                updatedAt: new Date(),
            };
            // Remove undefined keys (COALESCE semantics: only update if provided)
            for (const key of Object.keys(updateData)) {
                if (updateData[key] === undefined) delete updateData[key];
            }
            if (b.password) {
                updateData.passwordHash = await Bun.password.hash(b.password);
            }

            const [result] = await db.update(users).set(updateData)
                .where(eq(users.id, Number(id)))
                .returning({
                    id: users.id,
                    username: users.username,
                    role: users.role,
                    quota: users.quota,
                    currency: users.currency,
                    status: users.status,
                });

            // Notify auth cache to flush tokens for this user
            const tokenRows = await db.select({ key: tokens.key }).from(tokens).where(eq(tokens.userId, Number(id)));
            for (const t of tokenRows) {
                await sql`SELECT pg_notify('auth_update', ${t.key})`;
            }

            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .delete('/users/:id', async ({ params: { id }, user, set, request }: ElysiaCtx) => {
        const lang = getLangFromHeader(request.headers.get('accept-language'));

        if (Number(id) === user.id) {
            set.status = 400;
            return { success: false, message: lang === 'zh' ? '不能删除自己的账户' : 'Cannot delete your own account' };
        }

        const [adminCount] = await db.select({ count: count() }).from(users).where(and(drizzleSql`${users.role} >= 10`, eq(users.status, 1)));
        const [targetUser] = await db.select({ role: users.role }).from(users).where(eq(users.id, Number(id)));

        if (targetUser && targetUser.role >= 10 && Number(adminCount.count) <= 1) {
            set.status = 400;
            return { success: false, message: lang === 'zh' ? '不能删除最后一个管理员账户' : 'Cannot delete the last admin account' };
        }

        await db.delete(users).where(eq(users.id, Number(id)));
        return { success: true, message: lang === 'zh' ? '删除成功' : 'Deleted successfully' };
    })
    // --- Token Search ---
    .get('/tokens/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        const userId = query?.user_id;
        const status = query?.status;
        if (!keyword && !userId && status === undefined) {
            return { success: false, message: 'Provide keyword, user_id, or status' };
        }
        const conditions = [];
        if (keyword) conditions.push(ilike(tokens.name, '%' + keyword + '%'));
        if (userId) conditions.push(eq(tokens.userId, Number(userId) || 0));
        if (status !== undefined) conditions.push(eq(tokens.status, Number(status) || 0));

        const rows = await db.select({
            id: tokens.id,
            name: tokens.name,
            key: tokens.key,
            status: tokens.status,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            createdAt: tokens.createdAt,
            models: tokens.models,
            subnet: tokens.subnet,
            allowIps: tokens.allowIps,
            rateLimit: tokens.rateLimit,
            expiredAt: tokens.expiredAt,
            unlimitedQuota: tokens.unlimitedQuota,
            modelLimitsEnabled: tokens.modelLimitsEnabled,
            tokenGroup: tokens.tokenGroup,
            crossGroupRetry: tokens.crossGroupRetry,
            accessedAt: tokens.accessedAt,
            userId: tokens.userId,
            creatorName: users.username,
        }).from(tokens)
            .leftJoin(users, eq(tokens.userId, users.id))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(tokens.id))
            .limit(100);
        return rows.map(maskTokenKey);
    })

    // --- Token Batch Delete ---
    .post('/tokens/batch/delete', async ({ body, set }: ElysiaCtx) => {
        const ids: number[] = (body as any).ids || [];
        if (ids.length === 0) return { success: false, message: 'No IDs provided' };
        if (ids.length > 100) return { success: false, message: 'Max 100 tokens at once' };
        const result = await db.delete(tokens).where(inArray(tokens.id, ids)).returning({ id: tokens.id });
        return { success: true, deleted: result.length || ids.length };
    }, { body: t.Object({ ids: t.Array(t.Number()) }) })

    // --- Token Batch Get Keys ---
    .post('/tokens/batch/keys', async ({ body, user, set }: ElysiaCtx) => {
        const ids: number[] = (body as any).ids || [];
        if (ids.length === 0) return { success: false, message: 'No IDs provided' };
        if (ids.length > 100) return { success: false, message: 'Max 100 tokens at once' };
        const rows = await db.select({ id: tokens.id, key: tokens.key }).from(tokens).where(inArray(tokens.id, ids));
        const keysMap: Record<number, string> = {};
        for (const r of rows) keysMap[r.id] = r.key;
        return { success: true, keys: keysMap };
    }, { body: t.Object({ ids: t.Array(t.Number()) }) })

    // --- Single Token Usage ---
    .get('/tokens/:id/usage', async ({ params: { id }, set }: ElysiaCtx) => {
        const [token] = await db.select({
            id: tokens.id,
            name: tokens.name,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            unlimitedQuota: tokens.unlimitedQuota,
        }).from(tokens).where(eq(tokens.id, Number(id))).limit(1);
        if (!token) { set.status = 404; return { success: false, message: 'Token not found' }; }
        
        const [stats] = await db.select({
            totalRequests: count(),
            totalCost: sum(logs.quotaCost),
            totalPromptTokens: sum(logs.promptTokens),
            totalCompletionTokens: sum(logs.completionTokens),
            lastUsed: max(logs.createdAt),
        }).from(logs).where(eq(logs.tokenId, Number(id)));
        return { token, stats };
    })

    // --- Regenerate Token Key ---
    .post('/tokens/:id/regenerate', async ({ params: { id }, set }: ElysiaCtx) => {
        const [oldToken] = await db.select().from(tokens).where(eq(tokens.id, Number(id))).limit(1);
        if (!oldToken) { set.status = 404; return { success: false, message: 'Token not found' }; }
        const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
        const [result] = await db.update(tokens).set({ key: newKey, updatedAt: new Date() }).where(eq(tokens.id, Number(id))).returning();
        return { success: true, token: maskTokenKey(result) };
    });
