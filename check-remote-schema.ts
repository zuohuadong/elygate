import { sql } from "@elygate/db";

async function checkSchema() {
    try {
        console.log("Checking tokens table columns...");
        const columns = await sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'tokens'
        `;
        console.log("Tokens columns:", columns.map((c: any) => c.column_name).join(", "));

        console.log("\nChecking logs table columns...");
        const logColumns = await sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'logs'
        `;
        console.log("Logs columns:", logColumns.map((c: any) => c.column_name).join(", "));

        console.log("\nChecking materialized views...");
        const views = await sql`
            SELECT matviewname FROM pg_matviews;
        `;
        console.log("MatViews:", views.map((v: any) => v.matviewname).join(", "));

    } catch (e: any) {
        console.error("Schema check failed:", e.message);
    } finally {
        process.exit(0);
    }
}

checkSchema();
