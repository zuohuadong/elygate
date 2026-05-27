import type { ElysiaCtx } from '../../types';
import { log } from '../../services/logger';
import { getErrorMessage } from '../../utils/error';
import { Elysia } from 'elysia';
import { db } from '@elygate/db';
import { options, packages, semanticCache, userSubscriptions, users } from '@elygate/db/schema';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { memoryCache } from '../../services/cache';
import { decryptChannelKeys, getChannelKeys } from '../../services/encryption';
import { refreshAllCaches } from './index';
import { checkAndResetSubscriptionQuota } from '../../services/subscription';
import { safeExternalFetch } from '../../utils/safeExternalUrl';

export const settingsRouter = new Elysia()
    // --- System Options ---
    .get('/options', async () => {
        const rows = await db.select({ key: options.key, value: options.value }).from(options);
        const result: Record<string, string> = {};
        for (const r of rows) result[r.key] = r.value;
        return result;
    })

    .put('/options', async ({ body }: ElysiaCtx) => {
        const payload = body as Record<string, string>;
        
        const newEmbeddingModel = payload.SemanticCacheEmbeddingModel;
        if (newEmbeddingModel) {
            const channel = memoryCache.selectChannels(newEmbeddingModel)[0];
            if (channel) {
                try {
                    const keys = getChannelKeys(channel.key);
                    const activeKey = keys[Math.floor(Math.random() * keys.length)];
                    
                    const response = await safeExternalFetch(`${channel.baseUrl}/v1/embeddings`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${activeKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ model: newEmbeddingModel, input: 'test' })
                    });
                    
                    if (response.ok) {
                        const data = await response.json() as Record<string, any>;
                        const dimension = data?.data?.[0]?.embedding?.length;
                        
                        if (dimension) {
                            await db.delete(semanticCache);
                            log.info('[SemanticCache] Cleared old cache data');
                            
                            await db.execute(drizzleSql`ALTER TABLE semantic_cache ALTER COLUMN embedding TYPE vector(${dimension})`);
                            log.info(`[SemanticCache] Updated embedding dimension to ${dimension}`);
                        }
                    }
                } catch (e: unknown) {
                    log.warn('[SemanticCache] Failed to update embedding dimension:', getErrorMessage(e));
                }
            }
        }
        
        for (const [key, value] of Object.entries(payload)) {
            await db.insert(options).values({ key, value })
                .onConflictDoUpdate({ target: options.key, set: { value } });
        }
        refreshAllCaches().catch((e: unknown) => log.error("[Async]", e));
        return { success: true };
    })

    // --- Embedding Model Check ---
    .post('/check-embedding', async ({ body, set }: ElysiaCtx) => {
        try {
            const { model } = body as { model: string };
            if (!model) {
                set.status = 400;
                return { success: false, message: 'Model name is required' };
            }

            const channel = memoryCache.selectChannels(model)[0];
            if (!channel) {
                return { 
                    success: false, 
                    message: `No channel found with embedding model: ${model}` 
                };
            }

            const keys = getChannelKeys(channel.key);
            const activeKey = keys[Math.floor(Math.random() * keys.length)];

            const response = await safeExternalFetch(`${channel.baseUrl}/v1/embeddings`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${activeKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ model, input: 'test' })
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `API returned ${response.status}`;
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
                } catch {
                    // Use default message
                }
                return { 
                    success: false, 
                    message: errorMessage,
                    channel: channel.name
                };
            }

            const data = await response.json() as Record<string, any>;
            const embedding = data?.data?.[0]?.embedding;
            
            if (!embedding || !Array.isArray(embedding)) {
                return { 
                    success: false, 
                    message: 'Invalid embedding response',
                    channel: channel.name
                };
            }

            return { 
                success: true, 
                message: `Embedding model is working (dimension: ${embedding.length})`,
                channel: channel.name
            };
        } catch (e: unknown) {
            set.status = 500;
            return { success: false, message: getErrorMessage(e) };
        }
    })

    // --- Schema Migrations ---
    .get('/migrate-cycles', async () => {
        try {
            await db.execute(drizzleSql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS cycle_quota BIGINT DEFAULT 0`);
            await db.execute(drizzleSql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS cycle_interval INTEGER DEFAULT 1`);
            await db.execute(drizzleSql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS cycle_unit TEXT DEFAULT 'day'`);
            await db.execute(drizzleSql`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ DEFAULT NOW()`);
            
            await db.execute(drizzleSql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS cache_policy JSONB DEFAULT '{"mode": "default"}'`);
            await db.execute(drizzleSql`ALTER TABLE semantic_cache ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
            
            return { success: true, message: 'Schema updated for subscription cycles & semantic cache' };
        } catch (e: unknown) {
            return { success: false, message: getErrorMessage(e) };
        }
    })

    .get('/test-cycle-reset', async ({ user }: ElysiaCtx) => {
        try {
            const [pkg] = await db.insert(packages).values({
                name: 'Test Cycle Pkg',
                description: 'Debug reset logic',
                price: '0',
                durationDays: 30,
                cycleQuota: 1000000,
                cycleInterval: 1,
                cycleUnit: 'hour',
                isPublic: false,
            }).returning({ id: packages.id });

            const [sub] = await db.insert(userSubscriptions).values({
                userId: user.id,
                packageId: pkg.id,
                startTime: new Date(Date.now() - 2 * 3600000),
                endTime: new Date(Date.now() + 30 * 86400000),
                status: 1,
                lastResetAt: new Date(Date.now() - 2 * 3600000),
            }).returning({ id: userSubscriptions.id });

            await checkAndResetSubscriptionQuota(user.id);

            const [updatedUser] = await db.select({ quota: users.quota }).from(users).where(eq(users.id, user.id));

            return { 
                success: true, 
                message: 'Test completed', 
                newQuota: updatedUser.quota,
                packageId: pkg.id,
                subId: sub.id
            };
        } catch (e: unknown) {
            return { success: false, message: getErrorMessage(e) };
        }
    });
