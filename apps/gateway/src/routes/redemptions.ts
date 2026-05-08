import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { db } from '@elygate/db';
import { redemptions, users } from '@elygate/db/schema';
import { and, eq, sql as drizzleSql } from 'drizzle-orm';

/**
 * Redemptions Router
 * Allows registered users to redeem CDKs for quota.
 */
export const redemptionsRouter = new Elysia()
    .post('/redeem', async ({ body, user }: ElysiaCtx) => {
        const key = body?.key?.trim();

        if (!key) {
            throw new Error("Missing 'key' in request body");
        }

        const result = await db.transaction(async (tx) => {
            const [claimed] = await tx.update(redemptions)
                .set({
                    usedCount: drizzleSql`${redemptions.usedCount} + 1`,
                    status: drizzleSql`CASE WHEN ${redemptions.usedCount} + 1 >= ${redemptions.count} THEN 2 ELSE 1 END`,
                })
                .where(and(eq(redemptions.key, key), eq(redemptions.status, 1)))
                .returning({ quota: redemptions.quota });

            if (!claimed) return [];

            return await tx.update(users)
                .set({ quota: drizzleSql`${users.quota} + ${claimed.quota}` })
                .where(eq(users.id, user.id))
                .returning({ newQuota: users.quota, addedQuota: drizzleSql`${claimed.quota}` });
        });

        if (!result || result.length === 0) {
            throw new Error("Invalid or already used redemption code.");
        }

        return {
            success: true,
            message: "Redemption successful",
            addedQuota: result[0].addedQuota,
            newQuota: result[0].newQuota,
        };
    });
