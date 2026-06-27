import { config } from '../config';
import { log } from '../services/logger';
import { db, sql } from '@elygate/db';
import { channels, modelMetadata, rateLimitRules, userGroups, tokens, tokenCache, userQuotaCache, users, sessions } from '@elygate/db/schema';
import { eq, and, ne, isNull, sql as drizzleSql } from 'drizzle-orm';
import type { ChannelConfig, TokenRecord, UserRecord } from '../types';
import { optionCache } from './optionCache';

interface UserQuotaCache {
    quota: number;
    usedQuota: number;
}

interface CacheStats {
    channelHits: number;
    channelMisses: number;
    tokenHits: number;
    tokenMisses: number;
    userQuotaHits: number;
    userQuotaMisses: number;
    responseCacheHits: number;
    responseCacheMisses: number;
}

export interface ModelMeta {
    type: string;       // 'chat' | 'image' | 'video' | 'audio' | 'embedding' | 'rerank'
    endpoint?: string;  // '/v1/video/generations' etc.
    displayName?: string;
    tags?: string[];
}

export const memoryCache = {
    channelRoutes: new Map<string, ChannelConfig[]>(),
    channels: new Map<number, ChannelConfig>(),
    rateLimitRules: new Map<number, any>(),
    userGroups: new Map<string, any>(),
    modelMetadata: new Map<string, ModelMeta>(),
    lastUpdated: 0,
    options: new Map<string, any>(),

    tokens: new Map<string, TokenRecord>(),
    userQuotas: new Map<number, UserQuotaCache>(),
    users: new Map<number, UserRecord>(),

    stats: {
        channelHits: 0,
        channelMisses: 0,
        tokenHits: 0,
        tokenMisses: 0,
        userQuotaHits: 0,
        userQuotaMisses: 0,
        responseCacheHits: 0,
        responseCacheMisses: 0
    } as CacheStats,

    cleanupInterval: null as Timer | null,

    /**
     * Refresh Cache: Pulls all active channels from PostgreSQL.
     * @param skipBroadcast - If true, do not notify other instances (prevents feedback loops)
     */
    async refresh(skipBroadcast = false) {
        try {
            log.info('[Cache] Refreshing channel routes and rate limits from DB...');
            const allChannels = await db.select({
                id: channels.id,
                type: channels.type,
                name: channels.name,
                baseUrl: channels.baseUrl,
                key: channels.key,
                models: channels.models,
                modelMapping: channels.modelMapping,
                weight: channels.weight,
                priority: channels.priority,
                groups: channels.groups,
                status: channels.status,
                keyStrategy: channels.keyStrategy,
                keyStatus: channels.keyStatus,
                keyConcurrencyLimit: channels.keyConcurrencyLimit,
                priceRatio: channels.priceRatio,
                endpointType: channels.endpointType,
                testModel: channels.testModel,
                openaiOrganization: channels.openaiOrganization,
                balance: channels.balance,
                responseTime: channels.responseTime,
                statusCodeMapping: channels.statusCodeMapping,
                autoBan: channels.autoBan,
                tag: channels.tag,
                setting: channels.setting,
                paramOverride: channels.paramOverride,
                headerOverride: channels.headerOverride,
                remark: channels.remark,
                channelInfo: channels.channelInfo,
            }).from(channels).where(ne(channels.status, 0));

            // Load model metadata
            const allModelMeta = await db.select({
                modelName: modelMetadata.modelName,
                type: modelMetadata.type,
                endpoint: modelMetadata.endpoint,
                displayName: modelMetadata.displayName,
                tags: modelMetadata.tags,
            }).from(modelMetadata);
            const newMetaMap = new Map<string, ModelMeta>();
            for (const m of allModelMeta) {
                newMetaMap.set(m.modelName, {
                    type: m.type,
                    endpoint: m.endpoint || undefined,
                    displayName: m.displayName || undefined,
                    tags: Array.isArray(m.tags) ? m.tags : [],
                });
            }
            this.modelMetadata = newMetaMap;

            const allRules = await db.select({
                id: rateLimitRules.id,
                name: rateLimitRules.name,
                rpm: rateLimitRules.rpm,
                rph: rateLimitRules.rph,
                concurrent: rateLimitRules.concurrent,
            }).from(rateLimitRules);
            const newRulesMap = new Map<number, any>();
            for (const rule of allRules) {
                newRulesMap.set(rule.id, rule);
            }
            this.rateLimitRules = newRulesMap;

            // Load User Groups
            const allGroups = await db.select({
                key: userGroups.key,
                name: userGroups.name,
                allowedChannelTypes: userGroups.allowedChannelTypes,
                deniedChannelTypes: userGroups.deniedChannelTypes,
                allowedModels: userGroups.allowedModels,
                deniedModels: userGroups.deniedModels,
                allowedPackages: userGroups.allowedPackages,
            }).from(userGroups).where(eq(userGroups.status, 1));
            const newGroupsMap = new Map<string, any>();
            for (const group of allGroups) {
                const parseArray = (val: unknown) => {
                    if (Array.isArray(val)) return val;
                    if (typeof val === 'string') {
                        try { return JSON.parse(val); } catch { return []; }
                    }
                    return [];
                };
                group.allowedChannelTypes = parseArray(group.allowedChannelTypes);
                group.deniedChannelTypes = parseArray(group.deniedChannelTypes);
                group.allowedModels = parseArray(group.allowedModels);
                group.deniedModels = parseArray(group.deniedModels);
                group.allowedPackages = parseArray(group.allowedPackages);
                newGroupsMap.set(group.key, group);
            }
            this.userGroups = newGroupsMap;

            const newRoutes = new Map<string, ChannelConfig[]>();
            const newChannelsMap = new Map<number, ChannelConfig>();

            for (const rawChannel of allChannels) {
                const channel = {
                    ...(rawChannel as Record<string, unknown>),
                    groups: Array.isArray(rawChannel.groups) ? rawChannel.groups : [],
                    modelMapping: rawChannel.modelMapping || {},
                    keyStatus: rawChannel.keyStatus || {},
                    priceRatio: rawChannel.priceRatio != null ? Number(rawChannel.priceRatio) : undefined,
                    balance: rawChannel.balance != null ? Number(rawChannel.balance) : null,
                    responseTime: rawChannel.responseTime ?? null,
                    statusCodeMapping: rawChannel.statusCodeMapping || {},
                    autoBan: rawChannel.autoBan ?? undefined,
                    setting: rawChannel.setting || {},
                    paramOverride: rawChannel.paramOverride || {},
                    headerOverride: rawChannel.headerOverride || {},
                    remark: rawChannel.remark ?? null,
                    channelInfo: rawChannel.channelInfo || {},
                } as ChannelConfig;

                newChannelsMap.set(channel.id, channel);

                // Only add to routes if status is Active (1) or Half-Open (4)
                if (channel.status !== 1 && channel.status !== 4) continue;
                // Handle JSONB: already an object or needs parsing from string
                let supportedModels: string[] = [];
                if (Array.isArray(channel.models)) {
                    supportedModels = channel.models;
                } else if (typeof channel.models === 'string') {
                    try {
                        supportedModels = JSON.parse(channel.models);
                    } catch {
                        supportedModels = channel.models.split(',').map((s: string) => s.trim());
                    }
                }

                // Handle modelMapping similarly
                if (typeof channel.modelMapping === 'string') {
                    try {
                        channel.modelMapping = JSON.parse(channel.modelMapping);
                    } catch {
                        channel.modelMapping = {};
                    }
                } else if (!channel.modelMapping) {
                    channel.modelMapping = {};
                }

                // Handle keyStatus
                if (typeof channel.keyStatus === 'string') {
                    try {
                        channel.keyStatus = JSON.parse(channel.keyStatus);
                    } catch {
                        channel.keyStatus = {};
                    }
                } else if (!channel.keyStatus) {
                    channel.keyStatus = {};
                }

                for (const model of supportedModels) {
                    if (!newRoutes.has(model)) {
                        newRoutes.set(model, []);
                    }
                    newRoutes.get(model)!.push(channel);

                    // Auto-generate alias for models with provider prefix
                    // e.g., "Qwen/Qwen3.5-397B-A17B" -> "Qwen3.5-397B-A17B"
                    // e.g., "Pro/Qwen/Qwen2.5-7B" -> "Qwen/Qwen2.5-7B" and "Qwen2.5-7B"
                    let alias = model;
                    // Remove "Pro/" prefix first
                    if (alias.toLowerCase().startsWith('pro/')) {
                        alias = alias.substring(4);
                    }
                    // Remove provider prefix (e.g., "Qwen/")
                    if (alias.includes('/')) {
                        const parts = alias.split('/');
                        // Generate alias without first part
                        const aliasName = parts.slice(1).join('/');
                        if (aliasName && aliasName !== model) {
                            if (!newRoutes.has(aliasName)) {
                                newRoutes.set(aliasName, []);
                            }
                            const existingAlias = newRoutes.get(aliasName)!;
                            if (!existingAlias.some(ch => ch.id === channel.id)) {
                                existingAlias.push(channel);
                            }
                        }
                    }
                }

                // Also add modelMapping aliases to routes (reverse mapping)
                // modelMapping: { "requestedModel": "upstreamModel" }
                // We need to add routes for requestedModel -> channel
                if (channel.modelMapping && typeof channel.modelMapping === 'object') {
                    for (const aliasModel of Object.keys(channel.modelMapping)) {
                        if (!newRoutes.has(aliasModel)) {
                            newRoutes.set(aliasModel, []);
                        }
                        // Avoid duplicates
                        const existing = newRoutes.get(aliasModel)!;
                        if (!existing.some(ch => ch.id === channel.id)) {
                            existing.push(channel);
                        }
                    }
                }
            }

            this.channelRoutes = newRoutes;
            this.channels = newChannelsMap;
            this.lastUpdated = Date.now();
            log.info(`[Cache] Successfully loaded ${allChannels.length} channels (${newRoutes.size} models).`);

            if (!skipBroadcast) {
                await sql`NOTIFY refresh_cache, 'refresh_cache'`;
            }
        } catch (e: unknown) {
            log.error('[Cache] Failed to refresh channels:', e);
        }
    },

    /**
     * Randomly select an available channel based on weight (for simple scenarios).
     */
    selectChannel(modelName: string) {
        const available = this.channelRoutes.get(modelName);

        if (!available || available.length === 0) {
            return null;
        }

        if (available.length === 1) {
            return available[0];
        }

        // Weighted Load Balancing calculation
        const totalWeight = available.reduce((sum, ch) => sum + (ch.weight || 1), 0);
        let randomVal = Math.random() * totalWeight;

        for (const ch of available) {
            randomVal -= (ch.weight || 1);
            if (randomVal <= 0) {
                return ch;
            }
        }

        return available[0]; // Fallback
    },

    /**
     * Returns a sorted list of candidate channels for failover/retry scenarios.
     * Filtered by user group and sorted by priority + weight.
     * Strategy is configurable via system option 'ChannelSelectionStrategy':
     *   - 'priority' (default): Deterministic, highest priority & weight first (cost-optimized)
     *   - 'weighted': Weighted random within same priority tier (load-balanced)
     */
    selectChannels(modelName: string, userGroup = 'default'): ChannelConfig[] {
        const available = this.channelRoutes.get(modelName) || [];
        if (available.length === 0) return [];

        // 1. Filter by User Group
        const candidateChannels = available.filter(ch => {
            if (!ch.groups || !Array.isArray(ch.groups) || ch.groups.length === 0) return true;
            return ch.groups.includes(userGroup);
        });

        if (candidateChannels.length === 0) return [];

        const strategy = String(optionCache.get('ChannelSelectionStrategy', 'priority'));

        // 2. Sort by strategy
        return [...candidateChannels].sort((a, b) => {
            // First sort by Priority (Tier) descending
            if ((b.priority || 0) !== (a.priority || 0)) {
                return (b.priority || 0) - (a.priority || 0);
            }

            // Half-Open (status 4) channels go after normal channels
            if (a.status === 4 && b.status !== 4) return 1;
            if (b.status === 4 && a.status !== 4) return -1;

            if (strategy === 'weighted') {
                // Weighted random within same priority tier
                const weightA = a.status === 4 ? (a.weight || 1) * 0.1 : (a.weight || 1);
                const weightB = b.status === 4 ? (b.weight || 1) * 0.1 : (b.weight || 1);
                return Math.random() * weightB - Math.random() * weightA;
            }

            // Default: priority mode — deterministic weight DESC
            return (b.weight || 1) - (a.weight || 1);
        });
    },

    getToken(key: string): TokenRecord | null {
        const token = this.tokens.get(key);
        if (token) {
            this.stats.tokenHits++;
            return token;
        }
        this.stats.tokenMisses++;
        return null;
    },

    async getTokenFromCache(key: string): Promise<TokenRecord | null> {
        const cached = this.getToken(key);
        if (cached) return cached;

        const keyHash = new Bun.CryptoHasher('sha256').update(key).digest('hex');
        const cacheRows = await db.select({
            tokenData: tokenCache.tokenData,
        }).from(tokenCache).where(
            and(
                eq(tokenCache.keyHash, keyHash),
                drizzleSql`${tokenCache.expiredAt} IS NULL OR ${tokenCache.expiredAt} > NOW()`
            )
        ).limit(1);
        if (cacheRows.length > 0) {
            const tokenData = cacheRows[0].tokenData;
            if (typeof tokenData === 'string') {
                try {
                    const token = JSON.parse(tokenData);
                    this.setToken(key, token);
                    return token;
                } catch { /* channel config parse error — skip */ }
            } else {
                const token = tokenData as unknown as TokenRecord;
                this.setToken(key, token);
                return token;
            }
        }

        return this.getTokenFromDB(key);
    },

    async getTokenFromDB(key: string): Promise<TokenRecord | null> {
        const rows = await db.select({
            id: tokens.id,
            name: tokens.name,
            key: tokens.key,
            remainQuota: tokens.remainQuota,
            usedQuota: tokens.usedQuota,
            status: tokens.status,
            expiredAt: tokens.expiredAt,
            models: tokens.models,
            subnet: tokens.subnet,
            rateLimit: tokens.rateLimit,
            userId: tokens.userId,
        }).from(tokens).where(
            and(eq(tokens.key, key), eq(tokens.status, 1))
        ).limit(1);
        if (rows.length > 0) {
            const token = rows[0] as TokenRecord;
            if (typeof token.models === 'string') {
                try {
                    token.models = JSON.parse(token.models as unknown as string);
                } catch {
                    token.models = [];
                }
            }
            this.setToken(key, token);
            await this.setTokenToCache(key, token);
            return token;
        }
        return null;
    },

    async setTokenToCache(key: string, token: TokenRecord): Promise<void> {
        const keyHash = new Bun.CryptoHasher('sha256').update(key).digest('hex');
        const expiredAt = token.expiredAt ? new Date(token.expiredAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db.insert(tokenCache).values({
            keyHash,
            tokenData: token as unknown as Record<string, unknown>,
            userId: token.userId,
            expiredAt,
        }).onConflictDoUpdate({
            target: tokenCache.keyHash,
            set: {
                tokenData: token as unknown as Record<string, unknown>,
                updatedAt: drizzleSql`NOW()`,
                expiredAt,
            },
        });
    },

    setToken(key: string, token: TokenRecord): void {
        this.tokens.set(key, token);
    },

    deleteToken(key: string): void {
        this.tokens.delete(key);
    },

    async invalidateTokenCache(key: string): Promise<void> {
        this.deleteToken(key);
        const keyHash = new Bun.CryptoHasher('sha256').update(key).digest('hex');
        await db.delete(tokenCache).where(eq(tokenCache.keyHash, keyHash));
    },

    getUserQuota(userId: number): UserQuotaCache | null {
        const quota = this.userQuotas.get(userId);
        if (quota) {
            this.stats.userQuotaHits++;
            return quota;
        }
        this.stats.userQuotaMisses++;
        return null;
    },

    async getUserQuotaFromCache(userId: number): Promise<UserQuotaCache | null> {
        const cached = this.getUserQuota(userId);
        if (cached) return cached;

        const cacheRows = await db.select({
            quota: userQuotaCache.quota,
            usedQuota: userQuotaCache.usedQuota,
        }).from(userQuotaCache).where(eq(userQuotaCache.userId, userId)).limit(1);
        if (cacheRows.length > 0) {
            const { quota, usedQuota } = cacheRows[0];
            this.setUserQuota(userId, quota, usedQuota);
            return { quota, usedQuota };
        }

        return this.getUserQuotaFromDB(userId);
    },

    async getUserQuotaFromDB(userId: number): Promise<UserQuotaCache | null> {
        const rows = await db.select({
            quota: users.quota,
            usedQuota: users.usedQuota,
        }).from(users).where(eq(users.id, userId)).limit(1);
        if (rows.length > 0) {
            const { quota, usedQuota } = rows[0];
            this.setUserQuota(userId, quota, usedQuota);
            await this.setUserQuotaToCache(userId, quota, usedQuota);
            return { quota, usedQuota };
        }
        return null;
    },

    setUserQuota(userId: number, quota: number, usedQuota: number): void {
        this.userQuotas.set(userId, { quota, usedQuota });
    },

    async setUserQuotaToCache(userId: number, quota: number, usedQuota: number): Promise<void> {
        await db.insert(userQuotaCache).values({
            userId,
            quota,
            usedQuota,
        }).onConflictDoUpdate({
            target: userQuotaCache.userId,
            set: {
                quota,
                usedQuota,
                updatedAt: drizzleSql`NOW()`,
            },
        });
    },

    async updateUserQuotaInDB(userId: number, deltaQuota: number): Promise<boolean> {
        try {
            const result = await db.update(users).set({
                usedQuota: drizzleSql`${users.usedQuota} + ${deltaQuota}`,
            }).where(
                and(
                    eq(users.id, userId),
                    drizzleSql`${users.usedQuota} + ${deltaQuota} <= ${users.quota}`
                )
            ).returning();
            if (result.length > 0) {
                const current = this.userQuotas.get(userId);
                if (current) {
                    current.usedQuota += deltaQuota;
                    this.userQuotas.set(userId, current);
                    await this.setUserQuotaToCache(userId, current.quota, current.usedQuota);
                }
                return true;
            }
            return false;
        } catch (e: unknown) {
            log.error('[Cache] Failed to update user quota:', e);
            return false;
        }
    },

    async invalidateUserQuotaCache(userId: number): Promise<void> {
        this.userQuotas.delete(userId);
        await db.delete(userQuotaCache).where(eq(userQuotaCache.userId, userId));
    },

    getUser(userId: number): UserRecord | null {
        return this.users.get(userId) || null;
    },

    async getUserFromDB(userId: number): Promise<UserRecord | null> {
        const cached = this.getUser(userId);
        if (cached) return cached;

        const rows = await db.select({
            id: users.id,
            username: users.username,
            group: users.group,
            role: users.role,
            quota: users.quota,
            usedQuota: users.usedQuota,
            status: users.status,
            currency: users.currency,
        }).from(users).where(eq(users.id, userId)).limit(1);
        if (rows.length > 0) {
            const user = rows[0] as UserRecord;
            user.activePackages = [];
            this.setUser(userId, user);
            return user;
        }
        return null;
    },

    setUser(userId: number, user: UserRecord): void {
        this.users.set(userId, user);
    },

    getStats() {
        const total = this.stats.channelHits + this.stats.channelMisses;
        const tokenTotal = this.stats.tokenHits + this.stats.tokenMisses;
        const quotaTotal = this.stats.userQuotaHits + this.stats.userQuotaMisses;
        return {
            ...this.stats,
            channelHitRate: total > 0 ? (this.stats.channelHits / total * 100).toFixed(2) + '%' : '0%',
            tokenHitRate: tokenTotal > 0 ? (this.stats.tokenHits / tokenTotal * 100).toFixed(2) + '%' : '0%',
            userQuotaHitRate: quotaTotal > 0 ? (this.stats.userQuotaHits / quotaTotal * 100).toFixed(2) + '%' : '0%',
            channelCount: this.channels.size,
            tokenCount: this.tokens.size,
            userCount: this.users.size,
            modelCount: this.channelRoutes.size
        };
    },

    resetStats() {
        this.stats = {
            channelHits: 0,
            channelMisses: 0,
            tokenHits: 0,
            tokenMisses: 0,
            userQuotaHits: 0,
            userQuotaMisses: 0,
            responseCacheHits: 0,
            responseCacheMisses: 0
        };
    },

    startCleanupTask(): void {
        if (this.cleanupInterval) return;
        this.cleanupInterval = setInterval(async () => {
            log.info('[Cache] Running cleanup task...');
            try {
                await db.execute(drizzleSql`CALL expire_cache_rows('7 days'::INTERVAL)`);
                log.info('[Cache] Cleanup completed.');
            } catch (e: unknown) {
                log.error('[Cache] Cleanup failed:', e);
            }
        }, 60 * 60 * 1000);
        log.info('[Cache] Cleanup task started (interval: 1 hour)');
    },

    stopCleanupTask(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            log.info('[Cache] Cleanup task stopped');
        }
    },

    discoverySyncInterval: null as Timer | null,

    /**
     * Periodically syncs models from all active upstream channels.
     * Prevents stale model lists and auto-maintains aliases.
     * Runs every 12 hours, initial run after 5 minutes.
     */
    startDiscoverySyncTask(): void {
        if (this.discoverySyncInterval) return;

        const sync = async () => {
            log.info('[Discovery] Starting background model sync for all channels...');
            const channels = Array.from(this.channels.values()).filter(ch =>
                ch.status === 1 && (!ch.endpointType || ch.endpointType === 'auto')
            );

            // Get admin session token from DB for internal API auth
            let sessionToken = '';
            try {
                const sessionRows = await db.select({
                    token: sessions.token,
                }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(
                    and(
                        drizzleSql`${users.role} >= 10`,
                        drizzleSql`${sessions.expiresAt} > NOW()`
                    )
                ).orderBy(drizzleSql`${sessions.expiresAt} DESC`).limit(1);
                sessionToken = sessionRows[0]?.token || '';
            } catch (e: unknown) {
                log.error('[Discovery] Failed to get admin session:', e);
                return;
            }

            if (!sessionToken) {
                log.warn('[Discovery] No active admin session found, skipping sync');
                return;
            }

            let synced = 0;
            let failed = 0;
            for (const ch of channels) {
                try {
                    const res = await fetch(`http://localhost:3000/api/admin/channels/${ch.id}/sync-models`, {
                        method: 'POST',
                        headers: { 'Cookie': `auth_session=${sessionToken}` }
                    });
                    if (res.ok) {
                        const data = await res.json() as Record<string, unknown>;
                        log.info(`[Discovery] Synced ${ch.name}: ${data.modelsCount} models (+${data.added}/-${data.removed}), aliases: ${data.totalAliases}`);
                        synced++;
                    } else {
                        log.warn(`[Discovery] Failed to sync ${ch.name}: HTTP ${res.status}`);
                        failed++;
                    }
                } catch (e: unknown) {
                    log.error(`[Discovery] Error syncing ${ch.name}:`, e);
                    failed++;
                }
            }
            log.info(`[Discovery] Sync complete: ${synced}/${channels.length} channels synced, ${failed} failed`);
        };

        // Run every 12 hours
        this.discoverySyncInterval = setInterval(sync, 12 * 60 * 60 * 1000);
        // Initial run after 5 minutes
        setTimeout(sync, 5 * 60 * 1000);
        log.info('[Discovery] Model sync task started (interval: 12 hours, initial: 5 min)');
    },

    setOptions(options: Record<string, any>) {
        for (const [key, value] of Object.entries(options)) {
            this.options.set(key, value);
        }
    },

    getOption(key: string) {
        return this.options.get(key);
    },

    syncPromise: null as Promise<void> | null,

    /**
     * Initialize PostgreSQL LISTEN for multi-instance sync.
     * Uses @elygate/pg-listen (zero-dependency, Bun native TCP).
     * Guaranteed to only initialize once.
     */
    async initSync() {
        if (this.syncPromise) return this.syncPromise;

        this.syncPromise = (async () => {
            log.info('[Cache] Initializing pg-listen for sync...');
            try {
                const { createPgListener } = await import('@elygate/pg-listen');
                createPgListener(
                    config.databaseUrl!,
                    ['refresh_cache'],
                    (_channel, payload) => {
                        log.info(`[Cache] Received sync signal: ${payload}`);
                        this.refresh(true).catch((e: unknown) => log.error("[Async]", e));
                    }
                );
                log.info('[Cache] Multi-instance sync listener established.');
            } catch (e: unknown) {
                log.error('[Cache] Failed setting up listener:', e);
                this.syncPromise = null; // enable retry
            }
        })();
        return this.syncPromise;
    }
};

// Start synchronization listener safely
memoryCache.initSync().catch(e => log.error('[Cache] Failed to init sync:', e));
