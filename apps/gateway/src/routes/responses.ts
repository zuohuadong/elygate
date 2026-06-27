import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { log } from '../services/logger';
import { memoryCache } from '../services/cache';
import { dispatch } from '../services/dispatcher';
import { assertModelAccess } from '../middleware/auth';
import type { TokenRecord, UserRecord } from '../types';
import { ChannelType } from '../providers/types';
import { buildMemorySystemMessage, rememberAsync, shouldReadMemory, shouldRememberContent, shouldWriteMemory } from '../services/memory';
import { extractResponseInputText } from './protocolShapes';

function selectResponseChannels(model: string, user: UserRecord, token: TokenRecord) {
    const group = token.tokenGroup && token.tokenGroup !== 'auto' ? token.tokenGroup : user.group;
    return memoryCache.selectChannels(model, group || 'default') || [];
}

function ensureCompactSupported(model: string, user: UserRecord, token: TokenRecord, set: ElysiaCtx['set']) {
    const candidates = selectResponseChannels(model, user, token);
    if (candidates.length === 0) return;
    const supported = candidates.some((channel) => channel.type === ChannelType.OPENAI || channel.type === ChannelType.CODEX);
    if (!supported) {
        set.status = 400;
        throw new Error('/v1/responses/compact is only supported by OpenAI/Codex-compatible channels');
    }
}

function resolveEmbeddingChannel(): { channel: Record<string, any> | null; model: string | undefined } {
    const candidates = [
        'BAAI/bge-m3',
        'bge-m3',
        'Pro/BAAI/bge-m3',
        'baai/bge-m3'
    ];

    for (const candidate of candidates) {
        const channel = memoryCache.selectChannels(candidate)[0];
        if (channel) return { channel, model: candidate };
    }

    return { channel: null, model: undefined };
}

export const responsesRouter = new Elysia()
    .post('/responses', async ({ body, token, user, request, set }: ElysiaCtx) => {
        const u = user as UserRecord;
        const t = token as TokenRecord;
        const b = body as Record<string, any>;
        const model = b.model;

        if (!model) throw new Error("Missing 'model' field in request body");

        assertModelAccess(user, token, model, set);

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';
        const stream = b.stream || false;
        const inputText = extractResponseInputText(b.input);
        const readMemory = shouldReadMemory(b);
        const writeMemory = shouldWriteMemory(b);
        const { channel: embeddingChannel, model: embeddingModel } = (readMemory || writeMemory) && inputText
            ? resolveEmbeddingChannel()
            : { channel: null, model: undefined };

        log.info(`[Responses] UserID: ${u.id}, Model: ${model}, Stream: ${stream}`);

        try {
            const dispatchBody = { ...b };
            if (readMemory && inputText) {
                const memoryMessage = await buildMemorySystemMessage({
                    user: u,
                    token: t,
                    query: inputText,
                    embeddingChannel,
                    embeddingModel
                }).catch((error: unknown) => {
                    log.warn('[Memory] responses lookup failed:', error instanceof Error ? error.message : String(error));
                    return null;
                });
                if (memoryMessage) {
                    dispatchBody.instructions = [dispatchBody.instructions, memoryMessage.content].filter(Boolean).join('\n\n');
                }
            }

            const result = await dispatch({
                model,
                body: dispatchBody,
                user: u,
                token: t,
                endpointType: 'responses',
                stream,
                ip,
                ua
            });

            if (!stream && writeMemory && shouldRememberContent(inputText)) {
                rememberAsync({
                    user: u,
                    token: t,
                    content: inputText,
                    kind: 'summary',
                    metadata: { model, endpoint: 'responses' },
                    embeddingChannel,
                    embeddingModel
                });
            }

            return result;
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            log.error(`[Responses] Error: ${msg}`);
            set.status = 500;
            return { error: { message: msg, type: 'server_error' } };
        }
    })
    .post('/responses/compact', async ({ body, token, user, request, set }: ElysiaCtx) => {
        const u = user as UserRecord;
        const t = token as TokenRecord;
        const b = body as Record<string, any>;
        const model = b.model;

        if (!model) throw new Error("Missing 'model' field in request body");

        assertModelAccess(user, token, model, set);
        ensureCompactSupported(model, u, t, set);

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';
        const stream = b.stream || false;

        log.info(`[Responses/Compact] UserID: ${u.id}, Model: ${model}, Stream: ${stream}`);

        try {
            return await dispatch({
                model,
                body: b,
                user: u,
                token: t,
                endpointType: 'responses',
                stream,
                upstreamPath: '/responses/compact',
                ip,
                ua
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            log.error(`[Responses/Compact] Error: ${msg}`);
            set.status = 500;
            return { error: { message: msg, type: 'server_error' } };
        }
    })
    .post('/responses/:response_id/compact', async ({ body, params, token, user, request, set }: ElysiaCtx) => {
        const u = user as UserRecord;
        const t = token as TokenRecord;
        const b = body as Record<string, any>;
        const responseId = String(params.response_id || '').trim();
        const model = b.model;

        if (!model) throw new Error("Missing 'model' field in request body");
        if (!responseId) throw new Error("Missing 'response_id' path parameter");

        assertModelAccess(user, token, model, set);
        ensureCompactSupported(model, u, t, set);

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';
        const stream = b.stream || false;

        try {
            return await dispatch({
                model,
                body: b,
                user: u,
                token: t,
                endpointType: 'responses',
                stream,
                upstreamPath: `/responses/${encodeURIComponent(responseId)}/compact`,
                ip,
                ua
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            set.status = 500;
            return { error: { message: msg, type: 'server_error' } };
        }
    });
