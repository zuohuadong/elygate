import { sql } from '@elygate/db';

export const optionCache = {
    options: new Map<string, any>(),
    lastUpdated: 0,

    async refresh() {
        try {
            console.log('[OptionCache] Refreshing system options from DB...');
            const results = await sql`SELECT key, value FROM options`;

            const newOptions = new Map<string, any>();
            for (const row of results) {
                try {
                    // Try parsing as JSON first, otherwise keep it as a string
                    newOptions.set(row.key, JSON.parse(row.value));
                } catch {
                    newOptions.set(row.key, row.value);
                }
            }

            this.options = newOptions;
            this.lastUpdated = Date.now();
        } catch (e) {
            console.error('[OptionCache] Failed to refresh options:', e);
        }
    },

    get(key: string, defaultValue?: any): any {
        if (this.options.has(key)) {
            return this.options.get(key);
        }
        return defaultValue;
    }
};

// Initial load
optionCache.refresh().catch(console.error);
// Auto-refresh every minute to reflect dynamic changes
setInterval(() => optionCache.refresh().catch(console.error), 60000);
