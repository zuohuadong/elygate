import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { sql } from '@elygate/db';
import { isRateLimited } from '../services/ratelimit';
import { type TokenRecord, type UserRecord } from '../types';
import { memoryCache } from '../services/cache';

export function assertModelAccess(user: UserRecord, token: TokenRecord, modelName: string, set: any) {
    const groupModelKey = `group_models_${user.group}`;
    const allowedGroupModels = memoryCache.getOption(groupModelKey);
    if (allowedGroupModels && Array.isArray(allowedGroupModels) && !allowedGroupModels.includes(modelName)) {
        set.status = 403;
        throw new Error(`Your group '${user.group}' is not allowed to use model '${modelName}'`);
    }

    if (token.models && token.models.length > 0 && !token.models.includes(modelName)) {
        set.status = 403;
        throw new Error(`Your API key is not allowed to use model '${modelName}'`);
    }
}
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
                t.id AS token_id, t.name, t.key, t.remain_quota, t.used_quota, t.status AS token_status, t.expired_at, t.models AS token_models, t.subnet, t.rate_limit,
                u.id AS user_id, u.username, u.group, u.role, u.quota, u.status AS user_status
            FROM tokens t
            INNER JOIN users u ON t.user_id = u.id
            WHERE t.key = ${apiKey}
            LIMIT 1
        `;

        console.log(`[Auth] API Key: ${apiKey.substring(0, 5)}..., Result rows: ${rows?.length || 0}`);

        if (!rows || rows.length === 0) {
            console.error(`[Auth] No valid token/user found for key starting with: ${apiKey.substring(0, 5)}`);
            set.status = 401;
            throw new Error('Invalid API key or User not found');
        }

        const raw = rows[0];

        // Map raw database row to logical objects
        const tokenRecord: TokenRecord = {
            id: raw.token_id,
            name: raw.name,
            key: raw.key,
            remainQuota: Number(raw.remain_quota),
            usedQuota: Number(raw.used_quota),
            status: raw.token_status,
            expiredAt: raw.expired_at ? new Date(raw.expired_at) : null,
            models: Array.isArray(raw.token_models) ? raw.token_models : [],
            subnet: raw.subnet || '',
            rateLimit: Number(raw.rate_limit || 0)
        };

        const userRecord: UserRecord = {
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

        // --- IP Whitelist Validation ---
        if (tokenRecord.subnet) {
            const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1';
            const allowedSubnets = tokenRecord.subnet.split(',').map((s: string) => s.trim()).filter(Boolean);

            // Basic exact match for now. In production, consider ip-cidr package for subnet masking.
            if (allowedSubnets.length > 0 && !allowedSubnets.includes(clientIp)) {
                set.status = 403;
                throw new Error(`IP Origin ${clientIp} is not whitelisted for this API key.`);
            }
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

        // Rate Limiting: Apply frequency control based on TokenID (or UserID if fallback)
        if (await isRateLimited(`token_${tokenRecord.id}`, tokenRecord.rateLimit)) {
            set.status = 429;
            throw new Error('Too Many Requests');
        }

        // Attach validated token and user data to the context for downstream routes
        console.log(`[Auth] Successfully identified user: ${userRecord.username}, Role: ${userRecord.role}`);
        return {
            token: tokenRecord,
            user: userRecord
        } as { token: TokenRecord, user: UserRecord };
    });

/**
 * Admin-only Authentication Guard
 * Same as authPlugin but strictly requires role = 10 (Admin)
 */
export const adminGuard = new Elysia({ name: 'adminGuard' })
    .use(cors())
    .use(authPlugin)
    .derive(({ user, set }: any) => {
        const u = user as UserRecord;
        if (!u || u.role !== 10) {
            set.status = 403;
            throw new Error('Forbidden: Admin privileges required');
        }
        return { user: u };
    });
