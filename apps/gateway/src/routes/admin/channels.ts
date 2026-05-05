import type { ElysiaCtx } from '../../types';
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
                   key_strategy AS "keyStrategy", key_status AS "keyStatus", price_ratio AS "priceRatio", endpoint_type AS "endpointType", key_concurrency_limit AS "keyConcurrencyLimit", created_at, 
                   (SELECT updated_at FROM channels c2 WHERE c2.id = channels.id) as updated_at
            FROM channels 
            ORDER BY id DESC
        `;
        return channels.map((c: Record<string, any>) => ({
            ...c,
            key: decryptChannelKeys(c.key)
        }));
    })

    .post('/channels', async ({ body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const encryptedKey = encryptChannelKeys(b.key);
            const [result] = await sql`
                INSERT INTO channels (name, type, key, base_url, models, priority, weight, status, key_strategy, key_status, price_ratio, key_concurrency_limit, endpoint_type)
                VALUES (${b.name}, ${b.type}, ${encryptedKey}, ${b.baseUrl}, ${b.models}, ${b.priority || 0}, ${b.weight || 1}, 1, ${b.keyStrategy || 0}, '{}'::jsonb, ${b.priceRatio || 1.0}, ${b.keyConcurrencyLimit || 0}, ${b.endpointType || 'auto'})
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
            keyConcurrencyLimit: t.Optional(t.Number()),
            endpointType: t.Optional(t.String())
        })
    })

    .put('/channels/:id', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const [oldChannel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
            if (!oldChannel) {
                set.status = 404;
                return { success: false, message: 'Channel not found' };
            }

            let finalModels = oldChannel.models;
            if (b.models !== undefined) {
                finalModels = b.models;
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
                    endpoint_type = ${b.endpointType ?? oldChannel.endpoint_type},
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

    .delete('/channels/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        try {
            await sql`DELETE FROM channels WHERE id = ${Number(id)}`;
            await refreshAllCaches();
            return { success: true };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .post('/channels/batch', async ({ body, set }: ElysiaCtx) => {
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

    .post('/channels/:id/sync-models', async ({ params: { id }, set }: ElysiaCtx) => {
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

    .post('/channels/:id/keys/clean', async ({ params: { id }, set }: ElysiaCtx) => {
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

    // Restore exhausted/invalid keys back to active
    .post('/channels/:id/keys/restore', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
            if (!channel) {
                set.status = 404;
                return { success: false, message: 'Channel not found' };
            }

            const b = (body || {}) as Record<string, any>;
            const statusMap: Record<string, string> = (typeof channel.key_status === 'string'
                ? JSON.parse(channel.key_status || '{}')
                : channel.key_status) || {};
            const allKeys = channel.key.split('\n').map((k: string) => k.trim()).filter(Boolean);

            let restoredCount = 0;

            if (b.key) {
                // Restore a specific key
                if (statusMap[b.key]) {
                    delete statusMap[b.key];
                    restoredCount = 1;
                }
            } else {
                // Restore all keys
                restoredCount = Object.keys(statusMap).length;
                for (const k of Object.keys(statusMap)) {
                    delete statusMap[k];
                }
            }

            // If channel was disabled due to all keys exhausted, auto-recover to Online
            const newStatus = (channel.status === 3 && restoredCount > 0) ? 1 : channel.status;

            const [result] = await sql`
                UPDATE channels 
                SET key_status = ${statusMap},
                    status = ${newStatus},
                    status_message = ${newStatus === 1 ? null : channel.status_message},
                    updated_at = NOW()
                WHERE id = ${Number(id)}
                RETURNING *
            `;
            await refreshAllCaches();

            return {
                success: true,
                restoredCount,
                channelRestored: newStatus === 1 && channel.status !== 1,
                keyStatus: statusMap,
                totalKeys: allKeys.length
            };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .post('/channels/:id/test', async ({ params: { id } }: ElysiaCtx) => {
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

            if (!res.ok) {
                const text = await res.text().catch(() => '');
                await sql`UPDATE channels SET test_at = NOW() WHERE id = ${Number(id)}`;
                await refreshAllCaches();
                return { success: false, latency, message: `Status ${res.status}: ${text.substring(0, 200)}` };
            }
            await sql`UPDATE channels SET test_at = NOW() WHERE id = ${Number(id)}`;
            await refreshAllCaches();
            return { success: true, latency };
        } catch (e: unknown) {
            await sql`UPDATE channels SET test_at = NOW() WHERE id = ${Number(id)}`;
            await refreshAllCaches();
            const errMsg = e instanceof Error ? e.message : String(e);
            return { success: false, latency: Date.now() - startTime, message: errMsg };
        }
    })

    .post('/channels/fetch-models', async ({ body, set }: ElysiaCtx) => {
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

    .get('/channels/:id/models', async ({ params: { id }, set }: ElysiaCtx) => {
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
    })
    .post('/channels/:id/keys/status', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const keyIndex = Number(b.keyIndex);
            const enabled = b.status === 'enabled';
            const reason = b.reason || null;
            const [channel] = await sql`SELECT channel_info, status, key FROM channels WHERE id = ${Number(id)} LIMIT 1`;
            if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
            const info = typeof channel.channel_info === 'string' ? JSON.parse(channel.channel_info) : (channel.channel_info || {});
            info.multiKeyStatusList = info.multiKeyStatusList || {};
            info.multiKeyDisabledReason = info.multiKeyDisabledReason || {};
            info.multiKeyDisabledTime = info.multiKeyDisabledTime || {};
            if (enabled) {
                delete info.multiKeyStatusList[keyIndex];
                delete info.multiKeyDisabledReason[keyIndex];
                delete info.multiKeyDisabledTime[keyIndex];
            } else {
                info.multiKeyStatusList[keyIndex] = 0;
                if (reason) info.multiKeyDisabledReason[keyIndex] = reason;
                info.multiKeyDisabledTime[keyIndex] = Date.now();
            }
            const allKeys = channel.key.split('\n').filter((k: string) => k.trim());
            const enabledCount = allKeys.filter((_: string, i: number) => !info.multiKeyStatusList[i] || info.multiKeyStatusList[i] !== 0).length;
            let newChannelStatus = channel.status;
            if (enabledCount === 0 && channel.status === 1) newChannelStatus = 3;
            else if (enabledCount > 0 && channel.status === 3) newChannelStatus = 1;
            await sql`UPDATE channels SET channel_info = ${info}, status = ${newChannelStatus}, updated_at = NOW() WHERE id = ${Number(id)}`;
            await refreshAllCaches();
            return { success: true, channelInfo: info, channelStatus: newChannelStatus };
        } catch (e: unknown) { set.status = 500; return { success: false, message: getErrorMessage(e) }; }
    }, { body: t.Object({ keyIndex: t.Number(), status: t.String(), reason: t.Optional(t.String()) }) })
    .post('/channels/:id/keys/mode', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            const mode = b.mode || 'random';
            const [channel] = await sql`SELECT channel_info, key_strategy FROM channels WHERE id = ${Number(id)} LIMIT 1`;
            if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
            const info = typeof channel.channel_info === 'string' ? JSON.parse(channel.channel_info) : (channel.channel_info || {});
            info.isMultiKey = true;
            info.multiKeyMode = mode;
            info.multiKeySize = channel.key.split('\n').filter((k: string) => k.trim()).length;
            const keyStrategy = mode === 'sequential' ? 1 : 0;
            await sql`UPDATE channels SET channel_info = ${info}, key_strategy = ${keyStrategy}, updated_at = NOW() WHERE id = ${Number(id)}`;
            await refreshAllCaches();
            return { success: true, channelInfo: info };
        } catch (e: unknown) { set.status = 500; return { success: false, message: getErrorMessage(e) }; }
    }, { body: t.Object({ mode: t.String() }) })
    .post('/channels/:id/tag', async ({ params: { id }, body, set }: ElysiaCtx) => {
        try {
            const b = body as Record<string, any>;
            await sql`UPDATE channels SET tag = ${b.tag || null}, updated_at = NOW() WHERE id = ${Number(id)}`;
            await refreshAllCaches();
            return { success: true };
        } catch (e: unknown) { set.status = 500; return { success: false, message: getErrorMessage(e) }; }
    }, { body: t.Object({ tag: t.Nullable(t.String()) }) })
    .get('/channels/tags', async () => {
        const rows = await sql`SELECT tag, COUNT(*)::int as count FROM channels WHERE tag IS NOT NULL AND tag != '' GROUP BY tag ORDER BY count DESC`;
        return rows;
    })
    .post('/channels/tag/:tag/enable', async ({ params: { tag } }: ElysiaCtx) => {
        await sql`UPDATE channels SET status = 1, updated_at = NOW() WHERE tag = ${tag}`;
        await refreshAllCaches();
        return { success: true };
    })
    .post('/channels/tag/:tag/disable', async ({ params: { tag } }: ElysiaCtx) => {
        await sql`UPDATE channels SET status = 3, updated_at = NOW() WHERE tag = ${tag}`;
        await refreshAllCaches();
        return { success: true };
    })
    .post('/channels/batch/tag', async ({ body }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const ids: number[] = b.channelIds || [];
        const tag: string | null = b.tag || null;
        if (ids.length === 0) return { success: false, message: 'No channel IDs provided' };
        await sql`UPDATE channels SET tag = ${tag}, updated_at = NOW() WHERE id IN ${sql(ids)}`;
        await refreshAllCaches();
        return { success: true, updated: ids.length };
    }, { body: t.Object({ channelIds: t.Array(t.Number()), tag: t.String() }) })
    .post('/channels/copy/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        try {
            const [source] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
            if (!source) { set.status = 404; return { success: false, message: 'Channel not found' }; }
            const [result] = await sql`
                INSERT INTO channels (name, type, key, base_url, models, model_mapping, priority, weight, status, key_strategy, key_status, price_ratio, key_concurrency_limit, endpoint_type, groups)
                VALUES (${'[Copy] ' + source.name}, ${source.type}, ${source.key}, ${source.base_url}, ${source.models}, ${source.model_mapping}, ${source.priority}, ${source.weight}, 3, ${source.key_strategy}, ${source.key_status}, ${source.price_ratio}, ${source.key_concurrency_limit}, ${source.endpoint_type}, ${source.groups})
                RETURNING id, name
            `;
            await refreshAllCaches();
            return { success: true, channel: result };
        } catch (e: unknown) { set.status = 500; return { success: false, message: getErrorMessage(e) }; }
    })
    .post('/channels/:id/upstream/detect', async ({ params: { id }, set }: ElysiaCtx) => {
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        const handler = getProviderHandler(channel.type);
        const keys = getChannelKeys(channel.key);
        const testKey = keys[0] || '';
        const baseUrl = (channel.base_url || '').replace(/\/+$/, '');
        const modelsUrl = buildModelsUrl(baseUrl, channel.type);
        try {
            const res = await fetch(modelsUrl, { headers: handler.buildHeaders(testKey) });
            if (!res.ok) return { success: false, message: `Upstream error: ${res.status}` };
            const data = await res.json();
            let upstreamModels: string[] = [];
            if (data.data) upstreamModels = data.data.map((m: any) => m.id).filter(Boolean);
            else if (Array.isArray(data)) upstreamModels = data.map((m: any) => m.id || m.name).filter(Boolean);
            const oldModels: string[] = Array.isArray(channel.models) ? channel.models : (typeof channel.models === 'string' ? JSON.parse(channel.models) : []);
            const added = upstreamModels.filter((m: string) => !oldModels.includes(m));
            const removed = oldModels.filter((m: string) => !upstreamModels.includes(m));
            return { success: true, currentCount: oldModels.length, upstreamCount: upstreamModels.length, added, removed };
        } catch (e: unknown) { set.status = 500; return { success: false, message: getErrorMessage(e) }; }
    })
    .post('/channels/:id/upstream/apply', async ({ params: { id }, set }: ElysiaCtx) => {
        try {
            const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
            if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
            const handler = getProviderHandler(channel.type);
            const keys = getChannelKeys(channel.key);
            const testKey = keys[0] || '';
            const baseUrl = (channel.base_url || '').replace(/\/+$/, '');
            const modelsUrl = buildModelsUrl(baseUrl, channel.type);
            const res = await fetch(modelsUrl, { headers: handler.buildHeaders(testKey) });
            if (!res.ok) return { success: false, message: `Upstream error: ${res.status}` };
            const data = await res.json();
            let upstreamModels: string[] = [];
            if (data.data) upstreamModels = data.data.map((m: any) => m.id).filter(Boolean);
            else if (Array.isArray(data)) upstreamModels = data.map((m: any) => m.id || m.name).filter(Boolean);
            await sql`UPDATE channels SET models = ${upstreamModels}, updated_at = NOW() WHERE id = ${Number(id)}`;
            await refreshAllCaches();
            return { success: true, modelsCount: upstreamModels.length };
        } catch (e: unknown) { set.status = 500; return { success: false, message: getErrorMessage(e) }; }
    })
    // --- Channel Search ---
    .get('/channels/search', async ({ query }: ElysiaCtx) => {
        const keyword = (query?.keyword || '').trim();
        const tag = query?.tag;
        const type = query?.type;
        const status = query?.status;
        let whereParts = [];
        let params: any[] = [];
        if (keyword) {
            const results = await sql`
                SELECT id, name, type, base_url AS "baseUrl", models, status, tag, priority, weight, created_at
                FROM channels
                WHERE name ILIKE ${'%' + keyword + '%'} OR CAST(id AS TEXT) ILIKE ${'%' + keyword + '%'}
                ORDER BY id DESC LIMIT 100
            `;
            return results;
        }
        // Filter in SQL
        const rows = await sql`
            SELECT id, name, type, base_url AS "baseUrl", models, status, tag, priority, weight, created_at
            FROM channels
            WHERE (${keyword || undefined} IS NULL OR name ILIKE ${'%' + (keyword || '') + '%'})
              AND (${tag || null} IS NULL OR tag = ${tag || ''})
              AND (${type ?? null} IS NULL OR type = ${Number(type) || 0})
              AND (${status ?? null} IS NULL OR status = ${Number(status) || 0})
            ORDER BY id DESC LIMIT 200
        `;
        return rows;
    })

    // --- Batch Delete Channels ---
    .post('/channels/batch/delete', async ({ body, set }: ElysiaCtx) => {
        const ids: number[] = (body as any).ids || [];
        if (ids.length === 0) return { success: false, message: 'No IDs provided' };
        if (ids.length > 500) return { success: false, message: 'Max 500 channels at once' };
        await sql`DELETE FROM channels WHERE id IN ${sql(ids)}`;
        await refreshAllCaches();
        return { success: true, deleted: ids.length };
    }, { body: t.Object({ ids: t.Array(t.Number()) }) })

    // --- Delete All Disabled Channels ---
    .delete('/channels/disabled', async () => {
        const result = await sql`DELETE FROM channels WHERE status = 2 OR status = 3`;
        await refreshAllCaches();
        return { success: true, deleted: result.count };
    })

    // --- Get Tag Models (union of all models across channels with this tag) ---
    .get('/channels/tag/:tag/models', async ({ params: { tag } }: ElysiaCtx) => {
        const rows = await sql`
            SELECT models FROM channels WHERE tag = ${tag} AND status = 1
        `;
        const modelSet = new Set<string>();
        for (const row of rows) {
            const models: string[] = Array.isArray(row.models) ? row.models : (typeof row.models === 'string' ? JSON.parse(row.models || '[]') : []);
            for (const m of models) modelSet.add(m);
        }
        return { success: true, tag, models: Array.from(modelSet).sort(), count: modelSet.size };
    })

    // --- Enabled Models List (all models with at least one active channel) ---
    .get('/channels/enabled-models', async () => {
        const rows = await sql`
            SELECT models FROM channels WHERE status = 1
        `;
        const modelSet = new Set<string>();
        for (const row of rows) {
            const models: string[] = Array.isArray(row.models) ? row.models : (typeof row.models === 'string' ? JSON.parse(row.models || '[]') : []);
            for (const m of models) modelSet.add(m);
        }
        return { success: true, models: Array.from(modelSet).sort(), count: modelSet.size };
    })

    // --- Multi-Key Batch Manage ---
    .post('/channels/:id/keys/manage', async ({ params: { id }, body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const [channel] = await sql`SELECT key, key_status, channel_info FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }

        let keys = channel.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
        const statusMap = (typeof channel.key_status === 'string' ? JSON.parse(channel.key_status) : channel.key_status) || {};
        const info = (typeof channel.channel_info === 'string' ? JSON.parse(channel.channel_info) : channel.channel_info) || {};

        if (b.action === 'add' && Array.isArray(b.keys)) {
            // Add new keys
            keys = [...keys, ...b.keys.map((k: string) => k.trim()).filter(Boolean)];
        } else if (b.action === 'remove' && Array.isArray(b.keyIndices)) {
            // Remove keys by index (descending to preserve indices)
            const toRemove = new Set(b.keyIndices.map((i: number) => Number(i)));
            keys = keys.filter((_: string, i: number) => !toRemove.has(i));
            // Clean status map
            const newStatusMap: Record<string, string> = {};
            for (const k of keys) {
                if (statusMap[k]) newStatusMap[k] = statusMap[k];
            }
            Object.assign(statusMap, newStatusMap);
        } else if (b.action === 'replace' && typeof b.keys === 'string') {
            // Replace all keys
            keys = b.keys.split('\n').map((k: string) => k.trim()).filter(Boolean);
        } else {
            return { success: false, message: 'Invalid action. Use: add, remove, replace' };
        }

        const encryptedKey = encryptChannelKeys(keys.join('\n'));
        info.isMultiKey = keys.length > 1;
        info.multiKeySize = keys.length;

        await sql`UPDATE channels SET key = ${encryptedKey}, key_status = ${statusMap}, channel_info = ${info}, updated_at = NOW() WHERE id = ${Number(id)}`;
        await refreshAllCaches();
        return { success: true, keyCount: keys.length };
    }, { body: t.Object({ action: t.String(), keys: t.Optional(t.Any()), keyIndices: t.Optional(t.Array(t.Number())) }) })

    // --- Per-Key Test ---
    .post('/channels/:id/keys/:keyIndex/test', async ({ params: { id, keyIndex }, set }: ElysiaCtx) => {
        const idx = Number(keyIndex);
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }

        const keys = getChannelKeys(channel.key);
        if (idx < 0 || idx >= keys.length) {
            return { success: false, message: `Key index ${idx} out of range (0-${keys.length - 1})` };
        }

        const testKey = keys[idx];
        const modelsOpt = typeof channel.models === 'string' ? JSON.parse(channel.models) : channel.models;
        const testModel = channel.test_model || (Array.isArray(modelsOpt) && modelsOpt.length > 0 ? modelsOpt[0] : 'gpt-3.5-turbo');

        const handler = getProviderHandler(channel.type);
        const bodyPayload = { model: testModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 };
        const transformedBody = handler.transformRequest(bodyPayload, testModel);

        const baseUrl = (channel.base_url || (apiUrls as any).openaiDefault).replace(/\/+$/, '');
        const testUrl = buildTestUrl(baseUrl, channel.type, testModel);

        const startTime = Date.now();
        try {
            const res = await fetch(testUrl, {
                method: 'POST',
                headers: handler.buildHeaders(testKey),
                body: JSON.stringify(transformedBody)
            });
            const latency = Date.now() - startTime;
            const result: Record<string, any> = { keyIndex: idx, latency, success: res.ok };
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                result.status = res.status;
                result.error = text.substring(0, 200);
            }
            return result;
        } catch (e: unknown) {
            return { keyIndex: idx, latency: Date.now() - startTime, success: false, error: e instanceof Error ? e.message : String(e) };
        }
    })

    // --- Multi-Key Status Detail ---
    .get('/channels/:id/keys/status', async ({ params: { id }, set }: ElysiaCtx) => {
        const [channel] = await sql`SELECT key, key_status, channel_info FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }

        const keys = channel.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
        const statusMap = (typeof channel.key_status === 'string' ? JSON.parse(channel.key_status) : channel.key_status) || {};
        const info = (typeof channel.channel_info === 'string' ? JSON.parse(channel.channel_info) : channel.channel_info) || {};
        const mkStatusList: Record<number, number> = info.multiKeyStatusList || {};
        const mkDisabledReason: Record<number, string> = info.multiKeyDisabledReason || {};
        const mkDisabledTime: Record<number, number> = info.multiKeyDisabledTime || {};

        return {
            success: true,
            totalKeys: keys.length,
            keys: keys.map((k: string, i: number) => ({
                index: i,
                masked: k.substring(0, 8) + '...' + k.substring(k.length - 4),
                status: statusMap[k]?.status || statusMap[k] || (mkStatusList[i] === 0 ? 'disabled' : 'active'),
                reason: mkDisabledReason[i] || statusMap[k]?.reason || null,
                disabledAt: mkDisabledTime[i] ? new Date(mkDisabledTime[i]).toISOString() : null,
            }))
        };
    })

    // --- Channel Affinity Stats ---
    .get('/channels/affinity/stats', async () => {
        const { getAffinityStats } = await import('../../services/channelAffinity');
        return getAffinityStats();
    })

    // --- Clear Channel Affinity ---
    .delete('/channels/affinity', async () => {
        const { clearAffinityCache } = await import('../../services/channelAffinity');
        const cleared = clearAffinityCache();
        return { success: true, cleared };
    })

    // --- Test All Channels ---
    .get('/channels/test', async () => {
        const channels = await sql`SELECT id, name, type, base_url, key, models, test_model, endpoint_type FROM channels WHERE status = 1`;
        const results = [];
        for (const ch of channels) {
            const handler = getProviderHandler(ch.type);
            const keys = getChannelKeys(ch.key);
            if (keys.length === 0) { results.push({ id: ch.id, name: ch.name, success: false, message: 'No keys' }); continue; }
            const testKey = keys[0];
            const modelsOpt = typeof ch.models === 'string' ? JSON.parse(ch.models) : ch.models;
            const testModel = ch.test_model || (Array.isArray(modelsOpt) && modelsOpt.length > 0 ? modelsOpt[0] : 'gpt-3.5-turbo');
            const bodyPayload = { model: testModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 };
            const baseUrl = (ch.base_url || '').replace(/\/+$/, '');
            const testUrl = buildTestUrl(baseUrl, ch.type, testModel);
            const startTime = Date.now();
            try {
                const res = await fetch(testUrl, { method: 'POST', headers: handler.buildHeaders(testKey), body: JSON.stringify(handler.transformRequest(bodyPayload, testModel)) });
                results.push({ id: ch.id, name: ch.name, success: res.ok, latency: Date.now() - startTime, status: res.status });
            } catch (e: unknown) {
                results.push({ id: ch.id, name: ch.name, success: false, latency: Date.now() - startTime, message: e instanceof Error ? e.message : String(e) });
            }
        }
        return { success: true, tested: results.length, results };
    })

    // --- Test Single Channel (GET compat with New API) ---
    .get('/channels/test/:id', async ({ params: { id } }: ElysiaCtx) => {
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) throw new Error("Channel not found");
        const handler = getProviderHandler(channel.type);
        const keys = getChannelKeys(channel.key);
        const testKey = keys[0] || '';
        const modelsOpt = typeof channel.models === 'string' ? JSON.parse(channel.models) : channel.models;
        const testModel = channel.test_model || (Array.isArray(modelsOpt) && modelsOpt.length > 0 ? modelsOpt[0] : 'gpt-3.5-turbo');
        const bodyPayload = { model: testModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 };
        const baseUrl = (channel.base_url || '').replace(/\/+$/, '');
        const testUrl = buildTestUrl(baseUrl, channel.type, testModel);
        const startTime = Date.now();
        try {
            const res = await fetch(testUrl, { method: 'POST', headers: handler.buildHeaders(testKey), body: JSON.stringify(handler.transformRequest(bodyPayload, testModel)) });
            const latency = Date.now() - startTime;
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                return { success: false, latency, message: `Status ${res.status}: ${text.substring(0, 200)}` };
            }
            await sql`UPDATE channels SET test_at = NOW() WHERE id = ${Number(id)}`;
            return { success: true, latency };
        } catch (e: unknown) {
            return { success: false, latency: Date.now() - startTime, message: e instanceof Error ? e.message : String(e) };
        }
    })

    // --- Update All Channel Balances ---
    .get('/channels/update_balance', async () => {
        const channels = await sql`SELECT id, name, type, base_url, key FROM channels WHERE status = 1`;
        const results = [];
        for (const ch of channels) {
            try {
                const handler = getProviderHandler(ch.type);
                const keys = getChannelKeys(ch.key);
                if (keys.length === 0) continue;
                const baseUrl = (ch.base_url || '').replace(/\/+$/, '');
                let balanceUrl = baseUrl + '/dashboard/billing/credit_grants';
                if (ch.type === ChannelType.AZURE) balanceUrl = baseUrl + '/status';
                const res = await fetch(balanceUrl, { headers: handler.buildHeaders(keys[0]) }).catch(() => null);
                if (res?.ok) {
                    const data = await res.json().catch(() => ({}));
                    const balance = data.total_available ?? data.total_granted ?? data.balance ?? 0;
                    await sql`UPDATE channels SET balance = ${Number(balance)}, balance_updated_at = NOW() WHERE id = ${ch.id}`;
                    results.push({ id: ch.id, name: ch.name, balance });
                } else {
                    results.push({ id: ch.id, name: ch.name, balance: null, message: 'Balance endpoint not supported' });
                }
            } catch (e: unknown) {
                results.push({ id: ch.id, name: ch.name, balance: null, message: e instanceof Error ? e.message : 'Error' });
            }
        }
        return { success: true, checked: results.length, results };
    })

    // --- Update Single Channel Balance ---
    .get('/channels/update_balance/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        const handler = getProviderHandler(channel.type);
        const keys = getChannelKeys(channel.key);
        if (keys.length === 0) return { success: false, message: 'No keys configured' };
        const baseUrl = (channel.base_url || '').replace(/\/+$/, '');
        let balanceUrl = baseUrl + '/dashboard/billing/credit_grants';
        try {
            const res = await fetch(balanceUrl, { headers: handler.buildHeaders(keys[0]) });
            if (!res.ok) return { success: false, message: `Balance endpoint returned ${res.status}` };
            const data = await res.json();
            const balance = data.total_available ?? data.total_granted ?? data.balance ?? 0;
            await sql`UPDATE channels SET balance = ${Number(balance)}, balance_updated_at = NOW() WHERE id = ${Number(id)}`;
            return { success: true, balance };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- Fetch Models for Single Channel ---
    .get('/channels/fetch_models/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [channel] = await sql`SELECT * FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        const handler = getProviderHandler(channel.type);
        const keys = getChannelKeys(channel.key);
        const testKey = keys[0] || '';
        const baseUrl = (channel.base_url || '').replace(/\/+$/, '');
        const modelsUrl = buildModelsUrl(baseUrl, channel.type);
        try {
            const res = await fetch(modelsUrl, { headers: handler.buildHeaders(testKey) });
            if (!res.ok) return { success: false, message: `Upstream error: ${res.status}` };
            const data = await res.json();
            let models: string[] = [];
            if (channel.type === ChannelType.GEMINI) {
                models = data.models?.map((m: any) => m.name?.replace('models/', '') || m.displayName).filter(Boolean) || [];
            } else if (data.data) {
                models = data.data.map((m: any) => m.id).filter(Boolean);
            } else if (Array.isArray(data)) {
                models = data.map((m: any) => m.id || m.name).filter(Boolean);
            }
            return { success: true, models, total: models.length };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- Fix Channel Abilities ---
    .post('/channels/fix', async () => {
        const channels = await sql`SELECT id, models FROM channels`;
        let fixed = 0;
        for (const ch of channels) {
            const models: string[] = Array.isArray(ch.models) ? ch.models : (typeof ch.models === 'string' ? JSON.parse(ch.models || '[]') : []);
            if (models.length > 0) {
                await sql`UPDATE channels SET models = ${models} WHERE id = ${ch.id} AND (models IS NULL OR models = '[]'::jsonb)`;
                fixed++;
            }
        }
        await refreshAllCaches();
        return { success: true, fixed, total: channels.length };
    })

    // --- Ollama: Pull Model ---
    .post('/channels/ollama/pull', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const { channelId, model } = b;
        if (!channelId || !model) { set.status = 400; return { success: false, message: 'channelId and model required' }; }
        const [channel] = await sql`SELECT base_url FROM channels WHERE id = ${Number(channelId)} AND type = 4 LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Ollama channel not found' }; }
        const baseUrl = channel.base_url.replace(/\/+$/, '');
        try {
            const res = await fetch(baseUrl + '/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: model, stream: false }) });
            if (!res.ok) { const text = await res.text(); return { success: false, message: text.substring(0, 200) }; }
            const data = await res.json();
            return { success: true, status: data.status || 'ok' };
        } catch (e: unknown) { set.status = 500; return { success: false, message: getErrorMessage(e) }; }
    }, { body: t.Object({ channelId: t.Number(), model: t.String() }) })

    .post('/channels/ollama/pull/stream', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const { channelId, model } = b;
        if (!channelId || !model) { set.status = 400; return { success: false, message: 'channelId and model required' }; }
        const [channel] = await sql`SELECT base_url FROM channels WHERE id = ${Number(channelId)} AND type = 4 LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Ollama channel not found' }; }
        const baseUrl = channel.base_url.replace(/\/+$/, '');
        try {
            return await fetch(baseUrl + '/api/pull', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: model, stream: true })
            });
        } catch (e: unknown) { set.status = 500; return { success: false, message: getErrorMessage(e) }; }
    }, { body: t.Object({ channelId: t.Number(), model: t.String() }) })

    // --- Ollama: Delete Model ---
    .delete('/channels/ollama/delete', async ({ body, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const { channelId, model } = b;
        if (!channelId || !model) { set.status = 400; return { success: false, message: 'channelId and model required' }; }
        const [channel] = await sql`SELECT base_url FROM channels WHERE id = ${Number(channelId)} AND type = 4 LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Ollama channel not found' }; }
        const baseUrl = channel.base_url.replace(/\/+$/, '');
        try {
            const res = await fetch(baseUrl + '/api/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: model }) });
            return { success: res.ok, status: res.status };
        } catch (e: unknown) { set.status = 500; return { success: false, message: getErrorMessage(e) }; }
    }, { body: t.Object({ channelId: t.Number(), model: t.String() }) })

    // --- Ollama: Version ---
    .get('/channels/ollama/version/:id', async ({ params: { id }, set }: ElysiaCtx) => {
        const [channel] = await sql`SELECT base_url FROM channels WHERE id = ${Number(id)} AND type = 4 LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Ollama channel not found' }; }
        const baseUrl = channel.base_url.replace(/\/+$/, '');
        try {
            const res = await fetch(baseUrl + '/api/version');
            if (!res.ok) return { success: false, message: `Version endpoint returned ${res.status}` };
            const data = await res.json();
            return { success: true, version: data.version || 'unknown' };
        } catch (e: unknown) { set.status = 500; return { success: false, message: getErrorMessage(e) }; }
    })

    // --- Detect Upstream Models for All Channels ---
    .post('/channels/upstream/detect_all', async () => {
        const channels = await sql`SELECT id, name, type, base_url, key, models FROM channels WHERE status = 1`;
        const results = [];
        for (const ch of channels) {
            try {
                const handler = getProviderHandler(ch.type);
                const keys = getChannelKeys(ch.key);
                if (keys.length === 0) continue;
                const baseUrl = (ch.base_url || '').replace(/\/+$/, '');
                const modelsUrl = buildModelsUrl(baseUrl, ch.type);
                const res = await fetch(modelsUrl, { headers: handler.buildHeaders(keys[0]) });
                if (!res.ok) { results.push({ id: ch.id, name: ch.name, error: `HTTP ${res.status}` }); continue; }
                const data = await res.json();
                let upstreamModels: string[] = [];
                if (data.data) upstreamModels = data.data.map((m: any) => m.id).filter(Boolean);
                else if (Array.isArray(data)) upstreamModels = data.map((m: any) => m.id || m.name).filter(Boolean);
                const oldModels: string[] = Array.isArray(ch.models) ? ch.models : (typeof ch.models === 'string' ? JSON.parse(ch.models) : []);
                const added = upstreamModels.filter((m: string) => !oldModels.includes(m));
                const removed = oldModels.filter((m: string) => !upstreamModels.includes(m));
                results.push({ id: ch.id, name: ch.name, currentCount: oldModels.length, upstreamCount: upstreamModels.length, added, removed });
            } catch (e: unknown) {
                results.push({ id: ch.id, name: ch.name, error: e instanceof Error ? e.message : 'Error' });
            }
        }
        return { success: true, checked: results.length, results };
    })

    // --- Apply Upstream Model Updates for All Channels ---
    .post('/channels/upstream/apply_all', async () => {
        const channels = await sql`SELECT id, name, type, base_url, key, models FROM channels WHERE status = 1`;
        const results = [];
        for (const ch of channels) {
            try {
                const handler = getProviderHandler(ch.type);
                const keys = getChannelKeys(ch.key);
                if (keys.length === 0) continue;
                const baseUrl = (ch.base_url || '').replace(/\/+$/, '');
                const modelsUrl = buildModelsUrl(baseUrl, ch.type);
                const res = await fetch(modelsUrl, { headers: handler.buildHeaders(keys[0]) });
                if (!res.ok) { results.push({ id: ch.id, name: ch.name, applied: false, error: `HTTP ${res.status}` }); continue; }
                const data = await res.json();
                let upstreamModels: string[] = [];
                if (data.data) upstreamModels = data.data.map((m: any) => m.id).filter(Boolean);
                else if (Array.isArray(data)) upstreamModels = data.map((m: any) => m.id || m.name).filter(Boolean);
                await sql`UPDATE channels SET models = ${upstreamModels}, updated_at = NOW() WHERE id = ${ch.id}`;
                results.push({ id: ch.id, name: ch.name, applied: true, modelsCount: upstreamModels.length });
            } catch (e: unknown) {
                results.push({ id: ch.id, name: ch.name, applied: false, error: e instanceof Error ? e.message : 'Error' });
            }
        }
        await refreshAllCaches();
        return { success: true, applied: results.filter(r => r.applied).length, total: results.length, results };
    })

    // --- Get Channel Key (root-only) ---
    .post('/channels/:id/key', async ({ params: { id }, set, user }: ElysiaCtx) => {
        if (user?.role !== 10) { set.status = 403; return { success: false, message: 'Root access required' }; }
        const [channel] = await sql`SELECT key FROM channels WHERE id = ${Number(id)} LIMIT 1`;
        if (!channel) { set.status = 404; return { success: false, message: 'Channel not found' }; }
        const decryptedKey = decryptChannelKeys(channel.key);
        return { success: true, key: decryptedKey };
    });
