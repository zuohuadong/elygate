import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { memoryCache } from '../../services/cache';
import { decryptChannelKeys, getChannelKeys } from '../../services/encryption';
import { refreshAllCaches } from './index';
import { checkAndResetSubscriptionQuota } from '../../services/subscription';

export const settingsRouter = new Elysia()
    // --- System Options ---
    .get('/options', async () => {
        const rows = await sql`SELECT key, value FROM options`;
        const options: Record<string, string> = {};
        for (const r of rows) options[r.key] = r.value;
        return options;
    })

    .put('/options', async ({ body }: any) => {
        const payload = body as Record<string, string>;
        
        const newEmbeddingModel = payload.SemanticCacheEmbeddingModel;
        if (newEmbeddingModel) {
            const channel = memoryCache.selectChannels(newEmbeddingModel)[0];
            if (channel) {
                try {
                    const keys = getChannelKeys(channel.key);
                    const activeKey = keys[Math.floor(Math.random() * keys.length)];
                    
                    const response = await fetch(`${channel.baseUrl}/v1/embeddings`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${activeKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ model: newEmbeddingModel, input: 'test' })
                    });
                    
                    if (response.ok) {
                        const data = await response.json() as any;
                        const dimension = data?.data?.[0]?.embedding?.length;
                        
                        if (dimension) {
                            await sql`DELETE FROM semantic_cache`;
                            console.log('[SemanticCache] Cleared old cache data');
                            
                            await sql`ALTER TABLE semantic_cache ALTER COLUMN embedding TYPE vector(${dimension})`;
                            console.log(`[SemanticCache] Updated embedding dimension to ${dimension}`);
                        }
                    }
                } catch (e: any) {
                    console.warn('[SemanticCache] Failed to update embedding dimension:', e.message);
                }
            }
        }
        
        for (const [key, value] of Object.entries(payload)) {
            await sql`
                INSERT INTO options (key, value)
                VALUES (${key}, ${value})
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            `;
        }
        refreshAllCaches().catch(console.error);
        return { success: true };
    })

    // --- Embedding Model Check ---
    .post('/check-embedding', async ({ body, set }: any) => {
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

            const response = await fetch(`${channel.baseUrl}/v1/embeddings`, {
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

            const data = await response.json() as any;
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
        } catch (e: any) {
            set.status = 500;
            return { success: false, message: e.message };
        }
    })

    // --- Schema Migrations ---
    .get('/migrate-cycles', async () => {
        try {
            await sql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS cycle_quota BIGINT DEFAULT 0`;
            await sql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS cycle_interval INTEGER DEFAULT 1`;
            await sql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS cycle_unit TEXT DEFAULT 'day'`;
            await sql`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS last_reset_at TIMESTAMPTZ DEFAULT NOW()`;
            
            await sql`ALTER TABLE packages ADD COLUMN IF NOT EXISTS cache_policy JSONB DEFAULT '{"mode": "default"}'`;
            await sql`ALTER TABLE semantic_cache ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`;
            
            return { success: true, message: 'Schema updated for subscription cycles & semantic cache' };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    })

    .get('/test-cycle-reset', async ({ user }: any) => {
        try {
            const [pkg] = await sql`
                INSERT INTO packages (name, description, price, duration_days, cycle_quota, cycle_interval, cycle_unit, is_public)
                VALUES ('Test Cycle Pkg', 'Debug reset logic', 0, 30, 1000000, 1, 'hour', false)
                RETURNING id
            `;

            const [sub] = await sql`
                INSERT INTO user_subscriptions (user_id, package_id, start_time, end_time, status, last_reset_at)
                VALUES (${user.id}, ${pkg.id}, NOW() - INTERVAL '2 hours', NOW() + INTERVAL '30 days', 1, NOW() - INTERVAL '2 hours')
                RETURNING id
            `;

            await checkAndResetSubscriptionQuota(user.id);

            const [updatedUser] = await sql`SELECT quota FROM users WHERE id = ${user.id}`;

            return { 
                success: true, 
                message: 'Test completed', 
                newQuota: updatedUser.quota,
                packageId: pkg.id,
                subId: sub.id
            };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    });
