import { Elysia } from 'elysia';
import { dispatch } from '../services/dispatcher';
import { getConverter } from '../services/converters';
import { memoryCache } from '../services/cache';

export const embeddingsRouter = new Elysia()
    .post('/embeddings', async (ctx) => handleEmbeddings(ctx, '/v1/embeddings'))
    .post('/engines/:model/embeddings', async (ctx) => handleEmbeddings(ctx, '/v1/embeddings'));

export async function handleEmbeddings({ body, params, request, query }: any, pathType: string) {
    const apiKey = query?.access_token || request.headers.get('Authorization')?.replace('Bearer ', '') || request.headers.get('x-dashscope-api-key');
    
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing API key' }), { status: 401 });

    const t = await memoryCache.getTokenFromCache(apiKey);
    if (!t || t.status !== 1) return new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 });

    const u = await memoryCache.getUserFromDB(t.userId);
    if (!u) return new Response(JSON.stringify({ error: 'User not found' }), { status: 401 });

    const converter = getConverter(pathType);
    const internalReq = converter.convertRequest(body);
    
    // Model resolution
    const modelFromGeminiAction = typeof params?.action === 'string' ? params.action.split(':')[0] : undefined;
    const model = params?.model || modelFromGeminiAction || internalReq.model || body.model;

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const ua = request.headers.get('user-agent') || 'unknown';

    try {
        const result = await dispatch({
            model,
            body: internalReq,
            user: u,
            token: t,
            endpointType: 'embeddings',
            stream: false,
            ip,
            ua
        });

        if (result && !(result instanceof Response)) {
            return converter.convertResponse(result as any);
        }

        return result;
    } catch (error: unknown) {
        const mappedError = converter.convertError(error);
        return new Response(JSON.stringify(mappedError), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
