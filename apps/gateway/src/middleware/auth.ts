import { config } from '../config';
import { log } from '../services/logger';
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { db, sql } from '@elygate/db';
import { users, tokens, sessions, organizations, userSubscriptions, packages as packagesTable } from '@elygate/db/schema';
import { eq, and, lte, gt, desc, sql as drizzleSql } from 'drizzle-orm';
import { isRateLimited } from '../services/ratelimit';
import type { TokenRecord,  UserRecord  } from '../types';
import { memoryCache } from '../services/cache';
import { LRUCache } from 'lru-cache';
import { jwt } from '@elysiajs/jwt';
import { checkAndResetSubscriptionQuota } from '../services/subscription';
import { translateErrorBilingual } from '../services/i18n';

// High-performance LRU cache for auth context (Token + User)
// Reduces DB pressure by 90%+ for repeated requests from the same API key.
const authCache = new LRUCache<string, { token: TokenRecord, user: UserRecord }>({
    max: 10000,
    ttl: 1000 * 60, // 1 minute TTL
});

let authSyncPromise: Promise<void> | null = null;
/**
 * Flush authentication cache when a token or user is updated in the DB.
 * Subscribes to PG NOTIFY via @elygate/pg-listen (zero-dependency, Bun native TCP).
 * Guaranteed to only initialize once.
 */
async function initAuthSync() {
    if (authSyncPromise) return authSyncPromise;
    authSyncPromise = (async () => {
        try {
            const { createPgListener } = await import('@elygate/pg-listen');
            createPgListener(
                config.databaseUrl!,
                ['auth_update'],
                (_channel, payload) => {
                    if (payload) {
                        authCache.delete(payload);
                        log.info(`[Auth/Cache] Flushed cache via DB notification: ${payload}`);
                    }
                }
            );
            log.info('[Auth/Cache] Listener established.');
        } catch (e: unknown) {
            log.error('[Auth/Cache] Failed setting up listener:', e);
            authSyncPromise = null;
        }
    })();
    return authSyncPromise;
}

initAuthSync().catch((e: unknown) => log.error("[Async]", e));

export function assertModelAccess(user: UserRecord, token: TokenRecord, modelName: string, set: { status?: number; headers?: Record<string, string> }): void {
    // 1. Organization Level Policy (Strictest)
    if (user.orgDeniedModels && user.orgDeniedModels.length > 0 && user.orgDeniedModels.includes(modelName)) {
        set.status = 403;
        throw new Error(`Your organization policies prohibited use of model '${modelName}'`);
    }

    if (user.orgAllowedModels && user.orgAllowedModels.length > 0 && !user.orgAllowedModels.includes(modelName)) {
        set.status = 403;
        throw new Error(`Your organization policies only allow specific models. '${modelName}' is not permitted.`);
    }

    // 2. User Group Level Policy
    const groupModelKey = `group_models_${user.group}`;
    const allowedGroupModels = memoryCache.getOption(groupModelKey);
    if (allowedGroupModels && Array.isArray(allowedGroupModels) && !allowedGroupModels.includes(modelName)) {
        set.status = 403;
        throw new Error(`Your group '${user.group}' is not allowed to use model '${modelName}'`);
    }

    // 3. Token Level Policy (Most specific)
    if (token.modelLimitsEnabled && token.models && token.models.length > 0 && !token.models.includes(modelName)) {
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
    .use(jwt({
        name: 'jwt',
        secret: config.jwtSecret!
    }))
    .derive({ as: 'global' }, async ({ request, set, jwt, cookie: { auth_session } }: any) => {
        let authHeader = request.headers.get('authorization');

        // --- Support Anthropic API x-api-key header ---
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            const xApiKey = request.headers.get('x-api-key');
            if (xApiKey) {
                authHeader = `Bearer ${xApiKey}`;
            }
        }

        // --- Support Gemini API x-goog-api-key header and query param ---
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            const googApiKey = request.headers.get('x-goog-api-key') || new URL(request.url).searchParams.get('key');
            if (googApiKey) {
                authHeader = `Bearer ${googApiKey}`;
            }
        }

        // --- DB Cookie Session Check (Dual Authentication) ---
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            if (!auth_session.value) {
                set.status = 401;
                throw new Error('Missing or invalid Authorization header / Session cookie');
            }

            const [sessionRow] = await db
                .select({
                    user_id: sessions.userId,
                    expires_at: sessions.expiresAt,
                    id: users.id,
                    username: users.username,
                    group: users.group,
                    role: users.role,
                    quota: users.quota,
                    status: users.status,
                    org_id: users.orgId,
                    used_quota: users.usedQuota,
                    currency: users.currency,
                })
                .from(sessions)
                .innerJoin(users, eq(sessions.userId, users.id))
                .where(eq(sessions.token, auth_session.value))
                .limit(1);

            if (!sessionRow) {
                set.status = 401;
                throw new Error('Invalid Session');
            }

            if (new Date(sessionRow.expires_at) < new Date()) {
                await db.delete(sessions).where(eq(sessions.token, auth_session.value));
                set.status = 401;
                throw new Error('Session has expired');
            }

            if (sessionRow.status !== 1) {
                set.status = 403;
                throw new Error('User account is disabled or missing');
            }

            const tokenRecord: TokenRecord = {
                id: 0,
                name: 'Web Session',
                key: 'jwt-session',
                userId: sessionRow.user_id,
                remainQuota: -1,
                usedQuota: 0,
                status: 1,
                expiredAt: null,
                models: [],
                subnet: '',
                rateLimit: 0,
                unlimitedQuota: true,
                modelLimitsEnabled: false,
                crossGroupRetry: false,
                accessedAt: null,
                orgId: sessionRow.org_id ?? undefined
            };

            const userRecord: UserRecord = {
                id: sessionRow.id,
                username: sessionRow.username,
                group: sessionRow.group || 'default',
                orgId: sessionRow.org_id ?? undefined,
                role: sessionRow.role,
                quota: Number(sessionRow.quota),
                usedQuota: Number(sessionRow.used_quota || 0),
                status: sessionRow.status,
                currency: sessionRow.currency || 'USD'
            };

            return { token: tokenRecord, user: userRecord };
        }

        const apiKey = authHeader.substring(7);

        // 1. Try LRU Cache Hit
        const cached = authCache.get(apiKey);
        if (cached) {
            // Lazy-check quota reset even on cache hit (minimal DB impact if already reset)
            await checkAndResetSubscriptionQuota(cached.user.id).catch((e: unknown) => log.error("[Async]", e));

            // Re-check rate limits for cached keys
            if (await isRateLimited(`token_${cached.token.id}`, cached.token.rateLimit)) {
                set.status = 429;
                throw new Error('Too Many Requests');
            }
            if (cached.token.id > 0) {
                db.update(tokens).set({ accessedAt: drizzleSql`NOW()` }).where(eq(tokens.id, cached.token.id)).catch((e: unknown) => log.error('[Auth] Failed updating accessed_at:', e));
            }
            return cached;
        }

        // 3. Cache Miss: Perform DB Query
        const rows = await db
            .select({
                token_id: tokens.id,
                name: tokens.name,
                key: tokens.key,
                remain_quota: tokens.remainQuota,
                used_quota: tokens.usedQuota,
                token_status: tokens.status,
                expired_at: tokens.expiredAt,
                token_models: tokens.models,
                subnet: tokens.subnet,
                allow_ips: tokens.allowIps,
                rate_limit: tokens.rateLimit,
                unlimited_quota: tokens.unlimitedQuota,
                model_limits_enabled: tokens.modelLimitsEnabled,
                token_group: tokens.tokenGroup,
                cross_group_retry: tokens.crossGroupRetry,
                accessed_at: tokens.accessedAt,
                token_org_id: tokens.orgId,
                user_id: users.id,
                username: users.username,
                group: users.group,
                role: users.role,
                quota: users.quota,
                user_status: users.status,
                user_org_id: users.orgId,
                currency: users.currency,
                org_allowed_models: organizations.allowedModels,
                org_denied_models: organizations.deniedModels,
                org_allowed_subnets: organizations.allowedSubnets,
            })
            .from(tokens)
            .innerJoin(users, eq(tokens.userId, users.id))
            .leftJoin(organizations, eq(users.orgId, organizations.id))
            .where(eq(tokens.key, apiKey))
            .limit(1);

        log.info(`[Auth] API Key: ${apiKey.substring(0, 5)}..., Result rows: ${rows?.length || 0}`);

        if (!rows || rows.length === 0) {
            log.error(`[Auth] No valid token/user found for key starting with: ${apiKey.substring(0, 5)}`);
            set.status = 401;
            throw new Error('Invalid API key or User not found');
        }

        const raw = rows[0];

        // Map raw database row to logical objects
        const tokenRecord: TokenRecord = {
            id: raw.token_id,
            name: raw.name,
            key: raw.key,
            userId: raw.user_id,
            remainQuota: Number(raw.remain_quota),
            usedQuota: Number(raw.used_quota),
            status: raw.token_status,
            expiredAt: raw.expired_at ? new Date(raw.expired_at) : null,
            models: Array.isArray(raw.token_models) ? raw.token_models : [],
            subnet: raw.subnet || '',
            allowIps: raw.allow_ips || raw.subnet || '',
            rateLimit: Number(raw.rate_limit || 0),
            unlimitedQuota: Boolean(raw.unlimited_quota),
            modelLimitsEnabled: Boolean(raw.model_limits_enabled),
            tokenGroup: raw.token_group || undefined,
            crossGroupRetry: Boolean(raw.cross_group_retry),
            accessedAt: raw.accessed_at ? new Date(raw.accessed_at) : null,
            orgId: raw.token_org_id ?? undefined
        };

        const userRecord: UserRecord = {
            id: raw.user_id,
            username: raw.username,
            group: raw.group,
            orgId: raw.user_org_id ?? raw.token_org_id ?? undefined,
            role: raw.role,
            quota: Number(raw.quota),
            usedQuota: Number(raw.used_quota || 0),
            status: raw.user_status,
            currency: raw.currency || 'USD',
            orgAllowedModels: Array.isArray(raw.org_allowed_models) ? raw.org_allowed_models : (typeof raw.org_allowed_models === 'string' ? JSON.parse(raw.org_allowed_models || '[]') : []),
            orgDeniedModels: Array.isArray(raw.org_denied_models) ? raw.org_denied_models : (typeof raw.org_denied_models === 'string' ? JSON.parse(raw.org_denied_models || '[]') : []),
            orgAllowedSubnets: raw.org_allowed_subnets ?? undefined
        };

        if (tokenRecord.status !== 1) { // 1-normal, 2-disabled
            set.status = 403;
            throw new Error('API key is disabled');
        }

        // --- IP Whitelist Validation (Token Level + Org Level) ---
        const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1';
        
        // Org Level Check
        if (raw.org_allowed_subnets) {
            const orgSubnets = raw.org_allowed_subnets.split(',').map((s: string) => s.trim()).filter(Boolean);
            if (orgSubnets.length > 0 && !orgSubnets.includes(clientIp)) {
                set.status = 403;
                throw new Error(`Your organization policies restricted access for IP ${clientIp}`);
            }
        }

        // Token Level Check
        const tokenIpPolicy = tokenRecord.allowIps || tokenRecord.subnet;
        if (tokenIpPolicy) {
            const allowedSubnets = tokenIpPolicy.split(',').map((s: string) => s.trim()).filter(Boolean);
            if (allowedSubnets.length > 0 && !allowedSubnets.includes(clientIp)) {
                set.status = 403;
                throw new Error(`IP Origin ${clientIp} is not whitelisted for this API key.`);
            }
        }

        if (userRecord.status !== 1) {
            set.status = 403;
            throw new Error('User account is disabled');
        }

        // Check active subscriptions
        const subs = await db
            .select({
                models: packagesTable.models,
                default_rate_limit_id: packagesTable.defaultRateLimitId,
                model_rate_limits: packagesTable.modelRateLimits,
            })
            .from(userSubscriptions)
            .innerJoin(packagesTable, eq(userSubscriptions.packageId, packagesTable.id))
            .where(
                and(
                    eq(userSubscriptions.userId, userRecord.id),
                    eq(userSubscriptions.status, 1),
                    lte(userSubscriptions.startTime, drizzleSql`NOW()`),
                    gt(userSubscriptions.endTime, drizzleSql`NOW()`),
                )
            );

        userRecord.activePackages = subs.map((s: Record<string, any>) => ({
            models: Array.isArray(s.models) ? s.models : (typeof s.models === 'string' ? JSON.parse(s.models || '[]') : []),
            defaultRateLimitId: s.default_rate_limit_id,
            modelRateLimits: typeof s.model_rate_limits === 'string' ? JSON.parse(s.model_rate_limits || '{}') : (s.model_rate_limits || {})
        }));

        if (tokenRecord.expiredAt && tokenRecord.expiredAt < new Date()) {
            set.status = 403;
            throw new Error(translateErrorBilingual('API key has expired'));
        }

        // Pre-check quota to prevent overdraft and spamming
        const hasActivePackages = userRecord.activePackages && userRecord.activePackages.length > 0;
        if (userRecord.quota <= 0 && !hasActivePackages) {
            set.status = 403;
            throw new Error(translateErrorBilingual('Insufficient user quota'));
        }
        if (!tokenRecord.unlimitedQuota && tokenRecord.remainQuota !== -1 && tokenRecord.remainQuota <= 0) {
            set.status = 403;
            throw new Error(translateErrorBilingual('Insufficient token quota'));
        }

        // Rate Limiting: Apply frequency control based on TokenID (or UserID if fallback)
        if (await isRateLimited(`token_${tokenRecord.id}`, tokenRecord.rateLimit)) {
            set.status = 429;
            throw new Error('Too Many Requests');
        }

        db.update(tokens).set({ accessedAt: drizzleSql`NOW()` }).where(eq(tokens.id, tokenRecord.id)).catch((e: unknown) => log.error('[Auth] Failed updating accessed_at:', e));

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
export const adminGuard = new Elysia({ name: 'admin-guard' })
    .use(authPlugin)
    .onBeforeHandle(({ user, set }: any) => {
        if (!user) {
            set.status = 401;
            throw new Error('Unauthorized');
        }
        if (user.role < 10) {
            set.status = 403;
            throw new Error('Forbidden: Admin privileges required');
        }
    });
