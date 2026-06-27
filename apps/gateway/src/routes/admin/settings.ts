import type { ElysiaCtx } from '../../types';
import { log } from '../../services/logger';
import { getErrorMessage } from '../../utils/error';
import { Elysia } from 'elysia';
import { db } from '@elygate/db';
import { options, packages, userSubscriptions, users } from '@elygate/db/schema';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { refreshAllCaches } from './index';
import { checkAndResetSubscriptionQuota } from '../../services/subscription';

export const settingsRouter = new Elysia()
    // --- System Options ---
    .get('/options', async () => {
        const rows = await db.select({ key: options.key, value: options.value }).from(options);
        const result: Record<string, string> = {};
        for (const r of rows) result[r.key] = r.value;
        return result;
    })

    .put('/options', async ({ body }: ElysiaCtx) => {
        const payload = body as Record<string, string>;

        for (const [key, value] of Object.entries(payload)) {
            await db.insert(options).values({ key, value })
                .onConflictDoUpdate({ target: options.key, set: { value } });
        }
        refreshAllCaches().catch((e: unknown) => log.error("[Async]", e));
        return { success: true };
    })

    // --- Schema Migrations ---
    .get('/migrate-cycles', async () => {
        try {
            await db.execute(drizzleSql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS cycle_quota BIGINT DEFAULT 0`);
            await db.execute(drizzleSql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS cycle_interval INTEGER DEFAULT 1`);
            await db.execute(drizzleSql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS cycle_unit TEXT DEFAULT 'day'`);
            await db.execute(drizzleSql`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ DEFAULT NOW()`);

            return { success: true, message: 'Schema updated for subscription cycles' };
        } catch (e: unknown) {
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .get('/test-cycle-reset', async ({ user }: ElysiaCtx) => {
        try {
            const [pkg] = await db.insert(packages).values({
                name: 'Test Cycle Pkg',
                description: 'Debug reset logic',
                price: '0',
                durationDays: 30,
                cycleQuota: 1000000,
                cycleInterval: 1,
                cycleUnit: 'hour',
                isPublic: false,
            }).returning({ id: packages.id });

            const [sub] = await db.insert(userSubscriptions).values({
                userId: user.id,
                packageId: pkg.id,
                startTime: new Date(Date.now() - 2 * 3600000),
                endTime: new Date(Date.now() + 30 * 86400000),
                status: 1,
                lastResetAt: new Date(Date.now() - 2 * 3600000),
            }).returning({ id: userSubscriptions.id });

            await checkAndResetSubscriptionQuota(user.id);

            const [updatedUser] = await db.select({ quota: users.quota }).from(users).where(eq(users.id, user.id));

            return { 
                success: true, 
                message: 'Test completed', 
                newQuota: updatedUser.quota,
                packageId: pkg.id,
                subId: sub.id
            };
        } catch (e: unknown) {
            return { success: false, message: getErrorMessage(e) };
        }
    });
