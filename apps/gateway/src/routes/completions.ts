import type { ElysiaCtx } from '../types';
import { Elysia } from 'elysia';
import { log } from '../services/logger';
import { dispatch } from '../services/dispatcher';
import { assertModelAccess } from '../middleware/auth';
import type { TokenRecord, UserRecord } from '../types';

export const completionsRouter = new Elysia()
    .post('/completions', async ({ body, token, user, request, set }: ElysiaCtx) => {
        const u = user as UserRecord;
        const t = token as TokenRecord;
        const b = body as Record<string, any>;
        const model = b.model;

        if (!model) throw new Error("Missing 'model' field");

        assertModelAccess(user, token, model, set);

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const ua = request.headers.get('user-agent') || 'unknown';
        const stream = b.stream || false;

        // Convert legacy completions format to chat completions
        const chatBody: Record<string, any> = {
            model,
            stream,
            temperature: b.temperature,
            top_p: b.top_p,
            max_tokens: b.max_tokens,
            presence_penalty: b.presence_penalty,
            frequency_penalty: b.frequency_penalty,
            stop: b.stop,
            n: b.n,
            logprobs: b.logprobs,
            echo: b.echo,
        };

        const prompt = b.prompt;
        if (typeof prompt === 'string') {
            chatBody.messages = [{ role: 'user', content: prompt }];
        } else if (Array.isArray(prompt)) {
            chatBody.messages = prompt.map((p: string) => ({ role: 'user', content: p }));
        } else {
            chatBody.messages = [{ role: 'user', content: '' }];
        }

        if (b.system) {
            chatBody.messages.unshift({ role: 'system', content: b.system });
        }

        log.info(`[Completions] UserID: ${u.id}, Model: ${model}, Stream: ${stream}`);

        try {
            return await dispatch({
                model,
                body: chatBody,
                user: u,
                token: t,
                endpointType: 'chat',
                stream,
                ip,
                ua
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            log.error(`[Completions] Error: ${msg}`);
            set.status = 500;
            return { error: { message: msg, type: 'server_error' } };
        }
    });
