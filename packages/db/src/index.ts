// In Bun, SQL is a global, but can also be imported. 
// Using a runtime check to avoid build-time resolution errors in Vite/Node.
const BunSQL = (globalThis as any).Bun?.SQL;

// Ensure DATABASE_URL is available for the native driver. Fallback to a dummy URL during build steps so it doesn't crash `new URL()`
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Critical: DATABASE_URL is missing in production environment.');
    }
    console.warn('⚠️  DATABASE_URL is missing. Using local development default.');
}
const finalizedRawUrl = rawUrl || 'postgresql://postgres:postgres@localhost:5432/elygate';
// Enable asynchronous commit for ultra-high throughput on logs/metrics
const url = new URL(finalizedRawUrl);
url.searchParams.set('options', '-c synchronous_commit=off');
const finalizedUrl = url.toString();

/**
 * Connection pool configuration optimized for PostgreSQL 18.3
 * - max: Increased pool size for better concurrency
 * - idle_timeout: Clean up idle connections after 30s
 * - connect_timeout: Fail fast on connection issues
 * - max_lifetime: Refresh connections periodically
 * - max_pipeline: Increase pipeline depth for batch operations
 */
const poolConfig = {
    max: parseInt(process.env.DB_POOL_SIZE || '20'),
    idle_timeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30'),
    connect_timeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10'),
    max_lifetime: parseInt(process.env.DB_MAX_LIFETIME || '1800'),
    max_pipeline: parseInt(process.env.DB_MAX_PIPELINE || '200'),
};

/**
 * Export Native SQL connection pool instance
 * Explicitly passing the URL and pool config to ensure the Bun native driver uses optimal settings.
 */
export const sql = new (BunSQL || class { unsafe() { throw new Error("Bun.SQL not available"); } })(finalizedUrl, poolConfig);
export * from "./types";
