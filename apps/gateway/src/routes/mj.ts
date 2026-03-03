import { Elysia } from 'elysia';
import { authPlugin } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { circuitBreaker } from '../services/circuitBreaker';
import { billAndLog } from '../services/billing';
import { MidjourneyApiHandler } from '../providers/mj';
import { sql } from '@elygate/db';

/**
 * Generates a random MJ-like taskId
 */
function generateTaskId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export const mjRouter = new Elysia()
    .use(authPlugin)

    // --- Submit Imagine (Text to Image) ---
    .post('/mj/submit/imagine', async ({ body, token, user, set }: any) => {
        const { prompt, base64Array, notifyHook, state } = body as any;

        if (!prompt) {
            set.status = 400;
            return { code: 4, description: "Prompt required" };
        }

        // MJ models are usually defined like "mj-chat" or "midjourney" in the channel
        const targetModel = 'mj-chat';

        // Deduct 1 MJ action cost synchronously before forwarding
        // (Assuming 1 command = 1 credit or handled via FixedCostModels)
        const costToDeduct = await import('../services/billing').then(m => m.preCheckAndDecrement({
            userId: user.id,
            tokenId: token.id,
            modelName: targetModel,
            userGroup: user.group,
            maxTokens: 1 // For MJ, completion counts as 1 action
        }));

        const candidateChannels = memoryCache.selectChannels(targetModel);
        if (!candidateChannels || candidateChannels.length === 0) {
            // Refund on failure
            await import('../services/billing').then(m => m.reconcileQuota({
                userId: user.id, tokenId: token.id, preDeducted: costToDeduct, actualCost: 0
            }));
            set.status = 500;
            return { code: 4, description: "No MJ channels available" };
        }

        const channelConfig = candidateChannels[0]; // Just take first
        const handler = new MidjourneyApiHandler();
        const keys = channelConfig.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
        const activeKey = keys[Math.floor(Math.random() * keys.length)];

        const fetchHeaders = handler.buildHeaders(activeKey);

        // Keep the original mj-proxy body
        const upstreamBody = { ...body };
        const upstreamUrl = `${channelConfig.baseUrl}/mj/submit/imagine`;

        try {
            const response = await fetch(upstreamUrl, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify(upstreamBody)
            });

            const rawData = await response.json();

            // Expected Success from MJ Proxy: { "code": 1, "description": "Submit success", "result": "uuid-1234..." }
            if (response.ok && rawData.code === 1) {
                // Record task locally
                const taskId = rawData.result;

                await sql`
                    INSERT INTO mj_tasks (user_id, uuid, action, prompt, status, progress)
                    VALUES (${user.id}, ${taskId}, 'IMAGINE', ${prompt}, 'SUBMITTED', '0%')
                `;

                // Log final usage
                await billAndLog({
                    userId: user.id,
                    tokenId: token.id,
                    channelId: channelConfig.id,
                    modelName: targetModel,
                    promptTokens: 0,
                    completionTokens: 1, // 1 Action
                    userGroup: user.group,
                    isStream: false
                });

                return rawData;
            } else {
                throw new Error(`Upstream MJ Failed: ${JSON.stringify(rawData)}`);
            }
        } catch (e: any) {
            // Refund quota if submit failed
            await import('../services/billing').then(m => m.reconcileQuota({
                userId: user.id, tokenId: token.id, preDeducted: costToDeduct, actualCost: 0
            }));
            set.status = 500;
            return { code: 4, description: e.message };
        }
    })

    // --- Submit Action (U1, V2, Reroll) ---
    .post('/mj/submit/action', async ({ body, token, user, set }: any) => {
        const { customId, taskId, state } = body as any;

        if (!customId) return { code: 4, description: "customId required" };

        const targetModel = 'mj-chat';

        // Action is cheaper or same as imagine, handled by proxy. 
        // We will charge it as 1 action as well.
        const costToDeduct = await import('../services/billing').then(m => m.preCheckAndDecrement({
            userId: user.id,
            tokenId: token.id,
            modelName: targetModel,
            userGroup: user.group,
            maxTokens: 1
        }));

        const candidateChannels = memoryCache.selectChannels(targetModel);
        if (!candidateChannels || !candidateChannels[0]) {
            await import('../services/billing').then(m => m.reconcileQuota({
                userId: user.id, tokenId: token.id, preDeducted: costToDeduct, actualCost: 0
            }));
            return { code: 4, description: "No channels" };
        }

        const channelConfig = candidateChannels[0];
        const handler = new MidjourneyApiHandler();
        const activeKey = channelConfig.key.split('\n')[0].trim();
        const fetchHeaders = handler.buildHeaders(activeKey);
        const upstreamUrl = `${channelConfig.baseUrl}/mj/submit/action`;

        try {
            const response = await fetch(upstreamUrl, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify(body)
            });

            const rawData = await response.json();

            if (response.ok && rawData.code === 1) {
                const newTaskId = rawData.result;
                // Look up original prompt if available to save
                const [original] = await sql`SELECT prompt FROM mj_tasks WHERE uuid = ${taskId}`;

                await sql`
                    INSERT INTO mj_tasks (user_id, uuid, action, prompt, status, progress)
                    VALUES (${user.id}, ${newTaskId}, 'ACTION', ${original ? original.prompt : 'Action'}, 'SUBMITTED', '0%')
                `;

                // Log Usage
                await billAndLog({
                    userId: user.id, tokenId: token.id, channelId: channelConfig.id,
                    modelName: targetModel, promptTokens: 0, completionTokens: 1, userGroup: user.group, isStream: false
                });

                return rawData;
            } else {
                throw new Error(JSON.stringify(rawData));
            }
        } catch (e: any) {
            await import('../services/billing').then(m => m.reconcileQuota({
                userId: user.id, tokenId: token.id, preDeducted: costToDeduct, actualCost: 0
            }));
            return { code: 4, description: e.message };
        }
    })

    // --- Task Fetch (Polling) ---
    .get('/mj/task/:id/fetch', async ({ params: { id }, token, user }: any) => {
        // Find task in local DB
        const [task] = await sql`SELECT * FROM mj_tasks WHERE uuid = ${id} AND user_id = ${user.id}`;

        if (!task) {
            return { code: 4, description: "Task not found." };
        }

        // Check if finished locally already (via webhook)
        if (task.status === 'SUCCESS' || task.status === 'FAILED') {
            return {
                id: task.uuid,
                action: task.action,
                prompt: task.prompt,
                status: task.status,
                progress: task.progress,
                imageUrl: task.image_url,
                failReason: task.fail_reason
            };
        }

        // If still in progress, we proxy the fetch to upstream to poll the actual state
        const targetModel = 'mj-chat';
        const candidateChannels = memoryCache.selectChannels(targetModel);
        if (candidateChannels && candidateChannels[0]) {
            const channelConfig = candidateChannels[0];
            const handler = new MidjourneyApiHandler();
            const activeKey = channelConfig.key.split('\n')[0].trim();

            try {
                const upstreamUrl = `${channelConfig.baseUrl}/mj/task/${id}/fetch`;
                const response = await fetch(upstreamUrl, {
                    headers: handler.buildHeaders(activeKey)
                });

                if (response.ok) {
                    const upstreamData = await response.json();
                    // Update local db with current status
                    await sql`
                        UPDATE mj_tasks 
                        SET status = ${upstreamData.status || 'IN_PROGRESS'},
                            progress = ${upstreamData.progress || '50%'},
                            image_url = ${upstreamData.imageUrl || null},
                            fail_reason = ${upstreamData.failReason || null}
                        WHERE uuid = ${id}
                    `;
                    return upstreamData;
                }
            } catch (e: any) {
                console.error("[MJ Fetch] Error proxying fetch to upstream", e.message);
            }
        }

        // Fallback to Return local db state
        return {
            id: task.uuid,
            action: task.action,
            prompt: task.prompt,
            status: task.status,
            progress: task.progress,
            imageUrl: task.image_url
        };
    })

    // --- Webhook Consumer (Upstream posts here when done) ---
    .post('/mj/webhook', async ({ body }: any) => {
        // MJ Proxy upstream sends result here
        const { id, status, imageUrl, progress, failReason } = body as any;
        if (!id) return { success: false };

        await sql`
            UPDATE mj_tasks 
            SET status = ${status},
                progress = ${progress},
                image_url = ${imageUrl},
                fail_reason = ${failReason},
                finish_time = CURRENT_TIMESTAMP
            WHERE uuid = ${id}
        `;

        console.log(`[MJ Webhook] Task ${id} updated -> ${status}`);
        return { success: true };
    });
