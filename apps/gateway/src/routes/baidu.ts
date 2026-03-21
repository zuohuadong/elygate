import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { UnifiedDispatcher } from '../services/dispatcher';
import { ConverterFactory } from '../services/converters';
import { memoryCache } from '../services/cache';

export const baiduRouter = new Elysia()
    .post('/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/:model', async ({ body, params, request, query }: any) => {
        const model = params.model;
        const apiKey = query.access_token || request.headers.get('Authorization')?.replace('Bearer ', '');
        
        if (!apiKey) return new Response(JSON.stringify({ error_code: 1, error_msg: 'Missing access_token' }), { status: 401 });

        const t = await memoryCache.getTokenFromCache(apiKey);
        if (!t || t.status !== 1) return new Response(JSON.stringify({ error_code: 1, error_msg: 'Invalid access_token' }), { status: 401 });

        const u = await memoryCache.getUserFromDB(t.userId);
        if (!u) return new Response(JSON.stringify({ error_code: 1, error_msg: 'User not found' }), { status: 401 });

        const converter = ConverterFactory.getConverter('/wenxinworkshop/chat/');
        const internalReq = converter.convertRequest(body);
        internalReq.model = model;

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';

        try {
            const result = await UnifiedDispatcher.dispatch({
                model,
                body: internalReq,
                user: u,
                token: t,
                endpointType: 'chat',
                stream: internalReq.stream,
                ip,
                ua
            });

            if (internalReq.stream && result instanceof Response) {
                return convertStreamToBaidu(result, converter);
            }

            if (result && !(result instanceof Response)) {
                return converter.convertResponse(result as any);
            }

            return result;
        } catch (error: unknown) {
            const baiduError = converter.convertError(error);
            return new Response(JSON.stringify(baiduError), {
                status: 200, // Baidu often returns 200 with error_code
                headers: { 'Content-Type': 'application/json' }
            });
        }
    });

async function convertStreamToBaidu(response: Response, converter: Record<string, any>): Promise<Response> {
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
                                    const baiduChunk = converter.convertStreamChunk(chunk);
                                    if (baiduChunk) controller.enqueue(encoder.encode(baiduChunk));
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
