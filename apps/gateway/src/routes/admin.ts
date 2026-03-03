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
    // Direct Authentication Hook - Use .derive to add 'user' to context without short-circuiting
    .derive(async ({ request, set }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            set.status = 401;
            throw new Error('Missing or invalid Authorization header');
        }

        const apiKey = authHeader.substring(7);
        const [userRow] = await sql`
            SELECT u.id, u.username, u.role, u.status
            FROM tokens t
            JOIN users u ON t.user_id = u.id
            WHERE t.key = ${apiKey} AND t.status = 1 AND u.status = 1
            LIMIT 1
        `;

        if (!userRow) {
            set.status = 401;
            throw new Error('Invalid API key or token expired');
        }

        console.log(`[Admin] Auth success for ${userRow.username}, Path: ${new URL(request.url).pathname}`);

        if (userRow.role !== 10) {
            set.status = 403;
            throw new Error("Forbidden: Admin privileges required");
        }

        return { user: userRow };
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
        // Generate a random sk- key using Bun native UUID v7
        const key = body.key || `sk-${Bun.randomUUIDv7('hex')}`;
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
    .post('/users', async ({ body }: any) => {
        let passwordHash = '';
        if (body.password) {
            passwordHash = await Bun.password.hash(body.password, { algorithm: "argon2id" });
        }
        const [result] = await sql`
            INSERT INTO users (username, password_hash, role, quota, "group", status)
            VALUES (${body.username}, ${passwordHash}, ${body.role || 1}, ${body.quota || 0}, ${body.group || 'default'}, ${body.status || 1})
            RETURNING id, username, quota, used_quota AS "usedQuota", role, "group", status, created_at AS "createdAt"
        `;
        return result;
    })
    .put('/users/:id', async ({ params: { id }, body }: any) => {
        let updatePasswordSql = sql``;
        if (body.password) {
            const hash = await Bun.password.hash(body.password, { algorithm: "argon2id" });
            updatePasswordSql = sql`, password_hash = ${hash}`;
        }
        const [result] = await sql`
            UPDATE users 
            SET username = COALESCE(${body.username}, username),
                role = COALESCE(${body.role}, role),
                quota = COALESCE(${body.quota}, quota),
                "group" = COALESCE(${body.group}, "group"),
                status = COALESCE(${body.status}, status)
                ${updatePasswordSql}
            WHERE id = ${Number(id)}
            RETURNING id, username, quota, used_quota AS "usedQuota", role, "group", status, created_at AS "createdAt"
        `;
        return result;
    })
    .delete('/users/:id', async ({ params: { id } }) => {
        const [result] = await sql`DELETE FROM users WHERE id = ${Number(id)} RETURNING id`;
        return { success: true, deleted: result };
    })

    // --- System Options (Settings) ---
    .get('/options', async () => {
        const rows = await sql`SELECT key, value FROM options`;
        // Convert array of {key, value} to a single record object
        const settings: Record<string, string> = {};
        for (const r of rows) settings[r.key] = r.value;
        return settings;
    })
    .put('/options', async ({ body }: any) => {
        // body is a key-value record
        const updates = Object.entries(body).map(([key, value]) =>
            sql`INSERT INTO options (key, value) VALUES (${key}, ${String(value)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
        );
        if (updates.length > 0) {
            await Promise.all(updates);
            memoryCache.refresh().catch(console.error);
        }
        return { success: true };
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
    .get('/dashboard/errors', async () => {
        // Real anomaly monitoring: Group 4xx/5xx errors by message and IP in last 24h
        return await sql`
            SELECT 
                error_message as title, 
                ip, 
                count(*)::int as count 
            FROM logs 
            WHERE created_at >= NOW() - INTERVAL '24 hours' 
              AND status_code >= 400
            GROUP BY error_message, ip
            ORDER BY count DESC
            LIMIT 10
        `;
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
        const count = body.count ? parseInt(body.count, 10) : 1;
        const quota = body.quota ? parseInt(body.quota, 10) : 500000;
        const name = body.name || 'Redemption Code';

        // Generate CDKs using Bun.randomUUIDv7
        const codesToGenerate = body.key ? [body.key] : Array.from({ length: 1 }, () => `elygate-${Bun.randomUUIDv7('hex').slice(0, 24)}`);

        const generated = await Promise.all(
            codesToGenerate.map((key: string) => sql`
                INSERT INTO redemptions (name, key, quota, count, status)
                VALUES (${name}, ${key}, ${quota}, ${count}, 1)
                RETURNING *
            `.then(([r]) => r))
        );

        return generated.length === 1 ? generated[0] : { success: true, generated };
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
        const [result] = await sql`DELETE FROM redemptions WHERE id = ${Number(id)} RETURNING id`;
        return { success: true, deleted: result };
    });
