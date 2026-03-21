import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';

/**
 * Redemptions Router
 * Allows registered users to redeem CDKs for quota.
 * Prefix and authPlugin are applied in index.ts
 */
export const redemptionsRouter = new Elysia()
    .post('/redeem', async ({ body, user }: ElysiaCtx) => {
        const key = body?.key?.trim();

        if (!key) {
            throw new Error("Missing 'key' in request body");
        }

        // Atomic CDK redemption using CTE to prevent race conditions
        const result = await sql`
            WITH claimed AS (
                UPDATE redemptions 
                SET used_count = used_count + 1,
                    status = CASE WHEN used_count + 1 >= count THEN 2 ELSE 1 END
                WHERE key = ${key} AND status = 1 
                RETURNING quota
            )
            UPDATE users 
            SET quota = quota + (SELECT quota FROM claimed)
            WHERE id = ${user.id} AND EXISTS (SELECT 1 FROM claimed)
            RETURNING quota as "newQuota", (SELECT quota FROM claimed) as "addedQuota"
        `;

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
