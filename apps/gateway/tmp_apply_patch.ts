import { sql } from '@elygate/db';

async function main() {
    try {
        console.log("Applying patch...");
        await sql`UPDATE user_groups 
            SET denied_models = '["*"]', 
                allowed_models = '["qwen*", "glm*", "chatglm*", "cogview*", "ernie*", "eb*", "moonshot*", "kimi*", "deepseek*", "doubao*", "hunyuan*", "minimax*", "abab*", "spark*", "yi*", "step*", "baichuan*"]'
            WHERE key = 'cn-safe'`;
        console.log("Patch applied successfully!");

        console.log("Notifying gateways to refresh cache...");
        await sql`NOTIFY refresh_cache, 'refresh_cache'`;
        console.log("Notification sent!");
        
        // Let's verify the group configuration
        const [group] = await sql`SELECT * FROM user_groups WHERE key = 'cn-safe'`;
        console.log("Current cn-safe policy:", group);

    } catch(err) {
        console.error("Error applying patch:", err);
    } finally {
        try { await sql.end(); } catch(e) {}
        try { await sql.close(); } catch(e) {}
        process.exit(0);
    }
}

main();
