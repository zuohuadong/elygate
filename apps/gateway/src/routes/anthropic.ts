import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { getErrorMessage } from '../utils/error';
import { memoryCache } from '../services/cache';
import { dispatch } from '../services/dispatcher';
import { getConverter } from '../services/converters';
import type { TokenRecord,  UserRecord  } from '../types';

export const anthropicRouter = new Elysia()
    .post('/messages', async ({ body, headers, request }: ElysiaCtx) => {
        const startTime = Date.now();
        const headerObj = headers as Record<string, string>;
        const getHeader = (name: string) => headerObj[name.toLowerCase()] || headerObj[name] || '';
        
        let apiKey = getHeader('x-api-key') || '';
        if (!apiKey) {
            const authHeader = getHeader('authorization') || '';
            if (authHeader.startsWith('Bearer ')) apiKey = authHeader.slice(7);
        }
        
        if (!apiKey) {
            return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Missing API key' } }), {
                status: 401, headers: { 'Content-Type': 'application/json' }
            });
        }

        const t = await memoryCache.getTokenFromCache(apiKey);
        if (!t || t.status !== 1) {
            return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } }), {
                status: 401, headers: { 'Content-Type': 'application/json' }
            });
        }

        const u = await memoryCache.getUserFromDB(t.userId);
        if (!u) {
            return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'User not found' } }), {
                status: 401, headers: { 'Content-Type': 'application/json' }
            });
        }

        const converter = getConverter('/v1/messages');
        const internalReq = converter.convertRequest(body);
        const isStream = internalReq.stream || false;

        const ip = getHeader('x-forwarded-for') || getHeader('x-real-ip') || 'unknown';
        const ua = getHeader('user-agent') || 'unknown';

        try {
            const result = await dispatch({
                model: internalReq.model,
                body: internalReq,
                user: u,
                token: t,
                endpointType: 'chat',
                stream: isStream,
                ip,
                ua
            });

            if (isStream && result instanceof Response) {
                return convertStreamToAnthropic(result, internalReq.model, converter);
            }

            if (!isStream && result && !(result instanceof Response)) {
                return converter.convertResponse(result as any);
            }

            return result;
        } catch (error: unknown) {
            const anthropicError = converter.convertError({
                message: getErrorMessage(error),
                type: 'api_error'
            });
            return new Response(JSON.stringify(anthropicError), {
                status: getErrorMessage(error)?.includes('Unauthorized') || getErrorMessage(error)?.includes('401') ? 401 : 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    });

async function convertStreamToAnthropic(response: Response, model: string, converter: Record<string, any>): Promise<Response> {
    const reader = response.body?.getReader();
    if (!reader) return response;
    
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    const stream = new ReadableStream({
        async start(controller) {
            // Anthropic stream start sequence
            const messageStart = {
                type: 'message_start',
                message: {
                    id: `msg_${Date.now()}`,
                    type: 'message',
                    role: 'assistant',
                    content: [],
                    model,
                    stop_reason: null,
                    usage: { input_tokens: 0, output_tokens: 0 }
                }
            };
            controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`));
            
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
                            if (data === '[DONE]') {
                                controller.enqueue(encoder.encode(`event: message_stop\ndata: {"type": "message_stop"}\n\n`));
                            } else {
                                try {
                                    const chunk = JSON.parse(data);
                                    const anthropicChunk = converter.convertStreamChunk(chunk);
                                    if (anthropicChunk) {
                                        controller.enqueue(encoder.encode(anthropicChunk));
                                    }
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
