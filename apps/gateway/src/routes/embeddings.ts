import { Elysia } from 'elysia';
import { authPlugin, assertModelAccess } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { circuitBreaker } from '../services/circuitBreaker';
import { billAndLog, preCheckAndDecrement, reconcileQuota } from '../services/billing';
import { calculateCost } from '../services/ratio';
import { ChannelType, getProviderHandler } from '../providers';

export const embeddingsRouter = new Elysia()
    .use(authPlugin)
    .post('/embeddings', async ({ body, token, user, set }: any) => {
        const { model, input } = body as Record<string, any>;

        if (!model) {
            throw new Error("Missing 'model' field in request body");
        }

        if (!input) {
            throw new Error("Missing 'input' field in request body");
        }

        // --- Access Control ---
        assertModelAccess(user, token, model, set);

        console.log(`[Embeddings Request] UserID: ${user.id}, Token: ${token.name}, Model: ${model}`);

        const candidateChannels = memoryCache.selectChannels(model);

        if (!candidateChannels || candidateChannels.length === 0) {
            throw new Error(`No available channel found for model: ${model}`);
        }

        let lastError: any = null;

        for (const channelConfig of candidateChannels) {
            const handler = getProviderHandler(channelConfig.type);

            const keys = channelConfig.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
            const activeKey = keys[Math.floor(Math.random() * keys.length)];

            const fetchHeaders = handler.buildHeaders(activeKey);

            let upstreamModel = model;
            if (channelConfig.modelMapping && channelConfig.modelMapping[model]) {
                upstreamModel = channelConfig.modelMapping[model];
            }

            const transformedBody = { ...body, model: upstreamModel };

            let upstreamUrl = `${channelConfig.baseUrl}/v1/embeddings`;

            // Estimate token count for pre-decrement
            const estimatedTokens = typeof input === 'string'
                ? Math.ceil(input.length / 4)
                : Array.isArray(input) ? input.reduce((sum: number, s: any) => sum + (typeof s === 'string' ? Math.ceil(s.length / 4) : 1), 0) : 100;

            const preDeducted = await preCheckAndDecrement({
                userId: user.id,
                tokenId: token.id,
                modelName: model,
                userGroup: user.group,
                maxTokens: estimatedTokens
            });

            try {
                const response = await fetch(upstreamUrl, {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: JSON.stringify(transformedBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.warn(`[Retry Notice] Embeddings Channel ${channelConfig.id} returned status ${response.status}. Detail: ${errorText}`);
                    await circuitBreaker.recordError(channelConfig.id, response.status);
                    throw new Error(`Status ${response.status}: ${errorText}`);
                }

                circuitBreaker.recordSuccess(channelConfig.id);

                const rawData = await response.json();

                const usage = rawData.usage || {};
                const promptTokens = usage.prompt_tokens || usage.total_tokens || 0;

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
