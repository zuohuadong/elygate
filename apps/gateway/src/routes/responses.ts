import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { log } from '../services/logger';
import { memoryCache } from '../services/cache';
import { dispatch } from '../services/dispatcher';
import { assertModelAccess } from '../middleware/auth';
import type { TokenRecord, UserRecord } from '../types';

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

        log.info(`[Responses] UserID: ${u.id}, Model: ${model}, Stream: ${stream}`);

        try {
            return await dispatch({
                model,
                body: b,
                user: u,
                token: t,
                endpointType: 'responses',
                stream,
                ip,
                ua
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            log.error(`[Responses] Error: ${msg}`);
            set.status = 500;
            return { error: { message: msg, type: 'server_error' } };
        }
    })
    .post('/responses/compact', async ({ body, token, user, request, set }: ElysiaCtx) => {
        // Compact route: same as /responses but signals compaction intent to upstream.
        const u = user as UserRecord;
        const t = token as TokenRecord;
        const b = body as Record<string, any>;
        const model = b.model;

        if (!model) throw new Error("Missing 'model' field in request body");

        assertModelAccess(user, token, model, set);

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
    .post('/responses/:response_id/compact', async ({ body, token, user, request, set }: ElysiaCtx) => {
        // Per-response-ID compat route (New API supports this pattern).
        const u = user as UserRecord;
        const t = token as TokenRecord;
        const b = body as Record<string, any>;
        const model = b.model;

        if (!model) throw new Error("Missing 'model' field in request body");

        assertModelAccess(user, token, model, set);

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
                ip,
                ua
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            set.status = 500;
            return { error: { message: msg, type: 'server_error' } };
        }
    });
