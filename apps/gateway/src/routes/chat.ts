import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { authPlugin } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { circuitBreaker } from '../services/circuitBreaker';
import { billAndLog, preCheckAndDecrement, reconcileQuota } from '../services/billing';
import { calculateCost } from '../services/ratio';
import { lookupSemanticCache, storeSemanticCache } from '../services/semanticCache';
import { ChannelType, ProviderHandler } from '../providers/types';
import { OpenAIApiHandler } from '../providers/openai';
import { GeminiApiHandler } from '../providers/gemini';
import { AnthropicApiHandler } from '../providers/anthropic';
import { AzureOpenAIApiHandler } from '../providers/azure';
import { BaiduApiHandler } from '../providers/baidu';
import { AliApiHandler } from '../providers/ali';
import { XunfeiApiHandler } from '../providers/xunfei';
import { MidjourneyApiHandler } from '../providers/mj';

// Assign the corresponding converter based on the channel type in the database
function getProviderHandler(type: number): ProviderHandler {
    switch (type) {
        case ChannelType.GEMINI:
            return new GeminiApiHandler();
        case ChannelType.ANTHROPIC:
            return new AnthropicApiHandler();
        case ChannelType.AZURE:
            return new AzureOpenAIApiHandler();
        case ChannelType.BAIDU:
            return new BaiduApiHandler();
        case ChannelType.ALI:
            return new AliApiHandler();
        case ChannelType.XUNFEI:
            return new XunfeiApiHandler();
        case ChannelType.MIDJOURNEY:
            return new MidjourneyApiHandler();
        case ChannelType.OPENAI:
        default:
            return new OpenAIApiHandler(); // Unknown or compatible channels default to OpenAI standard passthrough
    }
}

export const chatRouter = new Elysia()
    .use(authPlugin)
    .post('/completions', async ({ body, token, user, request, set }: any) => {
        // 1. Extract key information from request body
        const { model, stream } = body as Record<string, any>;

        if (!model) {
            throw new Error("Missing 'model' field in request body");
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

        console.log(`[Request] UserID: ${user.id}, Token: ${token.name}, Model: ${model}, Group: ${user.group}`);

        // 2. Dynamic Routing: Get candidate channel list based on model name and weight (Multi-channel failover)
        const candidateChannels = memoryCache.selectChannels(model);

        if (!candidateChannels || candidateChannels.length === 0) {
            throw new Error(`No available channel found for model: ${model}`);
        }

        let lastError: any = null;

        // Semantic Cache: pick an embedding channel for vector lookup
        const embeddingChannel = memoryCache.selectChannels('text-embedding-3-small')[0]
            ?? memoryCache.selectChannels('nomic-embed-text')[0];

        // --- Semantic Cache Lookup (Before upstream dispatch, non-stream only) ---
        if (embeddingChannel && !stream) {
            const userPrompt = Array.isArray(body.messages)
                ? body.messages.map((m: any) => m.content).join(' ')
                : '';
            const cachedResponse = await lookupSemanticCache(userPrompt, model, embeddingChannel);
            if (cachedResponse) {
                console.log(`[SemanticCache] HIT for model: ${model}`);
                return cachedResponse;
            }
        }
        // ---------------------------------------------------------------------------

        // 3. Iterate through channels for retry attempts
        for (const channelConfig of candidateChannels) {
            console.log(`[Dispatch] Targeting Channel ID: ${channelConfig.id}, Type: ${channelConfig.type}, Weight: ${channelConfig.weight}`);

            // Get Converter/Handler
            const handler = getProviderHandler(channelConfig.type);

            // Multi-key support: keys are separated by \n, pick one randomly
            const keys = channelConfig.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
            const activeKey = keys[Math.floor(Math.random() * keys.length)];

            const fetchHeaders = handler.buildHeaders(activeKey);

            // Check Model Mapping
            let upstreamModel = model;
            if (channelConfig.modelMapping && channelConfig.modelMapping[model]) {
                upstreamModel = channelConfig.modelMapping[model];
                console.log(`[Mapping] Model ${model} mapped to ${upstreamModel} for channel ${channelConfig.id}`);
            }

            const transformedBody = handler.transformRequest(body, upstreamModel);

            // 3.1 Quota Pre-decrement (To prevent overdraft)
            const preDeducted = await preCheckAndDecrement({
                userId: user.id,
                tokenId: token.id,
                modelName: model,
                userGroup: user.group,
                maxTokens: body.max_tokens || 4096
            });

            // Build Upstream URL
            let upstreamUrl = `${channelConfig.baseUrl}/v1/chat/completions`;

            if (channelConfig.type === ChannelType.GEMINI) {
                upstreamUrl = `${channelConfig.baseUrl}/v1beta/models/${upstreamModel}:generateContent`;
                if (stream) {
                    upstreamUrl = `${channelConfig.baseUrl}/v1beta/models/${upstreamModel}:streamGenerateContent?alt=sse`;
                }
            }

            try {
                const response = await fetch(upstreamUrl, {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: JSON.stringify(transformedBody)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.warn(`[Retry Notice] Channel ${channelConfig.id} returned status ${response.status}. Detail: ${errorText}`);
                    await circuitBreaker.recordError(channelConfig.id, response.status);
                    throw new Error(`Status ${response.status}: ${errorText}`);
                }

                circuitBreaker.recordSuccess(channelConfig.id);

                // 4. Handle SSE Stream Passthrough and Billing Interception
                if (stream && response.body) {
                    const [clientStream, billingStream] = response.body.tee();

                    (async () => {
                        try {
                            const reader = billingStream.getReader();
                            const decoder = new TextDecoder();
                            let totalCompletionLength = 0;

                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                totalCompletionLength += decoder.decode(value, { stream: true }).length;
                            }

                            // Rough estimation for streaming tokens
                            const estimatedCompletionTokens = Math.floor(totalCompletionLength / 3);
                            const estimatedPromptTokens = 0;

                            await billAndLog({
                                userId: user.id,
                                tokenId: token.id,
                                channelId: channelConfig.id,
                                modelName: model,
                                promptTokens: estimatedPromptTokens,
                                completionTokens: estimatedCompletionTokens,
                                userGroup: user.group,
                                isStream: true
                            });
                        } catch (e) {
                            console.error("[Stream Billing Error]", e);
                        }
                    })();

                    return new Response(clientStream, {
                        headers: {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive'
                        }
                    });
                }

                // If not streaming, return JSON object and handle protocol transformation
                const rawData = await response.json();
                const formattedData = handler.transformResponse(rawData);

                // Async: write to semantic cache (fire-and-forget)
                if (embeddingChannel && !stream) {
                    const userPrompt = Array.isArray(body.messages)
                        ? body.messages.map((m: any) => m.content).join(' ')
                        : '';
                    storeSemanticCache(userPrompt, model, formattedData, embeddingChannel).catch(e =>
                        console.warn('[SemanticCache] Store failed:', e)
                    );
                }

                // 5. Trigger Billing and Logging (Asynchronous)
                const { promptTokens, completionTokens } = handler.extractUsage(rawData);
                const actualCost = calculateCost(model, user.group, promptTokens, completionTokens);

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
                    completionTokens,
                    userGroup: user.group,
                    isStream: false
                });

                return formattedData;

            } catch (e: any) {
                // Refund quota on failure before moving to next channel
                await reconcileQuota({
                    userId: user.id,
                    tokenId: token.id,
                    preDeducted,
                    actualCost: 0
                });

                // Catch exceptions, log lastError, and continue to next channel in loop
                lastError = e;
                if (!e.message.startsWith('Status')) {
                    await circuitBreaker.recordError(channelConfig.id);
                }
                console.error(`[Channel Failed] Channel ID: ${channelConfig.id} failed. Error: ${e.message}`);
                continue;
            }
        }

        // All candidate channels failed, throw summarized error
        throw new Error(`All candidate channels failed. Last upstream error: ${lastError?.message || 'Unknown network error'}`);
    });
