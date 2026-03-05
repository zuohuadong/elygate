// In Bun, SQL is a global, but can also be imported. 
// Using a runtime check to avoid build-time resolution errors in Vite/Node.
const BunSQL = (globalThis as any).Bun?.SQL;

// Ensure DATABASE_URL is available for the native driver
const rawUrl = process.env.DATABASE_URL || 'DATABASE_URL';
// Enable asynchronous commit for ultra-high throughput on logs/metrics
const url = new URL(rawUrl);
url.searchParams.set('options', '-c synchronous_commit=off');
const finalizedUrl = url.toString();

/**
 * Export Native SQL connection pool instance
 * Explicitly passing the URL to ensure the Bun native driver uses the correct target.
 */
export const sql = new (BunSQL || class { unsafe() { throw new Error("Bun.SQL not available"); } })(finalizedUrl);
export * from "./types";
