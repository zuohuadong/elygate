import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';
import { memoryCache } from '../services/cache';

/**
 * Admin Management APIs (CRUD for Channels, Tokens, Logs, Users)
 * Consumed by Svelte client or other management panels.
 */
export const adminRouter = new Elysia({ prefix: '/admin' })
    // Shared Auth Middleware: requires Bearer Token with admin privileges
    .use(authPlugin)
    .onBeforeHandle(({ user, set }: any) => {
        // Authorization Guard: Strict check allowing only role 10 (Super Admin)
        if (user.role !== 10) {
            set.status = 403;
            throw new Error("Forbidden: Admin privileges required");
        }
    })

    // --- Channel Management (Channels) ---
    .get('/channels', async () => {
        return await sql`SELECT * FROM channels ORDER BY id DESC`;
    })
    .post('/channels', async ({ body }: any) => {
        // Manually construct SQL for JSONB insertion (Bun SQL recommends template strings)
        const [result] = await sql`
            INSERT INTO channels (type, name, base_url, key, models, model_mapping, weight, status)
            VALUES (${body.type}, ${body.name}, ${body.baseUrl || null}, ${body.key}, 
                    ${body.models ? JSON.stringify(body.models) : '[]'}::jsonb, 
                    ${body.modelMapping ? JSON.stringify(body.modelMapping) : '{}'}::jsonb, 
                    ${body.weight || 1}, ${body.status || 1})
            RETURNING *
        `;
        memoryCache.refresh().catch(console.error); // Async cache refresh, non-blocking
        return result;
    })
    .put('/channels/:id', async ({ params: { id }, body }: any) => {
        const [result] = await sql`
            UPDATE channels 
            SET type = COALESCE(${body.type}, type), 
                name = COALESCE(${body.name}, name), 
                base_url = ${body.baseUrl || null}, 
                key = COALESCE(${body.key}, key), 
                models = COALESCE(${body.models ? JSON.stringify(body.models) : null}::jsonb, models),
                model_mapping = COALESCE(${body.modelMapping ? JSON.stringify(body.modelMapping) : null}::jsonb, model_mapping),
                weight = COALESCE(${body.weight}, weight),
                status = COALESCE(${body.status}, status)
            WHERE id = ${Number(id)}
            RETURNING *
        `;
        memoryCache.refresh().catch(console.error);
        return result;
    })
    .delete('/channels/:id', async ({ params: { id } }) => {
        const [result] = await sql`DELETE FROM channels WHERE id = ${Number(id)} RETURNING *`;
        memoryCache.refresh().catch(console.error);
        return { success: true, deleted: result };
    })

    // --- Token Management (Tokens) ---
    .get('/tokens', async () => {
        // Returns raw snake_case columns. Front-end adapts as needed.
        return await sql`SELECT * FROM tokens ORDER BY id DESC`;
    })
    .post('/tokens', async ({ body, user }: any) => {
        // Generate a random sk- key if not provided
        const key = body.key || `sk-${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('hex')}`;
        const [result] = await sql`
            INSERT INTO tokens (user_id, name, key, status, remain_quota)
            VALUES (${body.userId || user.id}, ${body.name}, ${key}, ${body.status || 1}, ${body.remainQuota || -1})
            RETURNING *
        `;
        return result;
    })
    .put('/tokens/:id', async ({ params: { id }, body }: any) => {
        const [result] = await sql`
            UPDATE tokens 
            SET name = COALESCE(${body.name}, name),
                status = COALESCE(${body.status}, status),
                remain_quota = COALESCE(${body.remainQuota}, remain_quota)
            WHERE id = ${Number(id)}
            RETURNING *
        `;
        return result;
    })
    .delete('/tokens/:id', async ({ params: { id } }) => {
        const [result] = await sql`DELETE FROM tokens WHERE id = ${Number(id)} RETURNING *`;
        return { success: true, deleted: result };
    })

    // --- Audit Logs (Logs) ---
    .get('/logs', async () => {
        // Fetch last 1000 logs in descending order
        return await sql`SELECT * FROM logs ORDER BY id DESC LIMIT 1000`;
    })

    // --- User Management (Users) ---
    .get('/users', async () => {
        // Exclude password_hash for safety
        return await sql`
            SELECT id, username, quota, used_quota AS "usedQuota", role, "group", status, created_at AS "createdAt"
            FROM users 
            ORDER BY id DESC
        `;
    })

    // --- Dashboard Stats ---
    .get('/dashboard/stats', async () => {
        const [stats] = await sql`
            SELECT 
                (SELECT count(*) FROM users)::int as "totalUsers",
                (SELECT count(*) FROM channels WHERE status = 1)::int as "activeChannels",
                (SELECT sum(quota) FROM users)::bigint as "totalQuota",
                (SELECT sum(used_quota) FROM users)::bigint as "usedQuota",
                (SELECT COALESCE(sum(quota_cost), 0) FROM logs WHERE created_at >= CURRENT_DATE)::bigint as "todayQuota"
        `;
        return stats;
    });
