import { log } from '../../services/logger';
import { getErrorMessage } from '../../utils/error';
import { Elysia, t } from 'elysia';
import { sql } from '@elygate/db';
import { memoryCache } from '../../services/cache';
import { getProviderHandler } from '../../providers';
import { ChannelType  } from '../../types';
import { encryptChannelKeys, decryptChannelKeys, getChannelKeys } from '../../services/encryption';
import { buildModelsUrl, buildTestUrl } from '../../utils/url';
import { refreshAllCaches } from './index';
import { apiUrls } from '../../config';

// Load model configurations
let modelConfig: Record<string, any> = { anthropic: { models: [] } };
try {
    const { join } = await import('path');
    const configPath = join(process.cwd(), 'apps/gateway/config/models.json');
    const file = Bun.file(configPath);
    if (await file.exists()) {
        modelConfig = await file.json();
    }
} catch (error: unknown) {
    log.error('[ModelConfig] Failed to load model config:', error);
}

export { modelConfig };

export const channelsRouter = new Elysia()
    .get('/channels', async () => {
        const channels = await sql`
            SELECT id, name, type, key, base_url AS "baseUrl", models, model_mapping AS "modelMapping", priority, weight, groups, status, status_message AS "statusMessage",
                   key_strategy AS "keyStrategy", key_status AS "keyStatus", price_ratio AS "priceRatio", created_at, 
                   (SELECT updated_at FROM channels c2 WHERE c2.id = channels.id) as updated_at
            FROM channels 
            ORDER BY id DESC
        `;
        return channels.map((c: Record<string, any>) => ({
            ...c,
            key: decryptChannelKeys(c.key)
        }));
    })

    .post('/channels', async ({ body, set }: any) => {
        try {
            const b = body as Record<string, any>;
            const encryptedKey = encryptChannelKeys(b.key);
            const [result] = await sql`
                INSERT INTO channels (name, type, key, base_url, models, priority, weight, status, key_strategy, key_status, price_ratio, key_concurrency_limit)
                VALUES (${b.name}, ${b.type}, ${encryptedKey}, ${b.baseUrl}, ${b.models}, ${b.priority || 0}, ${b.weight || 1}, 1, ${b.keyStrategy || 0}, '{}'::jsonb, ${b.priceRatio || 1.0}, ${b.keyConcurrencyLimit || 0})
                RETURNING *
            `;
            await refreshAllCaches();
            return result;
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
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
            const b = body as Record<string, any>;
            const [oldChannel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
            if (!oldChannel) {
                set.status = 404;
                return { success: false, message: 'Channel not found' };
            }

            let finalModels = oldChannel.models;
            if (b.models !== undefined) {
                finalModels = Array.isArray(b.models) ? JSON.stringify(b.models) : b.models;
            }

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
                    model_mapping = ${b.modelMapping || oldChannel.model_mapping},
                    priority = ${b.priority ?? oldChannel.priority},
                    weight = ${b.weight ?? oldChannel.weight},
                    status = ${b.status ?? oldChannel.status},
                    key_strategy = ${b.keyStrategy ?? oldChannel.key_strategy},
                    key_status = ${b.keyStatus || oldChannel.key_status},
                    price_ratio = ${b.priceRatio ?? oldChannel.price_ratio},
                    key_concurrency_limit = ${b.keyConcurrencyLimit ?? oldChannel.key_concurrency_limit},
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            await refreshAllCaches();
            return {
                ...result,
                key: decryptChannelKeys(result.key)
            };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .delete('/channels/:id', async ({ params: { id }, set }: any) => {
        try {
            await sql`DELETE FROM channels WHERE id = ${Number(id)}`;
            await refreshAllCaches();
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .post('/channels/batch', async ({ body, set }: any) => {
        try {
            const channels = body as Record<string, any>[];
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
                } catch (e: unknown) {
                    results.push({ success: false, name: ch.name, error: getErrorMessage(e) });
                }
            }

            await refreshAllCaches();
            return {
                success: true,
                total: channels.length,
                imported: results.filter((r: Record<string, any>) => r.success).length,
                failed: results.filter((r: Record<string, any>) => !r.success).length,
                results
            };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
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
        const keys = getChannelKeys(channel.key);
        const testKey = keys[0] || '';
        const baseUrl = (channel.base_url || (apiUrls as any).openaiDefault).replace(/\/+$/, '');

        const modelsUrl = buildModelsUrl(baseUrl, channel.type);
        const res = await fetch(modelsUrl, { headers: handler.buildHeaders(testKey) });
        if (!res.ok) return (set.status = 500, { success: false, message: `Failed: ${res.status}` });

        const data = await res.json();
        const upstreamModels: string[] = channel.type === ChannelType.GEMINI
            ? data.models?.map((m: Record<string, any>) => m.name?.replace('models/', '') || m.displayName).filter(Boolean) || []
            : data.data?.map((m: Record<string, any>) => m.id).filter(Boolean) || data.map?.((m: Record<string, any>) => m.id || m.name).filter(Boolean) || [];

        const upstreamSet = new Set(upstreamModels);

        // --- Compare with current models ---
        const oldModels: string[] = Array.isArray(channel.models)
            ? channel.models
            : (typeof channel.models === 'string' ? JSON.parse(channel.models) : []);
        const removedModels = oldModels.filter((m: string) => !upstreamSet.has(m));
        const newModels = upstreamModels.filter((m: string) => !oldModels.includes(m));

        // --- Clean broken aliases from model_mapping ---
        let modelMapping: Record<string, string> = typeof channel.model_mapping === 'string'
            ? JSON.parse(channel.model_mapping || '{}')
            : (channel.model_mapping || {});
        const brokenAliases: string[] = [];
        for (const [alias, target] of Object.entries(modelMapping)) {
            if (!upstreamSet.has(target)) {
                brokenAliases.push(alias);
                delete modelMapping[alias];
            }
        }

        // --- Auto-generate aliases for new models ---
        // Strategy: strip provider prefix (e.g., "deepseek-ai/DeepSeek-V3" -> "DeepSeek-V3")
        // Skip image/audio/embedding models and models without slash
        const skipPatterns = /flux|image|sd|stable|draw|kolors|tts|speech|sovits|bge|rerank|embed|whisper/i;
        const existingAliases = new Set(Object.keys(modelMapping));
        const existingTargets = new Set(Object.values(modelMapping));
        const generatedAliases: Record<string, string> = {};

        for (const model of newModels) {
            if (skipPatterns.test(model)) continue;
            if (!model.includes('/')) continue;

            let stripped = model;
            // Remove "Pro/" prefix
            if (stripped.toLowerCase().startsWith('pro/')) {
                stripped = stripped.substring(4);
            }
            // Remove provider prefix (first segment)
            if (stripped.includes('/')) {
                const parts = stripped.split('/');
                stripped = parts.slice(1).join('/');
            }

            // Only add if alias is unique and doesn't conflict
            if (stripped && stripped !== model
                && !existingAliases.has(stripped)
                && !existingTargets.has(model)
                && !upstreamSet.has(stripped)) {
                modelMapping[stripped] = model;
                generatedAliases[stripped] = model;
                existingAliases.add(stripped);
                existingTargets.add(model);
            }
        }

        // --- Update DB ---
        const [result] = await sql`
            UPDATE channels 
            SET models = ${upstreamModels}, 
                model_mapping = ${modelMapping},
                updated_at = NOW() 
            WHERE id = ${Number(id)} 
            RETURNING *`;
        await refreshAllCaches();

        log.info(`[Sync] Channel ${channel.name}: ${upstreamModels.length} models (${newModels.length} new, ${removedModels.length} removed), ${brokenAliases.length} stale aliases cleaned, ${Object.keys(generatedAliases).length} aliases generated`);

        return {
            success: true,
            modelsCount: upstreamModels.length,
            added: newModels.length,
            removed: removedModels.length,
            removedModels: removedModels.length > 0 ? removedModels : undefined,
            brokenAliasesCleaned: brokenAliases.length,
            aliasesGenerated: Object.keys(generatedAliases).length,
            generatedAliases: Object.keys(generatedAliases).length > 0 ? generatedAliases : undefined,
            totalAliases: Object.keys(modelMapping).length
        };
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

            const activeKeys = keys.filter((k: string) => statusMap[k] !== 'exhausted');
            const newKeyString = activeKeys.join('\n');

            const newStatusMap: Record<string, string> = {};
            for (const k of activeKeys) {
                if (statusMap[k]) newStatusMap[k] = statusMap[k];
            }

            const [result] = await sql`
                UPDATE channels 
                SET key = ${newKeyString},
                    key_status = ${newStatusMap},
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            await refreshAllCaches();
            return {
                success: true,
                removedCount: keys.length - activeKeys.length,
                channel: result
            };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .post('/channels/:id/test', async ({ params: { id } }: any) => {
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) throw new Error("Channel not found");

        const modelsOpt = typeof channel.models === 'string' ? JSON.parse(channel.models) : channel.models;
        const testModel = (Array.isArray(modelsOpt) && modelsOpt.length > 0) ? modelsOpt[0] : 'gpt-3.5-turbo';

        const handler = getProviderHandler(channel.type);
        const bodyPayload = { model: testModel, messages: [{ role: "user", content: "hi" }], max_tokens: 1 };
        const transformedBody = handler.transformRequest(bodyPayload, testModel);

        const keys = getChannelKeys(channel.key);
        const testKey = keys[0] || '';
        const fetchHeaders = handler.buildHeaders(testKey);

        const baseUrl = (channel.base_url || (apiUrls as any).openaiDefault).replace(/\/+$/, '');
        const testUrl = buildTestUrl(baseUrl, channel.type, testModel);

        const startTime = Date.now();
        try {
            const res = await fetch(testUrl, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify(transformedBody)
            });
            const latency = Date.now() - startTime;

            await sql`UPDATE channels SET response_time = ${latency}, test_at = NOW() WHERE id = ${Number(id)}`;
            await refreshAllCaches();
            return { success: true, response_time: latency };
        } catch (e: unknown) {
            await sql`UPDATE channels SET response_time = 0, test_at = NOW() WHERE id = ${Number(id)}`;
            await refreshAllCaches();
            throw e;
        }
    })

    .post('/channels/fetch-models', async ({ body, set }: any) => {
        const { url, key, type } = body as { url?: string; key?: string; type?: number };
        
        if (!url || !key) {
            set.status = 400;
            return { success: false, message: 'URL and key are required' };
        }

        const channelType = type ?? ChannelType.OPENAI;
        const handler = getProviderHandler(channelType);

        if (channelType === ChannelType.ANTHROPIC) {
            const anthropicModels = modelConfig.anthropic?.models?.map((m: Record<string, any>) => m.id) || [];
            return { success: true, models: anthropicModels, total: anthropicModels.length };
        }

        const keys = key.split('\n').map((k: string) => k.trim()).filter(Boolean);
        const testKey = keys[0] || '';
        const fetchHeaders = handler.buildHeaders(testKey);

        const baseUrl = url.replace(/\/+$/, '');
        const modelsUrl = buildModelsUrl(baseUrl, channelType);

        try {
            const response = await fetch(modelsUrl, { method: 'GET', headers: fetchHeaders });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Upstream Error (${response.status}): ${errorText.slice(0, 100)}${errorText.length > 100 ? '...' : ''}`);
            }

            const data = await response.json();
            if (!data) throw new Error("Empty response from upstream");

            let models: string[] = [];
            if (channelType === ChannelType.GEMINI) {
                models = data.models?.map((m: Record<string, any>) => m.name?.replace('models/', '') || m.displayName).filter(Boolean) || [];
            } else if (data.data && Array.isArray(data.data)) {
                models = data.data.map((m: Record<string, any>) => m.id).filter(Boolean);
            } else if (Array.isArray(data)) {
                models = data.map((m: Record<string, any>) => m.id || m.name).filter(Boolean);
            }

            return { success: true, models, total: models.length };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .get('/channels/:id/models', async ({ params: { id }, set }: any) => {
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) {
            set.status = 404;
            return { success: false, message: 'Channel not found' };
        }

        const handler = getProviderHandler(channel.type);

        if (channel.type === ChannelType.ANTHROPIC) {
            const anthropicModels = modelConfig.anthropic?.models?.map((m: Record<string, any>) => m.id) || [];
            return {
                success: true,
                models: anthropicModels,
                total: anthropicModels.length,
                last_updated: modelConfig.anthropic?.last_updated
            };
        }

        const keys = getChannelKeys(channel.key);
        const testKey = keys[0] || '';
        const fetchHeaders = handler.buildHeaders(testKey);

        const baseUrl = (channel.base_url || (apiUrls as any).openaiDefault).replace(/\/+$/, '');
        const modelsUrl = buildModelsUrl(baseUrl, channel.type);

        try {
            const response = await fetch(modelsUrl, { method: 'GET', headers: fetchHeaders });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Upstream Error (${response.status}): ${errorText.slice(0, 100)}${errorText.length > 100 ? '...' : ''}`);
            }

            const data = await response.json();
            if (!data) throw new Error("Empty response from upstream");

            let models: string[] = [];
            if (channel.type === ChannelType.GEMINI) {
                models = data.models?.map((m: Record<string, any>) => m.name?.replace('models/', '') || m.displayName).filter(Boolean) || [];
            } else if (data.data && Array.isArray(data.data)) {
                models = data.data.map((m: Record<string, any>) => m.id).filter(Boolean);
            } else if (Array.isArray(data)) {
                models = data.map((m: Record<string, any>) => m.id || m.name).filter(Boolean);
            }

            return { success: true, models, total: models.length };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    });
