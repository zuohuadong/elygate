import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { getErrorMessage } from '../../utils/error';
import { db, sql } from '@elygate/db';
import { packages, rateLimitRules, redemptions, inviteCodes, userSubscriptions, users } from '@elygate/db/schema';
import { eq, and, desc, inArray, count, gt } from 'drizzle-orm';
import { refreshAllCaches } from './index';
import { checkAndResetSubscriptionQuota } from '../../services/subscription';

export const packagesRouter = new Elysia()
    // --- Redemptions (CDK) ---
    .get('/redemptions', async () => {
        return await db.select().from(redemptions).orderBy(desc(redemptions.id));
    })

    .post('/redemptions', async ({ body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const key = b.key || `cdk-${Bun.randomUUIDv7('hex')}`;
            const [result] = await db.insert(redemptions).values({
                name: b.name,
                key,
                quota: b.quota,
                count: b.count || 1,
                status: 1,
            }).returning();
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    }, {
        body: t.Object({
            name: t.String(),
            quota: t.Number(),
            key: t.Optional(t.String()),
            count: t.Optional(t.Number()),
            status: t.Optional(t.Number())
        })
    })

    .put('/redemptions/:id', async ({ params: { id }, body }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const [result] = await db.update(redemptions).set({
            ...(b.name !== undefined && { name: b.name }),
            ...(b.key !== undefined && { key: b.key }),
            ...(b.quota !== undefined && { quota: b.quota }),
            ...(b.count !== undefined && { count: b.count }),
            ...(b.status !== undefined && { status: b.status }),
        }).where(eq(redemptions.id, Number(id))).returning();
        return result;
    })

    .delete('/redemptions/:id', async ({ params: { id } }) => {
        await db.delete(redemptions).where(eq(redemptions.id, Number(id)));
        return { success: true };
    })

    // --- Invite Codes ---
    .get('/invite-codes', async ({ query }: ElysiaCtx) => {
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;
        const status = query?.status;

        const conditions = [];
        if (status !== undefined && status !== '') {
            conditions.push(eq(inviteCodes.status, Number(status)));
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const [countRow] = await db.select({ total: count() }).from(inviteCodes).where(where);
        const data = await db.select({
            id: inviteCodes.id,
            code: inviteCodes.code,
            maxUses: inviteCodes.maxUses,
            usedCount: inviteCodes.usedCount,
            giftQuota: inviteCodes.giftQuota,
            status: inviteCodes.status,
            expiresAt: inviteCodes.expiresAt,
            createdBy: inviteCodes.createdBy,
            creatorName: users.username,
            createdAt: inviteCodes.createdAt,
            updatedAt: inviteCodes.updatedAt,
        }).from(inviteCodes)
            .leftJoin(users, eq(inviteCodes.createdBy, users.id))
            .where(where)
            .orderBy(desc(inviteCodes.id))
            .limit(limit)
            .offset(offset);

        return {
            data: data.map((c: Record<string, any>) => ({
                id: c.id,
                code: c.code,
                maxUses: c.maxUses,
                usedCount: c.usedCount,
                giftQuota: c.giftQuota,
                status: c.status,
                expiresAt: c.expiresAt,
                createdBy: c.createdBy,
                creatorName: c.creatorName,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt
            })),
            total: countRow.total,
            page,
            limit
        };
    })

    .post('/invite-codes', async ({ body, user, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const count = b.count || 1;
            const results: Record<string, any>[] = [];

            for (let i = 0; i < count; i++) {
                const code = b.codePrefix ? `${b.codePrefix}-${Bun.randomUUIDv7('hex').substring(0, 8)}` : `inv-${Bun.randomUUIDv7('hex').substring(0, 12)}`;
                const [result] = await db.insert(inviteCodes).values({
                    code,
                    maxUses: b.maxUses || 1,
                    giftQuota: b.giftQuota || 0,
                    status: 1,
                    expiresAt: b.expiresAt || null,
                    createdBy: user.id,
                }).returning();
                results.push({
                    id: result.id,
                    code: result.code,
                    maxUses: result.maxUses,
                    usedCount: result.usedCount,
                    giftQuota: result.giftQuota,
                    status: result.status,
                    expiresAt: result.expiresAt,
                    createdAt: result.createdAt
                });
            }

            return { success: true, codes: results, count: results.length };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    }, {
        body: t.Object({
            count: t.Optional(t.Number()),
            maxUses: t.Optional(t.Number()),
            giftQuota: t.Optional(t.Number()),
            expiresAt: t.Optional(t.String()),
            codePrefix: t.Optional(t.String())
        })
    })

    .put('/invite-codes/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [oldCode] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, Number(id))).limit(1);
            if (!oldCode) {
                set.status = 404;
                return { success: false, message: 'Invite code not found' };
            }

            const [result] = await db.update(inviteCodes).set({
                ...(b.maxUses !== undefined && { maxUses: b.maxUses }),
                ...(b.giftQuota !== undefined && { giftQuota: b.giftQuota }),
                ...(b.status !== undefined && { status: b.status }),
                expiresAt: b.expiresAt !== undefined ? b.expiresAt : oldCode.expiresAt,
                updatedAt: new Date(),
            }).where(eq(inviteCodes.id, Number(id))).returning();
            return {
                success: true,
                code: {
                    id: result.id,
                    code: result.code,
                    maxUses: result.maxUses,
                    usedCount: result.usedCount,
                    giftQuota: result.giftQuota,
                    status: result.status,
                    expiresAt: result.expiresAt,
                    updatedAt: result.updatedAt
                }
            };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .delete('/invite-codes/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        try {
            await db.delete(inviteCodes).where(eq(inviteCodes.id, Number(id)));
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .delete('/invite-codes/batch', async ({ body, set }: ElysiaCtx) => {
        try {
            const ids = (body as Record<string, any>).ids as number[];
            if (!ids || ids.length === 0) {
                set.status = 400;
                return { success: false, message: 'No IDs provided' };
            }
            await db.delete(inviteCodes).where(inArray(inviteCodes.id, ids));
            return { success: true, deleted: ids.length };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- Rate Limits ---
    .get('/rate-limits', async () => {
        return await db.select().from(rateLimitRules).orderBy(desc(rateLimitRules.id));
    })
    .post('/rate-limits', async ({ body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await db.insert(rateLimitRules).values({
                name: b.name,
                rpm: b.rpm || 0,
                rph: b.rph || 0,
                concurrent: b.concurrent || 0,
            }).returning();
            await refreshAllCaches();
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })
    .put('/rate-limits/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await db.update(rateLimitRules).set({
                ...(b.name !== undefined && { name: b.name }),
                ...(b.rpm !== undefined && { rpm: b.rpm }),
                ...(b.rph !== undefined && { rph: b.rph }),
                ...(b.concurrent !== undefined && { concurrent: b.concurrent }),
            }).where(eq(rateLimitRules.id, Number(id))).returning();
            await refreshAllCaches();
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })
    .delete('/rate-limits/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        try {
            await db.delete(rateLimitRules).where(eq(rateLimitRules.id, Number(id)));
            await refreshAllCaches();
            return { success: true };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- Packages ---
    .get('/packages', async () => {
        return await db.select({
            id: packages.id,
            name: packages.name,
            description: packages.description,
            price: packages.price,
            durationDays: packages.durationDays,
            models: packages.models,
            defaultRateLimitId: packages.defaultRateLimitId,
            modelRateLimits: packages.modelRateLimits,
            cycleQuota: packages.cycleQuota,
            cycleInterval: packages.cycleInterval,
            cycleUnit: packages.cycleUnit,
            cachePolicy: packages.cachePolicy,
            isPublic: packages.isPublic,
            allowedGroups: packages.allowedGroups,
            addedBy: packages.addedBy,
            updatedAt: packages.updatedAt,
            createdAt: packages.createdAt,
            defaultRateLimitName: rateLimitRules.name,
        }).from(packages)
            .leftJoin(rateLimitRules, eq(packages.defaultRateLimitId, rateLimitRules.id))
            .orderBy(desc(packages.id));
    })
    .post('/packages', async ({ body, user, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await db.insert(packages).values({
                name: b.name,
                description: b.description || '',
                price: b.price || 0,
                durationDays: b.durationDays || 30,
                models: b.models || [],
                defaultRateLimitId: b.defaultRateLimitId || null,
                modelRateLimits: b.modelRateLimits || {},
                cycleQuota: b.cycleQuota || 0,
                cycleInterval: b.cycleInterval || 1,
                cycleUnit: b.cycleUnit || 'day',
                cachePolicy: b.cachePolicy || null,
                isPublic: b.isPublic ?? true,
                addedBy: user.id,
            }).returning();
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })
    .put('/packages/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [result] = await db.update(packages).set({
                ...(b.name !== undefined && { name: b.name }),
                ...(b.description !== undefined && { description: b.description }),
                ...(b.price !== undefined && { price: b.price }),
                ...(b.durationDays !== undefined && { durationDays: b.durationDays }),
                ...(b.models !== undefined && { models: b.models || null }),
                ...(b.defaultRateLimitId !== undefined && { defaultRateLimitId: b.defaultRateLimitId }),
                ...(b.modelRateLimits !== undefined && { modelRateLimits: b.modelRateLimits || null }),
                ...(b.cycleQuota !== undefined && { cycleQuota: b.cycleQuota }),
                ...(b.cycleInterval !== undefined && { cycleInterval: b.cycleInterval }),
                ...(b.cycleUnit !== undefined && { cycleUnit: b.cycleUnit }),
                ...(b.cachePolicy !== undefined && { cachePolicy: b.cachePolicy || null }),
                ...(b.isPublic !== undefined && { isPublic: b.isPublic }),
                updatedAt: new Date(),
            }).where(eq(packages.id, Number(id))).returning();
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })
    .delete('/packages/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        try {
            await db.delete(packages).where(eq(packages.id, Number(id)));
            return { success: true };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- Subscription Management ---
    .get('/subscriptions', async () => {
        return await db.select({
            id: userSubscriptions.id,
            userId: userSubscriptions.userId,
            packageId: userSubscriptions.packageId,
            startTime: userSubscriptions.startTime,
            endTime: userSubscriptions.endTime,
            status: userSubscriptions.status,
            quotaGranted: userSubscriptions.quotaGranted,
            quotaUsed: userSubscriptions.quotaUsed,
            lastResetAt: userSubscriptions.lastResetAt,
            createdAt: userSubscriptions.createdAt,
            updatedAt: userSubscriptions.updatedAt,
            username: users.username,
            packageName: packages.name,
        }).from(userSubscriptions)
            .innerJoin(users, eq(userSubscriptions.userId, users.id))
            .innerJoin(packages, eq(userSubscriptions.packageId, packages.id))
            .orderBy(desc(userSubscriptions.id))
            .limit(100);
    })
    .get('/users/:id/subscriptions', async ({ params: { id } }: ElysiaCtx) => {
        return await db.select({
            id: userSubscriptions.id,
            userId: userSubscriptions.userId,
            packageId: userSubscriptions.packageId,
            startTime: userSubscriptions.startTime,
            endTime: userSubscriptions.endTime,
            status: userSubscriptions.status,
            quotaGranted: userSubscriptions.quotaGranted,
            quotaUsed: userSubscriptions.quotaUsed,
            lastResetAt: userSubscriptions.lastResetAt,
            createdAt: userSubscriptions.createdAt,
            updatedAt: userSubscriptions.updatedAt,
            packageName: packages.name,
            models: packages.models,
            durationDays: packages.durationDays,
        }).from(userSubscriptions)
            .innerJoin(packages, eq(userSubscriptions.packageId, packages.id))
            .where(eq(userSubscriptions.userId, Number(id)))
            .orderBy(desc(userSubscriptions.id));
    })
    .post('/users/:id/subscriptions', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [pkg] = await db.select({ durationDays: packages.durationDays }).from(packages).where(eq(packages.id, b.packageId));
            if (!pkg) {
                set.status = 404; return { success: false, message: 'Package not found' };
            }

            const durationMs = Number(pkg.durationDays) * 24 * 60 * 60 * 1000;

            const [existingSub] = await db.select({
                id: userSubscriptions.id,
                endTime: userSubscriptions.endTime,
            }).from(userSubscriptions)
                .where(and(
                    eq(userSubscriptions.userId, Number(id)),
                    eq(userSubscriptions.packageId, b.packageId),
                    eq(userSubscriptions.status, 1),
                    gt(userSubscriptions.endTime, new Date()),
                ))
                .orderBy(desc(userSubscriptions.endTime))
                .limit(1);

            let result;
            if (existingSub) {
                const newEndTime = new Date(existingSub.endTime!.getTime() + durationMs);
                const [updated] = await db.update(userSubscriptions).set({
                    endTime: newEndTime,
                    updatedAt: new Date(),
                }).where(eq(userSubscriptions.id, existingSub.id)).returning();
                result = updated;
            } else {
                const newEndTime = new Date(Date.now() + durationMs);
                const [inserted] = await db.insert(userSubscriptions).values({
                    userId: Number(id),
                    packageId: b.packageId,
                    startTime: new Date(),
                    endTime: newEndTime,
                    status: 1,
                }).returning();
                result = inserted;
            }

            await sql`NOTIFY auth_update, ${String(id)}`;

            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    })
    .put('/subscriptions/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const [result] = await db.update(userSubscriptions).set({
                ...(body.status !== undefined && { status: body.status }),
                updatedAt: new Date(),
            }).where(eq(userSubscriptions.id, Number(id))).returning();
            if (result) {
                await sql`NOTIFY auth_update, ${String(result.userId)}`;
            }
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500; return { success: false, message: getErrorMessage(e) };
        }
    });
