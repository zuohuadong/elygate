import { log } from '../services/logger';
import { Elysia } from 'elysia';
import { assertModelAccess } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { billAndLog, reconcileQuota } from '../services/billing';
import { calculateCost } from '../services/ratio';
import { optionCache } from '../services/optionCache';
import { lookupSemanticCache, storeSemanticCache } from '../services/semanticCache';
import { lookupResponseCache, storeResponseCache } from '../services/responseCache';
import { getChannelKeys } from '../services/encryption';
import { dispatch } from '../services/dispatcher';
import type { TokenRecord,  UserRecord  } from '../types';
import { removeNullFields } from '../utils/transform';
import { translateErrorBilingual } from '../services/i18n';

/**
 * Filter thinking content from response for -F suffix models.
 * Removes reasoning_content and thinking process text from the response.
 */
function filterThinkingContent(response: Response): Record<string, any> {
    const filtered = JSON.parse(JSON.stringify(response));
    
    if (filtered.choices) {
        for (const choice of filtered.choices) {
            // Remove reasoning_content field (DeepSeek/Qwen style)
            if (choice.message?.reasoning_content) {
                delete choice.message.reasoning_content;
            }
            if (choice.delta?.reasoning_content) {
                delete choice.delta.reasoning_content;
            }
            
            // Filter thinking process text from content
            if (choice.message?.content && typeof choice.message.content === 'string') {
                let content = choice.message.content;
                
                // Pattern 1: "Thinking Process:\n\n...thinking...\n\nactual_response"
                if (content.includes('Thinking Process:')) {
                    // Split by double newlines to separate sections
                    const parts = content.split(/\n\n+/);
                    const answerParts: string[] = [];
                    
                    for (const part of parts) {
                        // Skip thinking process sections
                        if (part.startsWith('Thinking Process:') || 
                            /^\d+\.\s+\*\*/.test(part) ||
                            /^\s*\*\*[^*]+\*\*:/.test(part) ||
                            /^\s*\*\s/.test(part)) {
                            continue;
                        }
                        // Check if this looks like actual content (not thinking)
                        if (part.trim() && !part.startsWith('*') && !/^\d+\./.test(part)) {
                            answerParts.push(part);
                        }
                    }
                    
                    if (answerParts.length > 0) {
                        content = answerParts.join('\n\n');
                    } else {
                        // If no answer found, the response might be truncated
                        // Return a message indicating the response was incomplete
                        content = '[Response was truncated during thinking process]';
                    }
                }
                
                // Pattern 2: <think...>...</think...>\n\nactual_response
                const thinkTagMatch = content.match(/^<think[\s\S]*?<\/think>\s*\n*/);
                if (thinkTagMatch) {
                    content = content.replace(thinkTagMatch[0], '');
                }
                
                choice.message.content = content.trim();
            }
            if (choice.delta?.content && typeof choice.delta.content === 'string') {
                let content = choice.delta.content;
                
                if (content.includes('Thinking Process:')) {
                    const parts = content.split(/\n\n+/);
                    const answerParts: string[] = [];
                    
                    for (const part of parts) {
                        if (part.startsWith('Thinking Process:') || 
                            /^\d+\.\s+\*\*/.test(part) ||
                            /^\s*\*\*[^*]+\*\*:/.test(part) ||
                            /^\s*\*\s/.test(part)) {
                            continue;
                        }
                        if (part.trim() && !part.startsWith('*') && !/^\d+\./.test(part)) {
                            answerParts.push(part);
                        }
                    }
                    
                    if (answerParts.length > 0) {
                        content = answerParts.join('\n\n');
                    } else {
                        content = '[Response was truncated during thinking process]';
                    }
                }
                
                const thinkTagMatch = content.match(/^<think[\s\S]*?<\/think>\s*\n*/);
                if (thinkTagMatch) {
                    content = content.replace(thinkTagMatch[0], '');
                }
                
                choice.delta.content = content.trim();
            }
        }
    }
    
    return filtered;
}

/**
 * Resolve embedding channel and model for semantic cache lookups.
 */
function resolveEmbeddingChannel(): { channel: Record<string, any> | null; model: string | undefined } {
    const configuredModel = optionCache.get('CHAT_CHANNEL_MODEL', '') as string;

    if (configuredModel) {
        const ch = memoryCache.selectChannels(configuredModel as string)[0];
        if (ch) return { channel: ch, model: configuredModel as string };
    }

    const candidates = [
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

    for (const candidate of candidates) {
        const ch = memoryCache.selectChannels(candidate.model)[0];
        if (ch) return { channel: ch, model: candidate.model };
        const aliasCh = memoryCache.selectChannels(candidate.alias)[0];
        if (aliasCh) return { channel: aliasCh, model: candidate.model };
    }

    return { channel: null, model: undefined };
}

/**
 * Bill a cache hit (both exact and semantic cache).
 */
async function billCacheHit(
    response: Record<string, any>,
    model: string,
    user: UserRecord,
    token: TokenRecord,
    channelId: number,
    startTime: number,
    ip: string,
    ua: string,
    traceId: string,
    requestBody: string
): Promise<void> {
    const promptTokens = response.usage?.prompt_tokens || 0;
    const completionTokens = response.usage?.completion_tokens || 0;
    const actualCost = calculateCost(model, user.group, promptTokens, completionTokens);
    const elapsedMs = Date.now() - startTime;

    await reconcileQuota({ userId: user.id, tokenId: token.id, preDeducted: 0, actualCost });
    await billAndLog({
        userId: user.id,
        tokenId: token.id,
        channelId,
        modelName: model,
        promptTokens,
        completionTokens,
        userGroup: user.group,
        isStream: false,
        elapsedMs,
        ip,
        ua,
        traceId,
        orgId: user.orgId,
        requestBody,
        responseBody: JSON.stringify(response)
    });
}

export const chatRouter = new Elysia()
    .post('/chat/completions', async ({ body, token, user, request, set }: any) => {
        const u = user as UserRecord;
        const t = token as TokenRecord;
        const startTime = Date.now();
        const { model, stream } = body as Record<string, any>;

        if (!model) {
            throw new Error("Missing 'model' field in request body");
        }

        assertModelAccess(user, token, model, set);

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';
        const traceId = body.trace_id || `tr_log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

        log.info(`[Request] UserID: ${u.id}, Token: ${t.name}, Model: ${model}, Group: ${u.group}, IP: ${ip}, Trace: ${traceId}`);

        // --- Cache Configuration ---
        const messages = body.messages as Record<string, any>[][];
        const userPrompt = Array.isArray(messages)
            ? messages.map((m: Record<string, any>) => m.content).join(' ')
            : '';
        const defaultMode = optionCache.get('SemanticCacheDefaultMode', 'default');
        const cachePolicy = (u as Record<string, any>).activePackage?.cache_policy || { mode: defaultMode };

        // --- Vision/Multimodal Detection ---
        // Detect if any message contains image content (image_url type or base64 data)
        // Vision requests MUST bypass all caches because:
        // 1. Our cache keys are text-only — different images with same text prompt hash identically
        // 2. VLLM prefix caching may reuse KV-Cache across different images
        const isVisionRequest = Array.isArray(messages) && messages.some((m: Record<string, any>) =>
            Array.isArray(m.content) && m.content.some((c: Record<string, any>) =>
                c.type === 'image_url' || c.type === 'image'
            )
        );
        if (isVisionRequest) {
            // Inject a random seed to break VLLM's Automatic Prefix Caching (APC)
            // This ensures different requests produce different KV-Cache entries
            if (!body.seed) {
                body.seed = Math.floor(Math.random() * 2147483647);
            }
            log.info(`[Vision] Detected multimodal request. Cache bypassed, seed=${body.seed}`);
        }

        // --- 0. Handle -F suffix for cache key ---
        // Use model name without -F suffix for cache key to share cache between thinking/non-thinking modes
        const skipThinking = model.endsWith('-F');
        const cacheModelKey = skipThinking ? model.slice(0, -2) : model;

        // --- 1. Exact Response Cache Lookup (fastest, no embedding needed) ---
        if (!stream && !isVisionRequest) {
            const exactResponse = await lookupResponseCache(cacheModelKey, messages, u.id);
            if (exactResponse) {
                log.info(`[ResponseCache] HIT for model: ${cacheModelKey} (requested: ${model})`);
                let correctedResponse = { ...exactResponse, model };

                // Filter thinking content if -F suffix was requested
                if (skipThinking && correctedResponse.choices) {
                    correctedResponse = filterThinkingContent(correctedResponse);
                }

                await billCacheHit(correctedResponse, model, u, t, -1, startTime, ip, ua, traceId, JSON.stringify(body)).catch(e => {
                    log.error('[ResponseCache] Billing Error:', e.message);
                });
                return removeNullFields(correctedResponse);
            }
        }

        // --- 2. Semantic Cache Lookup (vector similarity) ---
        const { channel: embeddingChannel, model: embeddingModel } = resolveEmbeddingChannel();
        log.info(`[SemanticCache] Embedding channel found: ${embeddingChannel ? embeddingChannel.name : 'NONE'}, model: ${embeddingModel || 'N/A'}`);

        if (embeddingChannel && !stream && !isVisionRequest) {
            const cachedResponse = await lookupSemanticCache(userPrompt, cacheModelKey, embeddingChannel, embeddingModel, u.id, cachePolicy);
            if (cachedResponse) {
                log.info(`[SemanticCache] HIT for model: ${cacheModelKey} (requested: ${model})`);
                let correctedResponse = { ...cachedResponse, model };

                // Filter thinking content if -F suffix was requested
                if (skipThinking && correctedResponse.choices) {
                    correctedResponse = filterThinkingContent(correctedResponse);
                }

                // Estimate tokens for semantic cache billing
                let promptTokens = correctedResponse.usage?.prompt_tokens || 0;
                let completionTokens = correctedResponse.usage?.completion_tokens || 0;
                if (!correctedResponse.usage) {
                    let completionText = '';
                    if (correctedResponse.choices?.[0]?.message?.content) {
                        completionText = correctedResponse.choices[0].message.content;
                    }
                    promptTokens = Math.ceil(userPrompt.length / 1.5);
                    completionTokens = Math.ceil(completionText.length / 1.5);
                }

                const actualCost = calculateCost(model, u.group, promptTokens, completionTokens);
                await reconcileQuota({ userId: u.id, tokenId: t.id, preDeducted: 0, actualCost }).catch((e: unknown) => log.warn('[Async] Suppressed:', e));
                await billAndLog({
                    userId: u.id, tokenId: t.id, channelId: 0, modelName: model,
                    promptTokens, completionTokens, userGroup: u.group,
                    isStream: false, elapsedMs: Date.now() - startTime, ip, ua,
                    traceId, orgId: u.orgId,
                    requestBody: JSON.stringify(body),
                    responseBody: JSON.stringify(correctedResponse)
                }).catch(e => log.error('[SemanticCache] Billing Error:', e.message));

                return removeNullFields(correctedResponse);
            }
        }

        // --- 3. Cache Miss: Dispatch to upstream via dispatch ---
        const result = await dispatch({
            model,
            body,
            user: u,
            token: t,
            endpointType: 'chat',
            stream,
            ip,
            ua
        });

        // --- 4. Async cache storage for non-stream responses ---
        if (!stream && result && !(result instanceof Response) && !isVisionRequest) {
            const formattedData = result as Record<string, any>;

            storeResponseCache(model, messages, formattedData, formattedData.usage, u.id).catch((err: Error) => {
                log.error('[ResponseCache] Store Error:', err.message);
            });

            if (embeddingChannel) {
                storeSemanticCache(userPrompt, model, formattedData, embeddingChannel, embeddingModel, u.id, cachePolicy).catch((err: Error) => {
                    log.error('[SemanticCache] Store Error:', err.message);
                });
            }
        }

        return result;
    });
