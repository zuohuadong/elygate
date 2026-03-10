import { Elysia } from 'elysia';
import { authPlugin, assertModelAccess } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { circuitBreaker } from '../services/circuitBreaker';
import { billAndLog, preCheckAndDecrement, reconcileQuota } from '../services/billing';
import { calculateCost } from '../services/ratio';
import { ChannelType, getProviderHandler } from '../providers';

export const imagesRouter = new Elysia()
    .use(authPlugin)
    .post('/images/generations', async ({ body, token, user, set }: any) => {
        const { model, prompt, n = 1, size = '1024x1024' } = body as Record<string, any>;

        if (!prompt) {
            throw new Error("Missing 'prompt' field in request body");
        }

        const targetModel = model || 'dall-e-3';

        // --- Access Control ---
        assertModelAccess(user, token, targetModel, set);

        console.log(`[Images Request] UserID: ${user.id}, Token: ${token.name}, Model: ${targetModel}`);

        const candidateChannels = memoryCache.selectChannels(targetModel);

        if (!candidateChannels || candidateChannels.length === 0) {
            throw new Error(`No available channel found for model: ${targetModel}`);
        }

        let lastError: any = null;

        for (const channelConfig of candidateChannels) {
            const handler = getProviderHandler(channelConfig.type);

            const keys = channelConfig.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
            const activeKey = keys[Math.floor(Math.random() * keys.length)];

            const fetchHeaders = handler.buildHeaders(activeKey);

            let upstreamModel = targetModel;
            if (channelConfig.modelMapping && channelConfig.modelMapping[targetModel]) {
                upstreamModel = channelConfig.modelMapping[targetModel];
            }

            const transformedBody = { ...body, model: upstreamModel };

            let upstreamUrl = `${channelConfig.baseUrl}/v1/images/generations`;

            // Quota pre-decrement (prevents overdraft under high concurrency)
            const preDeducted = await preCheckAndDecrement({
                userId: user.id,
                tokenId: token.id,
                modelName: targetModel,
                userGroup: user.group,
                maxTokens: n
            });

            try {
                const response = await fetch(upstreamUrl, {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: JSON.stringify(transformedBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.warn(`[Retry Notice] Images Channel ${channelConfig.id} returned status ${response.status}. Detail: ${errorText}`);
                    await circuitBreaker.recordError(channelConfig.id, response.status);
                    throw new Error(`Status ${response.status}: ${errorText}`);
                }

                circuitBreaker.recordSuccess(channelConfig.id);

                const rawData = await response.json();

                const actualCost = calculateCost(targetModel, user.group, 0, n);

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
                    modelName: targetModel,
                    promptTokens: 0,
                    completionTokens: n,
                    userGroup: user.group,
                    isStream: false
                });

                return rawData;

            } catch (e: any) {
                await reconcileQuota({
                    userId: user.id,
                    tokenId: token.id,
                    preDeducted,
                    actualCost: 0
                });
                lastError = e;
                if (!e.message.startsWith('Status')) {
                    await circuitBreaker.recordError(channelConfig.id);
                }
                continue;
            }
        }

        throw new Error(`All candidate channels failed. Last upstream error: ${lastError?.message || 'Unknown network error'}`);
    });
