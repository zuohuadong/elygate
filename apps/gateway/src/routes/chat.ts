import { Elysia } from 'elysia';
import { sql } from '@elygate/db';
import { assertModelAccess } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { circuitBreaker } from '../services/circuitBreaker';
import { billAndLog, preCheckAndDecrement, reconcileQuota } from '../services/billing';
import { calculateCost } from '../services/ratio';
import { lookupSemanticCache, storeSemanticCache } from '../services/semanticCache';
import { ChannelType, getProviderHandler } from '../providers';
import { decryptChannelKeys } from '../services/encryption';
import { optionCache } from '../services/optionCache';
import { type TokenRecord, type UserRecord, type ChannelConfig } from '../types';

export const chatRouter = new Elysia()
    .post('/chat/completions', async ({ body, token, user, request, set }: any) => {
        const u = user as UserRecord;
        const t = token as TokenRecord;
        const startTime = Date.now();
        // 1. Extract key information from request body
        const { model, stream } = body as Record<string, any>;

        if (!model) {
            throw new Error("Missing 'model' field in request body");
        }

        // --- Phase 4 & 6: Access Control ---
        assertModelAccess(user, token, model, set);
        // ------------------------------------------

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';

        console.log(`[Request] UserID: ${user.id}, Token: ${token.name}, Model: ${model}, Group: ${user.group}, IP: ${ip}`);

        // 2. Dynamic Routing: Get candidate channel list based on model name and weight (Multi-channel failover)
        const candidateChannels = memoryCache.selectChannels(model);

        if (!candidateChannels || candidateChannels.length === 0) {
            throw new Error(`No available channel found for model: ${model}`);
        }

        let lastError: any = null;

        // Semantic Cache: pick an embedding channel for vector lookup
        // NOTE: We fetch from memoryCache which is refreshed on channel updates
        // If channel key is updated, call /api/admin/channels/sync or restart elygate
        let embeddingChannel: any = null;
        let embeddingModel: string | undefined;
        
        // Get embedding model from system settings
        const configuredEmbeddingModel = optionCache.get('SemanticCacheEmbeddingModel');
        
        if (configuredEmbeddingModel) {
            // Use the configured embedding model
            const channel = memoryCache.selectChannels(configuredEmbeddingModel)[0];
            if (channel) {
                embeddingChannel = channel;
                embeddingModel = configuredEmbeddingModel;
            }
        }
        
        // Fallback: try to find an embedding channel if not configured
        if (!embeddingChannel) {
            const embeddingCandidates = [
                { model: 'BAAI/bge-large-zh-v1.5', alias: 'bge-large-zh-v1.5' },
                { model: 'BAAI/bge-large-en-v1.5', alias: 'bge-large-en-v1.5' },
                { model: 'BAAI/bge-m3', alias: 'bge-m3' },
                { model: 'Pro/BAAI/bge-m3', alias: 'Pro/bge-m3' },
                { model: 'Qwen/Qwen3-Embedding-8B', alias: 'Qwen3-Embedding-8B' },
                { model: 'text-embedding-3-small', alias: 'text-embedding-3-small' },
                { model: 'text-embedding-3-large', alias: 'text-embedding-3-large' },
                { model: 'baai/bge-m3', alias: 'baai/bge-m3' },
                { model: 'nvidia/nv-embed-v1', alias: 'nv-embed-v1' },
                { model: 'models/gemini-embedding-001', alias: 'gemini-embedding-001' },
                { model: 'nomic-embed-text', alias: 'nomic-embed-text' }
            ];
            
            for (const candidate of embeddingCandidates) {
                const channel = memoryCache.selectChannels(candidate.model)[0];
                if (channel) {
                    embeddingChannel = channel;
                    embeddingModel = candidate.model;
                    break;
                }
                const aliasChannel = memoryCache.selectChannels(candidate.alias)[0];
                if (aliasChannel) {
                    embeddingChannel = aliasChannel;
                    embeddingModel = candidate.model;
                    break;
                }
            }
        }

        console.log(`[SemanticCache] Embedding channel found: ${embeddingChannel ? embeddingChannel.name : 'NONE'}, model: ${embeddingModel || 'N/A'}`);

        // --- Semantic Cache Lookup (Before upstream dispatch, non-stream only) ---
        if (embeddingChannel && !stream) {
            const userPrompt = Array.isArray(body.messages)
                ? body.messages.map((m: any) => m.content).join(' ')
                : '';
            // Get active cache policy from user's primary/active package if available
            const cachePolicy = user.activePackage?.cache_policy || { mode: 'default' };

            const cachedResponse = await lookupSemanticCache(userPrompt, model, embeddingChannel, embeddingModel, user.id, cachePolicy);
            if (cachedResponse) {
                console.log(`[SemanticCache] HIT for model: ${model}`);
                
                // --- Semantic Cache Billing ---
                try {
                    let promptTokens = 0;
                    let completionTokens = 0;
                    if (cachedResponse.usage) {
                        promptTokens = cachedResponse.usage.prompt_tokens || 0;
                        completionTokens = cachedResponse.usage.completion_tokens || 0;
                    } else {
                        const promptText = userPrompt;
                        let completionText = '';
                        if (cachedResponse.choices && cachedResponse.choices[0]?.message?.content) {
                            completionText = cachedResponse.choices[0].message.content;
                        }
                        promptTokens = Math.ceil(promptText.length / 1.5);
                        completionTokens = Math.ceil(completionText.length / 1.5);
                    }
                    
                    const actualCost = calculateCost(model, user.group, promptTokens, completionTokens);
                    const elapsedMs = Date.now() - startTime;
                    
                    await reconcileQuota({
                        userId: user.id,
                        tokenId: token.id,
                        preDeducted: 0,
                        actualCost
                    });
                    
                    await billAndLog({
                        userId: user.id,
                        tokenId: token.id,
                        channelId: 0, // 0 signifies Semantic Cache Hit (Pure Profit)
                        modelName: model,
                        promptTokens,
                        completionTokens,
                        userGroup: user.group,
                        isStream: false,
                        elapsedMs,
                        ip,
                        ua
                    });
                } catch (e: any) {
                    console.error('[SemanticCache] Billing Error:', e.message);
                }
                // ------------------------------

                return cachedResponse;
            }
        }
        // ---------------------------------------------------------------------------

        // 3. Iterate through channels for retry attempts
        const channels = candidateChannels as ChannelConfig[];
        for (const channelConfig of channels) {
            console.log(`[Dispatch] Targeting Channel ID: ${channelConfig.id}, Type: ${channelConfig.type}, Weight: ${channelConfig.weight}`);

            // Get Converter/Handler
            const handler = getProviderHandler(channelConfig.type);

            // Multi-key support: keys are separated by \n, pick one randomly
            const decryptedKeys = decryptChannelKeys(channelConfig.key);
            const keys = decryptedKeys.split('\n').map((k: string) => k.trim()).filter(Boolean);
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
            // Smart URL handling: avoid duplicate /v1 prefix
            let baseUrl = channelConfig.baseUrl.replace(/\/+$/, '');
            let upstreamUrl: string;
            
            if (channelConfig.type === ChannelType.GEMINI) {
                // Gemini endpoints
                if (baseUrl.endsWith('/v1beta')) {
                    upstreamUrl = stream 
                        ? `${baseUrl}/models/${upstreamModel}:streamGenerateContent?alt=sse`
                        : `${baseUrl}/models/${upstreamModel}:generateContent`;
                } else if (baseUrl.includes('/v1beta/models')) {
                    // URL already contains models path
                    if (baseUrl.includes(':generateContent') || baseUrl.includes(':streamGenerateContent')) {
                        upstreamUrl = baseUrl;
                    } else {
                        upstreamUrl = stream
                            ? `${baseUrl.split('/models/')[0]}/models/${upstreamModel}:streamGenerateContent?alt=sse`
                            : `${baseUrl.split('/models/')[0]}/models/${upstreamModel}:generateContent`;
                    }
                } else {
                    upstreamUrl = stream
                        ? `${baseUrl}/v1beta/models/${upstreamModel}:streamGenerateContent?alt=sse`
                        : `${baseUrl}/v1beta/models/${upstreamModel}:generateContent`;
                }
            } else {
                // OpenAI-compatible endpoints
                if (baseUrl.endsWith('/v1/chat/completions')) {
                    upstreamUrl = baseUrl;
                } else if (baseUrl.endsWith('/v1')) {
                    upstreamUrl = `${baseUrl}/chat/completions`;
                } else {
                    upstreamUrl = `${baseUrl}/v1/chat/completions`;
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
                    console.warn(`[Retry Notice] Channel ${channelConfig.id} returned status ${response.status}. Status: ${errorText}`);
                    await circuitBreaker.recordError(channelConfig.id, response.status, errorText);
                    throw new Error(`Status ${response.status}: ${errorText}`);
                }

                circuitBreaker.recordSuccess(channelConfig.id);

                // 4. Handle SSE Stream Passthrough and Billing Interception
                if (stream && response.body) {
                    const [clientStream, billingStream] = response.body.tee();

                    (async () => {
                        try {
                            const reader = billingStream.getReader();
                            const decoder = new TextDecoder("utf-8");
                            let completionText = '';
                            let usageData: any = null;
                            let buffer = '';

                            // Timeout protection: if stream hangs (e.g., client disconnects),
                            // ensure we still reconcile quota after 60 seconds.
                            const timeoutMs = 60_000;
                            const deadline = Date.now() + timeoutMs;

                            while (true) {
                                if (Date.now() > deadline) {
                                    console.warn('[Stream Billing] Timeout reached, cancelling billing stream reader.');
                                    reader.cancel().catch(() => {});
                                    break;
                                }

                                const { done, value } = await reader.read();
                                if (done) break;

                                buffer += decoder.decode(value, { stream: true });
                                const lines = buffer.split('\n');
                                buffer = lines.pop() || '';

                                for (const line of lines) {
                                    const trimmed = line.trim();
                                    if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
                                        try {
                                            const data = JSON.parse(trimmed.slice(6));
                                            if (data.choices && data.choices[0]?.delta?.content) {
                                                completionText += data.choices[0].delta.content;
                                            }
                                            if (data.usage) {
                                                usageData = data.usage;
                                            }
                                        } catch (e) {
                                            // Ignore parse errors for incomplete JSON
                                        }
                                    }
                                }
                            }

                            if (buffer.trim().startsWith('data: ') && buffer.trim() !== 'data: [DONE]') {
                                try {
                                    const data = JSON.parse(buffer.trim().slice(6));
                                    if (data.choices && data.choices[0]?.delta?.content) {
                                        completionText += data.choices[0].delta.content;
                                    }
                                    if (data.usage) {
                                        usageData = data.usage;
                                    }
                                } catch (e) { }
                            }

                            let finalPromptTokens = 0;
                            let finalCompletionTokens = 0;

                            if (usageData) {
                                finalPromptTokens = usageData.prompt_tokens || 0;
                                finalCompletionTokens = usageData.completion_tokens || 0;
                            } else {
                                // Heuristic estimation if usage is not provided in stream
                                finalCompletionTokens = Math.ceil(completionText.length / 1.5);
                                const promptText = Array.isArray(body.messages) ? body.messages.map((m: any) => typeof m.content === 'string' ? m.content : '').join(' ') : '';
                                finalPromptTokens = Math.ceil(promptText.length / 1.5);
                            }

                            const actualCost = calculateCost(model, user.group, finalPromptTokens, finalCompletionTokens);

                            // IMPORTANT: Refund the pre-deducted quota
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
                                promptTokens: finalPromptTokens,
                                completionTokens: finalCompletionTokens,
                                userGroup: user.group,
                                isStream: true,
                                statusCode: response.status,
                                elapsedMs: Date.now() - startTime,
                                ip,
                                ua
                            });
                        } catch (e) {
                            console.error("[Stream Billing Error]", e);
                            // On unexpected error, still try to refund pre-deducted quota
                            await reconcileQuota({
                                userId: user.id,
                                tokenId: token.id,
                                preDeducted,
                                actualCost: 0
                            }).catch(() => {});
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
                let rawData: any;
                const contentType = response.headers.get('content-type') || '';
                
                if (contentType.includes('application/json')) {
                    rawData = await response.json();
                } else if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
                    // Some providers return SSE format even for non-stream requests
                    const text = await response.text();
                    if (text.startsWith('data:')) {
                        const jsonStr = text.trim().slice(5).trim();
                        rawData = JSON.parse(jsonStr);
                    } else {
                        rawData = JSON.parse(text);
                    }
                } else {
                    rawData = await response.json();
                }
                
                const formattedData = handler.transformResponse(rawData);

                // Async: write to semantic cache (fire-and-forget)
                if (embeddingChannel && !stream) {
                    const userPrompt = Array.isArray(body.messages)
                        ? body.messages.map((m: any) => m.content).join(' ')
                        : '';
                    await storeSemanticCache(userPrompt, model, formattedData, embeddingChannel, embeddingModel, user.id).catch(err => {
                        console.error('[SemanticCache] Store Error:', err.message);
                    });
                }

                // 5. Trigger Billing and Logging (Asynchronous)
                const { promptTokens, completionTokens, cachedTokens } = handler.extractUsage(rawData);
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
                    cachedTokens,
                    userGroup: user.group,
                    isStream: false,
                    statusCode: response.status,
                    elapsedMs: Date.now() - startTime,
                    ip,
                    ua
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

                // Transparent Error Logging (Logged with $0.00 cost)
                await billAndLog({
                    userId: user.id,
                    tokenId: token.id,
                    channelId: channelConfig.id,
                    modelName: model,
                    promptTokens: 0,
                    completionTokens: 0,
                    userGroup: user.group,
                    isStream: !!stream,
                    statusCode: e.message?.startsWith('Status') ? parseInt(e.message.split(' ')[1]) : 500,
                    errorMessage: e.message || 'Unknown network error',
                    elapsedMs: Date.now() - startTime,
                    ip,
                    ua
                }).catch(() => { });

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
