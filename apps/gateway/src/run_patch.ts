import { sql } from "@elygate/db";
import { readFileSync } from "fs";

async function runPatch() {
    try {
        console.log("Applying patch_mj.sql...");
        const queries = readFileSync("../../packages/db/src/patch_mj.sql", "utf-8");
        await sql`${sql.unsafe(queries)}`;
        console.log("Successfully created mj_tasks table!");
        process.exit(0);
    } catch (e) {
        console.error("Failed to run patch:", e);
        process.exit(1);
    }
}

runPatch();
