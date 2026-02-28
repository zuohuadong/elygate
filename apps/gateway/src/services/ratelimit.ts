import { sql } from '@elygate/db';

/**
 * PostgreSQL-native Distributed Rate Limiter
 * Ensures rate limits are enforced across all gateway instances using a fixed-window approach.
 */

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 300;

/**
 * Check if the given identifier triggers rate limiting using PostgreSQL
 * @param identifier Unique ID (Token ID or User ID)
 * @returns true if limited (rejected)
 */
export async function isRateLimited(identifier: string | number): Promise<boolean> {
    const now = new Date();
    const windowStart = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
    const expiredAt = new Date(windowStart.getTime() + WINDOW_MS + 1000); // 1s buffer
    const key = `${identifier}:${windowStart.getTime()}`;

    try {
        // Atomic Insert or Update using Postgres 9.5+ feature (UPSERT)
        const [result] = await sql`
            INSERT INTO rate_limits (key, count, expired_at)
            VALUES (${key}, 1, ${expiredAt})
            ON CONFLICT (key) DO UPDATE
            SET count = rate_limits.count + 1
            RETURNING count
        `;

        // Periodic cleanup of expired entries (fire and forget)
        if (Math.random() < 0.01) { // 1% chance per request to prune
            sql`DELETE FROM rate_limits WHERE expired_at < NOW()`.catch(() => { });
        }

        return result.count > MAX_REQUESTS_PER_WINDOW;
    } catch (e) {
        console.error('[RateLimit/Postgres] Error:', e);
        // Fallback to allow if DB is struggling (fail-open)
        return false;
    }
}
