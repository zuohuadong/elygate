import { Elysia, t } from 'elysia';
import { authPlugin } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { billAndLog, preCheckAndDecrement, reconcileQuota } from '../services/billing';
import { calculateCost } from '../services/ratio';
import { ChannelType, ProviderHandler } from '../providers/types';
import { JinaApiHandler } from '../providers/jina';
import { OpenAIApiHandler } from '../providers/openai';

function getRerankHandler(type: number): ProviderHandler {
    switch (type) {
        case ChannelType.JINA:
            return new JinaApiHandler();
        default:
            return new OpenAIApiHandler();
    }
}

export const rerankRouter = new Elysia({ prefix: '/v1' })
    .use(authPlugin)
    .post('/rerank', async ({ body, token, user, set }: any) => {
        const { model, query, documents } = body;
        if (!model || !query || !documents) {
            set.status = 400;
            throw new Error("Missing model, query, or documents");
        }

        // --- Phase 4 & 6: Access Control ---
        const groupModelKey = `group_models_${user.group}`;
        const allowedGroupModels = memoryCache.getOption(groupModelKey);
        if (allowedGroupModels && Array.isArray(allowedGroupModels) && !allowedGroupModels.includes(model)) {
            set.status = 403;
            throw new Error(`Your group '${user.group}' is not allowed to use model '${model}'`);
        }

        if (token.models && token.models.length > 0 && !token.models.includes(model)) {
            set.status = 403;
            throw new Error(`Your API key is not allowed to use model '${model}'`);
        }
        // ------------------------------------------

        const candidateChannels = memoryCache.selectChannels(model);
        if (candidateChannels.length === 0) {
            throw new Error(`No available channel for model: ${model}`);
        }

        let lastError = null;
        for (const channelConfig of candidateChannels) {
            const handler = getRerankHandler(channelConfig.type);
            const keys = channelConfig.key.split('\n').filter(Boolean);
            const activeKey = keys[Math.floor(Math.random() * keys.length)].trim();

            const preDeducted = await preCheckAndDecrement({
                userId: user.id,
                tokenId: token.id,
                modelName: model,
                userGroup: user.group,
                maxTokens: documents.length * 100 // Estimate 100 tokens per doc for rerank
            });

            try {
                const response = await fetch(`${channelConfig.baseUrl}/v1/rerank`, {
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
        throw lastError || new Error("Rerank failed");
    });
