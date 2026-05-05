import type { ElysiaCtx } from '../../types';
import { Elysia, t } from 'elysia';
import { db } from '@elygate/db';
import { users, tokens, logs, redemptions, userCheckins, userAff, userAffRewards } from '@elygate/db/schema';
import { eq, and, desc, count, sum, sql as drizzleSql } from 'drizzle-orm';
import { authPlugin } from '../../middleware/auth';
import { optionCache } from '../../services/optionCache';
import { calculateCost } from '../../services/ratio';

/**
 * User self-service APIs (under /api/admin with authPlugin).
 * These are admin-accessible endpoints for managing user-facing features.
 */
export const userSelfServiceRouter = new Elysia()
    // --- User Self: Get own info ---
    .get('/self/info', async ({ user }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const [row] = await db.select({
            id: users.id,
            username: users.username,
            role: users.role,
            quota: users.quota,
            usedQuota: users.usedQuota,
            group: users.group,
            status: users.status,
            currency: users.currency,
            createdAt: users.createdAt,
        }).from(users).where(eq(users.id, user.id));
        return { success: true, data: row };
    })

    // --- User Self: Get own tokens ---
    .get('/self/tokens', async ({ user }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const rows = await db.select({
            id: tokens.id,
            name: tokens.name,
            key: tokens.key,
            status: tokens.status,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            models: tokens.models,
            rateLimit: tokens.rateLimit,
            unlimitedQuota: tokens.unlimitedQuota,
            modelLimitsEnabled: tokens.modelLimitsEnabled,
            expiredAt: tokens.expiredAt,
            createdAt: tokens.createdAt,
            accessedAt: tokens.accessedAt,
        }).from(tokens).where(eq(tokens.userId, user.id)).orderBy(desc(tokens.id));
        // Mask keys
        return {
            success: true,
            data: rows.map((r: Record<string, any>) => ({
                ...r,
                key: r.key ? r.key.substring(0, 8) + '...' + r.key.substring(r.key.length - 4) : ''
            }))
        };
    })

    // --- User Self: Create token ---
    .post('/self/tokens', async ({ user, body, set }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const b = body as Record<string, any>;
        const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
        try {
            const [result] = await db.insert(tokens).values({
                userId: user.id,
                name: b.name || 'My Token',
                key: newKey,
                remainQuota: b.remainQuota ?? -1,
                models: b.models || [],
                subnet: b.subnet || null,
                rateLimit: b.rateLimit || 0,
                unlimitedQuota: Boolean(b.unlimitedQuota),
                modelLimitsEnabled: Boolean(b.modelLimitsEnabled),
            }).returning({
                id: tokens.id,
                name: tokens.name,
                key: tokens.key,
                status: tokens.status,
                remainQuota: tokens.remainQuota,
                createdAt: tokens.createdAt,
            });
            return { success: true, data: result };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: String(e) };
        }
    }, { body: t.Object({ name: t.Optional(t.String()), remainQuota: t.Optional(t.Number()), models: t.Optional(t.Array(t.String())), rateLimit: t.Optional(t.Number()), unlimitedQuota: t.Optional(t.Boolean()), modelLimitsEnabled: t.Optional(t.Boolean()) }) })

    // --- User Self: Delete own token ---
    .delete('/self/tokens/:id', async ({ user, params: { id }, set }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const result = await db.delete(tokens).where(and(eq(tokens.id, Number(id)), eq(tokens.userId, user.id))).returning({ id: tokens.id });
        if (result.length === 0) { set.status = 404; return { success: false, message: 'Token not found' }; }
        return { success: true };
    })

    // --- User Self: Get own usage stats ---
    .get('/self/usage', async ({ user, query }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const days = Number(query?.days) || 30;
        const cutoff = drizzleSql`NOW() - (${drizzleSql.raw(String(days))} * INTERVAL '1 day')`;
        const [stats] = await db.select({
            totalRequests: count(),
            successCount: count(drizzleSql`CASE WHEN ${logs.statusCode} < 400 THEN 1 END`),
            totalCost: sum(logs.quotaCost).mapWith(Number),
            totalTokens: sum(drizzleSql`${logs.promptTokens} + ${logs.completionTokens}`).mapWith(Number),
            uniqueModels: count(drizzleSql`DISTINCT ${logs.modelName}`),
        }).from(logs).where(and(eq(logs.userId, user.id), drizzleSql`created_at > ${cutoff}`));
        // Daily breakdown
        const daily = await db.select({
            date: drizzleSql`DATE(${logs.createdAt})`.as('date'),
            requests: count(),
            cost: sum(logs.quotaCost).mapWith(Number),
        }).from(logs).where(and(eq(logs.userId, user.id), drizzleSql`created_at > ${cutoff}`))
          .groupBy(drizzleSql`DATE(${logs.createdAt})`)
          .orderBy(drizzleSql`DATE(${logs.createdAt})`);
        return { success: true, data: { stats, daily } };
    })

    // --- User Self: Get own logs ---
    .get('/self/logs', async ({ user, query }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;
        const [countRow] = await db.select({ total: count() }).from(logs).where(eq(logs.userId, user.id));
        const data = await db.select({
            id: logs.id,
            modelName: logs.modelName,
            promptTokens: logs.promptTokens,
            completionTokens: logs.completionTokens,
            quotaCost: logs.quotaCost,
            statusCode: logs.statusCode,
            isStream: logs.isStream,
            createdAt: logs.createdAt,
            elapsedMs: logs.elapsedMs,
            errorMessage: logs.errorMessage,
        }).from(logs).where(eq(logs.userId, user.id))
          .orderBy(desc(logs.createdAt))
          .limit(limit)
          .offset(offset);
        return { data, total: countRow.total, page, limit };
    })

    // --- Checkin ---
    .post('/self/checkin', async ({ user, set }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const checkinEnabled = String(optionCache.get('CheckinEnabled', 'false')) === 'true';
        if (!checkinEnabled) { set.status = 403; return { success: false, message: 'Checkin is disabled' }; }

        const reward = Number(optionCache.get('CheckinReward', 100000));
        const today = new Date().toISOString().split('T')[0];

        // Check if already checked in today
        const [existing] = await db.select({ id: userCheckins.id }).from(userCheckins)
            .where(and(eq(userCheckins.userId, user.id), eq(userCheckins.checkinDate, today)));
        if (existing) { set.status = 409; return { success: false, message: 'Already checked in today' }; }

        await db.insert(userCheckins).values({ userId: user.id, checkinDate: today, reward });
        await db.update(users).set({ quota: drizzleSql`${users.quota} + ${reward}` }).where(eq(users.id, user.id));

        return { success: true, reward, message: `Checked in! +${reward} quota` };
    })

    // --- Checkin status ---
    .get('/self/checkin', async ({ user }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const today = new Date().toISOString().split('T')[0];
        const [row] = await db.select({
            id: userCheckins.id,
            checkinDate: userCheckins.checkinDate,
            reward: userCheckins.reward,
        }).from(userCheckins)
            .where(and(eq(userCheckins.userId, user.id), eq(userCheckins.checkinDate, today)));
        const checkinEnabled = String(optionCache.get('CheckinEnabled', 'false')) === 'true';
        const reward = Number(optionCache.get('CheckinReward', 100000));
        return {
            success: true,
            data: {
                enabled: checkinEnabled,
                checkedIn: !!row,
                reward,
                lastCheckin: row?.checkinDate || null,
            }
        };
    })

    // --- Aff/Invite ---
    .get('/self/aff', async ({ user }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        let [aff] = await db.select({ code: userAff.code, reward: userAff.reward }).from(userAff).where(eq(userAff.userId, user.id));
        if (!aff) {
            const code = Bun.randomUUIDv7('hex').substring(0, 12);
            await db.insert(userAff).values({ userId: user.id, code });
            aff = { code, reward: 0 };
        }
        // Count invites
        const [stats] = await db.select({
            inviteCount: count().as('invite_count'),
            totalReward: drizzleSql`COALESCE(${sum(userAffRewards.reward)}, 0)`.mapWith(Number),
        }).from(userAffRewards).where(eq(userAffRewards.referrerId, user.id));
        return { success: true, data: { code: aff.code, inviteCount: stats?.inviteCount || 0, totalReward: stats?.totalReward || 0 } };
    })

    // --- Topup (redemption code) ---
    .post('/self/topup', async ({ user, body, set }: ElysiaCtx) => {
        if (!user) return { success: false, message: 'Not authenticated' };
        const { key } = body as { key: string };
        if (!key) { set.status = 400; return { success: false, message: 'Key is required' }; }

        const [redemption] = await db.select().from(redemptions)
            .where(and(eq(redemptions.key, key), eq(redemptions.status, 1), drizzleSql`${redemptions.usedCount} < ${redemptions.count}`));
        if (!redemption) { set.status = 404; return { success: false, message: 'Invalid or exhausted redemption code' }; }

        await db.update(redemptions).set({ usedCount: drizzleSql`${redemptions.usedCount} + 1` }).where(eq(redemptions.id, redemption.id));
        await db.update(users).set({ quota: drizzleSql`${users.quota} + ${redemption.quota}` }).where(eq(users.id, user.id));

        return { success: true, quota: redemption.quota, message: `Redeemed ${redemption.quota} quota` };
    }, { body: t.Object({ key: t.String() }) });
