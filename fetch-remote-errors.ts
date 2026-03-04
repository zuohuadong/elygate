import postgres from "postgres";

async function getLogs() {
    const url = "postgresql://dbuser_dba:DBUser.DBA@81.70.19.83:5432/postgres";
    const sql = postgres(url);
    try {
        console.log("Fetching recent errors from remote logs table...");
        const errors = await sql`
            SELECT created_at, method, path, status_code, error_message, ip
            FROM logs 
            WHERE status_code >= 400
            ORDER BY created_at DESC 
            LIMIT 10
        `;
        console.log("Recent Errors:");
        console.table(errors);

        console.log("\nChecking tokens table for last inserted row...");
        const lastToken = await sql`SELECT * FROM tokens ORDER BY id DESC LIMIT 1`;
        console.log("Last Token:", lastToken);

    } catch (e: any) {
        console.error("Query failed:", e.message);
    } finally {
        await sql.end();
        process.exit(0);
    }
}

getLogs();
