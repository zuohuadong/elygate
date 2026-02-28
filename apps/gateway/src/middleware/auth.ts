import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { isRateLimited } from '../services/ratelimit';

/**
 * Bearer Token Authentication Middleware
 * Parses "Authorization: Bearer sk-xxx" from OpenAI protocol
 * and validates the corresponding key in the database.
 */
export const authPlugin = new Elysia({ name: 'auth' })
    .derive(async ({ request, set }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Missing or invalid Authorization header');
        }

        const apiKey = authHeader.substring(7);

        // Use Bun SQL template for high-speed parameterized queries (pre-compiled)
        const rows = await sql`
            SELECT 
                t.id AS token_id, t.name, t.key, t.remain_quota, t.used_quota, t.status AS token_status, t.expired_at, t.models AS token_models,
                u.id AS user_id, u.username, u.group, u.role, u.quota, u.status AS user_status
            FROM tokens t
            INNER JOIN users u ON t.user_id = u.id
            WHERE t.key = ${apiKey}
            LIMIT 1
        `;

        if (!rows || rows.length === 0) {
            set.status = 401;
            throw new Error('Invalid API key or User not found');
        }

        const raw = rows[0];

        // Map raw database row to logical objects
        const tokenRecord = {
            id: raw.token_id,
            name: raw.name,
            key: raw.key,
            remainQuota: Number(raw.remain_quota),
            usedQuota: Number(raw.used_quota),
            status: raw.token_status,
            expiredAt: raw.expired_at ? new Date(raw.expired_at) : null,
            models: Array.isArray(raw.token_models) ? raw.token_models : []
        };

        const userRecord = {
            id: raw.user_id,
            username: raw.username,
            group: raw.group,
            role: raw.role,
            quota: Number(raw.quota),
            status: raw.user_status
        };

        if (tokenRecord.status !== 1) { // 1-normal, 2-disabled
            set.status = 403;
            throw new Error('API key is disabled');
        }
        if (userRecord.status !== 1) {
            set.status = 403;
            throw new Error('User account is disabled');
        }

        if (tokenRecord.expiredAt && tokenRecord.expiredAt < new Date()) {
            set.status = 403;
            throw new Error('API key has expired');
        }

        // Pre-check quota to prevent overdraft and spamming
        if (userRecord.quota <= 0) {
            set.status = 403;
            throw new Error('Insufficient user quota');
        }
        if (tokenRecord.remainQuota !== -1 && tokenRecord.remainQuota <= 0) {
            // New-API logic: if infinite, it's usually -1 or a very large negative.
            // Currently blocking at 0 for simplicity.
            set.status = 403;
            throw new Error('Insufficient token quota');
        }

        // Rate Limiting: Apply global frequency control based on UserID
        if (await isRateLimited(`user_${userRecord.id}`)) {
            set.status = 429;
            throw new Error('Too Many Requests');
        }

        // Attach validated token and user data to the context for downstream routes
        return {
            token: tokenRecord,
            user: userRecord
        };
    });
