import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { ChannelType } from '../providers/types';
import { OpenAIApiHandler } from '../providers/openai';
import { GeminiApiHandler } from '../providers/gemini';
import { AnthropicApiHandler } from '../providers/anthropic';
import { AzureOpenAIApiHandler } from '../providers/azure';
import { BaiduApiHandler } from '../providers/baidu';
import { AliApiHandler } from '../providers/ali';
import { XunfeiApiHandler } from '../providers/xunfei';
import { MidjourneyApiHandler } from '../providers/mj';

function getProviderHandler(type: number) {
    switch (type) {
        case ChannelType.GEMINI: return new GeminiApiHandler();
        case ChannelType.ANTHROPIC: return new AnthropicApiHandler();
        case ChannelType.AZURE: return new AzureOpenAIApiHandler();
        case ChannelType.BAIDU: return new BaiduApiHandler();
        case ChannelType.ALI: return new AliApiHandler();
        case ChannelType.XUNFEI: return new XunfeiApiHandler();
        case ChannelType.MIDJOURNEY: return new MidjourneyApiHandler();
        case ChannelType.OPENAI:
        default: return new OpenAIApiHandler();
    }
}

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
    .get('/channels/:id/models', async ({ params: { id } }) => {
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)}`;
        if (!channel) throw new Error("Channel not found");

        const handler = getProviderHandler(channel.type);
        const headers = handler.buildHeaders(channel.key);

        let url = channel.base_url;
        if (!url.endsWith('/')) url += '/';
        url += 'v1/models';

        const resp = await fetch(url, { headers });
        if (!resp.ok) throw new Error(`Upstream models API failed: ${resp.status}`);

        const data: any = await resp.json();
        const models = (data.data || []).map((m: any) => m.id);

        return {
            success: true,
            models
        };
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
    .get('/channels/:id/test', async ({ params: { id } }: any) => {
        // Find channel from DB
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) throw new Error("Channel not found");

        // Pick the first applicable model from the channel
        const modelsOpt = typeof channel.models === 'string' ? JSON.parse(channel.models) : channel.models;
        const testModel = (Array.isArray(modelsOpt) && modelsOpt.length > 0) ? modelsOpt[0] : 'gpt-3.5-turbo';

        const modelMappingOpt = typeof channel.model_mapping === 'string' ? JSON.parse(channel.model_mapping) : channel.model_mapping;
        const upstreamModel = (modelMappingOpt && modelMappingOpt[testModel]) ? modelMappingOpt[testModel] : testModel;

        const handler = getProviderHandler(channel.type);
        const bodyPayload = {
            model: testModel,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1
        };
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
            const endTime = Date.now();
            const latency = endTime - startTime;

            if (!res.ok) {
                throw new Error(`Upstream returned ${res.status}`);
            }

            // Update latency in database
            await sql`
                UPDATE channels 
                SET response_time = ${latency}, test_at = CURRENT_TIMESTAMP
                WHERE id = ${Number(id)}
            `;

            return { success: true, response_time: latency };
        } catch (e: any) {
            const endTime = Date.now();
            const latency = endTime - startTime;

            await sql`
                UPDATE channels 
                SET response_time = 0, test_at = CURRENT_TIMESTAMP
                WHERE id = ${Number(id)}
            `;

            throw new Error(`Test failed: ${e.message}. Latency: ${latency}ms`);
        }
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
            INSERT INTO tokens (user_id, name, key, status, remain_quota, models)
            VALUES (${body.userId || user.id}, ${body.name}, ${key}, ${body.status || 1}, ${body.remainQuota || -1}, ${JSON.stringify(body.models || [])})
            RETURNING *
        `;
        return result;
    })
    .put('/tokens/:id', async ({ params: { id }, body }: any) => {
        const [result] = await sql`
            UPDATE tokens 
            SET name = COALESCE(${body.name}, name),
                status = COALESCE(${body.status}, status),
                remain_quota = COALESCE(${body.remainQuota}, remain_quota),
                models = COALESCE(${body.models ? JSON.stringify(body.models) : null}, models)
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
    })
    .get('/stats/granular', async ({ query }) => {
        const { start, end, group_by } = query as any;
        const startDate = start ? new Date(start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const endDate = end ? new Date(end) : new Date();

        let groupByClause = sql`EXTRACT(DAY FROM created_at)`;
        if (group_by === 'model') groupByClause = sql`model_name`;
        if (group_by === 'channel') groupByClause = sql`channel_id`;

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

    // --- Redemptions (CDK) ---
    .get('/redemptions', async () => {
        return await sql`SELECT * FROM redemptions ORDER BY id DESC`;
    })
    .post('/redemptions', async ({ body }: any) => {
        const count = body.count || 1;
        const quota = body.quota || 500000;

        let generated = [];
        for (let i = 0; i < count; i++) {
            // Generate a random CDK: e.g., elygate-xxxxx
            const randomHex = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('hex');
            const code = `elygate-${randomHex}`;

            const [result] = await sql`
                INSERT INTO redemptions (code, quota, status)
                VALUES (${code}, ${quota}, 1)
                RETURNING *
            `;
            generated.push(result);
        }

        return { success: true, generated };
    });
