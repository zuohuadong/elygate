import { Elysia } from 'elysia';
import { dispatch } from '../services/dispatcher';
import { getConverter } from '../services/converters';
import { memoryCache } from '../services/cache';
import { createTask } from '../services/task-service';
import { log } from '../services/logger';
import type { UserRecord, TokenRecord } from '../types';

// Models that require async processing (long generation times like video)
const ASYNC_IMAGE_MODELS = /sora|cogview|kling|hunyuan|wanx|jimeng/i;

export const imagesRouter = new Elysia()
    .post('/images/generations', async (ctx) => handleImages(ctx, '/v1/images/generations'))
    // Ali DashScope Image
    .post('/api/v1/services/aigc/text2image/image-synthesis', async (ctx) => handleImages(ctx, '/aigc/text2image/'))
    .post('/images/edits', async (ctx) => handleImagePassthrough(ctx))
    .post('/images/variations', async (ctx) => handleImagePassthrough(ctx));

async function handleImages({ body, headers, params, request, query }: Record<string, any>, pathType: string) {
    const apiKey = query?.access_token || request.headers.get('Authorization')?.replace('Bearer ', '') || request.headers.get('x-dashscope-api-key');
    
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing API key' }), { status: 401 });

    const t = await memoryCache.getTokenFromCache(apiKey);
    if (!t || t.status !== 1) return new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 });

    const u = await memoryCache.getUserFromDB(t.userId);
    if (!u) return new Response(JSON.stringify({ error: 'User not found' }), { status: 401 });

    const converter = getConverter(pathType);
    const internalReq = converter.convertRequest(body);
    
    const model = internalReq.model || body.model || 'dall-e-3';

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const ua = request.headers.get('user-agent') || 'unknown';

    // Async image models (sora-image, cogview, etc.) go through task queue
    if (ASYNC_IMAGE_MODELS.test(model)) {
        log.info(`[IMAGE-ASYNC] UserID: ${u.id}, Token: ${t.name}, Model: ${model}`);
        const taskId = await createTask({
            userId: u.id,
            tokenId: t.id,
            model,
            type: 'image',
            requestBody: body,
        });
        return new Response(JSON.stringify({
            id: taskId,
            object: 'task',
            model,
            status: 'pending',
            message: 'Image generation task created. Poll GET /v1/tasks/{id} for status.',
        }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        const result = await dispatch({
            model,
            body: internalReq,
            user: u,
            token: t,
            endpointType: 'images',
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

async function handleImagePassthrough({ body, request, query }: Record<string, any>) {
    const apiKey = query?.access_token || request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!apiKey) return new Response(JSON.stringify({ error: { message: 'Missing API key', type: 'authentication_error' } }), { status: 401 });
    const t = await memoryCache.getTokenFromCache(apiKey);
    if (!t || t.status !== 1) return new Response(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error' } }), { status: 401 });
    const u = await memoryCache.getUserFromDB(t.userId);
    if (!u) return new Response(JSON.stringify({ error: { message: 'User not found', type: 'authentication_error' } }), { status: 401 });
    const b = body as Record<string, any>;
    const model = b.model || 'dall-e-2';
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const ua = request.headers.get('user-agent') || 'unknown';
    try {
        return await dispatch({ model, body: b, user: u, token: t, endpointType: 'images', stream: false, ip, ua });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return new Response(JSON.stringify({ error: { message: msg, type: 'server_error' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
