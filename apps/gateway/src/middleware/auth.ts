import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { sql } from '@elygate/db';
import { isRateLimited } from '../services/ratelimit';
import { type TokenRecord, type UserRecord } from '../types';
import { memoryCache } from '../services/cache';
import { LRUCache } from 'lru-cache';

// High-performance LRU cache for auth context (Token + User)
// Reduces DB pressure by 90%+ for repeated requests from the same API key.
const authCache = new LRUCache<string, { token: TokenRecord, user: UserRecord }>({
    max: 10000,
    ttl: 1000 * 60, // 1 minute TTL
});

/**
 * Flush authentication cache when a token or user is updated in the DB.
 * Subscribes to PG NOTIFY.
 */
async function initAuthSync() {
    try {
        // @ts-expect-error: Loading raw JS bundle
        const { default: postgres } = await import('../services/postgres_bundled.js');
        const sqlListen = postgres(process.env.DATABASE_URL!);

        await sqlListen.listen('auth_update', (payload: string | null) => {
            if (payload) {
                authCache.delete(payload);
                console.log(`[Auth/Cache] Flushed cache via DB notification: ${payload}`);
            }
        });
        console.log('[Auth/Cache] Listener established.');
    } catch (e) {
        console.error('[Auth/Cache] Failed setting up listener:', e);
    }
}

initAuthSync().catch(console.error);

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
 * and validates the corresponding key in the database (with LRU Cache).
 */
export const authPlugin = new Elysia({ name: 'auth' })
    .derive({ as: 'global' }, async ({ request, set }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Missing or invalid Authorization header');
        }

        const apiKey = authHeader.substring(7);

        // 1. Try LRU Cache Hit
        const cached = authCache.get(apiKey);
        if (cached) {
            // Re-check rate limits for cached keys
            if (await isRateLimited(`token_${cached.token.id}`, cached.token.rateLimit)) {
                set.status = 429;
                throw new Error('Too Many Requests');
            }
            return cached;
        }

        // 2. Cache Miss: Perform DB Query
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
            set.status = 403;
            throw new Error('Insufficient token quota');
        }

        // Rate Limiting: Apply frequency control based on TokenID (or UserID if fallback)
        if (await isRateLimited(`token_${tokenRecord.id}`, tokenRecord.rateLimit)) {
            set.status = 429;
            throw new Error('Too Many Requests');
        }

        // Attach validated token and user data to the context for downstream routes
        const result = {
            token: tokenRecord,
            user: userRecord
        } as { token: TokenRecord, user: UserRecord };

        // 3. Store in LRU Cache
        authCache.set(apiKey, result);
        return result;
    });

/**
 * Admin-only Authentication Guard
 * Same as authPlugin but strictly requires role = 10 (Admin)
 */
export const adminGuard = new Elysia()
    .use(cors())
    .use(authPlugin)
    .onBeforeHandle(({ user, set }: any) => {
        const u = user as UserRecord;
        if (!u || u.role !== 10) {
            set.status = 403;
            throw new Error('Forbidden: Admin privileges required');
        }
    });
