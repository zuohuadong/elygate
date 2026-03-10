import { Elysia } from 'elysia';
import { authPlugin, assertModelAccess } from '../middleware/auth';
import { UnifiedDispatcher } from '../services/dispatcher';

/**
 * Unified Audio Endpoints
 * Supports /v1/audio/speech, /v1/audio/transcriptions, /v1/audio/translations
 */
async function handleAudioRequest(endpoint: string, { body, request, token, user, set }: any) {
    const model = body.model;
    if (!model) {
        throw new Error("Missing 'model' field in request");
    }

    // --- Access Control ---
    assertModelAccess(user, token, model, set);
    // ----------------------

    const subPath = endpoint.split('/').pop();
    const endpointType = `audio/${subPath}` as any;

    console.log(`[Audio] UserID: ${user.id}, Token: ${token.name}, Endpoint: ${endpoint}, Model: ${model}`);

    return await UnifiedDispatcher.dispatch({
        model,
        body,
        user: user as any,
        token: token as any,
        endpointType,
        skipTransform: false
    });
}

export const audioRouter = new Elysia()
    .use(authPlugin)
    .post('/audio/speech', (ctx) => handleAudioRequest('/v1/audio/speech', ctx))
    .post('/audio/transcriptions', (ctx) => handleAudioRequest('/v1/audio/transcriptions', ctx))
    .post('/audio/translations', (ctx) => handleAudioRequest('/v1/audio/translations', ctx));
