import { Elysia } from 'elysia';
import { UnifiedDispatcher } from '../services/dispatcher';
import { ConverterFactory } from '../services/converters';
import { memoryCache } from '../services/cache';
import type { TokenRecord,  UserRecord  } from '../types';

/**
 * Gemini API Compatible Endpoint
 * 
 * Handles Gemini format requests at /v1/models/{model}:generateContent
 * URL pattern: /v1/models/gemini-pro:generateContent
 * 
 * Note: Elysia doesn't support literal colon in route paths,
 * so we use a wildcard approach with custom parsing.
 */

export const geminiRouter = new Elysia()
    .all('/models/*', async ({ request, params }: any) => {
        const url = new URL(request.url);
        const pathname = url.pathname;
        
        // Check if this is a Gemini generateContent request
        // Pattern: /v1/models/{model}:generateContent or /v1/models/{model}:streamGenerateContent
        const match = pathname.match(/\/v1\/models\/([^:]+):(generateContent|streamGenerateContent)$/);
        if (!match) {
            return new Response(JSON.stringify({ 
                error: { 
                    code: 404, 
                    message: 'Not found. Use /v1/models/{model}:generateContent', 
                    status: 'NOT_FOUND' 
                } 
            }), {
                status: 404, 
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const model = match[1];
        const isStream = match[2] === 'streamGenerateContent';
        
        // Only allow POST for generateContent
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ 
                error: { 
                    code: 405, 
                    message: 'Method not allowed. Use POST.', 
                    status: 'METHOD_NOT_ALLOWED' 
                } 
            }), {
                status: 405, 
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Support both x-goog-api-key header and ?key= query param
        const apiKey = request.headers.get('x-goog-api-key') || url.searchParams.get('key');

        if (!apiKey) {
            return new Response(JSON.stringify({ 
                error: { 
                    code: 401, 
                    message: 'Missing API key. Use x-goog-api-key header or ?key= query param.', 
                    status: 'UNAUTHENTICATED' 
                } 
            }), {
                status: 401, 
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const t = await memoryCache.getTokenFromCache(apiKey);
        if (!t || t.status !== 1) {
            return new Response(JSON.stringify({ 
                error: { 
                    code: 401, 
                    message: 'Invalid or disabled API key', 
                    status: 'UNAUTHENTICATED' 
                } 
            }), {
                status: 401, 
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const u = await memoryCache.getUserFromDB(t.userId);
        if (!u) {
            return new Response(JSON.stringify({ 
                error: { 
                    code: 401, 
                    message: 'User not found', 
                    status: 'UNAUTHENTICATED' 
                } 
            }), {
                status: 401, 
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Check model access
        const tokenModels = t.models || [];
        if (tokenModels.length > 0 && !tokenModels.includes(model) && !tokenModels.includes('*')) {
            return new Response(JSON.stringify({ 
                error: { 
                    code: 400, 
                    message: `Model ${model} is not allowed for this token`, 
                    status: 'INVALID_ARGUMENT' 
                } 
            }), {
                status: 400, 
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Parse request body
        let body;
        try {
            body = await request.json();
        } catch (e) {
            return new Response(JSON.stringify({ 
                error: { 
                    code: 400, 
                    message: 'Invalid JSON body', 
                    status: 'INVALID_ARGUMENT' 
                } 
            }), {
                status: 400, 
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const converter = ConverterFactory.getConverter('/generateContent');
        const internalReq = converter.convertRequest(body);
        internalReq.model = model;
        internalReq.stream = isStream;

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';

        const result = await UnifiedDispatcher.dispatch({
            model,
            body: internalReq,
            user: u,
            token: t,
            endpointType: 'chat',
            stream: isStream,
            ip,
            ua
        });

        if (result && !(result instanceof Response)) {
            const geminiRes = converter.convertResponse(result as any);
            return geminiRes;
        }

        return result;
    });
