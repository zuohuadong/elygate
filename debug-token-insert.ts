import { sql } from "@elygate/db";

async function testInsert() {
    try {
        const testToken = {
            userId: 1,
            name: "Debug Token",
            key: "sk-debug-" + Math.random().toString(36).substring(7),
            status: 1,
            remainQuota: -1,
            models: []
        };

        console.log("Attempting insert...");
        const [result] = await sql`
            INSERT INTO tokens (user_id, name, key, status, remain_quota, models)
            VALUES (${testToken.userId}, ${testToken.name}, ${testToken.key}, ${testToken.status}, ${testToken.remainQuota}, ${JSON.stringify(testToken.models)})
            RETURNING *
        `;
        console.log("Insert success:", result);
    } catch (e: any) {
        console.error("Insert failed with error:", e.message);
        if (e.detail) console.error("Detail:", e.detail);
        if (e.hint) console.error("Hint:", e.hint);
    } finally {
        process.exit(0);
    }
}

testInsert();
