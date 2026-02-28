import { Elysia } from 'elysia';
import { authPlugin } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { billAndLog } from '../services/billing';
import { ChannelType, ProviderHandler } from '../providers/types';
import { OpenAIApiHandler } from '../providers/openai';
import { AzureOpenAIApiHandler } from '../providers/azure';

function getProviderHandler(type: number): ProviderHandler {
    switch (type) {
        case ChannelType.AZURE:
            return new AzureOpenAIApiHandler();
        case ChannelType.OPENAI:
        default:
            return new OpenAIApiHandler();
    }
}

export const imagesRouter = new Elysia()
    .use(authPlugin)
    .post('/images/generations', async ({ body, token, user }: any) => {
        const { model, prompt, n = 1, size = '1024x1024' } = body as Record<string, any>;

        if (!prompt) {
            throw new Error("Missing 'prompt' field in request body");
        }

        // Default image model if not provided, though clients typically provide one like 'dall-e-3'
        const targetModel = model || 'dall-e-3';

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

            try {
                const response = await fetch(upstreamUrl, {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: JSON.stringify(transformedBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.warn(`[Retry Notice] Images Channel ${channelConfig.id} returned status ${response.status}. Detail: ${errorText}`);
                    throw new Error(`Status ${response.status}: ${errorText}`);
                }

                const rawData = await response.json();

                // Image generation billing logic:
                // Instead of token counts, we treat `promptTokens` as `0` and use `completionTokens` to pass a custom weight unit (e.g., number of images generated) 
                // Or handle images uniquely in the billing service soon. For now we pass 'n' (image count) as usage.

                await billAndLog({
                    userId: user.id,
                    tokenId: token.id,
                    channelId: channelConfig.id,
                    modelName: targetModel,
                    promptTokens: 0,
                    completionTokens: n, // Using completionTokens to carry 'n' images count
                    userGroup: user.group,
                    isStream: false
                });

                return rawData;

            } catch (e: any) {
                lastError = e;
                continue;
            }
        }

        throw new Error(`All candidate channels failed. Last upstream error: ${lastError?.message || 'Unknown network error'}`);
    });
