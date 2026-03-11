import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { adminGuard } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { quotaToUSD, quotaToRMB } from '../services/ratio';
import { getProviderHandler } from '../providers';
import { ChannelType } from '../types';
import { getLangFromHeader, getLangFromQuery } from '../utils/i18n';
import { join } from 'path';
import { encryptChannelKeys, decryptChannelKeys } from '../services/encryption';
import { getAuditLogs } from '../services/auditLog';
import { optionCache } from '../services/optionCache';

// Load model configurations via top-level await (Bun native feature)
let modelConfig: any = { anthropic: { models: [] } };
try {
    const configPath = join(process.cwd(), 'apps/gateway/config/models.json');
    const file = Bun.file(configPath);
    if (await file.exists()) {
        modelConfig = await file.json();
    }
} catch (error) {
    console.error('[ModelConfig] Failed to load model config:', error);
}

// Admin Router - prefix will be applied in index.ts
export const adminRouter = new Elysia()
    .use(adminGuard)

    // --- User Groups / Policies Management ---
    .get('/user-groups', async () => {
        const groups = await sql`SELECT * FROM user_groups ORDER BY created_at DESC`;
        return groups;
    })
    .post('/user-groups', async ({ body, set }: any) => {
        try {
            const b = body as any;
            const [result] = await sql`
                INSERT INTO user_groups (key, name, description, allowed_channel_types, denied_channel_types, allowed_models, denied_models, allowed_packages, status)
                VALUES (${b.key}, ${b.name}, ${b.description || ''}, ${b.allowedChannelTypes ? JSON.stringify(b.allowedChannelTypes) : '[]'}, ${b.deniedChannelTypes ? JSON.stringify(b.deniedChannelTypes) : '[]'}, ${b.allowedModels ? JSON.stringify(b.allowedModels) : '[]'}, ${b.deniedModels ? JSON.stringify(b.deniedModels) : '[]'}, ${b.allowedPackages ? JSON.stringify(b.allowedPackages) : '[]'}, ${b.status || 1})
                RETURNING *
            `;
            await memoryCache.refresh();
            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    }, {
        body: t.Object({
            key: t.String(),
            name: t.String(),
            description: t.Optional(t.String()),
            allowedChannelTypes: t.Optional(t.Array(t.Number())),
            deniedChannelTypes: t.Optional(t.Array(t.Number())),
            allowedModels: t.Optional(t.Array(t.String())),
            deniedModels: t.Optional(t.Array(t.String())),
            allowedPackages: t.Optional(t.Array(t.Number())),
            status: t.Optional(t.Number())
        })
    })
    .put('/user-groups/:key', async ({ params: { key }, body, set }: any) => {
        try {
            const b = body as any;
            const [oldGroup] = await sql`SELECT * FROM user_groups WHERE key = ${key} LIMIT 1`;
            if (!oldGroup) {
                set.status = 404;
                return { success: false, message: 'Group not found' };
            }

            const [result] = await sql`
                UPDATE user_groups 
                SET name = ${b.name ?? oldGroup.name},
                    description = ${b.description ?? oldGroup.description},
                    allowed_channel_types = ${b.allowedChannelTypes ? JSON.stringify(b.allowedChannelTypes) : oldGroup.allowed_channel_types},
                    denied_channel_types = ${b.deniedChannelTypes ? JSON.stringify(b.deniedChannelTypes) : oldGroup.denied_channel_types},
                    allowed_models = ${b.allowedModels ? JSON.stringify(b.allowedModels) : oldGroup.allowed_models},
                    denied_models = ${b.deniedModels ? JSON.stringify(b.deniedModels) : oldGroup.denied_models},
                    allowed_packages = ${b.allowedPackages ? JSON.stringify(b.allowedPackages) : oldGroup.allowed_packages},
                    status = ${b.status ?? oldGroup.status},
                    updated_at = NOW()
                WHERE key = ${key}
                RETURNING *
            `;
            await memoryCache.refresh();
            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })
    .delete('/user-groups/:key', async ({ params: { key }, set }: any) => {
        try {
            if (key === 'default') {
                set.status = 400;
                return { success: false, message: 'Cannot delete system default groups' };
            }
            const [userDep] = await sql`SELECT id FROM users WHERE "group" = ${key} LIMIT 1`;
            if (userDep) {
                set.status = 400;
                return { success: false, message: 'Cannot delete group with active users' };
            }
            await sql`DELETE FROM user_groups WHERE key = ${key}`;
            await memoryCache.refresh();
            return { success: true };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    // --- Channel Management (Channels) ---
    .get('/channels', async () => {
        const channels = await sql`
            SELECT id, name, type, key, base_url AS "baseUrl", models, model_mapping AS "modelMapping", priority, weight, groups, status, 
                   key_strategy AS "keyStrategy", key_status AS "keyStatus", price_ratio AS "priceRatio", created_at, 
                   (SELECT updated_at FROM channels c2 WHERE c2.id = channels.id) as updated_at
            FROM channels 
            ORDER BY id DESC
        `;
        return channels.map((c: any) => ({
            ...c,
            key: decryptChannelKeys(c.key)
        }));
    })

    .post('/channels', async ({ body, set }: any) => {
        try {
            const b = body as any;
            const encryptedKey = encryptChannelKeys(b.key);
            const [result] = await sql`
                INSERT INTO channels (name, type, key, base_url, models, priority, weight, status, key_strategy, key_status, price_ratio, key_concurrency_limit)
                VALUES (${b.name}, ${b.type}, ${encryptedKey}, ${b.baseUrl}, ${b.models}, ${b.priority || 0}, ${b.weight || 1}, 1, ${b.keyStrategy || 0}, '{}'::jsonb, ${b.priceRatio || 1.0}, ${b.keyConcurrencyLimit || 0})
                RETURNING *
            `;
            await memoryCache.refresh();
            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    }, {
        body: t.Object({
            name: t.String(),
            type: t.Number(),
            key: t.String(),
            baseUrl: t.String(),
            models: t.Array(t.String()),
            priority: t.Optional(t.Number()),
            weight: t.Optional(t.Number()),
            keyStrategy: t.Optional(t.Number()),
            priceRatio: t.Optional(t.Number()),
            keyConcurrencyLimit: t.Optional(t.Number())
        })
    })

    .put('/channels/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as any;
            const [oldChannel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
            if (!oldChannel) {
                set.status = 404;
                return { success: false, message: 'Channel not found' };
            }

            // Ensure models is a clean JSON array string
            let finalModels = oldChannel.models;
            if (b.models !== undefined) {
                finalModels = Array.isArray(b.models) ? JSON.stringify(b.models) : b.models;
            }

            // Encrypt key if it's being updated
            let finalKey = oldChannel.key;
            if (b.key !== undefined && b.key !== oldChannel.key) {
                finalKey = encryptChannelKeys(b.key);
            }

            const [result] = await sql`
                UPDATE channels 
                SET name = ${b.name ?? oldChannel.name},
                    type = ${b.type ?? oldChannel.type},
                    key = ${finalKey},
                    base_url = ${b.baseUrl ?? oldChannel.base_url},
                    models = ${b.models ?? oldChannel.models},
                    priority = ${b.priority ?? oldChannel.priority},
                    weight = ${b.weight ?? oldChannel.weight},
                    status = ${b.status ?? oldChannel.status},
                    key_strategy = ${b.keyStrategy ?? oldChannel.key_strategy},
                    key_status = ${b.keyStatus ? JSON.stringify(b.keyStatus) : oldChannel.key_status},
                    price_ratio = ${b.priceRatio ?? oldChannel.price_ratio},
                    key_concurrency_limit = ${b.keyConcurrencyLimit ?? oldChannel.key_concurrency_limit},
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            await memoryCache.refresh();
            return {
                ...result,
                key: decryptChannelKeys(result.key)
            };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .delete('/channels/:id', async ({ params: { id }, set }: any) => {
        try {
            await sql`DELETE FROM channels WHERE id = ${Number(id)}`;
            await memoryCache.refresh();
            return { success: true };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .post('/channels/batch', async ({ body, set }: any) => {
        try {
            const channels = body as any[];
            const results = [];

            for (const ch of channels) {
                try {
                    const encryptedKey = encryptChannelKeys(ch.key);
                    const [result] = await sql`
                        INSERT INTO channels (name, type, key, base_url, models, priority, weight, status, key_strategy, key_status, price_ratio)
                        VALUES (${ch.name}, ${ch.type}, ${encryptedKey}, ${ch.baseUrl}, ${ch.models}, ${ch.priority || 0}, ${ch.weight || 1}, ${ch.status || 1}, ${ch.keyStrategy || 0}, '{}'::jsonb, ${ch.priceRatio || 1.0})
                        RETURNING id, name, type, base_url, models, status
                    `;
                    results.push({ success: true, channel: result });
                } catch (e: any) {
                    results.push({ success: false, name: ch.name, error: e.message });
                }
            }

            await memoryCache.refresh();
            return {
                success: true,
                total: channels.length,
                imported: results.filter((r: any) => r.success).length,
                failed: results.filter((r: any) => !r.success).length,
                results
            };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    }, {
        body: t.Array(t.Object({
            name: t.String(),
            type: t.Number(),
            key: t.String(),
            baseUrl: t.String(),
            models: t.Array(t.String()),
            priority: t.Optional(t.Number()),
            weight: t.Optional(t.Number()),
            status: t.Optional(t.Number()),
            keyStrategy: t.Optional(t.Number()),
            priceRatio: t.Optional(t.Number())
        }))
    })

    .post('/channels/:id/sync-models', async ({ params: { id }, set }: any) => {
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) return (set.status = 404, { success: false, message: 'Channel not found' });

        const handler = getProviderHandler(channel.type);
        const testKey = decryptChannelKeys(channel.key).split('\n').find(Boolean) || '';
        const baseUrl = channel.base_url || 'https://api.openai.com';
        const modelsUrl = channel.type === ChannelType.GEMINI ? `${baseUrl}/v1beta/models` : `${baseUrl}/v1/models`;

        const res = await fetch(modelsUrl, { headers: handler.buildHeaders(testKey) });
        if (!res.ok) return (set.status = 500, { success: false, message: `Failed: ${res.status}` });

        const data = await res.json();
        const models = channel.type === ChannelType.GEMINI
            ? data.models?.map((m: any) => m.name?.replace('models/', '') || m.displayName).filter(Boolean) || []
            : data.data?.map((m: any) => m.id).filter(Boolean) || data.map?.((m: any) => m.id || m.name).filter(Boolean) || [];

        const [result] = await sql`UPDATE channels SET models = ${models}, updated_at = NOW() WHERE id = ${Number(id)} RETURNING *`;
        await memoryCache.refresh();
        return { success: true, modelsCount: models.length, channel: result };
    })

    .post('/channels/:id/keys/clean', async ({ params: { id }, set }: any) => {
        try {
            const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
            if (!channel) {
                set.status = 404;
                return { success: false, message: 'Channel not found' };
            }

            const keys = channel.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
            const statusMap = channel.key_status || {};

            // Filter out exhausted keys
            const activeKeys = keys.filter((k: string) => statusMap[k] !== 'exhausted');
            const newKeyString = activeKeys.join('\n');

            // Clean up status map
            const newStatusMap: Record<string, string> = {};
            for (const k of activeKeys) {
                if (statusMap[k]) newStatusMap[k] = statusMap[k];
            }

            const [result] = await sql`
                UPDATE channels 
                SET key = ${newKeyString},
                    key_status = ${JSON.stringify(newStatusMap)},
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            await memoryCache.refresh();
            return {
                success: true,
                removedCount: keys.length - activeKeys.length,
                channel: result
            };
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

        // Decrypt keys before use
        const decryptedKeys = decryptChannelKeys(channel.key);
        const keys = decryptedKeys.split('\n').map((k: string) => k.trim()).filter(Boolean);
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

            await sql`UPDATE channels SET response_time = ${latency}, test_at = NOW() WHERE id = ${Number(id)}`;
            await memoryCache.refresh();
            return { success: true, response_time: latency };
        } catch (e: any) {
            await sql`UPDATE channels SET response_time = 0, test_at = NOW() WHERE id = ${Number(id)}`;
            await memoryCache.refresh();
            throw e;
        }
    })

    // Fetch models from upstream channel
    .get('/channels/:id/models', async ({ params: { id }, set }: any) => {
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }

        const handler = getProviderHandler(channel.type);

        // Anthropic doesn't have a models endpoint, return from config
        if (channel.type === ChannelType.ANTHROPIC) {
            const anthropicModels = modelConfig.anthropic?.models?.map((m: any) => m.id) || [];
            return {
                success: true,
                models: anthropicModels,
                total: anthropicModels.length,
                last_updated: modelConfig.anthropic?.last_updated
            };
        }

        // Decrypt keys before use
        const decryptedKeys = decryptChannelKeys(channel.key);
        const keys = decryptedKeys.split('\n').map((k: string) => k.trim()).filter(Boolean);
        const testKey = keys[0] || '';
        const fetchHeaders = handler.buildHeaders(testKey);

        // Construct models URL based on channel type
        const baseUrl = channel.base_url || 'https://api.openai.com';
        let modelsUrl = `${baseUrl}/v1/models`;

        // For Gemini, use different endpoint
        if (channel.type === ChannelType.GEMINI) {
            modelsUrl = `${baseUrl}/v1beta/models`;
        }

        try {
            const response = await fetch(modelsUrl, {
                method: 'GET',
                headers: fetchHeaders
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch models: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            // Parse models based on provider type
            let models: string[] = [];

            if (channel.type === ChannelType.GEMINI) {
                // Gemini format: { models: [{ name: "models/gemini-pro", ... }] }
                if (data.models && Array.isArray(data.models)) {
                    models = data.models
                        .map((m: any) => m.name?.replace('models/', '') || m.displayName)
                        .filter(Boolean);
                }
            } else {
                // OpenAI format: { data: [{ id: "gpt-4", ... }] }
                if (data.data && Array.isArray(data.data)) {
                    models = data.data.map((m: any) => m.id).filter(Boolean);
                } else if (Array.isArray(data)) {
                    // Some providers return array directly
                    models = data.map((m: any) => m.id || m.name).filter(Boolean);
                }
            }

            return {
                success: true,
                models,
                total: models.length
            };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
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
                VALUES (${b.userId || user.id}, ${b.name}, ${newKey}, 1, ${b.remainQuota || -1}, ${Array.isArray(b.models) ? JSON.stringify(b.models) : JSON.stringify(b.models || [])})
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
            const [oldToken] = await sql`SELECT * FROM tokens WHERE id = ${Number(id)} LIMIT 1`;
            if (!oldToken) {
                set.status = 404;
                return { success: false, message: 'Token not found' };
            }

            let finalModels = oldToken.models;
            if (b.models !== undefined) {
                finalModels = Array.isArray(b.models) ? JSON.stringify(b.models) : b.models;
            }

            const [result] = await sql`
                UPDATE tokens 
                SET name = ${b.name ?? oldToken.name},
                    status = ${b.status ?? oldToken.status},
                    remain_quota = ${b.remainQuota ?? oldToken.remain_quota},
                    models = ${finalModels}
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .post('/tokens/:id/regenerate', async ({ params: { id }, set }: any) => {
        try {
            const [oldToken] = await sql`SELECT * FROM tokens WHERE id = ${Number(id)} LIMIT 1`;
            if (!oldToken) {
                set.status = 404;
                return { success: false, message: 'Token not found' };
            }

            const newKey = `sk-${Bun.randomUUIDv7('hex')}`;
            const [result] = await sql`
                UPDATE tokens 
                SET key = ${newKey},
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;

            return {
                success: true,
                message: 'Token key regenerated successfully',
                token: result
            };
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
            const defaultCurrency = optionCache.get('CurrencyName', 'USD');
            const [result] = await sql`
                INSERT INTO users (username, password_hash, role, quota, status, currency)
                VALUES (${b.username}, ${passwordHash}, ${b.role || 1}, ${b.quota || 0}, 1, ${defaultCurrency})
                RETURNING id, username, role, quota, status, currency
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

            // Notify auth cache to flush tokens for this user
            const tokens = await sql`SELECT key FROM tokens WHERE user_id = ${Number(id)}`;
            for (const t of tokens) {
                await sql`SELECT pg_notify('auth_update', ${t.key})`;
            }

            return result;
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .delete('/users/:id', async ({ params: { id }, user, set, request }: any) => {
        const lang = getLangFromHeader(request.headers.get('accept-language'));

        // Prevent admin from deleting themselves
        if (Number(id) === user.id) {
            set.status = 400;
            return { success: false, message: lang === 'zh' ? '不能删除自己的账户' : 'Cannot delete your own account' };
        }

        // Prevent deleting the last admin
        const [adminCount] = await sql`SELECT COUNT(*) as count FROM users WHERE role >= 10 AND status = 1`;
        const [targetUser] = await sql`SELECT role FROM users WHERE id = ${Number(id)}`;

        if (targetUser && targetUser.role >= 10 && Number(adminCount.count) <= 1) {
            set.status = 400;
            return { success: false, message: lang === 'zh' ? '不能删除最后一个管理员账户' : 'Cannot delete the last admin account' };
        }

        await sql`DELETE FROM users WHERE id = ${Number(id)}`;
        return { success: true, message: lang === 'zh' ? '删除成功' : 'Deleted successfully' };
    })

    // --- Logs (Admin View) ---
    .get('/logs', async ({ query }: any) => {
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        const userId = query?.user_id;
        const channelId = query?.channel_id;
        const modelName = query?.model;
        const statusCode = query?.status_code;
        const search = query?.keyword;

        let whereClause = sql`WHERE 1=1`;
        if (userId) whereClause = sql`${whereClause} AND user_id = ${Number(userId)}`;
        if (channelId) whereClause = sql`${whereClause} AND channel_id = ${Number(channelId)}`;
        if (modelName) whereClause = sql`${whereClause} AND model_name = ${modelName}`;
        if (statusCode) whereClause = sql`${whereClause} AND status_code = ${Number(statusCode)}`;
        if (search) whereClause = sql`${whereClause} AND (prompt ILIKE ${'%' + search + '%'} OR response ILIKE ${'%' + search + '%'} OR error_message ILIKE ${'%' + search + '%'})`;

        const [countRow] = await sql`SELECT COUNT(*) as total FROM logs ${whereClause}`;
        const data = await sql`
            SELECT l.*, u.username as creator_name
            FROM logs l
            LEFT JOIN users u ON l.user_id = u.id
            ${whereClause}
            ORDER BY l.created_at DESC 
            LIMIT ${limit} OFFSET ${offset}
        `;

        return {
            data: data.map((l: any) => ({
                ...l,
                cost_usd: quotaToUSD(l.quota_cost),
                cost_rmb: quotaToRMB(l.quota_cost),
                cached_tokens: l.cached_tokens || 0
            })),
            total: countRow.total,
            page,
            limit
        };
    })

    .get('/logs/export', async ({ query, set }: any) => {
        const userId = query?.user_id;
        const channelId = query?.channel_id;
        const modelName = query?.model;
        const statusCode = query?.status_code;
        const search = query?.keyword;
        const format = query?.format || 'csv';

        let whereClause = sql`WHERE 1=1`;
        if (userId) whereClause = sql`${whereClause} AND user_id = ${Number(userId)}`;
        if (channelId) whereClause = sql`${whereClause} AND channel_id = ${Number(channelId)}`;
        if (modelName) whereClause = sql`${whereClause} AND model_name = ${modelName}`;
        if (statusCode) whereClause = sql`${whereClause} AND status_code = ${Number(statusCode)}`;
        if (search) whereClause = sql`${whereClause} AND (prompt ILIKE ${'%' + search + '%'} OR response ILIKE ${'%' + search + '%'} OR error_message ILIKE ${'%' + search + '%'})`;

        const data = await sql`
            SELECT l.*, u.username as creator_name
            FROM logs l
            LEFT JOIN users u ON l.user_id = u.id
            ${whereClause}
            ORDER BY l.created_at DESC 
            LIMIT 10000
        `;

        const logs = data.map((l: any) => ({
            id: l.id,
            created_at: l.created_at,
            user_id: l.user_id,
            username: l.creator_name || '',
            channel_id: l.channel_id,
            model_name: l.model_name,
            prompt_tokens: l.prompt_tokens,
            completion_tokens: l.completion_tokens,
            cached_tokens: l.cached_tokens || 0,
            total_tokens: (l.prompt_tokens || 0) + (l.completion_tokens || 0),
            quota_cost: l.quota_cost,
            cost_usd: quotaToUSD(l.quota_cost),
            cost_rmb: quotaToRMB(l.quota_cost),
            status_code: l.status_code,
            latency_ms: l.latency_ms,
            ip: l.ip,
            prompt: l.prompt || '',
            response: l.response || '',
            error_message: l.error_message || ''
        }));

        if (format === 'json') {
            set.headers['Content-Type'] = 'application/json';
            set.headers['Content-Disposition'] = 'attachment; filename="logs_export.json"';
            return JSON.stringify(logs, null, 2);
        }

        const csvHeaders = [
            'ID', 'Created At', 'User ID', 'Username', 'Channel ID', 'Model',
            'Prompt Tokens', 'Completion Tokens', 'Cached Tokens', 'Total Tokens', 'Quota Cost',
            'Cost USD', 'Cost RMB', 'Status Code', 'Latency MS', 'IP',
            'Prompt', 'Response', 'Error Message'
        ].join(',');

        const csvRows = logs.map((l: any) => [
            l.id,
            l.created_at,
            l.user_id,
            `"${(l.username || '').replace(/"/g, '""')}"`,
            l.channel_id,
            `"${(l.model_name || '').replace(/"/g, '""')}"`,
            l.prompt_tokens,
            l.completion_tokens,
            l.cached_tokens || 0,
            l.total_tokens,
            l.quota_cost,
            l.cost_usd,
            l.cost_rmb,
            l.status_code,
            l.latency_ms,
            l.ip || '',
            `"${(l.prompt || '').replace(/"/g, '""').substring(0, 500)}"`,
            `"${(l.response || '').replace(/"/g, '""').substring(0, 500)}"`,
            `"${(l.error_message || '').replace(/"/g, '""')}"`
        ].join(','));

        const csv = [csvHeaders, ...csvRows].join('\n');
        set.headers['Content-Type'] = 'text/csv; charset=utf-8';
        set.headers['Content-Disposition'] = 'attachment; filename="logs_export.csv"';
        return csv;
    })

    .get('/circuit-breaker/status', async () => {
        const channels = Array.from(memoryCache.channels.values());
        return channels.map(ch => ({
            id: ch.id,
            name: ch.name,
            status: ch.status, // 1: Active, 3: Disabled, 4: Half-Open
            statusText: ch.status === 1 ? 'Active' : ch.status === 3 ? 'Prohibited' : ch.status === 4 ? 'Half-Open' : 'Unknown'
        }));
    })

    .get('/health-logs', async ({ query }: any) => {
        const channelId = query?.channel_id;
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        let whereClause = sql`WHERE 1=1`;
        if (channelId) whereClause = sql`${whereClause} AND hl.channel_id = ${Number(channelId)}`;

        const [countRow] = await sql`SELECT COUNT(*) as total FROM health_logs hl ${whereClause}`;
        const data = await sql`
            SELECT hl.*, c.name as channel_name, c.type as channel_type
            FROM health_logs hl
            LEFT JOIN channels c ON hl.channel_id = c.id
            ${whereClause}
            ORDER BY hl.created_at DESC 
            LIMIT ${limit} OFFSET ${offset}
        `;

        return {
            data: data.map((l: any) => ({
                id: l.id,
                channel_id: l.channel_id,
                channel_name: l.channel_name || 'Unknown',
                channel_type: l.channel_type,
                status: l.status,
                status_text: l.status === 1 ? 'Healthy' : 'Failed',
                latency: l.latency,
                error_message: l.error_message,
                created_at: l.created_at
            })),
            total: countRow.total,
            page,
            limit
        };
    })

    .get('/health-summary', async () => {
        const summary = await sql`
            SELECT 
                c.id,
                c.name,
                c.type,
                c.status,
                c.test_errors,
                c.test_at,
                COUNT(hl.id) as total_checks,
                COUNT(CASE WHEN hl.status = 1 THEN 1 END) as successful_checks,
                COUNT(CASE WHEN hl.status = 0 THEN 1 END) as failed_checks,
                AVG(CASE WHEN hl.status = 1 THEN hl.latency END) as avg_latency,
                MAX(hl.created_at) as last_check
            FROM channels c
            LEFT JOIN health_logs hl ON c.id = hl.channel_id
            WHERE hl.created_at >= NOW() - INTERVAL '24 hours' OR hl.id IS NULL
            GROUP BY c.id, c.name, c.type, c.status, c.test_errors, c.test_at
            ORDER BY c.id
        `;
        return summary.map((s: any) => ({
            ...s,
            success_rate: s.total_checks > 0 ? ((s.successful_checks / s.total_checks) * 100).toFixed(1) : 'N/A',
            avg_latency: s.avg_latency ? Math.round(s.avg_latency) : null
        }));
    })

    .get('/audit-logs', async ({ query }: any) => {
        const userId = query?.user_id ? Number(query.user_id) : undefined;
        const action = query?.action;
        const resource = query?.resource;
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;

        const result = await getAuditLogs({
            userId,
            action,
            resource,
            limit,
            offset
        });

        return {
            data: result.logs.map((l: any) => ({
                id: l.id,
                user_id: l.user_id,
                username: l.username,
                action: l.action,
                resource: l.resource,
                resource_id: l.resource_id,
                details: l.details,
                ip_address: l.ip_address,
                user_agent: l.user_agent,
                created_at: l.created_at
            })),
            total: result.total,
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
                (SELECT COALESCE(sum(quota), 0) FROM users)::bigint as "totalQuota",
                (SELECT COALESCE(sum(used_quota), 0) FROM users)::bigint as "usedQuota",
                (SELECT COALESCE(sum(quota_cost), 0) FROM logs WHERE created_at >= CURRENT_DATE)::bigint as "todayQuota"
        `;
        return stats;
    })

    .get('/dashboard/errors', async () => {
        const errorLogs = await sql`
            SELECT 
                COALESCE(error_message, 'Unknown Error') as title,
                ip,
                COUNT(*) as count
            FROM logs
            WHERE status_code >= 400
            AND created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY error_message, ip
            ORDER BY count DESC
            LIMIT 5
        `;
        return errorLogs;
    })

    .get('/stats/granular', async ({ query }: any) => {
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

    .get('/dashboard/period_stats', async ({ query }: any) => {
        const { period } = query as any;
        let startDate = new Date();
        startDate.setHours(0, 0, 0, 0); // Default to today

        const now = new Date();
        switch (period) {
            case 'yesterday':
                startDate.setDate(startDate.getDate() - 1);
                // Yesterday ends at start of today
                break;
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case 'today':
            default:
                break;
        }

        const condition = period === 'yesterday'
            ? sql`created_at >= ${startDate} AND created_at < ${new Date(new Date().setHours(0, 0, 0, 0))}`
            : sql`created_at >= ${startDate}`;

        // 1. Overall Aggregation
        const [overview] = await sql`
            SELECT 
                COUNT(*)::int as total_requests,
                COALESCE(SUM(quota_cost), 0)::bigint as total_cost,
                COALESCE(SUM(prompt_tokens), 0)::bigint as total_prompt_tokens,
                COALESCE(SUM(completion_tokens), 0)::bigint as total_completion_tokens,
                COUNT(CASE WHEN channel_id = 0 THEN 1 END)::int as cache_hits,
                COALESCE(SUM(CASE WHEN channel_id = 0 THEN quota_cost ELSE 0 END), 0)::bigint as cache_profit_quota,
                COALESCE(SUM(CASE WHEN channel_id = 0 THEN prompt_tokens + completion_tokens ELSE 0 END), 0)::bigint as cached_tokens
            FROM logs
            WHERE ${condition}
        `;

        // 1.5 Semantic Cache Storage Stats
        let cache_size_bytes = 0;
        let cache_record_count = 0;
        try {
            const [sizeRow] = await sql`SELECT pg_total_relation_size('semantic_cache') as size`;
            const [countRow] = await sql`SELECT COUNT(*) as cnt FROM semantic_cache`;
            cache_size_bytes = Number(sizeRow?.size || 0);
            cache_record_count = Number(countRow?.cnt || 0);
        } catch (e) {
            console.warn('[Admin] Failed to read semantic_cache size:', e);
        }

        // 2. Models by User (Consumer metrics)
        const models_user = await sql`
            SELECT 
                model_name,
                COUNT(*)::int as requests,
                COALESCE(SUM(prompt_tokens + completion_tokens), 0)::bigint as tokens,
                COALESCE(SUM(quota_cost), 0)::bigint as cost,
                ROUND((COUNT(CASE WHEN status_code < 400 THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 1)::float as success_rate
            FROM logs
            WHERE ${condition}
            GROUP BY model_name
            ORDER BY cost DESC
            LIMIT 20
        `;

        // Calculate cost percentage for users
        const totalUserCost = Number(overview.total_cost || 1); // Avoid division by zero
        models_user.forEach((m: any) => {
            m.cost_percentage = Number(((Number(m.cost) / totalUserCost) * 100).toFixed(1));
        });

        // 3. Models by Key (Channel metrics)
        const models_channel = await sql`
            SELECT 
                model_name,
                COUNT(*)::int as requests,
                COALESCE(SUM(prompt_tokens + completion_tokens), 0)::bigint as tokens,
                COALESCE(SUM(quota_cost), 0)::bigint as cost,
                ROUND((COUNT(CASE WHEN status_code < 400 THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 1)::float as success_rate
            FROM logs
            WHERE ${condition} AND channel_id IS NOT NULL
            GROUP BY model_name
            ORDER BY cost DESC
            LIMIT 20
        `;

        // Calculate cost percentage for channels
        const totalChannelCost = models_channel.reduce((sum: any, m: any) => sum + Number(m.cost), 0) || 1;
        models_channel.forEach((m: any) => {
            m.cost_percentage = Number(((Number(m.cost) / totalChannelCost) * 100).toFixed(1));
        });

        return {
            overview: {
                ...overview,
                cache_size_bytes,
                cache_record_count
            },
            models_user,
            models_channel
        };
    })

    // --- Models List ---
    .get('/models', async () => {
        // Collect ALL models across all channels (both active and inactive)
        const allModelIds = new Set<string>();
        const modelToChannels = new Map<string, any[]>();

        for (const channel of memoryCache.channels.values()) {
            let supportedModels: string[] = [];
            if (Array.isArray(channel.models)) {
                supportedModels = channel.models;
            } else if (typeof channel.models === 'string') {
                try {
                    supportedModels = JSON.parse(channel.models);
                } catch {
                    supportedModels = (channel.models as string).split(',').map((s: string) => s.trim());
                }
            }

            for (const m of supportedModels) {
                allModelIds.add(m);
                if (!modelToChannels.has(m)) modelToChannels.set(m, []);
                modelToChannels.get(m)!.push(channel);
            }
        }

        // Flatten all models from config into a single map for quick lookup
        const metaMap = new Map<string, any>();
        for (const provider of Object.values(modelConfig as any)) {
            if ((provider as any).models && Array.isArray((provider as any).models)) {
                for (const m of (provider as any).models) {
                    metaMap.set(m.id, m);
                }
            }
        }

        // Fetch metrics (latency) for all models from recent health logs
        const metrics = await sql`
            SELECT channel_id, AVG(latency) as avg_latency
            FROM (
                SELECT channel_id, latency
                FROM health_logs
                WHERE status = 1
                ORDER BY created_at DESC
                LIMIT 1000
            ) t
            GROUP BY channel_id
        `;
        const channelLatencyMap = new Map<number, number>();
        metrics.forEach((m: any) => channelLatencyMap.set(m.channel_id, Number(m.avg_latency)));

        return Array.from(allModelIds).map(modelId => {
            const meta = metaMap.get(modelId);
            const channels = modelToChannels.get(modelId) || [];

            // A model is 'online' if it has at least one channel with status 1 (Active) or 4 (Half-Open)
            const activeChannels = channels.filter(ch => ch.status === 1 || ch.status === 4);
            const isOnline = activeChannels.length > 0;

            // Calculate average latency across all active channels for this model
            let avgLatency = 0;
            if (isOnline) {
                const latencies = activeChannels
                    .map(ch => channelLatencyMap.get(ch.id))
                    .filter((l): l is number => l !== undefined && l > 0);
                if (latencies.length > 0) {
                    avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
                }
            }

            let status = isOnline ? 'online' : 'offline';
            if (isOnline && avgLatency > 3000) {
                status = 'busy';
            }

            let displayName = meta?.name || modelId;

            // Normalize Name: Generic extraction for OpenRouter/OneAPI formats
            // Matches "provider/model_name" or "provider:model_name" (e.g., "google/gemma", "deepseek-ai/r1")
            if (displayName.includes('/')) {
                const prefixMatch = displayName.match(/^([a-zA-Z0-9\-_]+)\/(.+)$/);
                if (prefixMatch) displayName = prefixMatch[2];
            } else if (displayName.includes(':')) {
                const prefixMatch = displayName.match(/^([a-zA-Z0-9\-_]+):(.+)$/);
                if (prefixMatch) displayName = prefixMatch[2];
            }

            return {
                id: modelId,
                name: displayName,
                description: meta?.description || '',
                status,
                latency: Math.round(avgLatency),
                object: 'model'
            };
        });
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

    .get('/invite-codes', async ({ query }: any) => {
        const page = Number(query?.page) || 1;
        const limit = Number(query?.limit) || 50;
        const offset = (page - 1) * limit;
        const status = query?.status;

        let whereClause = sql`WHERE 1=1`;
        if (status !== undefined && status !== '') {
            whereClause = sql`${whereClause} AND ic.status = ${Number(status)}`;
        }

        const [countRow] = await sql`SELECT COUNT(*) as total FROM invite_codes ic ${whereClause}`;
        const data = await sql`
            SELECT ic.*, u.username as creator_name
            FROM invite_codes ic
            LEFT JOIN users u ON ic.created_by = u.id
            ${whereClause}
            ORDER BY ic.id DESC
            LIMIT ${limit} OFFSET ${offset}
        `;

        return {
            data: data.map((c: any) => ({
                id: c.id,
                code: c.code,
                maxUses: c.max_uses,
                usedCount: c.used_count,
                giftQuota: c.gift_quota,
                status: c.status,
                expiresAt: c.expires_at,
                createdBy: c.created_by,
                creatorName: c.creator_name,
                createdAt: c.created_at,
                updatedAt: c.updated_at
            })),
            total: countRow.total,
            page,
            limit
        };
    })

    .post('/invite-codes', async ({ body, user, set }: any) => {
        try {
            const b = body as any;
            const count = b.count || 1;
            const results: any[] = [];

            for (let i = 0; i < count; i++) {
                const code = b.codePrefix ? `${b.codePrefix}-${Bun.randomUUIDv7('hex').substring(0, 8)}` : `inv-${Bun.randomUUIDv7('hex').substring(0, 12)}`;
                const [result] = await sql`
                    INSERT INTO invite_codes (code, max_uses, gift_quota, status, expires_at, created_by)
                    VALUES (${code}, ${b.maxUses || 1}, ${b.giftQuota || 0}, 1, ${b.expiresAt || null}, ${user.id})
                    RETURNING *
                `;
                results.push({
                    id: result.id,
                    code: result.code,
                    maxUses: result.max_uses,
                    usedCount: result.used_count,
                    giftQuota: result.gift_quota,
                    status: result.status,
                    expiresAt: result.expires_at,
                    createdAt: result.created_at
                });
            }

            return { success: true, codes: results, count: results.length };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    }, {
        body: t.Object({
            count: t.Optional(t.Number()),
            maxUses: t.Optional(t.Number()),
            giftQuota: t.Optional(t.Number()),
            expiresAt: t.Optional(t.String()),
            codePrefix: t.Optional(t.String())
        })
    })

    .put('/invite-codes/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as any;
            const [oldCode] = await sql`SELECT * FROM invite_codes WHERE id = ${Number(id)} LIMIT 1`;
            if (!oldCode) {
                set.status = 404;
                return { success: false, message: 'Invite code not found' };
            }

            const [result] = await sql`
                UPDATE invite_codes 
                SET max_uses = COALESCE(${b.maxUses}, max_uses),
                    gift_quota = COALESCE(${b.giftQuota}, gift_quota),
                    status = COALESCE(${b.status}, status),
                    expires_at = ${b.expiresAt !== undefined ? b.expiresAt : oldCode.expires_at},
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            return {
                success: true,
                code: {
                    id: result.id,
                    code: result.code,
                    maxUses: result.max_uses,
                    usedCount: result.used_count,
                    giftQuota: result.gift_quota,
                    status: result.status,
                    expiresAt: result.expires_at,
                    updatedAt: result.updated_at
                }
            };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .delete('/invite-codes/:id', async ({ params: { id }, set }: any) => {
        try {
            await sql`DELETE FROM invite_codes WHERE id = ${Number(id)}`;
            return { success: true };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    .delete('/invite-codes/batch', async ({ body, set }: any) => {
        try {
            const ids = (body as any).ids as number[];
            if (!ids || ids.length === 0) {
                set.status = 400;
                return { success: false, message: 'No IDs provided' };
            }
            await sql`DELETE FROM invite_codes WHERE id IN ${sql(ids)}`;
            return { success: true, deleted: ids.length };
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
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
    })

    // --- Rate Limits ---
    .get('/rate-limits', async () => {
        return await sql`SELECT * FROM rate_limit_rules ORDER BY id DESC`;
    })
    .post('/rate-limits', async ({ body, set }: any) => {
        try {
            const b = body as any;
            const [result] = await sql`
                INSERT INTO rate_limit_rules (name, rpm, rph, concurrent)
                VALUES (${b.name}, ${b.rpm || 0}, ${b.rph || 0}, ${b.concurrent || 0})
                RETURNING *
            `;
            await memoryCache.refresh();
            return { success: true, data: result };
        } catch (e: any) {
            set.status = 500; return { success: false, message: e.message };
        }
    })
    .put('/rate-limits/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as any;
            const [result] = await sql`
                UPDATE rate_limit_rules 
                SET name = COALESCE(${b.name}, name),
                    rpm = COALESCE(${b.rpm}, rpm),
                    rph = COALESCE(${b.rph}, rph),
                    concurrent = COALESCE(${b.concurrent}, concurrent)
                WHERE id = ${Number(id)} RETURNING *
            `;
            await memoryCache.refresh();
            return { success: true, data: result };
        } catch (e: any) {
            set.status = 500; return { success: false, message: e.message };
        }
    })
    .delete('/rate-limits/:id', async ({ params: { id }, set }: any) => {
        try {
            await sql`DELETE FROM rate_limit_rules WHERE id = ${Number(id)}`;
            await memoryCache.refresh();
            return { success: true };
        } catch (e: any) {
            set.status = 500; return { success: false, message: e.message };
        }
    })

    // --- Packages ---
    .get('/packages', async () => {
        return await sql`
            SELECT p.*, r.name as default_rate_limit_name 
            FROM packages p 
            LEFT JOIN rate_limit_rules r ON p.default_rate_limit_id = r.id 
            ORDER BY p.id DESC
        `;
    })
    .post('/packages', async ({ body, user, set }: any) => {
        try {
            const b = body as any;
            const [result] = await sql`
                INSERT INTO packages (name, description, price, duration_days, models, default_rate_limit_id, model_rate_limits, is_public, added_by)
                VALUES (${b.name}, ${b.description || ''}, ${b.price || 0}, ${b.durationDays || 30}, ${JSON.stringify(b.models || [])}, ${b.defaultRateLimitId || null}, ${JSON.stringify(b.modelRateLimits || {})}, ${b.isPublic ?? true}, ${user.id})
                RETURNING *
            `;
            return { success: true, data: result };
        } catch (e: any) {
            set.status = 500; return { success: false, message: e.message };
        }
    })
    .put('/packages/:id', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as any;
            const [result] = await sql`
                UPDATE packages 
                SET name = COALESCE(${b.name}, name),
                    description = COALESCE(${b.description}, description),
                    price = COALESCE(${b.price}, price),
                    duration_days = COALESCE(${b.durationDays}, duration_days),
                    models = COALESCE(${b.models ? JSON.stringify(b.models) : null}, models),
                    default_rate_limit_id = COALESCE(${b.defaultRateLimitId}, default_rate_limit_id),
                    model_rate_limits = COALESCE(${b.modelRateLimits ? JSON.stringify(b.modelRateLimits) : null}, model_rate_limits),
                    is_public = COALESCE(${b.isPublic}, is_public),
                    updated_at = NOW()
                WHERE id = ${Number(id)} RETURNING *
            `;
            return { success: true, data: result };
        } catch (e: any) {
            set.status = 500; return { success: false, message: e.message };
        }
    })
    .delete('/packages/:id', async ({ params: { id }, set }: any) => {
        try {
            await sql`DELETE FROM packages WHERE id = ${Number(id)}`;
            return { success: true };
        } catch (e: any) {
            set.status = 500; return { success: false, message: e.message };
        }
    })

    // --- Subscription Management ---
    // Get all subscriptions across the platform
    .get('/subscriptions', async () => {
        return await sql`
            SELECT s.*, u.username, p.name as package_name 
            FROM user_subscriptions s
            JOIN users u ON s.user_id = u.id
            JOIN packages p ON s.package_id = p.id
            ORDER BY s.id DESC LIMIT 100
        `;
    })
    // Get subscriptions for a specific user
    .get('/users/:id/subscriptions', async ({ params: { id } }: any) => {
        return await sql`
            SELECT s.*, p.name as package_name, p.models, p.duration_days
            FROM user_subscriptions s
            JOIN packages p ON s.package_id = p.id
            WHERE s.user_id = ${Number(id)}
            ORDER BY s.id DESC
        `;
    })
    // Grant a package manually by Admin
    .post('/users/:id/subscriptions', async ({ params: { id }, body, set }: any) => {
        try {
            const b = body as any;
            const [pkg] = await sql`SELECT duration_days FROM packages WHERE id = ${b.packageId}`;
            if (!pkg) {
                set.status = 404; return { success: false, message: 'Package not found' };
            }

            const durationMs = Number(pkg.duration_days) * 24 * 60 * 60 * 1000;

            // Check if the user already has an active subscription for this identical package
            const [existingSub] = await sql`
                SELECT id, end_time 
                FROM user_subscriptions 
                WHERE user_id = ${Number(id)} 
                AND package_id = ${b.packageId}
                AND status = 1
                AND end_time > NOW()
                ORDER BY end_time DESC
                LIMIT 1
            `;

            let result;
            if (existingSub) {
                // If it exists, extend the expiration time based on the old package's end_time (stack identical packages)
                const newEndTime = new Date(existingSub.end_time.getTime() + durationMs);
                const [updated] = await sql`
                    UPDATE user_subscriptions
                    SET end_time = ${newEndTime}, updated_at = NOW()
                    WHERE id = ${existingSub.id}
                    RETURNING *
                `;
                result = updated;
            } else {
                // Otherwise create a completely new subscription, available in parallel starting from the current time
                const newEndTime = new Date(Date.now() + durationMs);
                const [inserted] = await sql`
                    INSERT INTO user_subscriptions (user_id, package_id, start_time, end_time, status)
                    VALUES (${Number(id)}, ${b.packageId}, NOW(), ${newEndTime}, 1)
                    RETURNING *
                `;
                result = inserted;
            }

            // Trigger Postgres auth_update notification to flush gateway's LRU auth cache instantly
            await sql`NOTIFY auth_update, ${String(id)}`;

            return { success: true, data: result };
        } catch (e: any) {
            set.status = 500; return { success: false, message: e.message };
        }
    })
    .put('/subscriptions/:id', async ({ params: { id }, body, set }: any) => {
        try {
            // allows changing status (e.g. disable a subscription)
            const [result] = await sql`
                UPDATE user_subscriptions 
                SET status = COALESCE(${body.status}, status), updated_at = NOW() 
                WHERE id = ${Number(id)} RETURNING *
            `;
            if (result) {
                await sql`NOTIFY auth_update, ${String(result.user_id)}`;
            }
            return { success: true, data: result };
        } catch (e: any) {
            set.status = 500; return { success: false, message: e.message };
        }
    });
