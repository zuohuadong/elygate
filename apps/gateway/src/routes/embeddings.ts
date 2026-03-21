import { Elysia } from 'elysia';
import { UnifiedDispatcher } from '../services/dispatcher';
import { ConverterFactory } from '../services/converters';
import { memoryCache } from '../services/cache';

export const embeddingsRouter = new Elysia()
    .post('/embeddings', async (ctx) => handleEmbeddings(ctx, '/v1/embeddings'))
    .post('/v1/embeddings', async (ctx) => handleEmbeddings(ctx, '/v1/embeddings'))
    // Gemini
    .post('/v1/models/:model:embedContent', async (ctx) => handleEmbeddings(ctx, ':embedContent'))
    // Ali
    .post('/api/v1/services/aigc/multimodal-embedding/generation', async (ctx) => handleEmbeddings(ctx, '/aigc/multimodal-embedding/'))
    // Baidu
    .post('/rpc/2.0/ai_custom/v1/wenxinworkshop/embeddings/:model', async (ctx) => handleEmbeddings(ctx, '/wenxinworkshop/embeddings/'));

async function handleEmbeddings({ body, headers, params, request, query }: ElysiaCtx, pathType: string) {
    const apiKey = query?.access_token || request.headers.get('Authorization')?.replace('Bearer ', '') || request.headers.get('x-dashscope-api-key');
    
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing API key' }), { status: 401 });

    const t = await memoryCache.getTokenFromCache(apiKey);
    if (!t || t.status !== 1) return new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 });

    const u = await memoryCache.getUserFromDB(t.userId);
    if (!u) return new Response(JSON.stringify({ error: 'User not found' }), { status: 401 });

    const converter = ConverterFactory.getConverter(pathType);
    const internalReq = converter.convertRequest(body);
    
    // Model resolution
    const model = params?.model || internalReq.model || body.model;

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const ua = request.headers.get('user-agent') || 'unknown';

    try {
        const result = await UnifiedDispatcher.dispatch({
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
            return converter.convertResponse(result as Record<string, any>[]);
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
