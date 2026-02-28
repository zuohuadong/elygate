import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';

/**
 * User Redemptions API
 * Allows registered users to redeem CDKs for quota.
 */
export const redemptionsRouter = new Elysia({ prefix: '/redemptions' })
    .use(authPlugin)
    .post('/redeem', async ({ body, user }: any) => {
        const code = body?.code?.trim();

        if (!code) {
            throw new Error("Missing 'code' in request body");
        }

        // Atomic CDK redemption using CTE to prevent race conditions
        const result = await sql`
            WITH claimed AS (
                UPDATE redemptions 
                SET status = 2, used_by = ${user.id}, used_at = CURRENT_TIMESTAMP 
                WHERE code = ${code} AND status = 1 
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
