import { Elysia } from 'elysia';
import { UnifiedDispatcher } from '../services/dispatcher';
import { ConverterFactory } from '../services/converters';
import { memoryCache } from '../services/cache';

export const audioRouter = new Elysia()
    .post('/audio/speech', async (ctx) => handleAudio(ctx, 'audio/speech'))
    .post('/v1/audio/speech', async (ctx) => handleAudio(ctx, 'audio/speech'))
    .post('/audio/transcriptions', async (ctx) => handleAudio(ctx, 'audio/transcriptions'))
    .post('/v1/audio/transcriptions', async (ctx) => handleAudio(ctx, 'audio/transcriptions'))
    .post('/audio/translations', async (ctx) => handleAudio(ctx, 'audio/translations'))
    .post('/v1/audio/translations', async (ctx) => handleAudio(ctx, 'audio/translations'));

async function handleAudio({ body, headers, params, request, query }: Record<string, any>, endpointType: string) {
    const apiKey = query?.access_token || request.headers.get('Authorization')?.replace('Bearer ', '');
    
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing API key' }), { status: 401 });

    const t = await memoryCache.getTokenFromCache(apiKey);
    if (!t || t.status !== 1) return new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 });

    const u = await memoryCache.getUserFromDB(t.userId);
    if (!u) return new Response(JSON.stringify({ error: 'User not found' }), { status: 401 });

    const converter = ConverterFactory.getConverter(`/audio/`);
    const internalReq = converter.convertRequest(body);
    
    const model = internalReq.model || body.model;

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const ua = request.headers.get('user-agent') || 'unknown';

    try {
        const result = await UnifiedDispatcher.dispatch({
            model,
            body: internalReq,
            user: u,
            token: t,
            endpointType: endpointType as any,
            stream: false,
            ip,
            ua
        });

        // Binary responses are returned directly as Response objects from UnifiedDispatcher
        return result;
    } catch (error: unknown) {
        const mappedError = converter.convertError(error);
        return new Response(JSON.stringify(mappedError), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
