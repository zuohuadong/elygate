import { log } from '../services/logger';
import { getErrorMessage } from '../utils/error';
import { sql } from '@elygate/db';
import { memoryCache } from './cache';
import { circuitBreaker } from './circuitBreaker';
import { optionCache } from './optionCache';
import { billAndLog, preCheckAndDecrement, reconcileQuota } from './billing';
import { calculateCost } from './ratio';
import { ChannelType, getProviderHandler } from '../providers';
import type { TokenRecord, UserRecord, ChannelConfig } from '../types';
import { getChannelKeys } from './encryption';
import { isRateLimited, isPackageRateLimited, waitForPackageConcurrency, packageConcurrencyMap, releasePackageConcurrency, getPackageLockId } from './ratelimit';
import { buildUpstreamUrl } from '../utils/url';
import { matchPattern } from '../utils/pattern';
import { ContentFilter, cleanResponseTokens, cleanModelTokens } from './filter';
import { notifier } from './notifier';
import { WebSearchPlugin } from './plugins/search';

export interface DispatchOptions {
    model: string;
    body: Record<string, any>;
    user: UserRecord;
    token: TokenRecord;
    endpointType: 'chat' | 'embeddings' | 'images' | 'audio' | 'audio/speech' | 'audio/transcriptions' | 'audio/translations' | 'moderations' | 'rerank' | 'video' | 'responses' | 'native-gemini';
    stream?: boolean;
    skipTransform?: boolean;
    ip?: string;
    ua?: string;
    idempotencyKey?: string;
    externalTaskId?: string;
    externalUserId?: string;
    externalWorkspaceId?: string;
    externalFeatureType?: string;
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

// UnifiedDispatcher — functional module
export async function dispatch(options: DispatchOptions) {
        const { body, user, token, endpointType, skipTransform, idempotencyKey, externalTaskId, externalUserId, externalWorkspaceId, externalFeatureType } = options;
        let model = options.model;
        const isStream = options.stream || body.stream || false;
        const isFormData = body instanceof FormData || (body && typeof body === 'object' && !Array.isArray(body) && Object.values(body).some(v => v instanceof File || v instanceof Blob));

        // 0. Handle -F suffix (Non-Thinking Model)
        // Models with -F suffix will have enable_thinking: false
        const originalModel = model; // Keep original model name for transformRequest
        const skipThinking = model.endsWith('-F');
        if (skipThinking) {
            model = model.slice(0, -2); // Remove -F suffix for routing
        }

        // 0. Check Package Bypass (Contractual Exemption)
        let isPackageFree = false;
        let effectiveRuleId: number | null = null;
        if (user.activePackages) {
            for (const pkg of user.activePackages) {
                if (pkg.models?.includes(model)) {
                    isPackageFree = true;
                    effectiveRuleId = pkg.modelRateLimits?.[model] || pkg.defaultRateLimitId;
                    break;
                }
            }
        }

        // 0.5 Group Policy Interception (Dual-Dimensional Enforcer)
        const groupPolicy = memoryCache.userGroups.get(user.group);
        
        if (!isPackageFree && groupPolicy) {
            const isModelDenied = matchPattern(model, groupPolicy.deniedModels);
            if (isModelDenied) {
                const isModelAllowed = matchPattern(model, groupPolicy.allowedModels);
                if (!isModelAllowed) {
                    throw new Error(`HTTP 403 Forbidden: Model '${model}' is strictly blocked by your current Group Policy [${groupPolicy.name}].`);
                }
            }
        }
        
        // 0.57 Idempotency Check (The "No Double Dip" Enforcer)
        const effectiveIdempotencyKey = idempotencyKey || body.idempotency_key || (body.metadata?.idempotency_key);
        if (effectiveIdempotencyKey) {
            const keyHash = Bun.password.hashSync(effectiveIdempotencyKey, { algorithm: "argon2id" }).split('$').pop(); // Simple stable hash or just use the key if it's already a safe string
            // Let's just use the string if it's short, or a crypto hash.
            const cryptoHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${user.id}_${effectiveIdempotencyKey}`))))
                .map(b => b.toString(16).padStart(2, '0')).join('');

            const [existing] = await sql`SELECT response_code, response_body FROM idempotency_keys WHERE key_hash = ${cryptoHash} AND user_id = ${user.id} AND expires_at > NOW()`;
            if (existing) {
                log.info(`[Dispatcher] Idempotency hit for key ${effectiveIdempotencyKey}, returning cached response.`);
                const respBody = existing.response_body;
                const cleanedRespBody = cleanResponseTokens(respBody);
                if (isStream) {
                    // For stream, we can't easily replay the exact stream, but we can return the full text as a single event or an error.
                    // Usually, idempotency for stream is tricky. In simple cases, we return 409 or the cached final response as an event.
                    // Let's return the cached JSON as a single-event stream for now.
                    const payload = `data: ${JSON.stringify(cleanedRespBody)}\n\ndata: [DONE]\n\n`;
                    return new Response(payload, {
                        headers: { 'Content-Type': 'text/event-stream' }
                    });
                }
                return skipTransform ? cleanedRespBody : await getProviderHandler(ChannelType.OPENAI).transformResponse(cleanedRespBody); // Fallback to OpenAI transform if type unknown
            }
        }

        // 0.55 Content Guard (DLP)
        const requestText = ContentFilter.extractText(body);
        const filterResult = await ContentFilter.validate(requestText, user.group);
        if (filterResult.blocked) {
            throw new Error(`HTTP 403 Forbidden: Content blocked by safety policy (matched: ${filterResult.pattern})`);
        }

        // 0.58 Search Augmented Generation (SAG)
        if (body.enable_search || model.endsWith(':search')) {
            if (model.endsWith(':search')) model = model.slice(0, -7);
            const query = body.messages?.[body.messages.length - 1]?.content || body.prompt || '';
            if (query) {
                log.info(`[SAG] Triggering web search for model ${model}: "${query}"`);
                const searchResults = await WebSearchPlugin.search(query);
                if (body.messages) {
                    body.messages.push({ role: 'system', content: `[SEARCH CONTEXT]\n${searchResults}` });
                } else if (body.prompt) {
                    body.prompt = `${searchResults}\n\nUser Question: ${body.prompt}`;
                }
            }
        }

        // 0.6 Quota Alert
        if (user.quota > 0 && user.usedQuota / user.quota > 0.9) {
            notifier.notify('Low Quota Warning', `User ${user.username} has used ${Math.round(user.usedQuota / user.quota * 100)}% of their quota.`);
        }

        let candidateChannels = memoryCache.selectChannels(model, user.group);
        
        // 0.6 Provider Company Interception (Channel Type)
        if (!isPackageFree && groupPolicy && candidateChannels?.length > 0) {
            if (groupPolicy.deniedChannelTypes && groupPolicy.deniedChannelTypes.length > 0) {
                candidateChannels = candidateChannels.filter((ch: ChannelConfig) => !groupPolicy.deniedChannelTypes.includes(ch.type));
            }
            if (groupPolicy.allowedChannelTypes && groupPolicy.allowedChannelTypes.length > 0) {
                candidateChannels = candidateChannels.filter((ch: ChannelConfig) => groupPolicy.allowedChannelTypes.includes(ch.type));
            }
        }

        if (!candidateChannels || candidateChannels.length === 0) {
            throw new Error(`No available or authorized channel found for model: ${model}`);
        }

        let lastError: Error | null = null;
        const channels = candidateChannels as ChannelConfig[];

        for (const channelConfig of channels) {
            const traceId = (body as Record<string, any>).trace_id || `tr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            const handler = getProviderHandler(channelConfig.type);

            // 1. Key Selection
            const allKeys = getChannelKeys(channelConfig.key);
            const statusMap = (channelConfig as Record<string, any>).keyStatus || {};
            const isKeyBad = (v: any) => {
                if (typeof v === 'string') return v === 'exhausted' || v === 'invalid';
                return v?.status === 'exhausted' || v?.status === 'invalid';
            };
            const availableKeys = allKeys.filter(k => !statusMap[k] || !isKeyBad(statusMap[k]));

            if (availableKeys.length === 0) {
                log.warn(`[Dispatcher] Channel ${channelConfig.id} has no available keys left.`);
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

            // 1.2 Channel-Specific Rate Limiting (e.g., NVIDIA 40 RPM limit)
            if (channelConfig.type === ChannelType.NVIDIA) {
                const nvidiaRpmLimit = 40;
                const nvidiaKey = `channel_${channelConfig.id}_key_${activeKeyIndex}`;
                if (await isRateLimited(nvidiaKey, nvidiaRpmLimit)) {
                    log.warn(`[Dispatcher] NVIDIA Channel ${channelConfig.id} Key ${activeKeyIndex} hit global 40 RPM limit, skipping.`);
                    continue;
                }
            }

            // 1.5 Concurrency Lock (Semaphore)
            const lockId = `${channelConfig.id}_${activeKeyIndex}`;
            if (channelConfig.keyConcurrencyLimit > 0) {
                const acquired = await waitForConcurrencyRelease(lockId, channelConfig.keyConcurrencyLimit);
                if (!acquired) {
                    log.warn(`[Dispatcher] Channel ${channelConfig.id} Key ${activeKeyIndex} concurrency maxed out (${channelConfig.keyConcurrencyLimit}), skipping after 15s wait.`);
                    // Let the loop continue to try the NEXT candidate channel in the fallback chain!
                    continue;
                }
            }

            // Lock acquired, atomically increment concurrency
            keyConcurrencyMap.set(lockId, (keyConcurrencyMap.get(lockId) || 0) + 1);

            // 2. Prepare Upstream Request
            const fetchHeaders = handler.buildHeaders(activeKey);
            let upstreamModel = model;
            if (channelConfig.modelMapping) {
                // Support wildcard matching in model mapping
                for (const [pattern, target] of Object.entries(channelConfig.modelMapping)) {
                    if (matchPattern(model, [pattern])) {
                        upstreamModel = target as string;
                        break;
                    }
                }
            }
            // Reverse-lookup auto-generated aliases: if user sent a short alias (e.g. "Qwen-Image")
            // but the channel only has the full name (e.g. "Qwen/Qwen-Image"), map it back.
            if (upstreamModel === model) {
                const channelModels: string[] = Array.isArray(channelConfig.models)
                    ? channelConfig.models
                    : (typeof channelConfig.models === 'string' ? JSON.parse(channelConfig.models) : []);
                if (!channelModels.includes(model)) {
                    // Try to find a full model name that ends with /alias
                    const fullName = channelModels.find(m => m.endsWith('/' + model));
                    if (fullName) {
                        upstreamModel = fullName;
                    }
                    // Also check "Pro/" prefix variants: "Pro/Qwen/Qwen-Image" -> alias "Qwen/Qwen-Image" or "Qwen-Image"
                    if (!fullName) {
                        const proFullName = channelModels.find(m =>
                            m.toLowerCase().startsWith('pro/') && (m.endsWith('/' + model) || m.substring(4) === model)
                        );
                        if (proFullName) {
                            upstreamModel = proFullName;
                        }
                    }
                }
            }

            // 2.1 Dynamic Multimodal Suffix Mapping (Aspect Ratio / Quality)
            // Bridges the gap between elegant parameter-based layout routing and upstream suffix-based legacy gateways
            // IMPORTANT: We ONLY apply this hack if we are routing to an OPENAI-compatible proxy (like 029110).
            // If the channel is a Native Gemini channel, we leave the model pure so the official SDK works natively!
            if (channelConfig.type === ChannelType.OPENAI && (upstreamModel.startsWith('veo') || upstreamModel.startsWith('imagen') || upstreamModel.startsWith('sora') || upstreamModel.startsWith('gemini'))) {
                const sourceBody = (body as Record<string, any>) || {};
                const aspectRatio = sourceBody.aspect_ratio || sourceBody.generationConfig?.aspectRatio;
                const quality = sourceBody.quality || sourceBody.generationConfig?.quality;
                
                // Dynamic Aspect Ratio Suffix mapping
                if (aspectRatio && !upstreamModel.includes('_landscape') && !upstreamModel.includes('_portrait') && !upstreamModel.includes('-landscape') && !upstreamModel.includes('-portrait')) {
                    if (aspectRatio === '16:9') {
                        upstreamModel += upstreamModel.includes('_') ? '_landscape' : '-landscape';
                    } else if (aspectRatio === '9:16') {
                        upstreamModel += upstreamModel.includes('_') ? '_portrait' : '-portrait';
                    }
                }
                
                // Dynamic Quality Suffix mapping
                if (quality && !upstreamModel.includes('_hq') && !upstreamModel.includes('-hq') && !upstreamModel.includes('_hd') && !upstreamModel.includes('-hd')) {
                     if (quality === 'hq' || quality === 'hd') {
                         upstreamModel += upstreamModel.includes('_') ? '_hq' : '-hq';
                     }
                }
            }
            if (body && typeof body === 'object' && !Array.isArray(body) && !(body instanceof FormData)) {
                if (!body.model) {
                    body.model = model;
                }
            }

            const upstreamUrl = buildUpstreamUrl(channelConfig, upstreamModel, endpointType, isStream);
            log.info(`[Dispatcher] Selected channel: ${channelConfig.name} (id=${channelConfig.id}), upstream: ${upstreamUrl}, model: ${upstreamModel}`);

            // 2.5 Prepare Body & Headers
            let forwardBody: Record<string, any>;
            if (isFormData) {
                if (fetchHeaders instanceof Headers) fetchHeaders.delete('Content-Type');
                else delete (fetchHeaders as Record<string, string>)['Content-Type'];

                forwardBody = new FormData();
                const sourceBody = body as Record<string, any>;
                for (const key in sourceBody) {
                    if (key === 'model') forwardBody.append(key, upstreamModel);
                    else if (sourceBody[key] instanceof File) forwardBody.append(key, sourceBody[key], sourceBody[key].name);
                    else forwardBody.append(key, sourceBody[key]);
                }
            } else {
                let sourceBody = body as Record<string, any>;
                
                // Translation: Convert SiliconFlow video prompt into OpenAI Chat Completion messages
                if (channelConfig.endpointType === 'chat' && endpointType === 'video') {
                    const prompt = sourceBody.prompt || '';
                    sourceBody = {
                        model: upstreamModel,
                        messages: [{ role: 'user', content: prompt }]
                    };
                    log.info(`[Dispatcher] 🔄 Translating video/submit payload into chat/completions payload for channel ${channelConfig.id}`);
                }

                // Pass original model name (with -F suffix) to transformRequest for enable_thinking handling
                // but use upstreamModel for the actual model field in the request
                const transformedBody = skipTransform ? sourceBody : handler.transformRequest(sourceBody, originalModel);
                if (!Array.isArray(transformedBody)) {
                    transformedBody.model = upstreamModel; // Override model with mapped name
                }
                forwardBody = JSON.stringify(transformedBody) as any;

                // Log payload size for multimodal diagnostics
                const payloadSizeBytes = typeof forwardBody === 'string' ? new Blob([forwardBody]).size : 0;
                if (payloadSizeBytes > 500_000) {
                    log.info(`[Dispatcher] ⚠️ Large payload: ${(payloadSizeBytes / 1024 / 1024).toFixed(2)} MB for model ${model}`);
                }
            }

            // 3. Package & Rate Limit Check
            // (isPackageFree & effectiveRuleId already calculated at step 0)

            let packageLockId: string | null = null;
            if (isPackageFree && effectiveRuleId) {
                const rule = memoryCache.rateLimitRules.get(effectiveRuleId);
                if (rule) {
                    if (await isPackageRateLimited(user.id, rule)) {
                        throw new Error(`Package Rate Limit (RPM/RPH) Exceeded for model ${model}`);
                    }
                    if (rule.concurrent > 0) {
                        const acquired = await waitForPackageConcurrency(user.id, effectiveRuleId, rule.concurrent);
                        if (!acquired) {
                            throw new Error(`Package Concurrency Limit Exceeded for model ${model}`);
                        }
                        packageLockId = getPackageLockId(user.id, effectiveRuleId);
                        packageConcurrencyMap.set(packageLockId, (packageConcurrencyMap.get(packageLockId) || 0) + 1);
                    }
                }
            }

            // 3.5 Billing Pre-check
            let preDeducted = 0;
            try {
                const maxTokens = estimateMaxTokens(body, endpointType);
                preDeducted = await preCheckAndDecrement({
                    userId: user.id,
                    tokenId: token.id,
                    modelName: model,
                    userGroup: user.group,
                    maxTokens,
                    isPackageFree
                });

                const bodyObj = body as Record<string, any>;
                if (bodyObj.computer_use) log.info(`[Dispatcher] User ${user.id} requested Computer Use with ${model}`);
                if (bodyObj.tool_search || bodyObj.deferred_tools) log.info(`[Dispatcher] Model ${model} active with Tool Search / Deferred Loading.`);

                // 4. Upstream Fetch (with dynamic timeout for large payloads)
                let upstreamTimeoutMs = parseInt(optionCache.get('UPSTREAM_TIMEOUT_MS', '30000'));
                // Scale timeout for large payloads: +5s per MB over 1MB
                const bodySize = typeof forwardBody === 'string' ? (forwardBody as unknown as string).length : 0;
                if (bodySize > 1_000_000) {
                    const extraMs = Math.ceil((bodySize - 1_000_000) / 1_000_000) * 5000;
                    upstreamTimeoutMs += extraMs;
                    log.info(`[Dispatcher] Extended timeout to ${upstreamTimeoutMs}ms for ${(bodySize / 1024 / 1024).toFixed(1)}MB payload`);
                }
                const abortCtl = new AbortController();
                const fetchTimeout = setTimeout(() => abortCtl.abort(), upstreamTimeoutMs);
                const startTime = Date.now();
                let response: Response;
                try {
                    response = await fetch(upstreamUrl, {
                        method: 'POST',
                        headers: fetchHeaders,
                        body: typeof forwardBody === 'object' && !(forwardBody instanceof FormData) ? JSON.stringify(forwardBody) : (forwardBody as BodyInit),
                        signal: abortCtl.signal
                    });
                } catch (fetchErr: any) {
                    clearTimeout(fetchTimeout);
                    if (fetchErr?.name === 'AbortError') {
                        const elapsed = Date.now() - startTime;
                        await circuitBreaker.recordError(channelConfig.id, 504, `Timeout after ${elapsed}ms`);
                        throw new Error(`Upstream timeout after ${elapsed}ms (limit: ${upstreamTimeoutMs}ms)`);
                    }
                    throw fetchErr;
                }
                clearTimeout(fetchTimeout); // Don't abort during streaming

                if (!response.ok) {
                    const errorText = await response.text();
                    await circuitBreaker.recordError(channelConfig.id, response.status);
                    // Enhanced diagnostics for empty error bodies (CF/proxy rejections)
                    if (!errorText || errorText.trim() === '') {
                        const cfRay = response.headers.get('cf-ray') || 'N/A';
                        const server = response.headers.get('server') || 'N/A';
                        const contentLength = response.headers.get('content-length') || 'N/A';
                        throw new Error(`Status ${response.status} (empty body) — cf-ray: ${cfRay}, server: ${server}, content-length: ${contentLength}, body-size: ${bodySize}B`);
                    }
                    throw new Error(`Status ${response.status}: ${errorText}`);
                }

                const latencyMs = Date.now() - startTime;
                circuitBreaker.recordSuccess(channelConfig.id, latencyMs);

                // 5. Handle Response

                if (isStream && response.body) {
                    const [clientStream, billingStream] = response.body.tee();
                    handleStreamBilling(billingStream, body, user, token, channelConfig, model, preDeducted, lockId, isPackageFree, packageLockId, response.status, traceId, forwardBody, effectiveIdempotencyKey, externalTaskId, externalUserId, externalWorkspaceId, externalFeatureType);

                    // Create a TransformStream to clean model internal tokens from stream
                    const cleanStream = new TransformStream({
                        transform(chunk, controller) {
                            const text = new TextDecoder().decode(chunk);
                            const cleanedText = cleanModelTokens(text);
                            controller.enqueue(new TextEncoder().encode(cleanedText));
                        }
                    });

                    return new Response(clientStream.pipeThrough(cleanStream), {
                        headers: {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive'
                        }
                    });
                }

                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    // Some providers (e.g. Dakka) return Content-Type: application/json
                    // but body is SSE-prefixed ("data: {...}"). Handle both cases.
                    let rawData: Record<string, any>;
                    const responseText = await response.text();
                    const trimmed = responseText.trim();
                    if (trimmed.startsWith('data:')) {
                        // Strip SSE "data:" prefix and parse
                        const jsonStr = trimmed.slice(5).trim();
                        rawData = JSON.parse(jsonStr);
                    } else {
                        rawData = JSON.parse(trimmed);
                    }

                    // Check for upstream overload errors that should trigger retry
                    const isOverloadError = checkUpstreamOverload(rawData);
                    if (isOverloadError) {
                        log.warn(`[Dispatcher] Upstream overload detected for model ${model} on channel ${channelConfig.name}, will retry with another channel`);
                        await circuitBreaker.recordError(channelConfig.id, 503);
                        throw new Error(`Upstream overload: ${JSON.stringify(rawData)}`);
                    }

                    // Usage extraction and billing
                    let { promptTokens, completionTokens } = handler.extractUsage(rawData);

                    // Fallback for image models if usage is not provided by upstream (common for OpenAI DALL-E)
                    if (endpointType === 'images' && promptTokens === 0 && completionTokens === 0) {
                        promptTokens = (body as Record<string, any>).n || 1;
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
                        isStream: false,
                        isPackageFree,
                        statusCode: response.status,
                        traceId,
                        responseBody: JSON.stringify(rawData),
                        orgId: user.orgId,
                        externalTaskId,
                        externalUserId,
                        externalWorkspaceId,
                        externalFeatureType
                    });

                    // Save idempotency key
                    if (effectiveIdempotencyKey) {
                        const cryptoHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${user.id}_${effectiveIdempotencyKey}`))))
                            .map(b => b.toString(16).padStart(2, '0')).join('');
                        await sql`
                            INSERT INTO idempotency_keys (key_hash, user_id, response_code, response_body, expires_at)
                            VALUES (${cryptoHash}, ${user.id}, ${response.status}, ${rawData}, NOW() + INTERVAL '24 hours')
                            ON CONFLICT (key_hash) DO NOTHING
                        `.catch((e: unknown) => log.warn('[Async] Suppressed:', e));
                    }

                    const currentActive = keyConcurrencyMap.get(lockId);
                    if (currentActive) keyConcurrencyMap.set(lockId, Math.max(0, currentActive - 1));
                    if (packageLockId) releasePackageConcurrency(packageLockId);

                    // Clean model internal tokens from response
                    const cleanedData = cleanResponseTokens(rawData);
                    let result = skipTransform ? cleanedData : await handler.transformResponse(cleanedData, { baseUrl: channelConfig.baseUrl, apiKey: activeKey, model: upstreamModel });

                    // Translation: Map Chat Completion video response back into SiliconFlow video API format
                    if (channelConfig.endpointType === 'chat' && endpointType === 'video') {
                        const content = result?.choices?.[0]?.message?.content || result?.message?.content || '';
                        
                        let url = '';
                        // Robustly extract the first https:// or http:// url until a quote, space, or HTML tag is encountered
                        const robustMatch = content.match(/https?:\/\/[^\s'"><]+/);
                        if (robustMatch && robustMatch[0]) {
                            url = robustMatch[0].trim();
                        }
                        
                        if (url) {
                            result = {
                                id: result.id || `video-${Date.now()}`,
                                model: upstreamModel,
                                videos: [{ url, cover_url: '' }]
                            };
                            log.info(`[Dispatcher] 🔄 Translating chat response back to video/submit format`);
                        } else {
                            log.warn(`[Dispatcher] ⚠️ Failed to extract video URL from chat response: ${content.substring(0, 100)}...`);
                        }
                    }

                    // Async video polling: if video channel returned a task/request ID, poll for the actual result
                    const isVideoRoute = endpointType === 'video' || channelConfig.endpointType === 'video';
                    if (isVideoRoute && result && typeof result === 'object') {
                        const asyncId = result.requestId || result.request_id || (result.data?.requestId);
                        if (asyncId) {
                            result = await pollVideoResult(asyncId, channelConfig.baseUrl, activeKey);
                        }
                    }
                    return result;
                } else if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
                    // Some providers return SSE format even for non-stream requests
                    // (e.g. Dakka nano-banana returns multiple progress events, last one has the result)
                    const text = await response.text();
                    let rawData: Record<string, any> | null = null;
                    
                    // Parse SSE format: extract ALL "data:" lines and use the LAST one
                    // (for streaming progress APIs like nano-banana, only the final event has the result)
                    const lines = text.split('\n');
                    let lastDataLine = '';
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (trimmedLine.startsWith('data:')) {
                            lastDataLine = trimmedLine.slice(5).trim();
                        }
                    }

                    if (lastDataLine) {
                        try {
                            rawData = JSON.parse(lastDataLine);
                        } catch {
                            throw new Error('Failed to parse SSE response as JSON');
                        }
                    } else {
                        // No data: prefix found, try direct JSON parse
                        try {
                            rawData = JSON.parse(text.trim());
                        } catch {
                            throw new Error('Failed to parse response as JSON');
                        }
                    }

                    // Usage extraction and billing
                    let { promptTokens, completionTokens } = handler.extractUsage(rawData || {});

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
                        isStream: false,
                        isPackageFree,
                        statusCode: response.status,
                        traceId,
                        responseBody: JSON.stringify(rawData),
                        orgId: user.orgId,
                        externalTaskId,
                        externalUserId,
                        externalWorkspaceId,
                        externalFeatureType
                    });

                    // Save idempotency key
                    if (effectiveIdempotencyKey) {
                        const cryptoHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${user.id}_${effectiveIdempotencyKey}`))))
                            .map(b => b.toString(16).padStart(2, '0')).join('');
                        await sql`
                            INSERT INTO idempotency_keys (key_hash, user_id, response_code, response_body, expires_at)
                            VALUES (${cryptoHash}, ${user.id}, ${response.status}, ${rawData}, NOW() + INTERVAL '24 hours')
                            ON CONFLICT (key_hash) DO NOTHING
                        `.catch((e: unknown) => log.warn('[Async] Suppressed:', e));
                    }

                    const currentActive = keyConcurrencyMap.get(lockId);
                    if (currentActive) keyConcurrencyMap.set(lockId, Math.max(0, currentActive - 1));
                    if (packageLockId) releasePackageConcurrency(packageLockId);

                    // Clean model internal tokens from response
                    const cleanedData = cleanResponseTokens(rawData);
                    let result = skipTransform ? cleanedData : await handler.transformResponse(cleanedData || {}, { baseUrl: channelConfig.baseUrl, apiKey: activeKey, model: upstreamModel });

                    // Async video polling for SSE/text responses
                    const isVideoRoute = endpointType === 'video' || channelConfig.endpointType === 'video';
                    if (isVideoRoute && result && typeof result === 'object') {
                        const asyncId = result.requestId || result.request_id || (result.data?.requestId);
                        if (asyncId) {
                            result = await pollVideoResult(asyncId, channelConfig.baseUrl, activeKey);
                        }
                    }
                    return result;
                } else {
                    // Binary response (Audio, Image, Video blob)
                    const buffer = await response.arrayBuffer();

                    // Default audio billing if not JSON (approx 1 unit per request as fallback)
                    let promptTokens = endpointType.startsWith('audio') ? ((body as Record<string, any>).input?.length || 1) : 1000;
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
                        isStream: false,
                        isPackageFree,
                        statusCode: response.status,
                        traceId,
                        requestBody: typeof forwardBody === 'string' ? forwardBody : '[FormData]',
                        responseBody: '[Binary Response]',
                        orgId: user.orgId,
                        externalTaskId,
                        externalUserId,
                        externalWorkspaceId,
                        externalFeatureType
                    });

                    const currentActive = keyConcurrencyMap.get(lockId);
                    if (currentActive) keyConcurrencyMap.set(lockId, Math.max(0, currentActive - 1));
                    if (packageLockId) releasePackageConcurrency(packageLockId);

                    return new Response(buffer, { headers: { 'Content-Type': contentType } });
                }

            } catch (e: unknown) {
                // 7. Error & Refund Handling

                // Release lock on exception
                const currentActive = keyConcurrencyMap.get(lockId);
                if (currentActive) keyConcurrencyMap.set(lockId, Math.max(0, currentActive - 1));
                if (packageLockId) releasePackageConcurrency(packageLockId);

                if (preDeducted > 0) {
                    await reconcileQuota({
                        userId: user.id,
                        tokenId: token.id,
                        preDeducted,
                        actualCost: 0
                    }).catch((e: unknown) => log.warn('[Async] Suppressed:', e));
                }
                lastError = e instanceof Error ? e : new Error(String(e));

                // Transparent Error Logging (Logged with $0.00 cost)
                await billAndLog({
                    userId: user.id,
                    tokenId: token.id,
                    channelId: channelConfig.id,
                    modelName: model,
                    promptTokens: 0,
                    completionTokens: 0,
                    userGroup: user.group,
                    isStream,
                    isPackageFree,
                    statusCode: getErrorMessage(e)?.startsWith('Status') ? parseInt(getErrorMessage(e).split(' ')[1]) : 500,
                    errorMessage: getErrorMessage(e) || 'Unknown network error',
                    traceId,
                    orgId: user.orgId,
                    externalTaskId,
                    externalUserId,
                    externalWorkspaceId,
                    externalFeatureType
                }).catch((e: unknown) => log.warn('[Async] Suppressed:', e));

                // Handle errors via CircuitBreaker (per-key for 401/403, per-channel for others)
                const errMsg = getErrorMessage(e) || '';
                const statusCode = errMsg.startsWith('Status') ? parseInt(errMsg.split(' ')[1]) : undefined;
                await circuitBreaker.recordError(channelConfig.id, statusCode, errMsg.substring(0, 200), activeKey);
                continue;
            }
        }

        throw new Error(`All candidate channels failed. Last error: ${lastError?.message || 'Unknown network error'}`);
    }

    /**
     * Check if upstream response indicates an overload/error that should trigger retry
     * Some providers return 200 status but with an error message in the body
     */
function checkUpstreamOverload(data: Record<string, any>): boolean {
        if (!data || typeof data !== 'object') return false;

        // Check for error in choices[0].delta.content (streaming format)
        if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
            const choice = data.choices[0];
            const content = choice.delta?.content || choice.message?.content || '';
            if (typeof content === 'string') {
                const overloadPatterns = [
                    /overload/i,
                    /too many requests/i,
                    /rate limit/i,
                    /try again later/i,
                    /temporarily unavailable/i,
                    /service unavailable/i,
                    /please wait/i,
                ];
                for (const pattern of overloadPatterns) {
                    if (pattern.test(content)) return true;
                }
            }
        }

        // Check for error object in response
        if (data.error) {
            const errorMsg = typeof data.error === 'string' ? data.error : (data.error?.message || '');
            if (typeof errorMsg === 'string') {
                const overloadPatterns = [
                    /overload/i,
                    /too many requests/i,
                    /rate limit/i,
                    /try again later/i,
                    /temporarily unavailable/i,
                    /service unavailable/i,
                ];
                for (const pattern of overloadPatterns) {
                    if (pattern.test(errorMsg)) return true;
                }
            }
        }

        return false;
    }

    // URL building is now handled by utils/url.ts buildUpstreamUrl()

function estimateMaxTokens(body: Record<string, any>, type: string) {
        if (type === 'chat') return body.max_tokens || 4096;
        if (type === 'native-gemini') {
            const thinkingBudget = body.generationConfig?.thinkingConfig?.thinkingBudget || 0;
            return (body.generationConfig?.maxOutputTokens || 4096) + thinkingBudget;
        }
        if (type === 'embeddings') return 1;
        if (type === 'images') return 1000; // Flat cost effectively
        return 4096;
    }

function handleStreamBilling(
        billingStream: ReadableStream,
        body: Record<string, any>,
        user: UserRecord,
        token: TokenRecord,
        channelConfig: ChannelConfig,
        model: string,
        preDeducted: number,
        lockId: string,
        isPackageFree: boolean,
        packageLockId: string | null,
        statusCode: number = 200,
        traceId?: string,
        requestBody?: Record<string, any>,
        idempotencyKey?: string,
        externalTaskId?: string,
        externalUserId?: string,
        externalWorkspaceId?: string,
        externalFeatureType?: string
    ) {
        (async () => {
            try {
                const reader = billingStream.getReader();
                const decoder = new TextDecoder("utf-8");
                let completionText = '';
                let usageData: Record<string, any> | null = null;
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
                            } catch { /* non-critical — suppressed */ }
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
                    const promptText = Array.isArray(body.messages) ? body.messages.map((m: Record<string, any>) => m.content).join(' ') : '';
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
                    isStream: true,
                    isPackageFree,
                    statusCode: statusCode,
                    traceId,
                    requestBody: typeof requestBody === 'string' ? requestBody : (requestBody ? JSON.stringify(requestBody) : undefined),
                    responseBody: completionText || undefined,
                    orgId: user.orgId,
                    externalTaskId,
                    externalUserId,
                    externalWorkspaceId,
                    externalFeatureType
                });

                // Save idempotency key for stream
                if (idempotencyKey) {
                    const cryptoHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${user.id}_${idempotencyKey}`))))
                        .map(b => b.toString(16).padStart(2, '0')).join('');
                    // Reconstruct a standard response format if possible, or just the completion
                    const mockResponse = { choices: [{ message: { content: completionText } }], usage: usageData };
                    await sql`
                        INSERT INTO idempotency_keys (key_hash, user_id, response_code, response_body, expires_at)
                        VALUES (${cryptoHash}, ${user.id}, ${statusCode}, ${mockResponse}, NOW() + INTERVAL '24 hours')
                        ON CONFLICT (key_hash) DO NOTHING
                    `.catch((e: unknown) => log.warn('[Async] Suppressed:', e));
                }
            } catch (e: unknown) {
                log.error("[Stream Billing Error]", e);
                // Refund pre-deducted quota natively on abrupt stream network drop before completion
                await reconcileQuota({
                    userId: user.id,
                    tokenId: token.id,
                    preDeducted,
                    actualCost: 0
                }).catch((e: unknown) => log.warn('[Async] Suppressed:', e));
            } finally {
                // Stream ended, unconditionally release the semaphore pool lock
                const currentActive = keyConcurrencyMap.get(lockId);
                if (currentActive) keyConcurrencyMap.set(lockId, Math.max(0, currentActive - 1));
                if (packageLockId) releasePackageConcurrency(packageLockId);
            }
        })();
    }


/**
 * Generic async video polling for providers that use submit-then-poll patterns.
 * Works with SiliconFlow (/v1/video/status) and similar async video APIs.
 * 
 * SiliconFlow flow: POST /v1/video/submit → {requestId} → GET /v1/video/status → {videos: [{url}]}
 */
async function pollVideoResult(
    requestId: string,
    baseUrl: string,
    apiKey: string,
    maxAttempts = 120,  // Max 120 polls
    intervalMs = 5000   // 5 seconds between polls (total max ~10 minutes)
): Promise<Record<string, any>> {
    const base = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    const statusUrl = `${base}/v1/video/status`;

    log.info(`[Video] Async task ${requestId} submitted. Polling ${statusUrl}...`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(r => setTimeout(r, intervalMs));

        try {
            const res = await fetch(statusUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ requestId })
            });

            const result = await res.json() as Record<string, any>;

            // Check status
            const status = result.data?.status || result.status;

            if (status === 'InProgress' || status === 'pending' || status === 'processing' || status === 'running' || status === 'Pending') {
                if (attempt % 6 === 0) { // Log every 30 seconds
                    log.info(`[Video] Task ${requestId} still ${status} (attempt ${attempt}/${maxAttempts})`);
                }
                continue;
            }

            if (status === 'Failed' || status === 'failed' || status === 'error') {
                const reason = result.data?.reason || result.data?.error || result.message || 'Unknown error';
                throw new Error(`Video task ${requestId} failed: ${reason}`);
            }

            // Success: extract video URL
            // SiliconFlow format: {data: {status: "Succeed", results: {videos: [{url: "..."}]}}}
            if (status === 'Succeed' || status === 'succeeded' || status === 'completed') {
                let videoUrl = '';

                // SiliconFlow: {data: {results: {videos: [...]}}} or {results: {videos: [...]}} (no .data wrapper)
                const videos = result.data?.results?.videos || result.data?.results?.images
                    || result.results?.videos || result.results?.images;
                if (Array.isArray(videos) && videos.length > 0) {
                    videoUrl = videos[0].url || '';
                }
                // Fallback: data.results[0].url or results[0].url
                if (!videoUrl) {
                    const resultArr = result.data?.results || result.results;
                    if (Array.isArray(resultArr) && resultArr.length > 0) {
                        videoUrl = resultArr[0].url || resultArr[0].video_url || '';
                    }
                }
                // Fallback: data.url or data.video_url
                if (!videoUrl) {
                    videoUrl = result.data?.url || result.data?.video_url || result.url || result.video_url || '';
                }

                if (videoUrl) {
                    log.info(`[Video] Task ${requestId} completed. Video URL obtained.`);
                    return {
                        created: Math.floor(Date.now() / 1000),
                        data: [{ url: videoUrl }]
                    };
                }

                throw new Error(`Video task ${requestId} completed but no URL found. Raw: ${JSON.stringify(result).substring(0, 300)}`);
            }

            // Unknown status — keep polling
            if (attempt % 6 === 0) {
                log.info(`[Video] Task ${requestId} unknown status: ${status} (attempt ${attempt}/${maxAttempts})`);
            }
        } catch (e: any) {
            if (e.message.includes('failed') || e.message.includes('completed but no URL')) {
                throw e;
            }
            log.warn(`[Video] Poll attempt ${attempt} error: ${e.message}`);
        }
    }

    throw new Error(`Video task ${requestId} timed out after ${maxAttempts} polls (${(maxAttempts * intervalMs / 1000)}s)`);
}
