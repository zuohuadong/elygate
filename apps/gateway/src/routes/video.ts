import { Elysia } from 'elysia';
import { authPlugin, assertModelAccess } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { billAndLog, preCheckAndDecrement, reconcileQuota } from '../services/billing';
import { calculateCost } from '../services/ratio';
import { ChannelType, getProviderHandler } from '../providers';

export const videoRouter = new Elysia({ prefix: '/v1/video' })
    .use(authPlugin)
    .post('/generations', async ({ body, token, user, set }: any) => {
        const { model, prompt } = body;
        if (!model || !prompt) {
            set.status = 400;
            throw new Error("Missing model or prompt");
        }

        // --- Phase 4 & 6: Access Control ---
        assertModelAccess(user, token, model, set);
        // ------------------------------------------

        const candidateChannels = memoryCache.selectChannels(model);
        if (candidateChannels.length === 0) {
            throw new Error(`No available channel for model: ${model}`);
        }

        let lastError = null;
        for (const channelConfig of candidateChannels) {
            const handler = getProviderHandler(channelConfig.type);
            const keys = channelConfig.key.split('\n').filter(Boolean);
            const activeKey = keys[Math.floor(Math.random() * keys.length)].trim();

            const preDeducted = await preCheckAndDecrement({
                userId: user.id,
                tokenId: token.id,
                modelName: model,
                userGroup: user.group,
                maxTokens: 5000 // High fixed cost for video
            });

            try {
                // Video generation is often async, path might vary
                const url = channelConfig.baseUrl.endsWith('/') ? channelConfig.baseUrl : `${channelConfig.baseUrl}/`;
                const response = await fetch(`${url}v1/video/generations`, {
                    method: 'POST',
                    headers: handler.buildHeaders(activeKey),
                    body: JSON.stringify(handler.transformRequest(body, model))
                });

                if (!response.ok) {
                    throw new Error(`Upstream Error: ${response.status}`);
                }

                const data = await response.json();
                const { promptTokens } = handler.extractUsage(data);
                const actualCost = calculateCost(model, user.group, promptTokens, 0);

                await reconcileQuota({
                    userId: user.id,
                    tokenId: token.id,
                    preDeducted,
                    actualCost
                });

                await billAndLog({
                    userId: user.id,
                    tokenId: token.id,
                    channelId: channelConfig.id,
                    modelName: model,
                    promptTokens,
                    completionTokens: 0,
                    userGroup: user.group,
                    isStream: false
                });

                return data;
            } catch (e: any) {
                await reconcileQuota({
                    userId: user.id,
                    tokenId: token.id,
                    preDeducted,
                    actualCost: 0
                });
                lastError = e;
                continue;
            }
        }
        throw lastError || new Error("Video generation failed");
    });
