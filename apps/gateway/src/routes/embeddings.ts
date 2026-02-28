import { Elysia } from 'elysia';
import { authPlugin } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { billAndLog } from '../services/billing';
import { ChannelType, ProviderHandler } from '../providers/types';
import { OpenAIApiHandler } from '../providers/openai';
import { GeminiApiHandler } from '../providers/gemini';
import { AnthropicApiHandler } from '../providers/anthropic';
import { AzureOpenAIApiHandler } from '../providers/azure';

function getProviderHandler(type: number): ProviderHandler {
    switch (type) {
        case ChannelType.GEMINI:
            return new GeminiApiHandler();
        case ChannelType.ANTHROPIC:
            return new AnthropicApiHandler();
        case ChannelType.AZURE:
            return new AzureOpenAIApiHandler();
        case ChannelType.OPENAI:
        default:
            return new OpenAIApiHandler();
    }
}

export const embeddingsRouter = new Elysia()
    .use(authPlugin)
    .post('/embeddings', async ({ body, token, user }: any) => {
        const { model, input } = body as Record<string, any>;

        if (!model) {
            throw new Error("Missing 'model' field in request body");
        }

        if (!input) {
            throw new Error("Missing 'input' field in request body");
        }

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

            // Note: Transform might need adjustments for non-chat contexts depending on the provider, 
            // but for standard OpenAI API, embeddings body is `{ input, model }`.
            const transformedBody = { ...body, model: upstreamModel };

            let upstreamUrl = `${channelConfig.baseUrl}/v1/embeddings`;

            try {
                const response = await fetch(upstreamUrl, {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: JSON.stringify(transformedBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.warn(`[Retry Notice] Embeddings Channel ${channelConfig.id} returned status ${response.status}. Detail: ${errorText}`);
                    throw new Error(`Status ${response.status}: ${errorText}`);
                }

                const rawData = await response.json();

                // Note: Usage extraction might be slightly different for embeddings,
                // but standard OpenAI returns `{ prompt_tokens: X, total_tokens: X }`.
                // Embeddings don't have completion_tokens.
                const usage = rawData.usage || {};
                const promptTokens = usage.prompt_tokens || usage.total_tokens || 0;

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

                // Return rawData as it usually conforms to the `{ object: 'list', data: [...] }` standard
                return rawData;

            } catch (e: any) {
                lastError = e;
                continue;
            }
        }

        throw new Error(`All candidate channels failed. Last upstream error: ${lastError?.message || 'Unknown network error'}`);
    });
