import type { ElysiaCtx } from '../types';
import { config } from '../config';
import { log } from '../services/logger';
import { getErrorMessage } from '../utils/error';
import { Elysia } from 'elysia';
import { authPlugin } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { circuitBreaker } from '../services/circuitBreaker';
import { billAndLog, preCheckAndDecrement, reconcileQuota } from '../services/billing';
import { MidjourneyApiHandler } from '../providers/mj';
import { db, sql } from '@elygate/db';
import { mjTasks } from '@elygate/db/schema';
import { eq, and } from 'drizzle-orm';

function generateTaskId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export const mjRouter = new Elysia()
    .use(authPlugin)

    .post('/mj/submit/imagine', async ({ body, token, user, set }: ElysiaCtx) => {
        const { prompt, base64Array, notifyHook, state } = body as Record<string, any>;

        if (!prompt) {
            set.status = 400;
            return { code: 4, description: "Prompt required" };
        }

        const targetModel = 'mj-chat';

        const costToDeduct = await preCheckAndDecrement({
            userId: user.id,
            tokenId: token.id,
            modelName: targetModel,
            userGroup: user.group,
            maxTokens: 1
        });

        const candidateChannels = memoryCache.selectChannels(targetModel);
        if (!candidateChannels || candidateChannels.length === 0) {
            await reconcileQuota({
                userId: user.id, tokenId: token.id, preDeducted: costToDeduct, actualCost: 0
            });
            set.status = 500;
            return { code: 4, description: "No MJ channels available" };
        }

        const channelConfig = candidateChannels[0];
        const handler = MidjourneyApiHandler;
        const keys = channelConfig.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
        const activeKey = keys[Math.floor(Math.random() * keys.length)];

        const fetchHeaders = handler.buildHeaders(activeKey);
        const upstreamBody = { ...body };
        const upstreamUrl = `${channelConfig.baseUrl}/mj/submit/imagine`;

        try {
            const response = await fetch(upstreamUrl, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify(upstreamBody)
            });

            const rawData = await response.json();

            if (response.ok && rawData.code === 1) {
                const taskId = rawData.result;

                await db.insert(mjTasks).values({
                    userId: user.id,
                    uuid: taskId,
                    action: 'IMAGINE',
                    prompt,
                    status: 'SUBMITTED',
                    progress: '0%',
                });

                await billAndLog({
                    userId: user.id,
                    tokenId: token.id,
                    channelId: channelConfig.id,
                    modelName: targetModel,
                    promptTokens: 0,
                    completionTokens: 1,
                    userGroup: user.group,
                    isStream: false
                });

                return rawData;
            } else {
                throw new Error(`Upstream MJ Failed: ${JSON.stringify(rawData)}`);
            }
        } catch (e: unknown) {
            await reconcileQuota({
                userId: user.id, tokenId: token.id, preDeducted: costToDeduct, actualCost: 0
            });
            set.status = 500;
            return { code: 4, description: getErrorMessage(e) };
        }
    })

    .post('/mj/submit/action', async ({ body, token, user, set }: ElysiaCtx) => {
        const { customId, taskId, state } = body as Record<string, any>;

        if (!customId) return { code: 4, description: "customId required" };

        const targetModel = 'mj-chat';

        const costToDeduct = await preCheckAndDecrement({
            userId: user.id,
            tokenId: token.id,
            modelName: targetModel,
            userGroup: user.group,
            maxTokens: 1
        });

        const candidateChannels = memoryCache.selectChannels(targetModel);
        if (!candidateChannels || !candidateChannels[0]) {
            await reconcileQuota({
                userId: user.id, tokenId: token.id, preDeducted: costToDeduct, actualCost: 0
            });
            return { code: 4, description: "No channels" };
        }

        const channelConfig = candidateChannels[0];
        const handler = MidjourneyApiHandler;
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
                const [original] = await db.select({ prompt: mjTasks.prompt })
                    .from(mjTasks)
                    .where(eq(mjTasks.uuid, taskId));

                await db.insert(mjTasks).values({
                    userId: user.id,
                    uuid: newTaskId,
                    action: 'ACTION',
                    prompt: original ? original.prompt : 'Action',
                    status: 'SUBMITTED',
                    progress: '0%',
                });

                await billAndLog({
                    userId: user.id, tokenId: token.id, channelId: channelConfig.id,
                    modelName: targetModel, promptTokens: 0, completionTokens: 1, userGroup: user.group, isStream: false
                });

                return rawData;
            } else {
                throw new Error(JSON.stringify(rawData));
            }
        } catch (e: unknown) {
            await reconcileQuota({
                userId: user.id, tokenId: token.id, preDeducted: costToDeduct, actualCost: 0
            });
            return { code: 4, description: getErrorMessage(e) };
        }
    })

    .get('/mj/task/:id/fetch', async ({ params: { id }, token, user }: ElysiaCtx) => {
        const [task] = await db.select()
            .from(mjTasks)
            .where(and(eq(mjTasks.uuid, id), eq(mjTasks.userId, user.id)));

        if (!task) {
            return { code: 4, description: "Task not found." };
        }

        if (task.status === 'SUCCESS' || task.status === 'FAILED') {
            return {
                id: task.uuid,
                action: task.action,
                prompt: task.prompt,
                status: task.status,
                progress: task.progress,
                imageUrl: task.imageUrl,
                failReason: task.failReason
            };
        }

        const targetModel = 'mj-chat';
        const candidateChannels = memoryCache.selectChannels(targetModel);
        if (candidateChannels && candidateChannels[0]) {
            const channelConfig = candidateChannels[0];
            const handler = MidjourneyApiHandler;
            const activeKey = channelConfig.key.split('\n')[0].trim();

            try {
                const upstreamUrl = `${channelConfig.baseUrl}/mj/task/${id}/fetch`;
                const response = await fetch(upstreamUrl, {
                    headers: handler.buildHeaders(activeKey)
                });

                if (response.ok) {
                    const upstreamData = await response.json();
                    await db.update(mjTasks)
                        .set({
                            status: upstreamData.status || 'IN_PROGRESS',
                            progress: upstreamData.progress || '50%',
                            imageUrl: upstreamData.imageUrl || null,
                            failReason: upstreamData.failReason || null,
                        })
                        .where(eq(mjTasks.uuid, id));
                    return upstreamData;
                }
            } catch (e: unknown) {
                log.error("[MJ Fetch] Error proxying fetch to upstream", getErrorMessage(e));
            }
        }

        return {
            id: task.uuid,
            action: task.action,
            prompt: task.prompt,
            status: task.status,
            progress: task.progress,
            imageUrl: task.imageUrl
        };
    })

    .post('/mj/webhook', async ({ body, request, set }: ElysiaCtx) => {
        const webhookSecret = config.mjWebhookSecret;
        if (webhookSecret) {
            const authHeader = request.headers.get('authorization') || '';
            if (authHeader !== `Bearer ${webhookSecret}`) {
                set.status = 401;
                return { success: false, message: 'Unauthorized webhook call' };
            }
        }

        const { id, status, imageUrl, progress, failReason } = body as Record<string, any>;
        if (!id) return { success: false };

        await db.update(mjTasks)
            .set({
                status,
                progress,
                imageUrl,
                failReason,
                finishTime: new Date(),
            })
            .where(eq(mjTasks.uuid, id));

        log.info(`[MJ Webhook] Task ${id} updated -> ${status}`);
        return { success: true };
    });
