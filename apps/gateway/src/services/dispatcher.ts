import { sql } from '@elygate/db';
import { memoryCache } from './cache';
import { circuitBreaker } from './circuitBreaker';
import { billAndLog, preCheckAndDecrement, reconcileQuota } from './billing';
import { calculateCost } from './ratio';
import { ChannelType, getProviderHandler } from '../providers';
import { type TokenRecord, type UserRecord, type ChannelConfig } from '../types';
import { decryptChannelKeys } from './encryption';

export interface DispatchOptions {
    model: string;
    body: any;
    user: UserRecord;
    token: TokenRecord;
    endpointType: 'chat' | 'embeddings' | 'images' | 'audio' | 'audio/speech' | 'audio/transcriptions' | 'audio/translations' | 'moderations' | 'rerank' | 'video' | 'responses' | 'native-gemini';
    stream?: boolean;
    skipTransform?: boolean;
}

// Global in-memory concurrency tracker: Map<"channelId_keyIndex", currentActiveRequests>
const keyConcurrencyMap = new Map<string, number>();

async function waitForConcurrencyRelease(lockId: string, limit: number, maxWaitMs: number = 15000): Promise<boolean> {
    if (limit <= 0) return true; // 0 = unlimited

    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
        const current = keyConcurrencyMap.get(lockId) || 0;
        if (current < limit) return true; // Slot available
        // Wait 100ms before checking again (spin lock)
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false; // Timed out waiting for slot
}

export class UnifiedDispatcher {
    static async dispatch(options: DispatchOptions) {
        const { model, body, user, token, endpointType, skipTransform } = options;
        const isStream = options.stream || body.stream || false;
        const isFormData = body instanceof FormData || (body && typeof body === 'object' && !Array.isArray(body) && Object.values(body).some(v => v instanceof File || v instanceof Blob));

        const candidateChannels = memoryCache.selectChannels(model);
        if (!candidateChannels || candidateChannels.length === 0) {
            throw new Error(`No available channel found for model: ${model}`);
        }

        let lastError: any = null;
        const channels = candidateChannels as ChannelConfig[];

        for (const channelConfig of channels) {
            const handler = getProviderHandler(channelConfig.type);

            // 1. Key Selection
            const decryptedKeys = decryptChannelKeys(channelConfig.key);
            const allKeys = decryptedKeys.split('\n').map((k: string) => k.trim()).filter(Boolean);
            const statusMap = (channelConfig as any).keyStatus || {};
            const availableKeys = allKeys.filter(k => statusMap[k] !== 'exhausted');

            if (availableKeys.length === 0) {
                console.warn(`[Dispatcher] Channel ${channelConfig.id} has no available keys left.`);
                continue;
            }

            let activeKeyIndex = 0;
            if (channelConfig.keyStrategy === 1) {
                // Sequential: just pick the first available
            } else {
                // Random load balance
                activeKeyIndex = Math.floor(Math.random() * availableKeys.length);
            }
            const activeKey = availableKeys[activeKeyIndex];

            // 1.5 Concurrency Lock (Semaphore)
            const lockId = `${channelConfig.id}_${activeKeyIndex}`;
            if (channelConfig.keyConcurrencyLimit > 0) {
                const acquired = await waitForConcurrencyRelease(lockId, channelConfig.keyConcurrencyLimit);
                if (!acquired) {
                    console.warn(`[Dispatcher] Channel ${channelConfig.id} Key ${activeKeyIndex} concurrency maxed out (${channelConfig.keyConcurrencyLimit}), skipping after 15s wait.`);
                    // Let the loop continue to try the NEXT candidate channel in the fallback chain!
                    continue; 
                }
            }

            // Lock acquired, atomically increment concurrency
            keyConcurrencyMap.set(lockId, (keyConcurrencyMap.get(lockId) || 0) + 1);

            // 2. Prepare Upstream Request
            const fetchHeaders = handler.buildHeaders(activeKey);
            let upstreamModel = model;
            if (channelConfig.modelMapping && channelConfig.modelMapping[model]) {
                upstreamModel = channelConfig.modelMapping[model];
            }

            const upstreamUrl = this.getUpstreamUrl(channelConfig, upstreamModel, endpointType, isStream);

            // 2.5 Prepare Body & Headers
            let forwardBody: any;
            if (isFormData) {
                if (fetchHeaders instanceof Headers) fetchHeaders.delete('Content-Type');
                else delete (fetchHeaders as any)['Content-Type'];

                forwardBody = new FormData();
                const sourceBody = body as any;
                for (const key in sourceBody) {
                    if (key === 'model') forwardBody.append(key, upstreamModel);
                    else if (sourceBody[key] instanceof File) forwardBody.append(key, sourceBody[key], sourceBody[key].name);
                    else forwardBody.append(key, sourceBody[key]);
                }
            } else {
                forwardBody = JSON.stringify(skipTransform ? body : handler.transformRequest(body, upstreamModel));
            }

            // 3. Billing Pre-check
            let preDeducted = 0;
            try {
                const maxTokens = this.estimateMaxTokens(body, endpointType);
                preDeducted = await preCheckAndDecrement({
                    userId: user.id,
                    tokenId: token.id,
                    modelName: model,
                    userGroup: user.group,
                    maxTokens
                });

                if (body.computer_use) console.info(`[Dispatcher] User ${user.id} requested Computer Use with ${model}`);
                if (body.tool_search || body.deferred_tools) console.info(`[Dispatcher] Model ${model} active with Tool Search / Deferred Loading.`);

                // 4. Upstream Fetch
                const response = await fetch(upstreamUrl, {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: forwardBody
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    await circuitBreaker.recordError(channelConfig.id, response.status);
                    throw new Error(`Status ${response.status}: ${errorText}`);
                }

                circuitBreaker.recordSuccess(channelConfig.id);

                // 5. Handle Response
                if (isStream && response.body) {
                    const [clientStream, billingStream] = response.body.tee();
                    this.handleStreamBilling(billingStream, body, user, token, channelConfig, model, preDeducted, lockId);

                    return new Response(clientStream, {
                        headers: {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive'
                        }
                    });
                }

                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const rawData = await response.json();

                    // Usage extraction and billing
                    let { promptTokens, completionTokens } = handler.extractUsage(rawData);

                    // Fallback for image models if usage is not provided by upstream (common for OpenAI DALL-E)
                    if (endpointType === 'images' && promptTokens === 0 && completionTokens === 0) {
                        promptTokens = body.n || 1;
                    }

                    const actualCost = calculateCost(model, user.group, promptTokens, completionTokens);

                    // 6. Post-process (Success Billing)
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

                    const currentActive = keyConcurrencyMap.get(lockId);
                    if (currentActive) keyConcurrencyMap.set(lockId, Math.max(0, currentActive - 1));

                    return skipTransform ? rawData : handler.transformResponse(rawData);
                } else {
                    // Binary response (Audio, Image, Video blob)
                    const buffer = await response.arrayBuffer();

                    // Default audio billing if not JSON (approx 1 unit per request as fallback)
                    let promptTokens = endpointType.startsWith('audio') ? (body.input?.length || 1) : 1000;
                    const actualCost = calculateCost(model, user.group, promptTokens, 0);

                    await reconcileQuota({ userId: user.id, tokenId: token.id, preDeducted, actualCost });
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
                    
                    const currentActive = keyConcurrencyMap.get(lockId);
                    if (currentActive) keyConcurrencyMap.set(lockId, Math.max(0, currentActive - 1));

                    return new Response(buffer, { headers: { 'Content-Type': contentType } });
                }

            } catch (e: any) {
                // 7. Error & Refund Handling
                
                // Release lock on exception
                const currentActive = keyConcurrencyMap.get(lockId);
                if (currentActive) keyConcurrencyMap.set(lockId, Math.max(0, currentActive - 1));

                if (preDeducted > 0) {
                    await reconcileQuota({
                        userId: user.id,
                        tokenId: token.id,
                        preDeducted,
                        actualCost: 0
                    }).catch(() => { });
                }
                lastError = e;

                // Handle key exhaustion (401/403/429 with specific error messages)
                if (e.message?.includes('401') || e.message?.includes('403') || e.message?.includes('429')) {
                    const errMsg = e.message.toLowerCase();
                    if (errMsg.includes('quota') || errMsg.includes('balance') || errMsg.includes('credit') || errMsg.includes('limit')) {
                        console.error(`[Dispatcher] Key exhausted: ${activeKey.substring(0, 8)}...`);
                        const newStatusMap = { ...statusMap, [activeKey]: 'exhausted' };
                        await sql`UPDATE channels SET key_status = ${JSON.stringify(newStatusMap)}, updated_at = NOW() WHERE id = ${channelConfig.id}`.catch(() => { });
                        await memoryCache.refresh(false).catch(() => { });
                    }
                }

                if (!e.message?.startsWith('Status')) {
                    await circuitBreaker.recordError(channelConfig.id);
                }
                continue;
            }
        }

        throw new Error(`All candidate channels failed. Last error: ${lastError?.message || 'Unknown network error'}`);
    }

    private static getUpstreamUrl(config: ChannelConfig, model: string, type: string, stream: boolean) {
        const base = config.baseUrl;
        // Native Gemini 3.5 Pro support
        if (config.type === ChannelType.GEMINI && (type === 'chat' || type === 'native-gemini')) {
            const endpoint = stream ? ':streamGenerateContent?alt=sse' : ':generateContent';
            return `${base}/v1beta/models/${model}${endpoint}`;
        }

        switch (type) {
            case 'chat': return `${base}/v1/chat/completions`;
            case 'embeddings': return `${base}/v1/embeddings`;
            case 'images': return `${base}/v1/images/generations`;
            case 'moderations': return `${base}/v1/moderations`;
            case 'rerank': return `${base}/v1/rerank`;
            case 'video': return `${base}/v1/video/generations`;
            case 'responses': return `${base}/v1/responses`;
            default: return `${base}/v1/${type}`;
        }
    }

    private static estimateMaxTokens(body: any, type: string) {
        if (type === 'chat') return body.max_tokens || 4096;
        if (type === 'native-gemini') {
            const thinkingBudget = body.generationConfig?.thinkingConfig?.thinkingBudget || 0;
            return (body.generationConfig?.maxOutputTokens || 4096) + thinkingBudget;
        }
        if (type === 'embeddings') return 1;
        if (type === 'images') return 1000; // Flat cost effectively
        return 4096;
    }

    private static handleStreamBilling(
        billingStream: ReadableStream,
        body: any,
        user: UserRecord,
        token: TokenRecord,
        channelConfig: ChannelConfig,
        model: string,
        preDeducted: number,
        lockId: string
    ) {
        (async () => {
            try {
                const reader = billingStream.getReader();
                const decoder = new TextDecoder("utf-8");
                let completionText = '';
                let usageData: any = null;
                let buffer = '';

                const timeoutError = new Error('Stream idle timeout exceeded (60s)');
                const readWithTimeout = (r: ReadableStreamDefaultReader<Uint8Array>) => {
                    return Promise.race([
                        r.read(),
                        new Promise<any>((_, reject) => setTimeout(() => reject(timeoutError), 60000))
                    ]);
                };

                while (true) {
                    const { done, value } = await readWithTimeout(reader);
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
                            try {
                                const data = JSON.parse(trimmed.slice(6));
                                if (data.choices && data.choices[0]?.delta) {
                                    const delta = data.choices[0].delta;
                                    if (delta.content) completionText += delta.content;
                                    if (delta.reasoning_content) completionText += delta.reasoning_content;
                                }
                                if (data.usage) usageData = data.usage;
                            } catch (e) { }
                        }
                    }
                }

                // Process usage and bill
                let finalPromptTokens = 0;
                let finalCompletionTokens = 0;

                if (usageData) {
                    finalPromptTokens = usageData.prompt_tokens || 0;
                    finalCompletionTokens = usageData.completion_tokens || 0;
                } else {
                    const estimate = (text: string): number => {
                        const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\ac00-\ud7af]/g) || []).length;
                        return Math.ceil(cjkCount + (text.length - cjkCount) / 4);
                    };
                    finalCompletionTokens = estimate(completionText);
                    const promptText = Array.isArray(body.messages) ? body.messages.map((m: any) => m.content).join(' ') : '';
                    finalPromptTokens = estimate(promptText);
                }

                const actualCost = calculateCost(model, user.group, finalPromptTokens, finalCompletionTokens);
                await reconcileQuota({ userId: user.id, tokenId: token.id, preDeducted, actualCost });
                await billAndLog({
                    userId: user.id,
                    tokenId: token.id,
                    channelId: channelConfig.id,
                    modelName: model,
                    promptTokens: finalPromptTokens,
                    completionTokens: finalCompletionTokens,
                    userGroup: user.group,
                    isStream: true
                });
            } catch (e) {
                console.error("[Stream Billing Error]", e);
                // Refund pre-deducted quota natively on abrupt stream network drop before completion
                await reconcileQuota({
                    userId: user.id, 
                    tokenId: token.id, 
                    preDeducted, 
                    actualCost: 0 
                }).catch(() => {});
            } finally {
                // Stream ended, unconditionally release the semaphore pool lock
                const currentActive = keyConcurrencyMap.get(lockId);
                if (currentActive) keyConcurrencyMap.set(lockId, Math.max(0, currentActive - 1));
            }
        })();
    }
}
