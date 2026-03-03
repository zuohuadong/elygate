import { SQL } from "bun";

// Ensure DATABASE_URL is available for the native driver
const url = process.env.DATABASE_URL || 'postgresql://dbuser_dba:DBUser.DBA@localhost:5432/postgres';

/**
 * Export Native SQL connection pool instance
 * Explicitly passing the URL to ensure the Bun native driver uses the correct target.
 */
export const sql = new SQL(url);
export * from "./types";
