import { Elysia } from 'elysia';
import { authPlugin } from '../middleware/auth';
import { memoryCache } from '../services/cache';
import { circuitBreaker } from '../services/circuitBreaker';
import { billAndLog } from '../services/billing';
import { ChannelType, ProviderHandler } from '../providers/types';
import { OpenAIApiHandler } from '../providers/openai';
import { AzureOpenAIApiHandler } from '../providers/azure';
import { SunoApiHandler } from '../providers/suno';
import { UdioApiHandler } from '../providers/udio';

function getProviderHandler(type: number): ProviderHandler {
    switch (type) {
        case ChannelType.SUNO:
            return new SunoApiHandler();
        case ChannelType.UDIO:
            return new UdioApiHandler();
        case ChannelType.AZURE:
        case ChannelType.OPENAI:
        default:
            return new OpenAIApiHandler();
    }
}

/**
 * Common request dispatcher for Audio Endpoints
 * Supports /v1/audio/speech, /v1/audio/transcriptions, /v1/audio/translations
 */
async function handleAudioRequest(endpoint: string, { body, request, token, user }: any) {
    let modelName;
    let transformedBody = body;
    let isFormData = false;
    let contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
        isFormData = true;
        // Elysia automatically parses multipart/form-data into the `body` object as File instances/strings
        modelName = body.model;
    } else {
        // Typically JSON for TTS (/v1/audio/speech)
        modelName = body.model;
    }

    if (!modelName) {
        throw new Error("Missing 'model' field in request");
    }

    // --- Phase 4 & 6: Access Control ---
    const groupModelKey = `group_models_${user.group}`;
    const allowedGroupModels = memoryCache.getOption(groupModelKey);
    if (allowedGroupModels && Array.isArray(allowedGroupModels) && !allowedGroupModels.includes(modelName)) {
        throw new Error(`Your group '${user.group}' is not allowed to use model '${modelName}'`);
    }

    if (token.models && token.models.length > 0 && !token.models.includes(modelName)) {
        throw new Error(`Your API key is not allowed to use model '${modelName}'`);
    }
    // ------------------------------------------

    console.log(`[Audio Request] UserID: ${user.id}, Token: ${token.name}, Endpoint: ${endpoint}, Model: ${modelName}`);

    const candidateChannels = memoryCache.selectChannels(modelName);

    if (!candidateChannels || candidateChannels.length === 0) {
        throw new Error(`No available channel found for model: ${modelName}`);
    }

    let lastError: any = null;

    for (const channelConfig of candidateChannels) {
        const handler = getProviderHandler(channelConfig.type);
        const keys = channelConfig.key.split('\n').map((k: string) => k.trim()).filter(Boolean);
        const activeKey = keys[Math.floor(Math.random() * keys.length)];

        // Base fetch headers
        const fetchHeaders = handler.buildHeaders(activeKey);

        // Remove Content-Type from fetchHeaders if we are forwarding FormData 
        // fetch() will automatically set the correct multipart boundary
        if (isFormData && fetchHeaders instanceof Headers && fetchHeaders.has('Content-Type')) {
            fetchHeaders.delete('Content-Type');
        } else if (isFormData && 'Content-Type' in (fetchHeaders as any)) {
            delete (fetchHeaders as any)['Content-Type'];
        }

        let upstreamModel = modelName;
        if (channelConfig.modelMapping && channelConfig.modelMapping[modelName]) {
            upstreamModel = channelConfig.modelMapping[modelName];
        }

        // Prepare body for forwarding
        let forwardBody: any;
        if (isFormData) {
            forwardBody = new FormData();
            for (const key in body) {
                if (key === 'model') {
                    forwardBody.append(key, upstreamModel);
                } else if (body[key] instanceof File) {
                    forwardBody.append(key, body[key], body[key].name);
                } else {
                    forwardBody.append(key, body[key]);
                }
            }
        } else {
            forwardBody = JSON.stringify({ ...body, model: upstreamModel });
        }

        let upstreamUrl = `${channelConfig.baseUrl}${endpoint}`;

        try {
            const response = await fetch(upstreamUrl, {
                method: 'POST',
                headers: fetchHeaders,
                body: forwardBody
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.warn(`[Retry Notice] Audio Channel ${channelConfig.id} returned status ${response.status}. Detail: ${errorText}`);
                await circuitBreaker.recordError(channelConfig.id, response.status);
                throw new Error(`Status ${response.status}: ${errorText}`);
            }

            circuitBreaker.recordSuccess(channelConfig.id);

            // Audio responses can be JSON (for STT) or binary streams (for TTS)
            const responseContentType = response.headers.get('content-type') || '';
            let rawData;

            if (responseContentType.includes('application/json')) {
                rawData = await response.json();
            } else {
                // If it's a binary stream (e.g., MP3), passthrough the ArrayBuffer/Blob
                rawData = await response.arrayBuffer();
            }

            // Billing strategy for audio:
            // For TTS (speech): based on input characters (represented as promptTokens)
            // For STT (transcriptions): sometimes billed by precise seconds (not returned by OpenAI API standard)
            // For simplicity in this mock, we'll charge a flat unit or approximate based on input size.

            let estimatedPrompt = 0;
            let estimatedCompletion = 0;

            if (endpoint === '/v1/audio/speech') {
                // TTS billing: charge based on string length of 'input'
                const inputLength = typeof body.input === 'string' ? body.input.length : 0;
                estimatedPrompt = inputLength;
            } else {
                // STT / Translations billing: approximate 1 unit per request as standard API doesn't return seconds
                estimatedPrompt = 1;
            }

            // Execute billing asynchronously
            await billAndLog({
                userId: user.id,
                tokenId: token.id,
                channelId: channelConfig.id,
                modelName: modelName,
                promptTokens: estimatedPrompt,
                completionTokens: estimatedCompletion,
                userGroup: user.group,
                isStream: false
            });

            // Return Native Response object for binary logic, or standard JSON
            if (responseContentType.includes('application/json')) {
                return rawData;
            } else {
                return new Response(rawData, {
                    headers: {
                        'Content-Type': responseContentType
                    }
                });
            }

        } catch (e: any) {
            lastError = e;
            if (!e.message.startsWith('Status')) {
                await circuitBreaker.recordError(channelConfig.id);
            }
            continue;
        }
    }

    throw new Error(`All candidate channels failed. Last upstream error: ${lastError?.message || 'Unknown network error'}`);
}

export const audioRouter = new Elysia()
    .use(authPlugin)
    .post('/v1/audio/speech', (ctx) => handleAudioRequest('/v1/audio/speech', ctx))
    .post('/v1/audio/transcriptions', (ctx) => handleAudioRequest('/v1/audio/transcriptions', ctx))
    .post('/v1/audio/translations', (ctx) => handleAudioRequest('/v1/audio/translations', ctx));
