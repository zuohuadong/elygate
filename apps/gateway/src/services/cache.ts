import { sql } from '@elygate/db';
import { type ChannelConfig, type TokenRecord, type UserRecord } from '../types';

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
    semanticCacheHits: number;
    semanticCacheMisses: number;
    responseCacheHits: number;
    responseCacheMisses: number;
}

export const memoryCache = {
    channelRoutes: new Map<string, ChannelConfig[]>(),
    channels: new Map<number, ChannelConfig>(),
    rateLimitRules: new Map<number, any>(),
    userGroups: new Map<string, any>(),
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
        semanticCacheHits: 0,
        semanticCacheMisses: 0,
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
            console.log('[Cache] Refreshing channel routes and rate limits from DB...');
            const allChannels = await sql`
                SELECT id, type, name, base_url AS "baseUrl", key, models, model_mapping AS "modelMapping", weight, priority, groups, status,
                       key_strategy AS "keyStrategy", key_status AS "keyStatus", key_concurrency_limit AS "keyConcurrencyLimit", price_ratio AS "priceRatio"
                FROM channels 
                WHERE status != 0
            `;

            const allRules = await sql`
                SELECT id, name, rpm, rph, concurrent FROM rate_limit_rules
            `;
            const newRulesMap = new Map<number, any>();
            for (const rule of allRules) {
                newRulesMap.set(rule.id, rule);
            }
            this.rateLimitRules = newRulesMap;

            // Load User Groups
            const allGroups = await sql`
                SELECT key, name, 
                    allowed_channel_types AS "allowedChannelTypes",
                    denied_channel_types AS "deniedChannelTypes",
                    allowed_models AS "allowedModels",
                    denied_models AS "deniedModels",
                    allowed_packages AS "allowedPackages"
                FROM user_groups
                WHERE status = 1
            `;
            const newGroupsMap = new Map<string, any>();
            for (const group of allGroups) {
                const parseArray = (val: any) => {
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

            for (const channel of allChannels) {
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
            console.log(`[Cache] Successfully loaded ${allChannels.length} channels (${newRoutes.size} models).`);

            if (!skipBroadcast) {
                await sql`NOTIFY refresh_cache, 'refresh_cache'`;
            }
        } catch (e) {
            console.error('[Cache] Failed to refresh channels:', e);
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

        // 2. Hierarchical Sort: Priority (Tier) first, then Weighted Random within Tier.
        return [...candidateChannels].sort((a, b) => {
            // First sort by Priority (Tier) descending
            if ((b.priority || 0) !== (a.priority || 0)) {
                return (b.priority || 0) - (a.priority || 0);
            }

            // Half-Open (status 4) has 90% weight reduction to limit traffic
            const weightA = a.status === 4 ? (a.weight || 1) * 0.1 : (a.weight || 1);
            const weightB = b.status === 4 ? (b.weight || 1) * 0.1 : (b.weight || 1);

            const scoreA = Math.random() * weightA;
            const scoreB = Math.random() * weightB;
            return scoreB - scoreA;
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
        const cacheRows = await sql`
            SELECT token_data FROM token_cache
            WHERE key_hash = ${keyHash} AND (expired_at IS NULL OR expired_at > NOW())
            LIMIT 1
        `;
        if (cacheRows.length > 0) {
            const tokenData = cacheRows[0].token_data;
            if (typeof tokenData === 'string') {
                try {
                    const token = JSON.parse(tokenData);
                    this.setToken(key, token);
                    return token;
                } catch {}
            } else {
                this.setToken(key, tokenData);
                return tokenData;
            }
        }

        return this.getTokenFromDB(key);
    },

    async getTokenFromDB(key: string): Promise<TokenRecord | null> {
        const rows = await sql`
            SELECT t.id, t.name, t.key, t.remain_quota as "remainQuota", t.used_quota as "usedQuota", 
                   t.status, t.expired_at as "expiredAt", t.models, t.subnet, t.rate_limit as "rateLimit",
                   t.user_id as "userId"
            FROM tokens t
            WHERE t.key = ${key} AND t.status = 1
            LIMIT 1
        `;
        if (rows.length > 0) {
            const token = rows[0];
            if (typeof token.models === 'string') {
                try {
                    token.models = JSON.parse(token.models);
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
        await sql`
            INSERT INTO token_cache (key_hash, token_data, user_id, expired_at)
            VALUES (${keyHash}, ${JSON.stringify(token)}, ${token.userId}, ${expiredAt})
            ON CONFLICT (key_hash) DO UPDATE
            SET token_data = EXCLUDED.token_data,
                updated_at = NOW(),
                expired_at = EXCLUDED.expired_at
        `;
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
        await sql`DELETE FROM token_cache WHERE key_hash = ${keyHash}`;
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

        const cacheRows = await sql`
            SELECT quota, used_quota as "usedQuota"
            FROM user_quota_cache
            WHERE user_id = ${userId}
            LIMIT 1
        `;
        if (cacheRows.length > 0) {
            const { quota, usedQuota } = cacheRows[0];
            this.setUserQuota(userId, quota, usedQuota);
            return { quota, usedQuota };
        }

        return this.getUserQuotaFromDB(userId);
    },

    async getUserQuotaFromDB(userId: number): Promise<UserQuotaCache | null> {
        const rows = await sql`
            SELECT quota, used_quota as "usedQuota"
            FROM users
            WHERE id = ${userId}
            LIMIT 1
        `;
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
        await sql`
            INSERT INTO user_quota_cache (user_id, quota, used_quota)
            VALUES (${userId}, ${quota}, ${usedQuota})
            ON CONFLICT (user_id) DO UPDATE
            SET quota = EXCLUDED.quota,
                used_quota = EXCLUDED.used_quota,
                updated_at = NOW()
        `;
    },

    async updateUserQuotaInDB(userId: number, deltaQuota: number): Promise<boolean> {
        try {
            const result = await sql`
                UPDATE users
                SET used_quota = used_quota + ${deltaQuota}
                WHERE id = ${userId} AND used_quota + ${deltaQuota} <= quota
            `;
            if (result.count > 0) {
                const current = this.userQuotas.get(userId);
                if (current) {
                    current.usedQuota += deltaQuota;
                    this.userQuotas.set(userId, current);
                    await this.setUserQuotaToCache(userId, current.quota, current.usedQuota);
                }
                return true;
            }
            return false;
        } catch (e) {
            console.error('[Cache] Failed to update user quota:', e);
            return false;
        }
    },

    async invalidateUserQuotaCache(userId: number): Promise<void> {
        this.userQuotas.delete(userId);
        await sql`DELETE FROM user_quota_cache WHERE user_id = ${userId}`;
    },

    getUser(userId: number): UserRecord | null {
        return this.users.get(userId) || null;
    },

    async getUserFromDB(userId: number): Promise<UserRecord | null> {
        const cached = this.getUser(userId);
        if (cached) return cached;

        const rows = await sql`
            SELECT id, username, group_key as "group", role, quota, used_quota as "usedQuota", 
                   status, currency, active_packages as "activePackages"
            FROM users
            WHERE id = ${userId}
            LIMIT 1
        `;
        if (rows.length > 0) {
            const user = rows[0];
            if (typeof user.activePackages === 'string') {
                try {
                    user.activePackages = JSON.parse(user.activePackages);
                } catch {
                    user.activePackages = [];
                }
            }
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
            semanticCacheHits: 0,
            semanticCacheMisses: 0,
            responseCacheHits: 0,
            responseCacheMisses: 0
        };
    },

    startCleanupTask(): void {
        if (this.cleanupInterval) return;
        this.cleanupInterval = setInterval(async () => {
            console.log('[Cache] Running cleanup task...');
            try {
                await sql`CALL expire_cache_rows('7 days'::INTERVAL)`;
                console.log('[Cache] Cleanup completed.');
            } catch (e) {
                console.error('[Cache] Cleanup failed:', e);
            }
        }, 60 * 60 * 1000);
        console.log('[Cache] Cleanup task started (interval: 1 hour)');
    },

    stopCleanupTask(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log('[Cache] Cleanup task stopped');
        }
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
     * Guaranteed to only initialize once.
     */
    async initSync() {
        if (this.syncPromise) return this.syncPromise;

        this.syncPromise = (async () => {
            console.log('[Cache] Initializing PostgreSQL LISTEN for sync...');
            try {
                // @ts-expect-error: Loading raw JS bundle
                const { default: postgres } = await import('./postgres_bundled.js');
                const sqlListen = postgres(process.env.DATABASE_URL!);

                await sqlListen.listen('refresh_cache', (payload: string) => {
                    console.log(`[Cache] Received sync signal: ${payload}`);
                    if (payload === 'refresh_cache') {
                        this.refresh(true).catch(console.error);
                    }
                });
                console.log('[Cache] Multi-instance sync listener established.');
            } catch (e) {
                console.error('[Cache] Failed setting up listener:', e);
                this.syncPromise = null; // enable retry
            }
        })();
        return this.syncPromise;
    }
};

// Start synchronization listener safely
memoryCache.initSync().catch(e => console.error('[Cache] Failed to init sync:', e));
