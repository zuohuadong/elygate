import { sql } from '@ai-api/db';

/**
 * In-memory Cache Pool (Acts as a Redis replacement)
 * Stores active and available channel data.
 */
export const memoryCache = {
    // Channel cache: modelName -> Channel[] 
    channelRoutes: new Map<string, any[]>(),
    lastUpdated: 0,

    /**
     * Refresh Cache: Pulls all active channels from PostgreSQL.
     */
    async refresh() {
        try {
            console.log('[Cache] Refreshing channel routes from DB...');
            // Fetch all properly enabled channels using native SQL
            const activeChannels = await sql`
                SELECT id, type, name, base_url AS "baseUrl", key, models, model_mapping AS "modelMapping", weight, status
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
     * Shuffles and sorts based on weight composite scores.
     */
    selectChannels(modelName: string): any[] {
        const available = this.channelRoutes.get(modelName) || [];
        if (available.length === 0) return [];

        // Sort by composite score (Random * Weight) to balance high-concurrency pressure.
        // Higher weight increases the probability of appearing first.
        return [...available].sort((a, b) => {
            const scoreA = Math.random() * (a.weight || 1);
            const scoreB = Math.random() * (b.weight || 1);
            return scoreB - scoreA;
        });
    }
};
