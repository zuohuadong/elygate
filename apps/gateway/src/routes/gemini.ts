import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { dispatch } from '../services/dispatcher';
import { getConverter } from '../services/converters';
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

const geminiHandler = async ({ request, params }: ElysiaCtx) => {
        const url = new URL(request.url);
        const actionParam = params.action as string;
        
        if (!actionParam) return;

        // Check if this is a Gemini generateContent request
        // Pattern: {model}:generateContent or {model}:streamGenerateContent
        const match = actionParam.match(/^([^:]+):(generateContent|streamGenerateContent)$/);
        if (!match) return; // Not a Gemini generateContent request, fall through
        
        const model = match[1];
        const isStream = match[2] === 'streamGenerateContent';
        
        // Support Authorization: Bearer, x-goog-api-key header, and ?key= query param
        let apiKey = request.headers.get('x-goog-api-key') || url.searchParams.get('key');
        if (!apiKey) {
            const authHeader = request.headers.get('authorization');
            if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
                apiKey = authHeader.substring(7).trim();
            }
        }

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
        } catch (e: unknown) {
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

        const converter = getConverter('/generateContent');
        const internalReq = converter.convertRequest(body);
        internalReq.model = model;
        internalReq.stream = isStream;

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';

        const result = await dispatch({
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
};

export const geminiRouter = new Elysia()
    .post('/models/:action', geminiHandler)
    .post('/v1/models/:action', geminiHandler)
    .post('/v1beta/models/:action', geminiHandler);
