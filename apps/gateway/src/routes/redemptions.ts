import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';

/**
 * User Redemptions API
 * Allows registered users to redeem CDKs for quota.
 */
export const redemptionsRouter = new Elysia({ prefix: '/redemptions' })
    // Direct Auth Logic - Use .derive to avoid short-circuiting the handler
    .derive(async ({ request, set }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Unauthorized');
        }
        const apiKey = authHeader.substring(7);
        const [userRow] = await sql`
            SELECT u.id, u.group FROM tokens t
            JOIN users u ON t.user_id = u.id
            WHERE t.key = ${apiKey} AND t.status = 1 AND u.status = 1
            LIMIT 1
        `;
        if (!userRow) {
            set.status = 401;
            throw new Error('Invalid or expired token');
        }
        return { user: userRow };
    })
    .post('/redeem', async ({ body, user }: any) => {
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
