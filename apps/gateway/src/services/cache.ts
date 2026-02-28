import { sql } from '@elygate/db';

/**
 * In-memory Cache Pool (Acts as a Redis replacement)
 * Stores active and available channel data.
 */
export const memoryCache = {
    // Channel cache: modelName -> Channel[] 
    channelRoutes: new Map<string, any[]>(),
    lastUpdated: 0,
    options: new Map<string, any>(),

    /**
     * Refresh Cache: Pulls all active channels from PostgreSQL.
     * @param skipBroadcast - If true, do not notify other instances (prevents feedback loops)
     */
    async refresh(skipBroadcast = false) {
        try {
            console.log('[Cache] Refreshing channel routes from DB...');
            // Fetch all properly enabled channels using native SQL
            const activeChannels = await sql`
                SELECT id, type, name, base_url AS "baseUrl", key, models, model_mapping AS "modelMapping", weight, priority, groups, status
                FROM channels 
                WHERE status = 1
            `;

            const newRoutes = new Map<string, any[]>();

            for (const channel of activeChannels) {
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

                for (const model of supportedModels) {
                    if (!newRoutes.has(model)) {
                        newRoutes.set(model, []);
                    }
                    newRoutes.get(model)!.push(channel);
                }
            }

            this.channelRoutes = newRoutes;
            this.lastUpdated = Date.now();
            console.log(`[Cache] Successfully loaded ${activeChannels.length} channels.`);

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
    selectChannels(modelName: string, userGroup = 'default'): any[] {
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

            // Within the same tier, use weighted random score for load balancing
            const scoreA = Math.random() * (a.weight || 1);
            const scoreB = Math.random() * (b.weight || 1);
            return scoreB - scoreA;
        });
    },

    setOptions(options: Record<string, any>) {
        for (const [key, value] of Object.entries(options)) {
            this.options.set(key, value);
        }
    },

    getOption(key: string) {
        return this.options.get(key);
    },

    /**
     * Initialize PostgreSQL LISTEN for multi-instance sync.
     */
    async initSync() {
        console.log('[Cache] Initializing PostgreSQL LISTEN for sync...');
        // Casting to any to bypass potential outdated type definitions in local environment
        (sql as any).listen('refresh_cache', (payload: string) => {
            console.log(`[Cache] Received sync signal: ${payload}`);
            if (payload === 'refresh_cache') {
                this.refresh(true).catch(console.error);
            }
        });
    }
};

// Start synchronization listener
memoryCache.initSync().catch(e => console.error('[Cache] Failed to init sync:', e));
