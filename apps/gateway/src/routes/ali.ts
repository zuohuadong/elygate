import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { UnifiedDispatcher } from '../services/dispatcher';
import { ConverterFactory } from '../services/converters';
import { memoryCache } from '../services/cache';

export const aliRouter = new Elysia()
    .post('/api/v1/services/aigc/text-generation/generation', async ({ body, headers, request }: ElysiaCtx) => {
        const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!apiKey) return new Response(JSON.stringify({ code: 'Unauthorized', message: 'Missing API key' }), { status: 401 });

        const t = await memoryCache.getTokenFromCache(apiKey);
        if (!t || t.status !== 1) return new Response(JSON.stringify({ code: 'Unauthorized', message: 'Invalid API key' }), { status: 401 });

        const u = await memoryCache.getUserFromDB(t.userId);
        if (!u) return new Response(JSON.stringify({ code: 'Unauthorized', message: 'User not found' }), { status: 401 });

        const converter = ConverterFactory.getConverter('/aigc/text-generation/generation');
        const internalReq = converter.convertRequest(body);

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';

        try {
            const result = await UnifiedDispatcher.dispatch({
                model: internalReq.model,
                body: internalReq,
                user: u,
                token: t,
                endpointType: 'chat',
                stream: internalReq.stream,
                ip,
                ua
            });

            if (internalReq.stream && result instanceof Response) {
                return convertStreamToAli(result, converter);
            }

            if (result && !(result instanceof Response)) {
                return converter.convertResponse(result as Record<string, any>[]);
            }

            return result;
        } catch (error: unknown) {
            const aliError = converter.convertError(error);
            return new Response(JSON.stringify(aliError), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    });

async function convertStreamToAli(response: Response, converter: Record<string, any>): Promise<Response> {
    const reader = response.body?.getReader();
    if (!reader) return response;
    
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    const stream = new ReadableStream({
        async start(controller) {
            let buffer = '';
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value);
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data !== '[DONE]') {
                                try {
                                    const chunk = JSON.parse(data);
                                    const aliChunk = converter.convertStreamChunk(chunk);
                                    if (aliChunk) controller.enqueue(encoder.encode(aliChunk));
                                } catch { /* stream chunk parse error — skip */ }
                            }
                        }
                    }
                }
            } catch { /* stream complete — expected */ }
            controller.close();
        }
    });
    
    return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
    });
}
