import type { ElysiaCtx, TokenRecord, UserRecord } from '../types';
import { Elysia } from 'elysia';
import { dispatch } from '../services/dispatcher';
import { assertModelAccess } from '../middleware/auth';

export const editsRouter = new Elysia()
    .post('/edits', async ({ body, token, user, request, set }: ElysiaCtx) => {
        const b = body as Record<string, any>;
        const model = b.model || 'gpt-3.5-turbo-instruct';
        assertModelAccess(user, token, model, set);

        const input = Array.isArray(b.input) ? b.input.join('\n') : (b.input || '');
        const instruction = b.instruction || 'Edit the input.';
        const chatBody = {
            model,
            temperature: b.temperature,
            top_p: b.top_p,
            n: b.n,
            messages: [
                { role: 'system', content: instruction },
                { role: 'user', content: input }
            ]
        };

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';

        return dispatch({
            model,
            body: chatBody,
            user: user as UserRecord,
            token: token as TokenRecord,
            endpointType: 'chat',
            stream: false,
            ip,
            ua
        });
    });
