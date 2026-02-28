import { SQL } from "bun";

// Export Native SQL connection pool instance
// Automatically connects via DATABASE_URL in the environment
export const sql = new SQL();
export * from "./types";
