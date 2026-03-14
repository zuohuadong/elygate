import { Elysia } from 'elysia';
import { UnifiedDispatcher } from '../services/dispatcher';
import { ConverterFactory } from '../services/converters';
import { memoryCache } from '../services/cache';

export const moderationsRouter = new Elysia()
    .post('/moderations', async (ctx) => handleModeration(ctx))
    .post('/v1/moderations', async (ctx) => handleModeration(ctx));

async function handleModeration({ body, headers, params, request, query }: any) {
    const apiKey = query?.access_token || request.headers.get('Authorization')?.replace('Bearer ', '');
    
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing API key' }), { status: 401 });

    const t = await memoryCache.getTokenFromCache(apiKey);
    if (!t || t.status !== 1) return new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 });

    const u = await memoryCache.getUserFromDB(t.userId);
    if (!u) return new Response(JSON.stringify({ error: 'User not found' }), { status: 401 });

    const converter = ConverterFactory.getConverter('/moderations');
    const internalReq = converter.convertRequest(body);
    
    const model = internalReq.model;

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const ua = request.headers.get('user-agent') || 'unknown';

    try {
        const result = await UnifiedDispatcher.dispatch({
            model,
            body: internalReq,
            user: u,
            token: t,
            endpointType: 'moderations',
            stream: false,
            ip,
            ua
        });

        if (result && !(result instanceof Response)) {
            return converter.convertResponse(result as any);
        }

        return result;
    } catch (error: any) {
        const mappedError = converter.convertError(error);
        return new Response(JSON.stringify(mappedError), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
