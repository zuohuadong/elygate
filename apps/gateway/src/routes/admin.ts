import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { adminGuard } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { getProviderHandler } from '../providers';
import { ChannelType } from '../types';

// Admin Router - prefix will be applied in index.ts
export const adminRouter = new Elysia()
    .use(adminGuard)
    // --- Channel Management (Channels) ---
    .get('/channels', async () => {
        const channels = await sql`
            SELECT id, name, type, models, priority, weight, status, created_at, updated_at
            FROM channels 
            ORDER BY priority DESC, id DESC
        `;
        return channels;
    })

    .post('/channels', async ({ body, set }: any) => {
        try {
            const b = body as any;
            const [result] = await sql`
                INSERT INTO channels (name, type, key, base_url, models, priority, weight, status)
                VALUES (${b.name}, ${b.type}, ${b.key}, ${b.baseUrl}, ${JSON.stringify(b.models)}, ${b.priority || 0}, ${b.weight || 1}, 1)
                RETURNING *
            `;
            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    }, {
        body: t.Object({
            name: t.String(),
            type: t.String(),
            key: t.String(),
            baseUrl: t.String(),
            models: t.Array(t.String()),
            priority: t.Optional(t.Number()),
            weight: t.Optional(t.Number())
        })
    })

    .put('/channels/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as any;
            const [result] = await sql`
                UPDATE channels 
                SET name = COALESCE(${b.name}, name),
                    type = COALESCE(${b.type}, type),
                    key = COALESCE(${b.key}, key),
                    base_url = COALESCE(${b.baseUrl}, base_url),
                    models = COALESCE(${b.models ? JSON.stringify(b.models) : null}, models),
                    priority = COALESCE(${b.priority}, priority),
                    weight = COALESCE(${b.weight}, weight),
                    status = COALESCE(${b.status}, status),
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .delete('/channels/:id', async ({ params: { id }, set }: any) => {
        try {
            await sql`DELETE FROM channels WHERE id = ${Number(id)}`;
            return { success: true };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .post('/channels/:id/test', async ({ params: { id } }: any) => {
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) throw new Error("Channel not found");

        const modelsOpt = typeof channel.models === 'string' ? JSON.parse(channel.models) : channel.models;
        const testModel = (Array.isArray(modelsOpt) && modelsOpt.length > 0) ? modelsOpt[0] : 'gpt-3.5-turbo';

        const handler = getProviderHandler(channel.type);
        const bodyPayload = {
            model: testModel,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1
        };
        const upstreamModel = testModel; // Simplified for test
        const transformedBody = handler.transformRequest(bodyPayload, upstreamModel);

        const keys = channel.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
        const testKey = keys[0] || '';
        const fetchHeaders = handler.buildHeaders(testKey);

        let testUrl = `${channel.base_url || 'https://api.openai.com'}/v1/chat/completions`;
        if (channel.type === ChannelType.GEMINI) {
            testUrl = `${channel.base_url || 'https://generativelanguage.googleapis.com'}/v1beta/models/${upstreamModel}:generateContent`;
        }

        const startTime = Date.now();
        try {
            const res = await fetch(testUrl, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify(transformedBody)
            });
            const latency = Date.now() - startTime;

            if (!res.ok) throw new Error(`Upstream returned ${res.status}`);

            await sql`UPDATE channels SET response_time = ${latency}, test_at = NOW() WHERE id = ${Number(id)}`;
            return { success: true, response_time: latency };
        } catch (e: any) {
            await sql`UPDATE channels SET response_time = 0, test_at = NOW() WHERE id = ${Number(id)}`;
            throw e;
        }
    })

    // --- Token Management ---
    .get('/tokens', async () => {
        const tokens = await sql`
            SELECT t.*, u.username as creator_name
            FROM tokens t
            LEFT JOIN users u ON t.user_id = u.id
            ORDER BY t.id DESC
        `;
        return tokens;
    })

    .post('/tokens', async ({ body, user, set }: any) => {
        try {
            const b = body as any;
            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            const [result] = await sql`
                INSERT INTO tokens (user_id, name, key, status, remain_quota, models)
                VALUES (${b.userId || user.id}, ${b.name}, ${newKey}, 1, ${b.remainQuota || -1}, ${JSON.stringify(b.models || [])})
                RETURNING *
            `;
            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .put('/tokens/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as any;
            const [result] = await sql`
                UPDATE tokens 
                SET name = COALESCE(${b.name}, name),
                    status = COALESCE(${b.status}, status),
                    remain_quota = COALESCE(${b.remainQuota}, remain_quota),
                    models = COALESCE(${b.models ? JSON.stringify(b.models) : null}, models)
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .delete('/tokens/:id', async ({ params: { id }, set }: any) => {
        try {
            await sql`DELETE FROM tokens WHERE id = ${Number(id)}`;
            return { success: true };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    // --- User Management ---
    .get('/users', async () => {
        const users = await sql`
            SELECT id, username, role, quota, used_quota as "usedQuota", status, created_at, updated_at
            FROM users 
            ORDER BY id DESC
        `;
        return users;
    })

    .post('/users', async ({ body, set }: any) => {
        try {
            const b = body as any;
            const passwordHash = await Bun.password.hash(b.password);
            const [result] = await sql`
                INSERT INTO users (username, password_hash, role, quota, status)
                VALUES (${b.username}, ${passwordHash}, ${b.role || 1}, ${b.quota || 0}, 1)
                RETURNING id, username, role, quota, status
            `;
            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .put('/users/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as any;
            let passwordClause = sql``;
            if (b.password) {
                const hash = await Bun.password.hash(b.password);
                passwordClause = sql`, password_hash = ${hash}`;
            }

            const [result] = await sql`
                UPDATE users 
                SET username = COALESCE(${b.username}, username),
                    role = COALESCE(${b.role}, role),
                    quota = COALESCE(${b.quota}, quota),
                    status = COALESCE(${b.status}, status),
                    updated_at = NOW()
                    ${passwordClause}
                WHERE id = ${Number(id)}
                RETURNING id, username, role, quota, status
            `;
            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .delete('/users/:id', async ({ params: { id } }) => {
        await sql`DELETE FROM users WHERE id = ${Number(id)}`;
        return { success: true };
    })

    // --- Logs (Admin View) ---
    .get('/logs', async ({ query }: any) => {
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        const [countRow] = await sql`SELECT COUNT(*) as total FROM logs`;
        const data = await sql`
            SELECT l.*, u.username as creator_name
            FROM logs l
            LEFT JOIN users u ON l.user_id = u.id
            ORDER BY l.created_at DESC 
            LIMIT ${limit} OFFSET ${offset}
        `;

        return {
            data,
            total: countRow.total,
            page,
            limit
        };
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
    })

    .get('/stats/granular', async ({ query }) => {
        const { start, end, group_by } = query as any;
        const startDate = start ? new Date(start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const endDate = end ? new Date(end) : new Date();

        let groupByClause = sql`DATE(created_at)`;
        if (group_by === 'model') groupByClause = sql`model_name`;

        const stats = await sql`
            SELECT 
                ${groupByClause} as label,
                SUM(prompt_tokens) as prompt_tokens,
                SUM(completion_tokens) as completion_tokens,
                COUNT(*) as count
            FROM logs
            WHERE created_at BETWEEN ${startDate} AND ${endDate}
            GROUP BY 1
            ORDER BY 1 ASC
        `;
        return stats;
    })

    // --- Models List ---
    .get('/models', () => {
        const uniqueModels = Array.from(memoryCache.channelRoutes.keys());
        return uniqueModels.map(model => ({
            id: model,
            name: model,
            object: 'model'
        }));
    })

    // --- Redemptions (CDK) ---
    .get('/redemptions', async () => {
        return await sql`SELECT * FROM redemptions ORDER BY id DESC`;
    })

    .post('/redemptions', async ({ body, set }: any) => {
        try {
            const b = body as any;
            const key = b.key || `cdk-${Bun.randomUUIDv7('hex')}`;
            const [result] = await sql`
                INSERT INTO redemptions (name, key, quota, count, status)
                VALUES (${b.name}, ${key}, ${b.quota}, ${b.count || 1}, 1)
                RETURNING *
            `;
            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .put('/redemptions/:id', async ({ params: { id }, body }: any) => {
        const [result] = await sql`
            UPDATE redemptions 
            SET name = COALESCE(${body.name}, name),
                key = COALESCE(${body.key}, key),
                quota = COALESCE(${body.quota}, quota),
                count = COALESCE(${body.count}, count),
                status = COALESCE(${body.status}, status)
            WHERE id = ${Number(id)}
            RETURNING *
        `;
        return result;
    })

    .delete('/redemptions/:id', async ({ params: { id } }) => {
        await sql`DELETE FROM redemptions WHERE id = ${Number(id)}`;
        return { success: true };
    })

    // --- System Options ---
    .get('/options', async () => {
        const rows = await sql`SELECT key, value FROM options`;
        const options: Record<string, string> = {};
        for (const r of rows) options[r.key] = r.value;
        return options;
    })

    .put('/options', async ({ body }: any) => {
        const payload = body as Record<string, string>;
        for (const [key, value] of Object.entries(payload)) {
            await sql`
                INSERT INTO options (key, value)
                VALUES (${key}, ${value})
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            `;
        }
        memoryCache.refresh().catch(console.error);
        return { success: true };
    });
